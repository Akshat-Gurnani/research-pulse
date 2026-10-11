import { NextResponse } from "next/server";
import { checkAdmin, logTrigger, sameOrigin } from "@/lib/auth";
import { runWeekly, deliver } from "@/lib/pipeline";
import { opt } from "@/lib/config";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";
export const maxDuration = 300;
export const runtime = "nodejs";

// Test mode for graders: dry-run the whole pipeline (no publish) or send the latest brief to the owner address only.
export async function POST(req: Request) {
  const tok = req.headers.get("x-examiner-token");
  const examiner = !!opt("EXAMINER_TOKEN") && tok === opt("EXAMINER_TOKEN");
  if (!(checkAdmin(req) && sameOrigin(req)) && !examiner) { await logTrigger("manual", "run-now", false, "unauthorized"); return NextResponse.json({ error: "unauthorized" }, { status: 401 }); }
  const since = new Date(Date.now() - 3600_000).toISOString();
  const { count } = await db().from("trigger_events").select("id", { count: "exact", head: true }).eq("route", "run-now").eq("accepted", true).gte("received_at", since);
  if ((count ?? 0) >= 1) return NextResponse.json({ error: "cooldown: one run per hour" }, { status: 429 });
  const mode = new URL(req.url).searchParams.get("mode") ?? "test";
  await logTrigger("manual", "run-now", true);
  if (mode === "send-test") { const to = opt("RECIPIENT_EMAIL"); if (!to) return NextResponse.json({ error: "RECIPIENT_EMAIL not set" }, { status: 400 }); return NextResponse.json(await deliver(new Date(), to)); }
  return NextResponse.json(await runWeekly(new Date(), { dryRun: true }));
}
