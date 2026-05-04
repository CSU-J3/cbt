# Handoff 14: Stale-bill view

## Goal

A new page at `/stale` that surfaces bills Congress started and abandoned — introduced, possibly moved a stage or two, then stalled. The main feed shows what's moving; this shows what isn't.

## Definition of stale

A bill is stale if all of these hold:

- `latest_action_date IS NOT NULL` (no action date means we can't measure staleness)
- `latest_action_date < date('now', '-60 days')`
- `stage IN ('introduced', 'committee', 'floor', 'other_chamber', 'other')` — `president` and `enacted` are success states, not stalls

Sort by `latest_action_date ASC` so the stalest bills appear first. `idx_bills_latest_action` already covers this.

One ranked list, no buckets. Color thresholds on the days-since column carry the "going stale vs abandoned" signal (see Style).

## Reuse existing query plumbing

After the search work, `lib/queries.ts` has `FeedFilters`, a shared `buildFeedWhere`, and `getFeedCount({stage, topics, q})` returning `{total, filtered}`. Extend that pattern; don't invent a parallel one.

- Add a `getStaleBills(filters: FeedFilters)` and `getStaleCount(filters: FeedFilters)` that return the same shape as their feed counterparts.
- Build their WHERE by calling `buildFeedWhere(filters)` and ANDing the three stale conditions on top. Keep the stale conditions in one helper (`buildStaleWhere` or similar) so the count and list functions stay in sync.
- `total` in `getStaleCount` = total stale rows ignoring `q`/`topics`/`stage`. `filtered` = count after all filters. Same semantics as the feed.

## URL state

`?topic=`, `?stage=`, `?q=` only. No new params. Same param shape Code already handles.

## Page layout

Reuse `BillRow`. Same grid columns. Same header chrome.

Header line: `X OF Y STALE BILLS` matching the `47 OF 1,643 BILLS` pattern from search. Subtitle in `--text-muted`: `no action in 60+ days, oldest first`. The numerator uses `--accent-amber-bright`.

When `q` is set, append the matching-search treatment the feed already does (`X OF Y STALE BILLS · "tax"`).

Empty result reuses the centered `NO BILLS MATCH "..."` + `[CLEAR SEARCH]` pattern from the feed.

## Style — days-since column

The action-date column on `/stale` shows staleness instead of the raw date.

Format: `247d`, right-aligned, monospace. Color thresholds:

- under 180 days → `--text-secondary`
- 180–364 days → `--accent-amber`
- 365+ days → `--party-republican`

Add `daysSince(dateStr: string): number` to `lib/format.ts` if it doesn't exist.

Gate this rendering behind a prop on `BillRow` (e.g. `showStaleness?: boolean`). Default false so the main feed and watchlist are visually unchanged.

## Filter components — basePath threading

`StageFilter`, `TopicFilter`, `BillRow`, and `SearchBox` all generate hrefs internally. After the search work they thread `q` through, but the base path is almost certainly hardcoded to `/`. On `/stale` those hrefs need to point back to `/stale`.

Pick whichever is less disruptive:

1. Add an optional `basePath?: string` prop (default `/`) to `StageFilter`, `TopicFilter`, `BillRow`, and `SearchBox`. `/stale` passes `basePath="/stale"`.
2. Read `usePathname()` inside each component (requires them to be client components — probably more churn than it's worth).

Option 1 unless there's a reason it doesn't work.

## Stage filter constraint on /stale

`StageFilter` should only offer the four eligible stages on `/stale`: `introduced`, `committee`, `floor`, `other_chamber`. Don't show `president` or `enacted` as options.

Add an optional `availableStages?: Stage[]` prop. Default to the full list. `/stale` passes the four-stage subset. If a user lands on `/stale?stage=enacted` via a hand-typed URL, the page should silently ignore it (filter as if no stage was set).

## HeaderBar

Already accepts `feedFilters`. Pass the stale filters in the same shape so the count line renders.

Add a nav link to `/stale` next to whatever exists for `/` and `/watchlist`. Active state when on the route.

## Files to touch

- `app/stale/page.tsx` — new server component, mirrors `app/page.tsx`.
- `lib/queries.ts` — `getStaleBills`, `getStaleCount`, shared stale-WHERE helper.
- `lib/format.ts` — `daysSince` if missing.
- `components/HeaderBar.tsx` — nav link to `/stale`.
- `components/BillRow.tsx` — `showStaleness` prop, days-since rendering, `basePath`.
- `components/StageFilter.tsx` — `availableStages`, `basePath`.
- `components/TopicFilter.tsx` — `basePath`.
- `components/SearchBox.tsx` — `basePath`.
- `.claude/skills/cbt/SKILL.md` — document `/stale` in the Pages section, document the new query functions in the Sync logic / queries area, document the staleness color thresholds in the design system. No "what not to do" entry needs to be removed for this one.

## Acceptance

- `/stale` lists bills sorted oldest-action-first, all 60+ days stale.
- `enacted` and `president` bills never appear, even via `?stage=enacted`.
- Bills with NULL `latest_action_date` never appear.
- Topic and search filters work on `/stale` and persist through stage changes / row expansion.
- Stage filter on `/stale` only offers the four eligible stages in its dropdown.
- Header shows `X OF Y STALE BILLS`, with the `· "query"` suffix when search is active.
- Empty results show the same centered message + clear-search button the feed uses.
- Days-since column color-codes at 180 and 365 day boundaries.
- Main feed (`/`) and watchlist (`/watchlist`) are visually unchanged.
- `npm run typecheck` clean.

## Don't

- Don't add a custom threshold UI (slider, days input). 60-day floor is hardcoded.
- Don't add named tiers ("going stale", "abandoned") in text. Color carries it.
- Don't add a new index. `idx_bills_latest_action` is sufficient.
- Don't change the default rendering of `BillRow` — the new behavior is opt-in via prop.
- Don't duplicate `buildFeedWhere` logic; compose with it.

## Cost note

Zero LLM cost. Pure SQL + render.
