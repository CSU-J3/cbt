# 135 — Cron health check

## What this is

Diagnostic. The cron infrastructure took a series of changes in quick succession — HO 115 (summarize timeout), HO 116 (runSync bound), HO 117 (news cron split), HO 119 (cron tick validation). All shipped, all greenlit on first-tick validation, but the project hasn't taken a deliberate read since. This handoff queries `cron_runs` and adjacent state to confirm everything is running clean, or surface what isn't.

Read-only. No code changes unless Phase 1 reveals a clear failure mode that warrants a Phase 2 fix.

## Phase 1 — Audit (read-only, report in chat)

### What to check

For each cron route in `vercel.json`, query `cron_runs` for the last 14 days and report:

1. **Total runs.** Expected count given schedule. Missing runs are signal.
2. **Status distribution.** `started`, `completed`, `failed`, `timeout`, or whatever statuses the table uses. Map them to a clean "clean / warning / fail" bucket.
3. **Duration.** Average and max in seconds. Anything over ~55s is a flag (60s Vercel ceiling).
4. **Errors.** Any `error_message` populated in the last 14 days — list them with timestamp + route, even if the run eventually completed.
5. **Most recent run.** Timestamp, status, duration. This is the freshness check.

### Cross-reference with data freshness

`cron_runs` shows the route did or didn't fire. It doesn't show whether the route's work landed. Three quick sanity queries to confirm data is actually flowing:

```sql
-- Bills sync freshness: when was the most recent upsert?
SELECT MAX(update_date) AS latest_update FROM bills;

-- Summarize freshness: when was the most recent summary written?
SELECT MAX(summary_updated_at) AS latest_summary FROM bills WHERE summary IS NOT NULL;

-- News freshness: when was the most recent mention ingested?
SELECT MAX(seen_at) AS latest_mention FROM news_mentions;
```

If `cron_runs` shows clean completions but data freshness lags by more than a day, that's a silent-failure signal worth flagging.

### Report format

Post in chat. Per route, a short block:

```
ROUTE: /api/cron/summarize
Schedule: 0 10 * * * (per vercel.json)
Expected runs (14d): 14
Actual runs: 14
Status: 14 completed, 0 timeout, 0 failed
Duration: avg 38s, max 52s
Errors: none
Last run: 2026-05-27 10:00:14 UTC, completed, 41s
Verdict: CLEAN
```

End with a one-paragraph overall verdict:

- **CLEAN** — all routes healthy, no follow-up needed
- **WATCH** — minor issues (e.g. one timeout, one missed run) worth monitoring but not fixing
- **FIX** — concrete failure mode that needs a Phase 2 handoff. Propose shape inline.

### HALT

Wait for sign-off before Phase 2 (if any).

## Phase 2 — Fix (only if Phase 1 verdict is FIX)

Shape depends on what Phase 1 finds. Most likely candidates if anything is broken:

- **Timeout on a specific route.** Apply the same bound + AbortController pattern HO 115 and HO 116 established. Time-budget the long-running operation, persist a cursor, drain over multiple ticks.
- **Silent failure where status is `completed` but data lags.** Likely an exception swallowed somewhere in the route handler. Add error logging at the right boundary; fail loud.
- **Missed runs.** Vercel cron occasionally skips ticks on the Hobby tier. If the pattern is consistent rather than random, may need to investigate. If sporadic, document and move on.

Don't write Phase 2 implementation inline here. Propose shape in chat after Phase 1, get sign-off, then it becomes its own handoff.

## Out of scope

- Modifying `vercel.json` schedules. Schedules are deliberate; if a route needs a different schedule that's a separate conversation.
- Refactoring any cron route. This is health-check only.
- Adding new observability beyond what `cron_runs` already provides.
- Backfilling data gaps. If freshness lags, Phase 2 fixes the cause; the gap drains naturally once the route is healthy again.

## Validation

1. Phase 1 report posted in chat with one block per route.
2. Overall verdict: CLEAN, WATCH, or FIX.
3. If FIX, Phase 2 shape proposed inline.
4. No commits in Phase 1.

## Notes

- The four cron-touching handoffs (115/116/117/119) all shipped without coordinated end-to-end verification. This audit is the coordinated read.
- HO 117 was the news cron split. If `vercel.json` shows the new news route, the audit needs to cover it. If the split was rolled back or never landed, flag that.
- Today is 2026-05-27 (Wednesday). Two weekday ticks (Mon 05-25, Tue 05-26) have run since this would be the most recent meaningful sample. Weekend ticks count toward the 14-day window but are less load-bearing.
