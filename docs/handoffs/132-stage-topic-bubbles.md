# HO 132 — Stage + Topic Bubble Charts (Dashboard Row 2 + Quadrant Restructure)

## Context

Reshape the main dashboard. Three moves bundled because they're entangled — the quadrant tab structure changes to accommodate the bubble row.

**Final layout:**

```
ROW 1:
┌────────────────────────┬─────────────────────────┐
│ BREAKING               │ ACTIVITY · TOP STALLS   │
│ (no tabs, single view) │ (2 tabs)                │
└────────────────────────┴─────────────────────────┘

ROW 2:
┌────────────────────────┬─────────────────────────┐
│ STAGE DISTRIBUTION     │ TOPIC DISTRIBUTION      │
│ (6 bubbles)            │ (24 bubbles)            │
└────────────────────────┴─────────────────────────┘
```

**Moves:**
1. STAGE DIST tab leaves the BREAKING quadrant (already removed from row 1; reborn as bubble chart in row 2 left)
2. TOP STALLS tab leaves the BREAKING quadrant, joins ACTIVITY quadrant as a sibling tab (ACTIVITY default, TOP STALLS second)
3. BREAKING quadrant becomes single-view (no tab strip — just BREAKING content)
4. Existing TOPIC DISTRIBUTION bar chart (full-width row 2) → replaced with bubble chart, now right half of row 2

**Prior art:**
- HO 128 `/patterns` bubble cluster — established the `d3-hierarchy` + hand-rolled SVG pattern. This handoff reuses it.
- Topic color tokens in `lib/topic-colors.ts`
- Stage color tokens via `--stage-*` CSS vars + `STAGE_LABELS` from `lib/enums`

This is multi-layer (component refactor + new component + data layer + layout). Phase 1 diagnostic first per the discipline.

---

## Phase 1 — Diagnostic (no commits)

Read actual artifacts and post findings. Do not write code beyond ad-hoc queries.

### Required reads

1. **`components/BreakingStallsTabs.tsx`** — current tab structure (BREAKING / TOP STALLS / STAGE DIST after the HO 134 COLOR KEY removal). Report which content each tab renders and confirm what needs to be excised when BREAKING becomes single-view.

2. **`app/page.tsx`** — locate where the BREAKING quadrant and the ACTIVITY component mount. Report the current row 1 grid + row 2 (current bar chart).

3. **ACTIVITY component path** — locate the existing activity ticker on row 1 right. Report its current props and whether it has any tab infrastructure or whether tabs need to be introduced fresh.

4. **TOP STALLS source** — wherever TOP STALLS data is queried + rendered, identify the component(s) so they can be lifted into the ACTIVITY quadrant.

5. **TOPIC DISTRIBUTION bar chart** — locate the existing component on row 2. Report data source (`getTopicCounts()` or similar) and where the bar chart lives. It's being replaced wholesale.

6. **STAGE counts source** — find the query that powers the existing STAGE DIST tab. Reuse for the bubble chart.

7. **`d3-hierarchy` in `package.json`** — confirm it's already a dependency from HO 128.

8. **Topic and stage color tokens** — confirm `lib/topic-colors.ts` exports a usable mapping for all 24 topics, and that `--stage-*` CSS vars cover all 6 stages.

### Queries to run against production Turso

Post raw output. No interpretation.

```sql
-- Stage distribution (non-ceremonial bills)
SELECT stage, COUNT(*) AS n
FROM bills
WHERE is_ceremonial = 0
GROUP BY stage
ORDER BY n DESC;

-- Topic distribution (non-ceremonial bills, matching the current bar chart logic)
SELECT topic, COUNT(*) AS n
FROM bills
WHERE is_ceremonial = 0
GROUP BY topic
ORDER BY n DESC;
```

### Proposals to post (each gets a pick)

1. **Sizing scheme.** sqrt(count) for area-faithful encoding (matches HO 128). Linear over-emphasizes the largest bubble (likely GOV for topics). Recommend sqrt.

2. **Click behavior.** Each bubble links to a filtered view:
   - Stage bubble → `/feed?stage=<slug>` (confirm the filter param exists on /feed)
   - Topic bubble → `/feed?topic=<slug>` (same check)
   - If those filter params don't exist on /feed, fallback is no click — bubbles are display-only. Phase 1 confirms this.

3. **Bubble label.** Centered text inside the bubble showing the slug (uppercase, monospace) + count. For small bubbles where label doesn't fit, drop the count and keep slug only. Smallest bubbles get tooltip on hover instead.

4. **Empty / zero-count bubbles.** Render at minimum radius (~12px) with reduced opacity. No tooltip if count = 0; click does nothing.

5. **Component shape.** One reusable `<DashboardBubbleChart />` component with props `{ data: { id, label, count, color }[], onSelectHref?: (id) => string, height?: number }`. Used twice — once for stage, once for topic.

6. **Layout column proportions.** Row 1 split: BREAKING ~50%, ACTIVITY/STALLS ~50%. Row 2 split: STAGE ~50%, TOPIC ~50%. Both row gaps match the existing dashboard grid gap.

7. **BREAKING quadrant tab strip.** Two choices when only one tab remains:
   - Drop the tab UI entirely, render BREAKING content directly with section header `BREAKING (N)` at top
   - Keep the tab UI with just BREAKING active (no real navigation, but visually consistent with row 1 right)
   - Recommend drop the UI. Single-tab nav is design noise.

8. **ACTIVITY quadrant tabs.** Mirror the styling pattern from the original BreakingStallsTabs (same uppercase, same active treatment). Default tab: ACTIVITY. Second tab: TOP STALLS (lift the current content).

### HALT

End Phase 1 with: query outputs, proposals 1–8 with picks, and any concerns about lifting TOP STALLS into ACTIVITY (data flow, queries, prop shape). Wait for sign-off before Phase 2.

---

## Phase 2 — Implementation (after sign-off)

### Step 1 — Quadrant restructure (commit A)

- Refactor `BreakingStallsTabs.tsx` or replace with a leaner `BreakingBlock` component per Phase 1 proposal 7. If keeping the file name, drop the TOP STALLS and STAGE DIST tab content; surface BREAKING content directly with a section header.
- Refactor the ACTIVITY component into a tab-bearing variant. New tab structure: ACTIVITY (default) / TOP STALLS. Lift TOP STALLS content from the old quadrant. Tab styling per Phase 1 proposal 8.
- Adjust `app/page.tsx` row 1 grid if needed.

Verify row 1 reads clean before moving to step 2.

### Step 2 — Bubble chart component (commit B)

Build `components/DashboardBubbleChart.tsx`. Server component for data fetch, client island for the optional click handler.

- Sized by `d3-hierarchy` pack layout
- Fill color per data point
- Hover: stroke `--accent-amber`, cursor pointer
- Click (if `onSelectHref` provided): `router.push(href, { scroll: false })`
- Centered label per Phase 1 proposal 3
- Min radius for zero-count bubbles per proposal 4

CSS pattern follows HO 128's `.pattern-bubble-svg` rules. New classes: `.dashboard-bubble-svg`, same transitions and hover stroke.

### Step 3 — Wire into dashboard (commit C)

- Add row 2 grid: 2 columns, same gap as row 1
- Mount `<DashboardBubbleChart data={stageData} />` on the left, `<DashboardBubbleChart data={topicData} />` on the right
- Delete the existing TOPIC DISTRIBUTION bar chart component and its mount
- Adjust home page CSS as needed for the new row 2

Each chart should fit within the row height comfortably. If 480px (HO 128's reference height) feels too tall in a 2-column layout, drop to ~360px.

---

## Phase 3 — Verification

- Row 1: BREAKING reads clean without tab chrome; ACTIVITY shows 2 tabs (ACTIVITY default, TOP STALLS reachable)
- Row 2: stage bubbles on left, topic bubbles on right, both sized correctly per sqrt(count)
- Hover on any bubble: amber stroke, cursor pointer
- Click on a bubble (if href wired): URL updates correctly
- No console errors
- Type-check clean
- Layout reads clean at 1920×1080 and 2560×1440
- Existing TOPIC DISTRIBUTION bar chart fully removed (no dead component file, no dead CSS)
- No regression on `/` snapshot tour (BREAKING content visible, ACTIVITY content visible, COLOR KEY strip still in place from HO 134)

---

## Don't

- Don't add Recharts / Chart.js / Plotly. `d3-hierarchy` is math-only and stays the only viz dep.
- Don't fork the bubble component between stage and topic. One component, used twice.
- Don't preserve the old bar chart "for now." It's superseded by the topic bubble chart; remove cleanly.
- Don't animate bubble entry/exit. Static layout, hover stroke only.
- Don't add the bubble charts to any page other than `/`. `/patterns` already has its own.
- Don't change the `bills` table schema or add new columns. All data already exists.

## Acceptance

1. Phase 1 diagnostic posted with all 8 proposals + query outputs
2. Sign-off on every proposal
3. Three commits per Phase 2 step structure
4. Type-check clean, working tree clean, pushed
5. SKILL.md updated under `### Pages` for `/` if the snapshot tour description changed
6. Commit messages:
   - Phase 1: no commit
   - Step 1: `refactor(home): restructure row 1 quadrants — BREAKING single-view, ACTIVITY + STALLS tabs (HO 132 step 1)`
   - Step 2: `feat(home): DashboardBubbleChart component using d3-hierarchy (HO 132 step 2)`
   - Step 3: `feat(home): stage + topic bubble charts replace TOPIC bar chart on row 2 (HO 132 step 3)`

read docs/handoffs/132-stage-topic-bubbles.md and follow
