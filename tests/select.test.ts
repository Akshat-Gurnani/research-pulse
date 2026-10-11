import { describe, it, expect } from "vitest";
import { percentileRanks, rank, fitBudget } from "@/lib/select";

describe("percentile ranks", () => {
  it("ties share a rank, singletons are neutral", () => {
    expect(percentileRanks([1, 1, 3])).toEqual([25, 25, 100]);
    expect(percentileRanks([4])).toEqual([50]);
  });
});
describe("rank", () => {
  const c = (id: string, merit: number, extra = {}) => ({ arxiv_id: id, merit, hasArtefact: false, hasNumber: false, ...extra });
  it("applies the absolute floor so quiet weeks print fewer papers", () => expect(rank([c("a", 2), c("b", 1)])).toEqual([]));
  it("excludes injection-flagged papers", () => expect(rank([c("a", 5, { flagged: true }), c("b", 3)]).map((r) => r.arxiv_id)).toEqual(["b"]));
  it("missing attention is neutral, not a penalty", () => {
    const r = rank([c("a", 4, { hf: null, hn: null }), c("b", 4, { hf: 0, hn: 0 })]);
    expect(r[0].breakdown.attention).toBe(50);
  });
  it("attention and artefacts lift an equal-merit paper", () => {
    const r = rank([c("a", 4, { hf: 5, hn: 0, hasArtefact: true }), c("b", 4, { hf: 0, hn: 0 })]);
    expect(r[0].arxiv_id).toBe("a");
  });
});
describe("fitBudget", () => {
  const f = (domainId: number, words: number, score: number) => ({ domainId, words, score, item: `${domainId}-${score}` });
  it("drops the lowest score overall until under budget", () => {
    const { kept, dropped } = fitBudget([f(1, 100, 9), f(1, 100, 1), f(2, 100, 5), f(2, 100, 2)], 300);
    expect(dropped.map((d) => d.score)).toEqual([1]); expect(kept.length).toBe(3);
  });
  it("protects each domain's last item while others can still be trimmed", () => {
    const { kept } = fitBudget([f(1, 100, 1), f(2, 100, 9), f(2, 100, 8)], 200);
    expect(kept.some((k) => k.domainId === 1)).toBe(true);
  });
  it("never exceeds the budget", () => expect(fitBudget([f(1, 500, 1), f(2, 500, 2)], 400).kept.length).toBe(0));
});
