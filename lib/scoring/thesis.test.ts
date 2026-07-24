import { describe, it, expect } from "vitest";
import { scoreThesis } from "./thesis";

describe("thesis scoring", () => {
  it("marks target hit and within horizon", () => {
    const s = scoreThesis(
      { side: "buy", entryPriceCents: 10_000, targetPriceCents: 12_000, horizonDays: 30, openedAt: "2025-01-01T00:00:00Z" },
      { exitPriceCents: 12_500, closedAt: "2025-01-20T00:00:00Z", qty: 10, realizedPnlCents: 25_000 },
    );
    expect(s.targetHit).toBe(true);
    expect(s.withinHorizon).toBe(true);
    expect(s.predictedPnlCents).toBe(20_000); // (12000-10000)*10
    expect(s.accuracyPct).toBeCloseTo(125, 5); // 25000/20000
    expect(s.holdingDays).toBeCloseTo(19, 5);
  });

  it("target missed when exit below target", () => {
    const s = scoreThesis(
      { side: "buy", entryPriceCents: 10_000, targetPriceCents: 12_000, horizonDays: 30, openedAt: "2025-01-01T00:00:00Z" },
      { exitPriceCents: 11_000, closedAt: "2025-01-10T00:00:00Z", qty: 10, realizedPnlCents: 10_000 },
    );
    expect(s.targetHit).toBe(false);
  });

  it("horizon exceeded", () => {
    const s = scoreThesis(
      { side: "buy", entryPriceCents: 10_000, targetPriceCents: 12_000, horizonDays: 5, openedAt: "2025-01-01T00:00:00Z" },
      { exitPriceCents: 12_500, closedAt: "2025-01-20T00:00:00Z", qty: 10, realizedPnlCents: 25_000 },
    );
    expect(s.withinHorizon).toBe(false);
  });

  it("null target/horizon yields null scores, still records realized", () => {
    const s = scoreThesis(
      { side: "buy", entryPriceCents: 10_000, targetPriceCents: null, horizonDays: null, openedAt: "2025-01-01T00:00:00Z" },
      { exitPriceCents: 11_000, closedAt: "2025-01-10T00:00:00Z", qty: 10, realizedPnlCents: 10_000 },
    );
    expect(s.targetHit).toBeNull();
    expect(s.withinHorizon).toBeNull();
    expect(s.realizedPnlCents).toBe(10_000);
  });
});
