# Handoff 90 — Palestine scorecard (USCPR) sync + member hub display

## What this is

Pulls the USCPR Senate Palestine voting scorecard from a public Google Sheet, stores it in the DB, and surfaces it on Senate Democrat member hubs as a clearly attributed "Key Votes" section. No LLM matching — the sheet is the authoritative source for this data.

Scope: Senate Democrats only (that's what the sheet covers). Republican senators and House members get no section. Sheet covers 23 specific votes across 118th and 119th Congress.

## Step 1 — Schema

Add to `scripts/migrate.ts` and run `npm run migrate`:

```sql
CREATE TABLE IF NOT EXISTS palestine_scorecard (
  bioguide_id TEXT PRIMARY KEY REFERENCES members(bioguide_id),
  grade TEXT,                    -- 'A' | 'B' | 'C' | 'D' | 'F'
  rank INTEGER,
  sponsor_score TEXT,            -- percentage string e.g. "100%"
  voting_score TEXT,
  total_score TEXT,
  votes_json TEXT NOT NULL,      -- JSON object: { "UNRWA Funding Emergency Restoration Act": "Yes", ... }
  synced_at TEXT NOT NULL
);
```

## Step 2 — Sync script

Create `scripts/sync-palestine.ts`:

```ts
import { getDb } from '../lib/db'

const SHEET_URL =
  'https://docs.google.com/spreadsheets/d/1VU1y_jSb2hanU2MrLsjRx8tujB-C--UAQ2EahaTXGUo/export?format=csv&gid=1260635943'

// The 23 vote columns by index (0-based from the raw CSV row)
// Indices 8-30 in the sheet (columns 9-31 per the audit)
const VOTE_COLUMN_INDICES = [8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30]

// Column indices for key metadata
const COL = {
  grade: 0,
  rank: 1,
  firstName: 2,
  lastName: 3,
  state: 4,
  sponsorScore: 5,
  votingScore: 6,
  totalScore: 7,
}

async function parseCSV(text: string): Promise<string[][]> {
  // Basic CSV parser that handles quoted fields with embedded commas/newlines
  const rows: string[][] = []
  let current: string[] = []
  let field = ''
  let inQuote = false

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (ch === '"') {
      if (inQuote && text[i + 1] === '"') { field += '"'; i++ }
      else inQuote = !inQuote
    } else if (ch === ',' && !inQuote) {
      current.push(field); field = ''
    } else if ((ch === '\n' || ch === '\r') && !inQuote) {
      if (ch === '\r' && text[i + 1] === '\n') i++
      current.push(field); field = ''
      rows.push(current); current = []
    } else {
      field += ch
    }
  }
  if (field || current.length) { current.push(field); rows.push(current) }
  return rows
}

async function main() {
  const db = getDb()
  const now = new Date().toISOString()

  const res = await fetch(SHEET_URL)
  if (!res.ok) throw new Error(`Sheet fetch failed: ${res.status}`)
  const text = await res.text()

  const rows = await parseCSV(text)
  const headerRow = rows[0]

  // Build vote labels from header row at the vote column positions
  const voteLabels = VOTE_COLUMN_INDICES.map(i => headerRow[i]?.trim() ?? `vote_${i}`)

  let upserted = 0
  let skipped = 0

  for (const row of rows.slice(1)) {
    const firstName = row[COL.firstName]?.trim()
    const lastName = row[COL.lastName]?.trim()
    const state = row[COL.state]?.trim()
    const grade = row[COL.grade]?.trim()

    if (!firstName || !lastName || !state || !grade) continue

    // Match to members table by name + state
    // The sheet uses full state names; members table uses 2-letter abbreviations
    const memberResult = await db.execute({
      sql: `SELECT bioguide_id FROM members
            WHERE LOWER(name) LIKE LOWER(?) AND state = ?
              AND chamber = 'senate'
            LIMIT 1`,
      args: [`%${lastName}%`, await stateAbbr(state)],
    })

    const bioguideId = memberResult.rows[0]?.bioguide_id as string | undefined
    if (!bioguideId) {
      console.log(`  No match: ${firstName} ${lastName} (${state})`)
      skipped++
      continue
    }

    // Build votes JSON object
    const votesObj: Record<string, string> = {}
    for (let j = 0; j < VOTE_COLUMN_INDICES.length; j++) {
      const val = row[VOTE_COLUMN_INDICES[j]]?.trim()
      if (val) votesObj[voteLabels[j]] = val
    }

    await db.execute({
      sql: `INSERT INTO palestine_scorecard
              (bioguide_id, grade, rank, sponsor_score, voting_score, total_score, votes_json, synced_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(bioguide_id) DO UPDATE SET
              grade = excluded.grade,
              rank = excluded.rank,
              sponsor_score = excluded.sponsor_score,
              voting_score = excluded.voting_score,
              total_score = excluded.total_score,
              votes_json = excluded.votes_json,
              synced_at = excluded.synced_at`,
      args: [
        bioguideId,
        grade,
        parseInt(row[COL.rank]) || null,
        row[COL.sponsorScore]?.trim() ?? null,
        row[COL.votingScore]?.trim() ?? null,
        row[COL.totalScore]?.trim() ?? null,
        JSON.stringify(votesObj),
        now,
      ],
    })
    upserted++
  }

  console.log(`Done — upserted: ${upserted}, skipped (no member match): ${skipped}`)
}

// Convert full state name to 2-letter abbreviation
function stateAbbr(name: string): string {
  const map: Record<string, string> = {
    'Alabama':'AL','Alaska':'AK','Arizona':'AZ','Arkansas':'AR','California':'CA',
    'Colorado':'CO','Connecticut':'CT','Delaware':'DE','Florida':'FL','Georgia':'GA',
    'Hawaii':'HI','Idaho':'ID','Illinois':'IL','Indiana':'IN','Iowa':'IA',
    'Kansas':'KS','Kentucky':'KY','Louisiana':'LA','Maine':'ME','Maryland':'MD',
    'Massachusetts':'MA','Michigan':'MI','Minnesota':'MN','Mississippi':'MS','Missouri':'MO',
    'Montana':'MT','Nebraska':'NE','Nevada':'NV','New Hampshire':'NH','New Jersey':'NJ',
    'New Mexico':'NM','New York':'NY','North Carolina':'NC','North Dakota':'ND','Ohio':'OH',
    'Oklahoma':'OK','Oregon':'OR','Pennsylvania':'PA','Rhode Island':'RI','South Carolina':'SC',
    'South Dakota':'SD','Tennessee':'TN','Texas':'TX','Utah':'UT','Vermont':'VT',
    'Virginia':'VA','Washington':'WA','West Virginia':'WV','Wisconsin':'WI','Wyoming':'WY',
  }
  return map[name] ?? name
}

main().catch(console.error)
```

Add npm script:
```json
"sync:palestine": "tsx scripts/sync-palestine.ts"
```

## Step 3 — Run and check match rate

```powershell
npm run sync:palestine
```

Expect 40-47 upserted (the sheet has ~47 Senate Democrats). "No match" lines indicate name mismatches — check a few manually and adjust the LIKE query if needed (e.g. "Bernie Sanders" in sheet vs "Bernard Sanders" in DB).

After sync:
```sql
SELECT grade, COUNT(*) FROM palestine_scorecard GROUP BY grade ORDER BY grade;
SELECT bioguide_id, grade, total_score FROM palestine_scorecard ORDER BY rank LIMIT 10;
```

## Step 4 — Query helper

Add to `lib/queries.ts`:

```ts
export async function getPalestineScorecard(bioguideId: string): Promise<{
  grade: string
  rank: number | null
  sponsor_score: string | null
  voting_score: string | null
  total_score: string | null
  votes: Record<string, string>
} | null> {
  const db = getDb()
  const result = await db.execute({
    sql: `SELECT grade, rank, sponsor_score, voting_score, total_score, votes_json
          FROM palestine_scorecard WHERE bioguide_id = ?`,
    args: [bioguideId],
  })
  const row = result.rows[0]
  if (!row) return null
  return {
    grade: row.grade as string,
    rank: row.rank as number | null,
    sponsor_score: row.sponsor_score as string | null,
    voting_score: row.voting_score as string | null,
    total_score: row.total_score as string | null,
    votes: JSON.parse(row.votes_json as string),
  }
}
```

## Step 5 — Member hub display

In `app/members/[bioguideId]/page.tsx`, add:

```ts
import { getPalestineScorecard } from '@/lib/queries'

const scorecard = await getPalestineScorecard(bioguideId)
```

In the JSX, add a "Key Votes" section — only renders if `scorecard` is non-null:

```tsx
{scorecard && (
  <section className="w-full px-4 py-3 border-t" style={{ borderColor: 'var(--border-soft)' }}>
    {/* Header */}
    <div className="flex items-baseline justify-between mb-2">
      <span style={{ color: 'var(--text-muted)', fontSize: '12px', letterSpacing: '0.5px' }}>
        PALESTINE SCORECARD
      </span>
      <a
        href="https://docs.google.com/spreadsheets/d/1VU1y_jSb2hanU2MrLsjRx8tujB-C--UAQ2EahaTXGUo"
        target="_blank"
        rel="noopener noreferrer"
        style={{ color: 'var(--text-dim)', fontSize: '11px' }}
      >
        via USCPR ↗
      </a>
    </div>

    {/* Summary row */}
    <div className="flex gap-4 mb-3">
      <span style={{ color: 'var(--accent-amber-bright)', fontSize: '24px', fontWeight: 'bold' }}>
        {scorecard.grade}
      </span>
      <div className="flex flex-col justify-center">
        <span style={{ color: 'var(--text-secondary)', fontSize: '12px' }}>
          Score: {scorecard.total_score}
        </span>
        {scorecard.rank && (
          <span style={{ color: 'var(--text-dim)', fontSize: '12px' }}>
            Rank #{scorecard.rank} of 47
          </span>
        )}
      </div>
    </div>

    {/* Per-vote table */}
    <div className="flex flex-col gap-1">
      {Object.entries(scorecard.votes).map(([label, outcome]) => (
        <div key={label} className="flex items-start justify-between gap-2">
          <span style={{ color: 'var(--text-muted)', fontSize: '12px', flex: 1 }}>
            {label}
          </span>
          <span style={{
            fontSize: '12px',
            flexShrink: 0,
            color: outcome.toLowerCase().includes('yes') || outcome.toLowerCase().includes('yea')
              ? 'var(--vote-yea)'
              : outcome.toLowerCase().includes('no') || outcome.toLowerCase().includes('nay')
              ? 'var(--vote-nay)'
              : 'var(--text-dim)',
          }}>
            {outcome}
          </span>
        </div>
      ))}
    </div>
  </section>
)}
```

## Step 6 — Verify

Load `/members/[bioguide_id_of_bernie_sanders]` and confirm:
- "PALESTINE SCORECARD" section renders with grade A
- Per-vote table shows all 23 rows
- "via USCPR ↗" attribution link present
- Load a Republican senator — section absent

## Step 7 — Add to cron (optional)

The sheet is maintained by USCPR and updates occasionally. Monthly sync is sufficient. Can wire into the existing cron or leave as manual — call this optional for the handoff and do it as a follow-up.

## Acceptance criteria

1. `palestine_scorecard` table populated with ≥40 rows
2. Grade distribution plausible (mostly C-F for Senate Dems per the data)
3. Section renders on a Senate Democrat hub with grade + per-vote table
4. Section absent on Republican senators and House members
5. USCPR attribution link present
6. No crashes when `scorecard` is null

## Attribution note

This data is from the US Campaign for Palestinian Rights (USCPR) scorecard. Display it as clearly third-party data — the attribution link is required, not optional. The dashboard presents their methodology; users should follow the link to understand how grades are calculated.
