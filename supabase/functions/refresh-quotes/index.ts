// Edge cron: refresh quotes into price_cache with TTL. The ONLY writer of fresh
// quotes — pages read the cache, never the vendor. Schedule ~every minute during
// market hours (free tier: ~60 req/min, so batch-limit the symbols).
//
// Deploy: supabase functions deploy refresh-quotes
// Schedule via Supabase dashboard (cron) or pg_cron → net.http_post.

import { createClient } from "jsr:@supabase/supabase-js@2";

const FINNHUB = "https://finnhub.io/api/v1";

Deno.serve(async () => {
  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  const key = Deno.env.get("FINNHUB_API_KEY")!;
  const ttl = Number(Deno.env.get("PRICE_CACHE_TTL_SECONDS") ?? 60);

  // Only refresh instruments whose cache is stale (older than TTL) or missing.
  const { data: instruments } = await sb
    .from("instruments").select("id,symbol").eq("is_active", true);
  const { data: cached } = await sb
    .from("price_cache").select("instrument_id,fetched_at");
  const freshBy = new Map((cached ?? []).map((c) => [c.instrument_id, c.fetched_at]));

  const now = Date.now();
  const stale = (instruments ?? []).filter((i) => {
    const at = freshBy.get(i.id);
    return !at || now - new Date(at).getTime() > ttl * 1000;
  }).slice(0, 50); // respect free-tier rate limit per invocation

  let updated = 0;
  for (const inst of stale) {
    try {
      const res = await fetch(`${FINNHUB}/quote?symbol=${inst.symbol}&token=${key}`);
      if (!res.ok) continue;
      const j = await res.json();
      if (!j.c) continue;
      await sb.from("price_cache").upsert({
        instrument_id: inst.id,
        last_price_cents: Math.round(j.c * 100),
        prev_close_cents: j.pc ? Math.round(j.pc * 100) : null,
        fetched_at: new Date().toISOString(),
        source: "finnhub",
        is_delayed: true, // free tier is NOT real-time
      });
      updated++;
    } catch (_) { /* skip on error, retry next tick */ }
  }

  return new Response(JSON.stringify({ updated, considered: stale.length }), {
    headers: { "content-type": "application/json" },
  });
});
