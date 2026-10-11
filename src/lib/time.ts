// Time and window logic. Everything here is pure and unit-tested.
// Key idea: a brief is defined by arXiv *announcement batches*, not calendar submission dates.

export const IST = "Asia/Kolkata";
export const ET = "America/New_York";

type Parts = { y: number; m: number; d: number; h: number; mi: number; wd: number };

export function partsIn(date: Date, tz: string): Parts {
  const f = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric",
    hour: "numeric", minute: "numeric", weekday: "short",
  });
  const o: Record<string, string> = {};
  for (const p of f.formatToParts(date)) o[p.type] = p.value;
  const wd = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(o.weekday);
  return { y: +o.year, m: +o.month, d: +o.day, h: +o.hour % 24, mi: +o.minute, wd };
}

/** Convert a wall-clock time in `tz` to a UTC Date (handles DST by iterating the offset). */
export function zonedToUtc(y: number, m: number, d: number, h: number, mi: number, tz: string): Date {
  let guess = Date.UTC(y, m - 1, d, h, mi);
  for (let i = 0; i < 3; i++) {
    const p = partsIn(new Date(guess), tz);
    const shown = Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi);
    guess += Date.UTC(y, m - 1, d, h, mi) - shown;
  }
  return new Date(guess);
}

/** ISO week key such as "2026-W42", computed from the calendar date in `tz` (default IST). */
export function weekKey(date: Date, tz = IST): string {
  const p = partsIn(date, tz);
  const t = new Date(Date.UTC(p.y, p.m - 1, p.d));
  const dow = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - dow);
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  const wk = Math.ceil(((t.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${t.getUTCFullYear()}-W${String(wk).padStart(2, "0")}`;
}

/** The IST calendar date (y,m,d) of the Monday that starts the ISO week containing `date`. */
export function mondayOfWeekIST(date: Date): { y: number; m: number; d: number } {
  const p = partsIn(date, IST);
  const t = new Date(Date.UTC(p.y, p.m - 1, p.d));
  const dow = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() - (dow - 1));
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() };
}

/**
 * arXiv announces Sun-Thu at 20:00 ET. Submissions before 14:00 ET are in that day's batch.
 * Map a submission time to the UTC instant of the announcement that first shows it.
 *   Mon14 -> Tue14 cutoff => Tue 20:00 ET ... Thu14 -> Fri14 cutoff => Sun 20:00 ET
 *   Fri14 -> Mon14 cutoff => Mon 20:00 ET
 */
export function announceSlot(published: Date): Date {
  const p = partsIn(published, ET);
  // next 14:00 ET cutoff at or after `published`
  let cy = p.y, cm = p.m, cd = p.d;
  if (p.h > 14 || (p.h === 14 && p.mi > 0)) {
    const n = new Date(Date.UTC(p.y, p.m - 1, p.d + 1));
    cy = n.getUTCFullYear(); cm = n.getUTCMonth() + 1; cd = n.getUTCDate();
  }
  let dow = new Date(Date.UTC(cy, cm - 1, cd)).getUTCDay(); // weekday of the cutoff day
  let add = 0;
  if (dow === 6) add = 2;        // Sat cutoff -> Monday's cutoff
  else if (dow === 0) add = 1;   // Sun cutoff -> Monday's cutoff
  const base = new Date(Date.UTC(cy, cm - 1, cd + add));
  dow = base.getUTCDay();
  // Mon-Thu cutoff -> same-day 20:00 ET; Fri cutoff -> Sunday 20:00 ET
  const annDay = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate() + (dow === 5 ? 2 : 0)));
  return zonedToUtc(annDay.getUTCFullYear(), annDay.getUTCMonth() + 1, annDay.getUTCDate(), 20, 0, ET);
}

export interface BriefWindow {
  weekKey: string;
  /** exclusive */ startSlot: Date;
  /** inclusive: the Sunday 20:00 ET batch right before delivery Monday */ endSlot: Date;
  label: string;
}

/** The window for the brief delivered on the IST Monday of the week containing `now`. */
export function briefWindow(now: Date): BriefWindow {
  const mon = mondayOfWeekIST(now);
  // Sunday 20:00 ET before that Monday (IST). The Monday IST morning is still Sunday evening in ET.
  const monUtc = zonedToUtc(mon.y, mon.m, mon.d, 0, 0, IST);
  // The batch is announced Sunday 20:00 ET, which falls on Monday morning IST. Use calendar arithmetic, not -24h.
  const sun = new Date(Date.UTC(mon.y, mon.m - 1, mon.d - 1));
  const sy = sun.getUTCFullYear(), sm = sun.getUTCMonth() + 1, sd = sun.getUTCDate();
  const endSlot = zonedToUtc(sy, sm, sd, 20, 0, ET);
  const startSlot = zonedToUtc(sy, sm, sd - 7, 20, 0, ET);
  const fmt = (d: Date) => d.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
  // startSlot is the previous Sunday-evening batch (exclusive). The first batch inside the window is Monday 20:00 ET.
  const first = zonedToUtc(sy, sm, sd - 6, 20, 0, ET);
  const label = `Papers announced ${fmt(first)} to ${fmt(endSlot)} ${endSlot.getUTCFullYear()}`;
  return { weekKey: weekKey(new Date(monUtc.getTime() + 3600000)), startSlot, endSlot, label };
}

export function inWindow(slot: Date, w: BriefWindow): boolean {
  return slot.getTime() > w.startSlot.getTime() && slot.getTime() <= w.endSlot.getTime();
}

/** arXiv submittedDate range string (UTC, YYYYMMDDHHMM) for the last `days` days. */
export function submittedRange(now: Date, days: number): string {
  const f = (d: Date) => d.toISOString().replace(/[-:T]/g, "").slice(0, 12);
  return `[${f(new Date(now.getTime() - days * 86400000))} TO ${f(now)}]`;
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
