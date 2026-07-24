import { describe, it, expect } from "vitest";
import { checkRails, breachesDailyLoss, type AutomationSettings, type RailContext } from "./safety";

const settings = (over: Partial<AutomationSettings> = {}): AutomationSettings => ({
  automationEnabled: true, maxDailyLossCents: 500_000, maxOpenPositions: 10,
  maxPositionPct: 25, maxAutomatedOrdersPerDay: 20, dailyLossBreached: false, ...over,
});
const ctx = (over: Partial<RailContext> = {}): RailContext => ({
  side: "buy", qty: 10, fillPriceCents: 10_000, cashCents: 10_000_000, equityCents: 10_000_000,
  openPositionsCount: 1, isNewPosition: true, automatedOrdersToday: 0, priceAgeMs: 1000, ...over,
});

describe("safety rails — fail closed", () => {
  it("kill switch blocks everything", () => {
    expect(checkRails(settings({ automationEnabled: false }), ctx()).ok).toBe(false);
  });

  it("daily-loss breach blocks subsequent orders", () => {
    const r = checkRails(settings({ dailyLossBreached: true }), ctx());
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/max daily loss/);
  });

  it("stale price (>15 min) blocks rather than fills", () => {
    const r = checkRails(settings(), ctx({ priceAgeMs: 16 * 60 * 1000 }));
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/stale price/);
  });

  it("insufficient buying power rejects cleanly", () => {
    const r = checkRails(settings(), ctx({ cashCents: 50_000, qty: 100, fillPriceCents: 10_000 }));
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/buying power/);
  });

  it("max open positions blocks a new position", () => {
    const r = checkRails(settings({ maxOpenPositions: 3 }), ctx({ openPositionsCount: 3, isNewPosition: true }));
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/max open positions/);
  });

  it("position size cap blocks oversized buys", () => {
    // notional 100 * 10_000 = 1_000_000 on equity 2_000_000 = 50% > 25% cap
    const r = checkRails(settings({ maxPositionPct: 25 }), ctx({ qty: 100, equityCents: 2_000_000 }));
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/position size/);
  });

  it("max automated orders/day blocks once reached", () => {
    const r = checkRails(settings({ maxAutomatedOrdersPerDay: 5 }), ctx({ automatedOrdersToday: 5 }));
    expect(r.ok).toBe(false);
  });

  it("passes a clean buy within all rails", () => {
    expect(checkRails(settings(), ctx({ qty: 10, fillPriceCents: 10_000 })).ok).toBe(true);
  });
});

describe("daily-loss breach detection", () => {
  it("breaches when session P&L ≤ -maxDailyLoss", () => {
    expect(breachesDailyLoss(-500_000, 500_000)).toBe(true);
    expect(breachesDailyLoss(-499_999, 500_000)).toBe(false);
    expect(breachesDailyLoss(-9_999_999, null)).toBe(false); // no cap set
  });
});
