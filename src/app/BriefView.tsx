import type { Brief } from "@/lib/types";

export function BriefView({ brief, stale, rung }: { brief: Brief; stale: boolean; rung: string }) {
  const seed = rung === "seed";
  return (<>
    <h1>Research Pulse</h1>
    <p className="meta">{brief.week_key} · {brief.label} · about {brief.reading_minutes} min read · generated {new Date(brief.generated_at).toUTCString().slice(5, 22)} UTC</p>
    {seed && <div className="banner"><b>Offline snapshot.</b> The live database was unreachable or no brief has been published yet, so this is the committed seed brief.</div>}
    {!seed && stale && <div className="banner"><b>Stale.</b> This is the last good brief; the latest run has not completed. {rung === "blob" ? "Served from the snapshot copy." : ""}</div>}
    {brief.partial && !seed && <div className="banner">Partial brief: some domains could not be completed this week and are labelled below.</div>}
    {brief.notes.map((n) => <p key={n} className="meta">• {n}</p>)}
    {brief.domains.map((d) => (
      <section key={d.id}>
        <h2>{d.name}</h2>
        {d.items.length === 0 && <p className="quiet">{d.note ?? "Nothing cleared the bar this week."}</p>}
        {d.items.map((c) => (
          <article className="card" key={c.arxiv_id}>
            <h3><a href={c.url} rel="noopener noreferrer">{c.title}</a><span className="tag">{c.action.replace(/_/g, " ")}</span></h3>
            <p className="meta">{c.authors.join(", ")} · {c.evidence_type.replace(/_/g, " ")} · abstract-only{c.carried_over ? " · carried over" : ""}</p>
            <p>{c.claims.map((x) => x.claim).join(" ")}</p>
            <p><span className="lbl">Why it matters</span><br />{c.why_it_matters}</p>
            <p><span className="lbl">Caveat</span><br />{c.caveat}</p>
          </article>
        ))}
      </section>
    ))}
  </>);
}
