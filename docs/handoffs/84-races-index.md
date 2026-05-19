# Handoff 84 — Races index page + competitive House races

## What this is

Two things: a `/races` index page that surfaces all tracked races in one view, and competitive House race data to fill the House gap. Senate races (105 ratings, 35 races) are already in the DB; this handoff gives them a home page and adds the ~30-40 House seats worth tracking.

## Step 1 — Audit the existing races schema

Before touching anything, run:

```sql
PRAGMA table_info(races);
SELECT * FROM races LIMIT 3;
SELECT r.id, r.state, r.district, r.seat_type, r.incumbent_bioguide_id,
       COUNT(rr.id) as rating_count
FROM races r
LEFT JOIN race_ratings rr ON rr.race_id = r.id
GROUP BY r.id
ORDER BY r.state, r.district
LIMIT 10;
```

Report the full `races` schema and a sample of what's there. Don't touch anything until the schema is confirmed.

## Step 2 — Competitive House races data

Only add races with a non-solid rating from at least one source (Cook, Sabato, Inside Elections). "Solid R" and "Solid D" seats have no analytical value and would add 370+ rows of noise — skip them entirely, per the existing comment in SKILL.md.

Target: all House seats rated Toss-up, Tilt, Lean, or Likely by any of the three raters as of the most recent update. Roughly 30-40 seats for the 2026 cycle.

Sources to pull ratings from (manual entry or scrape):
- Cook Political Report: https://www.cookpolitical.com/ratings/house-race-ratings
- Sabato's Crystal Ball: https://centerforpolitics.org/crystalball/house/
- Inside Elections: https://insideelections.com/ratings/house

**Do not scrape programmatically without verifying the site allows it.** For this handoff, use static data — fetch the current ratings from those URLs now and hard-code them into a seed script. Ratings change slowly (weekly at most); a static seed is fine.

### Seed script approach

Create `scripts/seed-house-races-2026.ts`. Structure:

```ts
import { getDb } from '../lib/db'

// Only non-solid competitive races
// Format: [race_id, state, district, incumbent_name, incumbent_bioguide_id | null, cook, sabato, ie]
// Ratings: 'Solid D' | 'Likely D' | 'Lean D' | 'Toss-up' | 'Lean R' | 'Likely R' | 'Solid R'
// Use null for a rating if that source doesn't rate it competitive

const HOUSE_RACES_2026: Array<{
  id: string          // e.g. "AK-AL-2026"
  state: string       // 2-letter
  district: string    // "01" through "52", "AL" for at-large
  seat_type: string   // "house"
  incumbent_name: string | null
  incumbent_bioguide_id: string | null
  cook: string | null
  sabato: string | null
  ie: string | null
}> = [
  // POPULATE THIS FROM CURRENT RATINGS PAGES
  // Example entries (verify these against current ratings before committing):
  // { id: 'AK-AL-2026', state: 'AK', district: 'AL', seat_type: 'house',
  //   incumbent_name: 'Mary Peltola', incumbent_bioguide_id: 'P000619',
  //   cook: 'Toss-up', sabato: 'Toss-up', ie: 'Toss-up' },
]

async function seed() {
  const db = getDb()
  let racesInserted = 0
  let ratingsInserted = 0
  const now = new Date().toISOString()

  for (const race of HOUSE_RACES_2026) {
    // Upsert into races table
    await db.execute({
      sql: `INSERT INTO races (id, state, district, seat_type, cycle, incumbent_bioguide_id, updated_at)
            VALUES (?, ?, ?, 'house', 2026, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
              incumbent_bioguide_id = excluded.incumbent_bioguide_id,
              updated_at = excluded.updated_at`,
      args: [race.id, race.state, race.district, race.incumbent_bioguide_id, now],
    })
    racesInserted++

    // Upsert ratings for each source that has one
    const sources: Array<{ source: string; rating: string | null }> = [
      { source: 'cook', rating: race.cook },
      { source: 'sabato', rating: race.sabato },
      { source: 'inside_elections', rating: race.ie },
    ]

    for (const { source, rating } of sources) {
      if (!rating) continue
      await db.execute({
        sql: `INSERT INTO race_ratings (race_id, source, rating, cycle, updated_at)
              VALUES (?, ?, ?, 2026, ?)
              ON CONFLICT(race_id, source, cycle) DO UPDATE SET
                rating = excluded.rating,
                updated_at = excluded.updated_at`,
        args: [race.id, source, rating, now],
      })
      ratingsInserted++
    }
  }

  console.log(`Seeded ${racesInserted} races, ${ratingsInserted} ratings`)
}

seed().catch(console.error)
```

**Before running**, fetch the current ratings pages and populate `HOUSE_RACES_2026`. Read:
- https://www.cookpolitical.com/ratings/house-race-ratings
- https://centerforpolitics.org/crystalball/house/

Capture every seat rated anything other than Solid D/R. Include the incumbent's bioguide_id if they're in our `members` table (check by name + state).

Add npm script: `"seed:house-races": "tsx scripts/seed-house-races-2026.ts"`

## Step 3 — Query helpers

Add to `lib/queries.ts`:

```ts
export type RaceSummary = {
  id: string
  state: string
  district: string
  seat_type: string
  cycle: number
  incumbent_name: string | null
  incumbent_bioguide_id: string | null
  cook_rating: string | null
  sabato_rating: string | null
  ie_rating: string | null
  consensus_rating: string | null  // most competitive rating across sources
}

export async function getAllRaces(cycle = 2026): Promise<RaceSummary[]> {
  const db = getDb()
  // Join races with ratings, pivot sources into columns
  const result = await db.execute({
    sql: `
      SELECT
        r.id, r.state, r.district, r.seat_type, r.cycle,
        m.full_name as incumbent_name,
        r.incumbent_bioguide_id,
        MAX(CASE WHEN rr.source = 'cook' THEN rr.rating END) as cook_rating,
        MAX(CASE WHEN rr.source = 'sabato' THEN rr.rating END) as sabato_rating,
        MAX(CASE WHEN rr.source = 'inside_elections' THEN rr.rating END) as ie_rating
      FROM races r
      LEFT JOIN race_ratings rr ON rr.race_id = r.id AND rr.cycle = ?
      LEFT JOIN members m ON m.bioguide_id = r.incumbent_bioguide_id
      WHERE r.cycle = ?
      GROUP BY r.id
      ORDER BY r.seat_type DESC, r.state ASC, r.district ASC
    `,
    args: [cycle, cycle],
  })

  return result.rows.map(row => {
    const ratings = [row.cook_rating, row.sabato_rating, row.ie_rating]
      .filter(Boolean) as string[]
    return {
      ...(row as any),
      consensus_rating: mostCompetitiveRating(ratings),
    }
  })
}

// Returns the most competitive (closest to Toss-up) rating across sources
function mostCompetitiveRating(ratings: string[]): string | null {
  const order = [
    'Toss-up', 'Tilt D', 'Tilt R',
    'Lean D', 'Lean R',
    'Likely D', 'Likely R',
    'Solid D', 'Solid R',
  ]
  let best: string | null = null
  let bestIdx = Infinity
  for (const r of ratings) {
    const idx = order.indexOf(r)
    if (idx !== -1 && idx < bestIdx) {
      bestIdx = idx
      best = r
    }
  }
  return best
}
```

Wrap `getAllRaces` in `unstable_cache` with tag `"races"`.

## Step 4 — Races index page

Create `app/races/page.tsx`:

```tsx
import { getAllRaces } from '@/lib/queries'
import { HeaderBar } from '@/components/HeaderBar'
import { FooterLegend } from '@/components/FooterLegend'
import Link from 'next/link'

const RATING_COLORS: Record<string, string> = {
  'Toss-up': 'var(--stage-floor)',          // amber
  'Tilt D': 'var(--party-democrat)',
  'Tilt R': 'var(--party-republican)',
  'Lean D': 'var(--party-democrat)',
  'Lean R': 'var(--party-republican)',
  'Likely D': 'var(--party-democrat)',
  'Likely R': 'var(--party-republican)',
}

export default async function RacesPage() {
  const races = await getAllRaces(2026)
  const senate = races.filter(r => r.seat_type === 'senate')
  const house = races.filter(r => r.seat_type === 'house')

  return (
    <div className="w-full">
      <HeaderBar title="2026 COMPETITIVE RACES" count={races.length} unit="RACES" />

      {/* Senate section */}
      <div className="w-full px-4 py-2 border-b" style={{ borderColor: 'var(--border-soft)' }}>
        <span style={{ color: 'var(--text-muted)', fontSize: '12px', letterSpacing: '0.5px' }}>
          SENATE — {senate.length} COMPETITIVE SEATS
        </span>
      </div>
      <RaceTable races={senate} />

      {/* House section */}
      <div className="w-full px-4 py-2 border-b" style={{ borderColor: 'var(--border-soft)' }}>
        <span style={{ color: 'var(--text-muted)', fontSize: '12px', letterSpacing: '0.5px' }}>
          HOUSE — {house.length} COMPETITIVE SEATS
        </span>
      </div>
      <RaceTable races={house} />

      <FooterLegend />
    </div>
  )
}

function RaceTable({ races }: { races: RaceSummary[] }) {
  if (races.length === 0) {
    return (
      <div className="px-4 py-3" style={{ color: 'var(--text-dim)', fontSize: '13px' }}>
        No competitive races tracked.
      </div>
    )
  }

  return (
    <div className="w-full">
      {/* Header row */}
      <div className="w-full px-4 py-1 grid gap-2 border-b"
           style={{ gridTemplateColumns: '80px 1fr 110px 110px 110px 120px', borderColor: 'var(--border-soft)' }}>
        {['SEAT', 'INCUMBENT', 'COOK', 'SABATO', 'INSIDE ELEC', 'CONSENSUS'].map(h => (
          <span key={h} style={{ color: 'var(--text-dim)', fontSize: '12px', letterSpacing: '0.5px' }}>
            {h}
          </span>
        ))}
      </div>

      {races.map(race => (
        <Link
          key={race.id}
          href={`/race/${race.id}`}
          className="w-full px-4 py-2 grid gap-2 border-b hover:bg-[var(--bg-row-hover)] transition-colors"
          style={{ gridTemplateColumns: '80px 1fr 110px 110px 110px 120px', borderColor: 'var(--border-soft)', textDecoration: 'none' }}
        >
          <span style={{ color: 'var(--text-secondary)', fontSize: '13px', fontVariantNumeric: 'tabular-nums' }}>
            {race.state}{race.district !== 'AL' ? `-${race.district}` : ''}
          </span>
          <span style={{ color: 'var(--text-primary)', fontSize: '13px' }}>
            {race.incumbent_name ?? <span style={{ color: 'var(--text-dim)' }}>Open seat</span>}
          </span>
          {[race.cook_rating, race.sabato_rating, race.ie_rating, race.consensus_rating].map((rating, i) => (
            <span key={i} style={{
              color: rating ? (RATING_COLORS[rating] ?? 'var(--text-secondary)') : 'var(--text-dim)',
              fontSize: '12px',
            }}>
              {rating ?? '—'}
            </span>
          ))}
        </Link>
      ))}
    </div>
  )
}
```

## Step 5 — Wire into nav

In `components/HeaderBar.tsx` (or wherever the nav links live), add `RACES` to the navigation, between `SPONSORS` and `STALE` or wherever it fits the existing order.

## Step 6 — Verify

```sql
SELECT seat_type, COUNT(DISTINCT r.id) as races, COUNT(rr.id) as ratings
FROM races r
LEFT JOIN race_ratings rr ON rr.race_id = r.id
GROUP BY seat_type;
```

Expected: senate ~35 races, house ~30-40 races.

Load `/races` and confirm:
- Senate section lists all tracked Senate races
- House section lists all competitive House seats
- Clicking any row navigates to `/race/[id]`
- Each rating cell is colored by party lean

## Acceptance criteria

1. `/races` page renders without errors
2. Senate races all appear with tri-source ratings
3. House competitive races seeded (≥25 seats)
4. Incumbent names link back to member hubs where bioguide_id is present
5. Nav includes RACES link
6. No Solid D/Solid R seats in the DB

## Notes

- `full_name` vs `name` — check actual column name on `members` before using in the query; prior handoffs have flagged this inconsistency.
- The `races` table schema may differ slightly from what's assumed here — the Step 1 audit is mandatory before writing any SQL.
- If `ON CONFLICT(race_id, source, cycle)` fails (missing unique constraint), add it: `CREATE UNIQUE INDEX IF NOT EXISTS idx_race_ratings_unique ON race_ratings(race_id, source, cycle);`
