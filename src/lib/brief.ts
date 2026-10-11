import { opt } from "./config";
import { db } from "./db";
import type { Brief } from "./types";
import seed from "../../data/seed-brief.json";

const STALE_DAYS = 8;
export const ageDays = (b: Brief, now = new Date()) => (now.getTime() - new Date(b.generated_at).getTime()) / 86400000;

async function fromBlob(): Promise<Brief | null> {
  const base = opt("BLOB_PUBLIC_URL");
  if (!base) return null;
  try { const r = await fetch(`${base}/latest-brief.json`, { cache: "no-store", signal: AbortSignal.timeout(5000) }); return r.ok ? ((await r.json()) as Brief) : null; } catch { return null; }
}

/** Four-rung read ladder: database -> blob snapshot -> committed seed. The page never calls arXiv or Gemini. */
export async function loadBrief(weekKey?: string): Promise<{ brief: Brief; stale: boolean; rung: "db" | "blob" | "seed" }> {
  try {
    let q = db().from("brief_runs").select("snapshot").eq("status", "published").not("snapshot", "is", null).order("published_at", { ascending: false }).limit(1);
    if (weekKey) q = db().from("brief_runs").select("snapshot").eq("week_key", weekKey).not("snapshot", "is", null).limit(1);
    const { data, error } = await q;
    if (!error && data?.[0]?.snapshot) { const b = data[0].snapshot as Brief; return { brief: { ...b, origin: "db" }, stale: ageDays(b) > STALE_DAYS, rung: "db" }; }
  } catch { /* fall through */ }
  if (!weekKey) { const b = await fromBlob(); if (b) return { brief: { ...b, origin: "blob" }, stale: true, rung: "blob" }; }
  return { brief: { ...(seed as unknown as Brief), origin: "seed" }, stale: true, rung: "seed" };
}
