// Scenario replays through the real /api/cron/weekly handler and runWeekly/deliver.
// Database: real Postgres (PGlite) running the project migration, through the real query builder.
// Mocked: global fetch (arXiv/HF/HN), @google/genai, resend, sleep, and the clock.
// NOT mocked: pipeline, window maths, gate, ranking, lease/claim logic, send_log claim.
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { createDb } from "../src/lib/db";
import { makePg, pgExec, truncateAll } from "./helpers/pg";

const h = vi.hoisted(() => ({ db: null as any, gen: vi.fn(), send: vi.fn() }));
vi.mock("../src/lib/db", async (orig) => ({ ...(await orig<typeof import("../src/lib/db")>()), db: () => h.db }));
vi.mock("@google/genai", () => ({ GoogleGenAI: class { models = { generateContent: (a: any) => h.gen(a) }; } }));
vi.mock("resend", () => ({ Resend: class { emails = { send: (m: any) => h.send(m) }; } }));
vi.mock("../src/lib/time", async (orig) => ({ ...(await orig<typeof import("../src/lib/time")>()), sleep: async () => {} }));

import { POST } from "../src/app/api/cron/weekly/route";

const MONDAY_EARLY = new Date("2026-10-12T00:20:00Z"); // 05:50 IST, 20 min after the Sunday batch
const MONDAY_LATE = new Date("2026-10-12T01:47:00Z");  // 107 min after: past the 90 min "publish regardless" line
const WEEK = "2026-W42";

interface P { id: string; published: string; title: string; abstract: string }
const mk = (id: string, published: string): P => ({
  id, published, title: `Agent planning study ${id}`,
  abstract: `We study a new agent method for tool use and report gains on benchmark ${id} across several tasks. Code is available at github.com/example/${id.replace(".", "-")}.`,
});
// Four papers from Tue-Thu batches, two from the Sunday 20:00 ET batch (announced Mon 00:00 UTC).
const EARLY = [mk("2610.00001", "2026-10-06T10:00:00Z"), mk("2610.00002", "2026-10-07T13:00:00Z"), mk("2610.00003", "2026-10-08T09:00:00Z"), mk("2610.00004", "2026-10-06T16:00:00Z")];
const SUNDAY = [mk("2610.00005", "2026-10-09T12:00:00Z"), mk("2610.00006", "2026-10-08T20:00:00Z")];
const ABSTRACTS = new Map([...EARLY, ...SUNDAY].map((p) => [p.id, p.abstract]));

const atom = (ps: P[]) => `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xmlns:opensearch="http://a9.com/-/spec/opensearch/1.1/" xmlns:arxiv="http://arxiv.org/schemas/atom">
<opensearch:totalResults>${ps.length}</opensearch:totalResults>
${ps.map((p) => `<entry><id>http://arxiv.org/abs/${p.id}v1</id><title>${p.title}</title><summary>${p.abstract}</summary>
<published>${p.published}</published><updated>${p.published}</updated><author><name>A. Author</name></author>
<category term="cs.AI"/><arxiv:primary_category term="cs.AI"/></entry>`).join("\n")}
</feed>`;

let visible: P[] = [];
const setVisible = (ps: P[]) => { visible = ps; };

function stubFetch() {
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    const u = String(url);
    if (u.includes("export.arxiv.org")) return new Response(atom(visible), { status: 200 });
    if (u.includes("huggingface.co")) return new Response("[]", { status: 200 });
    if (u.includes("hn.algolia.com")) return new Response(JSON.stringify({ hits: [] }), { status: 200 });
    throw new Error(`unexpected fetch ${u}`);
  }));
}

function stubGemini() {
  h.gen.mockImplementation(async (a: any) => {
    const ids = [...String(a.contents).matchAll(/^id: (\S+)$/gm)].map((m) => m[1]);
    const isScore = JSON.stringify(a.config.responseJsonSchema).includes('"merit"');
    const results = ids.map((id) => isScore
      ? { id, merit: 4, best_domain: "agents", evidence_quote: ABSTRACTS.get(id)!.slice(0, 30) }
      : { id, claims: [{ claim: "The authors report gains on their benchmark.", quote: ABSTRACTS.get(id)!.slice(0, 40) }],
          why_it_matters: "Relevant for teams building tool-using agents.", caveat: "Abstract only; no independent replication.",
          evidence_type: "benchmarks_reported", action: "read" });
    return { text: JSON.stringify({ results }), candidates: [{ finishReason: "STOP" }], modelVersion: "fake-1", usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 10 } };
  });
}

const call = () => POST(new Request("http://localhost/api/cron/weekly", { method: "POST", headers: { authorization: "Bearer test-secret", "x-trigger-source": "test" } }));
const run = async () => (await call()).json() as Promise<{ ok: boolean; result: { status: string }; sent: null | { sent: number; skipped: number } }>;
const rows = async (t: string) => ((await h.db.from(t).select("*")).data ?? []) as any[];
let pg: PGlite;

beforeAll(async () => { pg = await makePg(); h.db = createDb(pgExec(pg)); }, 60_000);

beforeEach(async () => {
  await truncateAll(pg);
  h.gen.mockReset(); h.send.mockReset();
  h.send.mockResolvedValue({ data: { id: "msg-1" }, error: null });
  await h.db.from("domains").insert({ slug: "agents", name: "AI agents", arxiv_categories: ["cs.AI"], phrases: ["agent"], exclude_phrases: [], active: true, sort: 1 });
  Object.assign(process.env, { CRON_SECRET: "test-secret", GEMINI_API_KEY: "k", RESEND_API_KEY: "re_test", RECIPIENT_EMAIL: "reader@example.com", PUBLIC_BASE_URL: "http://localhost:3000" });
  for (const k of ["BLOB_READ_WRITE_TOKEN", "GMAIL_USER", "GMAIL_APP_PASSWORD", "HEALTHCHECK_DELIVERY_URL", "CRON_SECRET_PREVIOUS", "ALLOW_FLASH_LITE"]) delete process.env[k];
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(MONDAY_EARLY);
  stubFetch(); stubGemini();
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("Sunday batch missing", () => {
  it("waits when the batch is not visible yet: no Gemini calls, nothing published or sent", async () => {
    setVisible(EARLY);
    const r = await run();
    expect(r.result.status).toBe("waiting_batch");
    expect(r.sent).toBeNull();
    expect(h.gen).not.toHaveBeenCalled();
    expect(h.send).not.toHaveBeenCalled();
    expect((await rows("brief_runs"))[0]).toMatchObject({ week_key: WEEK, status: "waiting_batch", lease_expires: null });
    expect((await rows("brief_items"))).toHaveLength(0);
  });

  it("publishes anyway after 90 minutes, labels the missing batch, and does not feature Sunday papers", async () => {
    setVisible(EARLY);
    expect((await run()).result.status).toBe("waiting_batch");
    vi.setSystemTime(MONDAY_LATE);
    const r = await run();
    expect(r.result.status).toBe("published");
    const run0 = (await rows("brief_runs"))[0];
    expect(run0.status).toBe("published");
    expect(run0.late_batch).toBe(true);
    const ids = (await rows("brief_items")).map((i) => i.arxiv_id).sort();
    expect(ids).toEqual(EARLY.map((p) => p.id).sort());
    expect(run0.snapshot.notes.join(" ")).toMatch(/Sunday-evening arXiv batch was not visible/);
    expect(r.sent).toMatchObject({ sent: 1 });
    expect(h.send).toHaveBeenCalledTimes(1);
  });

  it("publishes a complete brief without the late flag when the batch shows up before the deadline", async () => {
    setVisible(EARLY);
    expect((await run()).result.status).toBe("waiting_batch");
    vi.setSystemTime(new Date("2026-10-12T00:50:00Z"));
    setVisible([...EARLY, ...SUNDAY]);
    const r = await run();
    expect(r.result.status).toBe("published");
    expect((await rows("brief_runs"))[0].late_batch).toBe(false);
    const ids = (await rows("brief_items")).map((i) => i.arxiv_id);
    expect(ids).toHaveLength(5); // MAX_PER_DOMAIN: 6 equal-merit papers, one is cut
    expect(ids.some((id) => SUNDAY.some((p) => p.id === id))).toBe(true);
    expect((await rows("brief_runs"))[0].snapshot.notes.join(" ")).not.toMatch(/not visible/);
  });

  it("assigns Sunday-batch papers to the window's end slot (guards the announce_slot mapping)", async () => {
    setVisible([...EARLY, ...SUNDAY]);
    await run();
    const end = "2026-10-12T00:00:00.000Z";
    for (const p of SUNDAY) expect((await rows("papers")).find((x) => x.arxiv_id === p.id).announce_slot).toBe(end);
    for (const p of EARLY) expect((await rows("papers")).find((x) => x.arxiv_id === p.id).announce_slot).not.toBe(end);
  });
});

describe("Duplicate triggers", () => {
  it("two concurrent weekly calls produce one brief and one send_log row", async () => {
    setVisible([...EARLY, ...SUNDAY]);
    const [a, b] = await Promise.all([run(), run()]);
    const statuses = [a.result.status, b.result.status].sort();
    expect(statuses).toEqual(["leased-elsewhere", "published"]);
    expect((await rows("brief_runs"))).toHaveLength(1);
    expect((await rows("brief_runs"))[0].status).toBe("published");
    const items = (await rows("brief_items")).map((i) => i.arxiv_id);
    expect(new Set(items).size).toBe(items.length);
    expect((await rows("send_log"))).toHaveLength(1);
    expect((await rows("send_log"))[0]).toMatchObject({ week_key: WEEK, status: "sent", provider: "resend" });
    expect(h.send).toHaveBeenCalledTimes(1);
  });

  it("a later duplicate is a no-op: no new Gemini calls, no second email", async () => {
    setVisible([...EARLY, ...SUNDAY]);
    await run();
    const geminiCalls = h.gen.mock.calls.length;
    const again = await run();
    expect(again.result.status).toBe("already-published");
    expect(again.sent).toMatchObject({ sent: 0, skipped: 1 });
    expect(h.gen.mock.calls.length).toBe(geminiCalls);
    expect(h.send).toHaveBeenCalledTimes(1);
    expect((await rows("send_log"))).toHaveLength(1);
  });

  it("an expired lease from a dead worker is retaken, a live lease is not", async () => {
    setVisible([...EARLY, ...SUNDAY]);
    await h.db.from("brief_runs").insert({ week_key: WEEK, status: "running", lease_expires: new Date(MONDAY_EARLY.getTime() + 5 * 60_000).toISOString() });
    expect((await run()).result.status).toBe("leased-elsewhere");
    vi.setSystemTime(new Date(MONDAY_EARLY.getTime() + 9 * 60_000)); // past the 8 minute lease
    expect((await run()).result.status).toBe("published");
  });

  it("a failed email does not block the page, and the retry sends exactly once", async () => {
    setVisible([...EARLY, ...SUNDAY]);
    h.send.mockResolvedValueOnce({ data: null, error: { name: "rate_limit_exceeded", message: "slow down" } });
    const first = await run();
    expect(first.result.status).toBe("published");
    expect(first.sent).toMatchObject({ sent: 0 });
    expect((await rows("brief_runs"))[0].status).toBe("published");
    expect((await rows("send_log"))[0]).toMatchObject({ status: "failed", attempts: 1 });
    const second = await run();
    expect(second.sent).toMatchObject({ sent: 1 });
    expect((await rows("send_log"))).toHaveLength(1);
    expect((await rows("send_log"))[0]).toMatchObject({ status: "sent", attempts: 2 });
  });
});
