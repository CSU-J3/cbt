# HO 320 — Restore distributions click-to-filter on the dashboard (port from classic)

Confirm the next free number before saving: `ls docs/handoffs/ | sort -V | tail`. Body assumes 320. Independent of 319.

Not a bug — a deferred port. The HO 311 v2 swap rendered the STAGE/TOPIC distributions in `staticMode` on `/` and dropped the `?stage=` / `?topics=` click-to-filter. On the old dashboard (still live at `/dashboard-classic`), clicking a stage bar or topic tile rebased the **MOVERS feed and BREAKING** to that slice, with an `ActiveFilterStrip` + `× CLEAR`. SKILL flags this as an open loop ("porting it into this composition is a future handoff"). This restores it on v2.

**Classic is the working reference.** Every piece exists there — interactive `StageFunnel` / `DashboardTopicTreemap`, the `getStageChanges` `DashboardFilters` 4th arg, the breaking rebase, `ActiveFilterStrip`. Diff `/dashboard-classic` against `/` to see exactly what's missing. This is wiring existing machinery into the v2 composition, not building new.

## Verify first

- Confirm the `staticMode` decision in HO 311 was a **time deferral**, not a v2-layout constraint (no room for `ActiveFilterStrip`, state conflict, etc.). If it was a layout reason, surface it before wiring.
- Confirm which queries/components already accept the filter vs need it threaded:
  - `getStageDistribution(filters)` / `getTopicDistribution(filters)` — filter args exist (SKILL).
  - `getStageChanges(filters, days, limit, dashboard?)` — the 4th `DashboardFilters` arg exists; the v2 MOVERS (`ActivityTicker variant="v2"` → `V2FeedList`) needs to pass it.
  - **BREAKING in v2 is `BreakingNewsBlock`**, not classic's `BreakingRow`. Confirm it can consume a stage/topic filter or wire it.
  - `StageFunnel` / `DashboardTopicTreemap` — the interactive (non-static) variant lives on classic.

## Build

- **`app/page.tsx` (v2):** `await searchParams`, sanitize `?stage=` / `?topics=` (reuse classic's sanitizers), thread the resulting `DashboardFilters` into the distribution queries, the MOVERS feed, and BREAKING. (Already `force-dynamic`, so reading searchParams adds no cost.)
- **Funnel + treemap:** switch from `staticMode` to the classic interactive variant — `router.push(?stage=/?topics=, { scroll: false })` on click, selected/dimmed state, pointer cursor restored, `.is-static` dropped. The cross-rebase from classic holds: the topic treemap rebases when STAGE is selected; the funnel rebases when TOPIC is selected.
- **Rebase MOVERS + BREAKING** to the active filter (classic parity).
- **`ActiveFilterStrip`:** show the active filter with `× CLEAR` + `VIEW IN /bills →`, classic's component.

## Decide by report

Classic rebased MOVERS + BREAKING. v2 has three feed tabs (MOVERS / TOP STALLS / NEW THIS WEEK).
- **Floor (required):** MOVERS + BREAKING rebase — classic parity.
- Extend the filter to TOP STALLS + NEW THIS WEEK **only if** their queries accept `DashboardFilters` cleanly. If they don't, leave those two unfiltered and report it — don't build new query plumbing for them this pass.

## Constraints

- Reuse classic's machinery; don't rebuild it. `/dashboard-classic` stays exactly as-is (the reference + undo surface).
- No new CSS variables; reuse tokens.
- Named `git add`, eyeball the diff. Stale `.next`: stylesheet loads (no 404 on `layout.css`), `rm -rf .next` + restart if the dev server's been up a while. `npm run build` clean.
- Ship: `git push`, then `npm run verify:deploy` until served SHA === HEAD.

## Ship report

- Clicking a STAGE bar / TOPIC tile on `/` filters MOVERS + BREAKING — name the stage you clicked and what filtered.
- Funnel/treemap show selected/dimmed state and the pointer cursor; the cross-rebase fires (select a stage → treemap rebases; select a topic → funnel rebases).
- `ActiveFilterStrip` + `× CLEAR` + `VIEW IN /bills →` work.
- Which other tabs rebase (TOP STALLS / NEW THIS WEEK) or were left, and why.
- Confirm this closes the SKILL open loop (distributions click-to-filter ported to v2).
- Build clean; verify:deploy SHA matches.
