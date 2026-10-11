// The validation gate. Structured output guarantees syntax, not truth, so the facts are checked in code.
import { plainText, scan } from "./inject";
import { WPM } from "./config";

const norm = (s: string) => s.toLowerCase().normalize("NFKC").replace(/[\u2018\u2019]/g, "'").replace(/[\u201C\u201D]/g, '"').replace(/\s+/g, " ").trim();

/** Quote must be a (normalised) substring of the abstract. */
export function quoteInAbstract(quote: string, abstract: string): boolean {
  const q = norm(quote).replace(/^[.\u2026\s]+|[.\u2026\s]+$/g, "");
  return q.length >= 12 && norm(abstract).includes(q);
}

/** Every number in the text must appear in the abstract (so the model cannot invent a benchmark). */
export function numbersSupported(text: string, abstract: string): { ok: boolean; missing: string[] } {
  const nums = text.match(/\d+(?:[.,]\d+)?/g) ?? [];
  const absNums = new Set(abstract.match(/\d+(?:[.,]\d+)?/g) ?? []);
  const missing = [...new Set(nums.filter((n) => !absNums.has(n)))];
  return { ok: missing.length === 0, missing };
}

export interface CardIn {
  arxiv_id: string;
  claims: { claim: string; quote: string }[];
  why_it_matters: string; caveat: string;
  evidence_type: string; action: string;
}
export interface CardOut extends CardIn { verified: true }
export interface GateIssue { arxiv_id: string; rule: string; detail?: string }

export function gateCard(card: CardIn, abstract: string, canary: string, knownIds: Set<string>): { card: CardOut | null; issues: GateIssue[] } {
  const issues: GateIssue[] = [];
  const id = card.arxiv_id;
  if (!knownIds.has(id)) return { card: null, issues: [{ arxiv_id: id, rule: "1-unknown-id" }] };
  const claims = [];
  for (const c of card.claims) {
    if (!quoteInAbstract(c.quote, abstract)) { issues.push({ arxiv_id: id, rule: "4-quote-not-in-abstract", detail: c.quote.slice(0, 60) }); continue; }
    const n = numbersSupported(c.claim, abstract);
    if (!n.ok) { issues.push({ arxiv_id: id, rule: "4-number-not-in-abstract", detail: n.missing.join(",") }); continue; }
    claims.push({ claim: plainText(c.claim), quote: c.quote });
  }
  if (claims.length === 0) return { card: null, issues };
  const strings = [card.why_it_matters, card.caveat, ...claims.map((c) => c.claim)];
  for (const s of strings) {
    if (s.includes(canary)) return { card: null, issues: [...issues, { arxiv_id: id, rule: "5-canary-leak" }] };
    if (scan(s).flagged) return { card: null, issues: [...issues, { arxiv_id: id, rule: "5-injection-phrase-in-output" }] };
  }
  const why = plainText(card.why_it_matters), cav = plainText(card.caveat);
  if (!cav) return { card: null, issues: [...issues, { arxiv_id: id, rule: "6-missing-caveat" }] };
  const n2 = numbersSupported(`${why} ${cav}`, abstract);
  if (!n2.ok) issues.push({ arxiv_id: id, rule: "4-number-not-in-abstract", detail: n2.missing.join(",") });
  return { card: { ...card, claims, why_it_matters: why, caveat: cav, verified: true }, issues };
}

export const wordCount = (s: string) => (s.trim() ? s.trim().split(/\s+/).length : 0);
export const readingMinutes = (words: number) => Math.max(1, Math.ceil(words / WPM));
export const cardWords = (c: { claims: { claim: string }[]; why_it_matters: string; caveat: string }, title: string) =>
  wordCount(title) + c.claims.reduce((n, x) => n + wordCount(x.claim), 0) + wordCount(c.why_it_matters) + wordCount(c.caveat) + 6;
