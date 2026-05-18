# 67 — Sponsor productivity scatter chart

## What this is

Fourth chart on the dashboard, second this session. Lives on `/sponsors`, above the existing sponsor list. Plots every current-Congress sponsor as a dot: X = bills sponsored, Y = pass rate (% advanced beyond `introduced`). Color by party. Top performers by volume and by pass rate get name labels.

Answers a lens question directly: who's actually moving bills versus who's just introducing them. Pure analytical view — drops the dashboard's reliance on lists for sponsor evaluation.

Theme 5 (visualizations) continued. Same hand-rolled SVG idiom as the time-series chart from handoff 66. No external dependencies.

## In scope

- New query helper `getSponsorProductivity()` in `lib/queries.ts` — returns one row per sponsor with `{ bioguideId, name, party, billCount, advancedCount, passRate }`
- New component `components/SponsorProductivityScatter.tsx` — server component, hand-rolled SVG
- Update `app/sponsors/page.tsx` — render the chart above the sponsor list
- SKILL.md update with the new chart in the `/sponsors` page entry

## Out of scope

- Hover tooltips, click-to-filter. Same v1 simplicity as the other charts. Each dot is a link to the sponsor's detail page; that's the only interaction.
- Chamber-faceted version (separate House and Senate scatters). One chart, all sponsors. Color carries party signal; chamber can be a follow-up if it earns its place.
- "Pass rate" by stricter definitions (enacted-only would compress every dot to the X-axis; not useful). One definition for v1.
- Bubble sizing by total cosponsors or money raised. v1 is dots, equal size. Bubble dimension is a separate scoping conversation.
- Time-windowed view (e.g., "last 90 days only"). Full current-Congress is the v1 scope. The chart shows the season-long picture, not a rolling cut.

## "Advanced beyond introduction" definition

A bill counts as "advanced" if its `stage` is in the set `{committee, floor, other_chamber, president, enacted}`. Bills at `stage = 'introduced'` or `stage = 'other'` don't count. Bills with `stage IS NULL` (unsummarized) are excluded from both numerator and denominator.

Pass rate = `advancedCount / billCount` where `billCount` only includes bills with a non-null, non-`other` stage.

Sponsors with fewer than 3 bills are excluded entirely. One-shot sponsors get 0% or 100% rates that compress the chart and don't carry analytical signal.

## Query (`lib/queries.ts`)

```ts
export interface SponsorProductivityRow {
  bioguideId: string | null;     // null if sponsor never resolved to a member row
  name: string;
  party: 'R' | 'D' | 'I' | null;
  state: string | null;
  billCount: number;
  advancedCount: number;
  passRate: number;              // 0-1
}

const ADVANCED_STAGES = ['committee', 'floor', 'other_chamber', 'president', 'enacted'];

export async function getSponsorProductivity(): Promise<SponsorProductivityRow[]> {
  return unstable_cache(
    async () => {
      const db = getDb();
      const res = await db.execute(`
        SELECT
          b.sponsor_bioguide_id AS bioguide_id,
          b.sponsor_name AS name,
          b.sponsor_party AS party_raw,
          b.sponsor_state AS state,
          COUNT(*) AS bill_count,
          SUM(CASE WHEN b.stage IN ('committee','floor','other_chamber','president','enacted') THEN 1 ELSE 0 END) AS advanced_count
        FROM bills b
        WHERE b.congress = (SELECT MAX(congress) FROM bills)
          AND (b.is_ceremonial = 0 OR b.is_ceremonial IS NULL)
          AND b.stage IS NOT NULL
          AND b.stage != 'other'
          AND b.sponsor_name IS NOT NULL
        GROUP BY b.sponsor_bioguide_id, b.sponsor_name, b.sponsor_party, b.sponsor_state
        HAVING COUNT(*) >= 3
        ORDER BY bill_count DESC
      `);

      return res.rows.map(r => {
        const billCount = Number(r.bill_count);
        const advancedCount = Number(r.advanced_count);
        return {
          bioguideId: r.bioguide_id as string | null,
          name: r.name as string,
          party: normalizePartyVariant(r.party_raw as string | null),
          state: r.state as string | null,
          billCount,
          advancedCount,
          passRate: billCount > 0 ? advancedCount / billCount : 0,
        };
      });
    },
    ['sponsor-productivity'],
    { tags: ['bills'], revalidate: 86400 }
  )();
}
```

Notes:

- **`normalizePartyVariant`** already exists in `lib/queries.ts` per SKILL.md — reuse it for the R/D/I collapse.
- **`bioguideId` may be null** when the sponsor's name didn't resolve to a `members` row. The chart still plots them; just no link.
- **Tag `bills`** matches the unified cache tag from handoff 66 (Code's correction).
- **Same Congress scoping pattern** as `getBillsByMonth`: `(SELECT MAX(congress) FROM bills)` so it rolls over automatically.

## Component (`components/SponsorProductivityScatter.tsx`)

```tsx
import Link from 'next/link';
import { getSponsorProductivity, type SponsorProductivityRow } from '@/lib/queries';

const CHART_HEIGHT = 360;
const CHART_PADDING = { top: 24, right: 24, bottom: 48, left: 56 };
const DOT_RADIUS = 4;
const LABEL_OFFSET = 8;
const TOP_N_LABELS = 5;

const PARTY_COLORS: Record<string, string> = {
  R: 'var(--party-republican)',
  D: 'var(--party-democrat)',
  I: 'var(--party-independent)',
};

export async function SponsorProductivityScatter() {
  const rows = await getSponsorProductivity();
  if (rows.length === 0) {
    return (
      <div className="text-[12px] uppercase tracking-[0.5px] text-[var(--text-muted)] py-8 text-center">
        No data yet
      </div>
    );
  }

  // Outlier selection: top N by volume + top N by pass rate, deduped on name.
  const topByVolume = [...rows].sort((a, b) => b.billCount - a.billCount).slice(0, TOP_N_LABELS);
  const topByPassRate = [...rows].sort((a, b) => b.passRate - a.passRate).slice(0, TOP_N_LABELS);
  const labelNames = new Set([...topByVolume, ...topByPassRate].map(r => r.name));

  // Axis scales. X: 0 → max volume rounded up to nearest 10. Y: 0 → max pass rate rounded up to nearest 0.1.
  const maxVolume = Math.max(...rows.map(r => r.billCount));
  const xAxisMax = Math.ceil(maxVolume / 10) * 10;
  const maxRate = Math.max(...rows.map(r => r.passRate));
  const yAxisMax = Math.min(1, Math.ceil(maxRate * 10) / 10);

  const innerWidth = 1000 - CHART_PADDING.left - CHART_PADDING.right;
  const innerHeight = CHART_HEIGHT - CHART_PADDING.top - CHART_PADDING.bottom;

  const xScale = (n: number) => CHART_PADDING.left + (n / xAxisMax) * innerWidth;
  const yScale = (n: number) => CHART_PADDING.top + (1 - n / yAxisMax) * innerHeight;

  return (
    <div className="w-full overflow-x-auto">
      <svg
        viewBox={`0 0 1000 ${CHART_HEIGHT}`}
        preserveAspectRatio="xMidYMid meet"
        className="w-full h-auto"
        role="img"
        aria-label="Sponsor productivity: bills sponsored versus pass rate"
      >
        {/* Y-axis grid + labels (every 25% of yAxisMax) */}
        {[0, 0.25, 0.5, 0.75, 1].map(t => {
          const y = CHART_PADDING.top + innerHeight * (1 - t);
          const value = yAxisMax * t;
          return (
            <g key={`y-${t}`}>
              <line
                x1={CHART_PADDING.left}
                x2={CHART_PADDING.left + innerWidth}
                y1={y}
                y2={y}
                stroke="var(--border-soft)"
                strokeWidth={1}
              />
              <text
                x={CHART_PADDING.left - 8}
                y={y + 4}
                textAnchor="end"
                fontSize="11"
                fill="var(--text-dim)"
                fontFamily="var(--font-mono)"
              >
                {Math.round(value * 100)}%
              </text>
            </g>
          );
        })}

        {/* X-axis tick labels (5 ticks across) */}
        {[0, 0.25, 0.5, 0.75, 1].map(t => {
          const x = CHART_PADDING.left + innerWidth * t;
          const value = Math.round(xAxisMax * t);
          return (
            <text
              key={`x-${t}`}
              x={x}
              y={CHART_HEIGHT - CHART_PADDING.bottom + 18}
              textAnchor="middle"
              fontSize="11"
              fill="var(--text-muted)"
              fontFamily="var(--font-mono)"
            >
              {value}
            </text>
          );
        })}

        {/* Axis titles */}
        <text
          x={CHART_PADDING.left + innerWidth / 2}
          y={CHART_HEIGHT - 6}
          textAnchor="middle"
          fontSize="11"
          fill="var(--text-muted)"
          fontFamily="var(--font-mono)"
          letterSpacing="0.5"
        >
          BILLS SPONSORED
        </text>
        <text
          x={14}
          y={CHART_PADDING.top + innerHeight / 2}
          textAnchor="middle"
          fontSize="11"
          fill="var(--text-muted)"
          fontFamily="var(--font-mono)"
          letterSpacing="0.5"
          transform={`rotate(-90, 14, ${CHART_PADDING.top + innerHeight / 2})`}
        >
          PASS RATE
        </text>

        {/* Dots (and labels for outliers) */}
        {rows.map(row => {
          const x = xScale(row.billCount);
          const y = yScale(row.passRate);
          const color = row.party ? PARTY_COLORS[row.party] : 'var(--text-dim)';
          const dot = (
            <circle
              cx={x}
              cy={y}
              r={DOT_RADIUS}
              fill={color}
              fillOpacity={0.7}
              stroke={color}
              strokeOpacity={0.9}
              strokeWidth={1}
            />
          );
          const wrapped = row.bioguideId
            ? (
              <Link href={`/sponsors/${row.bioguideId}`} key={`${row.name}-${row.state ?? 'x'}`}>
                {dot}
              </Link>
            )
            : <g key={`${row.name}-${row.state ?? 'x'}`}>{dot}</g>;

          return (
            <g key={`g-${row.name}-${row.state ?? 'x'}`}>
              {wrapped}
              {labelNames.has(row.name) && (
                <text
                  x={x + LABEL_OFFSET}
                  y={y + 3}
                  fontSize="10"
                  fill="var(--text-secondary)"
                  fontFamily="var(--font-mono)"
                >
                  {shortName(row.name)}
                </text>
              )}
            </g>
          );
        })}
      </svg>

      {/* Legend */}
      <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-[11px] uppercase tracking-[0.5px] font-mono">
        <span className="inline-flex items-center gap-1">
          <span className="inline-block w-2 h-2 rounded-full" style={{ background: 'var(--party-republican)' }} />
          <span style={{ color: 'var(--party-republican)' }}>R</span>
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="inline-block w-2 h-2 rounded-full" style={{ background: 'var(--party-democrat)' }} />
          <span style={{ color: 'var(--party-democrat)' }}>D</span>
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="inline-block w-2 h-2 rounded-full" style={{ background: 'var(--party-independent)' }} />
          <span style={{ color: 'var(--party-independent)' }}>I</span>
        </span>
        <span className="text-[var(--text-muted)] ml-4">
          {rows.length} sponsors · 3+ bills · non-ceremonial
        </span>
      </div>
    </div>
  );
}

function shortName(full: string): string {
  // 'Rep. John A. Smith Jr.' → 'Smith'. Pull the last word that's not a suffix.
  const SUFFIXES = new Set(['Jr.', 'Sr.', 'II', 'III', 'IV']);
  const parts = full.replace(/^(Rep\.|Sen\.|Del\.|Res\.|Hon\.)\s+/i, '').split(/\s+/);
  for (let i = parts.length - 1; i >= 0; i--) {
    if (!SUFFIXES.has(parts[i])) return parts[i].replace(/[.,]$/, '');
  }
  return full;
}
```

Implementation notes:

- **Dot overlap.** With ~300 dots in a 1000-wide chart, overlap is inevitable. `fillOpacity={0.7}` lets overlapping dots blend visually rather than stack opaquely.
- **Label collision** isn't solved in v1. The ~10 labels are likely to be near each other (top-volume sponsors cluster). If labels overlap badly in practice, add a simple anti-collision pass (vertical offset by index) in a follow-up; for v1 readers can cross-reference with the sponsor list below.
- **Link wrapping.** `<Link>` around the `<circle>` works in SVG and gives the dot keyboard/click semantics. If a dot has no `bioguideId`, it's just an inert circle.
- **`shortName` heuristic** handles the common formats — `"Rep. Smith, John"`, `"Smith, John A. Jr."`, etc. — well enough for labels. Edge cases lose to readability; if a label looks wrong on inspection, refine the helper.

## Page integration (`app/sponsors/page.tsx`)

Above the existing sponsor list, add a section block:

```tsx
import { SponsorProductivityScatter } from '@/components/SponsorProductivityScatter';

// ... existing imports, fetches ...

<section className="py-6">
  <h2 className="text-[12px] uppercase tracking-[0.5px] text-[var(--text-muted)] mb-3">
    Sponsor productivity
  </h2>
  <SponsorProductivityScatter />
</section>

{/* existing sponsor list below */}
```

Match the spacing pattern from the home dashboard's chart sections. Section header is 12px uppercase tracking, consistent with the rest of the page chrome.

## SKILL.md update

In the `/sponsors` page entry, append:

> A productivity scatter chart sits above the sponsor list: each current-Congress sponsor with 3+ bills is a dot at `(billCount, passRate)`, colored by party. Pass rate = bills whose stage advanced beyond `introduced` / total non-ceremonial bills (excludes `stage IS NULL` and `stage = 'other'`). Top 5 by volume + top 5 by pass rate get name labels. Dots link to the member hub when a `bioguide_id` is available. See `components/SponsorProductivityScatter.tsx` and `getSponsorProductivity()` in `lib/queries.ts`.

## Verification

1. `npm run typecheck` — clean.
2. `npm run build` — clean.
3. Visit `/sponsors` — chart renders above the sponsor list. Visible dot cloud, party-colored, with ~10 outlier labels.
4. Spot-check: top-right corner of the chart (high volume + high pass rate) should be sparse — that's the "high productivity" quadrant. Top-left (low volume, high pass rate) should also have a few dots — sponsors with 3-5 bills mostly advancing. Bottom-right (high volume, low pass rate) is the "introduction mill" quadrant.
5. Click a labeled dot — navigates to `/sponsors/[bioguideId]`. Click an unlabeled dot — same behavior if `bioguideId` is set; inert if null.
6. Cross-check one row against the sponsor list below — same `billCount` should appear on both surfaces for the same sponsor.
7. SQL sanity:
   ```sql
   SELECT sponsor_name, COUNT(*),
     SUM(CASE WHEN stage IN ('committee','floor','other_chamber','president','enacted') THEN 1 ELSE 0 END)
   FROM bills
   WHERE congress = (SELECT MAX(congress) FROM bills)
     AND (is_ceremonial = 0 OR is_ceremonial IS NULL)
     AND stage IS NOT NULL AND stage != 'other'
   GROUP BY sponsor_name
   HAVING COUNT(*) >= 3
   ORDER BY 2 DESC LIMIT 10;
   ```
   Top 10 here should match the top 10 names by X position in the chart.
8. Eyeball legend — bottom-left of chart shows `R / D / I` swatches and the sponsor-count line.

## Acceptance

`/sponsors` has an analytical surface above the sponsor list. Readers see at a glance who's working volume vs. who's actually moving bills, separated by party. Visualizations theme advances from 40% to ~55%.

After this: visualizations remaining (118th-vs-119th overlay on reports, chamber-faceted topic distribution) are theme-5 follow-ups. Other open candidates: news validation (when Monday data lands), CCBT parity batch, FEC donor pipeline take-2, member committee assignments (needs an API/source verification pass first). User picks.
