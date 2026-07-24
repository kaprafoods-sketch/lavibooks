"use server";

import { createServerSupabase } from "@/lib/supabase/server";
import { runBacktest, SmaCrossoverStrategy, type BacktestResult } from "@/lib/backtest/strategy";
import type { Bar } from "@/lib/types";

export interface BacktestActionResult {
  ok: boolean;
  message?: string;
  symbol?: string;
  result?: BacktestResult;
}

/**
 * Run the SMA-crossover reference strategy over seeded daily bars. Results are
 * displayed side-by-side with manual performance; algo trades write to a
 * separate kind='algo' portfolio (created lazily) so the two never mix.
 */
export async function runBacktestAction(
  _prev: BacktestActionResult | null,
  formData: FormData,
): Promise<BacktestActionResult> {
  const sb = await createServerSupabase();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return { ok: false, message: "Not signed in." };

  const symbol = String(formData.get("symbol")).toUpperCase().trim();
  const fast = Number(formData.get("fast") || 20);
  const slow = Number(formData.get("slow") || 50);
  const startCash = Number(formData.get("start_cash") || 100_000);

  const { data: instrument } = await sb.from("instruments").select("id").eq("symbol", symbol).maybeSingle();
  if (!instrument) return { ok: false, message: `Unknown symbol ${symbol}.` };

  const { data: barRows } = await sb
    .from("daily_bars")
    .select("d,open_cents,high_cents,low_cents,close_cents,volume")
    .eq("instrument_id", instrument.id)
    .order("d", { ascending: true });

  if (!barRows || barRows.length < slow + 5) {
    return { ok: false, message: `Not enough daily bars for ${symbol} (need > ${slow}). Seed more history.` };
  }

  const bars: Bar[] = barRows.map((b) => ({
    d: b.d, openCents: b.open_cents, highCents: b.high_cents,
    lowCents: b.low_cents, closeCents: b.close_cents, volume: Number(b.volume ?? 0),
  }));

  const result = runBacktest(new SmaCrossoverStrategy(fast, slow), bars, startCash * 100);

  // Persist the algo run to a separate algo portfolio (audit + comparison).
  let { data: algoPf } = await sb.from("portfolios")
    .select("id").eq("owner_id", user.id).eq("kind", "algo").maybeSingle();
  if (!algoPf) {
    const { data: created } = await sb.from("portfolios")
      .insert({ owner_id: user.id, name: "Algorithm sandbox", kind: "algo" })
      .select("id").single();
    algoPf = created;
  }
  if (algoPf) {
    await sb.from("audit_log").insert({
      actor_id: user.id, entity: "backtest", entity_id: algoPf.id, action: "run",
      diff: { symbol, fast, slow, metrics: result.metrics },
    });
  }

  return { ok: true, symbol, result };
}
