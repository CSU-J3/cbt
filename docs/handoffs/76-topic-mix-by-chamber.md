# 76 — Chamber-faceted topic mix

## What this is

The existing topic mix block on the home dashboard shows distribution across all bills. Splitting it into House vs Senate answers a different question: are the chambers working on the same things or different things? Same data, new cut. Read-side only.

## Pre-flight

Find the existing topic-mix block on `/`. It's probably `components/TopicMixBlock.tsx` (or similar — could be inlined). Verify three things:

1. Whether it already faceted by chamber. If yes, stop and tell me. Don't reimplement.
2. The shape of its current data fetch (a query helper like `getTopicMix()` or `getTopicCounts()`).
3. Whether it renders horizontal bars, vertical bars, pill clusters, or something else.

Flag which rendering it uses in the run notes. The handoff scope assumes the existing block stays in place and we add a chamber-faceted view next to or below it.

## In scope

- New query helper `getTopicMixByChamber()` in `lib/queries.ts` that returns both chambers in one call
- New `TopicMixByChamberBlock` component (or similar) with HOUSE and SENATE columns side-by-side
- Topics sorted by the same axis across both columns so you can read the disagreement visually
- Absolute counts (not percentages — volume itself is signal)
- Placement on home dashboard adjacent to the existing topic mix block
- Hand-rolled rendering, matching the existing visual idiom — no new chart library

## Out of scope

- Removing or replacing the existing topic mix block. Both can live on the dashboard; they answer different questions.
- Interactive toggle between "all bills" and "by chamber." Static rendering, both views visible.
- Faceting by party. Different question, separate handoff if it earns its way in.
- A third or fourth column. Just House and Senate.
- Time-windowed view (last N weeks). Match whatever window the existing block uses; don't introduce a new one.

## Chamber classification

Bill type → chamber:

- **House**: `bill_type IN ('hr', 'hjres', 'hconres', 'hres')`
- **Senate**: `bill_type IN ('s', 'sjres', 'sconres', 'sres')`

Centralize this in `lib/queries.ts` or a `lib/chamber.ts` helper if there isn't already one. The same mapping is going to show up in future handoffs (cosponsor analysis by chamber, etc.), so a one-liner exported function is worth more than inlining.

## Query

```ts
export type TopicChamberCount = {
  topic: string;          // canonical enum value
  houseCount: number;
  senateCount: number;
};

export async function getTopicMixByChamber(): Promise<TopicChamberCount[]>
```

Implementation:

- Match the time window and ceremonial-exclusion the existing topic-mix query uses. If the existing one filters `is_ceremonial = 0` and current-Congress only, mirror that.
- One query, two CASE-WHEN aggregations: `SUM(CASE WHEN chamber='house' THEN 1 ELSE 0 END) AS house_count, SUM(CASE WHEN chamber='senate' THEN 1 ELSE 0 END) AS senate_count`, grouped by topic.
- Bills with multiple topics fanout into multiple rows (same convention as existing topic-mix queries). If the existing query uses topics[0] only, mirror that — consistency matters more than the JS-fanout debate.
- Sort returned rows by `houseCount + senateCount DESC` so the most-active topics appear first in both columns.
- Wrap with `unstable_cache` tag `topic-mix-by-chamber`, revalidate matching the existing topic-mix cadence.
- Add `topic-mix-by-chamber` to the sync route's `revalidateTag` calls and to `ALLOWED_TAGS`.

## Rendering

Component layout:

```
┌────────────────────────────────────────────────────────┐
│ TOPIC MIX · BY CHAMBER                                 │
├──────────────────────────┬─────────────────────────────┤
│ HOUSE                    │ SENATE                      │
│                          │                             │
│ HLTH    ████████ 1,247   │ HLTH    ████  423           │
│ TAX     ██████ 894       │ TAX     █████ 612           │
│ DEF     █████ 731        │ DEF     ███████ 894         │
│ ENV     ████ 612          │ ENV     ███ 401             │
│ ...                       │ ...                          │
└──────────────────────────┴─────────────────────────────┘
```

Each column renders as a list of rows, one per topic. Row layout:

```
60px   — topic abbreviation (from lib/topic-colors.ts), in the topic color
1fr    — horizontal bar, filled to chamber's count / max(both columns) ratio
60px   — count, right-aligned, tabular-nums
```

The bar uses the topic's color from `lib/topic-colors.ts` at 60% opacity over a `--border-soft` background track. Same color across both chambers for the same topic — that's how the visual comparison works.

Critical detail: the bar fill ratio is `chamber count / max(houseCount, senateCount across all topics)`, not per-chamber max. This way the bar lengths are comparable across the two columns: House's healthcare bar will be visibly longer than Senate's if the House files more healthcare bills, because both are scaled to the same maximum.

The topics-per-column should cap at 8. Anything past the 8th most-active topic gets collapsed into an "OTHER" row at the bottom of each column. Match the existing topic mix block's row cap if it has one; otherwise 8 is the right ceiling for a glance read.

### Header

`TOPIC MIX · BY CHAMBER` in `--accent-amber`, 12px uppercase, letter-spacing 0.5px. Right-aligned secondary text shows the count: `1,643 NON-CEREMONIAL BILLS` (or whatever total the data adds up to).

### Column labels

`HOUSE` and `SENATE` in 11px uppercase, letter-spacing 0.5px, `--text-muted`. Positioned at the top of each column.

## CSS

Add to `globals.css`:

```css
.topic-chamber-mix {
  display: grid;
  grid-template-columns: 1fr 1fr;
  column-gap: 24px;
  margin: 8px 0;
}

.topic-chamber-mix .column-label {
  font-size: 11px;
  letter-spacing: 0.5px;
  color: var(--text-muted);
  text-transform: uppercase;
  margin-bottom: 4px;
  padding-bottom: 4px;
  border-bottom: 1px solid var(--border-soft);
}

.topic-chamber-row {
  display: grid;
  grid-template-columns: 60px 1fr 60px;
  align-items: center;
  column-gap: 8px;
  padding: 3px 0;
  font-size: 12px;
  letter-spacing: 0.5px;
}

.topic-chamber-row .topic {
  text-transform: uppercase;
  font-weight: 600;
}

.topic-chamber-row .bar-track {
  height: 8px;
  background: var(--border-soft);
  border-radius: 1px;
  position: relative;
  overflow: hidden;
}

.topic-chamber-row .bar-fill {
  height: 100%;
  opacity: 0.7;
}

.topic-chamber-row .count {
  text-align: right;
  font-variant-numeric: tabular-nums;
  color: var(--text-secondary);
}

@media (max-width: 700px) {
  .topic-chamber-mix {
    grid-template-columns: 1fr;
    row-gap: 16px;
  }
}
```

Mobile collapses to single column, House on top, Senate below.

## Placement

Place the new block adjacent to the existing topic mix block on `app/page.tsx`. If the existing topic mix is at the top of the dashboard, put the chamber-faceted version directly below it (or beside it if there's a horizontal slot). The two blocks read as a pair — "what Congress is working on" then "is the work shared across chambers."

If the dashboard is already crowded, put the new block where the original topic mix is and demote the original to a smaller "all bills" summary line above the chambers. Use your judgment based on what's there.

## Verification

1. `/` renders the new block with HOUSE and SENATE columns.
2. Topics appear in both columns in the same order (sorted by combined count DESC).
3. The same topic's bar in HOUSE is comparable in length to the same topic's bar in SENATE — i.e. if House files 2x more of a topic, its bar is visibly 2x longer.
4. Topic colors match the existing palette (`lib/topic-colors.ts`).
5. Counts are absolute numbers, right-aligned, tabular-nums.
6. Mobile (`< 700px`): columns stack vertically.
7. The total in the header line matches the count of non-ceremonial bills in the same window the existing topic mix uses.
8. A bill counted in both chambers does not exist (every bill has exactly one chamber); the column counts should add up cleanly without double-counting.

## Don't

- Don't normalize to percentages. Volume difference between House (435 members) and Senate (100) is a real signal worth seeing.
- Don't add a third "joint resolutions" or "concurrent resolutions" column. Those bill types are already classified by their chamber prefix.
- Don't sort the two columns independently. Same order across both is the whole point — the comparison requires aligned axes.
- Don't remove the existing topic mix block. It answers the all-bills version of the question; this block adds the by-chamber version. Both can live on the dashboard.
- Don't add legend. The topic abbreviations are self-documenting and a legend would just repeat what the existing topic mix already labels.
