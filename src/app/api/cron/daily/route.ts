import { NextResponse } from "next/server";
import { checkBearer, logTrigger, triggerSource } from "@/lib/auth";
import { ingestDaily, runWeekly, deliver } from "@/lib/pipeline";
import { weekKey } from "@/lib/time";
import { db } from "@/lib/db";
import { opt } from "@/lib/config";

export const dynamic = "force-dynamic";
export const maxDuration = 300;
export const runtime = "nodejs";

async function handle(req: Request) {
  const src = triggerSource(req);
  if (!checkBearer(req)) { await logTrigger(src, "daily", false, "bad-secret"); return NextResponse.json({ error: "unauthorized" }, { status: 401 }); }
  const now = new Date(); const wk = weekKey(now);
  await logTrigger(src, "daily", true, undefined, wk);
  const ingest = await ingestDaily(now);
  // Catch-up: if this week's brief is not published yet, try to publish and deliver it (idempotent).
  const run = (await db().from("brief_runs").select("status").eq("week_key", wk).maybeSingle()).data;
  let catchUp: unknown = null;
  if (run?.status !== "published" && now.getUTCDay() >= 1) {
    try { catchUp = await runWeekly(now, { ingestFirst: false }); } catch (e: any) { catchUp = { error: String(e.message) }; }
  }
  const pub = (await db().from("brief_runs").select("status").eq("week_key", wk).maybeSingle()).data?.status === "published";
  const sent = pub ? await deliver(now) : null; // exactly-once via send_log
  const hc = opt("HEALTHCHECK_DAILY_URL"); if (hc && !ingest.error) { try { await fetch(hc, { signal: AbortSignal.timeout(5000) }); } catch {} }
  return NextResponse.json({ ok: true, ingest, catchUp, sent });
}
export const GET = handle;
export const POST = handle;
