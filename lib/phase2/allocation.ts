import type { Qty } from "../money";

/**
 * PHASE 2 (schema + interface only, no UI). A single block order is allocated
 * across N client portfolios. Average-price allocation: all client fills share
 * the block's average execution price; only the quantity split differs.
 *
 * Methods: pro-rata (by portfolio weight/AUM), equal, or custom weights.
 * Whole-share allocation with largest-remainder rounding so the parts sum
 * exactly to the block quantity.
 */

export type AllocationMethod = "pro_rata" | "equal" | "custom";

export interface AllocationTarget {
  portfolioId: string;
  weight: number; // AUM (pro-rata) or explicit weight (custom); ignored for equal
}

export interface Allocation {
  portfolioId: string;
  qty: Qty;
}

export function allocateBlock(
  totalQty: Qty,
  targets: AllocationTarget[],
  method: AllocationMethod,
): Allocation[] {
  if (targets.length === 0) return [];
  const n = targets.length;

  const weights =
    method === "equal"
      ? targets.map(() => 1)
      : targets.map((t) => Math.max(0, t.weight));
  const totalWeight = weights.reduce((a, w) => a + w, 0);
  if (totalWeight <= 0) {
    // Degenerate weights → fall back to equal.
    return allocateBlock(totalQty, targets, "equal");
  }

  // Ideal fractional shares, then largest-remainder rounding to whole shares.
  const ideal = weights.map((w) => (w / totalWeight) * totalQty);
  const floors = ideal.map((x) => Math.floor(x));
  let remaining = totalQty - floors.reduce((a, x) => a + x, 0);

  const order = ideal
    .map((x, i) => ({ i, frac: x - Math.floor(x) }))
    .sort((a, b) => b.frac - a.frac);

  const qtys = [...floors];
  for (let k = 0; k < order.length && remaining > 0; k++) {
    qtys[order[k].i] += 1;
    remaining -= 1;
  }

  return targets.map((t, i) => ({ portfolioId: t.portfolioId, qty: qtys[i] }));
}
