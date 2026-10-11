import { loadBrief } from "@/lib/brief";
import { BriefView } from "./BriefView";
export const dynamic = "force-dynamic";
export default async function Home() { const r = await loadBrief(); return <BriefView {...r} />; }
