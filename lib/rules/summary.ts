import { fmtCents } from "../money";
import type {
  BracketParams, ConditionalEntryParams, RuleParams, RuleType, ScheduledParams,
  StopLossParams, StopTrigger, TakeProfitParams, TakeTrigger, TimeStopParams,
} from "./types";

/**
 * Plain-language summary of a rule, generated from params. Always visible in the
 * builder so the trader sees exactly what a rule will do before arming it.
 * e.g. "Sell all 40 shares of AAPL if price drops below $178.40 — 5% below your
 * entry — good until Aug 30."
 */

function stopPhrase(t: StopTrigger): string {
  switch (t.mode) {
    case "absolute": return `if price drops below ${fmtCents(t.price_cents)}`;
    case "pct_below_entry": return `if price drops ${t.pct}% below your entry`;
    case "trailing_pct": return `if price falls ${t.pct}% from its highest close since entry (trailing)`;
  }
}
function takePhrase(t: TakeTrigger): string {
  switch (t.mode) {
    case "absolute": return `if price rises to ${fmtCents(t.price_cents)}`;
    case "pct_gain": return `if price gains ${t.pct}%`;
    case "r_multiple": return `at ${t.r}× your initial risk`;
  }
}

export function ruleSummary(
  type: RuleType, params: RuleParams, symbol: string, validUntil?: string | null,
): string {
  const until = validUntil ? ` — good until ${new Date(validUntil).toLocaleDateString(undefined, { month: "short", day: "numeric" })}` : "";
  let core = "";
  switch (type) {
    case "stop_loss": {
      const p = params as StopLossParams;
      core = `Sell ${p.qty} shares of ${symbol} ${stopPhrase(p.trigger)}`;
      break;
    }
    case "take_profit": {
      const p = params as TakeProfitParams;
      core = `Sell ${p.qty} shares of ${symbol} ${takePhrase(p.trigger)}`;
      break;
    }
    case "bracket_oco": {
      const p = params as BracketParams;
      core = `On ${p.qty} shares of ${symbol}: take profit ${takePhrase(p.take_profit)}, or ${stopPhrase(p.stop_loss)}. Whichever fills first cancels the other`;
      break;
    }
    case "conditional_entry": {
      const p = params as ConditionalEntryParams;
      const t = p.trigger;
      const cond = t.mode === "strategy"
        ? `when the ${t.strategy.replace("_", " ")} (${t.fast}/${t.slow}) fires`
        : t.mode === "cross_above" ? `when price crosses above ${fmtCents(t.price_cents)}`
        : `when price crosses below ${fmtCents(t.price_cents)}`;
      core = `${p.side === "buy" ? "Buy" : "Sell"} ${p.qty} shares of ${symbol} ${cond}`;
      break;
    }
    case "scheduled": {
      const p = params as ScheduledParams;
      core = p.action === "place_at_open"
        ? `${p.side === "buy" ? "Buy" : "Sell"} ${p.qty} shares of ${symbol} at the next market open`
        : `Flatten all positions ${p.minutes_before_close} minutes before the close`;
      break;
    }
    case "time_stop": {
      const p = params as TimeStopParams;
      core = `Exit ${p.qty} shares of ${symbol} after ${p.trading_days} trading days, regardless of P&L`;
      break;
    }
  }
  return `${core}${until}.`;
}
