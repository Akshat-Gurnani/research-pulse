# Build plan (work top to bottom; each phase ends with something you can see working)

Legend: [x] already in this repo (tested or type-checked) · [ ] you do it · (needs keys) cannot be verified without real credentials.

## Phase 0: accounts and decisions (30 min, do first)
- [ ] Create Supabase project; run `supabase/migrations/0001_init.sql` in the SQL editor. Check the Advisors tab shows no "RLS disabled" warnings.
- [ ] Create a Gemini API key restricted to the Generative Language API. Open aistudio.google.com/rate-limit and note your real per-model limits.
- [ ] **Decide email path:** own a domain -> verify it in Resend. No domain -> Resend to your own address only, or Gmail SMTP app password (`GMAIL_USER`, `GMAIL_APP_PASSWORD`). Set `RECIPIENT_EMAIL`.
- [ ] **Email the examiner:** does "Gemini Flash" include Flash-Lite? Until answered set `ALLOW_FLASH_LITE=0`.
- [ ] Personal GitHub repo (Hobby cannot import organisation repos). Do not commit `.env`.
- [ ] Generate secrets: `openssl rand -hex 32` for `CRON_SECRET`, `SESSION_SECRET`, `EXAMINER_TOKEN`. Set `ADMIN_PASSWORD`.

## Phase 1: first live brief (needs keys)
- [ ] `cp .env.example .env.local`, fill in, `npm run dev`.
- [ ] `curl -X POST -H "Authorization: Bearer $CRON_SECRET" localhost:3000/api/cron/daily` -> expect `ingest.upserted` in the hundreds. Check the `papers` table.
- [ ] Run the weekly route the same way. First run: expect `waiting_batch` or `published`. Inspect `llm_calls` and `brief_runs`.
- [ ] Open `/`. Read it with a timer: must be under 10 minutes.
- [ ] `npm run make-seed` to freeze real papers into `data/seed-brief.json`. Commit it.

## Phase 2: deploy and schedule
- [ ] Import repo into Vercel, add every env var (Production). Deploy.
- [ ] Settings > Deployment Protection: production must be public. Test the alias in a private window and with `curl -I`.
- [ ] Confirm **both** cron entries appear under Settings > Cron Jobs (Hobby acceptance of two entries is UNVERIFIED).
- [ ] Add GitHub secrets `APP_URL`, `CRON_SECRET`; trigger the `backup-triggers` workflow manually.
- [ ] Measure the arXiv visibility lag: poll the API at 00:00/00:15/00:30/01:00 UTC after a Sunday 20:00 ET announcement and note the newest `published`. Adjust the `late` threshold in `runWeekly` if needed.

## Phase 3: evidence for the examiner
- [ ] Failure drills, screenshot each: block arXiv (set a bad URL), force Gemini 503/404 (bad model first in chain), wrong DB URL (page should show seed banner), duplicate trigger (two curls at once -> one brief, one email), disable primary cron (GitHub/catch-up completes).
- [ ] Injection test set: 20 hostile abstracts through `scan()` and the scoring prompt; record scores with and without defences. Report non-zero residual risk honestly.
- [ ] `/status` should show at least two or three real weekly rows if time allows.
- [ ] README "How to verify the Monday automation" with the Hobby +/- 59 minute caveat.

## Phase 4: polish (cut from the bottom if short on time)
- [ ] Healthchecks.io heartbeats (`HEALTHCHECK_*_URL`).
- [ ] Second email provider tested with a non-owner address; bounce webhook.
- [ ] Gemini verifier call and listwise ordering of top candidates.
- [ ] Gold-set evaluation (retrospective, flag possible leakage) and run-to-run stability metric.
- [ ] TF-IDF diversity (MMR) across a domain's picks.
- [ ] Credibility term (needs a free Semantic Scholar key).

## Verify before submission
- [ ] Public URL loads logged out, on a phone.
- [ ] `grep -r "anthropic" package.json src` returns nothing.
- [ ] `git log -p | grep -iE "secret|api_key|password"` shows no real values; rotate keys after the exam.
- [ ] Components Map = `docs/components-map.png` plus the tables in `docs/ARCHITECTURE_REPORT.md` section 3.

## Prompts for Claude Code (copy as needed)
- "Read CLAUDE.md and docs/BUILD_PLAN.md. Run Phase 1 steps I have credentials for, and stop at the first failure with the exact error."
- "Write a fixture-based test that replays a Sunday-batch-missing scenario through runWeekly with mocked db and fetch."
- "Add the injected-abstract evaluation script in scripts/ that scores 25 hostile abstracts and prints a table."
