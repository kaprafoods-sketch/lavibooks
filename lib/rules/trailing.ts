import type { Cents } from "../money";

/**
 * Trailing high-water mark. Ratchets UP with new closes, NEVER down. The
 * effective trailing-stop level = hwm * (1 - pct/100).
 */
export function ratchetHwm(currentHwm: Cents | null, closeCents: Cents): Cents {
  if (currentHwm == null) return closeCents;
  return Math.max(currentHwm, closeCents);
}

export function trailingStopLevel(hwmCents: Cents, pct: number): Cents {
  return Math.round(hwmCents * (1 - pct / 100));
}
