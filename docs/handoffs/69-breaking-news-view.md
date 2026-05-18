# 69 — Breaking news view

## What this is

Handoff 64 shipped the RSS sync pipeline; news mentions are being collected against bills but have no surface. This handoff puts them on the dashboard in two places:

1. A compact **breaking news banner** at the top of `/` showing the last 24h of mentions.
2. A dedicated **`/news` route** as a deeper feed of the same data, same window, more rows.

Click behavior: headline opens the source article in a new tab; bill ID jumps to that bill expanded in the main feed at `/feed?expanded=<id>`.

Read-side only. No schema changes, no sync changes, no LLM changes. The news data already exists from 64 — this handoff just renders it.

## In scope

- New query helper: `getBreakingNews(window, limit)` in `lib/queries.ts`
- New `NewsRow` component for rendering a news mention
- New `BreakingNewsBanner` component placed on the home dashboard
- New `/news` route as a full-feed view of the same data
- HeaderBar reuse on `/news` (count + last-updated MT)
- New CSS grid `.news-row` in `globals.css`
- `unstable_cache` tag `news-breaking` for the queries
- Sync route at `/api/sync` calls `revalidateTag('news-breaking')` after news mentions are upserted

## Out of scope

- Media attention column on the feed row (separate handoff, ships after Monday's cron tick validates matching)
- Most-talked-about cut on weekly reports (depends on matching being trusted)
- Source-level filters or topic filters on `/news` — keep it flat for v1
- Pagination on `/news` — single page, hard cap below
- Mobile-specific layout polish beyond what the existing breakpoint gives for free

## The `news_mentions` table

Handoff 64 created this table. Verify the exact column names before writing the query — if they differ from what's below, adapt the query accordingly and flag the diff at the end of the run. Expected shape:

```sql
news_mentions (
  id INTEGER PRIMARY KEY,
  bill_id TEXT REFERENCES bills(id),
  source TEXT NOT NULL,              -- 'politico' | 'the_hill' | 'roll_call' | 'punchbowl' | etc.
  title TEXT NOT NULL,               -- article headline
  url TEXT NOT NULL,                 -- canonical article URL
  published_at TEXT NOT NULL,        -- ISO timestamp from RSS
  matched_at TEXT NOT NULL,          -- when our matcher tied this to bill_id
  match_method TEXT                  -- 'bill_id' | 'title' | 'sponsor' | etc.
)
```

If columns are named differently (e.g. `article_url` vs `url`, `published` vs `published_at`), use the actual names. Don't rename the table or columns.

## Queries

Add to `lib/queries.ts`:

```ts
export type NewsMention = {
  id: number;
  billId: string;
  billTitle: string;
  billSponsorName: string | null;
  billSponsorParty: string | null;
  source: string;
  title: string;
  url: string;
  publishedAt: string;
};

export async function getBreakingNews(
  windowHours: number,
  limit: number
): Promise<NewsMention[]>
```

Implementation:

- `INNER JOIN bills b ON b.id = m.bill_id` so we can render bill ID + title + sponsor on the row without a second query.
- Filter `m.published_at >= datetime('now', '-' || ? || ' hours')`.
- Filter `b.is_ceremonial = 0` — ceremonial bills shouldn't pollute breaking news any more than they pollute the rest of the dashboard.
- `ORDER BY m.published_at DESC, m.id DESC`.
- `LIMIT ?`.
- Wrap with `unstable_cache(..., ['news-breaking', windowHours, limit], { tags: ['news-breaking'], revalidate: 600 })`. The 10-minute revalidate is a backstop; the explicit `revalidateTag` from the sync route is what keeps it fresh.

Also add to the existing sync route (`/api/sync`), wherever the news sync step lives: after writes complete, call `revalidateTag('news-breaking')` alongside the existing `revalidateTag('feed-bills')` and `revalidateTag('feed-stats')` calls. If the news sync is a separate step that runs after the bills sync, put the call right after that step.

## Components

### `NewsRow` (new)

`components/NewsRow.tsx`. Server component. Props:

```ts
{
  mention: NewsMention;
  showFullHeadline?: boolean;   // false = truncate at 1 line; true = wrap. Banner uses false, /news uses true.
}
```

Grid via a new `.news-row` class in `globals.css`:

```
86px       — bill ID
1fr        — headline (clickable, target=_blank)
120px      — source label (uppercase, dim)
64px       — age (right-aligned, tabular-nums)
```

No expand arrow column. No topics column. Source is a plain uppercase label, not a colored tag — sources have their own visual identity through the existing terminal palette.

The bill ID cell links to `/feed?expanded=${mention.billId}` (internal navigation, same tab). The headline cell links to `mention.url` with `target="_blank" rel="noopener noreferrer"`. Whole-row click should NOT navigate — make the two link zones explicit so clicks land on the user's actual intent.

Age cell renders relative time:
- `< 60min` → `Xm`
- `< 24h` → `Xh`
- `>= 24h` → `Xd`

Use a new `lib/format.ts` helper `formatRelativeAge(iso)` that returns the appropriate string. Add it to the file with the other date helpers.

Color the age value the same way `daysSinceMode` does staleness on `/stale`:
- `< 6h` → `--accent-amber-bright` (fresh)
- `6–23h` → `--text-secondary`
- `>= 24h` → `--text-muted`

This way the banner has a visual signal for genuinely fresh items vs. day-old leftovers. Don't add a `freshness` prop — derive the color inside `NewsRow` from the age math.

### `BreakingNewsBanner` (new)

`components/BreakingNewsBanner.tsx`. Server component. Fetches via `getBreakingNews(24, 5)` and renders:

- Header label: `BREAKING · LAST 24H` in `--accent-amber`, 12px uppercase, letter-spacing 0.5px.
- 5 `NewsRow` rows below, `showFullHeadline={false}`.
- Right-aligned `[VIEW ALL →]` link to `/news` in the header line.
- Empty state: skip the entire banner. Don't render a placeholder block — the dashboard shouldn't have a "nothing happened" panel.

Place it on the home page (`app/page.tsx`), between the LLM three-sentence lead and the stage funnel + topic mix blocks. The framing question prioritizes "what just happened" above static distributions.

### `/news` route

`app/news/page.tsx`. Server component. Fetches via `getBreakingNews(24, 50)`. Renders:

- `HeaderBar` with title `BREAKING NEWS · LAST 24H` and the count of returned mentions.
- A header row (CSS-aligned to `.news-row`) labeled `BILL · HEADLINE · SOURCE · AGE`.
- `NewsRow` rows with `showFullHeadline={true}`.
- Empty state: a single centered muted line — `No news mentions in the last 24 hours.` No chrome, no "come back later" copy.
- `FooterLegend`.

Add `/news` to the global nav strip wherever the other dashboard links live (`/`, `/feed`, `/stale`, `/changes`, `/president`, `/sponsors`, `/watchlist`). Position it between `/feed` and `/stale` — news is upstream of staleness.

`HeaderBar` already supports a count + title shape; if `/news` needs a label that doesn't map to the existing prop names, add a new optional prop (`pageTitle?: string`) rather than overloading `feedFilters`. Don't pass `feedFilters` here.

## CSS

Add to `globals.css` alongside the existing `.feed-row` and `.sponsor-row` blocks:

```css
.news-row {
  display: grid;
  grid-template-columns: 86px 1fr 120px 64px;
  align-items: baseline;
  column-gap: 12px;
  padding: 6px 0;
  border-bottom: 1px solid var(--border-soft);
  font-size: 14px;
}

.news-row:hover {
  background: var(--bg-row-hover);
}

.news-row .source {
  font-size: 12px;
  letter-spacing: 0.5px;
  color: var(--text-muted);
  text-transform: uppercase;
}

.news-row .age {
  text-align: right;
  font-variant-numeric: tabular-nums;
  font-size: 13px;
}

@media (max-width: 700px) {
  .news-row {
    grid-template-columns: 86px 1fr 56px;
  }
  .news-row .source {
    display: none;
  }
}
```

Mobile drops the source column. Headline truncates on mobile because the `1fr` is doing the work, not a fixed column.

## Caching

- `getBreakingNews` wrapped in `unstable_cache` with tags `['news-breaking']`, revalidate 600s.
- Sync route invalidates `news-breaking` after news writes.
- The home page route already uses `unstable_cache`-wrapped queries — the banner inherits that. Don't add `revalidate` exports to `app/page.tsx` or `app/news/page.tsx`; per the SKILL.md note, route-level revalidate does nothing on these pages.

## Verification

1. `/news` loads, lists ≤50 mentions from the last 24h, all tied to non-ceremonial bills.
2. `/` shows the banner above the dashboard blocks; banner shows 5 mentions or hides entirely if zero.
3. Headline click opens source in new tab. Bill ID click navigates to `/feed?expanded=<id>` and the row is expanded.
4. Age coloring: a mention from 30 minutes ago renders amber-bright; one from 12h ago renders secondary; one from 26h ago wouldn't appear (outside window).
5. Empty state on `/news` is a single muted line.
6. After triggering a manual sync that ingests at least one new mention, the banner updates within a page refresh (cache invalidated by tag).
7. Mobile (`< 700px`): source column hidden on both surfaces, banner still legible.

## Don't

- Don't add filters to `/news`. Topic and source filters are theme-4-v2 work.
- Don't add a "news mentions count" to bill rows on the feed. That's the media attention column, separate handoff.
- Don't change the news sync schedule. The current cron cadence is fine for v1.
- Don't expose `match_method` in the UI. It's diagnostic, not user-facing.
- Don't extend the window beyond 24h on either surface. Wider windows go on `/news` later as a `?window=48h` param if the appetite is there.
