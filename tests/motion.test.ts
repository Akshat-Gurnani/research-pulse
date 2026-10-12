import { describe, it, expect } from "vitest";
import { allocateNodes, nodeCountFor, repel, shouldDismiss, dragOffset, scrollProgress, easeOutCubic, rgba, orbPosition, clamp } from "@/lib/motion";

describe("nodeCountFor", () => {
  it("scales with the viewport and is capped", () => {
    expect(nodeCountFor(375, 812)).toBe(14);                 // phone: floor
    expect(nodeCountFor(1440, 900)).toBe(25);
    expect(nodeCountFor(3840, 2160)).toBe(46);               // 4K: cap
    expect(nodeCountFor(3840, 2160, true)).toBe(24);         // weak device: lower cap
  });
});

describe("allocateNodes", () => {
  const sum = (a: string[], v: string) => a.filter((x) => x === v).length;
  it("always returns exactly n nodes, in proportion to the brief", () => {
    const a = allocateNodes({ flag: 4, read: 8, skim: 5 }, 34);
    expect(a).toHaveLength(34);
    expect(sum(a, "flag")).toBe(8); expect(sum(a, "read")).toBe(16); expect(sum(a, "skim")).toBe(10);
  });
  it("gives every present verdict at least one node, even when tiny", () => {
    const a = allocateNodes({ flag: 1, read: 200, skim: 1 }, 14);
    expect(a).toHaveLength(14);
    expect(sum(a, "flag")).toBeGreaterThanOrEqual(1); expect(sum(a, "skim")).toBeGreaterThanOrEqual(1);
  });
  it("omits verdicts that have no papers and handles an empty brief", () => {
    const only = allocateNodes({ flag: 0, read: 5, skim: 0 }, 20);
    expect(only.every((v) => v === "read")).toBe(true);
    const none = allocateNodes({ flag: 0, read: 0, skim: 0 }, 15);
    expect(none).toHaveLength(15);
    expect(new Set(none).size).toBe(3);
  });
  it("spreads colours instead of clumping them", () => {
    const a = allocateNodes({ flag: 4, read: 4, skim: 4 }, 12);
    expect(a.slice(0, 3).sort()).toEqual(["flag", "read", "skim"]);
  });
});

describe("repel", () => {
  it("pushes away from the pointer, strongest close in, nothing outside the radius", () => {
    const near = repel(10, 0, 100, 5), far = repel(90, 0, 100, 5);
    expect(near.x).toBeGreaterThan(far.x);
    expect(near.y).toBe(0);
    expect(repel(100, 0, 100, 5)).toEqual({ x: 0, y: 0 });
    expect(repel(0, 0, 100, 5)).toEqual({ x: 0, y: 0 });
    expect(repel(-10, 0, 100, 5).x).toBeLessThan(0);
  });
});

describe("sheet swipe", () => {
  it("dismisses on a long pull or a fast flick, not on a small slow one", () => {
    expect(shouldDismiss(150, 0.1)).toBe(true);
    expect(shouldDismiss(60, 0.9)).toBe(true);
    expect(shouldDismiss(60, 0.2)).toBe(false);
    expect(shouldDismiss(10, 5)).toBe(false);
  });
  it("rubber-bands upward pulls and follows downward ones", () => {
    expect(dragOffset(80)).toBe(80);
    expect(dragOffset(-100)).toBeCloseTo(-12, 5);
  });
});

describe("misc maths", () => {
  it("scrollProgress is clamped and safe on short pages", () => {
    expect(scrollProgress(0, 3000, 800)).toBe(0);
    expect(scrollProgress(1100, 3000, 800)).toBeCloseTo(0.5, 5);
    expect(scrollProgress(9999, 3000, 800)).toBe(1);
    expect(scrollProgress(10, 500, 800)).toBe(1);             // page shorter than the viewport: no NaN
  });
  it("easeOutCubic runs 0..1 and clamps", () => { expect(easeOutCubic(0)).toBe(0); expect(easeOutCubic(1)).toBe(1); expect(easeOutCubic(2)).toBe(1); expect(easeOutCubic(0.5)).toBeGreaterThan(0.5); });
  it("rgba parses hex and refuses garbage", () => {
    expect(rgba("#FF9F0A", 0.5)).toBe("rgba(255,159,10,0.5)");
    expect(rgba("#0af", 1)).toBe("rgba(0,170,255,1)");
    expect(rgba("var(--x)", 1)).toBe("rgba(0,0,0,0)");
    expect(rgba("#000", 7)).toBe("rgba(0,0,0,1)");
  });
  it("orbs wander but stay within their amplitude of the base", () => {
    for (let t = 0; t < 60; t += 3) {
      const p = orbPosition({ x: 100, y: 200 }, { x: 40, y: 30 }, 0.2, 1.2, t, { x: 0, y: 0 });
      expect(Math.abs(p.x - 100)).toBeLessThanOrEqual(40.001); expect(Math.abs(p.y - 200)).toBeLessThanOrEqual(30.001);
    }
  });
  it("clamp", () => { expect(clamp(5, 0, 3)).toBe(3); expect(clamp(-1, 0, 3)).toBe(0); });
});
