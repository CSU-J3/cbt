# 53 — Dashboard shell + stage funnel

## What this is

The home page redesign starts here. `/` becomes the dashboard (the answer surface for "wtf is going on in Congress"), the existing feed moves to `/feed` verbatim, and the dashboard ships with its hero visualization (a vertical stage funnel) plus structural placeholders for the activity ticker and right-pane blocks that come in follow-up handoffs.

Roadmap theme 2, step 1. Unblocks the visualizations and weekly-reports themes.

## In scope

- Route restructure: `/` → dashboard, current `/` → `/feed`
- Three-pane CSS grid layout on `/`
- Stage funnel viz in the left pane (`StageFunnel` component, hand-rolled SVG)
- Two placeholder blocks (middle pane "activity ticker", right pane "topic mix") that name the next handoff number
- HeaderBar variant for the dashboard (timestamp + corpus count, no search, no filter context)
- New query helpers: `getStageDistribution`, `getCorpusStats`
- `basePath` default change across feed-shaped components
- SKILL.md updates

## Out of scope (future handoffs)

- Activity ticker in the middle pane → handoff 54
- Topic mix / top sponsors / weekly report card in the right pane → handoff 55
- LLM-generated dashboard lead → handoff 56 or later, only if the dashboard feels naked without it
- Click-to-filter interactivity (click a funnel stage → filter middle/right blocks) → a later handoff, after the panes are populated. Depends on knowing what's filterable.
- Bubble-pack topic viz → v2 alternative for the right-pane topic-mix slot

Build the static version first. Interactivity layers in once the data flow is proven.

## Route restructure

Move the existing `/` to `/feed`. Verbatim port: same `searchParams` handling, same filters, same pagination, same HeaderBar feed-context behavior, same FooterLegend, same StageFilter/TopicFilter/SortDropdown/SearchBox. The only thing that changes is the URL.

Specifically:

- Move `app/page.tsx` → `app/feed/page.tsx`. Keep contents identical except update any internal `basePath` references from `/` to `/feed`.
- Create a new `app/page.tsx` for the dashboard (spec'd below).

Update consumers that link to `/` expecting the feed:

- `components/BillRow.tsx`: change the `basePath` default from `'/'` to `'/feed'`. All callers that previously omitted the prop now get `/feed` (correct for `/stale`, `/changes`, `/watchlist`, `/president`, `/feed` itself).
- `components/StageFilter.tsx`: same default change.
- `components/TopicFilter.tsx`: same default change.
- `components/SearchBox.tsx`: same default change.
- `components/HeaderBar.tsx`: brand mark still links to `/` (the dashboard). Confirm this. If it currently links to the feed, that's now `/feed`.
- `app/sponsors/page.tsx`: the `[VIEW ALL N BILLS →]` link goes to `/?sponsor=<name>`. Change to `/feed?sponsor=<name>`.
- Anywhere else a `/` href exists with feed-shaped query params: change to `/feed`.

Sanity check: grep the repo for `href="/?` and `href={\`/?` patterns. Make sure no link references the old URL shape with feed-style query params.

## Three-pane layout (`app/page.tsx`)

CSS grid, three panes, fractional widths:

- Left pane: `5fr` (the hero visualization)
- Middle pane: `6fr` (the activity ticker, widest pane — same OTX-like proportion)
- Right pane: `3fr` (stacked secondary blocks)

Page structure:

```
<Page>
  <HeaderBar variant="dashboard" />
  <DashboardGrid>
    <LeftPane>
      <StageFunnel />
    </LeftPane>
    <MiddlePane>
      <ActivityTickerPlaceholder />
    </MiddlePane>
    <RightPane>
      <SubViewLinkStrip />
      <TopicMixPlaceholder />
    </RightPane>
  </DashboardGrid>
  <FooterLegend />
</Page>
```

Below 700px, panes stack vertically: funnel → middle placeholder → right blocks. Apply via the existing `@media (max-width: 700px)` pattern.

Each pane gets a thin `--border-soft` border, panel background `--bg-panel`, `12px` padding, and a `12px` uppercase header label (e.g. `STAGE DISTRIBUTION`, `ACTIVITY`, `JUMP TO`).

## StageFunnel component (`components/StageFunnel.tsx`)

Server component. Reads from `getStageDistribution()`, renders SVG.

Layout: vertical stack of horizontal bars, one per stage, top-to-bottom in pipeline order: `introduced`, `committee`, `floor`, `other_chamber`, `president`, `enacted`. Each bar's width is proportional to that stage's bill count relative to the widest stage (almost always `introduced`).

Each row in the funnel:

- Bar (color from `--stage-{name}` tokens, no gradients, flat fill)
- Left of bar: stage label (uppercase, 12px, color matches bar)
- Right of bar: count + percentage of total (tabular-nums, 13px, `--text-secondary`)

Approximate rendering target:

```
▸ INTRO             ████████████████████████████   8,247  (78%)
▸ COMMITTEE         ██████████                     1,453  (14%)
▸▸ FLOOR            ███                              412   (4%)
▸▸▸ OTHER CHAMBER   ██                               287   (3%)
▸▸▸▸ PRESIDENT      ▏                                  3  (<1%)
✓ ENACTED           █                                152   (1%)
```

Use the existing `▸` glyph conventions from `components/StageIndicator.tsx` if it makes sense visually. Otherwise plain colored bars are fine.

Exclude `stage='other'` and `stage IS NULL` from the funnel. If the excluded count is non-zero, note it as small dim text below the chart: `+ 47 bills off-path`.

Exclude `is_ceremonial = 1`. The dashboard shows the substantive picture. The ceremonial toggle that exists on list views does not apply to the dashboard.

No hover states, no tooltips, no click-to-filter for v1. Static SVG.

Hand-rolled SVG, no library. `<svg viewBox="...">`, `<rect>`, `<text>`. Keep the markup readable. This is a 6-bar chart; total SVG should fit in under 100 lines.

## Query helpers (`lib/queries.ts`)

### `getStageDistribution()`

```ts
type StageDistribution = {
  stage: Stage;
  count: number;
  percentage: number;  // 0-100, of total substantive on-path bills
};

async function getStageDistribution(): Promise<{
  bars: StageDistribution[];
  offPath: number;
  total: number;
}>;
```

Query:

```sql
SELECT stage, COUNT(*) AS count
FROM bills
WHERE (is_ceremonial = 0 OR is_ceremonial IS NULL)
  AND stage IN ('introduced', 'committee', 'floor', 'other_chamber', 'president', 'enacted')
GROUP BY stage;
```

Separate query for `offPath`:

```sql
SELECT COUNT(*) FROM bills
WHERE (is_ceremonial = 0 OR is_ceremonial IS NULL)
  AND (stage = 'other' OR stage IS NULL);
```

Wrap with `unstable_cache(..., ['stage-distribution'], { tags: ['stage-distribution'], revalidate: 3600 })`.

### `getCorpusStats()`

```ts
async function getCorpusStats(): Promise<{
  total: number;        // total non-ceremonial bills
  lastSync: string;     // ISO timestamp of most recent update_date
}>;
```

Query:

```sql
SELECT COUNT(*) AS total, MAX(update_date) AS last_sync
FROM bills
WHERE (is_ceremonial = 0 OR is_ceremonial IS NULL);
```

Cache: `unstable_cache(..., ['corpus-stats'], { tags: ['corpus-stats'], revalidate: 3600 })`.

### Cache invalidation

The sync cron route (`app/api/sync/route.ts`) already calls `revalidateTag('feed-stats')` and `revalidateTag('feed-bills')` after writes. Add two more:

```ts
revalidateTag('stage-distribution');
revalidateTag('corpus-stats');
```

## HeaderBar dashboard variant

The current `HeaderBar` is built for feed-shaped routes (count + filters + last-updated, with the search box swapping in when `feedFilters` are passed). On the dashboard, none of that applies. Nothing to count, no filters, no search (search lives on `/feed`).

Add a `variant?: 'feed' | 'dashboard'` prop, default `'feed'` so existing pages keep their behavior. When `variant='dashboard'`:

- Left: brand mark (unchanged)
- Center: nothing
- Right: `15,712 BILLS TRACKED · LAST SYNC 02:48 MT` in `--text-muted`, 13px tabular-nums for the count

Pass `variant="dashboard"` from `app/page.tsx`. Leave the prop unset (or explicit `variant="feed"`) on `/feed`, `/stale`, `/president`, `/changes`, `/sponsors`, `/watchlist`.

`getCorpusStats()` feeds the right-side content.

## SubViewLinkStrip (`components/SubViewLinkStrip.tsx`)

Right pane, top block. Six links to the existing sub-views:

```
JUMP TO
─────────────
▸ FEED
▸ CHANGES
▸ STALE
▸ PRESIDENT
▸ SPONSORS
▸ WATCHLIST
```

12px labels, `--text-secondary`, hover state `--accent-amber`. Vertical stack, 8px row gap.

Counts beside each link are nice-to-have, not required. Add only if cheap (i.e. already computed elsewhere). Do not build new count infrastructure for the link strip.

## ActivityTickerPlaceholder

Dead-simple. Middle pane, takes its full height, centered muted text:

```
[ ACTIVITY TICKER ]

Last 7 days of stage transitions and new enactments.
Shipping in handoff 54.
```

Style: `--text-dim`, 13px. The placeholder should look intentionally deferred, not broken.

## TopicMixPlaceholder

Same shape, right pane lower block:

```
[ TOPIC MIX ]

Distribution of bills by topic.
Shipping in handoff 55.
```

## SKILL.md updates

Edit the `Pages` section:

- Add `/` — dashboard. Three-pane grid: stage funnel (left), activity ticker (middle, placeholder until handoff 54), sub-view link strip + topic mix (right, partially deferred to handoff 55). `HeaderBar` uses `variant='dashboard'` here. No search, no filters, no count line. The dashboard isn't a list of anything. Mobile: panes stack top-to-bottom.
- Update the existing `/` entry to describe `/feed` — the bill feed previously at `/`. Same behavior, same filters, same pagination, just at the new URL. `BillRow`, `StageFilter`, `TopicFilter`, and `SearchBox` now default `basePath` to `/feed`.

Edit `Server / client split`:

- The dashboard at `/` is entirely server-rendered. No client islands. The funnel is static SVG.

Edit `Query helpers`:

- Add `getStageDistribution()` — funnel bars, off-path count, total. Cached with tag `stage-distribution`, invalidated by the sync cron.
- Add `getCorpusStats()` — total non-ceremonial bill count + last sync timestamp. Cached with tag `corpus-stats`, invalidated by the sync cron.

Edit `basePath threading`:

- Default for `StageFilter`, `TopicFilter`, `BillRow`, `SearchBox` is now `'/feed'`. Each feed-shaped route either passes its own path (`/stale`, `/changes`, `/president`, etc.) or omits the prop and gets `/feed`. The dashboard at `/` does not render any of these components.

## Verification

1. `pnpm dev`, hit `/`. Should show the dashboard: funnel left, deferred-ticker placeholder middle, sub-view link strip + deferred-topic-mix right. HeaderBar shows corpus count + last-sync, no search.
2. Hit `/feed`. Should show the feed exactly as `/` used to show it. All filters work. Pagination works. Search works. Bill row expand works.
3. Hit `/feed?stage=committee&q=fentanyl`. Filters compose. HeaderBar shows the filtered count.
4. Hit `/feed?sponsor=<encoded name>`. Sponsor filter still works.
5. From `/sponsors`, click a sponsor's `[VIEW ALL N BILLS →]` link. Lands on `/feed?sponsor=...`, not `/?sponsor=...`.
6. From `/stale`, click a bill row to expand. The `[VIEW DETAIL ↗]` and back-navigation links still work correctly.
7. Mobile (~375px wide): panes stack vertically on `/`. Funnel renders without overflow. Bar widths still proportional.
8. After `pnpm sync` runs locally, the funnel updates within the cache TTL (1h) or immediately after the cron route's `revalidateTag` call.

## Acceptance

Dashboard renders, funnel is readable at a glance, feed lives at `/feed` and nothing about its behavior has regressed. Two placeholder blocks visibly say what's coming next. SKILL.md reflects the new layout.
