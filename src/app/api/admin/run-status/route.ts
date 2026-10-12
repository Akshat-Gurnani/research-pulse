import { NextResponse } from "next/server";
import { checkAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { weekKey } from "@/lib/time";

export const dynamic = "force-dynamic";

/** Progress of the current week's run, for the "Generate now" button. Admin session only. */
export async function GET(req: Request) {
  if (!checkAdmin(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const wk = weekKey(new Date());
  const { data, error } = await db().from("brief_runs")
    .select("week_key,status,started_at,lease_expires,published_at,calls_used,word_count,reading_minutes,late_batch,error_summary,window_label")
    .eq("week_key", wk).maybeSingle();
  if (error) return NextResponse.json({ error: "database unavailable" }, { status: 503 });
  return NextResponse.json({ run: data ?? null, now: new Date().toISOString() }, { headers: { "cache-control": "no-store" } });
}
