import { describe, it, expect } from "vitest";
import { verdictOf, cleanFinding, numberSegments, weekLabel, shortTitle, authorsLine, buildView, ringArcs, plural } from "@/lib/view";
import type { Brief, BriefCard } from "@/lib/types";

const card = (id: string, action: string, over: Partial<BriefCard> = {}): BriefCard => ({
  arxiv_id: id, title: `Title ${id}`, url: `https://arxiv.org/abs/${id}`, authors: ["A"], published: "2026-10-06T10:00:00Z",
  claims: [{ claim: "the authors report x.", quote: "x" }], why_it_matters: "why", caveat: "cav", evidence_type: "benchmarks_reported", action, ...over,
});
const brief = (): Brief => ({
  week_key: "2026-W42", label: "L", generated_at: "2026-10-12T10:00:00Z", ladder_level: 0, partial: false, word_count: 1, reading_minutes: 9, models: [], notes: [],
  domains: [
    { id: 1, name: "AI agents", items: [card("1", "flag_for_client"), card("2", "read"), card("3", "skim")] },
    { id: 2, name: "RAG", items: [card("4", "read"), card("5", "skip")] },
    { id: 3, name: "Quiet", items: [], note: "Quiet week." },
  ],
});

describe("verdictOf", () => {
  it("maps the four model actions onto the three design verdicts", () => {
    expect(verdictOf("flag_for_client")).toBe("flag");
    expect(verdictOf("read")).toBe("read");
    expect(verdictOf("skim")).toBe("skim");
    expect(verdictOf("skip")).toBe("skim");
    expect(verdictOf("anything-else")).toBe("skim");
  });
});

describe("cleanFinding", () => {
  it("drops the 'The authors report that' boilerplate and capitalises", () => {
    expect(cleanFinding("The authors report that BACAM enables merging.")).toBe("BACAM enables merging.");
    expect(cleanFinding("the authors report finding a single vector.")).toBe("Found a single vector.");
    expect(cleanFinding("The authors report 35% fewer steps.")).toBe("35% fewer steps.");
  });
});

describe("numberSegments", () => {
  const nums = (s: string) => numberSegments(s).filter((x) => x.num).map((x) => x.t);
  it("highlights percentages, multipliers, K counts and worded units", () => {
    expect(nums("Reaches 62.82% and beats it by 21.69 percentage points.")).toEqual(["62.82%", "21.69 percentage points"]);
    expect(nums("up to 1.9x faster with fewer than 500K parameters")).toEqual(["1.9x", "500K"]);
    expect(nums("violate 43.1 percent; 15 times lower energy")).toEqual(["43.1 percent", "15 times"]);
  });
  it("leaves identifiers and model names alone", () => {
    expect(nums("Uses Qwen3.5-9B on MultiHop-RAG and M3DocVQA")).toEqual([]);
  });
  it("round-trips the text exactly and honours highlight=false", () => {
    const s = "Gets 84.2% Pass@1 on SWE-bench, 3.6 points ahead.";
    expect(numberSegments(s).map((x) => x.t).join("")).toBe(s);
    expect(numberSegments(s, false)).toEqual([{ t: s, num: false }]);
  });
});

describe("labels", () => {
  it("weekLabel", () => { expect(weekLabel("2026-W42")).toBe("Week 42"); expect(weekLabel("2026-W05")).toBe("Week 5"); expect(weekLabel("seed")).toBe("seed"); });
  it("shortTitle uses the phrase before the colon only when it is a real phrase", () => {
    expect(shortTitle("Not Every Call Needs a Frontier Model: Per-Call-Site Evaluation")).toBe("Not Every Call Needs a Frontier Model");
    expect(shortTitle("BACAM: Behavior-Aware Continual Agent Merging")).toBe("BACAM: Behavior-Aware Continual Agent Merging");
    expect(shortTitle("No colon at all here")).toBe("No colon at all here");
  });
  it("authorsLine adds et al. at four names", () => {
    expect(authorsLine(["A", "B"])).toBe("A, B");
    expect(authorsLine(["A", "B", "C", "D"])).toBe("A, B, C, D et al.");
  });
  it("plural", () => { expect(plural(1, "paper")).toBe("1 paper"); expect(plural(2, "paper")).toBe("2 papers"); expect(plural(0, "finding")).toBe("0 findings"); });
});

describe("buildView", () => {
  it("counts verdicts over the whole brief and keeps flagged papers regardless of the filter", () => {
    const v = buildView(brief(), "read");
    expect(v.counts).toEqual({ flag: 1, read: 2, skim: 2 });
    expect(v.flagged.map((p) => p.card.arxiv_id)).toEqual(["1"]);
    expect(v.all).toHaveLength(5);
  });
  it("filters domains and drives the pager order from the filtered list", () => {
    const v = buildView(brief(), "read");
    expect(v.domains.map((d) => [d.name, d.papers.map((p) => p.card.arxiv_id)])).toEqual([["AI agents", ["2"]], ["RAG", ["4"]]]);
    expect(v.order).toEqual(["2", "4"]);
    expect(buildView(brief(), "all").order).toEqual(["1", "2", "3", "4", "5"]);
  });
  it("keeps an empty domain (with its note) only when showing everything", () => {
    expect(buildView(brief(), "all").domains.map((d) => d.name)).toContain("Quiet");
    expect(buildView(brief(), "flag").domains.map((d) => d.name)).toEqual(["AI agents"]);
  });
  it("counts only domains that actually have papers", () => { expect(buildView(brief(), "all").domainCount).toBe(2); });
  it("handles an empty brief", () => {
    const empty: Brief = { ...brief(), domains: [] };
    const v = buildView(empty, "all");
    expect(v.all).toEqual([]); expect(v.order).toEqual([]); expect(ringArcs(v.counts).every((r) => r.fraction === 0)).toBe(true);
  });
});

describe("ringArcs", () => {
  it("uses the design's radii and proportions of the total", () => {
    const rings = ringArcs({ flag: 4, read: 8, skim: 5 });
    expect(rings.map((r) => r.r)).toEqual([62, 46, 30]);
    expect(rings[1].fraction).toBeCloseTo(8 / 17, 5);
    expect(rings[0].circumference).toBeCloseTo(2 * Math.PI * 62, 5);
  });
});
