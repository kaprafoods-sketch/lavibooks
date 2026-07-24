import { describe, it, expect } from "vitest";
import { allocateBlock } from "./allocation";

const sum = (a: { qty: number }[]) => a.reduce((s, x) => s + x.qty, 0);

describe("Phase 2 block allocation", () => {
  const targets = [
    { portfolioId: "a", weight: 100_000 },
    { portfolioId: "b", weight: 300_000 },
    { portfolioId: "c", weight: 100_000 },
  ];

  it("pro-rata splits by weight and sums exactly to the block", () => {
    const alloc = allocateBlock(100, targets, "pro_rata");
    expect(sum(alloc)).toBe(100);
    // weights 1:3:1 → 20/60/20
    expect(alloc.find((x) => x.portfolioId === "b")!.qty).toBe(60);
  });

  it("equal split with largest-remainder still sums exactly", () => {
    const alloc = allocateBlock(100, targets, "equal");
    expect(sum(alloc)).toBe(100);
    // 100/3 → 34,33,33 in some order
    expect(alloc.map((x) => x.qty).sort()).toEqual([33, 33, 34]);
  });

  it("custom weights", () => {
    const alloc = allocateBlock(
      10,
      [{ portfolioId: "a", weight: 1 }, { portfolioId: "b", weight: 1 }],
      "custom",
    );
    expect(alloc).toEqual([
      { portfolioId: "a", qty: 5 },
      { portfolioId: "b", qty: 5 },
    ]);
  });

  it("degenerate zero weights fall back to equal", () => {
    const alloc = allocateBlock(
      4,
      [{ portfolioId: "a", weight: 0 }, { portfolioId: "b", weight: 0 }],
      "pro_rata",
    );
    expect(sum(alloc)).toBe(4);
    expect(alloc).toEqual([
      { portfolioId: "a", qty: 2 },
      { portfolioId: "b", qty: 2 },
    ]);
  });
});
