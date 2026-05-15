# 49 — Cache the rest of the dashboard

## What this is

Handoff 48 took `/` and `/bill/[id]` from 16s and 8s to ~0.4s warm using two patterns: `unstable_cache` + `revalidateTag` at the query layer, and killing redundant count queries. Those same patterns apply cleanly to `/sponsors`, `/stale`, `/president`, `/changes`, and `/watchlist`. None of those pages are user-critical in isolation, but the dashboard should feel uniformly fast — not fast on the home page and slow everywhere else.

## Pages in scope

1. `/sponsors` — aggregated sponsor counts with the most expensive query path on the site (GROUP BY sponsor, joins, sorts). Almost certainly the worst offender after `/` was.
2. `/stale` — bills with no action in 60+ days, color-coded by age.
3. `/president` — bills at the president's desk. Probably already fast (≤5 rows), measure to confirm.
4. `/changes` — recently changed bills feed.
5. `/watchlist` — single-user list, but uses a different invalidation trigger (watchlist toggle, not the daily sync).

## Step 1 — Measure before changing anything

Same playbook as 48. Re-add a thin `timed()` wrapper (or just inline `performance.now()` since we don't need a shared lib for five pages), instrument each page's `await`ed query calls, push to a preview branch, hit cold and warm via `vercel curl`, paste back the `[perf]` lines.

We need to know:

- Which pages are already fast enough to skip (likely `/president`).
- Whether any page has a redundant count pattern like the `getFeedBills` + `getFeedCount` duplication from F. The `/sponsors` page in particular probably has `getSponsors()` + `getSponsorCount()` that recompute the same aggregation.
- Whether `HeaderBar.getFeedStats` is hitting cache on these pages (it should — same global query, same cache key).

Don't ship cache wrappers until measurements are in. We did clean attribution on 48 and it paid off; do the same here.

## Step 2 — Identify and kill redundancy first

For each page, look for the same shape we found in `/`:

- A `getFooBills()` that already returns total in its result shape.
- A separate `getFooCount()` that recomputes the same count.
- A `HeaderBar` prop wired to call `getFooCount()` when it could read total from the page's existing data.

Hoist counts upward, kill duplicate query paths, same as F. This is the cheap win that doesn't even need caching.

## Step 3 — Apply `unstable_cache` to remaining list queries

Match the pattern already in `getFeedBills`:

```ts
const cached = unstable_cache(rawQuery, ['cache-key-name'], { tags: ['bills'], revalidate: 3600 });
```

Wrap:

- `getSponsors()` (or whatever the `/sponsors` page calls)
- The query behind `/stale`
- The query behind `/president`
- The query behind `/changes`
- The query behind `/watchlist`

For the bill-based pages (`/sponsors`, `/stale`, `/president`, `/changes`), tag with `'bills'` — same tag the sync route already invalidates. No new wiring needed there.

For `/watchlist`, tag with `'watchlist'`. Then in `app/api/watchlist/route.ts`, after the DB mutation, call `revalidateTag('watchlist')`. The existing `revalidatePath('/watchlist')` from handoff 48's inert leftovers is dead anyway (route-level revalidate is broken on Next 15 dynamic pages); replace with the tag-based call.

Cache keys: include any filter or search-param the page actually uses. `/sponsors` likely takes `party`, `state`, `q`, `expanded` — only the first three affect the data; `expanded` is UI state and shouldn't fragment the cache. Filter what goes into the key carefully.

## Step 4 — Verify invalidation end-to-end

After everything is wired:

- Manually call the daily sync route on the preview. Confirm the first hit on each cached page after sync is slow (cache populating), second hit is fast.
- Toggle a bill on/off the watchlist. Confirm `/watchlist` reflects the change on next render.
- Confirm `/sponsors` doesn't show stale aggregations after sync.

## Acceptance

- All five pages warm-hit under 500ms (matching `/`'s post-48 target).
- `/sponsors` cold load is under 4s. If it's a heavier aggregation that won't fit, document why.
- Cache invalidation visible in logs: post-sync hits show a single cold query, subsequent hits show cache hit (sub-100ms for cached queries).
- Watchlist toggle invalidates correctly.
- No regression in any page's filter, search, expand, or sort behavior.
- No new `export const revalidate = N` lines anywhere. We just deleted those; don't reintroduce.

## Don't

- Don't make caches user-specific. Single-user dashboard, single cache entry per filter combo is correct.
- Don't change the 1-hour TTL. Matches daily sync cadence and stays consistent with the existing `getFeedStats` and `getFeedBills` caches.
- Don't cache `/bill/[id]` further — it's already at 0.35s warm. Diminishing returns.
- Don't touch the `HeaderBar.getFeedStats` cache. It's working; leave it.
- Don't move the Turso primary to `iad` as part of this. Same reasoning as 48: not worth the operational cost for cold-hit savings on a one-user site.

## Paste back

Cold/warm timings per page before and after. Same format as 48's findings table so we can compare cleanly.
