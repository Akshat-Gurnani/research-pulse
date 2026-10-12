// Pure presentation logic for the brief page (no React, no DOM), so it can be unit-tested.
import type { Brief, BriefCard } from "./types";

export type Verdict = "flag" | "read" | "skim";
export type Filter = "all" | Verdict;

export const VERDICTS: Verdict[] = ["flag", "read", "skim"];
export const VERDICT_LABEL: Record<Verdict, string> = { flag: "Flag for client", read: "Read", skim: "Skim" };
export const SEGMENTS: { value: Filter; label: string }[] = [
  { value: "all", label: "All" }, { value: "flag", label: "Client" }, { value: "read", label: "Read" }, { value: "skim", label: "Skim" },
];

/** Gemini's four actions collapse to the three verdicts the design shows ("skip" reads as skim). */
export function verdictOf(action: string): Verdict {
  if (action === "flag_for_client") return "flag";
  if (action === "read") return "read";
  return "skim";
}

/** "The authors report that X" -> "X"; "The authors report finding X" -> "Found X". Capitalised. */
export function cleanFinding(s: string): string {
  const t = s.replace(/^The authors report finding /i, "Found ").replace(/^The authors report (that )?/i, "").trim();
  return t.charAt(0).toUpperCase() + t.slice(1);
}

// Numbers worth highlighting: 28%, 62.82%, 1.9x, 500K, 43.1 percent, 15 times, 21.69 percentage points.
const NUM = /((?<![\w.@-])\d+(?:[.,]\d+)*(?:\s?%|x|\s?[kK])?(?:\s(?:percentage points|percent|times|points))?(?![\w]))/g;
export interface Seg { t: string; num: boolean }
export function numberSegments(s: string, highlight = true): Seg[] {
  if (!highlight) return [{ t: s, num: false }];
  const whole = new RegExp("^" + NUM.source + "$");
  return s.split(NUM).filter(Boolean).map((t) => ({ t, num: /^\d/.test(t) && whole.test(t) }));
}

/** "2026-W42" -> "Week 42". */
export function weekLabel(weekKey: string): string {
  const m = /W0*(\d{1,2})$/.exec(weekKey);
  return m ? `Week ${m[1]}` : weekKey;
}

/** Carousel headline: the part before a colon when it is a real phrase, otherwise the whole title. */
export function shortTitle(title: string): string {
  const head = title.split(":")[0].trim();
  return head.split(/\s+/).length >= 3 ? head : title;
}

export function authorsLine(authors: string[]): string {
  return authors.join(", ") + (authors.length >= 4 ? " et al." : "");
}
export const evidenceLabel = (s: string) => s.replace(/_/g, " ");
export const plural = (n: number, one: string, many = one + "s") => `${n} ${n === 1 ? one : many}`;

export interface PaperView { card: BriefCard; verdict: Verdict; domainId: number; domainName: string }
export interface DomainView { id: number; name: string; note?: string; papers: PaperView[]; total: number }
export interface BriefView {
  all: PaperView[];
  counts: Record<Verdict, number>;
  domains: DomainView[];   // filtered
  flagged: PaperView[];    // always from the whole brief
  order: string[];         // arXiv ids in on-screen order for the current filter (drives the pager)
  domainCount: number;
}

export function buildView(brief: Brief, filter: Filter): BriefView {
  const all: PaperView[] = brief.domains.flatMap((d) => d.items.map((card) => ({ card, verdict: verdictOf(card.action), domainId: d.id, domainName: d.name })));
  const counts: Record<Verdict, number> = { flag: 0, read: 0, skim: 0 };
  for (const p of all) counts[p.verdict]++;
  const keep = (p: PaperView) => filter === "all" || p.verdict === filter;
  const domains: DomainView[] = brief.domains
    .map((d) => ({ id: d.id, name: d.name, note: d.note, total: d.items.length, papers: all.filter((p) => p.domainId === d.id && keep(p)) }))
    .filter((d) => d.papers.length > 0 || (filter === "all" && d.total === 0));
  return {
    all, counts, domains,
    flagged: all.filter((p) => p.verdict === "flag"),
    order: domains.flatMap((d) => d.papers.map((p) => p.card.arxiv_id)),
    domainCount: brief.domains.filter((d) => d.items.length > 0).length,
  };
}

export interface Ring { verdict: Verdict; r: number; circumference: number; fraction: number }
const RADII: Record<Verdict, number> = { flag: 62, read: 46, skim: 30 };
export function ringArcs(counts: Record<Verdict, number>): Ring[] {
  const total = counts.flag + counts.read + counts.skim;
  return VERDICTS.map((v) => ({ verdict: v, r: RADII[v], circumference: 2 * Math.PI * RADII[v], fraction: total ? counts[v] / total : 0 }));
}
