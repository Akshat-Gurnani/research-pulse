// Builds data/seed-brief.json from REAL papers so the site is never empty at submission.
// Usage: GEMINI_API_KEY=... SUPABASE_URL=... SUPABASE_SECRET_KEY=... npm run make-seed
// Simplest path: run the pipeline once (POST /api/admin/run-now or the weekly cron), then export the published snapshot.
import { createClient } from "@supabase/supabase-js";
import { writeFileSync } from "node:fs";

const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, { auth: { persistSession: false } });
const { data, error } = await sb.from("brief_runs").select("snapshot").eq("status", "published").order("published_at", { ascending: false }).limit(1);
if (error || !data?.[0]?.snapshot) { console.error("No published brief yet. Run the weekly job first.", error); process.exit(1); }
const seed = { ...data[0].snapshot, label: `Offline snapshot of ${data[0].snapshot.label}`, ladder_level: 3 };
writeFileSync("data/seed-brief.json", JSON.stringify(seed, null, 2));
console.log("Wrote data/seed-brief.json from", seed.week_key);
