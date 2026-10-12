import { notFound } from "next/navigation";
import { loadBrief } from "@/lib/brief";
import { BriefExperience } from "@/app/BriefExperience";
export const dynamic = "force-dynamic";
export default async function Week({ params }: { params: Promise<{ week: string }> }) {
  const { week } = await params;
  if (!/^\d{4}-W\d{2}$/.test(week)) notFound();
  const r = await loadBrief(week);
  // The seed is only a fallback for the latest brief; never present it as a specific past or future week.
  if (r.rung === "seed") notFound();
  return <BriefExperience brief={r.brief} rung={r.rung} stale={r.stale} />;
}
