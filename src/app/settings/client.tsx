"use client";
import { useState } from "react";

type D = { name: string; arxiv_categories: string[]; phrases: string[]; exclude_phrases: string[]; active: boolean };
const csv = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);

export function SettingsClient({ authed, initial }: { authed: boolean; initial: D[] }) {
  const [pw, setPw] = useState(""); const [msg, setMsg] = useState(""); const [ds, setDs] = useState<D[]>(initial);
  async function login() {
    const r = await fetch("/api/admin/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password: pw }) });
    if (r.ok) location.reload(); else setMsg(r.status === 429 ? "Too many attempts. Try again later." : "Wrong password.");
  }
  async function save() {
    setMsg("Saving...");
    const r = await fetch("/api/settings", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(ds) });
    const j = await r.json().catch(() => ({}));
    setMsg(r.ok ? `Saved ${j.count} domains.` : `Not saved: ${j.error ?? "error"} ${(j.issues ?? []).join("; ")}`);
  }
  const up = (i: number, p: Partial<D>) => setDs(ds.map((d, j) => (j === i ? { ...d, ...p } : d)));
  if (!authed) return (<div><label>Admin password</label><input type="password" value={pw} onChange={(e) => setPw(e.target.value)} /> <button onClick={login}>Sign in</button><p className="meta">{msg}</p></div>);
  return (<div>
    {ds.map((d, i) => (<div className="dom" key={i}>
      <label>Name</label><input style={{ width: "100%" }} value={d.name} onChange={(e) => up(i, { name: e.target.value })} />
      <div className="row"><div><label>arXiv categories (comma separated, e.g. cs.AI, cs.CL)</label><input style={{ width: "100%" }} value={d.arxiv_categories.join(", ")} onChange={(e) => up(i, { arxiv_categories: csv(e.target.value) })} /></div>
      <div><label>Include phrases</label><input style={{ width: "100%" }} value={d.phrases.join(", ")} onChange={(e) => up(i, { phrases: csv(e.target.value) })} /></div></div>
      <label>Exclude phrases</label><input style={{ width: "100%" }} value={d.exclude_phrases.join(", ")} onChange={(e) => up(i, { exclude_phrases: csv(e.target.value) })} />
      <p><button type="button" onClick={() => setDs(ds.filter((_, j) => j !== i))}>Remove</button></p>
    </div>))}
    <p><button type="button" disabled={ds.length >= 10} onClick={() => setDs([...ds, { name: "", arxiv_categories: ["cs.AI"], phrases: [], exclude_phrases: [], active: true }])}>Add domain</button> <button type="button" onClick={save}>Save</button></p>
    <p className="meta">{msg}</p></div>);
}
