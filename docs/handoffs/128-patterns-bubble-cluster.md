# 128 — /patterns bubble cluster (Frame 1)

## What this is

Translate the AlienVault/LevelBlue OTX "Visualization of Malware Clusters" idiom to `/patterns`. Today the page is a five-row table (cluster name · count · example, per HO 51, renamed from `/templates` in HO 114). Frame 1 of the Claude Design brief converts it into a packed-circle visualization with click-to-select drill-in.

This continues the design-language pivot from HO 125 (BillRow), 126 (home reorganization), 127 (quick-watch). Frame 3 (`/search` tabs) is the sibling.

Multi-layer change: new query helpers, new SVG component, selection state, layout restructure. Phase 1 diagnostic precedes any implementation per the discipline. Phase 1 reads the actual schema, queries actual cluster data, audits the live page, and proposes the visual encoding and selection-panel shape before Phase 2 commits any code.

## Prior art

- **HO 51** — similarity v1, defined `cluster_id` column on `bills`, `CLUSTER_PATTERNS` source-of-truth file, `/clusters` index page, `?cluster=<slug>` filter convention
- **HO 52** — cluster regex calibration (facility-naming, awareness-designation thresholds)
- **HO 114** — `/templates` → `/patterns` route rename (UI-only, internal naming may still be `cluster_*`)
- **HO 53** — dashboard shell, established hand-rolled SVG idiom (no Recharts/D3 rendering)
- **HO 81** — stage funnel, reference for the existing SVG component pattern
- **HO 74** — activity-by-topic chart, latest hand-rolled SVG with `--topic-*` color tokens

## In scope

- Phase 1 diagnostic — schema confirm, count audit, encoding proposal, layout proposal
- Phase 2 — packed-circle SVG component, default-state rendering, hover state
- Phase 3 — click-to-select drill-in: sub-panel under the cluster + recent-bills column on the right

## Out of scope

- Renaming any internal `cluster_*` columns or helpers (route rename was UI-only per HO 114; the schema stays)
- Adding a sixth cluster pattern (calibration handoff territory)
- `/bill/[id]/similar` page (HO 51 deferred to embedding-based v2)
- A topic-axis variant of the bubble cluster (the existing topic-mix chart already serves that cut)
- Mobile-first redesign of `/patterns` — desktop ships first, mobile follow-up if the layout breaks
- Animating bubble entry/exit transitions
- Bills-as-inner-circles inside each cluster (defer; v1 is one circle per pattern)

## Phase 1 — Diagnostic (no commits)

Read actual artifacts and post findings to chat. Do not write code beyond ad-hoc queries.

### Required reads

1. **Schema** — `bills.cluster_id` column, current index coverage, NULL count
2. **`lib/clusters.ts` (or wherever `CLUSTER_PATTERNS` lives)** — confirm full pattern list as of today
3. **`app/patterns/page.tsx`** — confirm current render (rows, count line, header chrome)
4. **`lib/queries.ts`** — confirm `getClusterStats()` shape and existing cache tags

### Queries to run against production Turso

Post the raw output for each. No interpretation, just numbers.

```sql
-- Per-cluster counts
SELECT cluster_id, COUNT(*) AS n
FROM bills
WHERE cluster_id IS NOT NULL
GROUP BY cluster_id
ORDER BY n DESC;

-- Ceremonial ratio per cluster
SELECT cluster_id,
       COUNT(*) AS total,
       SUM(CASE WHEN is_ceremonial = 1 THEN 1 ELSE 0 END) AS ceremonial,
       ROUND(100.0 * SUM(CASE WHEN is_ceremonial = 1 THEN 1 ELSE 0 END) / COUNT(*), 1) AS ceremonial_pct
FROM bills
WHERE cluster_id IS NOT NULL
GROUP BY cluster_id
ORDER BY total DESC;

-- Stage mix per cluster
SELECT cluster_id, stage, COUNT(*) AS n
FROM bills
WHERE cluster_id IS NOT NULL
GROUP BY cluster_id, stage
ORDER BY cluster_id, n DESC;

-- Top 5 sponsors per cluster (preview, will be reused in Phase 3 selection panel)
SELECT cluster_id, sponsor_name, sponsor_party, COUNT(*) AS n
FROM bills
WHERE cluster_id = 'facility-naming'
GROUP BY sponsor_name
ORDER BY n DESC
LIMIT 5;

-- Unmatched count
SELECT COUNT(*) AS unmatched FROM bills WHERE cluster_id IS NULL;
```

### Proposals to post

Each gets a recommendation plus an alternative. Sign-off picks one per item.

1. **Bubble sizing.** Linear vs sqrt scaling. Sqrt is standard for circle-packing because area perceives count better than radius; linear over-emphasizes the largest cluster (likely facility-naming). Recommend sqrt.

2. **Color encoding.** Three candidates, pick the one most analytically useful:
   - (a) **Ceremonial ratio** — gradient from `--stage-enacted` (substantive) to `--party-republican` (ceremonial). Maps to the green→red of the OTX original. Best signal for the noise lens but most clusters will trend red.
   - (b) **Stage progression** — gradient by `% past introduced`. Surfaces which pattern shapes actually move.
   - (c) **Dominant topic** — color by the most common topic within each cluster, using `lib/topic-colors.ts`. Most visually varied but least analytically tight (most ceremonial patterns are topic-agnostic).
   - Recommend (a) unless the ceremonial query shows a flat distribution.

3. **Selection panel content.** What shows when a bubble is clicked. Candidates:
   - Sub-panel under the cluster: small horizontal-bar chart of top 5 sponsors in that pattern
   - Right column: 8–10 most recent bills in that pattern (compact BillRow variant from HO 125)
   - Header line: `PATTERN: facility-naming · 1,247 bills · 98% ceremonial`
   - Recommend all three.

4. **Selection state.** URL-driven via `?selected=<slug>` (consistent with existing URL state) vs client-only React state. URL wins for shareability and `router.refresh()` integration but adds a query param. Recommend URL.

5. **Layout grid.** Two columns: bubble area on the left (~60% width), recent-bills list on the right (~40%). Sub-panel slides in below the bubble area when selected, same width as the bubble area. Default state (nothing selected): right column shows pattern legend + per-cluster counts as a fallback.

6. **Packing library.** `d3-hierarchy` is pure math, no DOM, ~12KB. Acceptable as a math-only dep. Alternative: hand-roll a circle-packing algorithm (tractable for 5–10 circles). Recommend `d3-hierarchy` for correctness; hand-roll only if dep policy disallows.

7. **Empty / zero-bill clusters.** Render at minimum radius (~12px) with reduced opacity. Click still works, sub-panel shows "no bills match this pattern yet."

### HALT

End Phase 1 with: query outputs, proposals 1–7 with picks, current `/patterns` screenshot description. Wait for sign-off on every numbered item before starting Phase 2.

## Phase 2 — Implementation (after sign-off)

### Query layer

`lib/queries.ts`:

- Extend `getClusterStats()` to return the encoding fields the sign-off picked (ceremonial_pct, dominant_stage, dominant_topic — whichever).
- New `getClusterDrilldown(clusterId)`:
  ```ts
  {
    topSponsors: { name, party, count }[],  // top 5
    recentBills: Bill[],                     // most recent 10, full BillRow shape
    headline: { total, ceremonial_pct, dominant_topic }
  }
  ```
  Cache with `unstable_cache`, tag `bills`, same invalidation as the rest.
- `sanitizeClusterId` already exists from HO 51, reuse.

### Component

`components/PatternBubbleCluster.tsx`. Server component for the data fetch, client island for the click handlers and selection state read from `?selected=`.

Two parts:

1. **`PatternBubbleSVG`** (client). Receives the cluster array + selected slug. Renders one `<g>` per cluster: a `<circle>` sized by sqrt(count), filled by the chosen encoding, plus a `<text>` label centered on the cluster name. Hover state: stroke `--accent-amber`, cursor pointer, slight scale (1.04 via transform). Click: `router.push('/patterns?selected=' + slug, { scroll: false })`. Re-click on selected bubble: clear the param.

2. **`PatternLegend`** (server). Below the SVG, a horizontal strip explaining the color scale: `SUBSTANTIVE — CEREMONIAL` with a gradient swatch (or whatever Phase 1 picks). Same 11px uppercase styling as `FooterLegend`.

### Layout

`app/patterns/page.tsx` becomes a two-column grid:

```css
.patterns-layout {
  display: grid;
  grid-template-columns: minmax(0, 1.5fr) minmax(320px, 1fr);
  gap: 24px;
  padding: 16px 24px;
}
```

Left column: `PatternBubbleSVG` (height: 480px), `PatternLegend` below it, then `PatternDrilldownPanel` below the legend when `?selected=` is set.

Right column: when nothing is selected, show a static "click a pattern to drill in" hint + the existing `getClusterStats` table (preserves the data the current page already shows, as a fallback view). When `?selected=` is set, render the top-10 recent-bills list using a compact BillRow variant.

Header chrome stays `BILL PATTERNS`. Count line stays `N patterns · X bills matched · Y unmatched`.

### CSS

Add to `globals.css`:

```css
.pattern-bubble-svg { width: 100%; height: 480px; display: block; }
.pattern-bubble-svg circle { transition: transform 120ms ease, stroke 120ms ease; cursor: pointer; }
.pattern-bubble-svg circle:hover { stroke: var(--accent-amber); stroke-width: 2; }
.pattern-bubble-svg circle.selected { stroke: var(--accent-amber-bright); stroke-width: 2.5; }
.pattern-bubble-svg text { font-size: 11px; fill: var(--text-primary); letter-spacing: 0.5px; pointer-events: none; }
.pattern-legend { display: flex; gap: 16px; align-items: center; font-size: 11px; letter-spacing: 0.5px; color: var(--text-muted); margin-top: 12px; padding: 0 8px; }
.pattern-legend .gradient { width: 120px; height: 8px; border-radius: 4px; }
.pattern-drilldown { margin-top: 24px; border-top: 1px solid var(--border-strong); padding-top: 16px; }
.pattern-recent-bills { display: flex; flex-direction: column; gap: 4px; }
```

### Verification

1. `/patterns` renders the SVG with one bubble per cluster, sized by count, colored per Phase 1 encoding.
2. Hover on any bubble shows amber stroke + cursor pointer.
3. Click bubble → URL updates to `/patterns?selected=<slug>`, sub-panel appears under the SVG, right column populates with recent bills.
4. Click selected bubble again → URL drops the param, default state returns.
5. Legend renders below the SVG explaining the color scale.
6. Header chrome reads `BILL PATTERNS`, count line correct.
7. Type-check clean, working tree ready to commit, no console errors on the live page.
8. Mobile: at < 700px, the two columns collapse to single-column stack. Bubble SVG keeps full width, sub-panel below, recent-bills below that.

## Phase 3 — Click-through wiring (bundled into Phase 2 if scope holds)

Currently `/?cluster=<slug>` already filters the home feed (HO 51). Add a "VIEW ALL N BILLS IN FEED →" link inside `PatternDrilldownPanel` linking to `/?cluster=<slug>`. Cheap addition, completes the drill-out path.

If Phase 2 scope already feels heavy at commit time, split this into HO 128.1.

## Acceptance

1. Phase 1 diagnostic posted in chat with all seven proposals plus query outputs
2. Sign-off received on every numbered proposal
3. Phase 2 implementation per the signed-off spec
4. `/patterns` no longer renders as a five-row table — it's the bubble cluster + right column + drill-in
5. The legacy `getClusterStats` table view survives only as the right-column fallback when nothing is selected (so the data already on the page isn't lost)
6. Type-check clean, working tree clean, pushed
7. SKILL.md updated under the `/patterns` line in `### Pages` to reflect the new render
8. Commit messages:
   - Phase 1 ends with no commit (diagnostic only)
   - Phase 2: `feat(patterns): bubble cluster visualization with click-to-select (HO 128)`

## Don't

- Don't drop Recharts / Chart.js / Plotly into the bundle. `d3-hierarchy` is math-only and acceptable; the rendering stays hand-rolled SVG.
- Don't rename `cluster_id` or any internal `cluster_*` column. HO 114 was UI-only.
- Don't add the new component to home page. `/patterns` is its only surface.
- Don't introduce a `clusters` table or a second pattern store. `CLUSTER_PATTERNS` in source stays the truth.
- Don't gate Phase 2 on prettier transitions. v1 is correct rendering, hover, and click-select. Animation polish lives in a follow-up if it's worth one.
- Don't preserve the old table layout. It's superseded by the new design, kept only as the right-column fallback for the empty-selection state.

## Notes

- The OTX original colors malware clusters by severity (green→red). The CBT analog is the noise-vs-signal lens from the roadmap's framing question. Whatever encoding wins Phase 1, the legend should make that lens explicit — what someone learns at a glance is what the color *means*.
- 5–7 large circles on a 480px-tall canvas may feel sparse compared to the OTX viz, which packs hundreds. Accept the sparseness. Adding inner bills-as-dots is a v2 if and only if the v1 ships and the page feels underweight.
- Right-column compact BillRow already exists from HO 125 (`ActivityTicker` variant). Reuse, don't fork.

read docs/handoffs/128-patterns-bubble-cluster.md and follow
