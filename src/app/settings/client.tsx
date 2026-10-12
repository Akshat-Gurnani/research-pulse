"use client";
import { useEffect, useRef, useState } from "react";

type D = { name: string; arxiv_categories: string[]; phrases: string[]; exclude_phrases: string[]; active: boolean };
const csv = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);

export function SettingsClient({ authed, initial }: { authed: boolean; initial: D[] }) {
  const [pw, setPw] = useState(""); const [msg, setMsg] = useState(""); const [ds, setDs] = useState<D[]>(initial);
  const [run, setRun] = useState<{ busy: boolean; text: string; ok?: boolean }>({ busy: false, text: "" });
  const [mail, setMail] = useState("");
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
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
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  async function generate() {
    setRun({ busy: true, text: "Starting..." });
    const r = await fetch("/api/admin/run-now?mode=regenerate", { method: "POST" });
    const j = await r.json().catch(() => ({}));
    if (r.status !== 202) { setRun({ busy: false, ok: false, text: r.status === 409 ? "A run is already in progress. Give it a few minutes." : `Not started: ${j.error ?? "HTTP " + r.status}` }); return; }
    const t0 = Date.parse(j.at) - 2000;
    let sawRunning = false;
    for (let i = 0; i < 100 && alive.current; i++) {
      await sleep(4000);
      const s = await fetch("/api/admin/run-status", { cache: "no-store" }).then((x) => x.json()).catch(() => null);
      const rn = s?.run;
      if (!rn) { setRun({ busy: true, text: `Waiting for the run to register... ${(i + 1) * 4}s` }); continue; }
      if (rn.status === "running") { sawRunning = true; setRun({ busy: true, text: `Running... ${(i + 1) * 4}s (usually 1 to 3 minutes)` }); continue; }
      if (sawRunning || i >= 3) {
        const fresh = rn.published_at && Date.parse(rn.published_at) >= t0;
        if (rn.status === "published" && fresh) { setRun({ busy: false, ok: true, text: `Done. Published ${rn.week_key}: about ${rn.reading_minutes} min read, ${rn.word_count} words${rn.late_batch ? ", labelled as missing the latest arXiv batch" : ""}.` }); return; }
        setRun({ busy: false, ok: false, text: `The run did not publish a new brief. ${rn.error_summary ?? ""} The previous brief is still being served.` }); return;
      }
    }
    setRun({ busy: false, ok: false, text: "Still running after several minutes. Check the Status page." });
  }
  async function emailMe() {
    setMail("Sending...");
    const r = await fetch("/api/admin/run-now?mode=send-test", { method: "POST" });
    const j = await r.json().catch(() => ({}));
    setMail(r.ok ? `Sent ${j.sent ?? 0} email(s) to the owner address${j.errors?.length ? `; errors: ${j.errors.join("; ")}` : ""}.` : `Not sent: ${j.error ?? "HTTP " + r.status}`);
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
    <p className="meta">{msg}</p>
    <div className="dom">
      <h2 style={{ marginTop: 0 }}>Run the brief now</h2>
      <p className="meta">Re-runs this week on demand: fetches the latest papers, scores and summarises anything new (already-processed papers are reused, so repeat runs are cheap), and replaces the published brief. The current brief stays online until the new one is ready. No email is sent by this button.</p>
      <p><button type="button" disabled={run.busy} onClick={generate}>{run.busy ? "Running..." : "Generate this week's brief now"}</button>{" "}
        <a href="/" style={{ marginLeft: 8 }}>View the brief</a></p>
      <p className="meta" role="status" style={{ color: run.ok === false ? "var(--ochre)" : undefined }}>{run.text}</p>
      <p><button type="button" onClick={emailMe}>Email me the current brief</button></p>
      <p className="meta" role="status">{mail}</p>
    </div>
  </div>);
}
