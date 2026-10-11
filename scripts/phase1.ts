// Phase 1 runner: executes pipeline stages directly (no HTTP) and prints real counts from the database.
//   npx tsx --env-file=.env.local scripts/phase1.ts daily [days]   ingest arXiv (default 5 days; use 8 for the first backfill)
//   npx tsx --env-file=.env.local scripts/phase1.ts weekly-dry     score + summarise + gate, print result, publish nothing
//   npx tsx --env-file=.env.local scripts/phase1.ts weekly         real run: claim lease, publish, (try to) email
//   npx tsx --env-file=.env.local scripts/phase1.ts counts         table counts and recent llm_calls
import { db, must } from "../src/lib/db";
import { ingestDaily, runWeekly, deliver } from "../src/lib/pipeline";

async function counts() {
  const out: Record<string, number> = {};
  for (const t of ["papers", "paper_scores", "summaries", "signals", "llm_calls", "brief_runs", "brief_items", "featured", "raw_fetch", "send_log"]) {
    out[t] = (await db().from(t).select("*", { count: "exact", head: true })).count ?? -1;
  }
  console.log("row counts:", out);
  const calls = must(await db().from("llm_calls").select("purpose,model_id,status,error_class,latency_ms,prompt_tokens,output_tokens,thought_tokens").order("id"), "llm_calls");
  const agg = new Map<string, { n: number; ms: number; inTok: number; outTok: number }>();
  for (const c of calls) {
    const k = `${c.purpose} | ${c.model_id} | ${c.status}${c.error_class ? ` (${c.error_class})` : ""}`;
    const a = agg.get(k) ?? { n: 0, ms: 0, inTok: 0, outTok: 0 };
    a.n++; a.ms += c.latency_ms ?? 0; a.inTok += c.prompt_tokens ?? 0; a.outTok += (c.output_tokens ?? 0) + (c.thought_tokens ?? 0);
    agg.set(k, a);
  }
  console.log("llm_calls by purpose | model | status:");
  for (const [k, a] of agg) console.log(`  ${k}: n=${a.n} avg_latency=${Math.round(a.ms / a.n)}ms tokens_in=${a.inTok} tokens_out=${a.outTok}`);
  const runs = must(await db().from("brief_runs").select("week_key,status,ladder_level,partial,late_batch,calls_used,word_count,reading_minutes,error_summary"), "brief_runs");
  console.log("brief_runs:", runs);
  const score = must(await db().from("paper_scores").select("merit"), "scores");
  const dist: Record<number, number> = {};
  for (const s of score) dist[s.merit] = (dist[s.merit] ?? 0) + 1;
  console.log("merit distribution:", dist);
  const src = must(await db().from("source_health").select("*"), "source_health");
  console.log("source_health:", src);
}

async function main() {
  const [cmd, arg] = process.argv.slice(2);
  const t0 = Date.now();
  if (cmd === "daily") {
    const r = await ingestDaily(new Date(), arg ? Number(arg) : 5);
    console.log("ingestDaily:", r, `${Date.now() - t0} ms`);
  } else if (cmd === "weekly-dry") {
    const r = await runWeekly(new Date(), { dryRun: true, ingestFirst: false });
    console.log("runWeekly(dryRun):", r, `${Math.round((Date.now() - t0) / 1000)} s`);
  } else if (cmd === "weekly") {
    const r = await runWeekly(new Date());
    console.log("runWeekly:", r, `${Math.round((Date.now() - t0) / 1000)} s`);
    if (r.status === "published" || r.status === "already-published") console.log("deliver:", await deliver(new Date()));
  } else if (cmd !== "counts") {
    console.error("usage: phase1.ts daily [days] | weekly-dry | weekly | counts"); process.exit(2);
  }
  await counts();
}
main().catch((e) => { console.error("FAILED:", String(e?.message ?? e).slice(0, 600)); process.exit(1); });
