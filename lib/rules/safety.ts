import type { Cents, Qty } from "../money";
import { notionalCents } from "../money";
import { checkBuyingPower } from "../engine/ledger";

/**
 * PURE safety rails, enforced before any automated order is placed. Every
 * failure returns a machine-readable block reason — nothing is silent, and rules
 * ALWAYS fail closed.
 */

export interface AutomationSettings {
  automationEnabled: boolean; // global kill switch
  maxDailyLossCents: Cents | null;
  maxOpenPositions: number | null;
  maxPositionPct: number | null; // % of equity
  maxAutomatedOrdersPerDay: number | null;
  dailyLossBreached: boolean;
}

export interface RailContext {
  side: "buy" | "sell";
  qty: Qty;
  fillPriceCents: Cents;
  cashCents: Cents;
  equityCents: Cents;
  openPositionsCount: number; // distinct instruments held
  isNewPosition: boolean; // buy that opens a not-yet-held instrument
  automatedOrdersToday: number;
  priceAgeMs: number; // age of the quote used
}

export interface RailResult {
  ok: boolean;
  reason: string;
}

const STALE_LIMIT_MS = 15 * 60 * 1000; // 15 minutes

export function checkRails(s: AutomationSettings, c: RailContext): RailResult {
  if (!s.automationEnabled) return { ok: false, reason: "kill switch active — automation disabled" };
  if (s.dailyLossBreached) return { ok: false, reason: "max daily loss breached — rules disarmed for the session" };
  if (c.priceAgeMs > STALE_LIMIT_MS) return { ok: false, reason: `stale price (${Math.round(c.priceAgeMs / 60000)} min old) — blocked` };

  if (s.maxAutomatedOrdersPerDay != null && c.automatedOrdersToday >= s.maxAutomatedOrdersPerDay) {
    return { ok: false, reason: `max automated orders/day (${s.maxAutomatedOrdersPerDay}) reached` };
  }

  if (c.side === "buy") {
    const notional = notionalCents(c.qty, c.fillPriceCents);
    const bp = checkBuyingPower(c.cashCents, notional, 0);
    if (!bp.ok) return { ok: false, reason: `insufficient buying power (short ${bp.shortfallCents}¢)` };

    if (s.maxOpenPositions != null && c.isNewPosition && c.openPositionsCount >= s.maxOpenPositions) {
      return { ok: false, reason: `max open positions (${s.maxOpenPositions}) reached` };
    }
    if (s.maxPositionPct != null && c.equityCents > 0) {
      const pct = (notional / c.equityCents) * 100;
      if (pct > s.maxPositionPct) return { ok: false, reason: `position size ${pct.toFixed(1)}% exceeds cap ${s.maxPositionPct}%` };
    }
  }

  return { ok: true, reason: "rails passed" };
}

/** Would realizing `sessionPnlCents` breach the max-daily-loss rail? */
export function breachesDailyLoss(sessionPnlCents: Cents, maxDailyLossCents: Cents | null): boolean {
  if (maxDailyLossCents == null) return false;
  return sessionPnlCents <= -Math.abs(maxDailyLossCents);
}
