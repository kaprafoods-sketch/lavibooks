import type { Cents, Qty } from "../money";
import type { Bar, Side } from "../types";

/**
 * M7 automation — rule params (data, not code). Every price is cents, every pct
 * is a plain number (5 = 5%). One pure evaluator per rule type; the worker is
 * generic.
 */

export type RuleType =
  | "bracket_oco"
  | "stop_loss"
  | "take_profit"
  | "conditional_entry"
  | "scheduled"
  | "time_stop";

export type RuleStatus =
  | "draft" | "armed" | "triggered" | "completed" | "expired" | "cancelled" | "error";

export type RuleMode = "simulate" | "live";

// ── per-type leg/trigger shapes ──────────────────────────────────────────────
export type StopTrigger =
  | { mode: "absolute"; price_cents: Cents }
  | { mode: "pct_below_entry"; pct: number }
  | { mode: "trailing_pct"; pct: number };

export type TakeTrigger =
  | { mode: "absolute"; price_cents: Cents }
  | { mode: "pct_gain"; pct: number }
  | { mode: "r_multiple"; r: number; initial_risk_cents: Cents };

export type EntryTrigger =
  | { mode: "cross_above"; price_cents: Cents }
  | { mode: "cross_below"; price_cents: Cents }
  | { mode: "strategy"; strategy: "sma_crossover"; fast: number; slow: number };

export type BracketParams = {
  qty: Qty;
  take_profit: TakeTrigger;
  stop_loss: StopTrigger;
};
export type StopLossParams = { qty: Qty; trigger: StopTrigger };
export type TakeProfitParams = { qty: Qty; trigger: TakeTrigger };
export type ConditionalEntryParams = { side: Side; qty: Qty; trigger: EntryTrigger };
export type ScheduledParams =
  | { action: "place_at_open"; side: Side; qty: Qty }
  | { action: "eod_flatten"; minutes_before_close: number };
export type TimeStopParams = { qty: Qty; trading_days: number };

export type RuleParams =
  | BracketParams | StopLossParams | TakeProfitParams
  | ConditionalEntryParams | ScheduledParams | TimeStopParams;

// ── evaluation context passed to the pure evaluators ─────────────────────────
export interface RuleContext {
  entryPriceCents: Cents | null; // captured when armed/attached
  hwmCents: Cents | null; // trailing high-water mark (highest close since entry)
  prevCloseCents: Cents | null; // previous evaluated close (for cross detection)
  heldQty: Qty; // shares currently held for the instrument
  tradingDaysHeld: number; // for time_stop
  history: Bar[]; // bars up to and including current (for strategy signals)
  strategySignal?: "buy" | "sell" | "hold"; // precomputed if strategy rule
}

export type Decision = "no_trigger" | "triggered" | "blocked";

export interface EvalResult {
  decision: Decision;
  reason: string;
  /** Intended order when triggered (before safety rails + fill). */
  order?: { side: Side; qty: Qty };
  /** New HWM to persist (trailing stops). */
  newHwmCents?: Cents;
}
