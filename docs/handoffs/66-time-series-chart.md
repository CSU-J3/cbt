# 66 — Time-series chart: bills introduced per month, stacked by topic

## What this is

Third chart on the home dashboard. Bills introduced per month for the current Congress, stacked by topic. Same hand-rolled SVG idiom as the existing stage funnel and topic-distribution bars. Adds temporal shape to the home page's answer to "WTF is going on in Congress?" — readers see not just where bills are pooling (stage funnel) and what's being worked on overall (topic distribution), but how the legislative focus has shifted month-to-month.

Theme 5 (visualizations) continued. Builds on the idiom decisions already locked in from the first two charts: hand-rolled SVG, CSS-variable colors, terminal aesthetic.

Numbered 66 because handoff 65 (donors, OpenSecrets-based) was reverted mid-flight — the file in `docs/handoffs/65-donors-pipeline.md` is archeology for the dead-API problem.

No new LLM calls. One new query, one new component, one page integration.

## In scope

- New query helper `getBillsByMonth(filters?)` in `lib/queries.ts` — returns `{ month, topic, count }[]` for non-ceremonial bills in the current Congress
- New component `components/BillsTimeSeries.tsx` — server component, hand-rolled SVG
- Update `app/page.tsx` (or wherever the home dashboard renders) to drop the new chart in below the existing topic-distribution block
- `lib/topic-colors.ts` reuse — chart segments use the same color tokens as topic tags everywhere else
- SKILL.md update with the new chart in the home-dashboard section

## Out of scope

- Hover interactions, tooltips, click-to-filter. Static rendering for v1, same as the existing charts. If hovers earn their place across all three charts later, that's a separate idiom-wide pass.
- Weekly resolution. Monthly is the right bucket for 16 months of 119th Congress data — weekly buckets are too noisy (recess weeks, holiday quirks).
- Including ceremonial bills. Excluded by default to match the rest of the dashboard. If a "show ceremonial" toggle ever lands, it covers all charts at once via the existing URL-state pattern.
- Stage transitions over time (a different time-series chart entirely — different question, different bucket).
- House vs Senate split. One chart, all bills. Chamber-faceted version is theme-5 follow-up if useful.
- 119th vs 118th comparison overlay. Roadmap calls this out as a future chart on reports, not the home page.

## Query (`lib/queries.ts`)

```ts
export interface BillsByMonthRow {
  month: string;        // 'YYYY-MM'
  topic: string;        // single topic slug; bills counted under their first topic
  count: number;
}

export async function getBillsByMonth(): Promise<BillsByMonthRow[]> {
  return unstable_cache(
    async () => {
      const db = getDb();
      const res = await db.execute(`
        SELECT
          substr(introduced_date, 1, 7) AS month,
          COALESCE(json_extract(topics, '$[0]'), 'other') AS topic,
          COUNT(*) AS count
        FROM bills
        WHERE introduced_date IS NOT NULL
          AND (is_ceremonial = 0 OR is_ceremonial IS NULL)
          AND topics IS NOT NULL
          AND congress = (SELECT MAX(congress) FROM bills)
        GROUP BY month, topic
        ORDER BY month, topic
      `);
      return res.rows.map(r => ({
        month: r.month as string,
        topic: r.topic as string,
        count: Number(r.count),
      }));
    },
    ['bills-by-month'],
    { tags: ['feed-bills'], revalidate: 86400 }
  )();
}
```

Notes:

- **First topic only.** Bills can have multiple topics in the JSON array; we count each bill once under `topics[0]`. The summarization prompt orders topics by relevance, so the first one is usually the most central. This avoids `json_each` complexity and double-counting.
- **Current Congress scoped.** `(SELECT MAX(congress) FROM bills)` rather than a hardcoded `119` so this keeps working when Congress rolls over. Matches the pattern in `lib/congress.ts`.
- **Ceremonial excluded.** Same default as the rest of the dashboard. The chart shows substantive legislative activity.
- **Cache tag `feed-bills`.** Reuses the existing tag that the sync cron already invalidates, so the chart refreshes when new bills land.

## Component (`components/BillsTimeSeries.tsx`)

Server component. Server-fetches the data, computes the layout, renders SVG.

```tsx
import { getBillsByMonth, type BillsByMonthRow } from '@/lib/queries';
import { TOPIC_COLORS } from '@/lib/topic-colors';

const TOP_N_TOPICS = 6;
const CHART_HEIGHT = 240;
const CHART_PADDING = { top: 20, right: 16, bottom: 36, left: 40 };

export async function BillsTimeSeries() {
  const rows = await getBillsByMonth();
  if (rows.length === 0) {
    return (
      <div className="text-[12px] uppercase tracking-[0.5px] text-[var(--text-muted)] py-8 text-center">
        No data yet
      </div>
    );
  }

  // Aggregate to identify top N topics by overall count.
  const totalsByTopic = new Map<string, number>();
  for (const r of rows) {
    totalsByTopic.set(r.topic, (totalsByTopic.get(r.topic) ?? 0) + r.count);
  }
  const topTopics = Array.from(totalsByTopic.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, TOP_N_TOPICS)
    .map(([t]) => t);
  const topTopicsSet = new Set(topTopics);

  // Roll non-top topics into 'other'.
  const months = Array.from(new Set(rows.map(r => r.month))).sort();
  const stack: Record<string, Record<string, number>> = {};
  for (const m of months) stack[m] = {};
  for (const r of rows) {
    const topic = topTopicsSet.has(r.topic) ? r.topic : 'other';
    stack[r.month][topic] = (stack[r.month][topic] ?? 0) + r.count;
  }

  // Stack order: top topics first (in priority order), 'other' last so it sits at the top of each bar.
  const stackOrder = [...topTopics, 'other'];

  const maxTotal = Math.max(...months.map(m => sumValues(stack[m])));
  // Round up to nearest 100 for a clean axis cap.
  const yAxisMax = Math.ceil(maxTotal / 100) * 100;

  // Layout math.
  const innerWidth = 1000 - CHART_PADDING.left - CHART_PADDING.right;
  const innerHeight = CHART_HEIGHT - CHART_PADDING.top - CHART_PADDING.bottom;
  const barWidth = innerWidth / months.length;
  const barGap = Math.max(2, barWidth * 0.15);
  const drawBarWidth = barWidth - barGap;

  return (
    <div className="w-full overflow-x-auto">
      <svg
        viewBox={`0 0 1000 ${CHART_HEIGHT}`}
        preserveAspectRatio="xMidYMid meet"
        className="w-full h-auto"
        role="img"
        aria-label="Bills introduced per month stacked by topic"
      >
        {/* Y-axis: 4 tick lines + labels */}
        {[0, 0.25, 0.5, 0.75, 1].map(t => {
          const y = CHART_PADDING.top + innerHeight * (1 - t);
          const label = Math.round(yAxisMax * t);
          return (
            <g key={t}>
              <line
                x1={CHART_PADDING.left}
                x2={CHART_PADDING.left + innerWidth}
                y1={y}
                y2={y}
                stroke="var(--border-soft)"
                strokeWidth={1}
              />
              <text
                x={CHART_PADDING.left - 6}
                y={y + 4}
                textAnchor="end"
                fontSize="11"
                fill="var(--text-dim)"
                fontFamily="var(--font-mono)"
              >
                {label}
              </text>
            </g>
          );
        })}

        {/* Bars */}
        {months.map((month, i) => {
          const x = CHART_PADDING.left + i * barWidth + barGap / 2;
          let cursorY = CHART_PADDING.top + innerHeight;
          return (
            <g key={month}>
              {stackOrder.map(topic => {
                const value = stack[month][topic] ?? 0;
                if (value === 0) return null;
                const segHeight = (value / yAxisMax) * innerHeight;
                cursorY -= segHeight;
                return (
                  <rect
                    key={topic}
                    x={x}
                    y={cursorY}
                    width={drawBarWidth}
                    height={segHeight}
                    fill={TOPIC_COLORS[topic]?.color ?? 'var(--text-dim)'}
                  />
                );
              })}
            </g>
          );
        })}

        {/* X-axis labels: show every Nth month to avoid crowding */}
        {months.map((month, i) => {
          const labelStep = Math.ceil(months.length / 8);
          if (i % labelStep !== 0 && i !== months.length - 1) return null;
          const x = CHART_PADDING.left + i * barWidth + barWidth / 2;
          return (
            <text
              key={month}
              x={x}
              y={CHART_HEIGHT - CHART_PADDING.bottom + 18}
              textAnchor="middle"
              fontSize="11"
              fill="var(--text-muted)"
              fontFamily="var(--font-mono)"
            >
              {formatMonthLabel(month)}
            </text>
          );
        })}
      </svg>

      {/* Legend */}
      <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-[11px] uppercase tracking-[0.5px] font-mono">
        {stackOrder.map(topic => (
          <span key={topic} className="inline-flex items-center gap-1">
            <span
              className="inline-block w-2 h-2"
              style={{ background: TOPIC_COLORS[topic]?.color ?? 'var(--text-dim)' }}
            />
            <span style={{ color: TOPIC_COLORS[topic]?.color ?? 'var(--text-dim)' }}>
              {TOPIC_COLORS[topic]?.short ?? topic.toUpperCase()}
            </span>
          </span>
        ))}
      </div>
    </div>
  );
}

function sumValues(obj: Record<string, number>): number {
  let s = 0;
  for (const v of Object.values(obj)) s += v;
  return s;
}

function formatMonthLabel(month: string): string {
  // 'YYYY-MM' → 'MMM 'YY' (e.g. 'Jan '25')
  const [yStr, mStr] = month.split('-');
  const month0 = Number(mStr) - 1;
  const monthShort = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][month0];
  return `${monthShort} '${yStr.slice(2)}`;
}
```

Implementation notes:

- **viewBox 1000-wide.** Fixed coordinate space, scales to container width. No JS-driven resize needed.
- **Stack order: top topics first, 'other' last.** That puts the catchall at the top of each bar where it visually fades into less-visible territory; the dominant topics sit at the base.
- **Color lookup via `TOPIC_COLORS`** — confirm the existing shape exports `{ color, short }` per topic. If the export shape differs, adjust the lookup. The roadmap notes the 6-color-group taxonomy already in place.
- **Y-axis rounded to 100s.** Cleaner than fitting tightly. If max month is 1247, axis goes to 1300.
- **X-axis label step.** ~8 visible labels across the range. With 16 months, that's every other label; with 24 months it's every third. The last month always shows.
- **No bar hover.** v1 stays simple. If readers want exact counts, they cross-reference with the feed.

## Page integration

In whatever component renders the home dashboard (likely `app/page.tsx` or a `Dashboard` server component), add the chart below the existing topic-distribution bars:

```tsx
import { BillsTimeSeries } from '@/components/BillsTimeSeries';

// ...existing stage funnel + topic bars...

<section className="py-6">
  <h2 className="text-[12px] uppercase tracking-[0.5px] text-[var(--text-muted)] mb-3">
    Bills introduced per month
  </h2>
  <BillsTimeSeries />
</section>
```

Section header uses the same 12px uppercase tracking convention as the rest of the dashboard. Match the existing wrapper class pattern from the topic-bars section so spacing stays consistent.

## SKILL.md update

In the home-dashboard section (wherever the stage funnel and topic bars are documented), append:

> **Bills-per-month time-series.** Hand-rolled SVG, stacked bars per month for the current Congress. Top 6 topics by overall count get their own segment; everything else lumped into `other`. Bills counted under their first topic (`topics[0]`) to avoid double-counting. Ceremonial bills excluded by default. Cached via the existing `feed-bills` tag so it refreshes with the sync cron. See `components/BillsTimeSeries.tsx`.

If there's a "Visualization idiom" section explaining the hand-rolled SVG decision, no update needed — this chart just follows the existing pattern.

## Verification

1. `npm run typecheck` — clean.
2. `npm run build` — clean. Route map unchanged (no new pages).
3. Visit `/` — chart renders below the existing topic-distribution bars. Each bar is a stacked column of topic-colored segments. Y-axis shows count, x-axis shows month labels (`Jan '25`, `Mar '25`, etc.). Legend below the chart shows the top 6 topics + `other`.
4. Inspect element on a segment — fill color matches `TOPIC_COLORS[topic].color` for that topic.
5. Compare segment heights to a SQL spot-check:
   ```sql
   SELECT json_extract(topics, '$[0]') AS topic, COUNT(*)
   FROM bills
   WHERE substr(introduced_date, 1, 7) = '2025-03'
     AND (is_ceremonial = 0 OR is_ceremonial IS NULL)
     AND topics IS NOT NULL
   GROUP BY topic
   ORDER BY 2 DESC;
   ```
   Heights in the March 2025 bar should match the counts proportionally.
6. The most recent month (current month) will likely show a partial bar — bills introduced so far in the month. Not a bug; the chart shows actual data.
7. Sanity: if a month is missing entirely from the X axis, double-check the date range filter — current Congress should be a contiguous run from Jan 2025 to now.

## Acceptance

Third chart on the home dashboard. Readers can see monthly legislative volume and topic-mix shifts at a glance. Hand-rolled SVG idiom held.

After this: visualizations theme bumps from 25% to ~40-45%. Remaining roadmap chart candidates (sponsor productivity scatter, 119th-vs-118th overlay on reports) are theme-5 follow-ups when the data and surfaces are ready. Next handoff candidates: news validation (handoff 65 slot, deferred), CCBT parity batch, or donor pipeline take-2 against FEC. User picks.
