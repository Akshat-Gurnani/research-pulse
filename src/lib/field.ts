// The "knowledge field" simulation behind the animated background. Framework-free so it can be tested without a browser.
import { allocateNodes, clamp, easeOutCubic, lerp, nodeCountFor, orbPosition, repel, rgba, type Verdict } from "./motion";

export interface FieldPalette {
  dark: boolean;
  orbs: { c: string; a: number }[];          // four colour orbs (hex + alpha)
  dots: Record<Verdict, string>;             // node colour per verdict (hex)
  line: string;                              // "r,g,b" for links
  ring: string;                              // "r,g,b" for ripples
}
export interface Ctx2D {
  clearRect(x: number, y: number, w: number, h: number): void;
  fillRect(x: number, y: number, w: number, h: number): void;
  beginPath(): void; arc(x: number, y: number, r: number, a0: number, a1: number): void;
  moveTo(x: number, y: number): void; lineTo(x: number, y: number): void; stroke(): void; fill(): void;
  createRadialGradient(x0: number, y0: number, r0: number, x1: number, y1: number, r1: number): { addColorStop(o: number, c: string): void };
  fillStyle: unknown; strokeStyle: unknown; lineWidth: number; globalCompositeOperation: string;
}
export interface FieldNode { x: number; y: number; vx: number; vy: number; r: number; v: Verdict; ph: number; depth: number; glow: number }
interface Ripple { x: number; y: number; t0: number }

const ORBS = [
  { bx: 0.12, by: 0.08, rx: 0.07, ry: 0.06, sp: 0.11, ph: 0.0, size: 0.46 },
  { bx: 0.92, by: 0.28, rx: 0.06, ry: 0.08, sp: 0.09, ph: 1.7, size: 0.40 },
  { bx: 0.38, by: 0.98, rx: 0.08, ry: 0.05, sp: 0.07, ph: 3.1, size: 0.44 },
  { bx: 0.78, by: 0.80, rx: 0.05, ry: 0.06, sp: 0.13, ph: 4.6, size: 0.28 },
];
const RIPPLE_SECONDS = 1.2, RIPPLE_REACH = 340;

export class Field {
  w = 0; h = 0; t = 0; scrollY = 0;
  nodes: FieldNode[] = [];
  private ripples: Ripple[] = [];
  private ptr = { x: -9999, y: -9999, tx: -9999, ty: -9999, on: false };

  constructor(private ctx: Ctx2D, public pal: FieldPalette, private rng: () => number = Math.random, private lowPower = false) {}

  private rand(a: number, b: number) { return a + this.rng() * (b - a); }

  resize(w: number, h: number, counts: Record<Verdict, number>) {
    this.w = w; this.h = h;
    const kinds = allocateNodes(counts, nodeCountFor(w, h, this.lowPower));
    this.nodes = kinds.map((v) => ({ x: this.rand(0, w), y: this.rand(0, h), vx: this.rand(-0.25, 0.25), vy: this.rand(-0.25, 0.25), r: this.rand(1.6, 3.6), v, ph: this.rand(0, 6.28), depth: this.rand(0.05, 0.22), glow: 0 }));
  }
  setPointer(x: number, y: number) { this.ptr.tx = x; this.ptr.ty = y; this.ptr.on = true; }
  clearPointer() { this.ptr.on = false; }
  ripple(x: number, y: number) { this.ripples.push({ x, y, t0: this.t }); if (this.ripples.length > 4) this.ripples.shift(); this.setPointer(x, y); }
  setScroll(y: number) { this.scrollY = y; }
  get rippleCount() { return this.ripples.length; }

  /** Positions where nodes are drawn (parallax + wrap), in screen space. */
  private screenY(n: FieldNode) { const span = this.h + 80; return (((n.y - this.scrollY * n.depth) % span) + span) % span - 40; }

  step(dt: number, focus: Verdict | null) {
    this.t += dt;
    const p = this.ptr;
    if (p.on) { p.x = p.x < -9000 ? p.tx : lerp(p.x, p.tx, 0.2); p.y = p.y < -9000 ? p.ty : lerp(p.y, p.ty, 0.2); }
    for (const n of this.nodes) {
      n.vx += Math.sin(this.t * 0.4 + n.ph) * 0.0022; n.vy += Math.cos(this.t * 0.33 + n.ph * 1.3) * 0.0022;
      if (p.on) { const sy = this.screenY(n); const rp = repel(n.x - p.x, sy - p.y, 150, 1.1); n.vx += rp.x * 0.05; n.vy += rp.y * 0.05; }
      for (const r of this.ripples) {
        const sy = this.screenY(n), dx = n.x - r.x, dy = sy - r.y, d = Math.hypot(dx, dy);
        const front = easeOutCubic((this.t - r.t0) / RIPPLE_SECONDS) * RIPPLE_REACH;
        if (d > 0 && Math.abs(d - front) < 36) { n.vx += (dx / d) * 0.35; n.vy += (dy / d) * 0.35; }
      }
      n.vx *= 0.992; n.vy *= 0.992;
      n.x += n.vx * dt * 60; n.y += n.vy * dt * 60;
      if (n.x < -20) n.x = this.w + 20; else if (n.x > this.w + 20) n.x = -20;
      if (n.y < -20) n.y = this.h + 20; else if (n.y > this.h + 20) n.y = -20;
      n.glow = lerp(n.glow, focus == null ? 0 : n.v === focus ? 1 : -1, 0.08);
    }
    this.ripples = this.ripples.filter((r) => this.t - r.t0 <= RIPPLE_SECONDS);
  }

  render() {
    const { ctx, w, h, pal } = this;
    ctx.clearRect(0, 0, w, h);
    ctx.globalCompositeOperation = pal.dark ? "lighter" : "source-over";
    const big = Math.max(w, h), p = this.ptr;
    ORBS.forEach((o, i) => {
      const base = { x: o.bx * w, y: o.by * h - this.scrollY * 0.04 };
      const pull = p.on ? { x: clamp((p.x - base.x) * 0.05, -90, 90), y: clamp((p.y - base.y) * 0.05, -90, 90) } : { x: 0, y: 0 };
      const pos = orbPosition(base, { x: o.rx * w, y: o.ry * h }, o.sp, o.ph, this.t, pull);
      const rad = o.size * big * 0.62, pr = pal.orbs[i];
      const g = ctx.createRadialGradient(pos.x, pos.y, 0, pos.x, pos.y, rad);
      g.addColorStop(0, rgba(pr.c, pr.a)); g.addColorStop(0.55, rgba(pr.c, pr.a * 0.32)); g.addColorStop(1, rgba(pr.c, 0));
      ctx.fillStyle = g; ctx.fillRect(pos.x - rad, pos.y - rad, rad * 2, rad * 2);
    });
    ctx.globalCompositeOperation = "source-over";

    for (const r of this.ripples) {
      const k = (this.t - r.t0) / RIPPLE_SECONDS;
      ctx.beginPath(); ctx.arc(r.x, r.y, easeOutCubic(k) * RIPPLE_REACH, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(${pal.ring},${(0.32 * (1 - k)).toFixed(3)})`; ctx.lineWidth = 1.5 + 2 * (1 - k); ctx.stroke();
    }

    const pos = this.nodes.map((n) => ({ x: n.x, y: this.screenY(n), n }));
    const maxD = Math.min(170, Math.max(110, w * 0.14)), maxD2 = maxD * maxD;
    ctx.lineWidth = 1;
    for (let i = 0; i < pos.length; i++) for (let j = i + 1; j < pos.length; j++) {
      const dx = pos[i].x - pos[j].x, dy = pos[i].y - pos[j].y, d2 = dx * dx + dy * dy;
      if (d2 > maxD2) continue;
      const k = 1 - Math.sqrt(d2) / maxD, lit = Math.max(pos[i].n.glow, pos[j].n.glow, 0);
      ctx.strokeStyle = `rgba(${pal.line},${(k * (pal.dark ? 0.16 : 0.2) * (1 + lit * 1.4)).toFixed(3)})`;
      ctx.beginPath(); ctx.moveTo(pos[i].x, pos[i].y); ctx.lineTo(pos[j].x, pos[j].y); ctx.stroke();
    }
    for (const { x, y, n } of pos) {
      const lit = Math.max(n.glow, 0), dim = n.glow < 0 ? 0.45 : 1;
      const r = n.r * (1 + lit * 1.1) * (lit > 0.05 ? 1 + Math.sin(this.t * 3 + n.ph) * 0.18 * lit : 1);
      const c = pal.dots[n.v];
      ctx.beginPath(); ctx.arc(x, y, r * 3.4, 0, Math.PI * 2); ctx.fillStyle = rgba(c, (0.1 + lit * 0.16) * dim); ctx.fill();
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fillStyle = rgba(c, (pal.dark ? 0.85 : 0.75) * dim); ctx.fill();
    }
  }

  frame(dt: number, focus: Verdict | null) { this.step(dt, focus); this.render(); }
  /** Jump straight to the focus state (used for the static, reduced-motion render). */
  snapFocus(focus: Verdict | null) { for (const n of this.nodes) n.glow = focus == null ? 0 : n.v === focus ? 1 : -1; }
}
