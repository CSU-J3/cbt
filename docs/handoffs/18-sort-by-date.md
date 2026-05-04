# Handoff 18: Feed sort dropdown

## Goal

Add a sort dropdown to `/` and `/watchlist` so the feed can switch between "Latest action" (current behavior) and "Newly introduced." Mirrors the existing StageFilter / TopicFilter shape.

## Sort options

Two only:

- `action` (default): `ORDER BY latest_action_date DESC NULLS LAST, id DESC`
- `introduced`: `ORDER BY introduced_date DESC NULLS LAST, id DESC`

The secondary `id DESC` clause keeps ordering stable when dates tie.

No ASC toggle. No `update_date` option (it tracks API re-fetch timestamps, not anything the user cares about). No sponsor or bill-number sort.

## URL param

`?sort=action|introduced`. Default `action`. Invalid values fall back to default silently.

Add `sanitizeSort(raw: string | null): SortKey` to `lib/queries.ts` next to `sanitizeStaleStage`.

## Plumbing

`FeedFilters` gets `sort?: SortKey` (optional, default `'action'` resolved inside the query).

`getFeed` accepts the sort key and switches the ORDER BY clause. `getFeedCount` doesn't care about sort, no changes there.

`buildFeedWhere` is untouched. Sort is ORDER BY, not WHERE.

## Component

New `components/SortDropdown.tsx`, client component, mirrors `StageFilter.tsx` exactly:

- Same dropdown styling (border, hover, etc.)
- `basePath?: string` prop (defaults `/`); `/watchlist` passes `"/watchlist"`
- Threads through `?topics=`, `?stage=`, `?q=`, `?sponsor=`, `?expanded=` like every other filter
- Labels: `LATEST ACTION` and `NEWLY INTRODUCED`. All caps, terminal aesthetic.

Place it in the filter row on `/` and `/watchlist` after StageFilter and TopicFilter.

## Where it does NOT apply

- `/stale` is forced `latest_action_date ASC` and that's the page's whole point. Don't add the dropdown.
- `/president` sorts by desk-arrival date and there are 3 rows. Don't add the dropdown.
- `/sponsors` sorts by `bill_count DESC`, a different axis entirely. Don't add the dropdown.

## Header behavior

No change to the count line. Sort is implicit, not announced. The column header `ACTION` doesn't change either; if `sort=introduced` is active, the column still shows latest action date (it's the most useful date to display regardless of sort key).

## Files to touch

- `lib/queries.ts` (`SortKey` type, `sanitizeSort`, `FeedFilters.sort`, `getFeed` ORDER BY switch)
- `components/SortDropdown.tsx` (new)
- `app/page.tsx` (read `?sort=`, pass to filters, render SortDropdown)
- `app/watchlist/page.tsx` (same)
- `components/BillRow.tsx`, `StageFilter.tsx`, `TopicFilter.tsx`, `SearchBox.tsx` (thread `sort` through generated hrefs alongside the existing `sponsor` passthrough)
- `.claude/skills/cbt/SKILL.md` (document the sort param, the two sort keys, the explicit "not on stale/president/sponsors" rule)

## Acceptance

- `/` defaults to `latest_action_date DESC`, identical to current behavior.
- `/?sort=introduced` sorts by `introduced_date DESC`. The visible date column still shows latest action.
- `/?sort=garbage` falls back to default silently, no 500.
- `/watchlist` supports the same two options.
- Sort persists when changing stage, topic, or expanding a row.
- Sort persists when typing in the search box.
- `/stale`, `/president`, `/sponsors` are visually unchanged; no SortDropdown rendered.
- `npm run typecheck` clean.

## Don't

- Don't add ASC/DESC toggles. DESC-only is the right default for a "what's new" feed.
- Don't sort by `update_date`. It's a sync artifact, not user-meaningful.
- Don't make column headers clickable. Dropdown is consistent with existing filter UI.
- Don't change the visible date column based on sort. ACTION stays as latest_action_date regardless.

## Cost note

Zero. ORDER BY change only.
