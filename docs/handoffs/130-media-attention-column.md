# 130 — Media-attention column on bill rows

## What this is

The original roadmap spec for theme 4 had two surfaces: a breaking-news view (shipped via HO 69 + 114 + 118) and a per-bill media-attention column on the feed row. Only the first one exists today.

The column answers a question the dashboard can't currently answer: *which of the bills I'm looking at right now are getting press?* Breaking news shows the loudest stories of the moment; this column shows ambient signal across every row in the feed. Together they map the two halves of the same question from different angles.

Originally scoped for HO 67, that number got reused for sponsor-productivity-scatter. HO 69 explicitly punted again: *"Don't add a 'news mentions count' to bill rows on the feed. That's the media attention column, separate handoff."* HO 130 is the separate handoff.

Multi-layer change: new query path (or denormalized column), BillRow grid update, click-through behavior, perf considerations across feed/stale/changes/president/watchlist. Phase 1 diagnostic precedes implementation per the discipline.

## Prior art

- **HO 64** — `news_mentions` table schema, RSS ingestion
- **HO 69** — `/news` route, `NewsRow` component, breaking-news banner (single-page banner)
- **HO 86 / 102 / 103 / 104** — LLM matcher + confidence column
- **HO 111** — confidence-aware aggregation in reports
- **HO 114** — breaking-news block on home page
- **HO 118** — breaking-news polish (dedup, age formatting)
- **HO 117** — news ingest its own cron
- **HO 125** — BillRow redesign (compact variant lives in `ActivityTicker`)
- **HO 127** — quick-watch star, latest BillRow surface addition

## In scope

- Phase 1 — audit `news_mentions` distribution, BillRow grid, perf of join-at-read vs denormalize, propose encoding + placement + window + click-through
- Phase 2 — query path + BillRow integration + CSS grid update across all consumer pages
- Phase 3 — SKILL.md updates, verification across `/feed`, `/stale`, `/changes`, `/president`, `/watchlist`, and the home page's ActivityTicker compact variant

## Out of scope

- Source-level filtering on bill rows (theme-4-v2)
- Per-source weighting (NYT > Politico) in the displayed count — count is count in v1, weighting is a separate question
- Bill detail page mention list (`/bill/[id]` already has news data exposure; this handoff is feed-row only)
- LLM-summarized "press buzz" prose on bills
- Backfilling old news mentions outside the current RSS window
- Confidence display on the column number — count covers high-confidence only (per Phase 1 threshold), but the displayed number is just count, not a confidence score
- Mobile-first redesign of BillRow — current responsive behavior extends; column hides at `<700px` if needed

## Phase 1 — Diagnostic (no commits)

Read actual artifacts. Run real distribution queries. Post findings + proposals. No code beyond ad-hoc queries.

### Required reads

1. **`news_mentions` schema** — confirm columns, indexes (HO 129 confirmed: `bill_id`, `source`, `article_url`, `article_title`, `article_summary`, `published_at`, `matched_via`, `match_confidence`; indexes on `bill_id`, `published_at DESC`, `source`)
2. **`components/BillRow.tsx`** — current grid `24px 86px 1fr 150px 96px 150px` per SKILL.md, all column classes, the HO 125 compact variant differences, the HO 127 watch-star slot
3. **`lib/queries.ts`** — `getFeedBills` and its siblings (`getStaleBills`, `getChangesBills`, `getPresidentBills`, `getWatchedBills`), all current `INNER JOIN`/`LEFT JOIN` shape, current cache tags
4. **`globals.css`** — `.feed-row`, `.changes-feed`, `.activity-ticker` (or whatever the compact wrapper is), mobile breakpoint behavior
5. **Migrate script** — confirm whether any `mention_count_*` denormalized column already exists on `bills` (probably not, but verify)

### Queries to run

```sql
-- Mention volume per bill, last 7 days, high-confidence only
WITH recent AS (
  SELECT bill_id, COUNT(*) AS n
  FROM news_mentions
  WHERE published_at >= datetime('now', '-7 days')
    AND match_confidence >= 0.7   -- adjust to whatever HO 111's confidence floor uses
  GROUP BY bill_id
)
SELECT
  CASE
    WHEN n = 0 THEN 'zero'
    WHEN n = 1 THEN '1'
    WHEN n <= 3 THEN '2-3'
    WHEN n <= 7 THEN '4-7'
    WHEN n <= 15 THEN '8-15'
    ELSE '16+'
  END AS bucket,
  COUNT(*) AS bills_in_bucket
FROM recent
GROUP BY bucket
ORDER BY bucket;

-- Same for 30-day window
-- (adjust the WHERE published_at clause to '-30 days')

-- How many bills have any mention in the last 7d? 30d? all-time?
SELECT
  COUNT(DISTINCT CASE WHEN published_at >= datetime('now', '-7 days') THEN bill_id END) AS last_7d,
  COUNT(DISTINCT CASE WHEN published_at >= datetime('now', '-30 days') THEN bill_id END) AS last_30d,
  COUNT(DISTINCT bill_id) AS all_time
FROM news_mentions
WHERE match_confidence >= 0.7;

-- Top 10 most-mentioned bills, last 7 days
SELECT m.bill_id, b.title, COUNT(*) AS n
FROM news_mentions m
INNER JOIN bills b ON b.id = m.bill_id
WHERE m.published_at >= datetime('now', '-7 days')
  AND m.match_confidence >= 0.7
GROUP BY m.bill_id
ORDER BY n DESC
LIMIT 10;

-- Perf check: EXPLAIN a feed query with a LEFT JOIN aggregating mention_count.
-- See "Perf check" below for the actual SQL to EXPLAIN.
```

### Perf check

Compare two query shapes against the actual data:

**Shape A — JOIN at read time:**
```sql
SELECT b.*,
  COALESCE(m.n, 0) AS mention_count_7d
FROM bills b
LEFT JOIN (
  SELECT bill_id, COUNT(*) AS n
  FROM news_mentions
  WHERE published_at >= datetime('now', '-7 days')
    AND match_confidence >= 0.7
  GROUP BY bill_id
) m ON m.bill_id = b.id
WHERE b.summary IS NOT NULL
ORDER BY b.latest_action_date DESC NULLS LAST, b.id DESC
LIMIT 50;
```

`EXPLAIN QUERY PLAN` the above. Note the additional cost vs the current `getFeedBills` without the join.

**Shape B — denormalized column:**
- Add `mention_count_7d INTEGER NOT NULL DEFAULT 0` to `bills`
- News ingest cron (`/api/cron/news`) recomputes this column for affected bills after each tick
- A nightly cron job (or weekly) decays counts for bills that haven't been re-mentioned, since 7-day window slides

Post: which shape is recommendable for v1 based on the actual perf delta and Turso's behavior.

### Proposals to post

Each gets a recommendation. Sign-off picks one per item.

1. **Time window.** 7d / 30d / both?
   - 7d matches breaking news feel; faster decay reflects "right now"
   - 30d gives a deeper trailing window for slow-burn coverage that 7d misses
   - Both = two columns, more crowding
   - Recommend **7d** for v1. 30d as a v2 if 7d feels too volatile.

2. **Confidence floor.** Match HO 111's `>=0.7` threshold by default. Keep it tunable via a constant in `lib/queries.ts`. NULL confidence (pre-HO-104 backfill artifacts) excluded. Recommend.

3. **Query shape.** Per perf check.
   - (a) JOIN at read time — no schema change, no cron change, slight query cost. Acceptable if EXPLAIN shows reasonable cost for 50-row pages.
   - (b) Denormalized `mention_count_7d` column — fast reads, sync-side complexity, requires daily decay cron for the sliding window
   - Recommend (a) unless EXPLAIN says it's expensive at typical scale. Premature denormalization is a tech-debt commitment; the join cost is bounded.

4. **Visual encoding.** Three candidates, sign-off picks one:
   - (a) **Compact count badge** — `📡 7` or just `7` in `--accent-amber` when > 0, blank when 0
   - (b) **Intensity dot** — colored dot whose intensity tracks count (`--text-dim` → `--accent-amber-bright`, bucketed at 1/3/7/15)
   - (c) **Mini bar** — a 1-row sparkbar showing the last 7 days of mention counts
   - Recommend (a). Cheapest to render, easiest to scan, leaves the count itself as the signal. The other two are clever but harder to scan in a dense feed.

5. **Column placement.** Where in the BillRow grid does the column land?
   - (a) Rightmost, after topics: `24px 86px 1fr 150px 96px 150px <new>`
   - (b) Between action-date and topics: `... 96px <new> 150px`
   - (c) Replace the topics column on `/news`-context pages (not applicable here)
   - Recommend (a). Furthest right reads as a side annotation, doesn't compete with the existing stage/date/topic signals.

6. **Click-through.** What happens when the badge is clicked?
   - (a) Link to `/news?bill=<id>` (requires `/news` to accept `?bill=` filter — small follow-on if it doesn't already)
   - (b) Link to `/bill/<id>#news` (anchor into the bill detail page's news section, if one exists)
   - (c) No click target; the badge is read-only signal
   - Recommend (a). `/news` is the natural destination, and the param keeps the click in-app.

7. **Empty state.** Bills with zero mentions in the window — render the column blank (whitespace) vs `—` vs `0`?
   - Recommend blank. Reading the column visually scans for non-blank cells; `0` adds noise on what's likely 90%+ of rows.

8. **Surfaces.** Which BillRow consumers get the column?
   - All of: `/feed`, `/stale`, `/changes`, `/president`, `/watchlist`, home ActivityTicker compact variant
   - Compact variant may drop the column entirely for space reasons — Phase 1 confirms based on the actual width
   - Recommend everywhere, with compact-variant exception if cramped

### HALT

End Phase 1 with: distribution buckets for 7d and 30d windows, EXPLAIN output for both query shapes, BillRow grid audit, proposals 1–8 with picks. Wait for sign-off on every numbered item before Phase 2.

## Phase 2 — Implementation (after sign-off)

Shape depends on Phase 1 picks. Sketch:

### Query layer

`lib/queries.ts`:

- Extend the BillRow data shape with `mentionCount7d: number` (or whatever window wins)
- Update `getFeedBills`, `getStaleBills`, `getChangesBills`, `getPresidentBills`, `getWatchedBills` per the chosen query shape
- If JOIN-at-read: add the subquery to each consumer
- If denormalize: add migration, wire the news cron to recompute, add nightly decay cron
- `unstable_cache` tags pick up `news-mention-counts` (or keep existing `bills` tag if the JOIN approach inherits invalidation cleanly)

### BillRow integration

`components/BillRow.tsx`:

- New `<MediaAttentionCell mentionCount={...} billId={...} />` component
- Per pick 4 visual encoding
- Per pick 5 grid placement (update `.feed-row` and `.feed-header-row` in `globals.css`)
- Per pick 6 click behavior — `<Link>` with `?bill=<id>` param
- Skip rendering on the compact variant if pick 8 excludes it

### CSS

`globals.css`:

- Update `.feed-row` and `.feed-header-row` grid template
- Add `.col-media-attention` class with the cell styling
- Header row: column label (e.g. `📡` or `PRESS` text)
- Mobile breakpoint: hide the column under 700px (consistent with `.col-date` mobile hide)

### `/news?bill=<id>` filter

If pick 6 is (a) and `/news` doesn't already accept `?bill=`, add it:

- Update `app/news/page.tsx` to read `searchParams.bill`, validate against `sanitizeBillId` (HO 12 helper), filter the query
- Empty-state when invalid: render the full /news view; sanitize silently

### Verification

1. `/feed` renders the new column with counts for bills that have recent mentions
2. Top-mentioned bill from the Phase 1 query (e.g. HR-2702 with 14 mentions) shows the right count
3. Bills with zero recent mentions show blank cells
4. Click on a non-zero count → routes to `/news?bill=<bill-id>`, news page filters correctly
5. `/stale`, `/changes`, `/president`, `/watchlist` all show the column
6. Home page ActivityTicker compact variant per pick 8 (with or without the column)
7. Mobile (`<700px`): column hidden
8. Cache invalidates after a news cron tick — new mention shows up in the next page render
9. Type-check clean, working tree ready to commit, no console errors

## Acceptance

1. Phase 1 diagnostic posted in chat with all eight proposals, distribution buckets, EXPLAIN output
2. Sign-off received on every numbered proposal
3. Phase 2 implementation per the signed-off spec
4. Media-attention column visible on every BillRow surface chosen in pick 8
5. Click-through to `/news?bill=<id>` works
6. SKILL.md updates: `### Layout grid` reflects new BillRow grid; `/news` line in `### Pages` updated with the `?bill=` param if added; new `### Pages` line for the column behavior if it earns one
7. Type-check clean, working tree clean, pushed
8. Commit messages:
   - Phase 1: no commit (diagnostic only)
   - Phase 2: `feat(news): media-attention column on bill rows (HO 130)`

## Don't

- Don't add per-source weighting in the displayed number. v1 is raw count. Weighting is a separate question — when "press buzz score" earns a handoff, it lives separately.
- Don't denormalize without an EXPLAIN that justifies it. JOIN-at-read is the default; denormalize only if data says it must.
- Don't show `0` for zero-mention bills. Blank cell.
- Don't extend the window beyond what pick 1 picks. Wider windows are a v2 question.
- Don't backfill old mentions outside the existing RSS retention window. Whatever's in `news_mentions` today is what counts.
- Don't change the breaking-news banner or `/news` route layout. The column is a sibling surface, not a replacement.
- Don't add this to `/sponsors` or `/members`. Different axis.
- Don't show NULL-confidence rows in the count. HO 111's hard-exclude rule still applies.

## Notes

- The roadmap framed this column as "surfaces which bills are quietly getting traction." Breaking news shows the loudest; this column shows the ambient. Together they cover the same question — what's getting press — at two different scales.
- If denormalization wins Phase 1, the cron arc for news (HO 117's `/api/cron/news` split) gains one more job. Plan the decay-cron carefully; sliding windows aren't free.
- `/news?bill=<id>` if added is small but it's a real surface change. Consider whether `/bill/<id>` has a news section already; if so, pick 6's (b) (anchor jump) might be preferable to building the filter on `/news`. Phase 1 confirms.

read docs/handoffs/130-media-attention-column.md and follow
