# 74 — Activity over time, stacked by topic

## What this is

Roadmap visualization #3 explicitly named in the theme list: a stacked time-series of bills introduced per week, split by topic. Answers "what's Congress been working on lately" at a glance — volume and composition together. Pure read-side work over existing data (`bills.introduced_date`, `bills.topics`, `bills.is_ceremonial`).

## Pre-flight: check what 66 shipped first

Handoff 66 shipped a "time-series chart on home dashboard." Before writing anything, view the component (likely `components/BillsTimeSeries.tsx` or similar based on handoff 72's mention) and check whether it already splits by topic.

Three branches based on what 66 looks like:

- **66 is a single-line action-rate chart with no topic split** → ship this as a second, separate chart. Different question, different answer. Both belong on the dashboard.
- **66 already plots introductions per week as a single line** → extend it in place. Add a `stackByTopic` mode, default off, on when this handoff's needs are present. Don't duplicate the data fetch.
- **66 already does stacked-by-topic** → tell me and stop. This handoff is moot. Don't reimplement.

Flag which branch in the run notes.

## In scope (assuming branches 1 or 2)

- New query helper `getBillsByTopicByWeek(weeks: number)` in `lib/queries.ts`
- New (or extended) chart component for the stacked area visualization
- Top 6 topics + a collapsed "other" bucket for everything else
- Hand-rolled SVG, no charting library — same idiom as stage funnel and the existing time-series
- Placement on the home dashboard
- 12-week default window
- `unstable_cache` tag `bills-by-topic`, revalidate 6h (chart data is daily-fresh, not minute-fresh)

## Out of scope

- Filters (topic, window) on the chart itself. v1 is static.
- Interactive tooltips beyond a basic `<title>` element on each segment for hover discovery.
- 118th-vs-119th comparison overlay. The roadmap calls it out, but we don't have 118th data ingested. Separate handoff if it ever gets prioritized.
- A "drill into a topic" interaction. Click-through is future work.
- Stage-stacked variant. This chart is about topic mix specifically.

## Query

```ts
export type WeekTopicCount = {
  weekStart: string;        // ISO date, Monday of the week
  topic: string;            // canonical topic enum value, or 'other' for collapsed
  count: number;            // bills introduced in that week with that topic
};

export async function getBillsByTopicByWeek(
  weeks: number = 12
): Promise<WeekTopicCount[]>
```

Implementation notes:

- Filter `is_ceremonial = 0` and `introduced_date IS NOT NULL`.
- Window: `introduced_date >= date('now', '-' || ? || ' weeks')`.
- Week bucket: `date(introduced_date, 'weekday 0', '-6 days')` to align to Monday. Verify against libSQL's date function support; the same pattern shows up in the existing time-series query, so reuse whatever 66 did.
- Topic: bills have a JSON array in `topics`. For each bill, count once per topic it carries (so a bill tagged `healthcare` + `taxes` contributes to both rows). The roadmap's framing — "what's getting worked on" — wants the visible-effort signal, not the deduplicated-bill signal.
- Determine the top 6 topics globally (over the full window), then in a second pass collapse anything outside that top-6 into a synthetic `other` row. The 6+1 buckets matches the stage funnel's complexity ceiling.
- Wrap with `unstable_cache(..., ['bills-by-topic', weeks], { tags: ['bills-by-topic'], revalidate: 21600 })`.
- The sync route already invalidates a handful of tags. Add `bills-by-topic` to its `revalidateTag` calls after bill upserts. Add `bills-by-topic` to `ALLOWED_TAGS` in `app/api/revalidate/route.ts`.

If the JSON-column-fanout proves slow on Turso, fall back to fetching every bill in the window and doing the fanout in JS. 12 weeks of bills is at most a few thousand rows — JS can handle it without a perf concern.

## Component

Naming depends on the pre-flight branch:

- Branch 1 (new chart): `components/BillsByTopicChart.tsx`.
- Branch 2 (extended existing): add `stackByTopic?: boolean` prop to whatever component 66 created. Default behavior unchanged. When `stackByTopic` is true, render the stacked-area variant.

Either way, the rendering spec:

### Layout

- SVG width: 100%, height 240px.
- Inner plot area accounts for 24px left padding (y-axis ticks), 16px right, 8px top, 28px bottom (x-axis labels).
- Y-axis: linear from 0 to `ceil(maxStackHeight / 50) * 50`. Three or four tick marks total, drawn as thin horizontal `--border-soft` lines with `--text-muted` 11px labels right-aligned in the left padding.
- X-axis: one label every 2 weeks, formatted `MMM DD` (e.g. `Mar 17`). All 12 weeks have grid positions, only every other gets a label.

### Stack rendering

Each topic is a filled `<path>` element. Stacking order: largest-area topic on the bottom (most prominent baseline), then descending, with `other` on top so the variable-composition bucket reads as the catchall it is.

Color: pull from `lib/topic-colors.ts` — the existing 6-color palette maps cleanly. `other` uses `--text-dim` (the catchall color already defined there).

Each topic's path gets a `<title>` child: `Healthcare · last week: 47 bills` (the most recent week's count is the most analytically valuable hover signal).

### Legend

Below the chart, a single line of compact swatches:

```
■ HLTH  ■ TAX  ■ DEF  ■ ENV  ■ FIN  ■ JUST  ▢ other
```

Use the abbreviations from `lib/topic-colors.ts`. 11px, letter-spacing 0.5px, swatches are 8px squares in the topic color, `other` is hollow (border only).

Don't render the legend inside the SVG. It's a sibling div below, aligned left.

## Placement

On `app/page.tsx`, place the new chart between the existing time-series (handoff 66) and the competitive races block (handoff 72). If branches 1 and 2 both keep 66 in place, the dashboard order becomes:

1. LLM lead
2. Breaking news banner
3. Stage funnel + topic mix
4. Existing time-series (66)
5. **Activity by topic (this handoff)**
6. Competitive races block
7. Anything else

If the dashboard already has a different order that mostly works, drop the chart in without reorganizing.

## CSS

Add to `globals.css`:

```css
.topic-stack-chart {
  width: 100%;
  margin: 8px 0 4px;
}

.topic-stack-chart svg {
  width: 100%;
  height: 240px;
  display: block;
}

.topic-stack-chart .gridline {
  stroke: var(--border-soft);
  stroke-width: 1;
}

.topic-stack-chart .axis-label {
  font-size: 11px;
  fill: var(--text-muted);
  letter-spacing: 0.5px;
}

.topic-stack-legend {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  font-size: 11px;
  letter-spacing: 0.5px;
  color: var(--text-secondary);
  text-transform: uppercase;
  padding: 0 24px 8px;
}

.topic-stack-legend .swatch {
  display: inline-block;
  width: 8px;
  height: 8px;
  margin-right: 4px;
  vertical-align: middle;
}
```

## Verification

1. `/` renders the new chart with 12 weekly stacks visible.
2. Y-axis ticks scale to actual data (not hardcoded at 100).
3. Hovering a stack segment shows the topic name and last-week count.
4. The legend below has 6 colored swatches + 1 hollow `other`.
5. The chart hides cleanly if no bills exist in the window (empty plot area or skip rendering entirely — your call, but no JS crashes).
6. Ceremonial bills don't appear in the counts. Verify by spot-checking: a week with several Mother's Day resolutions shouldn't have a corresponding topic bump.
7. The cache invalidates after a sync run (add a `console.log` in the invalidation call temporarily if uncertain).
8. Mobile (< 700px): chart stays readable. The 24px left padding might need a small reduction for narrow viewports; fix only if it's actually broken.

## Don't

- Don't use Recharts, Chart.js, D3, or any other library. The terminal aesthetic wants tight control; the existing chart idiom is hand-rolled and consistent.
- Don't add filters or interactivity beyond hover. v1 is a read-only signal.
- Don't compute top-6 per week. The top topics are picked globally over the window so the legend is stable.
- Don't extend the window to a year. 12 weeks is the legible ceiling; longer windows compress the action and lose the "lately" signal.
- Don't fanout topics differently than the existing topic queries do (e.g. don't deduplicate multi-topic bills into "primary" topics — match the existing JSON-fanout pattern).
