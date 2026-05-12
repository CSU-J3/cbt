# 48 — Retry Gemini 503s the same as 429s

## What's wrong

After handoff 46's backfill, 50 rows remained `summary IS NULL`. Every single one failed with:

```json
{"error":{"code":503,"message":"This model is currently experiencing high demand. Spikes in demand are usually temporary.","status":"UNAVAILABLE"}}
```

The runner's `is429` check (added in the 46-runtime fix) only matches 429s, so 503s fall through to the failure log and the row stays NULL. The cron will eventually re-summarize these on its next tick because the rows still match `summary IS NULL`, but during a one-shot backfill they get stranded.

503 from Gemini is explicitly marked as "usually temporary" by Gemini itself. Same backoff pattern that worked for 429 works here.

## Decision

Rename `is429` to `isRetryable`. Match either condition:

```ts
function isRetryable(err: unknown): boolean {
  const code = extractStatusCode(err); // however it's currently pulled
  return code === 429 || code === 503;
}
```

Same 2s/4s/8s/16s backoff. Same 4-retry cap. No new config, no new env vars.

## Files to touch

- `lib/summarize-runner.ts` — the one file that got the 429 throttle fix during handoff 46.

That's it.

## Acceptance

`npm run typecheck` clean.

Trigger a small re-run to drain the 50:

```bash
npm run summarize
```

Watch the log. The retry messages should now fire on 503 codes, not just 429. After the run:

```sql
SELECT COUNT(*) FROM bills WHERE summary IS NULL;
```

Should be 0 or in single digits (any remaining NULLs are bills that survived 4 retries, which would be unusual and worth a manual look).

## Don't

- Don't expand the retry list to *all* 5xx codes. A 500 from Gemini usually means something different (request shape problem) and retrying it just wastes calls. 429 and 503 are the two documented transient failures; stay narrow.
- Don't bump the retry cap above 4. If 4 backoffs each doubling don't work (62s total wait), the problem isn't transient.
- Don't touch the throttle interval. 400ms held cleanly through 15k rows; don't pre-optimize.

## Cost note

~$0.04 to re-summarize the remaining 50 rows. Trivial.
