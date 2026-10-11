import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
vi.mock("../src/lib/time", async (orig) => ({ ...(await orig<typeof import("../src/lib/time")>()), sleep: async () => {} }));
import { fetchRecent } from "../src/lib/arxiv";

function page(total: number, start: number, n: number) {
  const entries = Array.from({ length: n }, (_, i) => {
    const id = `2610.${String(start + i + 1).padStart(5, "0")}`;
    return `<entry><id>http://arxiv.org/abs/${id}v1</id><title>T ${id}</title><summary>S</summary><published>2026-10-06T10:00:00Z</published><updated>2026-10-06T10:00:00Z</updated><author><name>A</name></author><category term="cs.AI"/><arxiv:primary_category term="cs.AI"/></entry>`;
  }).join("");
  return `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom" xmlns:opensearch="http://a9.com/-/spec/opensearch/1.1/" xmlns:arxiv="http://arxiv.org/schemas/atom"><opensearch:totalResults>${total}</opensearch:totalResults>${entries}</feed>`;
}
function serve(total: number) {
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    const start = Number(/[?&]start=(\d+)/.exec(String(url))![1]);
    return new Response(page(total, start, Math.max(0, Math.min(200, total - start))), { status: 200 });
  }));
}
beforeEach(() => vi.useFakeTimers({ toFake: ["Date"] }));
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("fetchRecent paging", () => {
  it("reports truncation when the page cap is hit before total (the 3337 vs 2400 live bug)", async () => {
    serve(3337);
    const r = await fetchRecent(["cs.AI"], new Date("2026-10-11T19:42:00Z"), 8, 12);
    expect(r.papers).toHaveLength(2400);
    expect(r.total).toBe(3337);
    expect(r.truncated).toBe(true);
  });
  it("fetches everything and is not truncated with the default cap", async () => {
    serve(3337);
    const r = await fetchRecent(["cs.AI"], new Date("2026-10-11T19:42:00Z"), 8);
    expect(r.papers).toHaveLength(3337);
    expect(r.pages).toBe(17);
    expect(r.truncated).toBe(false);
  });
  it("a small result is complete", async () => {
    serve(250);
    const r = await fetchRecent(["cs.AI"], new Date(), 5);
    expect(r.papers).toHaveLength(250);
    expect(r.truncated).toBe(false);
  });
});
