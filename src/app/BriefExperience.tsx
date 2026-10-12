"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Brief } from "@/lib/types";
import { RunControls } from "./RunControls";
import { useSetWeek } from "./Shell";
import {
  SEGMENTS, VERDICTS, VERDICT_LABEL, authorsLine, buildView, cleanFinding, evidenceLabel, numberSegments,
  plural, ringArcs, shortTitle, weekLabel, type Filter, type PaperView,
} from "@/lib/view";

const fmtUtc = (iso: string) => new Date(iso).toUTCString().slice(5, 22) + " UTC";
const fmtDay = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

export function BriefExperience({ brief, rung, stale, admin = false }: { brief: Brief; rung: "db" | "blob" | "seed"; stale: boolean; admin?: boolean }) {
  const setWeek = useSetWeek();
  const [filter, setFilter] = useState<Filter>("all");
  const [sel, setSel] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const returnFocus = useRef<HTMLElement | null>(null);
  const closeBtn = useRef<HTMLButtonElement | null>(null);

  useEffect(() => { setWeek(weekLabel(brief.week_key)); return () => setWeek(""); }, [brief.week_key, setWeek]);
  useEffect(() => { const t = setTimeout(() => setMounted(true), 150); return () => clearTimeout(t); }, []);

  const view = useMemo(() => buildView(brief, filter), [brief, filter]);
  const byId = useMemo(() => new Map(view.all.map((p) => [p.card.arxiv_id, p])), [view.all]);
  const total = view.all.length;
  const rings = ringArcs(view.counts);

  const openPaper = useCallback((id: string) => {
    returnFocus.current = document.activeElement as HTMLElement | null;
    setSel(id); setOpen(true);
  }, []);
  const close = useCallback(() => { setOpen(false); returnFocus.current?.focus?.(); }, []);
  const step = useCallback((dir: number) => {
    setSel((cur) => { const i = view.order.indexOf(cur ?? ""); const n = view.order[i + dir]; return n ?? cur; });
  }, [view.order]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
      else if (e.key === "ArrowRight") step(1);
      else if (e.key === "ArrowLeft") step(-1);
    };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeBtn.current?.focus();
    return () => { window.removeEventListener("keydown", onKey); document.body.style.overflow = prev; };
  }, [open, close, step]);

  const cur: PaperView | undefined = sel ? byId.get(sel) : undefined;
  const pi = cur ? view.order.indexOf(cur.card.arxiv_id) : -1;
  const segIndex = Math.max(0, SEGMENTS.findIndex((s) => s.value === filter));
  const seed = rung === "seed";
  let rowIndex = 0;

  return (
    <>
      <header className="hero">
        <div className="eyebrow">{brief.week_key} · {brief.label}</div>
        <h1>{weekLabel(brief.week_key)}</h1>
        <div className="sub">Generated {fmtUtc(brief.generated_at)}</div>
      </header>

      {admin && <RunControls refreshOnDone />}

      {seed && <div className="notice glass" role="status"><b>Offline snapshot.</b> The live database was unreachable or no brief has been published yet, so this is the committed seed brief.</div>}
      {!seed && stale && <div className="notice glass" role="status"><b>Stale.</b> This is the last good brief; the latest run has not completed.{rung === "blob" ? " Served from the snapshot copy." : ""}</div>}
      {brief.partial && !seed && <div className="notice glass" role="status">Partial brief: some domains could not be completed this week and are labelled below.</div>}

      <section className="summary glass" aria-label="Summary">
        <div className="rings" role="img" aria-label={`${view.counts.flag} flagged for client, ${view.counts.read} to read, ${view.counts.skim} to skim`}>
          <svg viewBox="0 0 148 148" width="148" height="148" aria-hidden>
            {rings.map((r, i) => (
              <g key={r.verdict}>
                <circle cx="74" cy="74" r={r.r} fill="none" strokeWidth="13" style={{ stroke: `var(--${r.verdict}-ring)` }} />
                <circle className="arc" cx="74" cy="74" r={r.r} fill="none" strokeWidth="13" strokeLinecap="round"
                  strokeDasharray={r.circumference.toFixed(1)}
                  strokeDashoffset={(mounted ? r.circumference * (1 - r.fraction) : r.circumference).toFixed(1)}
                  style={{ stroke: `var(--${r.verdict}-dot)`, transitionDelay: `${i * 0.15}s` }} />
              </g>
            ))}
          </svg>
        </div>
        <div className="sumtext">
          <div>
            <div className="big">{plural(total, "paper")} · {plural(view.domainCount, "domain")}</div>
            <div className="small">About {brief.reading_minutes} min read</div>
          </div>
          <div className="tiles">
            {VERDICTS.map((v) => (
              <button key={v} type="button" className={`tile ${v}`} aria-pressed={filter === v} onClick={() => setFilter((f) => (f === v ? "all" : v))}>
                <span className="n">{view.counts[v]}</span>
                <span className="l">{VERDICT_LABEL[v]}</span>
              </button>
            ))}
          </div>
          {brief.notes.map((n) => <div key={n} className="note">{n}</div>)}
        </div>
      </section>

      <div className="seg-stick">
        <div className="seg glass" role="radiogroup" aria-label="Filter papers">
          <div className="thumb" style={{ left: `calc(3px + ${segIndex} * ((100% - 6px) / 4))` }} />
          {SEGMENTS.map((s) => (
            <button key={s.value} type="button" role="radio" aria-checked={filter === s.value} onClick={() => setFilter(s.value)}>{s.label}</button>
          ))}
        </div>
      </div>

      {filter === "all" && view.flagged.length > 0 && (
        <section className="flagged" aria-label="Flagged for client">
          <div className="sechead"><h2>Flagged for client</h2><span>Swipe</span></div>
          <div className="rail">
            {view.flagged.map((p) => (
              <button key={p.card.arxiv_id} type="button" className="fcard" onClick={() => openPaper(p.card.arxiv_id)}>
                <span className="dom"><i />{p.domainName}</span>
                <span className="t">{shortTitle(p.card.title)}</span>
                <span className="w">{p.card.why_it_matters}</span>
              </button>
            ))}
          </div>
        </section>
      )}

      {view.domains.map((d) => (
        <section key={d.id} id={`d-${d.id}`} className="domain" aria-label={d.name}>
          <div className="domhead"><h2>{d.name}</h2><span>{plural(d.papers.length, "paper")}</span></div>
          <div className="group glass">
            {d.papers.length === 0 && <p className="quiet">{d.note ?? "Nothing cleared the bar this week."}</p>}
            {d.papers.map((p) => (
              <button key={p.card.arxiv_id} type="button" className="row" style={{ animationDelay: `${Math.min(rowIndex++ * 35, 600)}ms` }} onClick={() => openPaper(p.card.arxiv_id)}>
                <span className={`dot ${p.verdict}`} aria-hidden />
                <span className="rowbody">
                  <span className="rowtext">
                    <span className="rowtitle">{p.card.title}</span>
                    <span className="rowwhy">{p.card.why_it_matters}</span>
                    <span className="rowmeta">
                      <span className={`pill ${p.verdict}`}>{VERDICT_LABEL[p.verdict]}</span>
                      <small>{plural(p.card.claims.length, "finding")}</small>
                    </span>
                  </span>
                  <svg className="chev" width="8" height="14" viewBox="0 0 8 14" aria-hidden><path d="M1 1l6 6-6 6" fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
                </span>
              </button>
            ))}
          </div>
        </section>
      ))}
      {total === 0 && <p className="empty">No papers in this brief.</p>}

      <div className={`scrim${open ? " on" : ""}`} onClick={close} aria-hidden />
      <div className="sheetwrap">
        <div className={`sheet${open ? " on" : ""}`} role="dialog" aria-modal="true" aria-label={cur ? cur.card.title : "Paper details"} aria-hidden={!open}>
          <div className="grab" aria-hidden><i /></div>
          <div className="sheetbar">
            <span className="pos" aria-live="polite">{pi >= 0 ? `${pi + 1} of ${view.order.length}` : ""}</span>
            <div className="btns">
              <button type="button" className="circ" aria-label="Previous paper" disabled={pi <= 0} tabIndex={open ? 0 : -1} onClick={() => step(-1)}>
                <svg width="8" height="14" viewBox="0 0 8 14" fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M7 1L1 7l6 6" /></svg>
              </button>
              <button type="button" className="circ" aria-label="Next paper" disabled={pi < 0 || pi >= view.order.length - 1} tabIndex={open ? 0 : -1} onClick={() => step(1)}>
                <svg width="8" height="14" viewBox="0 0 8 14" fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M1 1l6 6-6 6" /></svg>
              </button>
              <button type="button" ref={closeBtn} className="circ" aria-label="Close" tabIndex={open ? 0 : -1} onClick={close}>
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none" strokeWidth="2" strokeLinecap="round" aria-hidden><path d="M1 1l10 10M11 1L1 11" /></svg>
              </button>
            </div>
          </div>
          {cur && (
            <div className="sheetbody">
              <div className="sheettags"><span className={`pill ${cur.verdict}`}>{VERDICT_LABEL[cur.verdict]}</span><span className="dn">{cur.domainName}</span></div>
              <h2>{cur.card.title}</h2>
              <div className="byline">{authorsLine(cur.card.authors)}<br />arXiv {cur.card.arxiv_id} · submitted {fmtDay(cur.card.published)} · abstract-only · {evidenceLabel(cur.card.evidence_type)}</div>
              <div className="callout why"><span className="k">Why it matters</span><span className="v">{cur.card.why_it_matters}</span></div>
              <div className="finds">
                <span className="k">Reported in abstract</span>
                <ol className="findlist">
                  {cur.card.claims.map((c, i) => (
                    <li key={i}>
                      <span className="n">{i + 1}</span>
                      <p>{numberSegments(cleanFinding(c.claim)).map((s, j) => (s.num ? <mark key={j}>{s.t}</mark> : <span key={j}>{s.t}</span>))}</p>
                    </li>
                  ))}
                </ol>
              </div>
              <div className="callout cav"><span className="k">Caveat</span><span className="v">{cur.card.caveat}</span></div>
              <a className="cta" href={cur.card.url} target="_blank" rel="noopener noreferrer">Open on arXiv</a>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
