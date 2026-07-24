import { describe, it, expect } from "vitest";
import { stopFill, limitFills, marketFill } from "./fill";
import type { Bar } from "../types";

const bar = (o: number, h: number, l: number, c: number): Bar => ({
  d: "2025-06-02", openCents: o, highCents: h, lowCents: l, closeCents: c, volume: 1000,
});

describe("gap handling — a stop is a trigger, not a price", () => {
  it("sell-stop that gaps down fills at the OPEN, not the stop, and records gap slippage", () => {
    // Stop 17840. Prev close was above; today opens at 17000 (gapped through).
    const r = stopFill("sell", bar(17000, 17200, 16800, 17100), 17840, 5);
    // Fill at open 17000 with slippage, gap slippage = 17840 - 17000 = 840
    expect(r.gapSlippageCents).toBe(840);
    expect(r.priceCents).toBe(16992); // 17000 * (1 - 0.0005) = 16991.5 → 16992
  });

  it("no gap — sell-stop fills at close with slippage, zero gap slippage", () => {
    // Opens above the stop (18000), drifts to close 17800 which is below stop 17840.
    const r = stopFill("sell", bar(18000, 18050, 17750, 17800), 17840, 5);
    expect(r.gapSlippageCents).toBe(0);
    expect(r.priceCents).toBe(17791); // 17800 * (1 - 0.0005)
  });

  it("buy-stop that gaps up fills at the open", () => {
    const r = stopFill("buy", bar(22500, 22600, 22400, 22550), 22000, 5);
    expect(r.gapSlippageCents).toBe(500);
    expect(r.priceCents).toBe(22511); // 22500 * (1 + 0.0005)
  });
});

describe("limit fills require trading through the limit", () => {
  it("buy limit fills only if the bar low reaches it", () => {
    expect(limitFills("buy", bar(100, 110, 95, 105), 96)).toBe(true);
    expect(limitFills("buy", bar(100, 110, 98, 105), 96)).toBe(false);
  });
  it("sell limit fills only if the bar high reaches it", () => {
    expect(limitFills("sell", bar(100, 110, 95, 105), 108)).toBe(true);
    expect(limitFills("sell", bar(100, 106, 95, 105), 108)).toBe(false);
  });
});

describe("market fill", () => {
  it("applies slippage against the side", () => {
    expect(marketFill("buy", 10000, 5).priceCents).toBe(10005);
    expect(marketFill("sell", 10000, 5).priceCents).toBe(9995);
  });
});
