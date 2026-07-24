import type { Cents } from "../money";
import type { CashLedgerRow } from "../types";

/**
 * Cash balance is DERIVED from the ledger — never stored as a mutable column.
 * Balance = sum of every signed ledger amount for the portfolio.
 */
export function deriveBalanceCents(rows: CashLedgerRow[]): Cents {
  return rows.reduce((acc, r) => acc + r.amountCents, 0);
}

/**
 * Buying power for a paper-cash account with no margin = current cash balance.
 * (No shorting/margin in v1.)
 */
export function buyingPowerCents(rows: CashLedgerRow[]): Cents {
  return deriveBalanceCents(rows);
}

/**
 * Total cost of a buy = notional + commission. Returns whether the account can
 * afford it and the shortfall (0 if affordable).
 */
export function checkBuyingPower(
  balanceCents: Cents,
  notionalCents: Cents,
  commissionCents: Cents,
): { ok: boolean; requiredCents: Cents; shortfallCents: Cents } {
  const required = notionalCents + commissionCents;
  const shortfall = Math.max(0, required - balanceCents);
  return { ok: shortfall === 0, requiredCents: required, shortfallCents: shortfall };
}
