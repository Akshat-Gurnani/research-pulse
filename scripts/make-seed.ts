// Builds data/seed-brief.json from REAL papers so the site is never empty at submission.
// Usage: npx tsx --env-file=.env.local scripts/make-seed.ts   (or: npm run make-seed with DATABASE_URL set)
// Simplest path: run the pipeline once (POST /api/admin/run-now or the weekly cron), then export the published snapshot.
import { writeFileSync } from "node:fs";
import { db } from "../src/lib/db";

async function main() {
  const { data, error } = await db().from("brief_runs").select("snapshot").eq("status", "published").order("published_at", { ascending: false }).limit(1);
  if (error || !data?.[0]?.snapshot) { console.error("No published brief yet. Run the weekly job first.", error); process.exit(1); }
  const seed = { ...data[0].snapshot, label: `Offline snapshot of ${data[0].snapshot.label}`, ladder_level: 3 };
  writeFileSync("data/seed-brief.json", JSON.stringify(seed, null, 2));
  console.log("Wrote data/seed-brief.json from", seed.week_key);
}
main().catch((e) => { console.error(e); process.exit(1); });
