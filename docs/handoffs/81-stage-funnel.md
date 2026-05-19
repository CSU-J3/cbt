# Handoff 81 — Stage funnel visualization

## What this is

A horizontal bar chart on the home dashboard showing how many bills are currently at each legislative stage. Directly answers the "bottleneck of the moment" question from the framing doc. First chart on the dashboard; sets the visual idiom for all future charts.

## Design spec

Terminal aesthetic. No chart library — hand-rolled with inline SVG or a `<div>`-based bar layout in Tailwind. Recharts is available but its default styling fights the dark monospace look. Use divs and CSS.

### Layout

Section sits between the LLM summary block and the bill feed on the home page (`app/page.tsx`). Full-width panel, same horizontal padding as the feed rows (`px-4`).

### Visual structure

```
STAGE DISTRIBUTION                              15,677 BILLS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
▸ INTRO          ████████████████████████████░░░░   11,203  71.5%
▸▸ COMMITTEE     █████░░░░░░░░░░░░░░░░░░░░░░░░░░░    2,891  18.4%
▸▸▸ FLOOR        ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░      147   0.9%
▸▸▸▸ OTHER       ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░      312   2.0%
▸▸▸▸▸ PRESIDENT  ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░        4   0.0%
✓ ENACTED        ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░       89   0.6%
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

- Stage label: left column, fixed width, same glyph + color as `StageIndicator` component
- Bar: fills proportionally to the largest stage (introduced = 100% width reference). Not absolute percentage of total — relative to the max so small stages are visible.
- Count: right-aligned integer
- Percentage: dim, right of count, `--text-dim` color
- Bar color: matches the stage CSS var (`--stage-introduced`, `--stage-committee`, etc.)
- Bar background: `--border-soft` or `--bg-panel`
- `NULL` stage rows: excluded from the chart entirely

### Header row

```
STAGE DISTRIBUTION                    {total} BILLS
```

`STAGE DISTRIBUTION` in `--text-muted`, `{total} BILLS` right-aligned in `--text-dim`. Same header style as `BILLS AT DESK` on `/president`.

### Clicking a bar

Each row is a link to `/?stage={stage}` — filters the feed to that stage. Same pattern as `StageFilter` chip clicks.

## Implementation

### Query

Add `getStageCounts()` to `lib/queries.ts`:

```ts
export async function getStageCounts(): Promise<{ stage: string; count: number }[]> {
  const result = await db.execute(`
    SELECT stage, COUNT(*) as count
    FROM bills
    WHERE stage IS NOT NULL AND summary IS NOT NULL
    GROUP BY stage
    ORDER BY count DESC
  `)
  return result.rows.map(r => ({
    stage: r.stage as string,
    count: r.count as number,
  }))
}
```

Wrap in `unstable_cache` with tag `"stage-counts"` — same pattern as `getFeedStats`. Add `revalidateTag("stage-counts")` to the cron route alongside the existing revalidations.

### Component

Create `components/StageFunnel.tsx` as a server component (no client state needed — it's read-only display):

```tsx
import Link from 'next/link'

const STAGE_ORDER = [
  'introduced',
  'committee',
  'floor',
  'other_chamber',
  'president',
  'enacted',
] as const

const STAGE_LABELS: Record<string, string> = {
  introduced: '▸ INTRO',
  committee: '▸▸ COMMITTEE',
  floor: '▸▸▸ FLOOR',
  other_chamber: '▸▸▸▸ OTHER CHAMBER',
  president: '▸▸▸▸▸ PRESIDENT',
  enacted: '✓ ENACTED',
}

const STAGE_VARS: Record<string, string> = {
  introduced: 'var(--stage-introduced)',
  committee: 'var(--stage-committee)',
  floor: 'var(--stage-floor)',
  other_chamber: 'var(--stage-other-chamber)',
  president: 'var(--stage-president)',
  enacted: 'var(--stage-enacted)',
}

type StageCount = { stage: string; count: number }

export function StageFunnel({ counts }: { counts: StageCount[] }) {
  const countMap = Object.fromEntries(counts.map(c => [c.stage, c.count]))
  const total = counts.reduce((s, c) => s + c.count, 0)
  const max = Math.max(...counts.map(c => c.count), 1)

  return (
    <div className="w-full px-4 py-3 border-b" style={{ borderColor: 'var(--border-soft)' }}>
      {/* Header */}
      <div className="flex justify-between items-baseline mb-2">
        <span style={{ color: 'var(--text-muted)', fontSize: '12px', letterSpacing: '0.5px' }}>
          STAGE DISTRIBUTION
        </span>
        <span style={{ color: 'var(--text-dim)', fontSize: '12px' }}>
          {total.toLocaleString()} BILLS
        </span>
      </div>

      {/* Rows */}
      <div className="flex flex-col gap-1">
        {STAGE_ORDER.map(stage => {
          const count = countMap[stage] ?? 0
          const pct = total > 0 ? ((count / total) * 100).toFixed(1) : '0.0'
          const barWidth = max > 0 ? (count / max) * 100 : 0
          const color = STAGE_VARS[stage]

          return (
            <Link
              key={stage}
              href={`/?stage=${stage}`}
              className="flex items-center gap-2 group"
              style={{ textDecoration: 'none' }}
            >
              {/* Stage label */}
              <span
                style={{
                  color,
                  fontSize: '12px',
                  letterSpacing: '0.5px',
                  width: '160px',
                  flexShrink: 0,
                }}
              >
                {STAGE_LABELS[stage]}
              </span>

              {/* Bar track */}
              <div
                className="flex-1 relative"
                style={{
                  height: '10px',
                  background: 'var(--border-soft)',
                  borderRadius: '1px',
                }}
              >
                <div
                  style={{
                    position: 'absolute',
                    left: 0,
                    top: 0,
                    height: '100%',
                    width: `${barWidth}%`,
                    background: color,
                    opacity: 0.85,
                    borderRadius: '1px',
                    transition: 'opacity 150ms',
                  }}
                  className="group-hover:opacity-100"
                />
              </div>

              {/* Count + pct */}
              <span
                style={{
                  fontSize: '12px',
                  color: 'var(--text-secondary)',
                  width: '52px',
                  textAlign: 'right',
                  fontVariantNumeric: 'tabular-nums',
                  flexShrink: 0,
                }}
              >
                {count.toLocaleString()}
              </span>
              <span
                style={{
                  fontSize: '12px',
                  color: 'var(--text-dim)',
                  width: '40px',
                  textAlign: 'right',
                  fontVariantNumeric: 'tabular-nums',
                  flexShrink: 0,
                }}
              >
                {pct}%
              </span>
            </Link>
          )
        })}
      </div>
    </div>
  )
}
```

### Wire into home page

In `app/page.tsx`:

```tsx
import { getStageCounts } from '@/lib/queries'
import { StageFunnel } from '@/components/StageFunnel'

// Inside the page component, alongside other queries:
const stageCounts = await getStageCounts()

// In the JSX, between the summary block and the feed:
<StageFunnel counts={stageCounts} />
```

If there's no summary block yet on the home page, place it directly above the filter chrome / feed header row.

## Cron wiring

In `app/api/sync/route.ts`, add after the existing revalidations:

```ts
revalidateTag('stage-counts')
```

## Verification

1. Home page renders the funnel without layout breaks
2. Each bar color matches the corresponding `StageIndicator` color for that stage
3. Clicking a bar navigates to `/?stage=introduced` (or whichever stage) and the feed filters correctly
4. `NULL`-stage bills are excluded from both the chart and the total count
5. Numbers roughly match what `SELECT stage, COUNT(*) FROM bills WHERE stage IS NOT NULL GROUP BY stage` returns

## Out of scope

- Ceremonial filter toggle on the funnel (add after `is_ceremonial` lands)
- Animation on bar fill
- Mobile layout changes (the label column may need to shrink — eyeball it and abbreviate if it overflows at 375px)
- Historical comparison overlay (118th vs 119th) — that's a separate visualization handoff
