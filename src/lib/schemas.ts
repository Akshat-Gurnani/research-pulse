import { z } from "zod";

export const SCORE_PROMPT_VERSION = "score-v2";
export const SUMMARY_PROMPT_VERSION = "sum-v1";

export const ScoreBatch = z.object({
  results: z.array(z.object({
    id: z.string(),
    merit: z.number().int().min(1).max(5),
    best_domain: z.string().max(60), // a domain slug from the list, or "none"
    evidence_quote: z.string().max(300),
  })),
});
export type ScoreBatch = z.infer<typeof ScoreBatch>;

export const EVIDENCE = ["benchmarks_reported", "theory_only", "system_demo", "position_or_survey", "unclear"] as const;
export const ACTIONS = ["read", "skim", "flag_for_client", "skip"] as const;

export const SummaryBatch = z.object({
  results: z.array(z.object({
    id: z.string(),
    claims: z.array(z.object({ claim: z.string().max(220), quote: z.string().max(300) })).min(1).max(4),
    why_it_matters: z.string().max(260),
    caveat: z.string().max(220),
    evidence_type: z.enum(EVIDENCE),
    action: z.enum(ACTIONS),
  })),
});
export type SummaryBatch = z.infer<typeof SummaryBatch>;

export const DomainInput = z.object({
  name: z.string().trim().min(3).max(60).regex(/^[\p{L}\p{N} &/,'().+-]+$/u, "letters, numbers and basic punctuation only"),
  arxiv_categories: z.array(z.string().regex(/^[a-z-]+(\.[A-Za-z-]+)?$/)).min(1).max(6),
  phrases: z.array(z.string().trim().min(2).max(40)).max(12).default([]),
  exclude_phrases: z.array(z.string().trim().min(2).max(40)).max(12).default([]),
  active: z.boolean().default(true),
});
export const DomainList = z.array(DomainInput).min(1).max(10);
export type DomainInput = z.infer<typeof DomainInput>;

export const ALLOWED_CATEGORIES = new Set([
  "cs.AI","cs.CL","cs.CV","cs.LG","cs.MA","cs.IR","cs.SE","cs.RO","cs.HC","cs.CR","cs.DB","cs.NE","cs.PL","stat.ML","eess.IV","eess.SP",
]);
