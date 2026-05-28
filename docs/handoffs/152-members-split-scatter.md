# 152 — Members split + readable scatter (spec 7)

## What this is

Spec 7 (#8 + #9) from the design session: the members page reorganizes into a filter bar → two side-by-side scatter regions (HOUSE left, SENATE right) → a ranked, paginated member list. The scatter keeps its form but gets readable — log x-axis, zoomed y, dot opacity, outlier-only labels, hover tooltips. Member rows gain the accordion expand pattern.

This reuses three things from earlier in the batch: the `SegmentedToggle` (HO 151) for the chamber and metric toggles, the `Tooltip` primitive (HO 147) for the scatter dot hovers, and the click-to-expand idiom (HO 148) for the member rows. It reorganizes layout and fixes the chart — it does not rebuild the members data layer, which already has chamber/party/state filters and the ranked list.

The confirmed call from planning: the scatter y-axis zooms to 0-30% (where the data lives) with an out-of-range marker for the rare high-passer.

## Phase 1 — Diagnostic (HALT for sign-off)

Read real artifacts, post findings, stop.

### A. Current members page

Read the members page (confirm the path — HO 89 renamed it; likely `app/members/page.tsx`). Report the current layout: the filter bar (which filters exist — search, chamber, party, state?), the ranked list row shape, where the existing scatter sits, and the page's URL params. Map current to spec 7's target (filter bar → two scatters → list).

### B. Current scatter component

Read the existing sponsor productivity scatter (HO 67 / HO 36 lineage). Report:

- Library/approach — confirm it's the hand-rolled SVG idiom (per HO 66/99), not Recharts.
- Current axes: is x (bills sponsored) linear today? Is y (pass rate) 0-100%?
- Dot rendering, current opacity, any existing labels or tooltips.
- Whether it currently renders all members in one chart or is already chamber-aware.

Map current → spec 7 target: log x-axis, y zoomed to 0-30% with outlier marker above, ~0.7 dot opacity, outlier-only labels, HO 147 tooltip on every dot (name · bills · pass rate · enacted).

### C. House/Senate split

Confirm the member query returns chamber so the page can render two scatters, one per chamber, each filtered to its members. Splitting halves the dot density per chart (part of the readability fix). Report whether this is a query filter or needs a chamber field added.

### D. Member-row expand (needs a decision)

Spec 7 says member rows use the expand chevron "(#5 pattern)" but doesn't define the expanded panel. Propose its content, reusing the HO 148 lazy-load shape (instant content from the list query, deeper data fetched on first open). Candidate sections, all from existing data:

- Committee assignments (`getMemberCommittees`, HO 145)
- Caucus badges (HO 61)
- A few top sponsored bills or the sponsor stats already in the row
- Last notable vote (HO 79/80) if cheaply available
- A `full profile →` chip to the member hub

Report what's cheaply available and recommend a panel composition. If the member hub already covers all of it one click away, a lean panel (committees + badges + profile chip) may be enough — don't rebuild the hub inside the row. Recommend the cut.

### E. Metric toggle (VOLUME | PASS RATE)

Spec 7 puts a metric toggle in the filter bar, but the scatter axes are fixed (x = volume, y = pass rate always). So the toggle must drive the *list*: rank by volume vs by pass rate, and likely which value the row's bar visualizes. Confirm that reading and report how the list currently ranks. Reuse `SegmentedToggle`.

### F. Data-quality badge (confirm source or defer)

Spec 7 mentions a "data-quality flag badge (N issues) where present" on member rows. Report whether any data-quality signal for members exists today (incomplete stats, bioguide/YAML mismatches like the "no committee assignments on file" case from HO 145, missing bio, etc.). If a concrete source exists, scope the badge to it. **If there's no existing data-quality concept, do not invent one here** — flag it and defer to its own handoff. A layout/chart handoff shouldn't grow a data-quality subsystem.

### G. Reuse confirmations

Confirm `SegmentedToggle` (HO 151) takes the chamber + metric toggles cleanly, the `Tooltip` data/term variant (HO 147) works for SVG dot hovers, and the accordion pattern (HO 148) generalizes to member rows (it was built around `BillRowList`; report whether the single-open list-state pattern is extractable or needs a member-specific `MemberRowList`).

### Report format

1. Current members page + param map.
2. Scatter current → target mapping.
3. House/Senate split feasibility.
4. Member-row expand panel composition recommendation.
5. Metric toggle behavior + current list ranking.
6. Data-quality badge: source found, or defer recommendation.
7. Reuse confirmations + whether a `MemberRowList` is needed.
8. Proposed Phase 2 scope: files, component shape, query changes (expected: none to the data layer).

### HALT. Wait for sign-off.

## Phase 2 — Implementation (after sign-off)

Per spec 7 and the Phase 1 findings:

### Filter bar

Search · chamber toggle (ALL | HOUSE | SENATE, drives the list) · party · state · metric toggle (VOLUME | PASS RATE). Mono chips, toggles via `SegmentedToggle`, active `--accent-amber-bright` on `--bg-row-hover`.

### Two scatters, side by side

HOUSE (left) · SENATE (right), same chart form. Per chart:
- x = bills sponsored, **log scale** (the key readability fix).
- y = pass rate, zoomed to 0-30%, with an out-of-range marker for dots above 30%.
- ~0.7 dot opacity so density reads.
- Party-colored dots.
- Labels on outliers only (top sponsors, dots far from the pack); everything else carries an HO 147 tooltip (name · bills · pass rate · enacted).

### Ranked member list

Below the scatters. Ranked per the active metric, cut to a top slice (~15), paginated. Each row: expand chevron (accordion), rank, name, party-colored volume bar, count, pass %, enacted/sponsored. Data-quality badge only if Phase 1 found a real source.

### Expand panel

Per Phase 1's composition, lazy-loaded on first open like the HO 148 bill panel. Single-open.

## Out of scope

- Rebuilding the members data layer (chamber/party/state filters, the ranked query). Reorganize and fix; don't rebuild.
- Swapping the scatter for a different chart type. Spec 7 is explicit: keep the scatter, make it readable.
- Inventing a data-quality system. Badge only against an existing source; otherwise deferred.
- The member hub (`/member/[bioguideId]`) layout. The expand links to it; it isn't redesigned here.
- Mobile (side-by-side → stacked/tabbed). Deferred to the #15 pass.
- New tokens or motion beyond the existing cursor/chevron.

## Acceptance

1. Phase 1 report posted with all eight sections; expand-panel composition and data-quality badge disposition signed off before Phase 2.
2. Members page renders filter bar → two side-by-side scatters → ranked paginated list.
3. Scatter: log x, y zoomed to 0-30% with outlier markers, ~0.7 opacity, outlier-only labels, tooltips on all dots.
4. HOUSE and SENATE scatters each show only their chamber's members.
5. Chamber and metric toggles use `SegmentedToggle`; metric drives list ranking.
6. Member rows expand (single-open) with the Phase 1 panel composition, lazy-loaded.
7. Data-quality badge present only if a real source exists; otherwise cleanly absent and deferred.
8. `npm run typecheck` and `npm run build` clean.
9. `SKILL.md` updated: members layout, the readable-scatter spec, the metric toggle, member-row expand, and any `MemberRowList` extraction.
10. Single commit: `feat: members split + readable scatter (HO 152)`.

## Notes

- **Why log-x is the fix, not a new chart.** Congressional sponsorship is power-law: a few members sponsor hundreds of bills, most sponsor a handful. Linear x crushes everyone into the left edge. Log x spreads that pile-up so the bulk of members become distinguishable, which is the whole readability complaint. Spec 7 is explicit about keeping the scatter — the readability comes from the scale and the chamber split, not a chart-type change.
- **Why y zooms to 0-30%.** Pass rates are mostly single digits; a 0-100% axis wastes 70% of the height and bands every dot at the bottom. Zooming to where the data lives, with a marker for the rare high-passer, matches the log-x move — both put the resolution where the points actually are.
- **The expand-panel cut matters.** The member hub already exists one click away. The row expand should be a quick peek (committees, badges, a profile chip), not a hub reimplementation. Over-stuffing it duplicates the hub and slows the list. Lean is right.
- **Data-quality badge is a trap if there's no source.** It reads as a small feature but a real "N issues" system means defining what an issue is, computing it, storing it. That's its own handoff. If Phase 1 finds no existing signal, the badge waits — shipping the layout + chart without it is the correct scope.
- **MemberRowList vs BillRowList.** HO 148's single-open state lives in `BillRowList`. If that state machine is extractable to a shared hook, both lists use it; if not, a parallel `MemberRowList` is fine. Phase 1 reports which keeps the code cleaner.
