import { describe, it, expect } from "vitest";
import { deriveBalanceCents, buyingPowerCents, checkBuyingPower } from "./ledger";
import type { CashLedgerRow } from "../types";

describe("cash ledger — derived balance", () => {
  it("balance is the sum of signed rows, never a stored column", () => {
    const rows: CashLedgerRow[] = [
      { amountCents: 10_000_000, reason: "deposit" }, // $100k
      { amountCents: -1_500_000, reason: "buy" },
      { amountCents: 620_000, reason: "sell" },
      { amountCents: -100, reason: "commission" },
    ];
    expect(deriveBalanceCents(rows)).toBe(9_119_900);
    expect(buyingPowerCents(rows)).toBe(9_119_900);
  });

  it("empty ledger is zero", () => {
    expect(deriveBalanceCents([])).toBe(0);
  });
});

describe("buying power check", () => {
  it("passes when balance covers notional + commission", () => {
    const r = checkBuyingPower(1_000_000, 999_900, 100);
    expect(r.ok).toBe(true);
    expect(r.shortfallCents).toBe(0);
  });

  it("rejects and reports shortfall when short", () => {
    const r = checkBuyingPower(1_000_000, 1_000_000, 100);
    expect(r.ok).toBe(false);
    expect(r.shortfallCents).toBe(100);
    expect(r.requiredCents).toBe(1_000_100);
  });
});
