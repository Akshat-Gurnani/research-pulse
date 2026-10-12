import { cookies } from "next/headers";
import { loadBrief } from "@/lib/brief";
import { verifySession } from "@/lib/auth";
import { BriefExperience } from "./BriefExperience";
export const dynamic = "force-dynamic";

export default async function Home() {
  const [r, c] = await Promise.all([loadBrief(), cookies()]);
  // Owner-only controls: shown for a verified admin session and for nobody else.
  const admin = verifySession(`rp_admin=${encodeURIComponent(c.get("rp_admin")?.value ?? "")}`);
  return <BriefExperience brief={r.brief} rung={r.rung} stale={r.stale} admin={admin} />;
}
