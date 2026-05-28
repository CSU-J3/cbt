# 146 — Committees, Phase 3: detail-page charts

## What this is

The depth pass on `/committee/[systemCode]`. HO 143 landed the data, HO 144 shipped the index + minimal detail (members + recent bills), HO 145 cross-linked committees into member and bill pages. This handoff adds the two analytical charts that make the detail page answer "what is this committee actually doing" instead of just listing its last 25 bills.

Two charts, both on the committee detail page, both reusing the existing hand-rolled-SVG idiom from `components/BillsTimeSeries.tsx` and the topic-distribution bars. No chart library, no new visual idiom, no migration. Pure local data off `committee_bills` and `bills`.

**Hearings is NOT in this handoff.** Congress.gov has committee-meeting/hearing data, but it's a new endpoint that hasn't had a liveness check, and shipping against an unverified path is exactly what burned HOs 65 and 70. Hearings gets its own future handoff with a Phase 1 pre-flight against the real endpoint. Same for subcommittee-grouping polish — deferred, noted at the bottom.

## Phase 1 — diagnostic only (HALT for sign-off)

No code, no components, no migration. Read real data, report in chat, stop.

The activity time-series chart has a degeneracy risk: bills are referred to committee in bursts (mostly at introduction), so `committee_bills.activity_date` may cluster at session-start and leave later months near-empty. A monthly stacked bar would then read front-loaded and flat, which is a worse-than-nothing chart. Confirm the data shape before building.

Run and report:

1. **Activity-date distribution.** For a few representative committees (one high-volume like House Energy & Commerce or House Judiciary, one mid-volume, one quiet), bucket `committee_bills.activity_date` by month for the 119th. Report the counts per month per committee. The question Phase 2 needs answered: does monthly bucketing produce a chart with shape, or is it one tall bar at the start? If it's degenerate, recommend the alternative (monthly but capped axis, weekly, or drop the time axis entirely in favor of an activity-type breakdown — see note below).

2. **Activity-type spread.** `SELECT activity_type, COUNT(*) FROM committee_bills GROUP BY activity_type ORDER BY 2 DESC`. Report the real values and their distribution. Phase 2 stacks the time series by `activity_type` (referred vs reported vs discharged tells the throughput story), so we need to know the actual strings and whether the non-"Referred to" types are populated enough to be worth stacking. If 98% of rows are "Referred to," stacking is pointless and the chart becomes a single-series volume bar.

3. **Topic-JOIN coverage.** For the same representative committees, JOIN `committee_bills` → `bills` and report what fraction of a committee's bills carry a non-null, non-ceremonial topic. The topic-distribution chart is only honest if coverage is high. If a committee's bills are mostly untagged or mostly ceremonial, say so — the chart should exclude ceremonial (matching every other surface) and may need a minimum-coverage guard.

4. **Component confirmation.** Open `components/BillsTimeSeries.tsx` and the topic-distribution component (whatever HO 55/76 actually named it — find it). Report their exact file paths, their prop signatures, and whether they're written to be reused with arbitrary data or are hardwired to the home-page query. Phase 2 forks or parameterizes them; which one depends on how they're written. Also confirm the exact committee detail page file path (`app/committee/[systemCode]/page.tsx` per HO 144, verify).

5. **Existing query helpers.** Confirm the shape of `getCommitteeBills(systemCode)` from HO 143/144. Phase 2 needs activity rows with dates and a topic JOIN; if the existing helper doesn't carry topic, name what it returns so Phase 2 extends it cleanly rather than writing a parallel query.

**End Phase 1 here. Post findings in chat. Do not start Phase 2 until sign-off.**

The decision Phase 1 unblocks: time-series bucketing (monthly / weekly / no-time-axis fallback), whether to stack by activity_type or run single-series, and whether topic coverage clears the bar for an honest distribution chart.

## Phase 2 — build (only after sign-off)

Two charts on `app/committee/[systemCode]/page.tsx`, positioned above or beside the existing members + recent-bills sections (exact placement: charts read as the "shape" summary, so they belong near the top of the body, under the header block, before the recent-bills list).

### Chart A — committee activity over time

- New component `components/CommitteeActivityChart.tsx`, server component, hand-rolled SVG, same constants pattern as `BillsTimeSeries.tsx` (CHART_HEIGHT, CHART_PADDING, viewBox 0 0 1000 240).
- Data: `committee_bills` for this `system_code`, bucketed by the cadence Phase 1 picked, counted per bucket.
- Stacking: by `activity_type` if Phase 1 showed meaningful spread; single-series volume bars if not. Use existing color tokens, not new ones. Activity-type colors come from a small local map in the component (3-5 types max), keyed off the real strings Phase 1 reported.
- Y-axis: count. X-axis: time buckets, abbreviated labels matching `BillsTimeSeries` style.
- If Phase 1 found the time axis degenerate and we fell back to an activity-type breakdown, this chart becomes a horizontal bar of counts per activity_type instead. Phase 1's recommendation governs.
- Empty/thin guard: if the committee has fewer than ~5 activity rows, render a muted line ("Not enough activity to chart") rather than a near-empty SVG.

### Chart B — topic distribution within the committee

- New component `components/CommitteeTopicDistribution.tsx`, or parameterize the existing topic-distribution component if Phase 1 found it reusable.
- Data: JOIN `committee_bills` → `bills`, exclude ceremonial, group by topic, count distinct bills (not activity rows — a bill referred + reported shouldn't double-count).
- Horizontal bars, topic colors from `lib/topic-colors.ts`, same as everywhere else.
- Order by count DESC, cap at top ~8 topics with the remainder folded into "Other" if the tail is long.
- Coverage guard from Phase 1: if topic coverage is below the threshold Phase 1 set, render a muted "Topic data sparse for this committee" line instead of a misleading chart.

### Wiring

- Both components read through query helpers in `lib/queries.ts`. Extend `getCommitteeBills` or add `getCommitteeActivityByPeriod(systemCode)` and `getCommitteeTopicMix(systemCode)` — Phase 1's helper-shape finding decides which.
- Cache with `unstable_cache`, tag `'committees'`. The HO 143 sync route already revalidates that tag, so charts refresh when committee data syncs.
- Aggregate in SQL. 22.7k committee_bills rows with the HO 143 indices makes per-committee grouping trivial; no N+1, no JS-side aggregation.

## Out of scope

- **Hearings / committee meetings.** New Congress.gov endpoint, deferred to its own handoff with a Phase 1 liveness check against `/committee-meeting/119` (or whatever the real path is — verify, don't assume).
- **Subcommittee grouping/rollup** on the index or detail (treating parent + subs as a unit). HO 144/145 left flat-list + basic parent links; richer hierarchy is later polish.
- **Hover/tooltip interactions.** Static SVG for v1, matching the existing charts. An idiom-wide hover pass is a separate effort if it ever earns its place across all charts at once.
- **Chamber/party faceting** within a committee's charts. One committee, all its data.
- **Mobile-specific layout.** Per HO 134 backlog, mobile redesign is the consolidated design-project effort, not committee-specific.
- **Backfill or schema changes.** Charts read existing data as-is.

## Acceptance

1. Phase 1 findings posted in chat; bucketing, stacking, and coverage-threshold decisions signed off before any Phase 2 code.
2. `/committee/[systemCode]` for a high-volume committee renders both charts with visible, honest shape.
3. A quiet committee renders the muted guard lines instead of degenerate near-empty charts.
4. Topic chart excludes ceremonial bills and counts distinct bills, not activity rows.
5. Both charts use existing color tokens (`lib/topic-colors.ts` and committee-local activity-type map); no new CSS color vars added.
6. SQL does the aggregation; no per-row fan-out.
7. `npm run build` clean; page static-prerenders unless params force dynamic.
8. `SKILL.md` updated with the two new chart components and any new query helpers.
9. Single commit: `feat: committee detail charts (HO 146)`.

## Notes

- **Why activity-type stacking over topic stacking on the time axis.** The committee-relevant question is throughput: does this committee report bills out, or is it a referral graveyard? Stacking the time series by activity_type answers that. Topic gets its own bar chart because "what subjects does this committee handle" is a separate question with a separate natural shape. Don't merge them into one stacked-by-topic time series — that's two questions crammed into one chart that answers neither well.
- **Why the Phase 1 halt on a no-migration handoff.** Not about schema risk; it's about the time-series being potentially degenerate. Building a front-loaded flat chart and discovering it's useless after the fact is the rework the diagnostic prevents. Cheap to check, saves a wrong build.
- **Distinct-bill counting on the topic chart.** A bill that was referred then reported has two `committee_bills` rows. Counting activity rows would inflate busy committees. Count distinct `bill_id`.
- **Reuse vs fork on components.** If `BillsTimeSeries` is hardwired to the home-page query, forking a committee-specific component is cleaner than contorting it with conditional props. Phase 1 reports which; don't pre-decide.
