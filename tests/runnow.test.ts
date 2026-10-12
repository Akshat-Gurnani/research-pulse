// The manual "Generate now" trigger: auth, cooldown, background run, regenerate semantics and failure safety.
// Real Postgres (PGlite) + the real route handlers; arXiv, Gemini, Resend and the clock are mocked.
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { createDb } from "../src/lib/db";
import { makePg, pgExec, truncateAll } from "./helpers/pg";

const h = vi.hoisted(() => ({ db: null as any, gen: vi.fn(), send: vi.fn(), after: [] as Array<() => Promise<void> | void> }));
vi.mock("../src/lib/db", async (orig) => ({ ...(await orig<typeof import("../src/lib/db")>()), db: () => h.db }));
vi.mock("@google/genai", () => ({ GoogleGenAI: class { models = { generateContent: (a: any) => h.gen(a) }; } }));
vi.mock("resend", () => ({ Resend: class { emails = { send: (m: any) => h.send(m) }; } }));
vi.mock("../src/lib/time", async (orig) => ({ ...(await orig<typeof import("../src/lib/time")>()), sleep: async () => {} }));
vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), after: (fn: () => Promise<void> | void) => { h.after.push(fn); } }));

import { POST } from "../src/app/api/admin/run-now/route";
import { GET as STATUS } from "../src/app/api/admin/run-status/route";
import { runWeekly } from "../src/lib/pipeline";
import { loadBrief } from "../src/lib/brief";
import { makeSession } from "../src/lib/auth";

const NOW = new Date("2026-10-12T02:00:00Z"); // Monday IST, Sunday batch already announced
const WEEK = "2026-W42";
const mk = (id: string, published: string) => ({ id, published, title: `Agent study ${id}`, abstract: `We study a new agent method for tool use and report gains on benchmark ${id} across several tasks. Code is available at github.com/example/${id.replace(".", "-")}.` });
const PAPERS = [mk("2610.00001", "2026-10-06T10:00:00Z"), mk("2610.00002", "2026-10-07T13:00:00Z"), mk("2610.00003", "2026-10-08T09:00:00Z"), mk("2610.00005", "2026-10-09T12:00:00Z")];
const ABS = new Map(PAPERS.map((p) => [p.id, p.abstract]));
const atom = () => `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom" xmlns:opensearch="http://a9.com/-/spec/opensearch/1.1/" xmlns:arxiv="http://arxiv.org/schemas/atom"><opensearch:totalResults>${PAPERS.length}</opensearch:totalResults>${PAPERS.map((p) => `<entry><id>http://arxiv.org/abs/${p.id}v1</id><title>${p.title}</title><summary>${p.abstract}</summary><published>${p.published}</published><updated>${p.published}</updated><author><name>A</name></author><category term="cs.AI"/><arxiv:primary_category term="cs.AI"/></entry>`).join("")}</feed>`;

let pg: PGlite; let geminiFails = false;
const rows = async (t: string) => ((await h.db.from(t).select("*")).data ?? []) as any[];
const cookie = () => `rp_admin=${encodeURIComponent(makeSession())}`;
const post = (mode: string, headers: Record<string, string> = {}) =>
  POST(new Request(`http://localhost/api/admin/run-now?mode=${mode}`, { method: "POST", headers: { origin: "http://localhost", ...headers } }));
const asAdmin = { cookie: "" };
const drainAfter = async () => { const fns = h.after.splice(0); for (const f of fns) await f(); };

beforeAll(async () => { pg = await makePg(); h.db = createDb(pgExec(pg)); }, 60_000);
beforeEach(async () => {
  await truncateAll(pg);
  h.gen.mockReset(); h.send.mockReset(); h.after.length = 0; geminiFails = false;
  h.send.mockResolvedValue({ data: { id: "m1" }, error: null });
  h.gen.mockImplementation(async (a: any) => {
    if (geminiFails) throw Object.assign(new Error("model unavailable"), { status: 503 });
    const ids = [...String(a.contents).matchAll(/^id: (\S+)$/gm)].map((m) => m[1]);
    const isScore = JSON.stringify(a.config.responseJsonSchema).includes('"merit"');
    const results = ids.map((id) => isScore ? { id, merit: 4, best_domain: "agents", evidence_quote: ABS.get(id)!.slice(0, 30) }
      : { id, claims: [{ claim: "the authors report gains.", quote: ABS.get(id)!.slice(0, 40) }], why_it_matters: "Relevant to agent builders.", caveat: "Abstract only.", evidence_type: "benchmarks_reported", action: "read" });
    return { text: JSON.stringify({ results }), candidates: [{ finishReason: "STOP" }], modelVersion: "fake", usageMetadata: {} };
  });
  await h.db.from("domains").insert({ slug: "agents", name: "AI agents", arxiv_categories: ["cs.AI"], phrases: ["agent"], exclude_phrases: [], active: true, sort: 1 });
  Object.assign(process.env, { SESSION_SECRET: "s".repeat(32), EXAMINER_TOKEN: "exam-token", GEMINI_API_KEY: "k", RESEND_API_KEY: "re_t", RECIPIENT_EMAIL: "me@example.com", PUBLIC_BASE_URL: "http://localhost" });
  for (const k of ["BLOB_READ_WRITE_TOKEN", "GMAIL_USER", "GMAIL_APP_PASSWORD", "ALLOW_FLASH_LITE"]) delete process.env[k];
  asAdmin.cookie = cookie();
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(NOW);
  vi.stubGlobal("fetch", vi.fn(async (u: string) => {
    if (String(u).includes("export.arxiv.org")) return new Response(atom(), { status: 200 });
    if (String(u).includes("huggingface.co")) return new Response("[]", { status: 200 });
    if (String(u).includes("hn.algolia.com")) return new Response(JSON.stringify({ hits: [] }), { status: 200 });
    throw new Error(`unexpected fetch ${u}`);
  }));
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("authorisation", () => {
  it("rejects regenerate with no credentials, with a bad origin, and with only the examiner token", async () => {
    expect((await post("regenerate")).status).toBe(401);
    expect((await post("regenerate", { cookie: asAdmin.cookie, origin: "https://evil.example" })).status).toBe(401);
    expect((await post("regenerate", { "x-examiner-token": "exam-token" })).status).toBe(403);
    expect(h.after).toHaveLength(0);
    expect(h.gen).not.toHaveBeenCalled();
  });
  it("run-status needs the admin session", async () => {
    expect((await STATUS(new Request("http://localhost/api/admin/run-status"))).status).toBe(401);
    const ok = await STATUS(new Request("http://localhost/api/admin/run-status", { headers: { cookie: asAdmin.cookie } }));
    expect(ok.status).toBe(200);
  });
});

describe("regenerate", () => {
  it("answers 202 immediately, runs in the background, and replaces the published brief without emailing", async () => {
    await runWeekly(NOW);                                   // the normal weekly publish
    const first = (await rows("brief_runs"))[0];
    expect(first.status).toBe("published");
    const callsBefore = h.gen.mock.calls.length;
    vi.setSystemTime(new Date(NOW.getTime() + 5 * 60_000));

    const r = await post("regenerate", { cookie: asAdmin.cookie });
    expect(r.status).toBe(202);
    expect(await r.json()).toMatchObject({ started: true, week_key: WEEK });
    expect(h.after).toHaveLength(1);
    expect(h.gen.mock.calls.length).toBe(callsBefore);       // nothing ran inside the request

    await drainAfter();
    const run = (await rows("brief_runs"))[0];
    expect(run.status).toBe("published");
    expect(new Date(run.published_at).getTime()).toBeGreaterThan(new Date(first.published_at).getTime());
    expect(h.gen.mock.calls.length - callsBefore).toBe(0);   // everything was cached: a repeat run is free
    expect(h.send).not.toHaveBeenCalled();
    expect(await rows("send_log")).toHaveLength(0);
  });

  it("is cooled down for 60 s, then allowed again", async () => {
    await runWeekly(NOW);
    expect((await post("regenerate", { cookie: asAdmin.cookie })).status).toBe(202);
    await drainAfter();
    expect((await post("regenerate", { cookie: asAdmin.cookie })).status).toBe(429);
    vi.setSystemTime(new Date(NOW.getTime() + 61_000));
    expect((await post("regenerate", { cookie: asAdmin.cookie })).status).toBe(202);
  });

  it("refuses to start a second run while one holds a live lease (409)", async () => {
    await runWeekly(NOW);
    await h.db.from("brief_runs").update({ status: "running", lease_expires: new Date(NOW.getTime() + 5 * 60_000).toISOString() }).eq("week_key", WEEK);
    const r = await post("regenerate", { cookie: asAdmin.cookie });
    expect(r.status).toBe(409);
    expect(h.after).toHaveLength(0);
  });

  it("keeps serving the existing brief while a regeneration is in flight", async () => {
    await runWeekly(NOW);
    await h.db.from("brief_runs").update({ status: "running", lease_expires: new Date(NOW.getTime() + 5 * 60_000).toISOString() }).eq("week_key", WEEK);
    const r = await loadBrief();
    expect(r.rung).toBe("db");
    expect(r.brief.domains.flatMap((d) => d.items).length).toBeGreaterThan(0);
  });

  it("a failed regeneration restores 'published' and keeps the previous brief (never falls to the seed)", async () => {
    await runWeekly(NOW);
    const before = (await rows("brief_runs"))[0];
    await h.db.from("summaries").delete().eq("prompt_version", "sum-v1");
    await h.db.from("paper_scores").delete().neq("arxiv_id", "none");
    geminiFails = true;
    vi.setSystemTime(new Date(NOW.getTime() + 5 * 60_000));
    await post("regenerate", { cookie: asAdmin.cookie });
    await drainAfter();
    const run = (await rows("brief_runs"))[0];
    expect(run.status).toBe("published");
    expect(run.error_summary).toMatch(/regeneration/i);
    expect(run.lease_expires).toBeNull();
    expect(new Date(run.published_at).getTime()).toBe(new Date(before.published_at).getTime());
    const served = await loadBrief();
    expect(served.rung).toBe("db");
    expect(served.brief.domains.flatMap((d) => d.items).length).toBeGreaterThan(0);
  });

  it("without regenerate, a published week is still left alone (cron behaviour unchanged)", async () => {
    await runWeekly(NOW);
    expect((await runWeekly(NOW)).status).toBe("already-published");
  });
});

describe("other modes keep working", () => {
  it("test mode is a dry run that publishes nothing; send-test emails the owner without logging", async () => {
    await runWeekly(NOW);
    const t = await post("test", { "x-examiner-token": "exam-token" });
    expect((await t.json()).status).toBe("dry-run");
    vi.setSystemTime(new Date(NOW.getTime() + 3_700_000));
    const s = await post("send-test", { cookie: asAdmin.cookie });
    expect((await s.json()).sent).toBe(1);
    expect(h.send).toHaveBeenCalledTimes(1);
    expect(await rows("send_log")).toHaveLength(0);
  });
});
