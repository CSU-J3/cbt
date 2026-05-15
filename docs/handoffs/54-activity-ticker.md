# 54 — Activity ticker (middle pane)

## What this is

Replaces the `ActivityTickerPlaceholder` from handoff 53 with the real thing: a compact, top-N list of recent stage transitions in the dashboard's middle pane. Reuses the data and rendering from `/changes` instead of building new infrastructure. The pane gets a "VIEW ALL CHANGES →" footer link, completing the dashboard's middle column.

Roadmap theme 2, step 2. With this shipped, the only remaining placeholder on the dashboard is the right-pane topic mix (handoff 55).

## Scope

- New `ActivityTicker` server component in the middle pane
- Replaces `ActivityTickerPlaceholder` in `app/page.tsx`
- Reuses the existing `/changes` query helper (with a `limit` param if not already present)
- Renders rows with `BillRow` in `showStageTransition` mode (same as `/changes`)
- Top 15 by default
- Footer link strip "VIEW ALL CHANGES →" pointing to `/changes`
- Empty state mirrored from `/changes`
- Mobile: stacks with the other panes (handoff 53 already handles the breakpoint)

## Out of scope

- New-introductions in the ticker (would flood with ceremonial-rate bill drops)
- Click-to-filter interactivity (still deferred until the dashboard's data flow proves out)
- Auto-refreshing ticker (server-rendered, refreshes on cache invalidation or page load)
- Per-row UI beyond what `BillRow` already provides

## Data source

The `/changes` page (`app/changes/page.tsx`) already queries bills with `stage_changed_at` in the last 7 days, sorted DESC. Use that same query helper for the ticker. Three adjustments may be needed:

1. Add a `limit?: number` parameter if the helper doesn't accept one. The ticker calls with `limit: 15`.
2. Ensure the helper's data is tagged with the unified `bills` tag (per the convention SKILL.md now documents). If `/changes` doesn't currently cache its query, wrap it with `unstable_cache(..., ['changes-bills'], { tags: ['bills'], revalidate: 3600 })`. The dashboard depends on this cache participating in sync invalidation.
3. Add an `excludeCeremonial?: boolean` parameter, default `false`. The ticker call sets it to `true`. If `/changes` doesn't currently exclude ceremonial, leave that page's behavior alone; the param exists for the ticker call only.

If the existing helper is awkward to extend, write a thin sibling (e.g. `getRecentChanges(limit, opts)`) that shares the WHERE clause with `/changes` rather than duplicating logic. Use judgment on which is cleaner.

## Component (`components/ActivityTicker.tsx`)

Server component. Reads from the helper, renders a list of `BillRow` instances in `showStageTransition` mode.

Structure:

```tsx
<ActivityTicker>
  <BillRow ... showStageTransition basePath="/feed" />
  <BillRow ... showStageTransition basePath="/feed" />
  ... up to 15 rows
  <ViewAllChangesLink />
</ActivityTicker>
```

Notes:

- Same row template as `/changes`. The `.changes-feed` wrapper class that widens the stage column on `/changes` should also wrap the ticker rows so the transition glyph renders the same way in both places.
- `basePath="/feed"` so row expand and the inline title link behave consistently with the rest of the app.
- If the helper returns fewer than 15 rows, render whatever it returns. Don't pad.

## Footer link strip

Below the last row, a full-width link strip:

```
[ VIEW ALL CHANGES → ]
```

- Full width of the middle pane
- `--accent-amber` text, `--bg-panel` background, no top border (lets the rows flow into it)
- ~32px tall, centered text, 12px uppercase, letter-spacing 0.5px
- Hover: brighter (`--accent-amber-bright`)
- Links to `/changes`
- Renders even when zero rows exist (the link is useful regardless)

## Empty state

If the helper returns 0 rows, render the same copy `/changes` uses:

```
No stage changes in the last 7 days.
```

- `--text-dim`, 13px, centered vertically in the pane area
- The footer link strip still renders below it

## `app/page.tsx` change

Replace `<ActivityTickerPlaceholder />` with `<ActivityTicker />`. Remove the placeholder import. Delete `components/ActivityTickerPlaceholder.tsx` from the repo (it has served its purpose).

Also update the pane's header label from `ACTIVITY` to `ACTIVITY · LAST 7 DAYS` (same 12px uppercase styling as the other pane headers).

## SKILL.md updates

In the Pages section, update the `/` entry:

- Middle pane: real ticker. Top 15 recent stage transitions in the last 7 days, ceremonial excluded, footer link to `/changes`.

In the Query helpers section, document whatever ended up being added:

- If a `limit` param was added to the existing `/changes` helper, note it.
- If a new `getRecentChanges` helper was created, document its signature.
- If `excludeCeremonial` is a new param, note it.

## Verification

1. `pnpm dev`, hit `/`. The middle pane shows real recent transitions, not the placeholder.
2. Each row's transition glyph (`▸ INTRO → ▸▸ COMMITTEE`) matches what `/changes` shows for the same bill.
3. Clicking a row expands it inline (same behavior as `/changes`).
4. The "VIEW ALL CHANGES →" link works and lands on `/changes` with the full list.
5. If there genuinely are no transitions in 7 days, the empty state renders cleanly with the footer link still present.
6. Ceremonial transitions don't appear on the ticker. Verify by checking the latest `/changes` list against the ticker; any ceremonial rows in `/changes` should be absent from the ticker.
7. Mobile: the ticker renders below the funnel and above the right-pane blocks, with no overflow.
8. After `pnpm sync`, the ticker reflects new transitions within the 1h cache cycle (or immediately after the cron's `revalidateTag("bills")` call).

## Acceptance

The middle pane shows a real activity ticker. The dashboard is one placeholder closer to complete. `/changes` behavior is unchanged.
