"use client";
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";

const WeekContext = createContext<(label: string) => void>(() => {});
/** Pages call this with e.g. "Week 42" so the sticky nav can swap its brand for it on scroll. */
export const useSetWeek = () => useContext(WeekContext);

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
  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 90);
    on();
    window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, []);
  const showWeek = scrolled && !!week;
  const ctx = useMemo(() => setWeek, []);
  return (
    <WeekContext.Provider value={ctx}>
      <div className="shell">
        <div className="nav-stick">
          <nav className="nav glass" aria-label="Main">
            <a className="brandwrap" href="/" aria-label="Research Pulse home" style={{ color: "inherit" }}>
              <span className="logo" aria-hidden>RP</span>
              <span className="brandtext">
                <span style={{ opacity: showWeek ? 0 : 1, transform: showWeek ? "translateY(-8px)" : "none" }}>Research Pulse</span>
                <span style={{ opacity: showWeek ? 1 : 0, transform: showWeek ? "none" : "translateY(8px)" }} aria-hidden={!showWeek}>{week || "Research Pulse"}</span>
              </span>
            </a>
            <div className="links">
              {LINKS.map((l) => <a key={l.href} href={l.href} aria-current={l.match(path) ? "page" : undefined}>{l.label}</a>)}
            </div>
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
