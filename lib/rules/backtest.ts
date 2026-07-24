import type { Cents } from "../money";
import type { Bar } from "../types";
import type { RuleParams, RuleType, RuleContext } from "./types";
import { evaluateRule } from "./evaluators";
import { ratchetHwm } from "./trailing";
import { SmaCrossoverStrategy } from "../backtest/strategy";

/**
 * Rule backtester — replays a rule config over historical daily bars and reports
 * how it WOULD have behaved. Reuses the pure evaluators. Daily-close resolution
 * (free tier) — trailing/gap logic is EOD precision; the UI states this.
 *
 * Model: an entry (conditional_entry / scheduled buy) opens a position at the
 * bar close; exits (stop/take/time) close it. Each round-trip is one "trigger"
 * with a realized P&L for win-rate/drawdown stats.
 */

export interface RuleBacktestResult {
  triggerCount: number;
  triggerDates: string[];
  wins: number;
  losses: number;
  winRatePct: number;
  avgGainCents: Cents;
  avgLossCents: Cents;
  maxDrawdownPct: number;
  smallSample: boolean; // < 20 triggers
  roundTrips: { entryDate: string; exitDate: string; pnlCents: Cents }[];
}

const SMALL_SAMPLE = 20;

export function backtestRule(
  type: RuleType, params: RuleParams, bars: Bar[], qty: number, entryPriceCents?: Cents,
): RuleBacktestResult {
  const roundTrips: RuleBacktestResult["roundTrips"] = [];
  const triggerDates: string[] = [];

  let inPosition = entryPriceCents != null;
  let entry = entryPriceCents ?? 0;
  let entryDate = bars[0]?.d ?? "";
  let hwm: Cents | null = inPosition ? entry : null;
  let daysHeld = 0;
  let prevClose: Cents | null = null;

  // Precompute strategy signals if needed.
  const isStrategy = type === "conditional_entry" && (params as { trigger?: { mode?: string } }).trigger?.mode === "strategy";
  const strat = isStrategy ? new SmaCrossoverStrategy(
    (params as { trigger: { fast: number } }).trigger.fast,
    (params as { trigger: { slow: number } }).trigger.slow,
  ) : null;

  for (let i = 0; i < bars.length; i++) {
    const bar = bars[i];
    const close = bar.closeCents;
    if (inPosition) { daysHeld++; hwm = ratchetHwm(hwm, close); }

    const ctx: RuleContext = {
      entryPriceCents: inPosition ? entry : null,
      hwmCents: hwm,
      prevCloseCents: prevClose,
      heldQty: inPosition ? qty : 0,
      tradingDaysHeld: daysHeld,
      history: bars.slice(0, i + 1),
      strategySignal: strat ? strat.onBar({ index: i, history: bars.slice(0, i + 1), position: inPosition ? qty : 0, cashCents: 0 }) : undefined,
    };

    const isExitRule = type === "stop_loss" || type === "take_profit" || type === "time_stop";
    const isEntryRule = type === "conditional_entry" || (type === "scheduled");

    if (!inPosition && isEntryRule) {
      const r = evaluateRule(type, params, close, ctx);
      if (r.decision === "triggered" && r.order?.side === "buy") {
        inPosition = true; entry = close; entryDate = bar.d; hwm = close; daysHeld = 0;
        triggerDates.push(bar.d);
      }
    } else if (inPosition && isExitRule) {
      const r = evaluateRule(type, params, close, ctx);
      if (r.decision === "triggered" && r.order?.side === "sell") {
        roundTrips.push({ entryDate, exitDate: bar.d, pnlCents: Math.round(qty * (close - entry)) });
        triggerDates.push(bar.d);
        inPosition = false; hwm = null; daysHeld = 0;
      }
    }
    prevClose = close;
  }

  const wins = roundTrips.filter((r) => r.pnlCents > 0);
  const losses = roundTrips.filter((r) => r.pnlCents < 0);
  const avgGain = wins.length ? Math.round(wins.reduce((a, r) => a + r.pnlCents, 0) / wins.length) : 0;
  const avgLoss = losses.length ? Math.round(losses.reduce((a, r) => a + r.pnlCents, 0) / losses.length) : 0;

  // Max drawdown across the cumulative realized-P&L path.
  let cum = 0, peak = 0, maxDd = 0;
  for (const r of roundTrips) {
    cum += r.pnlCents;
    peak = Math.max(peak, cum);
    if (peak > 0) maxDd = Math.max(maxDd, (peak - cum) / peak);
  }

  const triggerCount = triggerDates.length;
  return {
    triggerCount, triggerDates,
    wins: wins.length, losses: losses.length,
    winRatePct: roundTrips.length ? (wins.length / roundTrips.length) * 100 : 0,
    avgGainCents: avgGain, avgLossCents: avgLoss,
    maxDrawdownPct: maxDd * 100,
    smallSample: triggerCount < SMALL_SAMPLE,
    roundTrips,
  };
}
