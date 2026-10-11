// Measures how long after the Sunday 20:00 ET announcement (Mon 00:00 UTC in EDT) the arXiv API shows that batch.
// No secrets, no database. Polls politely (>= 3.1 s apart, descriptive User-Agent).
//   npx tsx scripts/measure-lag.ts [stopAtISO] [everyMinutes]
// The batch under test is the submissions Thu 14:00 ET -> Fri 14:00 ET (2026-10-08T18:00Z -> 2026-10-09T18:00Z).
import { parseFeed } from "../src/lib/arxiv";

const UA = "ResearchPulse/0.1 (student exam project; lag measurement)";
const CATS = ["cs.AI", "cs.MA", "cs.CL", "cs.IR", "cs.SE", "cs.LG", "cs.CV", "eess.IV", "cs.RO"].map((c) => `cat:${c}`).join("+OR+");
const stopAt = new Date(process.argv[2] ?? "2026-10-12T01:30:00Z").getTime();
const everyMs = Number(process.argv[3] ?? 5) * 60_000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function q(extra: string) {
  const url = `https://export.arxiv.org/api/query?search_query=(${CATS})${extra}&max_results=1&sortBy=submittedDate&sortOrder=descending`;
  const r = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return parseFeed(await r.text());
}

async function main() {
  console.log("utc_now | sunday_batch_total (Thu14ET-Fri14ET) | newest_published | note");
  let firstSeen: string | null = null;
  while (Date.now() < stopAt) {
    const now = new Date().toISOString().slice(0, 19) + "Z";
    try {
      const batch = await q("+AND+submittedDate:%5B202610081800+TO+202610091800%5D");
      await sleep(3200);
      const newest = await q("");
      const note = batch.total > 0 && !firstSeen ? "FIRST VISIBLE" : "";
      if (note) firstSeen = now;
      console.log(`${now} | ${batch.total} | ${newest.papers[0]?.published ?? "-"} | ${note}`);
    } catch (e: any) { console.log(`${now} | error: ${String(e.message).slice(0, 100)}`); }
    await sleep(everyMs);
  }
  console.log(firstSeen ? `Sunday batch first visible at ${firstSeen} (announcement was 2026-10-12T00:00:00Z)` : "Sunday batch never became visible before the stop time");
}
main();
