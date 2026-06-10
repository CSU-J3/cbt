# HO 160 — Weekly-report Gemini 503 retry

## Why

The Monday 2026-06-01 09:00 UTC tick of `/api/cron/weekly-report` failed. `cron_runs` captured:

```json
{"error":{"code":503,"message":"This model is currently experiencing high demand. Spikes in demand are usually temporary. Please try again later.","status":"UNAVAILABLE"}}
```

This is Gemini returning `503 UNAVAILABLE` — an upstream transient, not a code bug. The same path succeeded on 2026-05-26 (14.9s). The problem: the weekly-report Gemini call has **no retry on transient failure**, and the route runs once a week, so a single overloaded response kills the entire week's report with no natural recovery until the next manual trigger or seven days later.

The summarize/sync path already handles this — per SKILL.md / HO 48, it retries 503-like-429 responses. Weekly-report should use the same mechanism. This handoff closes that inconsistency.

## Phase 1 — Diagnostic (HALT after)

Do not write any code yet. Report findings, then halt for sign-off.

1. **Locate the existing retry logic.** Find where the summarize/sync path retries Gemini 503/429 responses (HO 48 added this). Report:
   - The function/file where it lives (e.g. a `withRetry` wrapper in `lib/sync.ts`, `lib/gemini.ts`, or wherever).
   - Whether it's a reusable helper or inlined in the summarize loop.
   - Its backoff strategy (fixed delay, exponential, max attempts).

2. **Locate the weekly-report Gemini call.** Find the file and function that generates the weekly report (likely `lib/report-generation.ts` per SKILL.md). Report:
   - The exact call site that hits Gemini.
   - Whether it currently has any error handling around that call.
   - Whether it shares any code with the summarize path's Gemini invocation, or calls Gemini independently.

3. **Confirm the gap.** State plainly whether weekly-report can reuse the existing retry helper as-is, or whether the helper needs extraction/generalization first.

**HALT. Report the above and wait for sign-off before Phase 2.**

## Phase 2 — Implementation (only after sign-off)

Based on Phase 1 findings:

- If a reusable retry helper exists: wrap the weekly-report Gemini call in it. Don't duplicate the retry logic.
- If the retry logic is inlined in summarize: extract it into a shared helper (a small `withGeminiRetry(fn)` or equivalent), then call it from both paths. Keep the backoff behavior identical to what summarize uses today — don't invent new timing.
- Respect the Vercel Hobby 60s function ceiling. The weekly-report run that succeeded took ~15s; a couple of retries with backoff must still land comfortably under 60s. Cap total retry time accordingly (e.g. max 3 attempts with short backoff, not an unbounded loop).
- On final failure after retries exhausted, the `wrapCronRoute` wrapper should still record `status='error'` with the captured message — don't swallow the error silently.

## Verification

- Type check passes.
- Show the diff of the weekly-report call site and the retry helper.
- Do **not** trigger a live weekly-report run as part of verification (it writes to production `reports` and burns Gemini quota). Static verification only.

## Manual follow-up (Corey runs, not Code)

This week's report (week of 2026-05-25) never generated. After this ships, manually fire `/api/cron/weekly-report` once to backfill it. Do this separately — not part of the handoff.
