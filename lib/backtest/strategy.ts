import type { Cents } from "../money";
import type { Bar } from "../types";
import { notionalCents } from "../money";
import { computeMetrics, type BacktestMetrics } from "./metrics";

export type Signal = "buy" | "sell" | "hold";

export interface BacktestContext {
  index: number;
  history: Bar[]; // bars up to and including current
  position: number; // shares currently held
  cashCents: Cents;
}

export interface Strategy {
  readonly name: string;
  onBar(ctx: BacktestContext, bar: Bar): Signal;
}

/**
 * Reference strategy: SMA crossover. Go long when the fast SMA crosses above
 * the slow SMA; exit when it crosses back below. Long-only, all-in/all-out.
 */
export class SmaCrossoverStrategy implements Strategy {
  readonly name: string;
  constructor(
    private fast = 20,
    private slow = 50,
  ) {
    this.name = `SMA ${fast}/${slow} crossover`;
  }

  private sma(bars: Bar[], period: number): number | null {
    if (bars.length < period) return null;
    const slice = bars.slice(-period);
    return slice.reduce((a, b) => a + b.closeCents, 0) / period;
  }

  onBar(ctx: BacktestContext): Signal {
    const fastNow = this.sma(ctx.history, this.fast);
    const slowNow = this.sma(ctx.history, this.slow);
    const fastPrev = this.sma(ctx.history.slice(0, -1), this.fast);
    const slowPrev = this.sma(ctx.history.slice(0, -1), this.slow);
    if (fastNow == null || slowNow == null || fastPrev == null || slowPrev == null) {
      return "hold";
    }
    const crossedUp = fastPrev <= slowPrev && fastNow > slowNow;
    const crossedDown = fastPrev >= slowPrev && fastNow < slowNow;
    if (crossedUp && ctx.position === 0) return "buy";
    if (crossedDown && ctx.position > 0) return "sell";
    return "hold";
  }
}

export interface BacktestResult {
  metrics: BacktestMetrics;
  equityCurveCents: Cents[];
  trades: { d: string; side: "buy" | "sell"; priceCents: Cents; qty: number }[];
}

/**
 * Run a strategy over daily bars with a starting cash balance. All-in/all-out,
 * long-only, filled at the bar close. Equity = cash + position marked to close.
 */
export function runBacktest(
  strategy: Strategy,
  bars: Bar[],
  startCashCents: Cents,
): BacktestResult {
  let cashCents = startCashCents;
  let position = 0;
  const equityCurveCents: Cents[] = [];
  const trades: BacktestResult["trades"] = [];

  for (let i = 0; i < bars.length; i++) {
    const bar = bars[i];
    const history = bars.slice(0, i + 1);
    const signal = strategy.onBar(
      { index: i, history, position, cashCents },
      bar,
    );

    if (signal === "buy" && position === 0) {
      const qty = Math.floor(cashCents / bar.closeCents);
      if (qty > 0) {
        cashCents -= notionalCents(qty, bar.closeCents);
        position = qty;
        trades.push({ d: bar.d, side: "buy", priceCents: bar.closeCents, qty });
      }
    } else if (signal === "sell" && position > 0) {
      cashCents += notionalCents(position, bar.closeCents);
      trades.push({ d: bar.d, side: "sell", priceCents: bar.closeCents, qty: position });
      position = 0;
    }

    const equity = cashCents + notionalCents(position, bar.closeCents);
    equityCurveCents.push(equity);
  }

  return {
    metrics: computeMetrics(equityCurveCents),
    equityCurveCents,
    trades,
  };
}
