import type { Cents, Qty } from "../money";
import { notionalCents } from "../money";
import type { Lot } from "../types";

/**
 * FIFO cost-basis engine. Buys open lots; sells consume the oldest lots first.
 * Realized P&L is computed against consumed lot cost. Display cost is the
 * quantity-weighted average across open lots.
 */

export interface ConsumeResult {
  /** Updated lots (fully-consumed lots removed, partials reduced). */
  remainingLots: Lot[];
  /** Realized P&L in cents for this sell (proceeds - cost of consumed qty). */
  realizedPnlCents: Cents;
  /** Cost basis (cents) of the consumed quantity. */
  costOfSoldCents: Cents;
}

/**
 * Consume `qty` shares FIFO at sale price `salePriceCents` (per share).
 * Throws if there are not enough open shares (no shorting in v1).
 */
export function consumeFIFO(
  lots: Lot[],
  qty: Qty,
  salePriceCents: Cents,
): ConsumeResult {
  const totalOpen = lots.reduce((a, l) => a + l.qtyOpen, 0);
  if (qty > totalOpen + 1e-9) {
    throw new Error(
      `Cannot sell ${qty}: only ${totalOpen} shares open (no shorting in v1)`,
    );
  }

  // Oldest first.
  const ordered = [...lots].sort((a, b) => a.openedAt.localeCompare(b.openedAt));
  let toSell = qty;
  let costOfSold = 0;
  const remaining: Lot[] = [];

  for (const lot of ordered) {
    if (toSell <= 1e-9) {
      remaining.push(lot);
      continue;
    }
    const take = Math.min(lot.qtyOpen, toSell);
    costOfSold += notionalCents(take, lot.costCents);
    toSell -= take;
    const left = lot.qtyOpen - take;
    if (left > 1e-9) {
      remaining.push({ ...lot, qtyOpen: left });
    }
    // else lot fully consumed → dropped
  }

  const proceeds = notionalCents(qty, salePriceCents);
  return {
    remainingLots: remaining,
    realizedPnlCents: proceeds - costOfSold,
    costOfSoldCents: costOfSold,
  };
}

/** Quantity-weighted average cost (cents/share) across open lots, for display. */
export function weightedAvgCostCents(lots: Lot[]): Cents {
  const qty = lots.reduce((a, l) => a + l.qtyOpen, 0);
  if (qty <= 1e-9) return 0;
  const totalCost = lots.reduce((a, l) => a + notionalCents(l.qtyOpen, l.costCents), 0);
  return Math.round(totalCost / qty);
}

/** Total open quantity across lots. */
export function openQty(lots: Lot[]): Qty {
  return lots.reduce((a, l) => a + l.qtyOpen, 0);
}

/**
 * Unrealized P&L (cents) at a mark price = (mark - avgCost) * openQty, but
 * computed per-lot to avoid rounding drift.
 */
export function unrealizedPnlCents(lots: Lot[], markCents: Cents): Cents {
  return lots.reduce(
    (a, l) => a + (notionalCents(l.qtyOpen, markCents) - notionalCents(l.qtyOpen, l.costCents)),
    0,
  );
}
