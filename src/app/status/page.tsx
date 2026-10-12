import { db } from "@/lib/db";
import { weekKey } from "@/lib/time";
export const dynamic = "force-dynamic";

const utc = (iso: string) => new Date(iso).toUTCString().slice(5, 22) + " UTC";

export default async function Status() {
  let runs: any[] = [], trig: any[] = [], health: any[] = [], hb: any = null, err = "";
  try {
    runs = (await db().from("brief_runs").select("week_key,status,ladder_level,partial,published_at,calls_used,reading_minutes,error_summary,window_label").order("week_key", { ascending: false }).limit(8)).data ?? [];
    trig = (await db().from("trigger_events").select("received_at,source,route,accepted,reject_reason").neq("route", "login").order("received_at", { ascending: false }).limit(20)).data ?? [];
    health = (await db().from("source_health").select("*")).data ?? [];
    hb = (await db().from("heartbeats").select("at").eq("name", "daily").maybeSingle()).data;
  } catch (e: any) { err = String(e.message ?? e); }
  const last = runs.find((r) => r.status === "published");
  const age = last?.published_at ? (Date.now() - new Date(last.published_at).getTime()) / 86400000 : null;
  const cls = age == null ? "bad" : age <= 8 ? "ok" : age <= 15 ? "warn" : "bad";
  return (
    <div className="page">
      <header className="hero">
        <div className="eyebrow">Week now: {weekKey(new Date())}</div>
        <h1>Status</h1>
        <div className="sub">
          Last successful run: <span className={cls}>{last ? `${last.week_key} (${utc(last.published_at)})` : "none yet"}</span>
          {" · "}last daily heartbeat: {hb ? utc(hb.at) : "none"}
        </div>
      </header>
      {err && <div className="banner" role="alert">Database unreachable ({err}). The public brief is being served from the snapshot or seed.</div>}

      <section className="card glass">
        <h2>Brief runs</h2>
        <div className="tablewrap"><table>
          <thead><tr><th>Week</th><th>Status</th><th>Ladder</th><th>Calls</th><th>Min</th><th>Note</th></tr></thead>
          <tbody>
            {runs.map((r) => (
              <tr key={r.week_key}><td>{r.week_key}</td><td className={r.status === "published" ? "ok" : r.status === "failed" ? "bad" : "warn"}>{r.status}</td>
                <td>{r.ladder_level}{r.partial ? " (partial)" : ""}</td><td>{r.calls_used}</td><td>{r.reading_minutes ?? ""}</td><td className="wrap">{r.error_summary ?? r.window_label ?? ""}</td></tr>
            ))}
          </tbody>
        </table></div>
      </section>

      <section className="card glass">
        <h2>Last 20 triggers</h2>
        <p className="meta">Proof of which alarm arrived.</p>
        <div className="tablewrap"><table>
          <thead><tr><th>When (UTC)</th><th>Source</th><th>Route</th><th>Result</th></tr></thead>
          <tbody>
            {trig.map((t, i) => (
              <tr key={i}><td>{new Date(t.received_at).toUTCString().slice(5, 25)}</td><td>{t.source}</td><td>{t.route}</td>
                <td className={t.accepted ? "ok" : "bad"}>{t.accepted ? "accepted" : t.reject_reason}</td></tr>
            ))}
          </tbody>
        </table></div>
      </section>

      <section className="card glass">
        <h2>Sources</h2>
        <div className="tablewrap"><table>
          <thead><tr><th>Source</th><th>Last ok</th><th>Failures</th><th>Last error</th></tr></thead>
          <tbody>
            {health.map((h) => (
              <tr key={h.source}><td>{h.source}</td><td>{h.last_ok_at ? utc(h.last_ok_at) : "never"}</td>
                <td className={h.consecutive_failures ? "warn" : "ok"}>{h.consecutive_failures}</td><td className="wrap">{h.last_error_class ?? ""}</td></tr>
            ))}
          </tbody>
        </table></div>
      </section>
    </div>
  );
}
