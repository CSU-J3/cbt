# HO 284 — Report cron hardening: probe

Scope the failure before fixing it. The weekly-report cron is chronically dropping reports (latest: cron #287, Mon Jun 15, "operation was aborted due to timeout", 20.1s LLM abort, so the week-of-06-08 report was never written). Standing HO 242 priority. The fix forks by what the gen flow and the function ceiling actually are, so this is diagnosis only; the fix is 285.

## What's known

From cron_runs: the report cron fails on a ~20s LLM abort and on Gemini 503s, with 55s soft-timeouts in its history. Prior hardening exists (the retry from HO 160, the section split from HO 139, the thinking-budget test from 112_1, regenerate-on-violation from 112_2) but it isn't enough.

## Map the gen flow (read)

- Locate the weekly-report generation code and its cron entry. Trace the LLM calls: one big Gemini call for the whole report, or multiple (per-section + finalize, per the 139 split)?
- For each LLM call, find the timeout/abort: where does the ~20s come from (an `AbortSignal.timeout` on the Gemini call, boundedFetch, or elsewhere)? Per-call or wrapping the whole pipeline?
- Find the existing retry (HO 160): what does it retry on (503? timeout? both?), how many attempts, what backoff, and does the 20s abort kill the pipeline before retries can complete?
- Find the chunking/split state (HO 139): is generation already broken into small calls, or does one call carry the whole report?

## Pin the constraints

- The cron function's actual maxDuration ceiling on this tier, and the headroom above the 20s abort. This decides whether raising the LLM timeout is even an option or whether chunking is the only path. Check the function/route config and any maxDuration setting, and confirm what Hobby allows for a cron function specifically.
- Whether the 20s abort is artificially tight for report-sized generation. An LLM legitimately taking 20-60s for a big report isn't a "bad plan" the way a slow DB query is, so raising the LLM call's timeout within the function ceiling may be valid here, the opposite of the DB-abort rule. Confirm the numbers so the call is grounded.

## Output

Report: the gen flow (one call vs chunked), where the 20s abort sits, the existing retry/backoff behavior, the function maxDuration ceiling and headroom, and your read on the dominant failure (timeout too tight vs no-503-retry vs one-call-too-big vs all three). Don't change anything; the fix lands in 285 once we know which.

## Ship

Read-only probe. If you add temporary instrumentation, commit it alone so it's revertible. No deploy change to verify.
