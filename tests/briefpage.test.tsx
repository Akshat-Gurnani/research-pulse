// Server-render of the redesigned brief page: the content must be in the HTML without any JavaScript.
import { describe, it, expect, vi } from "vitest";
import { renderToString } from "react-dom/server";
import type { Brief, BriefCard } from "../src/lib/types";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh() {} }), usePathname: () => "/" }));
import { BriefExperience } from "../src/app/BriefExperience";

const card = (id: string, action: string, title: string): BriefCard => ({
  arxiv_id: id, title, url: `https://arxiv.org/abs/${id}`, authors: ["A. Author", "B. Author"], published: "2026-10-06T10:00:00Z",
  claims: [{ claim: "the authors report a 28% gain.", quote: "q" }, { claim: "the authors report finding a vector.", quote: "q" }],
  why_it_matters: `Why ${id} matters`, caveat: `Caveat ${id}`, evidence_type: "benchmarks_reported", action,
});
const brief: Brief = {
  week_key: "2026-W42", label: "Papers announced 6 Oct to 12 Oct 2026", generated_at: "2026-10-12T11:51:22Z", ladder_level: 0, partial: false,
  word_count: 1750, reading_minutes: 9, models: ["gemini-3.8-flash"], notes: ["2 lower-ranked papers were left out to keep the brief to about 9 minutes."],
  domains: [
    { id: 1, name: "AI agents", items: [card("2610.00001", "flag_for_client", "Frontier Models Are Not Always Needed: A Study"), card("2610.00002", "read", "Agent Merging Without Experts")] },
    { id: 2, name: "Retrieval-augmented generation", items: [card("2610.00003", "skim", "Retrieval in Embedding Space")] },
    { id: 3, name: "Quiet domain", items: [], note: "Quiet week in Quiet domain." },
  ],
};
// React's server renderer separates adjacent text nodes with <!-- --> markers; strip them so assertions read as text.
const html = (props: Partial<React.ComponentProps<typeof BriefExperience>> = {}) =>
  renderToString(<BriefExperience brief={brief} rung="db" stale={false} {...props} />).replace(/<!-- -->/g, "");

describe("brief page, server-rendered", () => {
  it("renders the header, summary and every paper without JavaScript", () => {
    const h = html();
    expect(h).toContain("Week 42");
    expect(h).toContain("2026-W42");
    expect(h).toContain("3 papers");               // plural-aware
    expect(h).toContain("2 domains");              // only domains that have papers
    expect(h).toContain("About 9 min read");
    for (const t of ["Frontier Models Are Not Always Needed: A Study", "Agent Merging Without Experts", "Retrieval in Embedding Space"]) expect(h).toContain(t);
    expect(h).toContain("2 lower-ranked papers were left out");
  });
  it("shows the verdict tiles, the segmented filter and the flagged carousel", () => {
    const h = html();
    expect(h).toContain("Flag for client");
    expect(h).toContain('role="radiogroup"');
    expect(h).toContain("Flagged for client");
    expect(h).toContain("Frontier Models Are Not Always Needed");  // carousel uses the part before the colon
  });
  it("keeps an empty domain's note and the finding counts", () => {
    const h = html();
    expect(h).toContain("Quiet week in Quiet domain.");
    expect(h).toContain("2 findings");
  });
  it("owner controls are absent for visitors and present for the admin session", () => {
    expect(html()).not.toContain("Generate this week");
    expect(html({ admin: true })).toContain("Generate this week");
  });
  it("labels offline and stale briefs and never presents the seed as live", () => {
    expect(html({ rung: "seed", stale: true })).toContain("Offline snapshot");
    const stale = html({ stale: true });
    expect(stale).toContain("Stale.");
    expect(stale).not.toContain("Offline snapshot");
  });
  it("renders a paper's external link safely and keeps the detail sheet closed", () => {
    const h = html();
    expect(h).not.toContain("Open on arXiv");           // sheet content is only rendered once a paper is opened
    expect(h).toContain('aria-hidden="true"');
  });
});
