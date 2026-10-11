/** Presentation helper: model claims arrive as lowercase fragments ("the authors report that ..."). */
export function tidyClaim(s: string): string {
  const t = s.replace(/\s+/g, " ").trim();
  if (!t) return t;
  const cap = t.charAt(0).toUpperCase() + t.slice(1);
  return /[.!?]$/.test(cap) ? cap : cap + ".";
}
