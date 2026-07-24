import type { BracketParams, RuleStatus } from "./types";

/**
 * OCO (one-cancels-the-other) bookkeeping — pure. A bracket materializes as two
 * legs sharing an oco_group_id: a take_profit leg and a stop_loss leg. When one
 * fills, the sibling must transition to `cancelled` in the SAME transaction so no
 * orphan order can survive.
 */

export interface OcoLeg {
  ruleId: string;
  kind: "take_profit" | "stop_loss";
  status: RuleStatus;
}

/** Expand a bracket into its two child legs' params. */
export function expandBracket(p: BracketParams): {
  takeProfit: { qty: number; trigger: BracketParams["take_profit"] };
  stopLoss: { qty: number; trigger: BracketParams["stop_loss"] };
} {
  return {
    takeProfit: { qty: p.qty, trigger: p.take_profit },
    stopLoss: { qty: p.qty, trigger: p.stop_loss },
  };
}

/**
 * Given the two legs and which one just filled, return the status transitions to
 * apply. The filled leg → completed; the sibling → cancelled. Exactly one order
 * results; never an orphan.
 */
export function resolveOco(
  legs: OcoLeg[], filledRuleId: string,
): { ruleId: string; status: RuleStatus }[] {
  return legs.map((l) => ({
    ruleId: l.ruleId,
    status: (l.ruleId === filledRuleId ? "completed" : "cancelled") as RuleStatus,
  }));
}

/**
 * Idempotency key for a trigger. The worker inserts a rule_event with a UNIQUE
 * (rule_id, trigger_bar_ts, 'triggered') constraint; the same tick re-run
 * produces the same key and the insert no-ops.
 */
export function triggerKey(ruleId: string, triggerBarTs: string): string {
  return `${ruleId}::${triggerBarTs}`;
}

/**
 * In-memory guard mirroring the DB UNIQUE constraint — used by the worker to
 * skip a rule already triggered for this bar within a single batch, and by tests
 * to prove a duplicate tick does not double-fire.
 */
export class FireGuard {
  private fired = new Set<string>();
  tryFire(ruleId: string, triggerBarTs: string): boolean {
    const k = triggerKey(ruleId, triggerBarTs);
    if (this.fired.has(k)) return false; // duplicate — already fired this bar
    this.fired.add(k);
    return true;
  }
}
