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

import { preselect, type PrePaper, type PreDomain } from "@/lib/select";
describe("preselect (per-domain quotas)", () => {
  const paper = (id: string, text: string, cats = ["cs.AI"], extra: Partial<PrePaper> = {}): PrePaper => ({ arxiv_id: id, title: text, abstract: text, categories: cats, primary_category: cats[0], ...extra });
  const agents: PreDomain = { arxiv_categories: ["cs.AI"], phrases: ["agent", "planning", "tool use"], exclude_phrases: [] };
  const cv: PreDomain = { arxiv_categories: ["cs.CV"], phrases: ["defect detection", "industrial"], exclude_phrases: [] };

  it("a broad domain cannot starve a narrow one (the live code-llms/cv-industrial bug)", () => {
    const many = Array.from({ length: 300 }, (_, i) => paper(`a${String(i).padStart(4, "0")}`, "agent planning tool use agent planning"));
    const few = Array.from({ length: 6 }, (_, i) => paper(`c${i}`, "industrial defect detection", ["cs.CV"]));
    const out = preselect([...many, ...few], [agents, cv], 40);
    expect(out).toHaveLength(40);
    expect(out.filter((p) => p.arxiv_id.startsWith("c"))).toHaveLength(6);
  });
  it("refills spare capacity from the broad domain and never exceeds the total", () => {
    const many = Array.from({ length: 100 }, (_, i) => paper(`a${String(i).padStart(3, "0")}`, "agent"));
    const out = preselect([...many, paper("c0", "industrial", ["cs.CV"])], [agents, cv], 30);
    expect(out).toHaveLength(30);
    expect(out.some((p) => p.arxiv_id === "c0")).toBe(true);
  });
  it("applies categories, exclude phrases and injection flags; ignores papers matching nothing", () => {
    const d: PreDomain = { arxiv_categories: ["cs.AI"], phrases: ["agent"], exclude_phrases: ["quantum"] };
    const out = preselect([
      paper("ok", "an agent"), paper("wrongcat", "an agent", ["cs.CV"]), paper("excluded", "a quantum agent"),
      paper("flagged", "an agent", ["cs.AI"], { injection_flag: true }), paper("nomatch", "something else"),
    ], [d], 10);
    expect(out.map((p) => p.arxiv_id)).toEqual(["ok"]);
  });
  it("is deterministic and handles no domains", () => {
    const ps = Array.from({ length: 50 }, (_, i) => paper(`p${i}`, "agent"));
    expect(preselect(ps, [agents], 10).map((p) => p.arxiv_id)).toEqual(preselect([...ps].reverse(), [agents], 10).map((p) => p.arxiv_id));
    expect(preselect(ps, [], 10)).toEqual([]);
  });
});
