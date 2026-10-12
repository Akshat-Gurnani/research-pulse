// Phase 1 runner: executes pipeline stages directly (no HTTP) and prints real counts from the database.
//   npx tsx --env-file=.env.local scripts/phase1.ts daily [days]   ingest arXiv (default 5 days; use 8 for the first backfill)
//   npx tsx --env-file=.env.local scripts/phase1.ts weekly-dry     score + summarise + gate, print result, publish nothing
//   npx tsx --env-file=.env.local scripts/phase1.ts weekly         real run: claim lease, publish, (try to) email
//   npx tsx --env-file=.env.local scripts/phase1.ts weekly-force   publish now without the Sunday batch (labelled, no email)
//   npx tsx --env-file=.env.local scripts/phase1.ts weekly-redo    replace a late-batch brief with the complete one, deliver once
//   npx tsx --env-file=.env.local scripts/phase1.ts counts         table counts and recent llm_calls
import { db, must } from "../src/lib/db";
import { ingestDaily, runWeekly, deliver } from "../src/lib/pipeline";
import { briefWindow } from "../src/lib/time";

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
  } else if (cmd === "weekly-redo") {
    // Replace an already-published late-batch brief with the complete one, and deliver it once.
    // Refuses unless the Sunday batch is actually in the database. Keeps the audit trail in send_log.
    const now = new Date();
    const w = briefWindow(now);
    const n = (await db().from("papers").select("arxiv_id", { count: "exact", head: true }).eq("announce_slot", w.endSlot.toISOString())).count ?? 0;
    if (n === 0) { console.error(`REFUSING: no papers in the ${w.endSlot.toISOString()} slot yet. Run "daily 5" first or wait for the batch.`); process.exit(1); }
    const run = must(await db().from("brief_runs").select("status,late_batch").eq("week_key", w.weekKey).maybeSingle(), "brief_runs");
    console.log(`redo ${w.weekKey}: ${n} papers in the Sunday slot; current status=${run?.status} late_batch=${run?.late_batch}`);
    must(await db().from("brief_runs").update({ status: "pending", lease_expires: null, snapshot: null, late_batch: false, error_summary: "redo: replacing late-batch brief with complete brief" }).eq("week_key", w.weekKey), "reset run");
    const prev = (await db().from("send_log").select("provider_message_id,status").eq("week_key", w.weekKey).eq("channel", "email")).data ?? [];
    for (const p of prev) console.log(`send_log: previous ${p.status} message ${p.provider_message_id ?? "-"} will be superseded`);
    must(await db().from("send_log").update({ status: "pending", created_at: new Date(Date.now() - 3600_000).toISOString(), last_error: `superseded by complete brief; previous message ${prev[0]?.provider_message_id ?? "-"}` }).eq("week_key", w.weekKey).eq("channel", "email"), "reset send_log");
    const r = await runWeekly(now);
    console.log("runWeekly:", r, `${Math.round((Date.now() - t0) / 1000)} s`);
    if (r.status === "published") console.log("deliver:", await deliver(now));
  } else if (cmd === "weekly-force") {
    // Publish now even though the Sunday batch is not visible yet. Labelled late_batch. Does NOT send email.
    const r = await runWeekly(new Date(), { force: true });
    console.log("runWeekly(force):", r, `${Math.round((Date.now() - t0) / 1000)} s`);
  } else if (cmd === "weekly") {
    const r = await runWeekly(new Date());
    console.log("runWeekly:", r, `${Math.round((Date.now() - t0) / 1000)} s`);
    if (r.status === "published" || r.status === "already-published") console.log("deliver:", await deliver(new Date()));
  } else if (cmd !== "counts") {
    console.error("usage: phase1.ts daily [days] | weekly-dry | weekly | weekly-force | weekly-redo | counts"); process.exit(2);
  }
  await counts();
}
main().catch((e) => { console.error("FAILED:", String(e?.message ?? e).slice(0, 600)); process.exit(1); });
