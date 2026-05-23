# 116 — /api/sync runtime overshoot (diagnose + bound)

## What this is

HO 115 split summarize off `/api/sync`, but `/api/sync` itself still overshoots the 60s ceiling. Per HO 115's lock #4 verification: 86.4s locally for a 5-hour-gap test (213 bills seen, 148 upserted). The 2× local rule projects considerably worse against the prod 24-hour cron interval. runSync's serial per-changed-bill detail fetch is the structural bottleneck.

This blocks more than just clean cron exits. Inside the 5-hour-gap local test, news ingestion completed (28 mentions inserted across three feeds) — but the prod cron dies at 60s well before news runs. So even after HO 115, news is still silent in production and the HO 114 breaking-news block on the home page has no fresh data. Same applies to lead synthesis, trades ingestion, and the Monday weekly report.

Prior art:
- HO 115 (summarize split + time-budget + AbortController + failure tracking) — same shape, different step
- HO 105 (cron_runs + implicit-timeout pattern) — third hit on it
- `lib/primaries-sync.ts` — the in-repo precedent for bounded sync

## Phase 1 — runSync diagnostic (HALT for sign-off)

Code already established the headline (runSync is the bottleneck). Phase 1's job is to characterize the cost shape precisely so the fix shape is unambiguous.

### Code reads

- `lib/sync.ts` (runSync) top-to-bottom. What's the loop structure? Does it fetch detail for every listed bill or only changed ones? What does the "changed" signal look like coming back from the Congress.gov list endpoint?
- `lib/primaries-sync.ts` end-to-end. How does it bound? Cursor pattern, per-tick cap, time budget, all three? Capture the exact mechanism.
- Congress.gov list endpoint usage — pagination behavior, page size, filter params, what `updateDate` fields the list response carries

### Measurements to run

Build on the scripts/diagnostic/ pattern from HO 115:

```bash
npm run sync -- --dry --measure
```

(or equivalent — if no `--measure` flag exists, add a scratch script under `scripts/diagnostic/`)

Capture:

- Total wall-clock
- Number of list-page calls vs detail-fetch calls
- Per-call latency for list and detail (p50, p95, max), local
- Projected prod numbers via the 2× rule
- How many bills the list endpoint returns for a typical 24-hour-gap (use the SQL below to estimate)
- How many of those genuinely have new substantive content vs no-op updates (i.e. update_date moved but no real change after detail-fetch)

### Queries

```sql
-- What does a "normal day" volume look like vs current backlog scenario?
SELECT
  CASE
    WHEN update_date >= datetime('now', '-1 day') THEN '<1d'
    WHEN update_date >= datetime('now', '-7 days') THEN '1-7d'
    WHEN update_date >= datetime('now', '-30 days') THEN '7-30d'
    ELSE '>30d'
  END AS bucket,
  COUNT(*) AS n
FROM bills
GROUP BY bucket
ORDER BY bucket;
```

```sql
-- cron_runs detail for /api/sync since HO 115 deploy
SELECT route, started_at, status, ended_at, error_message
FROM cron_runs
WHERE route = '/api/sync'
ORDER BY started_at DESC
LIMIT 20;
```

```sql
-- Daily upsert volume from /api/cron/summarize bills (proxy for sync work)
-- since HO 115 deploy
SELECT date(summary_updated_at) AS day, COUNT(*) AS bills_summarized
FROM bills
WHERE summary_updated_at >= '2026-05-22'
GROUP BY day
ORDER BY day DESC;
```

### Selector behavior

Is runSync's loop ordered? If yes:

- Oldest-first: backlog compounds, never catches up under bounded tick
- Newest-first: most-recent always processed; oldest in backlog starve

For a feed where freshness matters, newest-first is right. Lock the choice explicitly in the diagnostic report.

### Report format

Post findings in chat:

1. runSync structure: actual code path of list pagination → detail-fetch loop
2. Per-call latency for list and detail (local + 2× projection)
3. Typical-day volume (24h gap, normal) vs backlog-day volume (current)
4. cron_runs evidence on /api/sync since 115 deployed
5. `primaries-sync.ts` pattern summary in plain language
6. One-paragraph diagnosis identifying which case applies:

- **A. Single-tick bound is enough.** Time-budget runSync at ~35s, downstream steps (lead + news + trades + report) fit in remaining ~25s. Normal-day volume drains in one tick. Backlog drains over multiple ticks.
- **B. Split runSync onto its own cron.** Even bounded, runSync needs the full 60s. Downstream steps need their own budget. New `/api/cron/sync` at 09:00, downstream stays at `/api/sync` at a later time.
- **C. Smarter diffing eliminates most cost.** Most update_date changes are no-op (procedural updates with no new content). Skip detail-fetch when stored update_date matches incoming. Cuts cost ~70%, makes A trivially achievable.
- **D. Mix.** Likely C + A: diff first, bound the residual.

Propose Phase 2 fix shape before halting.

### HALT

Wait for sign-off in chat before Phase 2.

## Phase 2 — Fix (after Phase 1 sign-off)

Shape depends on Phase 1. Likely components below; apply what the diagnosis warrants.

### Bound runSync with time budget + AbortController

Mirror the summarize fix from HO 115:

- runSync accepts `deadlineMs` (e.g. 35s if downstream steps need 25s headroom; tune per Phase 1)
- Stops starting new bills at deadline. Check the deadline at the top of each loop iteration.
- Per-bill detail fetch wrapped in AbortController (15s, same as summarize). Stops at `deadlineMs + 15s` worst case.
- Cursor persisted: last-processed `update_date` or page index in `sync_state` table or column

### Smarter diffing (if Phase 1 finds case C or D)

- Cache the incoming `update_date` from the list endpoint
- Compare to stored `bills.update_date`
- If equal, skip the detail-fetch entirely (no real change since last sync)
- If different, fetch detail and upsert
- Likely the biggest single win if Phase 1 shows lots of no-op updates

### Per-bill failure tracking

Mirror HO 115's pattern. Decide whether to reuse `summarize_failed_at` as a generic "we hit a problem with this bill" flag, or add a separate `bills.sync_failed_at` column. Recommendation: separate column. They're different problems (sync = couldn't fetch detail; summarize = couldn't generate text) and should be debuggable independently.

If separate:
- New column `bills.sync_failed_at TIMESTAMP`, nullable
- New column `bills.sync_attempts INTEGER DEFAULT 0`
- Skip if `sync_failed_at < 24h` in the runSync selector
- 3+ failures get logged to `cron_runs.error_message`
- Reset on a clean upsert

### vercel.json + cron_runs

If splitting (case B): add `/api/cron/sync` entry, adjust `/api/sync` schedule if needed.
If bounding only (cases A/C): no vercel.json changes.

cron_runs instrumentation already covers `/api/sync`; no changes needed unless adding the new route.

### Testing

- Local: hit `/api/sync` via prod-build curl with `CRON_SECRET`. Confirm runs cleanly inside 60s.
- Multi-tick: simulate 3-5 consecutive ticks against a static DB snapshot. Confirm cursor advances and eventually catches up to current.
- Pre-deploy: same test against deployed function.
- Post-deploy: wait for next 09:00 UTC tick. Confirm cron_runs shows clean completion, news_mentions gets fresh inserts (HO 114 block validates this), `summary_updated_at` keeps moving via the 10:00 UTC summarize cron.

## Out of scope

- Touching `/api/cron/summarize` (just shipped, working). Verify it still works post-change but don't modify.
- Adding new observability beyond cron_runs.
- Backfilling stale data by hand. The bounded cron drains over several days.
- Optimizing Congress.gov API usage beyond the diffing improvement (if case C/D). No fancy bulk endpoints.
- Refactoring news, trades, or report ingestion. They have their own runtime profiles and are separate concerns.

## Acceptance

1. Phase 1 diagnostic posted in chat. Root cause + volume profile reported. Fix shape proposed and signed off.
2. Phase 2 implemented per signed-off shape.
3. Post-deploy: next `/api/sync` tick after merge completes inside 60s with downstream-step headroom. cron_runs shows clean completion (status='success', end timestamp populated).
4. Backlog drains over subsequent ticks. Track via update_date age distribution in bills: the >7d and >30d buckets should shrink daily.
5. News ingestion populates `news_mentions` again in prod (HO 114 home block validates).
6. Commit: `fix(cron): bound /api/sync runSync runtime (HO 116)` or similar matching the actual fix shape.
7. SKILL.md gains a line under "Things to watch for" noting that this is now the third hit on the multi-step cron 60s budget pattern — every multi-step daily cron needs either its own per-step time budget or its own dedicated cron route.
8. Working tree clean, pushed.

## Notes

- The `lib/primaries-sync.ts` precedent should make this fix structurally familiar. Read it first.
- 86.4s local for a 5-hour gap is the HO 115 verification baseline to revisit after the fix lands. Aim for: same gap → same or better wall-clock, fits inside 60s with downstream-step headroom.
- After HO 116, `/api/sync` should be: bounded sync + revalidate + lead + news + trades + report (Mondays) running cleanly in <60s, with cursor-based drain over multiple ticks for catchup scenarios.
- HO 115 paired the implicit-timeout pattern with the ~2× local rule in SKILL.md. HO 116 makes it three hits. Worth treating as a load-bearing project principle now, not a one-off finding.
- If Phase 1 finds case C dominant, the smarter-diffing approach is the kind of "small fix, big impact" change that Phase 2 might collapse to a tight commit. Ship small if so.
