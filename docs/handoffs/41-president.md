# Handoff 41: /president

## Goal

New `/president` page surfacing bills with `stage = 'president'`. Mirrors the `/stale` pattern: filtered subset, dedicated page, reuses feed components.

## Decisions

- **Sort:** `latest_action_date ASC` (oldest at desk first — closest to the 10-day veto deadline).
- **Days-at-desk column:** mirror staleness on `/stale`. Right-aligned `Nd` in the action column, gated by a new `showDaysAtDesk?: boolean` prop on `BillRow` (default false). Compute via the existing `daysSince` helper in `lib/format.ts`. Color thresholds:
  - `<5d` → `var(--text-secondary)`
  - `5–9d` → `var(--accent-amber)`
  - `≥10d` → `var(--party-republican)` (overdue or misclassified — worth flagging visually)
- **No stage filter dropdown** — everything is `stage = 'president'` by definition. Drop it, don't disable it.
- **Topic filter and search** persist via `basePath="/president"`, threaded the same way `/stale` does.
- **Header count chrome:** label reads `BILLS AT DESK`, numerator is the count.
- **Empty state:** single muted line — `No bills currently awaiting presidential action.` — no chrome.
- **Subtitle:** `oldest at desk first` in `--text-muted`, parallel to `/stale`'s `no action in 60+ days`.
- **Nav link label:** `▸▸▸▸ President`, echoing the stage indicator already defined in the design system. Active-state coloring matches the existing `⏳ Stale` link.

## Verify first

Before writing UI code, confirm rows exist and look right:

```sql
SELECT COUNT(*) FROM bills WHERE stage = 'president';
SELECT id, title, latest_action_date, latest_action_text
FROM bills WHERE stage = 'president'
ORDER BY latest_action_date DESC LIMIT 10;
```

If count is 0, or the spot-check rows look misclassified (already enacted, vetoed, or never actually presented), flag back before building. The page is pointless without rows, and a misclassification problem is a summarizer issue, not a UI issue.

## Files to touch

- `app/president/page.tsx` — new server component, mirror of `app/stale/page.tsx`. `Promise.all` for `getPresidentBills` + `getPresidentCount`. Passes `basePath="/president"` and `showDaysAtDesk` to `BillRow`. No `<StageFilter>`.
- `lib/queries.ts` — add `getPresidentBills`, `getPresidentCount`, and a `buildPresidentWhere` helper that composes on top of `buildFeedWhere`. Filter is `stage = 'president'`.
- `components/BillRow.tsx` — add `showDaysAtDesk?: boolean` prop. When true, render the days-at-desk column with the three-tier coloring above. Additive to `showStaleness`, not coupled — the two props are independent and `/president` only sets `showDaysAtDesk`.
- `components/HeaderBar.tsx` — add the `▸▸▸▸ President` nav link with active-state coloring. Extend `countMode` to `"feed" | "stale" | "president"` and accept a new `presidentCounts` prop.
- `.claude/skills/cbt/SKILL.md` — document `/president` in Pages, the new query helpers under Sync logic, and the days-at-desk column with its color thresholds.

## Acceptance

- `/president` returns bills with `stage = 'president'`, oldest action first.
- Each row shows `Nd` in the action column with the three-tier coloring.
- `?topic=…` and `?q=…` persist on `/president`.
- Header nav has a President link with correct active-state coloring.
- Empty state renders a single muted line, no chrome.
- `npm run build` is clean. No typecheck errors.

## What not to do

- Don't add a stage filter dropdown to this page.
- Don't add new sync logic, schema columns, or LLM prompt changes.
- Don't parse `latest_action_text` to compute the exact veto deadline. Trust the LLM-classified `stage` and use `latest_action_date` as the desk-arrival proxy.
- Don't touch the home feed, `/stale`, or `/sponsors`.
- Don't change `BillRow`'s default behavior. `showDaysAtDesk` must be opt-in.
