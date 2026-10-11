import { NextResponse } from "next/server";
import { checkBearer, logTrigger, triggerSource } from "@/lib/auth";
import { runWeekly, deliver } from "@/lib/pipeline";
import { weekKey } from "@/lib/time";

export const dynamic = "force-dynamic";
export const maxDuration = 300;
export const runtime = "nodejs";

async function handle(req: Request) {
  const src = triggerSource(req);
  if (!checkBearer(req)) { await logTrigger(src, "weekly", false, "bad-secret"); return NextResponse.json({ error: "unauthorized" }, { status: 401 }); }
  const now = new Date();
  await logTrigger(src, "weekly", true, undefined, weekKey(now));
  const result = await runWeekly(now);
  const sent = result.status === "published" || result.status === "already-published" ? await deliver(now) : null;
  return NextResponse.json({ ok: true, result, sent });
}
export const GET = handle;
export const POST = handle;
