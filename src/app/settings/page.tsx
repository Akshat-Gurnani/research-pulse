import { cookies } from "next/headers";
import { verifySession } from "@/lib/auth";
import { db } from "@/lib/db";
import { SettingsClient } from "./client";
export const dynamic = "force-dynamic";

export default async function Settings() {
  const c = await cookies();
  const authed = verifySession(`rp_admin=${encodeURIComponent(c.get("rp_admin")?.value ?? "")}`);
  let domains: any[] = [];
  if (authed) { try { domains = (await db().from("domains").select("*").eq("active", true).order("sort")).data ?? []; } catch {} }
  return (
    <div className="page">
      <header className="hero">
        <div className="eyebrow">Admin</div>
        <h1>Domains</h1>
        <div className="sub">The brief covers these domains. Edit here; no code change or redeploy needed. Changes apply from the next ingest.</div>
      </header>
      <SettingsClient authed={authed} initial={domains.map((d) => ({ name: d.name, arxiv_categories: d.arxiv_categories, phrases: d.phrases, exclude_phrases: d.exclude_phrases, active: true }))} />
    </div>
  );
}
