import { z } from "zod";
import { put } from "@vercel/blob";
import { db, must } from "./db";
import { opt, limits, MAX_PER_DOMAIN, WORD_BUDGET } from "./config";
import { briefWindow, announceSlot, weekKey as wk, type BriefWindow } from "./time";
import { fetchRecent, isSuspicious, type Paper } from "./arxiv";
import { callJson, BudgetExceeded, type Budget } from "./gemini";
import { scoringPrompt, summaryPrompt } from "./prompts";
import { ScoreBatch, SummaryBatch, SCORE_PROMPT_VERSION, SUMMARY_PROMPT_VERSION } from "./schemas";
import { gateCard, cardWords, wordCount, readingMinutes, type CardIn } from "./validate";
import { scan, makeCanary } from "./inject";
import { hfDaily, hnFor } from "./signals";
import { rank, fitBudget, preselect, type Cand, type Fit } from "./select";
import { arxivUrl, type Brief, type BriefCard, type BriefDomain, type DomainRow } from "./types";
import { renderEmail, sendWithFailover } from "./mail";

const LEASE_MIN = 8;
const SCORE_CONCURRENCY = 3; // modest: free-tier RPM is unpublished; the call budget is still enforced per call
const TIME_BUDGET_MS = 240_000;
/** Run fn over items with at most n in flight. Never rejects: callers handle their own errors. */
async function runPool<T>(items: T[], n: number, fn: (x: T) => Promise<void>): Promise<void> {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) await fn(items[i++]); }));
}
const chunk = <T,>(a: T[], n: number) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n));
const hash = (s: string) => { let h = 5381; for (const c of s) h = ((h << 5) + h + c.charCodeAt(0)) >>> 0; return h.toString(36); };

export async function activeDomains(): Promise<DomainRow[]> {
  return must(await db().from("domains").select("*").eq("active", true).order("sort"), "domains") as DomainRow[];
}

async function health(source: string, ok: boolean, err?: string, total?: number) {
  const prev = (await db().from("source_health").select("*").eq("source", source).maybeSingle()).data;
  await db().from("source_health").upsert({
    source,
    last_ok_at: ok ? new Date().toISOString() : prev?.last_ok_at ?? null,
    last_fail_at: ok ? prev?.last_fail_at ?? null : new Date().toISOString(),
    consecutive_failures: ok ? 0 : (prev?.consecutive_failures ?? 0) + 1,
    last_error_class: ok ? null : err?.slice(0, 120),
    baseline_median: ok && total ? Math.round(((prev?.baseline_median ?? total) * 3 + total) / 4) : prev?.baseline_median ?? null,
  });
}

// --------------------------------------------------------------------------------------------
// DAILY: ingest with overlap, signals, keep-alive. Safe to run any number of times.
// --------------------------------------------------------------------------------------------
export async function ingestDaily(now = new Date(), days = 5) {
  const domains = await activeDomains();
  const cats = [...new Set(domains.flatMap((d) => d.arxiv_categories))];
  const out = { fetched: 0, upserted: 0, flagged: 0, suspicious: false, truncated: false, total: 0, error: undefined as string | undefined };
  try {
    const r = await fetchRecent(cats, now, days);
    out.fetched = r.papers.length;
    out.total = r.total;
    out.truncated = r.truncated;
    const baseline = (await db().from("source_health").select("baseline_median").eq("source", "arxiv").maybeSingle()).data?.baseline_median ?? null;
    out.suspicious = isSuspicious(r.total, baseline, false);
    await db().from("raw_fetch").insert({ source: "arxiv", n_items: r.total, valid: !out.suspicious, reject_reason: out.suspicious ? "suspicious-empty" : r.truncated ? "truncated-at-page-cap" : null, http_status: 200 });
    if (!out.suspicious) {
      const rows = r.papers.map((p) => {
        const s = scan(`${p.title}\n${p.abstract}\n${p.comment ?? ""}`);
        if (s.flagged) out.flagged++;
        return {
          arxiv_id: p.arxiv_id, title: p.title, abstract: p.abstract, authors: p.authors, categories: p.categories,
          primary_category: p.primary_category, published: p.published, updated: p.updated, latest_version: p.latest_version,
          announce_slot: announceSlot(new Date(p.published)).toISOString(), injection_flag: s.flagged, flag_reason: s.reasons.join(",") || null,
        };
      });
      for (const part of chunk(rows, 200)) must(await db().from("papers").upsert(part, { onConflict: "arxiv_id", ignoreDuplicates: false }), "upsert papers");
      out.upserted = rows.length;
      await health("arxiv", true, undefined, r.total);
    } else await health("arxiv", false, "suspicious-empty");
  } catch (e: any) {
    out.error = String(e.message ?? e);
    await health("arxiv", false, out.error);
  }
  // keep-alive: a real read and a tiny write every day so a free-tier database never sees a quiet week and gets suspended
  await db().from("heartbeats").upsert({ name: "daily", at: new Date().toISOString() });
  return out;
}

// --------------------------------------------------------------------------------------------
// WEEKLY: assemble, summarise, validate, publish, deliver. Idempotent and resumable.
// --------------------------------------------------------------------------------------------
/**
 * Every paper announced inside the window, read in keyset pages. A whole window with abstracts is several MB
 * (6.5 MB for 3337 papers on 2026-10-11), and one response that large was terminated by the HTTP driver.
 */
export async function windowPapers(w: Pick<BriefWindow, "startSlot" | "endSlot">, pageSize = 500): Promise<any[]> {
  const out: any[] = [];
  let after = "";
  for (;;) {
    const page = must(
      await db().from("papers").select("*")
        .gt("announce_slot", w.startSlot.toISOString()).lte("announce_slot", w.endSlot.toISOString())
        .gt("arxiv_id", after).order("arxiv_id").limit(pageSize),
      "papers",
    ) as any[];
    out.push(...page);
    if (page.length < pageSize) return out;
    after = page[page.length - 1].arxiv_id;
  }
}

export interface WeeklyResult { weekKey: string; status: string; note?: string; calls?: number }

function makeBudget(weekKey: string): Budget {
  const lim = limits();
  return {
    perRun: lim.perRun, used: 0,
    perWeekRemaining: async () => {
      const { count } = await db().from("llm_calls").select("id", { count: "exact", head: true }).eq("week_key", weekKey);
      return lim.perWeek - (count ?? 0);
    },
    log: async (r) => { await db().from("llm_calls").insert({ week_key: weekKey, purpose: r.purpose, model_id: r.model, model_version: r.modelVersion, status: r.status, error_class: r.errorClass, prompt_tokens: r.promptTokens, output_tokens: r.outputTokens, thought_tokens: r.thoughtTokens, latency_ms: r.latencyMs }); },
  };
}

async function claim(w: BriefWindow): Promise<boolean> {
  await db().from("brief_runs").upsert({ week_key: w.weekKey, window_start: w.startSlot.toISOString(), window_end: w.endSlot.toISOString(), window_label: w.label }, { onConflict: "week_key", ignoreDuplicates: true });
  const nowIso = new Date().toISOString();
  const lease = new Date(Date.now() + LEASE_MIN * 60_000).toISOString();
  const { data } = await db().from("brief_runs").update({ status: "running", lease_expires: lease, started_at: nowIso, window_label: w.label })
    .eq("week_key", w.weekKey).or(`status.in.(pending,waiting_batch,failed),and(status.eq.running,lease_expires.lt.${nowIso})`).select("week_key");
  return !!data?.length;
}
const release = (k: string, patch: Record<string, unknown>) => db().from("brief_runs").update({ lease_expires: null, ...patch }).eq("week_key", k);

export async function runWeekly(now = new Date(), opts: { dryRun?: boolean; ingestFirst?: boolean } = {}): Promise<WeeklyResult> {
  const w = briefWindow(now);
  const t0 = Date.now();
  const overBudget = () => Date.now() - t0 > TIME_BUDGET_MS;
  if (!opts.dryRun) {
    const done = (await db().from("brief_runs").select("status").eq("week_key", w.weekKey).maybeSingle()).data?.status === "published";
    if (done) return { weekKey: w.weekKey, status: "already-published" };
    if (!(await claim(w))) return { weekKey: w.weekKey, status: "leased-elsewhere" };
  }
  const budget = makeBudget(w.weekKey);
  try {
    if (opts.ingestFirst !== false) { try { await ingestDaily(now); } catch { /* stored data is still usable */ } }

    // Probe-and-wait: is the Sunday-evening batch visible yet? After 90 minutes we publish regardless and say so.
    const { count: sundayCount } = await db().from("papers").select("arxiv_id", { count: "exact", head: true }).eq("announce_slot", w.endSlot.toISOString());
    const late = now.getTime() - w.endSlot.getTime() > 90 * 60_000;
    const missingBatch = (sundayCount ?? 0) === 0;
    if (missingBatch && !late && !opts.dryRun) { await release(w.weekKey, { status: "waiting_batch" }); return { weekKey: w.weekKey, status: "waiting_batch" }; }

    const domains = await activeDomains();
    const papers = await windowPapers(w);
    const prevFeatured = new Set(((await db().from("featured").select("arxiv_id,first_week_key")).data ?? []).filter((f: any) => f.first_week_key !== w.weekKey).map((f: any) => f.arxiv_id));
    const pool = papers.filter((p) => !prevFeatured.has(p.arxiv_id) && (p.latest_version === 1 || new Date(p.published).getTime() > w.startSlot.getTime() - 14 * 86400000));

    // 1) cheap local pre-filter: per-domain quotas (see preselect); at most 120 papers go to Gemini
    const pre = preselect(pool, domains, 120);

    // 2) score once per paper (cached by prompt version + domain list hash)
    const promptVer = `${SCORE_PROMPT_VERSION}:${hash(domains.map((d) => d.slug + d.name).join("|"))}`;
    const cached = new Map<string, any>(((await db().from("paper_scores").select("*").eq("prompt_version", promptVer).in("arxiv_id", pre.map((p) => p.arxiv_id))).data ?? []).map((r: any) => [r.arxiv_id, r]));
    const toScore = pre.filter((p) => !cached.has(p.arxiv_id));
    const models = new Set<string>();
    let degraded = false;
    const canary = makeCanary();
    let timedOut = false, budgetGone = false;
    await runPool(chunk(toScore, 10), SCORE_CONCURRENCY, async (part) => {
      if (budgetGone) return;
      if (overBudget()) { timedOut = true; return; }
      try {
        const { system, user } = scoringPrompt(domains, part.map((p) => ({ id: p.arxiv_id, title: p.title, abstract: p.abstract })), canary);
        const r = await callJson({ purpose: "score", system, user, schema: ScoreBatch, budget });
        models.add(r.model);
        const ids = new Set(part.map((p) => p.arxiv_id));
        const rows = r.data.results.filter((x) => ids.has(x.id)).map((x) => ({ arxiv_id: x.id, prompt_version: promptVer, model_id: r.model, model_version: r.modelVersion, merit: x.merit, best_domain: x.best_domain, evidence_quote: x.evidence_quote }));
        if (rows.length) { await db().from("paper_scores").upsert(rows); rows.forEach((x) => cached.set(x.arxiv_id, x)); }
      } catch (e) { degraded = true; if (e instanceof BudgetExceeded) budgetGone = true; }
    });
    if (timedOut) { await release(w.weekKey, { status: "pending", error_summary: "time budget; will resume" }); return { weekKey: w.weekKey, status: "resume-later" }; }

    // 3) per-domain selection, signals only for the shortlist
    const bySlug = new Map(domains.map((d) => [d.slug, d]));
    const shortlist = new Map<number, any[]>();
    for (const p of pre) {
      const s = cached.get(p.arxiv_id); if (!s) continue;
      const d = bySlug.get(s.best_domain); if (!d || s.merit < 3) continue;
      shortlist.set(d.id, [...(shortlist.get(d.id) ?? []), { p, s }]);
    }
    const shortIds = [...shortlist.values()].flatMap((v) => v.sort((a, b) => b.s.merit - a.s.merit).slice(0, 12).map((x) => x.p.arxiv_id));
    const dates = Array.from({ length: 7 }, (_, i) => new Date(w.endSlot.getTime() - i * 86400000).toISOString().slice(0, 10));
    const sigs = [...(await hfDaily(dates)), ...(await hnFor(shortIds))];
    if (sigs.length) await db().from("signals").upsert(sigs.map((s) => ({ ...s, fetched_at: new Date().toISOString() })), { onConflict: "arxiv_id,source" });
    const hf = new Map(sigs.filter((s) => s.source === "hf").map((s) => [s.arxiv_id, s.upvotes ?? 0]));
    const hn = new Map(sigs.filter((s) => s.source === "hn").map((s) => [s.arxiv_id, s.points ?? 0]));
    const hfOk = hf.size > 0;

    // 4) summarise top candidates per domain, gate, regenerate failures once
    const fits: Fit<{ domainId: number; card: BriefCard }>[] = [];
    const domainOut: BriefDomain[] = [];
    let partial = degraded;
    for (const d of domains) {
      const list = shortlist.get(d.id) ?? [];
      const ranked = rank(list.map(({ p, s }): Cand => ({
        arxiv_id: p.arxiv_id, merit: s.merit, hf: hfOk ? hf.get(p.arxiv_id) ?? 0 : null, hn: hn.get(p.arxiv_id) ?? 0,
        hasArtefact: /github\.com|huggingface\.co|code (is )?available|open[- ]source/i.test(`${p.abstract} ${p.comment ?? ""}`),
        hasNumber: /\d+(\.\d+)?\s?%|\bSOTA\b|state[- ]of[- ]the[- ]art|outperform/i.test(p.abstract),
      }))).slice(0, MAX_PER_DOMAIN);
      const meta = new Map(list.map(({ p }) => [p.arxiv_id, p]));
      const cards: BriefCard[] = [];
      let todo = ranked.map((r) => r.arxiv_id);
      for (let attempt = 0; attempt < 2 && todo.length; attempt++) {
        const need = todo; todo = [];
        const cachedSum = new Map<string, any>(((await db().from("summaries").select("*").eq("prompt_version", SUMMARY_PROMPT_VERSION).in("arxiv_id", need)).data ?? []).map((r: any) => [r.arxiv_id, r.json]));
        const fresh = need.filter((id) => !cachedSum.has(id));
        const got = new Map<string, CardIn>(cachedSum);
        for (const part of chunk(fresh, 5)) {
          if (overBudget()) { await release(w.weekKey, { status: "pending", error_summary: "time budget; will resume" }); return { weekKey: w.weekKey, status: "resume-later" }; }
          try {
            const { system, user } = summaryPrompt(part.map((id) => ({ id, title: meta.get(id).title, abstract: meta.get(id).abstract })), canary, d.name);
            const r = await callJson({ purpose: "summarise", system, user, schema: SummaryBatch, budget, maxOutputTokens: 12000 });
            models.add(r.model);
            for (const x of r.data.results) if (meta.has(x.id)) got.set(x.id, { arxiv_id: x.id, claims: x.claims, why_it_matters: x.why_it_matters, caveat: x.caveat, evidence_type: x.evidence_type, action: x.action });
          } catch (e) { partial = true; if (e instanceof BudgetExceeded) break; }
        }
        for (const id of need) {
          const c = got.get(id); const p = meta.get(id); if (!c || !p) { if (attempt === 1) partial = true; continue; }
          const g = gateCard(c, p.abstract, canary, new Set([id]));
          if (g.card) {
            await db().from("summaries").upsert({ arxiv_id: id, prompt_version: SUMMARY_PROMPT_VERSION, model_id: [...models].pop(), json: c, verified: true });
            const sc = ranked.find((r) => r.arxiv_id === id)!;
            cards.push({ arxiv_id: id, title: p.title, url: arxivUrl(id), authors: p.authors.slice(0, 4), published: p.published, claims: g.card.claims, why_it_matters: g.card.why_it_matters, caveat: g.card.caveat, evidence_type: g.card.evidence_type, action: g.card.action, score: sc.score });
          } else { await db().from("summaries").delete().eq("arxiv_id", id).eq("prompt_version", SUMMARY_PROMPT_VERSION); todo.push(id); }
        }
      }
      cards.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
      cards.forEach((c) => fits.push({ domainId: d.id, words: cardWords(c, c.title), score: c.score ?? 0, item: { domainId: d.id, card: c } }));
      domainOut.push({ id: d.id, name: d.name, items: [], note: list.length ? undefined : `Quiet week in ${d.name}: ${pre.length} papers screened, none cleared the bar.` });
    }

    // 5) global word budget wins over the per-domain cap
    const { kept, dropped } = fitBudget(fits, WORD_BUDGET - 120);
    for (const k of kept) domainOut.find((x) => x.id === k.domainId)!.items.push(k.item.card);
    for (const d of domainOut) { d.items.sort((a, b) => (b.score ?? 0) - (a.score ?? 0)); if (!d.items.length && !d.note) d.note = `Nothing in ${d.name} passed the checks this week.`; }
    const totalWords = kept.reduce((n, k) => n + k.words, 0) + domainOut.reduce((n, d) => n + wordCount(d.name) + wordCount(d.note ?? ""), 0) + 60;
    const filled = domainOut.filter((d) => d.items.length).length;
    const brief: Brief = {
      week_key: w.weekKey, label: w.label, generated_at: new Date().toISOString(),
      ladder_level: filled === 0 ? 2 : partial ? 1 : 0, partial: partial || filled < domainOut.length, late_batch: missingBatch,
      domains: domainOut, word_count: totalWords, reading_minutes: readingMinutes(totalWords), models: [...models],
      notes: [
        ...(missingBatch ? ["The Sunday-evening arXiv batch was not visible at build time; those papers appear next week."] : []),
        ...(dropped.length ? [`${dropped.length} lower-ranked papers were left out to keep the brief under ${readingMinutes(WORD_BUDGET)} minutes.`] : []),
        ...([...models].some((m) => /lite/i.test(m)) ? ["Some summaries came from Gemini Flash-Lite (degraded mode)."] : []),
      ],
    };
    if (opts.dryRun) return { weekKey: w.weekKey, status: "dry-run", note: JSON.stringify({ words: brief.word_count, filled, calls: budget.used }), calls: budget.used };
    if (filled === 0) { await release(w.weekKey, { status: "failed", ladder_level: 2, error_summary: "no domain produced a verified card", calls_used: budget.used }); return { weekKey: w.weekKey, status: "failed-no-content" }; }

    await publish(brief, kept.map((k) => ({ ...k.item, rank: 0 })), w, budget.used);
    return { weekKey: w.weekKey, status: "published", calls: budget.used };
  } catch (e: any) {
    if (!opts.dryRun) await release(w.weekKey, { status: "failed", error_summary: String(e.message ?? e).slice(0, 400) });
    throw e;
  }
}

async function publish(brief: Brief, kept: { domainId: number; card: BriefCard }[], w: BriefWindow, calls: number) {
  const items = kept.map((k, i) => ({ week_key: w.weekKey, domain_id: k.domainId, rank: i + 1, arxiv_id: k.card.arxiv_id, card: k.card, breakdown: null }));
  await db().from("brief_items").delete().eq("week_key", w.weekKey);
  if (items.length) must(await db().from("brief_items").insert(items), "brief_items");
  await db().from("featured").upsert(kept.map((k) => ({ arxiv_id: k.card.arxiv_id, first_week_key: w.weekKey, last_week_key: w.weekKey })), { onConflict: "arxiv_id", ignoreDuplicates: true });
  must(await db().from("brief_runs").update({ status: "published", published_at: new Date().toISOString(), lease_expires: null, ladder_level: brief.ladder_level, partial: brief.partial, late_batch: !!brief.late_batch, calls_used: calls, word_count: brief.word_count, reading_minutes: brief.reading_minutes, snapshot: brief as any, error_summary: null }).eq("week_key", w.weekKey), "publish");
  if (opt("BLOB_READ_WRITE_TOKEN")) { try { await put("latest-brief.json", JSON.stringify(brief), { access: "public", allowOverwrite: true, addRandomSuffix: false, contentType: "application/json" }); } catch { /* snapshot is a fallback only */ } }
}

// --------------------------------------------------------------------------------------------
// DELIVER: separate from assemble. Insert-first claim on send_log makes it exactly-once per recipient.
// --------------------------------------------------------------------------------------------
export async function deliver(now = new Date(), toOverride?: string): Promise<{ sent: number; skipped: number; errors: string[] }> {
  const base = opt("PUBLIC_BASE_URL") ?? "";
  const cur = wk(now);
  let { data: run } = await db().from("brief_runs").select("week_key,snapshot,status").eq("week_key", cur).maybeSingle();
  let stale = false;
  if (!run?.snapshot || run.status !== "published") {
    // Only fall back to the last good brief at/after the hard backstop (09:00 IST Monday = 03:30 UTC).
    const past = now.getUTCDay() !== 1 || now.getUTCHours() * 60 + now.getUTCMinutes() >= 3 * 60 + 30;
    if (!past && !toOverride) return { sent: 0, skipped: 0, errors: ["current brief not ready; waiting for backstop"] };
    const last = (await db().from("brief_runs").select("week_key,snapshot,status").eq("status", "published").order("published_at", { ascending: false }).limit(1)).data?.[0];
    if (!last?.snapshot) return { sent: 0, skipped: 0, errors: ["no published brief to send"] };
    run = last; stale = last.week_key !== cur;
  }
  const brief = run!.snapshot as Brief;
  const recips = toOverride ? [{ id: -1, email: toOverride }] : (((await db().from("recipients").select("id,email").is("unsubscribed_at", null).eq("suppressed", false)).data ?? []) as any[]);
  const fallbackTo = opt("RECIPIENT_EMAIL");
  if (!recips.length && fallbackTo) recips.push({ id: 0, email: fallbackTo });
  const mail = renderEmail(brief, base, stale);
  const res = { sent: 0, skipped: 0, errors: [] as string[] };
  for (const r of recips) {
    const key = { week_key: brief.week_key, recipient_id: r.id, channel: "email" };
    if (r.id >= 0 && !toOverride) {
      const ins = await db().from("send_log").upsert({ ...key, status: "pending", attempts: 1 }, { onConflict: "week_key,recipient_id,channel", ignoreDuplicates: true }).select();
      if (!ins.data?.length) {
        const ex = (await db().from("send_log").select("*").match(key).maybeSingle()).data;
        const retryable = ex && (ex.status === "failed" && ex.attempts < 3 || ex.status === "pending" && Date.now() - new Date(ex.created_at).getTime() > 10 * 60_000);
        if (!retryable) { res.skipped++; continue; }
        await db().from("send_log").update({ status: "pending", attempts: ex.attempts + 1 }).match(key);
      }
    }
    try {
      const s = await sendWithFailover({ to: r.email, ...mail });
      if (r.id >= 0 && !toOverride) await db().from("send_log").update({ status: "sent", provider: s.provider, provider_message_id: s.id, sent_at: new Date().toISOString(), last_error: null }).match(key);
      res.sent++;
    } catch (e: any) {
      res.errors.push(e.message);
      if (r.id >= 0 && !toOverride) await db().from("send_log").update({ status: "failed", last_error: String(e.message).slice(0, 300) }).match(key);
    }
  }
  const hc = opt("HEALTHCHECK_DELIVERY_URL"); // ping only after a provider returned 2xx
  if (hc && res.sent > 0) { try { await fetch(hc, { signal: AbortSignal.timeout(5000) }); } catch { /* optional */ } }
  return res;
}
