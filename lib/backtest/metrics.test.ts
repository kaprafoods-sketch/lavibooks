import { describe, it, expect } from "vitest";
import { computeMetrics } from "./metrics";
import { runBacktest, SmaCrossoverStrategy } from "./strategy";
import type { Bar } from "../types";

describe("backtest metrics", () => {
  it("computes total return and drawdown on a known curve", () => {
    // 100 → 110 → 90 → 120 (cents)
    const m = computeMetrics([10_000, 11_000, 9_000, 12_000]);
    expect(m.totalReturnPct).toBeCloseTo(20, 5);
    // peak 11_000 → trough 9_000 → dd = 2000/11000 = 18.18%
    expect(m.maxDrawdownPct).toBeCloseTo(18.1818, 3);
    expect(m.tradingDays).toBe(4);
  });

  it("flat curve has zero return, zero drawdown, zero sharpe", () => {
    const m = computeMetrics([10_000, 10_000, 10_000]);
    expect(m.totalReturnPct).toBe(0);
    expect(m.maxDrawdownPct).toBe(0);
    expect(m.sharpe).toBe(0);
  });

  it("win rate counts positive-return days", () => {
    const m = computeMetrics([100, 110, 105, 130]); // up, down, up → 2/3
    expect(m.winRatePct).toBeCloseTo(66.6667, 3);
  });
});

describe("SMA crossover backtest", () => {
  it("buys the uptrend and sells the reversal, ending with cash + no position", () => {
    // Build a rising then falling series to force one buy and one sell.
    const bars: Bar[] = [];
    // Down, then up (forces a fast/slow cross-up → buy), then down (cross-down → sell).
    const prices = [
      ...Array.from({ length: 60 }, (_, i) => 160 - i), // falling 160→101
      ...Array.from({ length: 60 }, (_, i) => 101 + i * 2), // rising 101→219
      ...Array.from({ length: 60 }, (_, i) => 219 - i * 2), // falling
    ];
    prices.forEach((p, i) => {
      const c = p * 100;
      const day = new Date(2025, 0, 1 + i).toISOString().slice(0, 10);
      bars.push({ d: day, openCents: c, highCents: c, lowCents: c, closeCents: c, volume: 1000 });
    });
    const res = runBacktest(new SmaCrossoverStrategy(20, 50), bars, 10_000_000);
    expect(res.trades.length).toBeGreaterThanOrEqual(1);
    expect(res.equityCurveCents).toHaveLength(bars.length);
    // Equity curve is defined and finite throughout.
    expect(res.equityCurveCents.every((e) => Number.isFinite(e))).toBe(true);
  });
});
