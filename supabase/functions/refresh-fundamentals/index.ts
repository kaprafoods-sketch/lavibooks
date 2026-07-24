// Edge cron: refresh fundamentals into fundamentals_cache. LONG TTL (fundamentals
// move slowly) → a handful of calls/day, well within the free tier. The ONLY
// writer of this table; the Command Center reads the cache, never the vendor.
//
// Free-tier honesty: /stock/profile2 gives sector + market cap reliably;
// /stock/metric?metric=all gives P/E, EPS, 52wk hi/lo, beta, margins, yield —
// but MANY fields come back null per name. We store whatever we get, flag
// is_partial, and the UI labels missing fields rather than faking them.
//
// Deploy: supabase functions deploy refresh-fundamentals ; schedule daily.

import { createClient } from "jsr:@supabase/supabase-js@2";

const FINNHUB = "https://finnhub.io/api/v1";
const toCents = (v: unknown) => (typeof v === "number" && isFinite(v) ? Math.round(v * 100) : null);

Deno.serve(async () => {
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const key = Deno.env.get("FINNHUB_API_KEY")!;
  const ttlHours = Number(Deno.env.get("FUNDAMENTALS_TTL_HOURS") ?? 24);

  const { data: instruments } = await sb.from("instruments").select("id,symbol").eq("is_active", true);
  const { data: cached } = await sb.from("fundamentals_cache").select("instrument_id,fetched_at");
  const freshBy = new Map((cached ?? []).map((c) => [c.instrument_id, c.fetched_at]));

  const now = Date.now();
  const stale = (instruments ?? []).filter((i) => {
    const at = freshBy.get(i.id);
    return !at || now - new Date(at).getTime() > ttlHours * 3_600_000;
  }).slice(0, 20); // small daily batch — respect the rate limit

  let updated = 0;
  for (const inst of stale) {
    try {
      const [pRes, mRes] = await Promise.all([
        fetch(`${FINNHUB}/stock/profile2?symbol=${inst.symbol}&token=${key}`),
        fetch(`${FINNHUB}/stock/metric?symbol=${inst.symbol}&metric=all&token=${key}`),
      ]);
      const profile = pRes.ok ? await pRes.json() : {};
      const metricWrap = mRes.ok ? await mRes.json() : {};
      const m = (metricWrap?.metric ?? {}) as Record<string, number | undefined>;

      const row = {
        instrument_id: inst.id,
        sector: profile?.finnhubIndustry ?? null,
        market_cap_cents: toCents(profile?.marketCapitalization ? profile.marketCapitalization * 1_000_000 : null),
        pe: m["peTTM"] ?? m["peBasicExclExtraTTM"] ?? null,
        eps_cents: toCents(m["epsTTM"] ?? null),
        beta: m["beta"] ?? null,
        dividend_yield: m["currentDividendYieldTTM"] ?? m["dividendYieldIndicatedAnnual"] ?? null,
        high_52w_cents: toCents(m["52WeekHigh"] ?? null),
        low_52w_cents: toCents(m["52WeekLow"] ?? null),
        net_margin: m["netProfitMarginTTM"] ?? null,
        gross_margin: m["grossMarginTTM"] ?? null,
        raw: { profile, metric: m }, // full payload → every figure traceable
        fetched_at: new Date().toISOString(),
        source: "finnhub",
        is_partial: !(m["peTTM"] && m["beta"] && m["52WeekHigh"]), // any core field missing → partial
      };
      await sb.from("fundamentals_cache").upsert(row);
      updated++;
    } catch (_) { /* skip; retry next run */ }
  }

  return new Response(JSON.stringify({ updated, considered: stale.length }), { headers: { "content-type": "application/json" } });
});
