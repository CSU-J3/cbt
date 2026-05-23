# 118 — Breaking news dedup by article

## What this is

The breaking-news block on `/` shows the same headline multiple times when one article matches multiple bills. Live example: "Sen. Wicker tells Trump to 'finish the job' on Iran" appears three times in the last 24h slot, tagged HCONRES 95, SJRES 184, HJRES 176, same source, same timestamp.

HO 114's query helper dedupes by `bill_id`. That handles "three articles about HR 1234 → show once" but not the inverse: one article matched to three bills. The matcher is correct (those resolutions are companion measures and the article does touch all three). The display layer needs to flip the dedup axis.

Fix: dedup by article. One news story = one row. Show the highest-confidence matched bill as the primary, with a compact `[+N]` pill when other bills also matched the same article.

Single-layer (query helper + component). The screenshot is the diagnostic — no Phase 1 needed.

## In scope

- Flip dedup in the breaking-news query helper from `bill_id` to article
- Primary bill per article = highest `match_confidence`, alphabetical bill_id as tie-break
- Return `otherBills: string[]` for the rest, in case the component or a future view wants to show all of them
- Update the home-block component to render `[+N]` pill when `otherBills.length > 0`

## Out of scope

- Matcher or confidence-threshold changes (HO 86 / 104 / 111 territory)
- Schema changes — current columns are enough
- `/news` page — leave as is; the many-to-many is the right model for the full feed
- Click-to-expand or hover-to-list for `[+N]` beyond a static `title` tooltip; if that wants to grow later it's a follow-up

## Phase 1 — Implementation

### Locate the helper

HO 114 added the breaking-news query, likely as `getBreakingNewsForHome` in `lib/queries.ts`. If it landed inline in `app/page.tsx`, extract it to `lib/queries.ts` while you're in there.

### Query change

Current shape: group by `bill_id`, pick most recent article per bill.

New shape: rank rows within each article by `match_confidence DESC, bill_id ASC`, take rank=1 as primary, collect the rest as `otherBills`. Article key is `COALESCE(article_url, article_title || '|' || source || '|' || published_at)` — URL when present, composite fallback when null.

```sql
WITH ranked AS (
  SELECT
    nm.bill_id,
    nm.source,
    nm.published_at,
    nm.article_url,
    nm.article_title,
    nm.match_confidence,
    b.title AS bill_title,
    COALESCE(
      nm.article_url,
      nm.article_title || '|' || nm.source || '|' || nm.published_at
    ) AS article_key,
    ROW_NUMBER() OVER (
      PARTITION BY COALESCE(
        nm.article_url,
        nm.article_title || '|' || nm.source || '|' || nm.published_at
      )
      ORDER BY nm.match_confidence DESC, nm.bill_id ASC
    ) AS rn
  FROM news_mentions nm
  JOIN bills b ON b.id = nm.bill_id
  WHERE nm.published_at >= datetime('now', ?)   -- e.g. '-24 hours'
    AND nm.match_confidence >= ?                -- e.g. 0.7
),
primary_match AS (
  SELECT * FROM ranked WHERE rn = 1
),
others AS (
  SELECT
    article_key,
    json_group_array(bill_id) AS other_bill_ids,
    COUNT(*) AS other_count
  FROM ranked
  WHERE rn > 1
  GROUP BY article_key
)
SELECT
  pm.bill_id,
  pm.bill_title,
  pm.source,
  pm.published_at,
  pm.article_url,
  pm.article_title,
  COALESCE(o.other_count, 0)            AS other_count,
  COALESCE(o.other_bill_ids, '[]')      AS other_bill_ids
FROM primary_match pm
LEFT JOIN others o ON o.article_key = pm.article_key
ORDER BY pm.published_at DESC
LIMIT ?
```

Parse `other_bill_ids` JSON into `string[]` server-side before returning.

### Return shape

```ts
type BreakingNewsItem = {
  billId: string;
  billTitle: string;
  source: string;
  publishedAt: string;
  articleUrl: string | null;
  articleTitle: string;
  otherBills: string[];   // companion bill IDs from same article, primary excluded
};
```

### Component update

Component is whatever HO 114 named it (`BreakingNewsBlock.tsx` per that handoff). In the row template, when `otherBills.length > 0`, render a compact pill adjacent to the bill ID:

```
HCONRES 95 [+2]   Sen. Wicker tells Trump to 'finish the job' on Iran   THE HILL   17h
```

Pill styling:
- Monospace, small, `--text-muted`
- Square brackets, e.g. `[+2]`
- `title={otherBills.join(', ')}` so hover shows the companion bills
- Inline with the bill ID, single space separator, no wrap

When `otherBills.length === 0`, render the bill ID alone (current behavior unchanged).

### Cache

Same `breaking-news-home` tag from HO 114. No change to revalidation wiring.

## Verification

1. Visit `/`. The Iran-resolution row collapses to one entry: `HCONRES 95 [+2]` (or whichever resolution wins the confidence tie-break) plus the headline once.
2. Hover the `[+2]` pill. Tooltip lists the other two bill IDs.
3. Click the primary bill ID. Lands on the right `/bill/[id]` page.
4. Scan the rest of the block. No headline appears twice.
5. Spot-check `/news`. Still shows one row per (article, bill) pair — this handoff doesn't touch that page.

## Acceptance

1. Breaking-news block on `/` shows one row per article.
2. Multi-bill articles render `[+N]` pill next to the primary bill ID.
3. Primary bill = highest `match_confidence`; ties broken by alphabetical `bill_id`.
4. `/news` page unchanged.
5. Commit: `fix: dedup breaking news by article, surface companions via [+N] pill (HO 118)`
6. Working tree clean, pushed.

## Notes

- Alphabetical tie-break is arbitrary but stable. If a smarter rule wants to land later (prefer non-resolutions, prefer named bills over `RES`/`JRES`/`CONRES`, prefer the originating chamber's version), that's a one-line ORDER BY change.
- `article_url` is the cleanest dedup key. The composite fallback is defensive — some RSS feeds occasionally strip or duplicate URLs across items. If verification shows `article_url` consistently populated, the fallback can simplify in a follow-up; don't pre-optimize.
- If a single article ends up matched to 8+ bills, the `[+7]` pill stays compact. Tooltip will be long but readable. No truncation needed yet.
