// Pure maths behind the motion design (no DOM), so behaviour can be unit-tested.
export type Verdict = "flag" | "read" | "skim";
export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
export const easeOutCubic = (t: number) => 1 - Math.pow(1 - clamp(t, 0, 1), 3);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** How many background nodes to draw for a viewport: scales with area, capped lower on weak devices. */
export function nodeCountFor(width: number, height: number, lowPower = false): number {
  const n = Math.round((width * height) / 52000);
  return clamp(n, 14, lowPower ? 24 : 46);
}

/** Spread n nodes over the verdicts in proportion to the brief (largest remainder; every present verdict gets at least one). */
export function allocateNodes(counts: Record<Verdict, number>, n: number): Verdict[] {
  const order: Verdict[] = ["flag", "read", "skim"];
  const total = order.reduce((s, v) => s + Math.max(0, counts[v]), 0);
  const weights = total > 0 ? order.map((v) => Math.max(0, counts[v]) / total) : [1 / 3, 1 / 3, 1 / 3];
  const raw = weights.map((w) => w * n);
  const base = raw.map((x, i) => (weights[i] > 0 ? Math.max(1, Math.floor(x)) : 0));
  let used = base.reduce((a, b) => a + b, 0);
  const rema = raw.map((x, i) => ({ i, r: x - Math.floor(x) })).sort((a, b) => b.r - a.r);
  for (let k = 0; used < n && rema.length; k = (k + 1) % rema.length) { if (weights[rema[k].i] > 0) { base[rema[k].i]++; used++; } }
  while (used > n) { const j = base.indexOf(Math.max(...base)); base[j]--; used--; }
  const out: Verdict[] = [];
  // interleave so colours are spread, not clumped
  const left = [...base];
  while (out.length < n) for (let i = 0; i < 3 && out.length < n; i++) if (left[i] > 0) { out.push(order[i]); left[i]--; }
  return out;
}

/** Soft push away from a point: zero at/after `radius`, strongest at the centre. Quadratic falloff. */
export function repel(dx: number, dy: number, radius: number, strength: number): { x: number; y: number } {
  const d = Math.hypot(dx, dy);
  if (d >= radius || d === 0) return { x: 0, y: 0 };
  const f = Math.pow(1 - d / radius, 2) * strength;
  return { x: (dx / d) * f, y: (dy / d) * f };
}

/** Bottom-sheet swipe: rubber-band when pulled up, follow the finger when pulled down. */
export const dragOffset = (dy: number) => (dy < 0 ? dy * 0.12 : dy);
/** Dismiss when dragged far enough, or flicked fast after a short pull (velocity in px/ms). */
export const shouldDismiss = (dy: number, velocity: number, distance = 110, flick = 0.6) => dy > distance || (dy > 30 && velocity > flick);

/** A flick only counts if the finger was still moving when it lifted: velocity expires after a short idle. */
export const releaseVelocity = (v: number, idleMs: number, maxIdleMs = 80) => (idleMs > maxIdleMs ? 0 : v);

/** Reading progress 0..1 through the page. */
export function scrollProgress(scrollY: number, docHeight: number, viewHeight: number): number {
  const max = Math.max(1, docHeight - viewHeight);
  return clamp(scrollY / max, 0, 1);
}

/** Orb position at time t (seconds): slow Lissajous wander around a base point, plus a gentle pull toward the pointer. */
export function orbPosition(base: { x: number; y: number }, amp: { x: number; y: number }, speed: number, phase: number, t: number, pull: { x: number; y: number }) {
  return { x: base.x + Math.sin(t * speed + phase) * amp.x + pull.x, y: base.y + Math.cos(t * speed * 0.8 + phase * 1.3) * amp.y + pull.y };
}

/** "#RRGGBB" or "#RGB" to rgba(). Falls back to transparent for anything else. */
export function rgba(color: string, alpha: number): string {
  const c = color.trim();
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(c);
  if (!m) return `rgba(0,0,0,0)`;
  const h = m[1].length === 3 ? m[1].split("").map((x) => x + x).join("") : m[1];
  const n = parseInt(h, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${clamp(alpha, 0, 1)})`;
}
