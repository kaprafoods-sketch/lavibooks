import { describe, it, expect } from "vitest";
import { backtestRule } from "./backtest";
import type { Bar } from "../types";

const bars = (closes: number[]): Bar[] =>
  closes.map((c, i) => ({
    d: `2025-01-${String(i + 1).padStart(2, "0")}`,
    openCents: c, highCents: c + 10, lowCents: c - 10, closeCents: c, volume: 1000,
  }));

describe("rule backtester", () => {
  it("stop-loss from a held entry reports the trigger date and P&L", () => {
    // Held from 20000. Absolute stop 18000. Price walks down through it.
    const series = bars([20000, 19500, 19000, 18500, 17900, 17500]);
    const res = backtestRule("stop_loss", { qty: 10, trigger: { mode: "absolute", price_cents: 18000 } }, series, 10, 20000);
    expect(res.triggerCount).toBe(1);
    expect(res.roundTrips[0].pnlCents).toBe(10 * (17900 - 20000)); // fired on the 17900 bar
    expect(res.triggerDates[0]).toBe("2025-01-05");
    expect(res.smallSample).toBe(true); // < 20 triggers
  });

  it("conditional cross-above entry then no exit rule = one entry trigger", () => {
    const series = bars([100, 105, 108, 112, 120]);
    const res = backtestRule("conditional_entry", { side: "buy", qty: 5, trigger: { mode: "cross_above", price_cents: 110 } }, series, 5);
    expect(res.triggerCount).toBeGreaterThanOrEqual(1);
  });

  it("flags small sample under 20 triggers", () => {
    const series = bars([100, 90, 80]);
    const res = backtestRule("stop_loss", { qty: 1, trigger: { mode: "absolute", price_cents: 85 } }, series, 1, 100);
    expect(res.smallSample).toBe(true);
  });
});
