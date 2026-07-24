// Edge cron: match pending LIMIT/STOP orders and queued market orders against
// the latest cached price. Runs every minute during market hours (gate with the
// NYSE calendar if desired). Uses the same fill logic as the app.
//
// NOTE: to avoid duplicating the TS engine into Deno, this function inlines the
// minimal trigger + fill math. Keep in sync with lib/engine/orders.ts.
//
// Deploy: supabase functions deploy match-orders

import { createClient } from "jsr:@supabase/supabase-js@2";

function priceWithSlippage(last: number, side: string, bps: number) {
  const f = bps / 10_000;
  return Math.round(last * (side === "buy" ? 1 + f : 1 - f));
}

function triggerPrice(o: any, last: number, bps: number): number | null {
  const slipped = priceWithSlippage(last, o.side, bps);
  if (o.type === "market") return slipped;
  if (o.type === "limit") {
    const lp = o.limit_price_cents;
    const ok = o.side === "buy" ? last <= lp : last >= lp;
    if (!ok) return null;
    return o.side === "buy" ? Math.min(slipped, lp) : Math.max(slipped, lp);
  }
  if (o.type === "stop") {
    const sp = o.stop_price_cents;
    const ok = o.side === "buy" ? last >= sp : last <= sp;
    return ok ? slipped : null;
  }
  return null;
}

Deno.serve(async () => {
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  const { data: pending } = await sb.from("orders")
    .select("*").eq("status", "pending").limit(200);

  let filled = 0;
  for (const o of pending ?? []) {
    const { data: price } = await sb.from("price_cache").select("last_price_cents").eq("instrument_id", o.instrument_id).maybeSingle();
    if (!price) continue;
    const { data: cfg } = await sb.from("sim_config").select("*").eq("portfolio_id", o.portfolio_id).maybeSingle();
    const bps = cfg?.slippage_bps ?? 5;

    const px = triggerPrice(o, price.last_price_cents, bps);
    if (px === null) continue; // not triggerable yet

    // Buying-power / holdings checks.
    const { data: ledger } = await sb.from("cash_ledger").select("amount_cents").eq("portfolio_id", o.portfolio_id);
    const cash = (ledger ?? []).reduce((a, r) => a + r.amount_cents, 0);
    const notional = Math.round(Number(o.qty) * px);

    if (o.side === "buy" && notional > cash) {
      await sb.from("orders").update({ status: "rejected", reject_reason: "Insufficient buying power at trigger" }).eq("id", o.id);
      continue;
    }

    const { data: trade } = await sb.from("trades").insert({
      order_id: o.id, portfolio_id: o.portfolio_id, instrument_id: o.instrument_id,
      side: o.side, qty: o.qty, price_cents: px, commission_cents: cfg?.commission_cents ?? 0,
    }).select("id").single();

    await sb.from("cash_ledger").insert({
      portfolio_id: o.portfolio_id,
      amount_cents: o.side === "buy" ? -notional : notional,
      reason: o.side, ref_trade_id: trade!.id,
    });

    // NOTE: lot/position rebuild for cron fills is a documented v1 gap — the
    // app path (server action) does full FIFO lot maintenance; extend here to
    // reuse a shared RPC before relying on cron fills for cost-basis accuracy.
    await sb.from("orders").update({ status: "filled", filled_qty: o.qty }).eq("id", o.id);
    filled++;
  }

  return new Response(JSON.stringify({ filled }), { headers: { "content-type": "application/json" } });
});
