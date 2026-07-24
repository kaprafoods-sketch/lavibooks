import { describe, it, expect } from "vitest";
import { resolveOco, FireGuard, expandBracket, type OcoLeg } from "./oco";

describe("bracket OCO — one leg fills, sibling cancels, no orphan", () => {
  const legs: OcoLeg[] = [
    { ruleId: "tp", kind: "take_profit", status: "armed" },
    { ruleId: "sl", kind: "stop_loss", status: "armed" },
  ];

  it("take-profit fills → stop-loss cancelled", () => {
    const out = resolveOco(legs, "tp");
    expect(out).toEqual([
      { ruleId: "tp", status: "completed" },
      { ruleId: "sl", status: "cancelled" },
    ]);
    // Exactly one leg completed, no leg left armed.
    expect(out.filter((o) => o.status === "completed")).toHaveLength(1);
    expect(out.filter((o) => o.status === "armed")).toHaveLength(0);
  });

  it("stop-loss fills → take-profit cancelled (reverse)", () => {
    const out = resolveOco(legs, "sl");
    expect(out.find((o) => o.ruleId === "sl")!.status).toBe("completed");
    expect(out.find((o) => o.ruleId === "tp")!.status).toBe("cancelled");
  });

  it("bracket expands into two legs with the same qty", () => {
    const { takeProfit, stopLoss } = expandBracket({
      qty: 40,
      take_profit: { mode: "absolute", price_cents: 25000 },
      stop_loss: { mode: "pct_below_entry", pct: 5 },
    });
    expect(takeProfit.qty).toBe(40);
    expect(stopLoss.qty).toBe(40);
    expect(takeProfit.trigger).toEqual({ mode: "absolute", price_cents: 25000 });
  });
});

describe("idempotency — a duplicate cron tick does not double-fire", () => {
  it("second fire for the same (rule, bar) is rejected", () => {
    const g = new FireGuard();
    expect(g.tryFire("rule1", "2025-06-02T20:00:00Z")).toBe(true); // first tick
    expect(g.tryFire("rule1", "2025-06-02T20:00:00Z")).toBe(false); // duplicate tick
    // A new bar is allowed.
    expect(g.tryFire("rule1", "2025-06-03T20:00:00Z")).toBe(true);
    // A different rule on the same bar is allowed.
    expect(g.tryFire("rule2", "2025-06-02T20:00:00Z")).toBe(true);
  });
});
