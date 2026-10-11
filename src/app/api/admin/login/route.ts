import { NextResponse } from "next/server";
import { checkPassword, makeSession, sessionCookie, sameOrigin } from "@/lib/auth";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";
export async function POST(req: Request) {
  if (!sameOrigin(req)) return NextResponse.json({ error: "bad origin" }, { status: 403 });
  // throttle: max 8 failed attempts per 15 minutes (stored in trigger_events so it survives cold starts)
  const since = new Date(Date.now() - 15 * 60_000).toISOString();
  const { count } = await db().from("trigger_events").select("id", { count: "exact", head: true }).eq("route", "login").eq("accepted", false).gte("received_at", since);
  if ((count ?? 0) >= 8) return NextResponse.json({ error: "too many attempts" }, { status: 429 });
  const { password } = await req.json().catch(() => ({ password: "" }));
  if (!checkPassword(String(password ?? ""))) { await db().from("trigger_events").insert({ source: "admin", route: "login", accepted: false, reject_reason: "bad-password" }); return NextResponse.json({ error: "invalid" }, { status: 401 }); }
  const res = NextResponse.json({ ok: true });
  res.headers.append("set-cookie", sessionCookie(makeSession()));
  return res;
}
