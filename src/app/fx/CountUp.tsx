"use client";
import { useEffect, useRef, useState } from "react";
import { easeOutCubic, lerp } from "@/lib/motion";

/** Renders the final number on the server (and without JS), then counts up on the client. */
export function CountUp({ value, duration = 900 }: { value: number; duration?: number }) {
  const [shown, setShown] = useState(value);
  const first = useRef(true);
  const prev = useRef(value);
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) { setShown(value); prev.current = value; return; }
    const from = first.current ? 0 : prev.current;
    first.current = false;
    const t0 = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const p = Math.min(1, (now - t0) / duration);
      setShown(Math.round(lerp(from, value, easeOutCubic(p))));
      if (p < 1) raf = requestAnimationFrame(tick); else prev.current = value;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, duration]);
  return <>{shown}</>;
}
