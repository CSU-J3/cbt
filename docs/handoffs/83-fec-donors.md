# Handoff 83 — FEC fundraising pipeline

## What this is

Pulls campaign fundraising totals from the FEC API for current members, stores them, and surfaces total raised + cash on hand on the member hub (`/sponsors/[bioguideId]`). No individual donor lists — just the cycle summary numbers that answer "how much has this member raised and what's left in the tank."

## Prerequisite check

First, inspect what FEC-related scaffolding already exists from the reverted OpenSecrets handoff:

```
grep -r "fec\|donor\|fundrais" lib/ scripts/ --include="*.ts" -l
grep -r "fec\|donor\|fundrais" SKILL.md -i
```

Also check the schema for any existing FEC columns or tables:

```sql
SELECT name FROM sqlite_master WHERE type='table';
-- look for anything named fec_*, donors, fundraising, etc.

PRAGMA table_info(members);
-- check for fec_candidate_id or similar columns
```

Report back what exists before touching anything.

## Step 1 — Schema additions

If `fec_candidate_id` doesn't already exist on `members`, add it:

```sql
ALTER TABLE members ADD COLUMN fec_candidate_id TEXT;
ALTER TABLE members ADD COLUMN fec_resolved_at TEXT;  -- ISO timestamp of last FEC resolution attempt
```

If a `fec_totals` table doesn't already exist, create it:

```sql
CREATE TABLE IF NOT EXISTS fec_totals (
  bioguide_id TEXT PRIMARY KEY REFERENCES members(bioguide_id),
  fec_candidate_id TEXT NOT NULL,
  cycle INTEGER NOT NULL,           -- 2026
  total_receipts REAL,              -- total raised this cycle
  total_disbursements REAL,         -- total spent
  cash_on_hand REAL,                -- cash_on_hand_end_period from most recent filing
  coverage_end_date TEXT,           -- date of most recent filing
  synced_at TEXT NOT NULL
);
```

Run via `npm run migrate` or direct `db.execute` if your migrate script supports it. If not, add the `CREATE TABLE IF NOT EXISTS` to `scripts/migrate.ts` and run it.

## Step 2 — FEC API key

The FEC API uses `api.data.gov` for authentication — the same service as `CONGRESS_API_KEY`. Test whether your existing key works:

```
curl "https://api.open.fec.gov/v1/candidates/?state=CO&office=H&election_year=2026&per_page=3&api_key=${CONGRESS_API_KEY}"
```

If that returns data, use `CONGRESS_API_KEY` for FEC calls. If it returns a 403, you need a separate FEC API key — register at https://api.open.fec.gov/ and add `FEC_API_KEY` to `.env` and Vercel env vars.

## Step 3 — Candidate ID resolver

Create `lib/fec-resolve.ts`. This resolves a member's `bioguide_id` to a FEC `candidate_id` using name + state + office search.

```ts
const FEC_BASE = 'https://api.open.fec.gov/v1'

function fecApiKey(): string {
  return process.env.FEC_API_KEY ?? process.env.CONGRESS_API_KEY ?? ''
}

// Normalize names for comparison: uppercase, strip punctuation
function normalizeName(name: string): string {
  return name.toUpperCase().replace(/[^A-Z\s]/g, '').trim()
}

// Score how well an FEC candidate name matches our member name
// FEC names are "LAST, FIRST MIDDLE" — we have "First Last"
function scoreNameMatch(fecName: string, memberName: string): number {
  const fecNorm = normalizeName(fecName)
  const memberNorm = normalizeName(memberName)

  // Extract last name from our format ("Bernie Sanders" → "SANDERS")
  const parts = memberNorm.split(' ')
  const lastName = parts[parts.length - 1]
  const firstName = parts[0]

  // FEC name should start with the last name
  if (!fecNorm.startsWith(lastName)) return 0

  // Bonus if first name also appears
  if (fecNorm.includes(firstName)) return 2
  return 1
}

export interface FecCandidate {
  candidate_id: string
  name: string
  party: string
  state: string
  office: string
  election_year: number
}

export async function resolveFecCandidateId(
  bioguideId: string,
  memberName: string,
  state: string,
  chamber: string, // 'House' | 'Senate'
  cycle = 2026
): Promise<string | null> {
  const office = chamber === 'Senate' ? 'S' : 'H'
  const apiKey = fecApiKey()

  const url =
    `${FEC_BASE}/candidates/search/?` +
    `q=${encodeURIComponent(memberName.split(' ').pop() ?? memberName)}` +
    `&state=${state}&office=${office}&election_year=${cycle}` +
    `&per_page=10&api_key=${apiKey}`

  let res: Response
  try {
    res = await fetch(url)
  } catch (e) {
    console.error(`FEC search network error for ${memberName}:`, e)
    return null
  }

  if (!res.ok) {
    console.error(`FEC search ${res.status} for ${memberName}`)
    return null
  }

  const json = await res.json()
  const results: FecCandidate[] = json.results ?? []

  if (results.length === 0) return null

  // Score all results and take the best match
  let best: FecCandidate | null = null
  let bestScore = 0

  for (const r of results) {
    const score = scoreNameMatch(r.name, memberName)
    if (score > bestScore) {
      bestScore = score
      best = r
    }
  }

  // Require at least a last-name match
  if (bestScore === 0 || !best) return null

  return best.candidate_id
}
```

## Step 4 — Fundraising totals fetcher

Add to `lib/fec-resolve.ts`:

```ts
export interface FecTotals {
  candidate_id: string
  total_receipts: number | null
  total_disbursements: number | null
  cash_on_hand: number | null
  coverage_end_date: string | null
}

export async function fetchFecTotals(
  candidateId: string,
  cycle = 2026
): Promise<FecTotals | null> {
  const apiKey = fecApiKey()
  const url =
    `${FEC_BASE}/candidate/${candidateId}/totals/?` +
    `cycle=${cycle}&per_page=1&api_key=${apiKey}`

  const res = await fetch(url)
  if (!res.ok) {
    console.error(`FEC totals ${res.status} for ${candidateId}`)
    return null
  }

  const json = await res.json()
  const row = json.results?.[0]
  if (!row) return null

  return {
    candidate_id: candidateId,
    total_receipts: row.receipts ?? row.total_receipts ?? null,
    total_disbursements: row.disbursements ?? row.total_disbursements ?? null,
    cash_on_hand: row.last_cash_on_hand_end_period ?? row.cash_on_hand_end_period ?? null,
    coverage_end_date: row.coverage_end_date ?? null,
  }
}
```

## Step 5 — Sync script

Create `scripts/sync-fec.ts`:

```ts
import { db } from '../lib/db'
import { resolveFecCandidateId, fetchFecTotals } from '../lib/fec-resolve'

const CYCLE = 2026
const DELAY_MS = 300 // be polite to FEC API

async function sleep(ms: number) {
  return new Promise(r => setTimeout(r, ms))
}

async function main() {
  // Fetch all current members who lack FEC data or were last synced > 7 days ago
  const rows = await db.execute(`
    SELECT m.bioguide_id, m.full_name, m.state, m.chamber, m.fec_candidate_id
    FROM members m
    LEFT JOIN fec_totals ft ON ft.bioguide_id = m.bioguide_id
    WHERE m.in_office = 1
      AND (ft.bioguide_id IS NULL
           OR ft.synced_at < date('now', '-7 days'))
    ORDER BY m.full_name ASC
  `)

  console.log(`${rows.rows.length} members need FEC sync`)

  let resolved = 0
  let failed = 0
  let noRace = 0

  for (const row of rows.rows) {
    const bioguideId = row.bioguide_id as string
    const name = row.full_name as string
    const state = row.state as string
    const chamber = row.chamber as string
    let fecId = row.fec_candidate_id as string | null

    await sleep(DELAY_MS)

    // Resolve FEC candidate ID if not already stored
    if (!fecId) {
      fecId = await resolveFecCandidateId(bioguideId, name, state, chamber, CYCLE)
      if (fecId) {
        await db.execute({
          sql: `UPDATE members SET fec_candidate_id = ?, fec_resolved_at = ? WHERE bioguide_id = ?`,
          args: [fecId, new Date().toISOString(), bioguideId],
        })
      } else {
        // Mark as attempted so we don't retry constantly
        await db.execute({
          sql: `UPDATE members SET fec_resolved_at = ? WHERE bioguide_id = ?`,
          args: [new Date().toISOString(), bioguideId],
        })
        noRace++
        console.log(`  No FEC match: ${name} (${state})`)
        continue
      }
    }

    // Fetch totals
    await sleep(DELAY_MS)
    const totals = await fetchFecTotals(fecId, CYCLE)
    if (!totals) {
      failed++
      continue
    }

    await db.execute({
      sql: `INSERT INTO fec_totals (bioguide_id, fec_candidate_id, cycle, total_receipts, total_disbursements, cash_on_hand, coverage_end_date, synced_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(bioguide_id) DO UPDATE SET
              fec_candidate_id = excluded.fec_candidate_id,
              cycle = excluded.cycle,
              total_receipts = excluded.total_receipts,
              total_disbursements = excluded.total_disbursements,
              cash_on_hand = excluded.cash_on_hand,
              coverage_end_date = excluded.coverage_end_date,
              synced_at = excluded.synced_at`,
      args: [
        bioguideId,
        fecId,
        CYCLE,
        totals.total_receipts,
        totals.total_disbursements,
        totals.cash_on_hand,
        totals.coverage_end_date,
        new Date().toISOString(),
      ],
    })

    resolved++
    console.log(
      `  ${name}: $${((totals.total_receipts ?? 0) / 1_000_000).toFixed(1)}M raised, $${((totals.cash_on_hand ?? 0) / 1_000).toFixed(0)}K CoH`
    )
  }

  console.log(`\nDone. Resolved: ${resolved}, No FEC match: ${noRace}, Errors: ${failed}`)
}

main().catch(console.error)
```

## Step 6 — Add npm script

```json
"sync:fec": "tsx scripts/sync-fec.ts"
```

## Step 7 — Query helper

Add to `lib/queries.ts`:

```ts
export async function getFecTotals(bioguideId: string): Promise<{
  total_receipts: number | null
  cash_on_hand: number | null
  coverage_end_date: string | null
  cycle: number
} | null> {
  const result = await db.execute({
    sql: `SELECT total_receipts, cash_on_hand, coverage_end_date, cycle
          FROM fec_totals WHERE bioguide_id = ?`,
    args: [bioguideId],
  })
  if (!result.rows[0]) return null
  return result.rows[0] as any
}
```

## Step 8 — Surface on member hub

In `app/sponsors/[bioguideId]/page.tsx`, add to the data fetching:

```ts
import { getFecTotals } from '@/lib/queries'
import { formatDollarsCompact } from '@/lib/format'  // already exists from HO 65

const fecTotals = await getFecTotals(bioguideId)
```

In the JSX, add a fundraising row to the bio section — keep it compact, one line:

```tsx
{fecTotals && (
  <div style={{ color: 'var(--text-secondary)', fontSize: '12px' }}>
    <span style={{ color: 'var(--text-muted)' }}>
      {fecTotals.cycle} FUNDRAISING
    </span>
    {' · '}
    <span>{formatDollarsCompact(fecTotals.total_receipts ?? 0)} raised</span>
    {' · '}
    <span>{formatDollarsCompact(fecTotals.cash_on_hand ?? 0)} CoH</span>
    {fecTotals.coverage_end_date && (
      <span style={{ color: 'var(--text-dim)' }}>
        {' '}as of {fecTotals.coverage_end_date}
      </span>
    )}
  </div>
)}
```

If `formatDollarsCompact` isn't in `lib/format.ts`, add it:

```ts
export function formatDollarsCompact(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`
  return `$${n.toFixed(0)}`
}
```

## Step 9 — Run and verify

```powershell
npm run sync:fec
```

Watch the output for:
- How many members got resolved vs. "No FEC match"
- Reasonable dollar amounts (a House incumbent should show $500K–$5M typically; Senate $2M–$50M)
- Any 403 errors (API key problem) or 404s (candidate not found)

After sync:
```sql
SELECT COUNT(*) FROM fec_totals;
-- expect 400–535 rows (not all members file with FEC in every cycle)

SELECT full_name, total_receipts, cash_on_hand
FROM members m JOIN fec_totals ft ON ft.bioguide_id = m.bioguide_id
ORDER BY total_receipts DESC LIMIT 10;
-- top fundraisers should be recognizable names with plausible amounts
```

Load a senator's hub page and confirm the fundraising line renders.

## Known gaps and follow-up

- **Match failures expected.** Some members won't match: newly appointed senators who haven't filed, members not running in 2026, edge cases in name formatting. A 70–80% match rate on first run is acceptable; don't chase the tail now.
- **Cycle mismatch.** Members not running in 2026 (safe seats, retirement announced) may have no 2026 FEC filing. The row will be absent from `fec_totals`, and the member hub will just show nothing — correct behavior.
- **Cron wiring.** Leave as manual for now; monthly or quarterly refresh is fine for fundraising data (FEC data lags anyway).
- **Individual donor breakdown** (top donors, PAC vs. individual split) is out of scope for this handoff. That requires Schedule A queries and is its own pipeline.

## Acceptance criteria

1. `fec_totals` table exists and has rows
2. `npm run sync:fec` completes without crashing
3. Match rate ≥ 60% of current members
4. Top 10 fundraisers by `total_receipts` are plausible
5. Fundraising line renders on at least one senator and one representative hub page
6. Members with no FEC data show no fundraising line (no broken UI)
