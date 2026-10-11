// Pure ranking and fitting logic (unit-tested). Weights are a starting hypothesis, not a published formula.
import { MAX_PER_DOMAIN, MERIT_FLOOR, WORD_BUDGET } from "./config";

export const WEIGHTS = { merit: 0.5, attention: 0.3, artefacts: 0.2 }; // credibility term dropped (no S2 key); weight redistributed

export function percentileRanks(values: number[]): number[] {
  const n = values.length;
  if (n <= 1) return values.map(() => 50);
  return values.map((v) => {
    const below = values.filter((x) => x < v).length;
    const equal = values.filter((x) => x === v).length;
    return (100 * (below + 0.5 * (equal - 1))) / (n - 1);
  });
}

export interface Cand { arxiv_id: string; merit: number; hf?: number | null; hn?: number | null; hasArtefact: boolean; hasNumber: boolean; flagged?: boolean }
export interface Ranked extends Cand { score: number; breakdown: { merit: number; attention: number; artefacts: number; hasAttention: boolean } }

export function rank(cands: Cand[]): Ranked[] {
  const pool = cands.filter((c) => !c.flagged && c.merit >= MERIT_FLOOR);
  const merit = percentileRanks(pool.map((c) => c.merit));
  const hf = percentileRanks(pool.map((c) => Math.log1p(c.hf ?? 0)));
  const hn = percentileRanks(pool.map((c) => Math.log1p(c.hn ?? 0)));
  return pool.map((c, i) => {
    const has = (c.hf ?? 0) > 0 || (c.hn ?? 0) > 0;
    const parts = [] as number[];
    if (c.hf != null) parts.push(hf[i]);
    if (c.hn != null) parts.push(hn[i]);
    const attention = has && parts.length ? parts.reduce((a, b) => a + b, 0) / parts.length : 50; // neutral when missing
    const artefacts = (c.hasArtefact ? 67 : 0) + (c.hasNumber ? 33 : 0);
    const score = WEIGHTS.merit * merit[i] + WEIGHTS.attention * attention + WEIGHTS.artefacts * artefacts + c.merit; // raw merit breaks ties
    return { ...c, score, breakdown: { merit: merit[i], attention, artefacts, hasAttention: has } };
  }).sort((a, b) => b.score - a.score);
}

export const topK = <T,>(xs: T[], k = MAX_PER_DOMAIN) => xs.slice(0, k);

export interface Fit<T> { domainId: number; words: number; score: number; item: T }

/**
 * Global word budget wins over the per-domain cap: drop the lowest-scored item overall until it fits,
 * but never drop a domain's last remaining item before every domain with 2+ items has been trimmed.
 */
export function fitBudget<T>(items: Fit<T>[], budget = WORD_BUDGET): { kept: Fit<T>[]; dropped: Fit<T>[] } {
  let kept = [...items];
  const dropped: Fit<T>[] = [];
  const total = () => kept.reduce((n, x) => n + x.words, 0);
  while (total() > budget && kept.length > 0) {
    const counts = new Map<number, number>();
    for (const k of kept) counts.set(k.domainId, (counts.get(k.domainId) ?? 0) + 1);
    let pool = kept.filter((k) => (counts.get(k.domainId) ?? 0) > 1);
    if (pool.length === 0) pool = kept;
    const victim = pool.reduce((a, b) => (a.score <= b.score ? a : b));
    kept = kept.filter((k) => k !== victim);
    dropped.push(victim);
  }
  return { kept, dropped };
}

export function keywordScore(text: string, phrases: string[]): number {
  const t = text.toLowerCase();
  return phrases.reduce((n, p) => n + (t.includes(p.toLowerCase()) ? 1 : 0), 0);
}
