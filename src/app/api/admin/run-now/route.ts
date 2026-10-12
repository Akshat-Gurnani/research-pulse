import { NextResponse, after } from "next/server";
import { checkAdmin, logTrigger, sameOrigin } from "@/lib/auth";
import { runWeekly, deliver } from "@/lib/pipeline";
import { opt } from "@/lib/config";
import { db } from "@/lib/db";
import { weekKey } from "@/lib/time";

export const dynamic = "force-dynamic";
export const maxDuration = 300;
export const runtime = "nodejs";

const ADMIN_COOLDOWN_MS = 60_000;      // you, from the website
const EXAMINER_COOLDOWN_MS = 3_600_000; // graders, via the token header

/**
 * Manual triggers.
 *   mode=regenerate  (admin session only) re-run THIS week now and replace the published brief. Runs in the background
 *                    and answers 202; poll /api/admin/run-status. No email is sent.
 *   mode=test        dry-run the whole pipeline, publish nothing (admin or examiner token).
 *   mode=send-test   email the current brief to RECIPIENT_EMAIL only, not logged in send_log (admin or examiner token).
 */
export async function POST(req: Request) {
  const admin = checkAdmin(req) && sameOrigin(req);
  const tok = req.headers.get("x-examiner-token");
  const examiner = !!opt("EXAMINER_TOKEN") && tok === opt("EXAMINER_TOKEN");
  const mode = new URL(req.url).searchParams.get("mode") ?? "test";
  if (!admin && !examiner) { await logTrigger("manual", "run-now", false, "unauthorized"); return NextResponse.json({ error: "unauthorized" }, { status: 401 }); }
  if (mode === "regenerate" && !admin) { await logTrigger("manual", "run-now", false, "regenerate-needs-admin"); return NextResponse.json({ error: "regenerate needs the admin session" }, { status: 403 }); }

  const windowMs = admin ? ADMIN_COOLDOWN_MS : EXAMINER_COOLDOWN_MS;
  const since = new Date(Date.now() - windowMs).toISOString();
  const { count } = await db().from("trigger_events").select("id", { count: "exact", head: true }).eq("route", "run-now").eq("accepted", true).gte("received_at", since);
  if ((count ?? 0) >= 1) return NextResponse.json({ error: `cooldown: wait ${Math.round(windowMs / 1000)} s between runs` }, { status: 429 });

  if (mode === "regenerate") {
    const wk = weekKey(new Date());
    const cur = (await db().from("brief_runs").select("status,lease_expires").eq("week_key", wk).maybeSingle()).data;
    if (cur?.status === "running" && cur.lease_expires && new Date(cur.lease_expires).getTime() > Date.now()) {
      return NextResponse.json({ error: "a run is already in progress", week_key: wk }, { status: 409 });
    }
    await logTrigger("manual", "run-now", true, "regenerate", wk);
    const startedAt = new Date().toISOString();
    after(async () => {
      try { await runWeekly(new Date(), { force: true, regenerate: true }); }
      catch (e) { console.error("regenerate failed", e); } // runWeekly already restored the week's status
    });
    return NextResponse.json({ started: true, mode, week_key: wk, at: startedAt }, { status: 202 });
  }

  await logTrigger("manual", "run-now", true);
  if (mode === "send-test") {
    const to = opt("RECIPIENT_EMAIL");
    if (!to) return NextResponse.json({ error: "RECIPIENT_EMAIL not set" }, { status: 400 });
    return NextResponse.json(await deliver(new Date(), to));
  }
  return NextResponse.json(await runWeekly(new Date(), { dryRun: true }));
}
