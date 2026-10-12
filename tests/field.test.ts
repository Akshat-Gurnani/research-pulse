import { describe, it, expect } from "vitest";
import { Field, type Ctx2D, type FieldPalette } from "@/lib/field";
import type { Verdict } from "@/lib/motion";

// A deterministic RNG and a canvas stub that counts what is drawn.
const seeded = (seed = 7) => () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32; };
function stubCtx() {
  const calls: Record<string, number> = {};
  const hit = (k: string) => { calls[k] = (calls[k] ?? 0) + 1; };
  const ctx: Ctx2D = {
    clearRect: () => hit("clearRect"), fillRect: () => hit("fillRect"), beginPath: () => hit("beginPath"), arc: () => hit("arc"),
    moveTo: () => hit("moveTo"), lineTo: () => hit("lineTo"), stroke: () => hit("stroke"), fill: () => hit("fill"),
    createRadialGradient: () => { hit("gradient"); return { addColorStop: () => {} }; },
    fillStyle: "", strokeStyle: "", lineWidth: 1, globalCompositeOperation: "source-over",
  };
  return { ctx, calls };
}
const PAL: FieldPalette = {
  dark: true, line: "255,255,255", ring: "255,255,255",
  orbs: [{ c: "#3346FF", a: .32 }, { c: "#0B9E94", a: .26 }, { c: "#FF5A1F", a: .24 }, { c: "#9B2CFF", a: .26 }],
  dots: { flag: "#FF9F0A", read: "#0A84FF", skim: "#8E8E93" },
};
const COUNTS = { flag: 4, read: 8, skim: 5 };
const make = (w = 1440, h = 900, rng = seeded()) => { const s = stubCtx(); const f = new Field(s.ctx, PAL, rng); f.resize(w, h, COUNTS); return { f, ...s }; };
const run = (f: Field, secs: number, focus: Verdict | null = null) => { for (let i = 0; i < secs * 60; i++) f.step(1 / 60, focus); };
const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);

describe("Field", () => {
  it("creates nodes in proportion to the brief and draws every node, four orbs and the links", () => {
    const { f, calls } = make();
    expect(f.nodes).toHaveLength(25);                       // 1440x900 viewport
    const by = (v: Verdict) => f.nodes.filter((n) => n.v === v).length;
    expect(by("flag") / 25).toBeCloseTo(4 / 17, 0);
    expect(by("read")).toBeGreaterThan(by("flag"));
    f.frame(1 / 60, null);
    expect(calls.gradient).toBe(4);                         // four orbs
    expect(calls.fillRect).toBe(4);
    expect(calls.arc).toBeGreaterThanOrEqual(25 * 2);       // glow + core per node
    expect(calls.clearRect).toBe(1);
  });

  it("wraps a node that leaves the screen to the opposite side, on both axes", () => {
    const { f } = make(800, 600);
    const [a, b, c, d] = f.nodes;
    Object.assign(a, { x: 819, y: 300, vx: 12, vy: 0 });     // leaves right
    Object.assign(b, { x: -19, y: 300, vx: -12, vy: 0 });    // leaves left
    Object.assign(c, { x: 400, y: 619, vx: 0, vy: 12 });     // leaves bottom
    Object.assign(d, { x: 400, y: -19, vx: 0, vy: -12 });    // leaves top
    f.step(1 / 60, null);
    expect(a.x).toBe(-20); expect(b.x).toBe(820); expect(c.y).toBe(-20); expect(d.y).toBe(620);
  });

  it("stays finite and bounded over a long run", () => {
    const { f } = make(800, 600);
    run(f, 40);
    for (const n of f.nodes) { expect(Math.abs(n.x)).toBeLessThanOrEqual(821); expect(Math.abs(n.y)).toBeLessThanOrEqual(621); expect(Number.isFinite(n.vx + n.vy)).toBe(true); }
  });

  it("nodes drift away from the pointer", () => {
    const a = make(1000, 800, seeded(3)), b = make(1000, 800, seeded(3));
    const spot = { x: a.f.nodes[0].x + 12, y: a.f.nodes[0].y + 8 };
    for (let i = 0; i < 90; i++) { a.f.setPointer(spot.x, spot.y); a.f.step(1 / 60, null); b.f.step(1 / 60, null); }   // identical step counts
    expect(dist(a.f.nodes[0], spot)).toBeGreaterThan(dist(b.f.nodes[0], spot) + 1);
    // a node far from the pointer is unaffected
    const far = a.f.nodes.findIndex((n, i) => i > 0 && dist(n, spot) > 400);
    if (far > 0) expect(dist(a.f.nodes[far], b.f.nodes[far])).toBeLessThan(0.001);
  });

  it("a click sends a ripple wave that pushes nodes beyond what the pointer alone does, then expires", () => {
    const withRipple = make(1000, 800, seeded(5)), pointerOnly = make(1000, 800, seeded(5));
    const c = withRipple.f.nodes[0];
    const at = { x: c.x - 100, y: c.y };                       // the wave front reaches this node at about 0.4 s
    withRipple.f.ripple(at.x, at.y);                           // click: ripple + pointer
    pointerOnly.f.setPointer(at.x, at.y);                      // same pointer, no ripple
    expect(withRipple.f.rippleCount).toBe(1);
    run(withRipple.f, 0.8); run(pointerOnly.f, 0.8);
    expect(dist(withRipple.f.nodes[0], pointerOnly.f.nodes[0])).toBeGreaterThan(0.3);
    run(withRipple.f, 2);
    expect(withRipple.f.rippleCount).toBe(0);                  // expired
  });

  it("caps simultaneous ripples", () => {
    const { f } = make();
    for (let i = 0; i < 12; i++) f.ripple(100 + i, 100);
    expect(f.rippleCount).toBe(4);
  });

  it("focusing a verdict makes its nodes glow and dims the rest, then relaxes", () => {
    const { f } = make();
    run(f, 2, "flag");
    for (const n of f.nodes) { if (n.v === "flag") expect(n.glow).toBeGreaterThan(0.9); else expect(n.glow).toBeLessThan(-0.9); }
    run(f, 3, null);
    for (const n of f.nodes) expect(Math.abs(n.glow)).toBeLessThan(0.05);
  });

  it("snapFocus applies the focus instantly for the static (reduced-motion) render", () => {
    const { f } = make();
    f.snapFocus("read");
    expect(f.nodes.filter((n) => n.v === "read").every((n) => n.glow === 1)).toBe(true);
    expect(f.nodes.filter((n) => n.v !== "read").every((n) => n.glow === -1)).toBe(true);
  });

  it("parallax shifts where nodes are drawn without moving them", () => {
    const a = make(1000, 800, seeded(9)), b = make(1000, 800, seeded(9));
    b.f.setScroll(600);
    a.f.render(); b.f.render();
    expect(b.f.nodes[0].y).toBe(a.f.nodes[0].y);
  });

  it("one frame is cheap: well inside a 60 fps budget even at 4K", () => {
    const { f } = make(3840, 2160, seeded(11));
    expect(f.nodes).toHaveLength(46);
    f.frame(1 / 60, null);
    const t0 = performance.now();
    for (let i = 0; i < 300; i++) f.frame(1 / 60, i % 2 ? "flag" : null);
    const perFrame = (performance.now() - t0) / 300;
    expect(perFrame).toBeLessThan(3);   // ms of JS per frame; the 16.7 ms budget leaves the rest for rasterising
  });

  it("an empty brief still renders a calm field", () => {
    const s = stubCtx(); const f = new Field(s.ctx, PAL, seeded());
    f.resize(1024, 768, { flag: 0, read: 0, skim: 0 });
    expect(f.nodes.length).toBeGreaterThan(0);
    expect(() => f.frame(1 / 60, null)).not.toThrow();
  });
});
