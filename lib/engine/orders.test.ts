import { describe, it, expect } from "vitest";
import { simulateFill, fillPrice } from "./orders";
import { priceWithSlippage } from "../money";
import type { CashLedgerRow, Lot, SimConfig } from "../types";

const cfg: SimConfig = { slippageBps: 5, commissionCents: 0 };
const now = "2025-06-02T15:00:00Z";
const fund: CashLedgerRow[] = [{ amountCents: 10_000_000, reason: "deposit" }];

describe("slippage", () => {
  it("works against the trader (buys up, sells down)", () => {
    expect(priceWithSlippage(10_000, "buy", 5)).toBe(10_005);
    expect(priceWithSlippage(10_000, "sell", 5)).toBe(9_995);
  });
});

describe("market buy fill", () => {
  it("opens a lot, debits cash by notional, no commission by default", () => {
    const out = simulateFill({
      intent: { side: "buy", type: "market", qty: 10 },
      lastPriceCents: 10_000,
      ledger: fund, lots: [], config: cfg, now, newLotId: "lot1",
    });
    expect(out.status).toBe("filled");
    // fill price 10_005; notional 10*10_005 = 100_050c
    expect(out.fill?.priceCents).toBe(10_005);
    expect(out.ledgerRows).toHaveLength(1);
    expect(out.ledgerRows[0].amountCents).toBe(-100_050);
    expect(out.lots).toHaveLength(1);
    expect(out.lots[0].costCents).toBe(10_005);
  });
});

describe("buying-power rejection", () => {
  it("rejects a buy the account cannot afford", () => {
    const out = simulateFill({
      intent: { side: "buy", type: "market", qty: 100 },
      lastPriceCents: 10_000,
      ledger: [{ amountCents: 50_000, reason: "deposit" }], // only $500
      lots: [], config: cfg, now, newLotId: "lot1",
    });
    expect(out.status).toBe("rejected");
    expect(out.rejectReason).toMatch(/Insufficient buying power/);
    expect(out.lots).toHaveLength(0);
  });
});

describe("sell fill + realized P&L", () => {
  it("consumes lots FIFO and credits proceeds", () => {
    const lots: Lot[] = [
      { id: "a", qtyOpen: 10, qtyOriginal: 10, costCents: 10_000, openedAt: "2025-01-01T00:00:00Z" },
    ];
    const out = simulateFill({
      intent: { side: "sell", type: "market", qty: 5 },
      lastPriceCents: 15_000,
      ledger: fund, lots, config: cfg, now, newLotId: "unused",
    });
    expect(out.status).toBe("filled");
    // sell fill price 15_000 * (1-0.0005) = 14_992 (round). proceeds 5*14_992=74_960
    expect(out.fill?.priceCents).toBe(14_993);
    expect(out.ledgerRows[0].amountCents).toBe(74_965);
    // cost of sold 5*10_000=50_000. realized = 74_965-50_000 = 24_965
    expect(out.realizedPnlCents).toBe(24_965);
  });

  it("rejects selling more than held (no shorting)", () => {
    const out = simulateFill({
      intent: { side: "sell", type: "market", qty: 5 },
      lastPriceCents: 15_000,
      ledger: fund, lots: [], config: cfg, now, newLotId: "x",
    });
    expect(out.status).toBe("rejected");
    expect(out.rejectReason).toMatch(/no shorting/);
  });
});

describe("commission model", () => {
  it("adds a separate commission ledger row when > 0", () => {
    const out = simulateFill({
      intent: { side: "buy", type: "market", qty: 1 },
      lastPriceCents: 10_000,
      ledger: fund, lots: [], config: { slippageBps: 0, commissionCents: 99 }, now, newLotId: "l",
    });
    expect(out.ledgerRows).toHaveLength(2);
    expect(out.ledgerRows[1].reason).toBe("commission");
    expect(out.ledgerRows[1].amountCents).toBe(-99);
  });
});

describe("limit & stop triggering", () => {
  it("buy limit does not fill above the limit price", () => {
    expect(fillPrice({ side: "buy", type: "limit", qty: 1, limitPriceCents: 9_000 }, 10_000, 5)).toBeNull();
  });
  it("buy limit fills at or below limit, never worse than limit", () => {
    const px = fillPrice({ side: "buy", type: "limit", qty: 1, limitPriceCents: 10_000 }, 9_800, 5);
    expect(px).toBe(9_805); // slipped 9_805 < limit 10_000 → pay slipped
  });
  it("sell stop triggers when market drops to/below stop", () => {
    expect(fillPrice({ side: "sell", type: "stop", qty: 1, stopPriceCents: 9_500 }, 9_400, 5)).toBe(9_395);
    expect(fillPrice({ side: "sell", type: "stop", qty: 1, stopPriceCents: 9_500 }, 9_600, 5)).toBeNull();
  });
});
