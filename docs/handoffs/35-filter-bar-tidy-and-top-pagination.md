# Filter bar tidy-up + top pagination

Three small changes in the chrome above the feed.

## 1. Add pagination above the feed

The pagination control currently only sits below the feed. Render the
same `<Pagination />` component a second time **directly under the
topics chip row**, above the column header line.

It's the same component instance (props-wise), just rendered twice —
once at top, once at bottom. No new state, no new logic. The bottom
copy stays.

If `<Pagination />` returns `null` when `totalPages <= 1`, the top one
also disappears for short result sets — fine, that's the right
behavior.

## 2. Line up the stage dropdown with the sort dropdown

Currently the stage filter and the sort dropdown are not visually
aligned. Put them on the same horizontal row so their dropdowns sit at
the same baseline. Layout target:

```
[ALL STAGES ▼]                                              SORT  [LATEST ACTION ▼]
TOPICS  [HLTH] [IMM] [TAX] ... [OTHR]
‹ PREV  1 2 3 … 15  NEXT ›
─────────────────────────────────────  (column headers)
... feed ...
```

Stage on the left, sort on the right of the same row. Topics chips
become their own row beneath. Pagination beneath topics. Then the
column headers and the feed.

## 3. Remove the "STAGE" label

The dropdown's placeholder already says `ALL STAGES`. The redundant
`STAGE` label to the left of it goes. Keep the `SORT` label on the
right side — without it the bare `LATEST ACTION` reads as an action,
not a sort selector. Asymmetric is fine.

## Verify

- Stage dropdown and sort dropdown are on the same row, baseline-aligned.
- Topics chips row sits below them on its own line.
- Pagination renders directly below topics, above the feed's column header row.
- Pagination still renders below the feed too — both top and bottom copies show the same page state.
- Clicking a page number from the top control scrolls to the top of the new page (default browser behavior on navigation; should already work).
- Removing the `STAGE` label didn't remove the dropdown itself or its functionality.
- Mobile width — stage and sort still pair on one row if there's room, or stack cleanly if not. Topics chips wrap as before.
- Short filter results (≤ 100 bills, totalPages = 1) — both pagination copies hide.

## Out of scope

Don't change the dropdown styling, the chips' look, or the column header row. Don't restyle the sort label — just leave it where it is on the right.
