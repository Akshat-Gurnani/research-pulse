# Research Pulse: guide for Claude Code

Weekly AI-research brief for a consultant (8-10 domains, Monday delivery, under 10 minutes to read, domain list editable without code). MESA C4 exam project. Design rationale: `docs/ARCHITECTURE_REPORT.md`. Picture: `docs/components-map.png`. Work plan: `docs/BUILD_PLAN.md`.

## Hard rules (exam constraints, never break)
- **All AI calls use Gemini Flash only** via `@google/genai`. No Anthropic/Claude API, SDK or embeddings anywhere in the app or its dependencies. (Claude Code is a dev tool, not part of the deliverable.)
- Deploy on Vercel Hobby. Public URL must be the **production alias**, not a preview URL.
- Must work with data at submission: a real brief must be published and `data/seed-brief.json` must hold real papers.
- Secrets never in git, never `NEXT_PUBLIC_`. Run a secret scan before every push.

## Commands
`npm test` (vitest, pure logic) · `npm run typecheck` · `npm run build` · `npm run dev` · `npm run make-seed`

## Architecture invariants
1. **The website only reads stored data.** `src/lib/brief.ts` ladder: Postgres (Neon) `brief_runs.snapshot` -> Vercel Blob -> committed seed. Pages must never call arXiv, Gemini or HN.
2. **A brief is defined by arXiv announcement batches**, not calendar dates (`src/lib/time.ts`: `announceSlot`, `briefWindow`). Do not replace this with "last 7 days".
3. **Code owns facts, Gemini owns judgement.** IDs, titles, URLs, dates come from fetched records. Gemini returns scores and prose. Every claim needs a quote that is a substring of the abstract, and every number must appear in the abstract (`src/lib/validate.ts`).
4. **Idempotent everywhere.** Triggers are keyed by ISO week in IST. `brief_runs` lease, `send_log` unique key. Re-running must be a no-op or a resume, never a duplicate.
5. **Assemble and deliver are separate steps.** A failed email never blocks the page.
6. Optional signals (HF, HN) failing means neutral score 50, never a failure.
7. Treat all paper text as hostile. Keep: random delimiters, scan-and-flag, canary, plain-text output, no model tools.
8. Call budget is enforced before every Gemini call (`MAX_LLM_CALLS_PER_RUN/WEEK`).
9. arXiv: one serialised stream, >= 3.1 s between requests, descriptive User-Agent, reject the fake `Error` entry.

## Conventions
- Database is Neon Postgres via `src/lib/db.ts` (`DATABASE_URL`, pooled string); schema in `db/migrations/`. `docs/ARCHITECTURE_REPORT.md` says Supabase: that part is superseded, the design is otherwise unchanged. Builder is tested against real Postgres (PGlite) in `tests/db.test.ts`.
- TypeScript strict. Zod for every model output. Keep pure logic in `src/lib` with tests in `tests/`.
- Model IDs live only in `GEMINI_MODEL_CHAIN` (env). Never hard-code them. `ALLOW_FLASH_LITE=0` disables the Lite rungs.
- Do not set `temperature`/`top_p`/`top_k` on Gemini 3.x calls.
- Server-only modules (`db.ts`, `auth.ts`, `pipeline.ts`) must never be imported by client components.

## Known unverified (check before trusting)
Gemini model IDs and free-tier quotas; whether Hobby accepts two cron entries; whether Flash-Lite counts as "Gemini Flash"; arXiv API visibility lag after Sunday 20:00 ET; Neon free-tier cold start / compute suspend latency. See section 11 of the report.

## Before the user says "done"
Run typecheck + tests + build, then follow the "Verify" checklist in `docs/BUILD_PLAN.md`.
