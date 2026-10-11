import { XMLParser } from "fast-xml-parser";
import { sleep, submittedRange } from "./time";

export interface Paper {
  arxiv_id: string;          // base id without version, e.g. 2510.01234
  latest_version: number;
  title: string;
  abstract: string;
  authors: string[];
  categories: string[];
  primary_category: string;
  published: string;         // ISO, v1 submission time
  updated: string;
  comment?: string;
}

export class ArxivError extends Error {
  constructor(public kind: "http" | "html" | "error-entry" | "empty" | "parse" | "timeout", msg: string) { super(msg); }
}

const UA = "ResearchPulse/0.1 (student exam project; contact via repo)";
const API = "https://export.arxiv.org/api/query";
const MIN_GAP_MS = 3100; // arXiv: 1 request per 3 seconds, single connection
let lastCall = 0;

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_", isArray: (n) => ["entry", "author", "category"].includes(n) });

export function parseId(idUrl: string): { id: string; version: number } {
  const m = /arxiv\.org\/abs\/(.+?)(?:v(\d+))?$/.exec(idUrl.trim());
  if (!m) throw new ArxivError("parse", `bad id url: ${idUrl}`);
  return { id: m[1], version: m[2] ? +m[2] : 1 };
}

/** Parse an arXiv Atom response. Rejects the fake "Error" entry arXiv returns with HTTP 200. */
export function parseFeed(xml: string): { total: number; papers: Paper[] } {
  if (/^\s*<!doctype html|^\s*<html/i.test(xml)) throw new ArxivError("html", "HTML body instead of Atom feed");
  let doc: any;
  try { doc = parser.parse(xml); } catch (e) { throw new ArxivError("parse", String(e)); }
  const feed = doc?.feed;
  if (!feed) throw new ArxivError("parse", "no <feed>");
  const total = Number(feed["opensearch:totalResults"] ?? 0);
  const entries: any[] = feed.entry ?? [];
  const papers: Paper[] = [];
  for (const e of entries) {
    const title = String(e.title ?? "").replace(/\s+/g, " ").trim();
    const idUrl = String(e.id ?? "");
    if (/^error$/i.test(title) || /api\/errors/.test(idUrl)) throw new ArxivError("error-entry", String(e.summary ?? "arXiv Error entry"));
    const { id, version } = parseId(idUrl);
    const cats: string[] = (e.category ?? []).map((c: any) => c["@_term"]).filter(Boolean);
    const prim = e["arxiv:primary_category"]?.["@_term"] ?? cats[0] ?? "";
    papers.push({
      arxiv_id: id, latest_version: version, title,
      abstract: String(e.summary ?? "").replace(/\s+/g, " ").trim(),
      authors: (e.author ?? []).map((a: any) => String(a.name)),
      categories: cats, primary_category: prim,
      published: String(e.published), updated: String(e.updated),
      comment: e["arxiv:comment"] ? String(e["arxiv:comment"]) : undefined,
    });
  }
  return { total, papers };
}

async function polite<T>(fn: () => Promise<T>): Promise<T> {
  const wait = lastCall + MIN_GAP_MS - Date.now();
  if (wait > 0) await sleep(wait);
  lastCall = Date.now();
  return fn();
}

async function getFeed(url: string, attempts = 3): Promise<string> {
  const delays = [5000, 20000, 60000];
  let err: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await polite(() => fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(10000), redirect: "follow" }));
      if (res.ok) return await res.text();
      if (![429, 500, 502, 503, 504].includes(res.status)) throw new ArxivError("http", `HTTP ${res.status}`);
      err = new ArxivError("http", `HTTP ${res.status}`);
    } catch (e) {
      if (e instanceof ArxivError && e.kind === "http" && !/HTTP (429|5\d\d)/.test(e.message)) throw e;
      err = e;
    }
    if (i < attempts - 1) await sleep(delays[i] * (0.8 + Math.random() * 0.4));
  }
  throw err instanceof Error ? err : new ArxivError("timeout", String(err));
}

export interface FetchResult { papers: Paper[]; total: number; pages: number; suspiciousEmpty: boolean }

/**
 * Fetch every paper in the given categories submitted in the last `days` days.
 * One serialised stream of requests; pages of 200; stops when `start` passes `total`
 * (arXiv returns a fake Error entry for out-of-range start, which parseFeed rejects).
 */
export async function fetchRecent(categories: string[], now: Date, days = 5, maxPages = 12): Promise<FetchResult> {
  const cats = categories.map((c) => `cat:${c}`).join("+OR+");
  const q = `(${cats})+AND+submittedDate:${encodeURIComponent(submittedRange(now, days))}`;
  const out = new Map<string, Paper>();
  let total = 0, pages = 0;
  for (let start = 0; pages < maxPages; start += 200) {
    const url = `${API}?search_query=${q}&start=${start}&max_results=200&sortBy=submittedDate&sortOrder=descending`;
    const xml = await getFeed(url);
    const r = parseFeed(xml);
    total = r.total; pages++;
    for (const p of r.papers) out.set(p.arxiv_id, p);
    if (start + 200 >= total || r.papers.length === 0) break;
  }
  return { papers: [...out.values()], total, pages, suspiciousEmpty: total === 0 };
}

/** Suspicious-empty rule: zero (or far below baseline) outside an expected-quiet period is a source fault, not a quiet week. */
export function isSuspicious(total: number, baselineMedian: number | null, expectedQuiet: boolean): boolean {
  if (expectedQuiet) return false;
  if (baselineMedian == null || baselineMedian <= 0) return total === 0;
  return total < baselineMedian * 0.25;
}
