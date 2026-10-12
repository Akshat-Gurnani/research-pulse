import { cookies } from "next/headers";
import { loadBrief } from "@/lib/brief";
import { verifySession } from "@/lib/auth";
import { BriefView } from "./BriefView";
import { RunControls } from "./RunControls";
export const dynamic = "force-dynamic";

export default async function Home() {
  const [r, c] = await Promise.all([loadBrief(), cookies()]);
  // Owner-only: the button exists for a verified admin session and for nobody else.
  const admin = verifySession(`rp_admin=${encodeURIComponent(c.get("rp_admin")?.value ?? "")}`);
  return (<>
    {admin && <RunControls refreshOnDone />}
    <BriefView {...r} />
  </>);
}
