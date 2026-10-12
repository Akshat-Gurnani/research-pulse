"use client";
import { useEffect, useRef } from "react";
import { getFx, subscribeFx } from "./signals";
import { Field, type FieldPalette } from "@/lib/field";
import type { Verdict } from "@/lib/motion";

/**
 * Animated background: a "knowledge field" of drifting colour orbs and a constellation of nodes (one colour per verdict,
 * in the proportions of this week's brief) joined by faint links. It reacts to the pointer, clicks (pulse ripples), scrolling
 * (parallax) and to the page filter (the focused verdict's nodes swell and glow). Pauses when hidden; static under
 * reduced motion. The simulation itself lives in src/lib/field.ts.
 */
function readPalette(): FieldPalette {
  const cs = getComputedStyle(document.documentElement);
  const v = (n: string) => cs.getPropertyValue(n).trim();
  const dark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  return {
    dark,
    orbs: [1, 2, 3, 4].map((i) => ({ c: v(`--b${i}`), a: parseFloat(v(`--b${i}o`)) || 0.3 })),
    dots: { flag: v("--flag-dot"), read: v("--read-dot"), skim: v("--skim-dot") } as Record<Verdict, string>,
    line: dark ? "255,255,255" : "40,50,110",
    ring: dark ? "255,255,255" : "60,80,200",
  };
}

export function LiquidBackdrop() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const lowPower = (navigator.hardwareConcurrency ?? 8) <= 4;
    const field = new Field(ctx, readPalette(), Math.random, lowPower);
    let raf = 0, last = 0, running = false, avgMs = 0, count = 0;

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, lowPower ? 1.5 : 2);
      canvas.width = Math.round(window.innerWidth * dpr); canvas.height = Math.round(window.innerHeight * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      field.resize(window.innerWidth, window.innerHeight, getFx().counts);
      if (!running) { field.snapFocus(getFx().focus); field.render(); }
    };
    const frame = (now: number) => {
      if (!running) return;
      const dt = last ? Math.min(0.033, (now - last) / 1000) : 0.016;
      last = now;
      const t0 = performance.now();
      field.frame(dt, getFx().focus);
      // cost of one frame's drawing, exposed for diagnostics (a 60 fps budget is 16.7 ms)
      const ms = performance.now() - t0;
      avgMs = count === 0 ? ms : avgMs * 0.9 + ms * 0.1;
      if (++count <= 12 || count % 30 === 0) { canvas.dataset.drawMs = avgMs.toFixed(2); canvas.dataset.nodes = String(field.nodes.length); }
      raf = requestAnimationFrame(frame);
    };
    const start = () => { if (running || reduced) return; running = true; last = 0; raf = requestAnimationFrame(frame); };
    const stop = () => { running = false; cancelAnimationFrame(raf); };

    const onMove = (e: PointerEvent) => field.setPointer(e.clientX, e.clientY);
    const onDown = (e: PointerEvent) => field.ripple(e.clientX, e.clientY);
    const onLeave = () => field.clearPointer();
    const onScroll = () => field.setScroll(window.scrollY);
    const onVis = () => { if (document.hidden) stop(); else start(); };
    const dark = window.matchMedia("(prefers-color-scheme: dark)");
    const onTheme = () => { field.pal = readPalette(); if (!running) field.render(); };

    // Opt-in self-benchmark (?fxbench=1): renders 240 frames synchronously on a detached canvas, forcing the raster to
    // finish each frame, and reports the real per-frame cost on this device. Works even in a hidden tab.
    if (new URLSearchParams(window.location.search).has("fxbench")) {
      const off = document.createElement("canvas");
      // ?fxbench=2 forces a device-pixel-ratio of 2 to measure a Retina display from any screen
      const forced = Number(new URLSearchParams(window.location.search).get("fxbench"));
      const benchDpr = forced > 1 ? forced : Math.min(window.devicePixelRatio || 1, lowPower ? 1.5 : 2);
      off.width = Math.round(window.innerWidth * benchDpr); off.height = Math.round(window.innerHeight * benchDpr);
      const octx = off.getContext("2d");
      if (octx) {
        const bench = new Field(octx, readPalette(), Math.random, lowPower);
        octx.setTransform(benchDpr, 0, 0, benchDpr, 0, 0);
        bench.resize(window.innerWidth, window.innerHeight, getFx().counts);
        const N = 240, t0 = performance.now();
        for (let i = 0; i < N; i++) { bench.frame(1 / 60, i % 60 < 30 ? null : "flag"); octx.getImageData(0, 0, 1, 1); }
        const ms = (performance.now() - t0) / N;
        canvas.dataset.benchMs = ms.toFixed(2);
        canvas.dataset.benchNodes = String(bench.nodes.length);
        canvas.dataset.benchPx = `${off.width}x${off.height}`;
      }
    }

    resize();
    field.setScroll(window.scrollY);
    canvas.classList.add("on");
    window.addEventListener("resize", resize);
    dark.addEventListener("change", onTheme);
    const unsub = subscribeFx(() => { if (!running) { field.snapFocus(getFx().focus); field.render(); } });
    if (!reduced) {
      window.addEventListener("pointermove", onMove, { passive: true });
      window.addEventListener("pointerdown", onDown, { passive: true });
      document.addEventListener("pointerleave", onLeave);
      window.addEventListener("scroll", onScroll, { passive: true });
      document.addEventListener("visibilitychange", onVis);
      start();
    }
    return () => {
      stop(); unsub();
      window.removeEventListener("resize", resize);
      dark.removeEventListener("change", onTheme);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerdown", onDown);
      document.removeEventListener("pointerleave", onLeave);
      window.removeEventListener("scroll", onScroll);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);

  return <canvas ref={ref} className="fx" aria-hidden />;
}
