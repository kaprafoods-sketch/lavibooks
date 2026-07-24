// Edge cron: daily EOD equity snapshot per portfolio, so the equity curve is
// STORED, not recomputed on the fly. Schedule once daily after US market close
// (e.g. 21:05 UTC). Idempotent per (portfolio, date).
//
// Deploy: supabase functions deploy eod-snapshot

import { createClient } from "jsr:@supabase/supabase-js@2";

Deno.serve(async () => {
  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  const today = new Date().toISOString().slice(0, 10);

  const { data: portfolios } = await sb.from("portfolios").select("id");
  let written = 0;

  for (const pf of portfolios ?? []) {
    // Cash = sum of ledger.
    const { data: ledger } = await sb.from("cash_ledger").select("amount_cents").eq("portfolio_id", pf.id);
    const cash = (ledger ?? []).reduce((a, r) => a + r.amount_cents, 0);

    // Positions value = sum(qty * last_price) over open lots.
    const { data: lots } = await sb.from("lots")
      .select("instrument_id,qty_open").eq("portfolio_id", pf.id).gt("qty_open", 0);
    const iids = [...new Set((lots ?? []).map((l) => l.instrument_id))];
    const priceMap = new Map<string, number>();
    if (iids.length) {
      const { data: prices } = await sb.from("price_cache").select("instrument_id,last_price_cents").in("instrument_id", iids);
      for (const p of prices ?? []) priceMap.set(p.instrument_id, p.last_price_cents);
    }
    const posValue = (lots ?? []).reduce((a, l) => a + Math.round(Number(l.qty_open) * (priceMap.get(l.instrument_id) ?? 0)), 0);

    await sb.from("snapshots").upsert({
      portfolio_id: pf.id, d: today, cash_cents: cash,
      positions_value_cents: posValue, equity_cents: cash + posValue,
    }, { onConflict: "portfolio_id,d" });
    written++;
  }

  return new Response(JSON.stringify({ written, date: today }), {
    headers: { "content-type": "application/json" },
  });
});
