# 117 — Split news ingestion into /api/cron/news

## What this is

HO 116's lock-#4 verification surfaced the next ceiling-eater: news ingestion took 48.7s of 60s in the local verification curl. The LLM matcher fires once per article that misses the regex pre-filter — ~52 Gemini calls per tick at ~950ms each. On a busier news day or with prod cold-network tax, it tips over the function ceiling. /api/sync would die mid-news, just like it died mid-summarize before HO 115.

This is the next application of the multi-step-cron-60s pattern: third structural split after HO 115 (summarize) and HO 116 (runSync bound + diff batch). Same shape — pull news out of /api/sync into its own dedicated cron with its own 60s budget. Per HO 116's SKILL.md update, the pattern is now a load-bearing project principle.

Prior art:
- HO 115 (summarize split + time-budget + AbortController + per-step instrumentation)
- HO 116 (runSync time budget + batched diff + cron_runs.payload.timings)
- HO 105 (cron_runs + implicit-timeout pattern)

## Phase 1 — Lightweight pre-flight (HALT for sign-off)

Most of the diagnostic data already exists from HO 116's verification curl. Phase 1 is a focused code-path read plus a couple of measurements, not a full repeat of HO 115/116's diagnostic depth.

### Code reads

- `app/api/sync/route.ts`: the current call site of news ingestion. What function does it call, with what params?
- The news-ingestion module (likely `lib/news-sync.ts` or `lib/news/`). Top-level structure: how does it iterate feeds, where does it call the LLM matcher, where's the regex pre-filter?
- Existing AbortController or per-article timeout logic. Does any exist? If so, how does it interact with the loop?
- The LLM matcher call: what model, what params, current call latency (locally vs the ~950ms figure from HO 116)?

### Verification measurements

```bash
npm run sync:news -- --measure
```

(or scratch script under `scripts/diagnostic/` if no flag exists; match the HO 115/116 pattern)

Capture:
- Per-feed wall-clock breakdown (3 sources)
- Per-article cost: regex-match (cheap) vs LLM-match (expensive)
- Distribution of regex-hit vs LLM-fallback rates across feeds
- LLM call p50, p95, max latency

### The single open question

Phase 1 should confirm: is the news step's 48.7s cost really dominated by sequential LLM calls, or is there hidden work (RSS fetch, feed-parsing) that adds up too?

If sequential LLM calls are the whole story (likely, per HO 116's `~52 calls × ~950ms` math), Phase 2 is a straight mirror of HO 115/116. If there's other dominant cost (e.g. one feed's RSS endpoint is slow, or feed-parsing is unexpectedly heavy), the fix shape might include feed-level timeouts too.

### Report format

Post findings in chat. Brief, three sections:

1. News ingestion code structure (sketch the loop, identify the per-article LLM matcher call site)
2. Per-feed cost breakdown from the measure script
3. One-paragraph: confirm or correct the "sequential LLM is the whole cost" model. Propose Phase 2 params (deadline, per-article timeout, cron schedule slot).

### HALT

Wait for sign-off in chat before Phase 2.

## Phase 2 — Fix (after Phase 1 sign-off)

Mirror HO 115/116 pattern.

### New route: /api/cron/news

- File: `app/api/cron/news/route.ts`
- Auth: same `CRON_SECRET` pattern as other crons
- `maxDuration: 60`
- Wraps `startCronRun` / `finishCronRun` (cron_runs instrumentation)
- Calls news-ingestion code with `deadlineMs` param (e.g. `Date.now() + 45_000`)
- Logs timings to `cron_runs.payload.timings` (per-feed + per-step breakdown)
- `revalidateTag('news-breaking')` after success (matches HO 114's cache tag for the home block)

### vercel.json

Add cron entry for /api/cron/news. Suggested time: **11:00 UTC** (after /api/sync at 09:00 and /api/cron/summarize at 10:00). No dependency on summarize. News ingestion only needs the bills table populated, which sync handles.

### Refactor news-ingestion module

- Accept `deadlineMs` param
- Check deadline at the top of each per-article iteration
- Check deadline between feeds (don't start a new feed if budget is near-exhausted)
- Wrap each LLM matcher call in `AbortController` with ~12s timeout (per Phase 1 latency measurement; tune if needed)
- AbortSignal threaded through the Gemini call config (same pattern as HO 115's summarize-runner)
- Return SyncStats-style object: `{ articlesSeen, regexMatched, llmMatched, mentionsInserted, budgetStopped, timedOut, perFeedTimings }`

### Per-article failure handling

Defer adding `news_mentions.match_failed_at` / `match_attempts` columns unless Phase 1 finds nonzero LLM failures in production data. Same logic as HO 116 lock #4: premature without evidence. If failures occur, log to `cron_runs.error_message`. Add the columns in a follow-up if it becomes a real problem.

### Remove news from /api/sync

- Strip the news step from `app/api/sync/route.ts`
- Update inline comments and the response payload shape
- Make sure `cron_runs.payload.timings` for /api/sync still records sync/lead/trades/report (no `news` key after this change)
- Verify /api/sync stays well under 60s post-split

### SKILL.md update

- Cron topology table gets a fifth entry (sync, summarize, news, plus existing votes/ratings/primaries)
- Note that "multi-step daily syncs get split" is now a project principle on its fourth application (HO 115 summarize, HO 116 runSync bound, HO 117 news, plus the original HO 105 pattern recognition)

### Testing

- Local: hit `/api/cron/news` via prod-build curl with `CRON_SECRET`. Confirm runs inside 45s wall-clock, mentions inserted, timings populated.
- Local: hit `/api/sync` post-strip. Confirm sub-30s on a normal-day gap, no `news` key in timings.
- Pre-deploy: same tests against the deployed function.
- Post-deploy: wait for next 11:00 UTC tick. Confirm `cron_runs.status='success'` for /api/cron/news, `news_mentions` continues populating, HO 114 home-block has fresh data.

## Out of scope

- Touching the regex pre-filter or LLM matcher logic itself (HO 86/104 territory)
- Tuning the matcher's confidence threshold (HO 111 territory)
- Splitting trades or weekly report from /api/sync. If Phase 2 verification shows /api/sync still tight on Mondays (report adds ~20s), that's a future HO 118 / 119. Don't pre-commit.
- Backfilling missed news from days the cron timed out

## Acceptance

1. Phase 1 pre-flight posted, code path confirmed, fix shape signed off.
2. Phase 2 implemented per sign-off.
3. Post-deploy: 11:00 UTC /api/cron/news tick completes with `status='success'` and `news_mentions` populated.
4. Post-deploy: /api/sync (now without news) completes well inside 60s with comfortable downstream headroom.
5. HO 114 home block has fresh data daily via the new cron.
6. SKILL.md gains the fifth cron entry and the project-principle note.
7. Commit: `feat(cron): split news ingestion into /api/cron/news (HO 117)` or matching shape.
8. Working tree clean, pushed.

## Notes

- After HO 117 lands, the only remaining unsplit multi-step is the Monday weekly report inside /api/sync. If post-deploy verification shows Mondays tight (~50s+), HO 118 splits that too. The cron topology stabilizes after that.
- Phase 1 is intentionally lighter than HO 115's diagnostic. Most of the data is already in HO 116's verification output. Don't re-prove what `cron_runs.payload.timings` already showed.
- The 12s per-article LLM timeout is a starting point. If Phase 1 measurements show LLM p95 closer to 1.5s, can tighten to 8s; if there are 2s+ outliers, loosen to 15s.
- Cron stability after this: sync at 09:00, summarize at 10:00, news at 11:00. Each gets its own 60s. Existing votes/ratings/primaries crons unchanged.
