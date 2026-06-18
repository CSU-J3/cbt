# HO 249 — NEW THIS WEEK feed tab

Confirm the next free number before saving: `ls docs/handoffs/ | sort | tail`. Body assumes 249.

## What this is

Add the third feed tab to the dashboard feed (`ActivityTabs`), completing MOVERS / TOP STALLS / NEW THIS WEEK to the FULL redesign spec. This is the unblocked one — the data exists (`getNewBillsThisWeekCount` from HO 244), the `introduced_date` index exists (HO 246), and the expanded row is shared across tabs, so the build is a list query + a tab + a collapsed metric.

Read the live feed code first; `/mnt/project` is a fossil.

## Premises to verify (before building)

1. **"New this week" window.** `getNewBillsThisWeekCount` already defines the window (trailing `introduced_date`, last 7 days, presumably). Read it and make the new list query use the **same predicate**, so the tab-label count and the row list can't disagree.
2. **`ActivityTabs` shape.** How tabs and their collapsed metrics are defined today (MOVERS, TOP STALLS). Adding a third should be mechanical — confirm it.
3. **Shared expanded row.** The spec says the expanded row is the same for all tabs. Confirm the existing expanded-row component is tab-agnostic so NEW THIS WEEK reuses it unchanged. If it's coupled to MOVERS/STALLS data, flag the coupling — don't fork a bespoke expanded row.
4. **Collapsed metric slot.** Confirm the collapsed row takes a per-tab metric variant (MOVERS = stage move, STALLS = days stuck), so NEW = time-since-intro slots in the same way.

## The build

- **New list query `getNewBillsThisWeek`.** Returns the rows introduced in the window (same predicate as the count), ordered `introduced_date DESC`. Use `INDEXED BY idx_bills_introduced_date` — Turso is statless, so the planner won't pick the index on its own (HO 246). Confirm with `EXPLAIN QUERY PLAN` it rides the covering index.
- **Third tab in `ActivityTabs`:** `NEW THIS WEEK (N)`, where `N` is `getNewBillsThisWeekCount` (the existing count — so the label and the list share the window and can't drift).
- **Collapsed row:** id pill (chamber-colored border) + title (truncate) + the NEW metric = **time since intro** (e.g. `12d`, derived from `introduced_date`) + chevron. Topic tags do NOT appear on the collapsed row — same as the other tabs.
- **Expanded row:** reuse the shared expanded row unchanged (stage pipeline + summary + RELATED NEWS + right column + buttons, topic tags on expand).
- **Preview:** same as the other tabs — ~4-5 rows then `[ + N MORE → ]`.

## Constraints

- Reuse the shared collapsed-row + expanded-row primitives. No bespoke row for this tab.
- No new tokens.
- Named `git add`. Stale `.next` rule on the UI ship (verify the stylesheet asset loads). `npm run build` clean.

## Ship report

The tab renders with its label count matching the row list (state the window predicate and confirm `getNewBillsThisWeekCount` count === rows returned); collapsed metric is time-since-intro; expand reuses the shared row with no fork; preview + N-more works; `EXPLAIN` confirms the list query rides `idx_bills_introduced_date`. Build clean.
