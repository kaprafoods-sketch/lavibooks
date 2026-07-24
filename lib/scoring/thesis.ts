import type { Cents } from "../money";

/**
 * Prediction/learning layer. When a position tied to a thesis is closed, score
 * the thesis: was the target hit within the horizon, and how did realized P&L
 * compare to predicted?
 */

export interface ThesisInput {
  side: "buy" | "sell"; // direction of the opening trade
  entryPriceCents: Cents;
  targetPriceCents: Cents | null;
  horizonDays: number | null;
  openedAt: string; // ISO
}

export interface CloseInput {
  exitPriceCents: Cents;
  closedAt: string; // ISO
  qty: number;
  realizedPnlCents: Cents;
}

export interface ThesisScore {
  targetHit: boolean | null; // null if no target set
  withinHorizon: boolean | null; // null if no horizon set
  predictedPnlCents: Cents | null; // (target - entry) * qty for a long
  realizedPnlCents: Cents;
  accuracyPct: number | null; // realized / predicted, capped display
  holdingDays: number;
}

function daysBetween(a: string, b: string): number {
  const ms = new Date(b).getTime() - new Date(a).getTime();
  return Math.max(0, ms / 86_400_000);
}

export function scoreThesis(t: ThesisInput, c: CloseInput): ThesisScore {
  const holdingDays = daysBetween(t.openedAt, c.closedAt);
  const withinHorizon =
    t.horizonDays == null ? null : holdingDays <= t.horizonDays;

  let targetHit: boolean | null = null;
  let predictedPnlCents: Cents | null = null;
  if (t.targetPriceCents != null) {
    // Long: hit if exit >= target. (v1 opens are long-only.)
    targetHit = c.exitPriceCents >= t.targetPriceCents;
    predictedPnlCents = Math.round((t.targetPriceCents - t.entryPriceCents) * c.qty);
  }

  const accuracyPct =
    predictedPnlCents != null && predictedPnlCents !== 0
      ? (c.realizedPnlCents / predictedPnlCents) * 100
      : null;

  return {
    targetHit,
    withinHorizon,
    predictedPnlCents,
    realizedPnlCents: c.realizedPnlCents,
    accuracyPct,
    holdingDays,
  };
}
