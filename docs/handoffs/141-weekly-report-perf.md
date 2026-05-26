# 141 — Weekly report perf: fit `generateWeeklyReport` inside Vercel's 60s ceiling

## What this is

HO 139 split the weekly report into `/api/cron/weekly-report`, expecting the route's freshly-dedicated 60s budget would let the cron succeed. Verification during HO 139 measured `generateWeeklyReport()` end-to-end at **88s** locally — Gemini Flash with `thinkingBudget: 8192` dominates. The wrapper's 55s soft timeout fires before the call completes, so the cron now finalizes as `status='timeout'` (HTTP 504) every Monday instead of producing a `reports` row.

HO 139's durability wins still land — the row finalizes cleanly with a named failure mode instead of orphaning. But the cron does not yet generate reports. Rows are still coming from manual `npm run report`.

This handoff brings the LLM call inside the budget.

## Prior art

- **HO 139** — split + cron_runs finalize sweep. Closed the durability problem, surfaced the perf one.
- **HO 110** — section ordering + zero-case copy. Changing prompt structure here would risk regressing that work.
- **HO 112** — the LEAD synthesis rule that justified the high thinking budget in the first place.
- **HO 112.2** — banned-phrase regenerate-on-violation retry; doubles the worst-case latency when the model leaks.

## Hypothesis — where the 88s lives

Likely (unmeasured) breakdown:

- `gatherReportData()` — 7 SQL queries, all over the live Turso connection. Probably 2-5s total.
- Gemini Flash call — `thinkingBudget: 8192`, single completion, ~80s in dev. Vercel→Google latency is typically faster than dev-laptop→Google, but the thinking budget dominates either way.
- Retry path (HO 112.2) — when the model leaks a banned phrase, a second Flash call doubles the latency. The 5-19 backfill rows that exist suggest at least some weeks complete on the first call.

Phase 1 should measure these splits before picking a fix.

## In scope

- **Phase 1 diagnostic** to split the 88s into `gatherReportData` time vs. each LLM call time, with and without the retry path.
- Lower the thinking budget OR restructure the LLM call to fit inside 50s on Vercel.
- If the model leaks too often at the lower budget, decide between (a) accepting more retries on a faster base call vs. (b) keeping the high budget and finding latency elsewhere.
- Re-verify by hitting `/api/cron/weekly-report` after the change and confirming `status='success'` with a new `reports` row.

## Out of scope

- Changing the report's *content* (sections, ordering, prompt vocabulary). HO 110 + 112 settled those.
- Changing the wrapper, reaper, or soft timeout default. HO 139 settled those.
- Moving to a different model family (Pro, Opus, etc.). Stays on Flash.
- Streaming responses — `generateWeeklyReport` returns the full text before `parseReportResponse` runs; streaming wouldn't change end-to-end latency.
- Splitting into multiple cron ticks via a state machine — overkill for one weekly LLM call.

## Phase 1 — Diagnostic

### Measurements to capture

1. **`gatherReportData()` alone**, three runs, median. Compares against a 5-10s expectation. If much higher, fix that first.
2. **First Flash call alone** (current `thinkingBudget: 8192`), three runs, median, content length, whether the response trips the banned-phrase scan.
3. **First Flash call with `thinkingBudget: 1024`**, three runs, median, content length, banned-phrase rate.
4. **First Flash call with `thinkingBudget: 2048`**, same.
5. **First Flash call with `thinkingBudget: 4096`**, same.
6. **Retry-path latency**: cold call → corrective prompt → second call. Median across 3 runs of a known-bad week if reproducible.

Run these from a Vercel preview environment if possible — dev-laptop latency to Google is the obvious confounder.

### Confirmations to post

1. **Bottleneck source.** Recommend confirming Gemini latency dominates before tuning anything; if `gatherReportData()` is unexpectedly slow, that's the cheaper fix.
2. **Thinking-budget target.** Recommend the lowest value that keeps banned-phrase rate ≈ current. If 1024 works, take it. The HO 112.2 retry path is the safety net for the rare leak.
3. **Latency budget under wrapCronRoute.** First-call median should sit under 45s. Worst case (one retry) under 50s. 5s buffer to the wrapper's 55s timeout, 10s to the 60s SIGKILL.
4. **Output-quality regression.** Lower thinking budget may produce flatter LEAD synthesis. Confirm against the HO 112 anti-recital rules by hand-reading 3 generated reports. If quality degrades meaningfully, fall back to the higher budget and look elsewhere (split call, prompt trim, etc.).

### HALT

End Phase 1 with: per-step measurements, recommended thinking-budget value, output-quality assessment, deferred-fix-if-quality-regresses recommendation. Wait for sign-off before Phase 2.

## Phase 2 — Implementation (after sign-off)

If thinking-budget lowering is the chosen fix:

```ts
// lib/report-generation.ts
const config = {
  systemInstruction: SYSTEM_PROMPT,
  thinkingConfig: { thinkingBudget: 1024 }, // was 8192 — HO 141
};
```

If a deeper restructuring is needed, that's its own phase.

## Verification

1. Manually invoke `/api/cron/weekly-report` — `cron_runs` row finalizes as `status='success'` with `elapsed_ms < 50_000`.
2. New `reports` row appears with the correct slug for the prior week.
3. The HO 110 section order and HO 112 LEAD-synthesis rules still hold by hand-reading the generated report.
4. Banned-phrase scan finds no violations across 3 backfilled test weeks.
5. Type-check clean, working tree clean, pushed.

## Acceptance

1. Phase 1 diagnostic posted with per-step measurements + 4 confirmations.
2. Sign-off received before Phase 2 commits.
3. Phase 2 ships per signed-off spec.
4. `/api/cron/weekly-report` succeeds end-to-end and the next Monday cron produces a `reports` row.
5. SKILL.md updated: drop the "Known issue, deferred to HO 141" caveat in the cron-topology bullet and the route file header.
6. Commit: `perf(report): fit weekly report inside cron budget (HO 141)`

## Don't

- Don't move the call to a smaller / weaker model just to fit the budget. Cheaper synthesis is not the lever; latency under fixed model is.
- Don't break the HO 110 / HO 112 / HO 112.2 rules to save time. The report's purpose is synthesis; speed at the cost of recitation is a regression.
- Don't ship Phase 2 without checking the banned-phrase rate at the new budget — a model that leaks more often will double its average latency via the retry path.
- Don't add caching that hides repeat-week behavior. Each Monday's call is genuinely new data; caching would mask perf changes.

## Notes

- The 5-19 manual backfill rows (`/reports`) were created locally via `npm run report` with no 60s ceiling. They're how we know the report content is correct at the current thinking budget.
- If thinking-budget=1024 produces noticeably flatter leads, consider trimming the system prompt instead — fewer banned-phrase rules to weigh + fewer voice instructions might let a smaller budget produce equal quality.
- This is a single-LLM-call problem, not a pipeline problem. Don't over-engineer.
