import { describe, it, expect } from "vitest";
import { consumeFIFO, weightedAvgCostCents, unrealizedPnlCents, openQty } from "./lots";
import type { Lot } from "../types";

const lot = (id: string, qty: number, cost: number, at: string): Lot => ({
  id, qtyOpen: qty, qtyOriginal: qty, costCents: cost, openedAt: at,
});

describe("FIFO lot consumption", () => {
  it("consumes oldest lot first and computes realized P&L", () => {
    const lots = [
      lot("a", 10, 10_000, "2025-01-01T00:00:00Z"), // $100
      lot("b", 10, 12_000, "2025-02-01T00:00:00Z"), // $120
    ];
    // Sell 5 @ $150 → consumes from lot a (cost $100). PnL = (150-100)*5*100 = 25_000c
    const r = consumeFIFO(lots, 5, 15_000);
    expect(r.realizedPnlCents).toBe(25_000);
    expect(openQty(r.remainingLots)).toBe(15);
    expect(r.remainingLots[0].qtyOpen).toBe(5); // lot a partially consumed
  });

  it("spans multiple lots FIFO", () => {
    const lots = [
      lot("a", 10, 10_000, "2025-01-01T00:00:00Z"),
      lot("b", 10, 12_000, "2025-02-01T00:00:00Z"),
    ];
    // Sell 15 @ $130. Cost = 10*100 + 5*120 = 1000+600 = 1600 → 160_000c
    // Proceeds = 15*130 = 1950 → 195_000c. PnL = 35_000c
    const r = consumeFIFO(lots, 15, 13_000);
    expect(r.costOfSoldCents).toBe(160_000);
    expect(r.realizedPnlCents).toBe(35_000);
    expect(openQty(r.remainingLots)).toBe(5);
    expect(r.remainingLots[0].id).toBe("b");
  });

  it("throws on oversell (no shorting)", () => {
    const lots = [lot("a", 5, 10_000, "2025-01-01T00:00:00Z")];
    expect(() => consumeFIFO(lots, 10, 12_000)).toThrow(/no shorting/);
  });
});

describe("weighted-average cost (display)", () => {
  it("is quantity-weighted across open lots", () => {
    const lots = [
      lot("a", 10, 10_000, "2025-01-01T00:00:00Z"),
      lot("b", 30, 14_000, "2025-02-01T00:00:00Z"),
    ];
    // (10*100 + 30*140) / 40 = (1000+4200)/40 = 130 → 13_000c
    expect(weightedAvgCostCents(lots)).toBe(13_000);
  });

  it("is zero for no lots", () => {
    expect(weightedAvgCostCents([])).toBe(0);
  });
});

describe("unrealized P&L", () => {
  it("marks open lots to a price", () => {
    const lots = [lot("a", 10, 10_000, "2025-01-01T00:00:00Z")];
    // mark $120 → (120-100)*10*100 = 20_000c
    expect(unrealizedPnlCents(lots, 12_000)).toBe(20_000);
  });
});
