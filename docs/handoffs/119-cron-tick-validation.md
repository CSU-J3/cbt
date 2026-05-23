# 119 — Validate first prod cron tick post-split

## What this is

HO 115/116/117 split `/api/sync` into three crons: `/api/sync` (09:00 UTC), `/api/cron/summarize` (10:00 UTC), `/api/cron/news` (11:00 UTC). Today's 09:00 UTC was the first prod run of the new topology.

This handoff is diagnostic-only. Read `cron_runs` and a couple of related tables, post findings in chat. Don't ship any code changes from this handoff — if something looks off, the fix becomes a follow-up (HO 120+).

Why bother: Monday's tick adds the weekly report to `/api/sync`. If the new topology has a quiet problem today (Saturday, low new-bill day), the weekly-report addition on Monday will compound the unknowns. Cheaper to know now.

## Phase 1 — Validation queries (HALT for sign-off)

### Queries to run

```sql
-- 1. All cron_runs from the last 24h, ordered most recent first
SELECT
  route,
  status,
  started_at,
  finished_at,
  CAST((julianday(finished_at) - julianday(started_at)) * 86400000 AS INTEGER) AS elapsed_ms,
  error_message
FROM cron_runs
WHERE started_at >= datetime('now', '-24 hours')
ORDER BY started_at DESC;
```

```sql
-- 2. payload.timings for each of the three split crons, today's tick
SELECT
  route,
  started_at,
  payload
FROM cron_runs
WHERE route IN ('/api/sync', '/api/cron/summarize', '/api/cron/news')
  AND started_at >= datetime('now', '-24 hours')
ORDER BY started_at DESC;
```

(If `payload` is JSON, pretty-print the `timings` object for each row in the report.)

```sql
-- 3. news_mentions ingested today (since news cron fired)
SELECT
  COUNT(*) AS rows_today,
  MIN(ingested_at) AS first_ingest_today,
  MAX(ingested_at) AS latest_ingest_today
FROM news_mentions
WHERE ingested_at >= datetime('now', '-24 hours');
```

```sql
-- 4. Backlog status — bills with NULL summary, current count
SELECT COUNT(*) AS backlog_count
FROM bills
WHERE summary IS NULL;
```

```sql
-- 5. Summarize throughput today: how many bills got summaries set in the last 24h
SELECT COUNT(*) AS summarized_today
FROM bills
WHERE summary IS NOT NULL
  AND updated_at >= datetime('now', '-24 hours');
```

### Code checks (no edits)

- `app/api/sync/route.ts`: confirm the news step is gone post-HO-117 and the response payload no longer has a `news` key in `timings`.
- `vercel.json`: confirm all three crons are wired with the expected schedules (09:00 / 10:00 / 11:00 UTC).

### Report format

Post findings in chat. Structure:

1. **Cron run table** (from query 1) — route, status, elapsed_ms, error_message for each row in the last 24h. Flag any `status != 'success'` rows red.
2. **Per-cron timing breakdown** (from query 2) — pretty-printed `payload.timings` for each of the three split crons.
3. **News ingestion** (from query 3) — rows_today, first/latest ingest timestamps.
4. **Backlog status** (from queries 4 + 5) — current backlog count, bills summarized today.
5. **Code-path confirmations** — sentence each on the `/api/sync` news-key absence and `vercel.json` schedules.

### Assessment

End the report with a one-paragraph assessment against these expected ranges:

| Cron | Expected elapsed | Expected timing shape |
|---|---|---|
| `/api/sync` | well under 20s (was ~10s in local verification) | timings has sync/lead/trades, NO news key, report key only on Mondays |
| `/api/cron/summarize` | 45-55s typical (HO 115 deadline budget) | timings has per-batch breakdown, count of bills processed |
| `/api/cron/news` | 45-55s typical (HO 117 deadline budget) | timings has per-feed breakdown, articles seen/matched counts |

State explicitly: pass, marginal, or fail per cron. If any cron failed, error_message + what it implies for the fix shape. If any cron passed but is marginal (close to 60s ceiling, or counts way off expected volume), call that out.

### HALT

Stop here. Post the report in chat. No code changes. No fixes. Wait for sign-off on what (if anything) to do next.

## Out of scope

- Any fix that surfaces. Fixes become HO 120+ after this report is reviewed.
- Other crons (votes, ratings, primaries). Those run on different days/schedules and are orthogonal to the HO 115/116/117 split.
- Backlog drain itself. That's a one-off command, not a handoff — runs after this validation if the summarize cron is healthy.

## Acceptance

1. Five-query report posted in chat with the format above.
2. Assessment paragraph stating pass/marginal/fail per cron.
3. No code changes committed from this handoff.
4. Next move proposed in one sentence (drain backlog / fix X / wait for Monday / etc.).

## Notes

- Today is Saturday. Low new-bill day. Sync's `bills_inserted` will probably be small or zero; that's expected, not a problem. The thing to validate is that the cron ran and timings look healthy, not that volume was high.
- Weekly report only fires Mondays. Today's `/api/sync` should not include a `report` timing key. If it does, something's wrong with the schedule guard.
- HO 114's `breaking-news-home` cache tag should have been revalidated by today's news cron. If `/` shows stale data despite a healthy news cron run, that wiring is suspect.
