// The query builder against real Postgres, using the project's migration.
import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { createDb, must, type Db } from "../src/lib/db";
import { makePg, pgExec, truncateAll } from "./helpers/pg";

let pg: PGlite; let db: Db; let seededDomains = 0;
beforeAll(async () => {
  pg = await makePg(); db = createDb(pgExec(pg));
  seededDomains = Number(((await pg.query("select count(*) as n from domains")).rows[0] as any).n);
}, 60_000);
beforeEach(async () => { await truncateAll(pg); });

describe("migration", () => {
  it("applies, seeds the default domains, and enables RLS on every table", async () => {
    expect(seededDomains).toBe(4);
    const r = await pg.query("select count(*)::int as n from pg_tables where schemaname = 'public' and not rowsecurity");
    expect((r.rows[0] as any).n).toBe(0);
  });
});

describe("types round-trip", () => {
  it("text[], jsonb, timestamptz as ISO string, int8 as number", async () => {
    must(await db.from("domains").insert({ slug: "a", name: "A", arxiv_categories: ["cs.AI", "cs.CL"], phrases: ["x y"] }), "ins");
    must(await db.from("settings_history").insert({ domains_snapshot: [{ slug: "a", n: 1 }], actor: "t" }), "ins2");
    const d = must(await db.from("domains").select("*").eq("slug", "a").maybeSingle(), "sel");
    expect(d.arxiv_categories).toEqual(["cs.AI", "cs.CL"]);
    expect(typeof d.id).toBe("number");
    expect(typeof d.updated_at).toBe("string");
    expect(new Date(d.updated_at).toString()).not.toBe("Invalid Date");
    const h = must(await db.from("settings_history").select("*").limit(1).maybeSingle(), "sel2");
    expect(h.domains_snapshot).toEqual([{ slug: "a", n: 1 }]);
  });
});

describe("upsert", () => {
  it("ignoreDuplicates returns only rows actually inserted", async () => {
    const first = must(await db.from("brief_runs").upsert({ week_key: "2026-W42" }, { onConflict: "week_key", ignoreDuplicates: true }).select(), "u1");
    expect(first).toHaveLength(1);
    const again = must(await db.from("brief_runs").upsert({ week_key: "2026-W42" }, { onConflict: "week_key", ignoreDuplicates: true }).select(), "u2");
    expect(again).toHaveLength(0);
  });
  it("merges on conflict and defaults the target to the primary key", async () => {
    await db.from("heartbeats").upsert({ name: "daily", at: "2026-10-01T00:00:00Z" });
    await db.from("heartbeats").upsert({ name: "daily", at: "2026-10-02T00:00:00Z" });
    const r = must(await db.from("heartbeats").select("*"), "s");
    expect(r).toHaveLength(1);
    expect(r[0].at.startsWith("2026-10-02")).toBe(true);
  });
  it("bulk upsert with composite key and missing columns", async () => {
    const rows = [
      { arxiv_id: "1", prompt_version: "v", model_id: "m", merit: 3, best_domain: "a", evidence_quote: "q" },
      { arxiv_id: "2", prompt_version: "v", model_id: "m", merit: 4, best_domain: "b", evidence_quote: "q" },
    ];
    must(await db.from("paper_scores").upsert(rows), "bulk");
    must(await db.from("paper_scores").upsert([{ ...rows[0], merit: 5 }]), "again");
    const r = must(await db.from("paper_scores").select("arxiv_id,merit").order("arxiv_id"), "s");
    expect(r).toEqual([{ arxiv_id: "1", merit: 5 }, { arxiv_id: "2", merit: 4 }]);
  });
});

describe("filters", () => {
  beforeEach(async () => {
    await db.from("brief_runs").insert([
      { week_key: "W1", status: "published", snapshot: { a: 1 }, published_at: "2026-10-01T00:00:00Z" },
      { week_key: "W2", status: "pending" },
      { week_key: "W3", status: "running", lease_expires: "2000-01-01T00:00:00Z" },
      { week_key: "W4", status: "running", lease_expires: "2999-01-01T00:00:00Z" },
    ]);
  });
  it("claim-style update(or(...)) matches pending and expired leases only, atomically", async () => {
    const now = new Date().toISOString();
    const claim = (k: string) => db.from("brief_runs").update({ status: "running" }).eq("week_key", k)
      .or(`status.in.(pending,waiting_batch,failed),and(status.eq.running,lease_expires.lt.${now})`).select("week_key");
    expect(must(await claim("W2"), "c2")).toHaveLength(1);
    expect(must(await claim("W3"), "c3")).toHaveLength(1);
    expect(must(await claim("W4"), "c4")).toHaveLength(0);   // live lease
    expect(must(await claim("W1"), "c1")).toHaveLength(0);   // published
  });
  it("two concurrent claims with a lease: exactly one wins", async () => {
    await db.from("brief_runs").insert({ week_key: "W5", status: "pending" });
    const claim = () => {
      const now = new Date().toISOString();
      return db.from("brief_runs").update({ status: "running", lease_expires: new Date(Date.now() + 8 * 60_000).toISOString() })
        .eq("week_key", "W5").or(`status.in.(pending,waiting_batch,failed),and(status.eq.running,lease_expires.lt.${now})`).select("week_key");
    };
    const [a, b] = await Promise.all([claim(), claim()]);
    expect(a.data.length + b.data.length).toBe(1);
  });
  it("count head, in, not-is-null, order desc, limit, maybeSingle, neq, gte", async () => {
    const c = await db.from("brief_runs").select("week_key", { count: "exact", head: true }).eq("status", "running");
    expect(c.count).toBe(2); expect(c.data).toBeNull();
    expect(must(await db.from("brief_runs").select("week_key").in("week_key", ["W1", "W2"]).order("week_key", { ascending: false }), "in").map((r: any) => r.week_key)).toEqual(["W2", "W1"]);
    expect(must(await db.from("brief_runs").select("snapshot").not("snapshot", "is", null).order("published_at", { ascending: false }).limit(1), "n")).toEqual([{ snapshot: { a: 1 } }]);
    expect(must(await db.from("brief_runs").select("week_key").eq("week_key", "nope").maybeSingle(), "m")).toBeNull();
    expect(must(await db.from("brief_runs").select("week_key").neq("status", "running").gte("week_key", "W2"), "g")).toEqual([{ week_key: "W2" }]);
  });
  it("is(null) and match", async () => {
    expect(must(await db.from("brief_runs").select("week_key").is("lease_expires", null).match({ status: "pending" }), "i")).toEqual([{ week_key: "W2" }]);
  });
  it("delete requires a filter", async () => {
    const r = await db.from("brief_runs").delete();
    expect(r.error?.message).toMatch(/unfiltered delete/);
    expect(must(await db.from("brief_runs").select("week_key"), "s")).toHaveLength(4);
    await db.from("brief_runs").delete().eq("week_key", "W2").eq("status", "pending");
    expect(must(await db.from("brief_runs").select("week_key"), "s")).toHaveLength(3);
  });
  it("rejects unsafe identifiers instead of interpolating them", () => {
    expect(() => db.from("brief_runs; drop table x")).toThrow(/bad identifier/);
    expect(() => db.from("brief_runs").eq('status"; --', "x")).toThrow(/bad identifier/);
  });
  it("surfaces SQL errors as {error}, not exceptions", async () => {
    const r = await db.from("no_such_table").select("*");
    expect(r.error?.message).toMatch(/unknown table/);
  });
});
