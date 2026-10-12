// Hard rule (CLAUDE.md): the committed seed must hold real papers, and the read ladder must fall back to it.
import { describe, it, expect, vi } from "vitest";
import seed from "../data/seed-brief.json";

vi.mock("../src/lib/db", () => ({
  db: () => { throw new Error("database unreachable"); },
  must: (r: any) => r.data,
}));
import { loadBrief } from "../src/lib/brief";

describe("committed seed brief", () => {
  const cards = (seed as any).domains.flatMap((d: any) => d.items);
  it("holds real, well-formed papers (not the placeholder)", () => {
    expect(cards.length).toBeGreaterThanOrEqual(5);
    for (const c of cards) {
      expect(c.arxiv_id).toMatch(/^\d{4}\.\d{4,5}$/);
      expect(c.url).toBe(`https://arxiv.org/abs/${c.arxiv_id}`);
      expect(c.claims.length).toBeGreaterThan(0);
      expect(c.caveat.length).toBeGreaterThan(0);
    }
    expect(JSON.stringify(seed).toLowerCase()).not.toContain("placeholder");
  });
  it("stays within the 10 minute reading rule", () => expect((seed as any).reading_minutes).toBeLessThanOrEqual(10));
  it("is what the site serves when the database is unreachable (ladder rung 3)", async () => {
    const r = await loadBrief();
    expect(r.rung).toBe("seed");
    expect(r.stale).toBe(true);
    expect(r.brief.ladder_level).toBe(3);
    expect(r.brief.domains.flatMap((d) => d.items).length).toBe(cards.length);
  });
  it("is never served as a specific requested week", async () => {
    expect((await loadBrief("2026-W42")).rung).toBe("seed"); // page.tsx turns this into a 404
  });
});
