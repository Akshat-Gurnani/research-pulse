import { loadBrief } from "@/lib/brief";
import { BriefView } from "@/app/BriefView";
export const dynamic = "force-dynamic";
export default async function Week({ params }: { params: Promise<{ week: string }> }) {
  const { week } = await params;
  const key = /^\d{4}-W\d{2}$/.test(week) ? week : undefined;
  const r = await loadBrief(key); return <BriefView {...r} />;
}
