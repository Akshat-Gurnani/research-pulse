import { NextResponse } from "next/server";
import { db } from "@/lib/db";
export const dynamic = "force-dynamic";
export async function GET() {
  try { const { error } = await db().from("heartbeats").select("name").limit(1); return NextResponse.json({ ok: !error, db: !error }); }
  catch { return NextResponse.json({ ok: true, db: false }); } // the site still serves from Blob/seed
}
