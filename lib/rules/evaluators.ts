import type { Cents } from "../money";
import type {
  BracketParams, ConditionalEntryParams, EvalResult, RuleContext, RuleParams,
  RuleType, ScheduledParams, StopLossParams, StopTrigger, TakeProfitParams,
  TakeTrigger, TimeStopParams,
} from "./types";
import { ratchetHwm, trailingStopLevel } from "./trailing";

/**
 * PURE rule evaluators. Given a rule's params, the latest close, and context,
 * decide no_trigger / triggered (+ intended order) / blocked. No I/O, no fills —
 * the worker turns a `triggered` into a gap-aware market fill after safety rails.
 *
 * These functions are deterministic and unit-tested in isolation.
 */

/** Resolve a stop-loss trigger to an absolute price level (cents), or null. */
export function resolveStopLevel(
  t: StopTrigger, ctx: RuleContext,
): { level: Cents | null; newHwm?: Cents; reason?: string } {
  switch (t.mode) {
    case "absolute":
      return { level: t.price_cents };
    case "pct_below_entry":
      if (ctx.entryPriceCents == null) return { level: null, reason: "no entry price captured" };
      return { level: Math.round(ctx.entryPriceCents * (1 - t.pct / 100)) };
    case "trailing_pct": {
      // Requires a close to ratchet against; caller passes it via ctx.hwm update.
      if (ctx.hwmCents == null) return { level: null, reason: "no high-water mark yet" };
      return { level: trailingStopLevel(ctx.hwmCents, t.pct) };
    }
  }
}

/** Resolve a take-profit trigger to an absolute price level (cents), or null. */
export function resolveTakeLevel(
  t: TakeTrigger, ctx: RuleContext,
): { level: Cents | null; reason?: string } {
  switch (t.mode) {
    case "absolute":
      return { level: t.price_cents };
    case "pct_gain":
      if (ctx.entryPriceCents == null) return { level: null, reason: "no entry price captured" };
      return { level: Math.round(ctx.entryPriceCents * (1 + t.pct / 100)) };
    case "r_multiple":
      if (ctx.entryPriceCents == null) return { level: null, reason: "no entry price captured" };
      return { level: ctx.entryPriceCents + Math.round(t.r * t.initial_risk_cents) };
  }
}

export function evaluateStopLoss(p: StopLossParams, closeCents: Cents, ctx: RuleContext): EvalResult {
  // Trailing stops ratchet the HWM on every evaluation.
  let newHwm: Cents | undefined;
  const workingCtx = { ...ctx };
  if (p.trigger.mode === "trailing_pct") {
    newHwm = ratchetHwm(ctx.hwmCents, closeCents);
    workingCtx.hwmCents = newHwm;
  }
  const { level, reason } = resolveStopLevel(p.trigger, workingCtx);
  if (level == null) return { decision: "blocked", reason: reason ?? "stop level unavailable", newHwmCents: newHwm };
  if (ctx.heldQty <= 0) return { decision: "blocked", reason: "no position to protect", newHwmCents: newHwm };

  // Sell stop: triggers when price is AT or BELOW the level.
  if (closeCents <= level) {
    return { decision: "triggered", reason: `price ${closeCents} ≤ stop ${level}`, order: { side: "sell", qty: Math.min(p.qty, ctx.heldQty) }, newHwmCents: newHwm };
  }
  return { decision: "no_trigger", reason: `price ${closeCents} above stop ${level}`, newHwmCents: newHwm };
}

export function evaluateTakeProfit(p: TakeProfitParams, closeCents: Cents, ctx: RuleContext): EvalResult {
  const { level, reason } = resolveTakeLevel(p.trigger, ctx);
  if (level == null) return { decision: "blocked", reason: reason ?? "target unavailable" };
  if (ctx.heldQty <= 0) return { decision: "blocked", reason: "no position to sell" };
  if (closeCents >= level) {
    return { decision: "triggered", reason: `price ${closeCents} ≥ target ${level}`, order: { side: "sell", qty: Math.min(p.qty, ctx.heldQty) } };
  }
  return { decision: "no_trigger", reason: `price ${closeCents} below target ${level}` };
}

export function evaluateConditionalEntry(p: ConditionalEntryParams, closeCents: Cents, ctx: RuleContext): EvalResult {
  const t = p.trigger;
  if (t.mode === "strategy") {
    if (ctx.strategySignal === "buy") return { decision: "triggered", reason: "SMA crossover buy signal", order: { side: p.side, qty: p.qty } };
    return { decision: "no_trigger", reason: `strategy signal: ${ctx.strategySignal ?? "hold"}` };
  }
  // Cross detection needs the previous close — a cross fires only on the bar it crosses.
  if (ctx.prevCloseCents == null) return { decision: "no_trigger", reason: "no prior close for cross detection" };
  if (t.mode === "cross_above") {
    const crossed = ctx.prevCloseCents <= t.price_cents && closeCents > t.price_cents;
    return crossed
      ? { decision: "triggered", reason: `crossed above ${t.price_cents}`, order: { side: p.side, qty: p.qty } }
      : { decision: "no_trigger", reason: `no cross above ${t.price_cents}` };
  }
  // cross_below
  const crossed = ctx.prevCloseCents >= t.price_cents && closeCents < t.price_cents;
  return crossed
    ? { decision: "triggered", reason: `crossed below ${t.price_cents}`, order: { side: p.side, qty: p.qty } }
    : { decision: "no_trigger", reason: `no cross below ${t.price_cents}` };
}

export function evaluateTimeStop(p: TimeStopParams, _closeCents: Cents, ctx: RuleContext): EvalResult {
  if (ctx.heldQty <= 0) return { decision: "blocked", reason: "no position to exit" };
  if (ctx.tradingDaysHeld >= p.trading_days) {
    return { decision: "triggered", reason: `held ${ctx.tradingDaysHeld} ≥ ${p.trading_days} trading days`, order: { side: "sell", qty: Math.min(p.qty, ctx.heldQty) } };
  }
  return { decision: "no_trigger", reason: `held ${ctx.tradingDaysHeld}/${p.trading_days} trading days` };
}

/**
 * Top-level dispatch. bracket_oco is handled by the worker as two child legs
 * (a take_profit + a stop_loss sharing an oco_group); this evaluates a single
 * leg by type, so bracket rows are expanded before reaching here.
 */
export function evaluateRule(
  type: RuleType, params: RuleParams, closeCents: Cents, ctx: RuleContext,
): EvalResult {
  switch (type) {
    case "stop_loss": return evaluateStopLoss(params as StopLossParams, closeCents, ctx);
    case "take_profit": return evaluateTakeProfit(params as TakeProfitParams, closeCents, ctx);
    case "conditional_entry": return evaluateConditionalEntry(params as ConditionalEntryParams, closeCents, ctx);
    case "time_stop": return evaluateTimeStop(params as TimeStopParams, closeCents, ctx);
    case "scheduled": {
      const p = params as ScheduledParams;
      if (p.action === "place_at_open") return { decision: "triggered", reason: "scheduled at open", order: { side: p.side, qty: p.qty } };
      // eod_flatten: sell entire holding (qty comes from context).
      if (ctx.heldQty <= 0) return { decision: "no_trigger", reason: "nothing to flatten" };
      return { decision: "triggered", reason: "EOD flatten", order: { side: "sell", qty: ctx.heldQty } };
    }
    case "bracket_oco":
      return { decision: "blocked", reason: "bracket_oco must be expanded into legs before evaluation" };
  }
}
