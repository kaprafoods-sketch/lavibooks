import { describe, it, expect } from "vitest";
import {
  evaluateStopLoss, evaluateTakeProfit, evaluateConditionalEntry, evaluateTimeStop,
} from "./evaluators";
import { ratchetHwm, trailingStopLevel } from "./trailing";
import type { RuleContext } from "./types";

const baseCtx: RuleContext = {
  entryPriceCents: 20000, hwmCents: null, prevCloseCents: null,
  heldQty: 40, tradingDaysHeld: 0, history: [],
};

describe("stop-loss evaluation", () => {
  it("triggers a sell when price hits an absolute stop", () => {
    const r = evaluateStopLoss({ qty: 40, trigger: { mode: "absolute", price_cents: 17840 } }, 17800, baseCtx);
    expect(r.decision).toBe("triggered");
    expect(r.order).toEqual({ side: "sell", qty: 40 });
  });

  it("does not trigger above the stop", () => {
    const r = evaluateStopLoss({ qty: 40, trigger: { mode: "absolute", price_cents: 17840 } }, 18000, baseCtx);
    expect(r.decision).toBe("no_trigger");
  });

  it("pct_below_entry computes the level from entry", () => {
    // 5% below 20000 = 19000
    const r = evaluateStopLoss({ qty: 40, trigger: { mode: "pct_below_entry", pct: 5 } }, 18999, baseCtx);
    expect(r.decision).toBe("triggered");
  });

  it("blocks when there is no position to protect", () => {
    const r = evaluateStopLoss({ qty: 40, trigger: { mode: "absolute", price_cents: 17840 } }, 100, { ...baseCtx, heldQty: 0 });
    expect(r.decision).toBe("blocked");
  });
});

describe("trailing stop ratchets up, never down", () => {
  it("HWM only increases", () => {
    expect(ratchetHwm(null, 20000)).toBe(20000);
    expect(ratchetHwm(20000, 21000)).toBe(21000);
    expect(ratchetHwm(21000, 20500)).toBe(21000); // does not drop
    expect(trailingStopLevel(21000, 8)).toBe(19320); // 8% below HWM
  });

  it("trailing stop level follows the ratcheted high, and evaluation ratchets on each bar", () => {
    // First bar sets HWM to 22000, stop = 20240. Price 21000 > stop → no trigger.
    const r1 = evaluateStopLoss({ qty: 40, trigger: { mode: "trailing_pct", pct: 8 } }, 22000, { ...baseCtx, hwmCents: null });
    expect(r1.newHwmCents).toBe(22000);
    expect(r1.decision).toBe("no_trigger");
    // Later, HWM 25000, price falls to 22000. Stop = 23000. 22000 ≤ 23000 → trigger.
    const r2 = evaluateStopLoss({ qty: 40, trigger: { mode: "trailing_pct", pct: 8 } }, 22000, { ...baseCtx, hwmCents: 25000 });
    // ratchet keeps 25000 (22000 < 25000), stop 23000, price 22000 ≤ 23000
    expect(r2.newHwmCents).toBe(25000);
    expect(r2.decision).toBe("triggered");
  });
});

describe("take-profit evaluation", () => {
  it("triggers at an absolute target", () => {
    const r = evaluateTakeProfit({ qty: 40, trigger: { mode: "absolute", price_cents: 25000 } }, 25100, baseCtx);
    expect(r.decision).toBe("triggered");
  });
  it("r_multiple uses entry + r*risk", () => {
    // entry 20000 + 2*1200 = 22400
    const r = evaluateTakeProfit({ qty: 40, trigger: { mode: "r_multiple", r: 2, initial_risk_cents: 1200 } }, 22400, baseCtx);
    expect(r.decision).toBe("triggered");
  });
  it("blocks r_multiple when no entry captured", () => {
    const r = evaluateTakeProfit({ qty: 40, trigger: { mode: "pct_gain", pct: 10 } }, 30000, { ...baseCtx, entryPriceCents: null });
    expect(r.decision).toBe("blocked");
  });
});

describe("conditional entry — cross detection fires only on the crossing bar", () => {
  it("cross_above triggers only when prev ≤ level < now", () => {
    const level = 22000;
    const below = evaluateConditionalEntry({ side: "buy", qty: 20, trigger: { mode: "cross_above", price_cents: level } }, 22100, { ...baseCtx, prevCloseCents: 21900 });
    expect(below.decision).toBe("triggered");
    // Already above on both bars → no fresh cross.
    const already = evaluateConditionalEntry({ side: "buy", qty: 20, trigger: { mode: "cross_above", price_cents: level } }, 22200, { ...baseCtx, prevCloseCents: 22100 });
    expect(already.decision).toBe("no_trigger");
  });

  it("strategy signal buy triggers", () => {
    const r = evaluateConditionalEntry({ side: "buy", qty: 20, trigger: { mode: "strategy", strategy: "sma_crossover", fast: 20, slow: 50 } }, 100, { ...baseCtx, strategySignal: "buy" });
    expect(r.decision).toBe("triggered");
  });
});

describe("time stop", () => {
  it("exits after N trading days", () => {
    const r = evaluateTimeStop({ qty: 40, trading_days: 5 }, 100, { ...baseCtx, tradingDaysHeld: 5 });
    expect(r.decision).toBe("triggered");
  });
  it("holds before N days", () => {
    const r = evaluateTimeStop({ qty: 40, trading_days: 5 }, 100, { ...baseCtx, tradingDaysHeld: 3 });
    expect(r.decision).toBe("no_trigger");
  });
});
