# 115 — /api/sync summarize timeout (diagnose + fix)

## What this is

The `/api/sync` daily cron has been silently failing since 2026-05-18. The summarize step hangs inside the 60s function `maxDuration`, so the news-ingestion step that runs after it is never reached. Result: summaries stale 4+ days, news only ever populated by manual `npm run sync:news` runs.

Surfaced in HO 114's Phase 1 diagnostic. This handoff diagnoses what specifically is hanging and ships a fix.

Prior art: HO 105 introduced the `cron_runs` table and named the implicit-timeout pattern. This is the second hit on it.

## Phase 1 — Root cause diagnostic (HALT for sign-off)

Don't propose fixes until you know what's actually failing. The 60s cap is a symptom; the cause is what changed around 05-18 and what specifically the summarize loop is spending time on.

### Queries to run

```sql
-- When did summarize last successfully run, and at what daily rate?
SELECT date(summary_updated_at) AS day, COUNT(*) AS bills_summarized
FROM bills
WHERE summary_updated_at IS NOT NULL
GROUP BY day
ORDER BY day DESC
LIMIT 30;
```

```sql
-- Current backlog of bills awaiting summarization.
-- The selector depends on summarize-step code; read it first, then fill in.
SELECT COUNT(*) AS backlog FROM bills WHERE <summarize selector>;
```

```sql
-- Cron_runs detail for /api/sync since instrumentation went live
SELECT * FROM cron_runs WHERE route = '/api/sync' ORDER BY started_at DESC LIMIT 20;
```

```sql
-- Are any bills consistently NOT getting summarized?
-- I.e. bills that have been in the backlog for >7 days
SELECT bill_id, latest_action_date, length(full_text) AS text_len
FROM bills
WHERE summary IS NULL
  AND <other selector criteria>
ORDER BY latest_action_date DESC
LIMIT 20;
```

### Code reads

- `app/api/sync/route.ts` — top-level handler. What runs in what order. Where's `maxDuration` set?
- `lib/sync.ts` or wherever the bill sync lives
- The summarize step — `lib/summarize.ts`? Inline? Find it.
- The summarize slice config — how many bills per tick, what selector picks the slice, any per-bill timeout in place
- LLM client code (Gemini wrapper) — any per-call timeout? Retry logic that could spin forever on certain error classes?
- Recent commits touching this code path:

```bash
git log --oneline --since="2026-05-10" -- "**/sync*" "**/summarize*" "**/llm*" "**/gemini*"
```

Note anything suspicious in the 05-17 to 05-19 window.

### Local reproduction

Run summarize standalone to measure actual per-bill latency:

```bash
npm run summarize -- --limit 5 --dry
```

(or whatever the actual CLI is — find it in `scripts/`)

Capture:

- Average per-bill latency
- p95 per-bill latency
- Any bills that hang, error, or get retried
- Total runtime for the same slice size the cron is configured to use

The key question: does per-bill latency × configured slice size *actually* exceed 60s in steady state, or is the loop hanging on one bill or one retry?

### Report format

Post findings in chat:

1. `summary_updated_at` distribution (when was the last good day, what was the steady-state rate before 05-18)
2. Current backlog size
3. `cron_runs` detail for `/api/sync`
4. Sync route structure: what steps run in what order, where summarize sits, where the maxDuration limit is set
5. Summarize slice config: limit, selector, per-bill timeout (if any)
6. Recent commits touching the path with dates
7. Local reproduction timings
8. One-paragraph diagnosis identifying which of these applies:

- **A. Slice too large for steady state.** Per-bill latency × configured slice exceeds 60s. Fix shape: smaller slice or split summarize into its own cron.
- **B. Specific bill choking the loop.** One or more bills cause the model to hang or retry endlessly. Fix shape: per-bill timeout + skip-on-fail + log to a new "stuck bills" table or column.
- **C. Gemini latency regression.** API got slower; previously-fit slice no longer fits. Fix shape: smaller slice; check for rate-limit headers; consider model swap.
- **D. Loop bug.** Retry storm, infinite loop, off-by-one in slice cursor. Fix shape: targeted bug fix.
- **E. Mix.** Describe specifically.

Propose Phase 2 fix shape before halting.

### HALT

Wait for sign-off in chat before Phase 2.

## Phase 2 — Fix (after Phase 1 sign-off)

Exact shape depends on Phase 1 diagnosis. Likely components below; pick what applies.

### Likely primary fix: split summarize into its own cron

If Phase 1 confirms summarize alone genuinely needs more than 60s for a useful slice (case A or C):

- Move summarize out of `/api/sync` into a new route `/api/cron/summarize`
- Add to `vercel.json` as its own daily cron entry (Hobby tier supports multiple crons, just once-daily each)
- Schedule it after `/api/sync` so the bill sync has populated the backlog first (e.g. `/api/sync` at 09:00 UTC, `/api/cron/summarize` at 10:00 UTC)
- `/api/sync` becomes: bill sync + news ingestion + lead synthesis only
- Summarize on its own tick gets the full 60s budget

### Likely secondary components

Apply as the diagnosis warrants:

- **Per-bill timeout in the summarize loop.** Wrap each LLM call in an `AbortController` with an 8-12s budget. On timeout, mark the bill as `summarize_skipped` (new column or value) and move on. Don't let one bill burn the whole tick.
- **Progress checkpointing.** Commit `summary_updated_at` per-bill as it succeeds, not at end-of-batch. A 60s kill mid-batch should leave partial progress.
- **Resumable selector.** "Oldest-pending first" or a `last_attempted_at` cursor so each tick picks up where the last one left off.
- **Logging for stuck bills.** A new column `summarize_attempts INT DEFAULT 0` that increments on failure; bills with `summarize_attempts >= 3` get manually inspected, not retried automatically.

### Testing

- Local: run the new summarize route end-to-end with the full configured slice, confirm it finishes inside 60s wall-clock
- Pre-deploy: after deploy, hit the route once via `curl` (with the cron secret header) and watch the `cron_runs` row complete cleanly
- Post-deploy: wait for the next cron tick, confirm `summary_updated_at` moves and `cron_runs` shows completion within budget
- News verification: confirm the next `/api/sync` tick (sans summarize) completes and news ingestion populates `news_mentions`

## Out of scope

- Refactoring `/api/sync` beyond what's needed to remove summarize
- Touching the news matcher or news ingestion logic
- Changing the LLM model (Flash stays)
- Adding new observability infrastructure beyond `cron_runs`
- Backfilling stale summaries by hand — the new cron picks them up over the next several days as part of normal operation

## Acceptance

1. Phase 1 diagnostic posted in chat. Root cause identified. Phase 2 fix shape proposed and signed off.
2. Phase 2 implemented per signed-off shape.
3. Post-deploy verification: next cron tick after merge completes inside 60s and `summary_updated_at` moves.
4. News ingestion runs again on the next `/api/sync` tick (as a side effect of summarize no longer blocking it).
5. Commit: `fix(cron): split summarize into its own route (HO 115)` or similar shape matching the actual fix.
6. SKILL.md gains a one-line entry capturing the pattern: "Vercel Hobby 60s cap + multi-step daily syncs = silent step-level failures unless each step is its own cron or has its own per-step timeout budget."
7. Working tree clean, pushed.

## Notes

- The 05-18 last-success date is suspiciously close to HO 110/111/112 landing (audit + structural fix sequence on weekly reports). Possible that one of those changes increased summarize cost per bill. Worth checking commits in that window during Phase 1.
- Don't fold in any news work. News will start flowing on its own once summarize stops blocking it.
- HO 112.1 shipped Flash `thinkingBudget=8192` for LEAD synthesis on 2026-05-22. That's the lead step, not summarize, so it can't be the cause of pre-05-22 failures. But if summarize ALSO uses thinkingBudget, check that.
- If Phase 1 finds case D (loop bug), the fix might be a one-line patch and Phase 2 collapses to a small change — that's fine, ship it small.
