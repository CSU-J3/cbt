# Handoff 15: Presidential-desk view

## Goal

A new page at `/president` that shows bills sitting on the president's desk — passed both chambers, awaiting signature or veto. Counterpart to `/stale`: that view is what Congress abandoned, this view is what's queued for the final step.

## Definition

A bill belongs on this view if:

- `stage = 'president'`
- `latest_action_date IS NOT NULL`

Sort `latest_action_date DESC` so the most recently arrived bills appear first. The `idx_bills_latest_action` index already covers this.

The dataset will usually be small (typically under 20 rows). The 10-day constitutional clock means most bills clear this stage quickly, so sorting newest-first surfaces what's actually current; days-on-desk in the action column carries the urgency signal.

## Reuse existing query plumbing

Same pattern as `/stale`. Extend, don't fork.

- Add `getPresidentBills(filters: FeedFilters)` and `getPresidentCount(filters: FeedFilters)` to `lib/queries.ts`.
- Compose with `buildFeedWhere(filters)`. Keep the president-specific WHERE in a small helper (`buildPresidentWhere` or inline constant) so list and count stay in sync.
- `getPresidentCount` returns `{total, filtered}` with the same semantics as the feed and `/stale`: `total` ignores `q`/`topics`, `filtered` applies everything.

`FeedFilters` doesn't need a new field. The stage is fixed by the WHERE helper, not by `filters.stage`. If `filters.stage` is set on this page, ignore it (see StageFilter section below).

## URL state

`?topic=` and `?q=` only. No `?stage=` — every bill on this page is `stage='president'` by definition. If a hand-typed `?stage=enacted` shows up, drop it silently (don't pass it to `buildFeedWhere`).

## Page layout

Mirror `app/stale/page.tsx`. Server component, `Promise.all` the bills+counts query.

Header line: `X OF Y AT PRESIDENT'S DESK`, numerator in `--accent-amber-bright` to match the existing chrome. Subtitle in `--text-muted`: `passed both chambers, awaiting signature or veto`. When `q` is set, append the `· "query"` suffix the feed and `/stale` already use.

Reuse `BillRow`. Same grid columns. Pass `daysSinceMode="desk-time"` (see BillRow section).

## Empty states

Two distinct cases:

1. **Unfiltered empty** (`total === 0`): centered message, `NO BILLS AWAITING PRESIDENTIAL ACTION` in `--text-muted`. No clear-search button — there's nothing to clear, the desk is just empty.
2. **Filtered empty** (`filtered === 0` but `total > 0`): reuse the existing `NO BILLS MATCH "..."` + `[CLEAR SEARCH]` block from the feed and `/stale`.

## BillRow refactor: rename `showStaleness` → `daysSinceMode`

`/stale` shipped with `showStaleness?: boolean`. That worked for one alternate column rendering. Now there are two, with different thresholds, so the prop becomes polymorphic.

Rename: `showStaleness?: boolean` → `daysSinceMode?: 'staleness' | 'desk-time'`. Undefined keeps the default date rendering. `'staleness'` matches today's `/stale` behavior. `'desk-time'` is new.

Touches:

- `components/BillRow.tsx` — rename the prop, switch on it for color thresholds.
- `app/stale/page.tsx` — update the call site from `showStaleness` to `daysSinceMode="staleness"`.

This is a contained rename, no other call sites touch the prop. Keep the days-since rendering logic itself (`daysSince` from `lib/format.ts`, right-aligned monospace, `247d` format) — only the threshold table changes per mode.

## Style — desk-time column

When `daysSinceMode="desk-time"`:

- under 10 days → `--text-secondary` (within the constitutional 10-day window)
- 10–29 days → `--accent-amber` (past the typical signing window)
- 30+ days → `--party-republican` (well past, unusual)

Keep the staleness thresholds untouched: <180 secondary, 180–364 amber, 365+ red. Same color vocabulary, different boundaries.

## StageFilter

Don't render `StageFilter` on `/president` at all. Stage is fixed; offering a dropdown is misleading.

No prop changes needed for this — just leave `<StageFilter />` out of `app/president/page.tsx`. The `availableStages` mechanism added in handoff 14 stays as-is for `/stale`.

## TopicFilter and SearchBox

Both render normally. Pass `basePath="/president"` to each so their hrefs route back here.

## HeaderBar

Add a `DESK` nav link to the existing nav row, active-state coloring when on `/president`. No emoji — match the text-only treatment the rest of the nav uses.

Extend `countMode: "feed" | "stale" | "desk"` and add a `deskCounts` prop (same shape as `staleCounts`) so the count chrome renders the `AT PRESIDENT'S DESK` label and the right numerator color.

`SearchBox` already accepts `basePath` from handoff 14; pass `"/president"` through `HeaderBar` the same way `/stale` does.

## Files to touch

- `app/president/page.tsx` — new server component, mirrors `app/stale/page.tsx`.
- `lib/queries.ts` — `getPresidentBills`, `getPresidentCount`, president-WHERE helper. Constants for `PRESIDENT_STAGE = 'president'` if it reads cleaner inline.
- `components/BillRow.tsx` — rename `showStaleness` to `daysSinceMode`, add `'desk-time'` thresholds.
- `app/stale/page.tsx` — update the prop name at the call site.
- `components/HeaderBar.tsx` — `DESK` nav link, `countMode='desk'`, `deskCounts` prop.
- `.claude/skills/cbt/SKILL.md` — document `/president` in Pages, the new query helpers, the desk-time color thresholds, and the renamed `daysSinceMode` prop on `BillRow`.

## Acceptance

- `/president` lists only bills where `stage='president'`, sorted newest action first.
- Bills with NULL `latest_action_date` never appear.
- Topic and search filters work; persist through row expansion.
- `StageFilter` does not render on the page.
- `?stage=anything` is silently ignored.
- Days-on-desk column color-codes at 10 and 30 day boundaries.
- `DESK` nav link in header, no emoji, active state on `/president`.
- Header shows `X OF Y AT PRESIDENT'S DESK`, with `· "query"` when search is active.
- Unfiltered empty state shows `NO BILLS AWAITING PRESIDENTIAL ACTION`, no clear-search button.
- Filtered empty state matches the existing search-no-match block.
- `/stale` still works after the `daysSinceMode` rename — visual regression check the days-since column there.
- `/` and `/watchlist` are visually unchanged.
- `npm run typecheck` clean.

## Don't

- Don't add an emoji to the nav link.
- Don't render `StageFilter` on this page.
- Don't add a parallel `showDeskTime` prop alongside `showStaleness` — rename to `daysSinceMode` and update both call sites.
- Don't show veto risk, expected signing dates, or any predictive framing. Plain facts only, matches the project's neutral-summary convention.
- Don't add a new index or new `FeedFilters` field.

## Cost note

Zero LLM cost. Pure SQL + render.
