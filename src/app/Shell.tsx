"use client";
import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { scrollProgress } from "@/lib/motion";

const WeekContext = createContext<(label: string) => void>(() => {});
/** Pages call this with e.g. "Week 42" so the sticky nav can swap its brand for it on scroll. */
export const useSetWeek = () => useContext(WeekContext);

const useIsoLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect;

const LINKS: { href: string; label: string; match: (p: string) => boolean }[] = [
  { href: "/", label: "Brief", match: (p) => p === "/" || (p.startsWith("/brief/") && !p.endsWith("feed.xml")) },
  { href: "/status", label: "Status", match: (p) => p.startsWith("/status") },
  { href: "/settings", label: "Domains", match: (p) => p.startsWith("/settings") },
  { href: "/brief/feed.xml", label: "Feed", match: () => false },
];

export function Shell({ children }: { children: ReactNode }) {
  const path = usePathname() ?? "/";
  const [week, setWeek] = useState("");
  const [scrolled, setScrolled] = useState(false);
  const [pill, setPill] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [hover, setHover] = useState<number | null>(null);
  const linksRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLAnchorElement | null)[]>([]);
  const activeIndex = LINKS.findIndex((l) => l.match(path));

  // scroll: brand swap + reading progress (rAF-throttled)
  useEffect(() => {
    let raf = 0;
    const apply = () => {
      raf = 0;
      setScrolled(window.scrollY > 90);
      const p = scrollProgress(window.scrollY, document.documentElement.scrollHeight, window.innerHeight);
      stickRef.current?.style.setProperty("--p", p.toFixed(4));
    };
    const on = () => { if (!raf) raf = requestAnimationFrame(apply); };
    apply();
    window.addEventListener("scroll", on, { passive: true });
    window.addEventListener("resize", on);
    return () => { window.removeEventListener("scroll", on); window.removeEventListener("resize", on); if (raf) cancelAnimationFrame(raf); };
  }, []);

  // sliding pill follows the hovered link, otherwise rests on the active one
  const target = hover ?? activeIndex;
  useIsoLayoutEffect(() => {
    const measure = () => {
      const el = target >= 0 ? itemRefs.current[target] : null;
      setPill(el ? { x: el.offsetLeft, y: el.offsetTop, w: el.offsetWidth, h: el.offsetHeight } : null);
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [target, path]);

  // cursor-following spotlight on glass surfaces (event delegation, one listener)
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const on = (e: PointerEvent) => {
      const el = (e.target as Element | null)?.closest?.(".glass, .fcard") as HTMLElement | null;
      if (!el) return;
      const r = el.getBoundingClientRect();
      el.style.setProperty("--mx", `${e.clientX - r.left}px`);
      el.style.setProperty("--my", `${e.clientY - r.top}px`);
    };
    window.addEventListener("pointermove", on, { passive: true });
    return () => window.removeEventListener("pointermove", on);
  }, []);

  const showWeek = scrolled && !!week;
  const ctx = useMemo(() => setWeek, []);
  return (
    <WeekContext.Provider value={ctx}>
      <div className="shell">
        <div className="nav-stick" ref={stickRef}>
          <nav className="nav glass" aria-label="Main">
            <a className="brandwrap" href="/" aria-label="Research Pulse home" style={{ color: "inherit" }}>
              <span className="logo" aria-hidden>RP</span>
              <span className="brandtext">
                <span style={{ opacity: showWeek ? 0 : 1, transform: showWeek ? "translateY(-8px)" : "none" }}>Research Pulse</span>
                <span style={{ opacity: showWeek ? 1 : 0, transform: showWeek ? "none" : "translateY(8px)" }} aria-hidden={!showWeek}>{week || "Research Pulse"}</span>
              </span>
            </a>
            <div className="links" ref={linksRef} onPointerLeave={() => setHover(null)}>
              {pill && <span className="nav-pill" aria-hidden style={{ transform: `translate(${pill.x}px, ${pill.y}px)`, width: pill.w, height: pill.h }} />}
              {LINKS.map((l, i) => (
                <a key={l.href} href={l.href} ref={(el) => { itemRefs.current[i] = el; }} aria-current={i === activeIndex ? "page" : undefined}
                  onPointerEnter={() => setHover(i)} onFocus={() => setHover(i)} onBlur={() => setHover(null)}>{l.label}</a>
              ))}
            </div>
            <span className="nav-progress" aria-hidden />
          </nav>
        </div>
        <main className="wrap">
          {children}
          <footer className="foot">Summaries are generated from abstracts only by Gemini Flash and checked against them in code. Not peer reviewed. Paper metadata courtesy of arXiv.</footer>
        </main>
      </div>
    </WeekContext.Provider>
  );
}
