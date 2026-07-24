/**
 * Money primitives. All monetary values are integer cents (bigint-safe range
 * kept in `number` for ergonomics, but ALWAYS whole cents — never floats of
 * dollars). Quantities are decimals with up to 8 places of scale.
 *
 * Rule: never do arithmetic on dollar floats. Convert to cents at the edge.
 */

export type Cents = number; // integer cents
export type Qty = number; // shares, up to 8dp

/** Dollars (possibly fractional) → integer cents, rounded half-up. */
export function toCents(dollars: number): Cents {
  return Math.round(dollars * 100);
}

/** Integer cents → dollars number (for display only). */
export function toDollars(cents: Cents): number {
  return cents / 100;
}

/** Format cents as a $ string with tabular thousands. */
export function fmtCents(cents: Cents): string {
  const neg = cents < 0;
  const abs = Math.abs(cents);
  const dollars = Math.floor(abs / 100);
  const rem = abs % 100;
  const withCommas = dollars.toLocaleString("en-US");
  return `${neg ? "-" : ""}$${withCommas}.${rem.toString().padStart(2, "0")}`;
}

/**
 * Value of a quantity at a per-share price (both in cents), rounded to whole
 * cents half-up. Used for notional, fills, position value.
 */
export function notionalCents(qty: Qty, pricePerShareCents: Cents): Cents {
  return Math.round(qty * pricePerShareCents);
}

/**
 * Apply slippage in basis points to a price. Buys pay up, sells receive less —
 * slippage always works against the trader.
 */
export function priceWithSlippage(
  lastPriceCents: Cents,
  side: "buy" | "sell",
  slippageBps: number,
): Cents {
  const factor = slippageBps / 10_000;
  const adj = side === "buy" ? 1 + factor : 1 - factor;
  return Math.round(lastPriceCents * adj);
}
