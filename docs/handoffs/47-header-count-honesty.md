# 47 — Make the header count match the feed

## What's wrong

The header reads "X bills." The number comes from one query; the feed it sits above comes from a different query. When those queries disagree (e.g., feed filters `summary IS NOT NULL`, header counts `*`), the header lies about the underlying data. Handoff 45 exposed this: header said 1,347 while the DB had 15,656.

After 46 backfills the summaries this gap closes naturally, but the daily cron still creates a small window each morning where new bills land without summaries. Without a fix here, the lie reappears every day, just smaller.

The fix is structural, not cosmetic: drive both queries from one source of truth.

## Decision

The header should always reflect *the same set of bills the feed is showing*. Whatever the feed's `WHERE` clause is, the count uses the same clause. No exceptions, no separate count predicate.

Topic and stage filters already do this correctly — `/?topics=healthcare` shows N healthcare bills and the header reads "N bills." Extend that pattern to the always-applied filters (the `summary IS NOT NULL` one, and any others lurking in `lib/queries.ts`).

## Files to touch

- `lib/queries.ts` — find `getBills()` and `getBillCount()` (or whatever they're named). They should share their entire `WHERE` clause via a single helper, e.g. `buildBillsWhere(filters)` that returns a SQL fragment + parameter array. Both functions call it.
- `components/HeaderBar.tsx` — no behavior change, but verify the count it renders comes from `getBillCount()` with the *same* filter object the feed page passes to `getBills()`. If the page is passing different filter objects to each, that's the bug.
- `app/page.tsx` and `app/watchlist/page.tsx` — confirm a single `filters` object is built once and passed to both `getBillCount` and `getBills`. No drift, no separate construction.

## Tiny secondary fix

The header currently formats as `1,347 bills`. After 46 it'll read `15,656 bills`. Fine. But if a future sync ever leaves a meaningful chunk unsummarized for a stretch (Gemini outage, rate-limit lockout, prompt change requiring resummarize), the number won't reflect those rows because the feed still filters them out.

Add a `summary IS NOT NULL` *into the shared `buildBillsWhere`* explicitly, with a one-line comment explaining the choice — so it's intentional and visible in code review, not an accident some future contributor could remove without noticing the UX implication.

Or, alternatively: drop the `summary IS NOT NULL` filter entirely and render rows missing summaries with a `Summary pending…` placeholder. That shows the user "we know about this bill, we just haven't summarized it yet." Either approach is fine; pick one and make it intentional.

My pick: keep the filter, document it. Rows without summaries look broken and pending-text is just noise for the user. The visible count matches what's actually displayed; that's the only thing the header needs to do honestly.

## Acceptance

```sql
SELECT COUNT(*) FROM bills WHERE summary IS NOT NULL;
```

Run that against prod Turso. The number it returns should match the header on `/` exactly. Refresh the page; verify.

Apply a topic filter (`/?topics=healthcare`):

```sql
SELECT COUNT(*) FROM bills WHERE summary IS NOT NULL AND topics LIKE '%healthcare%';
```

Number should match the header on that filtered page.

Apply a stage filter, then both at once. Each combination's SQL count should match the rendered header.

`npm run typecheck` clean.

## Don't

- Don't introduce a new `WHERE` clause that lives only on the count side or only on the feed side. Single source. If you can't put both queries through the same helper, the refactor isn't done.
- Don't change the feed query's actual semantics (don't suddenly start showing or hiding bills). This is a header/count fix; the feed contents stay identical. Anyone visiting today vs. tomorrow shouldn't see different bills, only a different total number.
- Don't add a `total` column to any table. Computed on the fly.
- Don't deploy this same day as 46 if 46 is still running. Let the backfill finish first so the post-deploy verification has a stable number to compare against.

## Cost note

Zero. SQL refactor only.
