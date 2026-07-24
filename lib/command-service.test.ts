import { describe, it, expect } from "vitest";
import { realizedPnlByInstrument } from "./command-service";

/**
 * FIFO realized P&L — the money path behind "Realized P&L to date" and the
 * attribution panel. Prices are cents; results must be exact integer cents.
 */
describe("realizedPnlByInstrument", () => {
  const t = (instrument_id: string, side: "buy" | "sell", qty: number, price_cents: number, filled_at: string) =>
    ({ instrument_id, side, qty, price_cents, filled_at });

  it("returns no realized P&L for an open position (buys only)", () => {
    const m = realizedPnlByInstrument([t("A", "buy", 10, 10000, "2026-01-01")]);
    expect(m.get("A")).toBe(0);
  });

  it("realizes a simple round-trip gain", () => {
    // Buy 10 @ $100, sell 10 @ $110 → +$100.00 = 10000 cents.
    const m = realizedPnlByInstrument([
      t("A", "buy", 10, 10000, "2026-01-01"),
      t("A", "sell", 10, 11000, "2026-02-01"),
    ]);
    expect(m.get("A")).toBe(10000);
  });

  it("pairs sells FIFO against the oldest lots", () => {
    // Buy 10 @ $100, buy 10 @ $120, sell 15 @ $130.
    // FIFO: 10 @100 → +$300; 5 @120 → +$50 ⇒ total +$350 = 35000 cents.
    const m = realizedPnlByInstrument([
      t("A", "buy", 10, 10000, "2026-01-01"),
      t("A", "buy", 10, 12000, "2026-01-02"),
      t("A", "sell", 15, 13000, "2026-01-03"),
    ]);
    expect(m.get("A")).toBe(35000);
  });

  it("realizes a loss and keeps instruments independent", () => {
    const m = realizedPnlByInstrument([
      t("A", "buy", 5, 20000, "2026-01-01"),
      t("A", "sell", 5, 18000, "2026-01-02"), // -$100.00
      t("B", "buy", 1, 5000, "2026-01-01"),
      t("B", "sell", 1, 5500, "2026-01-02"), // +$5.00
    ]);
    expect(m.get("A")).toBe(-10000);
    expect(m.get("B")).toBe(500);
  });

  it("ignores order of a sell arriving before its matching buy (sorts by fill time)", () => {
    const m = realizedPnlByInstrument([
      t("A", "sell", 10, 11000, "2026-02-01"),
      t("A", "buy", 10, 10000, "2026-01-01"),
    ]);
    expect(m.get("A")).toBe(10000);
  });
});
