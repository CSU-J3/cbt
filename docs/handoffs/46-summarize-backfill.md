# 46 — Summarize the backfilled 14,309 rows

## What's wrong

Handoff 45's sync backfill landed cleanly: prod Turso has 15,656 rows. But the homepage filters by `summary IS NOT NULL`, so it shows only the 1,347 rows that had summaries before the backfill. The other 14,309 rows are in the database, invisible to the dashboard.

The header reads "1,347 bills" when the truth is 15,656. The cron route summarizes 50 rows per tick (286 days to catch up). Local `npm run summarize` is unbounded and will chew through the queue in a few hours.

This was pre-scoped at the end of handoff 45's chat:

> if you want full coverage faster, that's an evening of `npm run summarize` and roughly $10 in Gemini spend, worth tracking as a possible handoff 46 but not blocking on this deploy.

Run it.

## Pre-flight

```sql
SELECT COUNT(*) FROM bills WHERE summary IS NULL;
```

Should return ~14,309. If it's already lower, the daily cron has done a few ticks since handoff 45; the script will catch up the remainder regardless.

Confirm `.env` points at prod Turso (same DB handoff 45 wrote to). The verification screenshot showed 15,656 total against `cbt` on `csu-j3` — that's the right DB. If `.env` somehow points elsewhere, fix that before running.

## Run

```bash
npm run summarize
```

Watch the output. Expect:

- Rate-limited 429s from Gemini under sustained load. The script has retry logic from earlier handoffs; let it handle them.
- Occasional 503s from Gemini (handoff 45 saw 3 in 89 rows). Same deal — retry handles them.
- Some bills will fail validation (out-of-enum topics, malformed JSON). The validator falls back to `["other"]` and logs. That's fine.

ETA: a few hours. Don't sleep it; if Wi-Fi drops mid-run, the next invocation picks up where it left off (the `WHERE summary IS NULL` query is naturally idempotent).

Don't run two invocations in parallel. The script has no locking and you'll waste Gemini calls on rows another process already claimed.

## Acceptance

After the run:

```sql
SELECT 
  COUNT(*) AS total,
  COUNT(summary) AS with_summary,
  COUNT(*) - COUNT(summary) AS null_summary,
  COUNT(CASE WHEN stage = 'enacted' THEN 1 END) AS enacted
FROM bills;
```

Targets:
- `total` ≈ 15,656 (matches current; sync may have added a few)
- `with_summary` ≈ `total` (all but the most recent sync window)
- `null_summary` should be small (under ~50, representing rows added since the run started)
- `enacted` should be 86–90 (Congress.gov's current public-law count, give or take)

Live site after the run should show ~15,656 bills in the header. Refresh hard once (Cmd+Shift+R) to bypass Vercel's edge cache.

Topic distribution check — paste the result of:

```sql
SELECT 
  json_each.value AS topic, 
  COUNT(*) AS n
FROM bills, json_each(bills.topics)
WHERE bills.topics IS NOT NULL
GROUP BY topic 
ORDER BY n DESC;
```

Expect the existing distribution to roughly hold but with bigger numbers. Anything wildly out of pattern (a topic suddenly at 40%, or a previously-unseen value) means the prompt drifted and needs investigation. Most likely it'll look normal — same prompt, same bills, just more of them.

## Don't

- Don't deploy anything from this run. Pure data backfill. The dashboard naturally picks up the new summaries as soon as they're in the DB; no code change required.
- Don't touch the homepage query in this handoff. The "summary IS NOT NULL" filter is defensible (showing bills with no summary text looks broken). After this run completes, almost everything has a summary anyway. If the lying-header problem still feels real after, that's handoff 47.
- Don't modify the prompt mid-run. If you notice categorization drift on early rows, kill the run, fix the prompt, re-run — but don't edit `lib/summarize.ts` while the script is iterating.
- Don't run against a non-prod DB. Verify `.env` once before kicking off.

## Cost note

~$9–10 in Gemini 2.5 Flash spend (14,309 rows × roughly $0.00065 per summary based on the 1,643-row baseline that ran for ~$1). One-time cost.

## After

Once the run completes and the dashboard shows ~15,656, two follow-ups worth knowing about but not blocking:

1. **Header honesty.** Even with backfill done, the daily cron creates a brief window where new bills have no summary. Header could read "X of Y summarized" or just "X bills" with Y matching the underlying query — pick whichever isn't a lie. Small handoff 47.
2. **Substack post numbers.** The headline number isn't 1,461 or 1,933 anymore. It's ~15,656. Re-run whatever query the post depends on the morning of publish, since the cron will keep adding.
