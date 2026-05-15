# 55 — Topic distribution

## What this is

Right pane of the dashboard gets populated. Replaces `TopicMixPlaceholder` from handoff 53 with a real topic distribution block: every topic that has at least one non-ceremonial bill, sorted by count desc, rendered as colored bars with clickable rows that filter `/feed`.

After this ships, the dashboard v1 has no placeholders left.

Roadmap theme 2, step 3.

## In scope

- New `TopicDistribution` server component for the right pane of `/`
- New query helper `getTopicDistribution()` using `json_each` to UNNEST the `topics` JSON array
- Per-row click navigation to `/feed?topics=<topic>`
- Pane header label: `TOPIC DISTRIBUTION` (parallel to the left pane's `STAGE DISTRIBUTION`)
- Remove `TopicMixPlaceholder.tsx` and its usage in `app/page.tsx`
- SKILL.md updates

## Out of scope

- Time-windowing the topic mix (e.g. "topics this week"). v1 shows corpus-wide distribution. Time-windowed cuts come later.
- Excluding the `other` topic from the distribution. It's a real category and surfaces unclassified-by-LLM bills as signal.
- Surfacing the count of bills with NULL topics (unsummarized). Operational concern, not a dashboard concern.
- Click-to-filter the rest of the dashboard. Same deferral as funnel + ticker. Interactivity layers in later.

## Query helper (`lib/queries.ts`)

```ts
type TopicCount = {
  topic: Topic;     // from the Topic enum in lib/enums.ts
  count: number;
};

async function getTopicDistribution(): Promise<TopicCount[]>;
```

SQL:

```sql
SELECT je.value AS topic, COUNT(*) AS count
FROM bills, json_each(bills.topics) je
WHERE bills.topics IS NOT NULL
  AND (bills.is_ceremonial = 0 OR bills.is_ceremonial IS NULL)
GROUP BY je.value
ORDER BY count DESC;
```

`json_each` is a SQLite/libSQL table-valued function that yields one row per array element. The CROSS JOIN expands each bill's topics array, then GROUP BY aggregates.

Cache with `unstable_cache(..., ['topic-distribution'], { tags: ['bills'], revalidate: 3600 })`. Uses the unified `bills` tag, so the sync cron's existing `revalidateTag('bills')` call invalidates it for free.

Type filtering: the SQL returns `topic` as TEXT. Validate against the Topic enum in `lib/enums.ts` and skip any rows whose value isn't a known topic. Log a warning if mismatches occur (shouldn't happen, but the LLM has surprised the enum before).

## TopicDistribution component (`components/TopicDistribution.tsx`)

Server component. Reads from `getTopicDistribution()`, renders a list of clickable rows.

Each row is a 3-column grid:

```
[label]  [bar]                   [count]
HLTH     ████████████████        2,341
TAX      ██████████████          1,893
GOV      ███████████             1,402
DEF      █████████               1,287
...
```

Column widths: `60px 1fr 50px`. Gap matches other dashboard blocks.

Row styling:

- Each row wraps in `<Link href={\`/feed?topics=\${topic}\`}>`
- Hover background `--bg-row-hover`
- Label: topic abbreviation from `lib/topic-colors.ts`, 12px uppercase, color from `getTopicColor(topic)`
- Bar: styled div (or inline SVG rect, Code's call), fill from `getTopicColor(topic)`, width proportional to the row's count relative to the topic with the most bills (the first row will always render 100% wide)
- Count: 13px, `--text-secondary`, tabular-nums, right-aligned
- Row height: ~22px to keep the block compact

Render every topic returned by the query. Don't truncate. The long tail conveys real distribution information ("only 3 social_security bills" is a finding, not noise).

Empty state: if `getTopicDistribution()` returns zero rows (extremely unlikely outside a fresh DB), render `No classified bills yet.` in `--text-dim`, 13px, centered.

## `app/page.tsx` change

Replace `<TopicMixPlaceholder />` with `<TopicDistribution />`. Remove the placeholder import. Delete `components/TopicMixPlaceholder.tsx` from the repo (it has served its purpose).

Also update the right pane's lower block header from `TOPIC MIX` to `TOPIC DISTRIBUTION` (parallel to the left pane's `STAGE DISTRIBUTION`, same 12px uppercase styling).

## Mobile

Below 700px, when the right pane stacks below the ticker:

- Rows stay full-width
- Bar shrinks proportionally to available width
- The 3-column grid stays the same shape, just narrower
- No column hiding needed

## SKILL.md updates

Edit the Pages section, dashboard `/` entry:

- Replace the partial-placeholder language with: "right pane stacks sub-view links + topic distribution. Every non-ceremonial topic with at least one bill, sorted by count desc, color-coded bars per `lib/topic-colors.ts`, rows link to `/feed?topics=<topic>`."

Edit the Query helpers section:

- Add `getTopicDistribution()` — corpus-wide topic counts (non-ceremonial only), uses `json_each` to UNNEST the topics JSON array. Cached with tag `bills`.

Add to the existing Query helpers section (or a new "JSON column conventions" note if one feels warranted): `json_each` is the standard pattern for aggregating across the `topics` JSON column. Other JSON columns in the schema use the same approach if they're added later.

## Verification

1. `pnpm dev`, hit `/`. Right pane shows the topic distribution under the sub-view link strip. All topics with ≥1 bill appear, ordered by count desc.
2. Click any topic row. Lands on `/feed?topics=<topic>` with the topic filter active and matching bills shown.
3. Hover a row. Background tints `--bg-row-hover`. No janky reflow.
4. Inspect the response in DevTools: the dashboard page stays statically prerendered. No client-side fetch.
5. Mobile (~375px wide): right pane stacks below the ticker. Topic rows compress cleanly, no horizontal overflow.
6. Force a cache miss: run `pnpm sync` locally. The topic distribution updates within the 1h TTL or immediately after the cron's `revalidateTag('bills')` call.
7. `pnpm build` produces no warnings.

## Acceptance

Right pane shows the topic distribution. Dashboard v1 has no placeholders left. Funnel, activity ticker, sub-view links, topic distribution are all populated. The dashboard answers "wtf is going on in Congress" across three cuts at a glance: where bills are pooling (funnel), what's flowing right now (ticker), what topics dominate (distribution).
