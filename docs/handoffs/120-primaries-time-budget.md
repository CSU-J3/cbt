# 120 — Apply time-budget pattern to /api/cron/primaries

## What this is

`/api/cron/primaries` has been showing implicit timeouts. HO 119 validation surfaced two in the last 24h: `status='running'` with no `finished_at`, hung past the function ceiling. Same shape HO 105 originally caught for `/api/sync` — the route runs past 60s, Vercel kills it, the cron_runs row is left orphaned.

The fix is the same time-budget pattern HO 115/116/117 applied to summarize, runSync, and news. Phase 1 diagnoses where the route actually spends its time. Phase 2 mirrors the pattern: `deadlineMs`, `AbortController` on outbound HTTP, `cron_runs.payload.timings` instrumentation.

Not urgent. Primaries data is cycle-locked, candidates don't churn day-to-day, and the next event that matters is the LA Senate runoff on June 27. But the pattern's well-rehearsed and the leak should close before the cron silently misses a real update.

Prior art:
- HO 105 (cron_runs + implicit-timeout detection)
- HO 115 (summarize split + deadline + per-LLM AbortController)
- HO 116 (runSync time budget + batched diff)
- HO 117 (news split + per-article AbortController)

## Phase 1 — Diagnostic (HALT for sign-off)

### Code reads

- `app/api/cron/primaries/route.ts`: current structure, what it iterates, where it calls external HTTP.
- The primaries scraper module (likely `scripts/sync-primaries.ts` or `lib/primaries/`): top-level loop shape, per-district scrape function, any existing timeout or AbortController logic.
- `vercel.json`: confirm the cron schedule (HO 119 saw it at 12:00 UTC) and route path.
- Most recent **successful** run of `/api/cron/primaries` from `cron_runs.payload`, if any exists. Pull whatever timings or counts it logged.

### Verification measurements

If a `--measure` flag pattern exists from HO 115/117, mirror it. Otherwise add a scratch script under `scripts/diagnostic/` matching that shape.

```bash
npm run sync:primaries -- --measure
```

(Or whatever the existing CLI entry is — probably `npm run sync:house-primaries -- --region=west` style from HO 96 era.)

Capture:
- Total wall-clock for a full pass
- Per-state (or per-region) breakdown
- Per-district scrape latency: p50, p95, max
- Distribution of slow vs fast districts — long tail, or roughly uniform?
- Outbound HTTP failure rate: timeouts, 5xx, parse failures

### Open questions

Phase 1 answers:

1. Does the cron sweep all regions every tick, or rotate? Total districts per tick = N.
2. Sequential or parallel scraping? If sequential, total ≈ N × p50 per-district.
3. What's the actual time budget needed? If 400 districts × 500ms = 200s sequential, no single-tick deadline can rescue this; the fix is chunking.
4. Is one specific state or page consistently slow? (e.g., Ballotpedia rate-limiting California's 52 districts.)

### Report format

Post findings in chat. Sections:

1. Route + cron config — path, schedule, what it calls
2. Loop shape — pseudocode sketch of per-tick work (regions → states → districts → scrape → upsert)
3. Per-district latency from the measure run — table or histogram
4. Most recent successful run's `cron_runs.payload`, if it exists
5. One-paragraph diagnosis:
   - **A. Sequential single-tick fits in 60s.** Apply HO 115/117 deadline pattern, done.
   - **B. Sequential exceeds 60s but bounded parallelism is safe.** Add concurrency (e.g. 4 concurrent district scrapes) + deadline.
   - **C. Total work doesn't fit, period.** Chunk across ticks — rotate regions per day, or move from daily to weekly.
   - **D. Mix.** Describe specifically.

End with proposed Phase 2 params: deadline, per-request HTTP timeout, concurrency (if any), chunking strategy (if any).

### HALT

Stop here. Wait for sign-off in chat before Phase 2.

## Phase 2 — Fix (after Phase 1 sign-off)

Mirror HO 115/117 pattern. Specific shape depends on Phase 1's A/B/C/D verdict.

### Route changes

- `app/api/cron/primaries/route.ts`:
  - `maxDuration: 60`
  - Wrap `startCronRun` / `finishCronRun` if not already present (per HO 105 instrumentation)
  - Compute `deadlineMs` per Phase 1 (e.g. `Date.now() + 50_000`)
  - Pass `deadlineMs` into the primaries-sync entrypoint
  - Log timings to `cron_runs.payload.timings` (per-state or per-region breakdown)
  - `revalidateTag('primaries')` after success — HO 96 wrap noted this was parked behind `unstable_cache` work; revisit during Phase 2 if the tag exists, otherwise skip

### Scraper refactor

- Accept `deadlineMs` param at the top-level entry
- Check deadline between regions (don't start a new region if budget tight)
- Check deadline between districts within a region
- Wrap each outbound `fetch` in `AbortController` with per-request timeout from Phase 1 (likely 8-15s)
- Thread `AbortSignal` through fetch options
- Return SyncStats-style object: `{ regionsProcessed, statesProcessed, districtsProcessed, candidatesUpserted, candidatesUpdated, budgetStopped, timedOut, perRegionTimings, fetchFailures }`

### Chunking (only if Phase 1 = C)

If a full sweep can't fit in 60s, add rotation:
- Store `cron_runs.payload.lastRegionCompleted` (or similar pointer) on each successful tick
- Each tick reads that pointer, picks up at the next region
- Full sweep completes across N days (e.g., 4 ticks for 4 House regions + Senate)
- Acceptance criteria adjust — confirm one full rotation cycle within the calendar window

### Cleanup

- Mark the two orphaned `cron_runs` rows from HO 119's report as `failed` with an explanatory `error_message`, or leave them as historical evidence. Pick one in chat during Phase 2 sign-off.

### SKILL.md update

- Cron topology table gets primaries marked as using the time-budget pattern (fifth application after 115/116/117 + original 105)
- If chunking is added, document the rotation cadence

## Out of scope

- Adding new states or districts to scrape (HO 91-96 territory)
- Changing the per-state parsers (top-two, top-four, partisan, jungle — all HO 92-96)
- Runoff scraping (separate handoff; LA Senate June 27 is the natural first test)
- Schema changes to candidates or races tables

## Acceptance

1. Phase 1 pre-flight posted with A/B/C/D diagnosis and Phase 2 params proposed.
2. Phase 2 implemented per sign-off.
3. Post-deploy: next 12:00 UTC primaries tick completes with `status='success'` and `payload.timings` populated.
4. No new orphaned `cron_runs` rows from `/api/cron/primaries`.
5. If chunking landed, one full rotation cycle confirms all regions get scraped within the cadence.
6. SKILL.md reflects the topology update.
7. Commit: `feat(cron): apply time-budget pattern to /api/cron/primaries (HO 120)` or matching shape.
8. Working tree clean, pushed.

## Notes

- Primaries data is cycle-locked. A few days of stale scraping won't matter — what matters is that the cron stops orphaning and resumes structured logging.
- Phase 1 is heavier than HO 117's because per-district latency isn't already known. Don't skip the measure step; the diagnosis depends on it.
- If Phase 1 finds the route is hitting external rate limits (Ballotpedia 429s, slow renders on big-state pages), the retry pattern from HO 48 ("retry 503 like 429") may want to layer on. Phase 2 sign-off conversation can decide.
- After this handoff, the only daily multi-step left in `/api/sync` is the Monday weekly report. If Monday's tick lands tight, that's the next split candidate.
