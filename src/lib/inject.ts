// Prompt-injection hygiene for attacker-controlled text (titles, abstracts, comments, HN titles).
// A defence stack, not a guarantee: no tools for the model, datamarking, scan-and-flag, plain-text output.

const ZERO_WIDTH = /[​-‏⁠⁦-⁩﻿]/g;
const HOMOGLYPH: Record<string, string> = { "а": "a", "е": "e", "о": "o", "р": "p", "с": "c", "х": "x", "і": "i", "ѕ": "s" };

export function normalise(s: string): string {
  let t = s.normalize("NFKC").replace(ZERO_WIDTH, "");
  t = t.replace(/[аеорсхіѕ]/g, (c) => HOMOGLYPH[c] ?? c);
  return t.replace(/\s+/g, " ").trim();
}

const PATTERNS: [RegExp, string][] = [
  [/ignore (all |any |the )?(previous|prior|above) (instructions|prompts?)/i, "override-instruction"],
  [/disregard (all |any |the )?(previous|prior|above)/i, "override-instruction"],
  [/(you are|act as|pretend to be) (now )?(a |an )?(reviewer|judge|assistant|system)/i, "role-reassignment"],
  [/(give|assign|rate|score) (this|the) paper (a )?(high|top|positive|10|5)/i, "score-steering"],
  [/(do not|don't) (mention|include|flag) (any )?(weakness|limitation|negative)/i, "suppress-criticism"],
  [/(^|[.!?]\s+)(system|assistant|developer)\s*:\s/i, "fake-role-tag"], // sentence-initial only: "a multi-agent system: ..." is ordinary prose
  [/<\/?(system|instructions?|prompt)>/i, "fake-tag"],
  [/(include|insert|add|output) (the )?(following )?(url|link)/i, "link-request"],
  [/\bas an ai (language )?model\b/i, "ai-address"],
  [/\b(note|attention|message|instructions?|hello|hi)\s+(to|for)\s+(the\s+)?(llm|language model|ai)\s*(reviewers?|readers?|judges?|agents?)\b/i, "addresses-llm"], // not "LLM judges" as a topic
];

export interface ScanResult { flagged: boolean; reasons: string[]; clean: string }

export function scan(text: string): ScanResult {
  const clean = normalise(text);
  const reasons = new Set<string>();
  for (const [re, why] of PATTERNS) if (re.test(clean)) reasons.add(why);
  // A link plus an imperative aimed at the reader. Plain "open" is not enough: "open-source code at https://..." is normal.
  if (/https?:\/\//i.test(clean) && /\b(click|visit)\s+(here|the (link|url|website|site|page)|this (link|url|site|page)|our (website|site|page))\b|\bopen (the|this) (link|url)\b/i.test(clean)) reasons.add("call-to-action-link");
  return { flagged: reasons.size > 0, reasons: [...reasons], clean };
}

/** Random per-call delimiter; fixed delimiters can be imitated by an attacker. */
export function makeDelimiter(): string {
  const b = new Uint8Array(6);
  crypto.getRandomValues(b);
  return "§" + [...b].map((x) => x.toString(16).padStart(2, "0")).join("") + "§";
}

/** Datamark: interleave a marker between words so injected sentences are visibly "data". */
export function datamark(text: string, mark = "ˆ"): string {
  return normalise(text).split(" ").join(mark);
}

/** Strip anything that could render as markup or a link in model-produced strings. */
export function plainText(s: string): string {
  return s
    .replace(/<[^>]*>/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/[*_`#>]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function makeCanary(): string {
  const b = new Uint8Array(5);
  crypto.getRandomValues(b);
  return "CNRY-" + [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
}
