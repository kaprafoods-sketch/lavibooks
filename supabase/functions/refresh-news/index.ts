// Edge cron: refresh company news + next earnings date into news_cache /
// earnings_cache. Small batch every ~15-30 min. Headlines are attributed and
// timestamped from the vendor; nothing is fabricated.
//
// Free-tier honesty:
//   • /company-news is available on the free tier (needs a from/to window).
//   • /calendar/earnings is frequently premium-gated — when it returns nothing
//     we write available=false so the UI can say "not available on current tier"
//     instead of guessing a date.
//
// Deploy: supabase functions deploy refresh-news ; schedule every 15-30 min.

import { createClient } from "jsr:@supabase/supabase-js@2";

const FINNHUB = "https://finnhub.io/api/v1";
const iso = (d: Date) => d.toISOString().slice(0, 10);

Deno.serve(async () => {
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const key = Deno.env.get("FINNHUB_API_KEY")!;
  const perRun = Number(Deno.env.get("NEWS_SYMBOLS_PER_RUN") ?? 15);

  const { data: instruments } = await sb.from("instruments").select("id,symbol").eq("is_active", true).limit(perRun);
  const now = new Date();
  const from = new Date(now.getTime() - 7 * 86_400_000);
  const earnTo = new Date(now.getTime() + 120 * 86_400_000);

  let headlines = 0;
  for (const inst of instruments ?? []) {
    // ── News ──
    try {
      const res = await fetch(`${FINNHUB}/company-news?symbol=${inst.symbol}&from=${iso(from)}&to=${iso(now)}&token=${key}`);
      if (res.ok) {
        const arr = (await res.json()) as { headline: string; url: string; source: string; datetime: number }[];
        for (const n of (arr ?? []).slice(0, 20)) {
          if (!n.headline) continue;
          await sb.from("news_cache").upsert(
            {
              instrument_id: inst.id,
              headline: n.headline,
              url: n.url ?? null,
              source: n.source ?? null,
              published_at: new Date((n.datetime ?? 0) * 1000).toISOString(),
              fetched_at: new Date().toISOString(),
            },
            { onConflict: "instrument_id,url", ignoreDuplicates: true },
          );
          headlines++;
        }
      }
    } catch (_) { /* skip */ }

    // ── Next earnings date (best-effort; premium-gated on many accounts) ──
    try {
      const res = await fetch(`${FINNHUB}/calendar/earnings?symbol=${inst.symbol}&from=${iso(now)}&to=${iso(earnTo)}&token=${key}`);
      let nextDate: string | null = null;
      if (res.ok) {
        const j = (await res.json()) as { earningsCalendar?: { date: string }[] };
        const upcoming = (j.earningsCalendar ?? []).map((e) => e.date).filter(Boolean).sort();
        nextDate = upcoming[0] ?? null;
      }
      await sb.from("earnings_cache").upsert({
        instrument_id: inst.id,
        next_earnings_date: nextDate,
        available: nextDate != null,
        fetched_at: new Date().toISOString(),
      });
    } catch (_) { /* skip */ }
  }

  return new Response(JSON.stringify({ symbols: (instruments ?? []).length, headlines }), { headers: { "content-type": "application/json" } });
});
