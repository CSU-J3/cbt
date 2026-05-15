# 56 — Click-to-filter dashboard

## What this is

Dashboard polish, part 1. The static co-existing panes from handoffs 53–55 become coordinated. Click a funnel bar to filter the ticker and topic distribution to that stage. Click a topic row to filter the funnel and ticker to that topic. Filters compose. Visual selection states show what's filtered. An active-filter strip provides clear-filter and view-in-feed escapes.

Roadmap theme 2 polish, step 1. Locks in the URL state shape that future blocks (LLM lead, additional viz) compose on.

## In scope

- URL state on `/`: `?stage=<stage>` and `?topics=<topic>` (single topic for v1)
- Update the three dashboard query helpers (`getStageDistribution`, `getTopicDistribution`, and whatever `/changes` helper the ticker uses) to accept optional filter params
- Cache keys include the filter params so the unified `bills` tag still invalidates everything via the sync cron
- `StageFunnel` bars become clickable links: clicking toggles `stage` in the URL
- `TopicDistribution` rows change behavior: clicking now toggles `topics` in the dashboard URL instead of navigating to `/feed`
- Visual selection states on both blocks: selected bar/row at full color, others dimmed
- New `ActiveFilterStrip` component above the three-pane grid
- Ticker rows keep their existing behavior (link to bill detail; filtering by an individual bill makes no sense)
- SKILL.md updates

## Out of scope

- LLM lead at the top of the dashboard — separate handoff after this one ships
- Bubble pack viz — still deferred, may not ship at all
- Multi-topic filter on the dashboard — single topic at a time for v1 (the feed already supports multi; dashboard can grow into it later)
- Other filter axes (sponsor, date range, party) — stage and topic only
- Client-side animation of the filter transition — URL change triggers server re-render, no transition

## URL state model

- `?stage=committee` — funnel + ticker + topic distribution filter to committee
- `?topics=healthcare` — funnel + ticker + topic distribution filter to healthcare
- `?stage=committee&topics=healthcare` — both active, intersection
- Missing or empty params = no filter

Reuse the existing `sanitizeStage` and Topic-enum validation patterns from `lib/queries.ts`. Invalid values silently dropped. The dashboard accepts a strict subset of feed-shaped params; do not accept `q`, `sort`, `sponsor`, `cluster`, etc. on `/` for v1.

Note: `await searchParams` opts `/` into dynamic rendering, per the SKILL.md "things to watch for" note. The route will no longer statically prerender after this ships. The query-layer cache (`unstable_cache` with the `bills` tag) still holds; only the route-level static prerender is lost. Confirm in `pnpm build` output and note the regression honestly.

## Query updates

All three dashboard helpers gain an optional filter param:

```ts
type DashboardFilters = {
  stage?: Stage;
  topic?: Topic;
};

async function getStageDistribution(filters?: DashboardFilters): Promise<...>;
async function getTopicDistribution(filters?: DashboardFilters): Promise<...>;
// ticker helper: extend whatever currently exists (getStageChanges per handoff 54)
```

### Stage filter behavior

- On `getStageDistribution`: `stage` is **not** a query filter (you don't want a single-bar funnel). It passes through for the component to render selection state. The query returns the full distribution unchanged.
- On `getTopicDistribution`: `stage` filters the underlying bill count. `WHERE stage = ?` added to the WHERE clause.
- On the ticker helper: `stage` narrows to transitions where `stage = ? OR previous_stage = ?` (transitions involving that stage in either direction).

### Topic filter behavior

- On `getStageDistribution`: `topic` filters via `EXISTS (SELECT 1 FROM json_each(bills.topics) WHERE value = ?)`. The funnel re-shapes to show the stage distribution within that topic. This is the useful analytical cut ("how are healthcare bills flowing").
- On `getTopicDistribution`: `topic` is **not** a query filter (same reason as stage on funnel). Passes through for selection-state rendering.
- On the ticker helper: same `json_each` EXISTS pattern, narrows transitions to bills with that topic.

### Caching

Each helper's `unstable_cache` key includes the filter values:

```ts
unstable_cache(
  () => fetchStageDistribution(filters),
  ['stage-distribution', filters?.stage ?? 'all', filters?.topic ?? 'all'],
  { tags: ['bills'], revalidate: 3600 }
)
```

Same pattern for the other two. The `bills` tag still invalidates all filtered variants on sync. Cache cardinality is bounded (`6 stages × 24 topics × 3 helpers ≈ 432 cache entries max`), well within limits.

## Component changes

### StageFunnel

- Each bar wraps in a `<Link>` to the same route with `stage` toggled. If `stage` in URL matches the bar's stage, the link clears the param. Otherwise it sets `stage` to the bar's value (preserving any existing `topics` param).
- Visual state when URL has `stage` set: matching bar renders normally, others get `opacity: 0.4`. Add a `data-selected` attribute if it helps CSS.
- Cursor: `pointer` on bar hover. Existing hover state stays.
- The off-path note below the funnel does not change.

### TopicDistribution

- Each row's `href` changes from `/feed?topics=X` to `/?topics=X` with toggle semantics (matches funnel).
- Visual state when URL has `topics` set: matching row at full color, others at `opacity: 0.4`.
- This is a behavior break from handoff 55. The "view in /feed" escape moves to the active filter strip (below) so users don't lose the ability to jump to a filtered feed.

### ActiveFilterStrip (new component, `components/ActiveFilterStrip.tsx`)

Server component. Renders between `HeaderBar` and `DashboardGrid` on `/`.

- Hidden when neither filter is active (returns `null`)
- When active: single horizontal strip with the filter summary and two action links

Sample render:

```
FILTERED · STAGE: COMMITTEE · TOPIC: HEALTHCARE          [ × CLEAR ]   [ VIEW IN /FEED → ]
```

Styling:

- Background `--bg-panel`, top + bottom border `--border-soft`, ~32px tall
- Label `FILTERED` in `--text-secondary`, 12px uppercase, letter-spacing 0.5px
- Filter values (`COMMITTEE`, `HEALTHCARE`) in `--accent-amber`
- Action links right-aligned, 12px uppercase, `--accent-amber` text, hover `--accent-amber-bright`
- `× CLEAR` links to `/` (drops all params)
- `VIEW IN /FEED →` links to `/feed?stage=<stage>&topics=<topic>` (carries the filters)

When only one filter is active, the other half of the summary is omitted (e.g. `FILTERED · STAGE: COMMITTEE` with no topic clause).

## Page wiring (`app/page.tsx`)

```tsx
export default async function DashboardPage({ searchParams }: { searchParams: Promise<...> }) {
  const sp = await searchParams;
  const filters: DashboardFilters = {
    stage: sanitizeStage(sp.stage),
    topic: sanitizeTopic(sp.topics),
  };

  return (
    <>
      <HeaderBar variant="dashboard" />
      <ActiveFilterStrip filters={filters} />
      <DashboardGrid>
        <LeftPane><StageFunnel filters={filters} /></LeftPane>
        <MiddlePane><ActivityTicker filters={filters} /></MiddlePane>
        <RightPane>
          <SubViewLinkStrip />
          <TopicDistribution filters={filters} />
        </RightPane>
      </DashboardGrid>
      <FooterLegend />  {/* if it exists; per 53 cleanup, may be StageLegend or nothing */}
    </>
  );
}
```

`sanitizeTopic` follows the same pattern as the existing topic validation in `/feed` (validate against Topic enum, return undefined if invalid).

## Mobile

- Active filter strip wraps to two lines if needed (filter summary on top, action links below)
- Funnel bars stay clickable; tap targets at least 44px tall for accessibility
- Topic rows stay clickable; same 44px minimum

## SKILL.md updates

Edit the `/` Pages entry:

- Add: "Accepts `?stage=<stage>` and `?topics=<topic>` query params for click-to-filter. Single value each, validated against the Stage and Topic enums. URL params drive all three panes; filters compose. Selected bar/row renders at full opacity, others at 0.4. `ActiveFilterStrip` renders above the grid when any filter is active, with `× CLEAR` and `VIEW IN /FEED →` links."
- Note: `/` is now dynamically rendered, not statically prerendered. The `bills`-tagged query cache still applies at the query layer.

Edit the Query helpers section:

- All three dashboard helpers (`getStageDistribution`, `getTopicDistribution`, and the ticker helper) now accept an optional `DashboardFilters = { stage?, topic? }` param. Cache keys include the filter values; the `bills` tag invalidates all variants on sync.
- Note the asymmetry: `stage` filters the topic distribution and ticker but does not filter the funnel itself (visual selection only). `topic` filters the stage distribution and ticker but does not filter the topic distribution itself.

Edit `Things to watch for`:

- Add a line confirming the dashboard route is now dynamic: "Once `await searchParams` was added to `app/page.tsx` for click-to-filter, the dashboard lost its static prerender. Query-layer caching via `unstable_cache` + the `bills` tag still applies, so this is a small latency regression, not a correctness one."

## Verification

1. `pnpm dev`, hit `/`. No filters in URL, all three panes show corpus-wide data, no `ActiveFilterStrip` visible.
2. Click the `COMMITTEE` funnel bar. URL becomes `/?stage=committee`. Committee bar full color, others dimmed. Ticker re-scopes to transitions involving committee. Topic distribution re-scopes to topics within committee-stage bills. Active filter strip appears.
3. Click `HEALTHCARE` topic row. URL becomes `/?stage=committee&topics=healthcare`. Healthcare row full color, others dimmed. Funnel re-shapes to show stage distribution within healthcare. Active filter strip shows both filters.
4. Click the same bar again. URL drops the `stage` param. Funnel returns to undimmed state.
5. Click `× CLEAR` in the active filter strip. URL drops all params. Dashboard returns to unfiltered.
6. Click `VIEW IN /FEED →` with filters active. Lands on `/feed?stage=committee&topics=healthcare` (or whatever's set).
7. Try invalid params (`/?stage=garbage`). Silently ignored, no filter applied, no error.
8. Mobile (~375px wide): active filter strip wraps cleanly, bar/row tap targets are usable.
9. `pnpm build`. Confirm `/` is now dynamic (no static prerender). No build warnings beyond that.

## Acceptance

Dashboard becomes a coordinated exploration surface. Click a funnel bar or topic row to filter, click again to clear, see filtered state in the active strip, escape to `/feed` with the same filters if you want the full list. The three panes that used to be static cuts now answer "wtf is going on in [stage] / [topic]" with the same speed as the unfiltered view.
