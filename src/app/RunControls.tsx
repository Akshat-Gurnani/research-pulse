"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Owner-only controls: re-run this week's brief on demand, or email the current brief to the owner.
 * Rendered only for a signed-in admin session (checked on the server); the API enforces the same, so a
 * visitor who never sees it still cannot trigger anything.
 */
export function RunControls({ showViewLink = false, refreshOnDone = false }: { showViewLink?: boolean; refreshOnDone?: boolean }) {
  const router = useRouter();
  const [run, setRun] = useState<{ busy: boolean; text: string; ok?: boolean }>({ busy: false, text: "" });
  const [mail, setMail] = useState("");
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  async function generate() {
    setRun({ busy: true, text: "Starting..." });
    const r = await fetch("/api/admin/run-now?mode=regenerate", { method: "POST" });
    const j = await r.json().catch(() => ({}));
    if (r.status !== 202) {
      setRun({ busy: false, ok: false, text: r.status === 409 ? "A run is already in progress. Give it a few minutes." : r.status === 429 ? "Please wait a minute between runs." : r.status === 401 ? "Your admin session has expired. Sign in again on the Domains page." : `Not started: ${j.error ?? "HTTP " + r.status}` });
      return;
    }
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
        if (rn.status === "published" && fresh) {
          setRun({ busy: false, ok: true, text: `Done. Published ${rn.week_key}: about ${rn.reading_minutes} min read, ${rn.word_count} words${rn.late_batch ? ", labelled as missing the latest arXiv batch" : ""}.` });
          if (refreshOnDone) router.refresh();
          return;
        }
        setRun({ busy: false, ok: false, text: `The run did not publish a new brief. ${rn.error_summary ?? ""} The previous brief is still being served.` });
        return;
      }
    }
    setRun({ busy: false, ok: false, text: "Still running after several minutes. Check the Status page." });
  }

  async function emailMe() {
    setMail("Sending...");
    const r = await fetch("/api/admin/run-now?mode=send-test", { method: "POST" });
    const j = await r.json().catch(() => ({}));
    setMail(r.ok ? `Sent ${j.sent ?? 0} email(s) to the owner address${j.errors?.length ? `; errors: ${j.errors.join("; ")}` : ""}.` : r.status === 429 ? "Please wait a minute between runs." : `Not sent: ${j.error ?? "HTTP " + r.status}`);
  }

  return (
    <section className="dom glass" data-testid="run-controls" aria-label="Run the brief now">
      <h2 style={{ marginTop: 0, fontSize: 18 }}>Run the brief now</h2>
      <p className="meta">Re-runs this week on demand: fetches the latest papers, scores and summarises anything new (already-processed papers are reused, so repeat runs are cheap), and replaces the published brief. The current brief stays online until the new one is ready. No email is sent by this button.</p>
      <p>
        <button type="button" disabled={run.busy} onClick={generate}>{run.busy ? "Running..." : "Generate this week's brief now"}</button>
        {showViewLink && <a href="/" style={{ marginLeft: 12 }}>View the brief</a>}
      </p>
      <p className="meta" role="status" style={{ color: run.ok === false ? "var(--ochre)" : undefined }}>{run.text}</p>
      <p><button type="button" className="ghost" onClick={emailMe}>Email me the current brief</button></p>
      <p className="meta" role="status">{mail}</p>
    </section>
  );
}
