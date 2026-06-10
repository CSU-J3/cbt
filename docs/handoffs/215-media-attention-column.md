> **RESOLVED BY HO 130 (commit 50df2ad)** — collapsed-row media-attention count badge shipped on all feed surfaces before this was re-scoped. Closed without changes.

# HO 215 — Media-attention count badge on bill rows (`/bills` only, v1)

## Why

Closes the second surface of the news-signal theme. Breaking news (HO 114) shows the *loudest* stories of the moment; this shows the *ambient* signal — a per-bill mention count on every collapsed row, answering "which of the bills I'm looking at right now are getting press?" at a glance. The roadmap sequenced this explicitly after breaking news.

This is the **collapsed-row** count badge — a number on the row itself. It is NOT the expanded-panel news list (that already shipped — see resolved premise below).

## Resolved premise — DO NOT re-derive or duplicate (HO 188 + HO 191)

The expanded bill panel **already surfaces matched news articles**. HO 188 wired related-news into the expanded row; HO 191 placed it in the panel's left column (RELATED NEWS sub-section, up to 5 matched articles, `[SOURCE]` + headline link, hidden when none). That per-bill article query exists and works.

What this handoff adds is the **collapsed-row count** — the scannable signal across the whole feed before anyone expands a row. The expanded panel shows *which articles*; this shows *how many*, inline, without a click. They're complementary, not redundant. **Do not touch the expanded panel's RELATED NEWS section.** Reuse its underlying per-bill query if it's the cheapest path to a count; don't rebuild it.

## Scope (v1)

**`/bills` collapsed rows only.** The original scope imagined all six BillRow surfaces (`/stale`, `/changes`, `/president`, `/watchlist`, home ticker). That's a v2 sweep — prove the encoding scans in the dense `/bills` feed first, then spread. Build the column so spreading later is a grid-width change on the other pages, not a rework, but **only wire `/bills` now.**

## Phase 1 — Diagnostic (no commits, HALT after)

Read actual artifacts. Run real distribution queries against current data (volume has shifted since this was first scoped). Post findings + proposals. No code beyond ad-hoc queries.

### Required reads

1. **`news_mentions` schema** — confirm columns + indexes (expected: `bill_id`, `source`, `article_url`, `article_title`, `article_summary`, `published_at`, `matched_via`, `match_confidence`; indexes on `bill_id`, `published_at DESC`, `source`).
2. **The expanded-panel per-bill news query** (HO 188/191) — find it, capture its shape. This is likely the count's cheapest source.
3. **`components/BillRow.tsx`** — current grid `24px 86px 1fr 150px 96px 150px` per SKILL §Layout grid, all column classes, the HO 125 compact variant, the HO 127 watch-star slot. Confirm the grid still matches SKILL — flag any drift.
4. **`lib/queries.ts`** — `getFeedBills` (the `/bills` consumer). Current JOIN shape, cache tags.
5. **`globals.css`** — `.feed-row`, `.feed-header-row`, the 700px mobile breakpoint behavior (`.col-date` hide pattern).
6. Confirm no `mention_count_*` denormalized column already exists on `bills`.

### Queries to run

```sql
-- Mention volume per bill, last 7 days, high-confidence only (confidence floor = HO 111's >=0.7)
WITH recent AS (
  SELECT bill_id, COUNT(*) AS n
  FROM news_mentions
  WHERE published_at >= datetime('now', '-7 days')
    AND match_confidence >= 0.7
  GROUP BY bill_id
)
SELECT
  CASE WHEN n=1 THEN '1' WHEN n<=3 THEN '2-3' WHEN n<=7 THEN '4-7'
       WHEN n<=15 THEN '8-15' ELSE '16+' END AS bucket,
  COUNT(*) AS bills_in_bucket
FROM recent GROUP BY bucket ORDER BY bucket;

-- Same with '-30 days' window

-- Coverage: bills with any mention, by window
SELECT
  COUNT(DISTINCT CASE WHEN published_at >= datetime('now','-7 days')  THEN bill_id END) AS last_7d,
  COUNT(DISTINCT CASE WHEN published_at >= datetime('now','-30 days') THEN bill_id END) AS last_30d,
  COUNT(DISTINCT bill_id) AS all_time
FROM news_mentions WHERE match_confidence >= 0.7;

-- Top 10 most-mentioned, last 7d
SELECT m.bill_id, b.title, COUNT(*) AS n
FROM news_mentions m INNER JOIN bills b ON b.id = m.bill_id
WHERE m.published_at >= datetime('now','-7 days') AND m.match_confidence >= 0.7
GROUP BY m.bill_id ORDER BY n DESC LIMIT 10;
```

### Perf check — `EXPLAIN QUERY PLAN` both shapes

**Shape A — JOIN at read time** (default; no schema/cron change):
```sql
SELECT b.*, COALESCE(m.n, 0) AS mention_count_7d
FROM bills b
LEFT JOIN (
  SELECT bill_id, COUNT(*) AS n FROM news_mentions
  WHERE published_at >= datetime('now','-7 days') AND match_confidence >= 0.7
  GROUP BY bill_id
) m ON m.bill_id = b.id
WHERE b.summary IS NOT NULL
ORDER BY b.latest_action_date DESC NULLS LAST, b.id DESC
LIMIT 50;
```
**Shape B — denormalized `mention_count_7d INTEGER NOT NULL DEFAULT 0` on `bills`** — recomputed by `/api/cron/news` per tick + a decay cron for the sliding window.

Report which is recommendable for v1 based on the actual EXPLAIN delta vs current `getFeedBills`. Default recommendation: **A**, unless EXPLAIN shows it's expensive at 50-row scale. Premature denormalization buys a decay-cron tech-debt commitment; the join cost is bounded.

### Proposals to post (sign-off picks each)

1. **Window.** 7d / 30d / both. Recommend **7d** (matches breaking-news feel; 30d is v2 if 7d feels volatile).
2. **Confidence floor.** Match HO 111's `>=0.7`, tunable constant in `lib/queries.ts`, NULL excluded. Recommend.
3. **Query shape.** Per perf check. Recommend A unless EXPLAIN says otherwise.
4. **Visual encoding** (sign-off picks one):
   - (a) compact count badge — `7` in `--accent-amber` when >0, blank when 0
   - (b) intensity dot — bucketed `--text-dim` → `--accent-amber-bright` at 1/3/7/15
   - (c) mini 7-day sparkbar
   - Recommend **(a)** — cheapest to scan in a dense feed; the count is the signal. **Palette note:** amber = urgency/attention app-wide (per SKILL), so amber is correct here; do not reach for cyan/purple (those are PRIMARIES/RACES-scoped).
5. **Placement.** Recommend **rightmost, after topics** (`24px 86px 1fr 150px 96px 150px <new>`) — reads as a side annotation, doesn't compete with stage/date/topic.
6. **Click-through.** (a) `/news?bill=<id>` (b) anchor into the expanded panel's RELATED NEWS (c) read-only. **Note:** since the expanded panel now carries the article list (HO 188/191), option (b) — clicking the badge expands the row to its news section — may beat building a `/news?bill=` filter. Phase 1 confirms which is cheaper and recommends.
7. **Empty state.** Blank cell (not `0`, not `—`) — the eye scans for non-blank. Recommend.

### HALT

End Phase 1 with: 7d + 30d distribution buckets, coverage counts, top-10, EXPLAIN output for both shapes, BillRow grid audit (+ drift flag if any), the expanded-panel news query shape, and proposals 1–7 with picks. Wait for sign-off on every numbered item.

## Phase 2 — Implementation (after sign-off, `/bills` only)

### Query layer — `lib/queries.ts`
- Extend the `getFeedBills` row shape with `mentionCount7d: number` (or the chosen window).
- Apply the chosen query shape (A: add the subquery; B: migration + cron recompute + decay cron).
- Cache: if A, the existing `bills` tag likely inherits invalidation; if the count needs its own freshness, add a `news-mention-counts` tag and `revalidateTag` it in `/api/cron/news`.

### BillRow — `components/BillRow.tsx`
- New `<MediaAttentionCell mentionCount={...} billId={...} />` per pick 4.
- Grid placement per pick 5 (update `.feed-row` + `.feed-header-row` in `globals.css`).
- Click behavior per pick 6.
- Header label: `PRESS` (or `📡` if it renders clean in the font stack; fall back to text).
- **Do not render on the compact/ticker variant** — out of v1 scope.

### `/news?bill=<id>` filter (only if pick 6 = (a))
- `app/news/page.tsx` reads `searchParams.bill`, validates via `sanitizeBillId` (HO 12 helper), filters. Invalid → render full /news silently.

### CSS — `globals.css`
- Update `.feed-row` / `.feed-header-row` grid template.
- `.col-media-attention` cell class.
- Hide under 700px (`@media max-width:700px`), consistent with `.col-date`.

### Verification
1. `/bills` renders the column; top-mentioned bill from Phase 1 shows the right count.
2. Zero-mention bills → blank cells.
3. Click behavior per pick 6 works.
4. Mobile `<700px`: column hidden.
5. Cache invalidates after a news cron tick.
6. **Stylesheet loads** (HO 212 lesson — a bare HTTP 200 doesn't prove styled render; confirm the CSS asset isn't 404ing, or `rm -rf .next` + restart if the dev server's been up a while).
7. Type-check clean, no console errors.
8. **Did NOT touch** the expanded panel's RELATED NEWS section, breaking-news block, or `/news` layout.

## Out of scope (v2 / separate)
- The other five surfaces (`/stale`, `/changes`, `/president`, `/watchlist`, home ticker) — v2 sweep after the encoding's proven.
- Per-source weighting (NYT > Politico) — count is count in v1.
- 30d second column — v2 if 7d feels volatile.
- Any change to the expanded panel, breaking-news block, news matcher, or ingestion pipeline.
- Backfilling mentions outside the current RSS retention window.
- NULL-confidence rows in the count (HO 111 hard-exclude holds).

## Acceptance
1. Phase 1 diagnostic posted with all 7 proposals, distribution buckets, EXPLAIN output, grid audit.
2. Sign-off on every numbered proposal.
3. Phase 2 per signed-off spec, `/bills` only.
4. Click-through works per pick 6.
5. SKILL.md: §Layout grid reflects the new `/bills` grid (note it's `/bills`-only for now); `/news` line gets the `?bill=` param if added.
6. Type-check clean, working tree clean, pushed.
7. Commit: `feat(news): media-attention count badge on /bills rows (HO 215)`
