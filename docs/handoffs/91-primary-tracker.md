# Handoff 91 — Primary tracker: calendar + Senate candidates

## What this is

Phase 1 of the full primary tracker. Ships:
1. State-level primary calendar (all 50 states, 2026 cycle)
2. Senate primary candidate rosters (33 races)
3. `/primaries` index page sorted by upcoming primary date
4. Primary date surfaced on member hubs and `/races`

House candidate rosters (435 races) are Phase 2 — too many Ballotpedia pages to scrape in one handoff. Results ingestion deferred until a free source is identified.

Note: today is May 19, 2026 — primaries are actively happening. Pennsylvania, Alabama, Georgia, Idaho, Kentucky, Oregon are voting today. Treat this as live infrastructure, not future planning.

## Step 1 — Schema

Add to `scripts/migrate.ts` and run `npm run migrate`:

```sql
CREATE TABLE IF NOT EXISTS primaries (
  id TEXT PRIMARY KEY,              -- e.g. "senate-PA-2026-D" or "house-PA-07-2026-R"
  state TEXT NOT NULL,
  district TEXT,                    -- NULL for Senate; "07" for House
  chamber TEXT NOT NULL,            -- 'house' | 'senate'
  party TEXT NOT NULL,              -- 'D' | 'R' | 'open' (top-two states)
  primary_date TEXT,                -- ISO date e.g. "2026-05-19"
  runoff_date TEXT,                 -- ISO date, nullable
  primary_type TEXT,                -- 'closed' | 'open' | 'top_two' | 'top_four' | 'ranked_choice'
  race_id TEXT REFERENCES races(id), -- link to existing races table
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS primary_candidates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  primary_id TEXT NOT NULL REFERENCES primaries(id),
  name TEXT NOT NULL,
  party TEXT NOT NULL,
  incumbent INTEGER DEFAULT 0,      -- 1 if current officeholder
  bioguide_id TEXT REFERENCES members(bioguide_id),  -- nullable; link if matched
  status TEXT DEFAULT 'running',    -- 'running' | 'withdrawn' | 'winner' | 'lost'
  vote_pct REAL,                    -- populated after results; nullable
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_primaries_date ON primaries(primary_date);
CREATE INDEX IF NOT EXISTS idx_primary_candidates_primary ON primary_candidates(primary_id);
```

## Step 2 — Primary calendar sync

Scrape 270toWin's statewide primary calendar for all 2026 congressional primary dates.

First probe: fetch and check if dates are in static HTML:

```
fetch('https://www.270towin.com/2026-state-primary-calendar/')
```

If static (likely — 270toWin renders server-side), parse the state → date table. Expected structure: a table or list with state name and primary date.

Create `lib/primary-calendar-scrape.ts`:

```ts
export type StatePrimaryDate = {
  state: string          // 2-letter abbreviation
  primaryDate: string    // ISO date
  runoffDate: string | null
  primaryType: 'closed' | 'open' | 'top_two' | 'top_four' | 'ranked_choice'
}

// Known top-two states (all candidates, top 2 advance)
const TOP_TWO_STATES = new Set(['CA', 'WA'])
// Top-four (Alaska)
const TOP_FOUR_STATES = new Set(['AK'])
// Ranked choice (Maine, DC)
const RANKED_CHOICE_STATES = new Set(['ME', 'DC'])

export async function scrapeStatePrimaryCalendar(): Promise<StatePrimaryDate[]> {
  const res = await fetch('https://www.270towin.com/2026-state-primary-calendar/', {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; research bot)' }
  })
  const html = await res.text()
  // Parse the state-date table — update selectors after probing actual HTML
  // ...
}
```

Report the actual HTML structure before implementing the parser.

## Step 3 — Senate candidate sync

Scrape Ballotpedia for each Senate race's candidate list. We already proved Ballotpedia's MediaWiki pages are scrape-friendly (HO 88 used the same pattern).

Per-race URL pattern:
```
https://ballotpedia.org/United_States_Senate_elections_in_{State},_2026
// e.g. https://ballotpedia.org/United_States_Senate_elections_in_Pennsylvania,_2026
```

For Democratic and Republican primaries separately:
```
https://ballotpedia.org/United_States_Senate_Democratic_Party_primaries,_2026
https://ballotpedia.org/United_States_Senate_Republican_Party_primaries,_2026
```

Create `scripts/sync-primaries.ts`:

```ts
import { getDb } from '../lib/db'
import { scrapeStatePrimaryCalendar } from '../lib/primary-calendar-scrape'

const SENATE_STATES_2026 = [
  // 33 regular elections + 2 specials (FL, OH)
  'AL', 'AK', 'AR', 'CO', 'DE', 'GA', 'ID', 'IL', 'IA', 'KS',
  'KY', 'LA', 'ME', 'MA', 'MI', 'MN', 'MS', 'MT', 'NE', 'NH',
  'NJ', 'NM', 'NC', 'OK', 'OR', 'RI', 'SC', 'SD', 'TN', 'TX',
  'VA', 'WA', 'WY',
  // Specials
  'FL', 'OH',
]

async function syncCalendar() {
  const db = getDb()
  const calendar = await scrapeStatePrimaryCalendar()
  const now = new Date().toISOString()

  for (const entry of calendar) {
    // Upsert D and R primary rows for each state
    for (const party of ['D', 'R'] as const) {
      const id = `senate-${entry.state}-2026-${party}`
      await db.execute({
        sql: `INSERT INTO primaries (id, state, chamber, party, primary_date, runoff_date, primary_type, updated_at)
              VALUES (?, ?, 'senate', ?, ?, ?, ?, ?)
              ON CONFLICT(id) DO UPDATE SET
                primary_date = excluded.primary_date,
                runoff_date = excluded.runoff_date,
                updated_at = excluded.updated_at`,
        args: [id, entry.state, party, entry.primaryDate, entry.runoffDate, entry.primaryType, now],
      })
    }

    // top_two / top_four states: also insert an 'open' row
    if (entry.primaryType === 'top_two' || entry.primaryType === 'top_four') {
      const id = `senate-${entry.state}-2026-open`
      await db.execute({
        sql: `INSERT INTO primaries (id, state, chamber, party, primary_date, primary_type, updated_at)
              VALUES (?, ?, 'senate', 'open', ?, ?, ?)
              ON CONFLICT(id) DO UPDATE SET primary_date = excluded.primary_date, updated_at = excluded.updated_at`,
        args: [id, entry.state, entry.primaryDate, entry.primaryType, now],
      })
    }
  }

  console.log(`Calendar synced: ${calendar.length} states`)
}

async function syncSenateCandidates() {
  // Scrape Ballotpedia per-state Senate pages
  // For each state in SENATE_STATES_2026, fetch candidate list
  // Match candidates to members table by name + state
  // Upsert into primary_candidates
  // Implementation: follow the same cheerio/regex pattern from HO 88
}

async function main() {
  await syncCalendar()
  await syncSenateCandidates()
}

main().catch(console.error)
```

**Before implementing `syncSenateCandidates`**: probe one Ballotpedia Senate page to see the candidate table structure:

```
fetch('https://ballotpedia.org/United_States_Senate_elections_in_Pennsylvania,_2026')
```

Report the HTML structure of the candidates section before writing the parser.

Add npm script:
```json
"sync:primaries": "tsx scripts/sync-primaries.ts"
```

## Step 4 — Query helpers

Add to `lib/queries.ts`:

```ts
export type PrimaryWithCandidates = {
  id: string
  state: string
  district: string | null
  chamber: string
  party: string
  primary_date: string | null
  runoff_date: string | null
  primary_type: string | null
  race_id: string | null
  candidates: {
    id: number
    name: string
    party: string
    incumbent: boolean
    bioguide_id: string | null
    status: string
    vote_pct: number | null
  }[]
}

export async function getUpcomingPrimaries(limit = 50): Promise<PrimaryWithCandidates[]> {
  const db = getDb()
  const today = new Date().toISOString().split('T')[0]
  const result = await db.execute({
    sql: `SELECT p.*, GROUP_CONCAT(
            pc.id || '|' || pc.name || '|' || pc.party || '|' ||
            pc.incumbent || '|' || COALESCE(pc.bioguide_id,'') || '|' ||
            pc.status || '|' || COALESCE(pc.vote_pct,'')
          ) as candidates_raw
          FROM primaries p
          LEFT JOIN primary_candidates pc ON pc.primary_id = p.id
          WHERE p.primary_date >= ?
          GROUP BY p.id
          ORDER BY p.primary_date ASC, p.state ASC
          LIMIT ?`,
    args: [today, limit],
  })
  return result.rows.map(row => ({
    ...(row as any),
    candidates: parseCandidatesRaw(row.candidates_raw as string | null),
  }))
}

export async function getPrimaryForRace(
  state: string,
  district: string | null,
  chamber: string,
  party: string
): Promise<PrimaryWithCandidates | null> {
  // Single primary lookup for member hub display
  const db = getDb()
  const id = district
    ? `house-${state}-${district}-2026-${party}`
    : `senate-${state}-2026-${party}`
  // ... fetch + parse
}

function parseCandidatesRaw(raw: string | null) {
  if (!raw) return []
  return raw.split(',').map(c => {
    const [id, name, party, incumbent, bioguideId, status, votePct] = c.split('|')
    return {
      id: parseInt(id),
      name,
      party,
      incumbent: incumbent === '1',
      bioguide_id: bioguideId || null,
      status,
      vote_pct: votePct ? parseFloat(votePct) : null,
    }
  })
}
```

## Step 5 — `/primaries` index page

Create `app/primaries/page.tsx`:

- Header: `UPCOMING PRIMARIES` + count
- Grouped by date (today first, then future dates as sub-headers)
- Each row: state, district, chamber, party label, candidate count, days until primary
- Color: D rows use `--party-democrat`, R rows use `--party-republican`
- Past primaries (primary_date < today) shown in a collapsed "Past" section
- Click row → expand to show candidate list inline (URL-driven, same pattern as feed)
- Nav link: add `PRIMARIES` between `RACES` and `STALE`

## Step 6 — Wire into member hub

In `app/members/[bioguideId]/page.tsx`, show the member's upcoming primary in the bio header:

```tsx
{memberPrimary && (
  <span style={{ color: 'var(--accent-amber)', fontSize: '12px' }}>
    PRIMARY {memberPrimary.party === 'D' ? 'DEM' : 'REP'}: {formatDateShort(memberPrimary.primary_date)}
    {daysUntil(memberPrimary.primary_date) <= 30 && (
      <span style={{ color: 'var(--party-republican)' }}>
        {' '}({daysUntil(memberPrimary.primary_date)}d)
      </span>
    )}
  </span>
)}
```

## Step 7 — Wire into `/races`

On the `/races` page, add a `PRIMARY` column showing the primary date for each race's incumbent party. Keep it compact — just the date, colored red if within 30 days.

## Acceptance criteria

1. `primaries` table has rows for all 50 states (D + R = 100 rows minimum)
2. Senate primary candidates seeded for ≥20 of the 33 races
3. `/primaries` page renders, sorted by upcoming date
4. Pennsylvania primary shows as today (May 19, 2026)
5. Member hub shows primary date in bio header for members with an active primary
6. Nav includes `PRIMARIES` link
7. Build passes

## Phase 2 (follow-up handoffs)

- **HO 92**: House primary candidate rosters (435 Ballotpedia pages — scrape in batches)
- **HO 93**: Results ingestion — identify a free source (Ballotpedia results pages, state SOS feeds) and wire up. Currently the biggest gap.
- **HO 94**: Primary polling — limited data available; surface where Cook/Sabato have rated competitive primaries
