# 48 — Cut page load from 16s to under 2s

## What's wrong

Live site loads in **16 seconds** on `/`. Bill detail at `/bill/[id]` takes **8 seconds**. Both numbers should be under 2s warm. The dashboard is server-rendered Tailwind with a single libSQL query path, so something is doing 10–15s of work it shouldn't be.

Don't guess at the fix. Measure first, then cut.

## Top suspects, ranked

1. **`queries.ts` is selecting `raw_json` on the feed query.** The column holds full Congress.gov payloads (~30–80KB each). At ~1,600 rows that's 50–100MB shipping from Turso to the Vercel function on every render, even though the feed only displays id / title / sponsor / dates / latest action / stage / topics / summary. This is almost certainly most of the 16s.
2. **No `revalidate` on server components.** Next.js 15 doesn't cache direct libSQL calls. Every page hit = fresh DB roundtrip + render. Sync runs once daily; a 5-minute cache is safe and would make warm loads near-instant.
3. **Turso region drift.** If the DB primary is in a region far from Vercel's default `iad1` (US East), each query is 200–500ms RTT. Multiple queries per page stack up fast.

## Step 0 — Measure the actual breakdown

Before changing code, instrument `app/page.tsx` and `app/bill/[id]/page.tsx` with timing logs so we can attribute the seconds to the right stage. Wrap each major awaited call:

```ts
const t0 = performance.now();
const bills = await getBills(filters);
console.log(`[perf] getBills: ${Math.round(performance.now() - t0)}ms`);
```

Do the same for `getBillCount`, `getAvailableTopics`, `getStageCounts`, etc. — every awaited call in the server component.

Deploy to a preview branch. Hit the page cold (wait 5+ min between requests for cold start), check the Vercel function logs, paste back the timings before doing anything else. We need to know whether 14 of the 16 seconds are in a single query, in render, or distributed.

Also run `turso db show cbt` and report the primary region.

## Step 1 — Drop `raw_json` from feed queries

In `lib/queries.ts`, the feed query path almost certainly does `SELECT * FROM bills`. Replace it with an explicit column list that excludes `raw_json`:

```sql
SELECT
  id, congress, bill_type, bill_number, title,
  introduced_date, latest_action_date, latest_action_text,
  sponsor_name, sponsor_party, sponsor_state,
  update_date, summary, summary_model, summary_updated_at,
  topics, stage
FROM bills
WHERE ...
```

Apply this to every query that returns a *list* of bills:

- `getBills()` (feed)
- The stale page query
- The president page query
- The sponsors page query
- The watchlist query
- The recent-bills query used in the `/sponsors` expanded panel

Leave `raw_json` in the single-bill query used by `/bill/[id]` — that page actually needs it for the expandable raw payload section.

Add a TypeScript type `BillListRow` (without `raw_json`) distinct from the existing `Bill` type. The narrower type prevents accidental re-introduction.

## Step 2 — Add `revalidate` to every server page

Add `export const revalidate = 300` (5 minutes) to:

- `app/page.tsx`
- `app/stale/page.tsx`
- `app/president/page.tsx`
- `app/sponsors/page.tsx`
- `app/watchlist/page.tsx`
- `app/bill/[id]/page.tsx`

Cron runs once daily at 09:00 UTC, so a 5-minute cache window cannot serve stale data in any meaningful sense. The only exception is the watchlist page — clicking the watchlist toggle needs to invalidate. Add `revalidatePath('/watchlist')` to the watchlist mutation API route after the DB write.

If filters via search params cause caching to fragment too aggressively (each filter combo gets its own cache entry), that's fine — Vercel handles it. Don't add `dynamic = 'force-dynamic'` anywhere; that defeats the cache.

## Step 3 — Confirm Turso region

After Step 0 reports the region:

- If primary is in `iad` (US East, Virginia) — good, leave it alone.
- If primary is elsewhere (Sydney, Frankfurt, etc.) — move it. The `turso db replicate` command adds an `iad` replica; combined with the libSQL embedded-replica pattern this puts read latency under 10ms. But before touching this, get the Step 0 numbers — if the queries are already fast and raw_json was the whole problem, region work is wasted effort.

## Step 4 — Add `loading.tsx` for cold starts

Even with the above, the first hit after a cold function still pays the Lambda spin-up tax. Add `app/loading.tsx` and `app/bill/[id]/loading.tsx` with a minimal skeleton matching the page chrome (header bar + a few placeholder rows). This makes cold loads *feel* fast even when they aren't.

Keep the skeleton in the same color palette as the real page — `--bg-base`, `--border-soft` for placeholder bars. No spinners, no "Loading…" text. The terminal aesthetic should hold.

## Acceptance

- `/` loads under 2s cold, under 500ms warm (measured via Vercel function logs).
- `/bill/[id]` loads under 1.5s warm.
- The HTML payload for `/` is under 500KB (view-source byte count or DevTools Network tab).
- No regression in feed filtering, search, or expand behavior.
- Watchlist toggle still updates the watchlist page within one render.

## Don't

- Don't add Redis, Upstash, or any external cache layer. Page-level `revalidate` is enough.
- Don't introduce SWR, react-query, or client-side fetching. Server components only.
- Don't change the schema or split `raw_json` into a separate table. The fix is in the SELECT, not the storage.
- Don't pre-render with `generateStaticParams` on `/bill/[id]` — 1,600+ static pages is wasteful and the cache hit rate would be low.
- Don't touch the sync or summarize code paths. Pure read-path work.

## Paste back

The Step 0 timing breakdown + Turso region before any of the fixes ship. We pick the next move from there.
