// Verifies the app's real database path (Neon HTTP driver -> query builder -> your schema).
// Run: npx tsx --env-file=.env.local scripts/live-db-smoke.ts
// Reads the seeded domains, does one idempotent write (heartbeat), and checks type normalisation. Prints no secrets.
import { db, must } from "../src/lib/db";

async function main() {
  const t0 = Date.now();
  const domains = must(await db().from("domains").select("*").eq("active", true).order("sort"), "domains");
  console.log(`domains: ${domains.length} (${domains.map((d: any) => d.slug).join(", ")})  [${Date.now() - t0} ms, includes any cold start]`);
  const d0 = domains[0];
  console.log("types:", { id: typeof d0.id, arxiv_categories: Array.isArray(d0.arxiv_categories), updated_at: typeof d0.updated_at });

  must(await db().from("heartbeats").upsert({ name: "smoke", at: new Date().toISOString() }), "heartbeat");
  const hb = must(await db().from("heartbeats").select("name,at").eq("name", "smoke").maybeSingle(), "heartbeat read");
  console.log("heartbeat round-trip:", hb);

  const first = must(await db().from("brief_runs").upsert({ week_key: "smoke" }, { onConflict: "week_key", ignoreDuplicates: true }).select(), "u1");
  const second = must(await db().from("brief_runs").upsert({ week_key: "smoke" }, { onConflict: "week_key", ignoreDuplicates: true }).select(), "u2");
  console.log(`ignoreDuplicates upsert returned rows: first=${first.length} second=${second.length} (expect 1 then 0)`);
  must(await db().from("brief_runs").delete().eq("week_key", "smoke"), "cleanup");
  must(await db().from("heartbeats").delete().eq("name", "smoke"), "cleanup hb");
  console.log("OK");
}
main().catch((e) => { console.error("FAILED:", String(e?.message ?? e).slice(0, 500)); process.exit(1); });
