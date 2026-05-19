# Handoff 80 — Senate votes pipeline

## Context

House votes landed in the previous session via `scripts/sync-votes.ts`, writing into `votes` and `member_votes` tables. Senate votes come from a different source — the Senate LIS XML feed at senate.gov — and use LIS member IDs instead of bioguide IDs. This handoff adds Senate vote ingestion, maps LIS IDs to bioguide IDs via the Congress.gov member API, and surfaces Senate votes on the member hub alongside House votes.

## Prerequisites

Confirm these tables exist before touching anything (they should from the House votes work):

```sql
-- votes table
SELECT name FROM sqlite_master WHERE type='table' AND name='votes';

-- member_votes table
SELECT name FROM sqlite_master WHERE type='table' AND name='member_votes';
```

If either is missing, stop and report back.

## Step 1 — LIS ID to bioguide mapping

The Senate XML identifies members by LIS ID (`S000148`). Our `member_votes` table keys on `bioguide_id`. Before fetching any vote data, build a lookup.

Create `lib/lis-map.ts`:

```ts
import { db } from './db'

// Fetches current Senate members from Congress.gov and returns a Map<lisId, bioguideId>
export async function buildLisMap(): Promise<Map<string, string>> {
  const apiKey = process.env.CONGRESS_API_KEY!
  const url = `https://api.congress.gov/v3/member?currentMember=true&chamber=Senate&limit=250&api_key=${apiKey}`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Congress.gov member fetch failed: ${res.status}`)
  const json = await res.json()

  const map = new Map<string, string>()
  for (const m of json.members ?? []) {
    if (m.lisId && m.bioguideId) {
      map.set(m.lisId, m.bioguideId)
    }
  }
  return map
}
```

Test it at the REPL before proceeding:

```ts
import { buildLisMap } from './lib/lis-map'
const map = await buildLisMap()
console.log(map.size) // expect ~100
```

If `lisId` is missing from the member objects, try `identifiers.lisId` — the field name varies slightly across Congress.gov versions. Log one raw member object to inspect the shape.

## Step 2 — Senate vote sync script

Create `scripts/sync-senate-votes.ts`. Structure mirrors `scripts/sync-votes.ts` but targets the senate.gov XML feed.

```ts
import { db } from '../lib/db'
import { buildLisMap } from '../lib/lis-map'
import { XMLParser } from 'fast-xml-parser'

const SESSIONS = [
  { session: 1, year: 2025 },
  { session: 2, year: 2026 },
]

const MENU_URL = (session: number) =>
  `https://www.senate.gov/legislative/LIS/roll_call_lists/vote_menu_119_${session}.xml`

const DETAIL_URL = (session: number, voteNum: string) =>
  `https://www.senate.gov/legislative/LIS/roll_call_votes/vote119${session}/vote_119_${session}_${voteNum}.xml`

async function fetchXml(url: string): Promise<any> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Fetch failed ${res.status}: ${url}`)
  const text = await res.text()
  const parser = new XMLParser({ ignoreAttributes: false })
  return parser.parse(text)
}

function makeVoteId(session: number, voteNumber: string): string {
  return `senate-119-${session}-${voteNumber}`
}

// Extract the bill_id from the vote's document reference if it's a bill vote
// Senate XML uses "H.R. 1968" or "S. 123" format
function parseBillId(doc: any): string | null {
  const type: string = doc?.document_type ?? ''
  const number: string = String(doc?.document_number ?? '').trim()
  if (!type || !number) return null

  const typeMap: Record<string, string> = {
    'H.R.': 'hr',
    'S.': 's',
    'H.J.Res.': 'hjres',
    'S.J.Res.': 'sjres',
    'H.Con.Res.': 'hconres',
    'S.Con.Res.': 'sconres',
    'H.Res.': 'hres',
    'S.Res.': 'sres',
  }
  const billType = typeMap[type.trim()]
  if (!billType) return null
  return `119-${billType}-${number}`
}

async function syncSession(session: number, lisMap: Map<string, string>) {
  console.log(`\nSyncing session ${session}...`)

  // Find the highest vote number already stored for this session
  const row = await db.execute(
    `SELECT MAX(CAST(SUBSTR(id, INSTR(id, '-', INSTR(id, '-') + 1) + 1) AS INTEGER)) AS max_num
     FROM votes WHERE id LIKE 'senate-119-${session}-%'`
  )
  const lastNum = (row.rows[0]?.max_num as number | null) ?? 0

  // Fetch vote menu
  const menu = await fetchXml(MENU_URL(session))
  const votes: any[] = menu?.vote_summary?.votes?.vote ?? []

  // senate.gov returns newest-first; we want ascending to fill gaps forward
  const ascending = [...votes].reverse()

  let upserted = 0
  let skipped = 0

  for (const v of ascending) {
    const voteNum = String(v.vote_number).padStart(5, '0')
    const numInt = parseInt(v.vote_number, 10)
    if (numInt <= lastNum) { skipped++; continue }

    const voteId = makeVoteId(session, voteNum)

    let detail: any
    try {
      detail = await fetchXml(DETAIL_URL(session, voteNum))
    } catch (e) {
      console.error(`Skipping ${voteId}: ${e}`)
      continue
    }

    const rc = detail?.roll_call_vote
    if (!rc) continue

    const doc = rc.document
    const billId = parseBillId(doc)

    // Tally
    const counts = rc.count ?? {}
    const yeaCount = parseInt(counts.yeas ?? '0', 10)
    const nayCount = parseInt(counts.nays ?? '0', 10)
    const notVotingCount = parseInt(counts.not_voting ?? counts.absent ?? '0', 10)

    // Upsert vote row
    await db.execute({
      sql: `INSERT INTO votes (id, congress, session, chamber, vote_number, vote_date, question, vote_title, result, bill_id, yea_count, nay_count, not_voting_count)
            VALUES (?, 119, ?, 'Senate', ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
              result = excluded.result,
              yea_count = excluded.yea_count,
              nay_count = excluded.nay_count,
              not_voting_count = excluded.not_voting_count`,
      args: [
        voteId,
        session,
        numInt,
        rc.vote_date ?? '',
        rc.question ?? '',
        rc.vote_title ?? rc.vote_question_text ?? '',
        rc.vote_result ?? '',
        billId,
        yeaCount,
        nayCount,
        notVotingCount,
      ],
    })

    // Upsert member votes
    const members: any[] = rc.members?.member ?? []
    const memberArr = Array.isArray(members) ? members : [members]

    for (const m of memberArr) {
      const lisId: string = String(m.lis_member_id ?? '').trim()
      const bioguideId = lisMap.get(lisId)
      if (!bioguideId) {
        // LIS ID not in map (retired member, nomination vote, etc.) — skip
        continue
      }
      const voteCast: string = String(m.vote_cast ?? '').trim()
      await db.execute({
        sql: `INSERT INTO member_votes (vote_id, bioguide_id, vote_cast)
              VALUES (?, ?, ?)
              ON CONFLICT(vote_id, bioguide_id) DO UPDATE SET vote_cast = excluded.vote_cast`,
        args: [voteId, bioguideId, voteCast],
      })
    }

    upserted++
    if (upserted % 25 === 0) console.log(`  Session ${session}: ${upserted} votes upserted`)
  }

  console.log(`Session ${session} done — ${upserted} upserted, ${skipped} skipped`)
}

async function main() {
  const lisMap = await buildLisMap()
  console.log(`LIS map built: ${lisMap.size} senators`)

  for (const { session } of SESSIONS) {
    await syncSession(session, lisMap)
  }

  console.log('\nSenate vote sync complete.')
}

main().catch(console.error)
```

### fast-xml-parser

Check if it's already installed:

```powershell
npm list fast-xml-parser
```

If not:

```powershell
npm install fast-xml-parser
```

## Step 3 — Add npm script

In `package.json`, add:

```json
"sync:senate-votes": "tsx scripts/sync-senate-votes.ts"
```

## Step 4 — Run initial backfill

Session 1 has ~659 votes; session 2 is ongoing. The full backfill will make many HTTP requests to senate.gov. Add a 300ms delay between detail fetches if you hit rate limiting (senate.gov doesn't publish rate limits but is generally tolerant).

```powershell
npm run sync:senate-votes
```

Watch for:
- LIS map size — should be ~100 senators
- "Skipping" lines with HTTP errors — acceptable for any draft/amendment votes that have odd identifiers
- Upserted counts per session

Report back the final line from each session.

## Step 5 — Surface on member hub

In `app/sponsors/[bioguideId]/page.tsx` (or wherever `getRecentVotes` is called for the House votes section), extend to also query Senate votes for Senate members.

The simplest approach: `getRecentVotes(bioguideId)` in `lib/queries.ts` already queries `member_votes JOIN votes` without filtering by chamber. If that's the case, Senate votes will appear automatically once they're in the DB. Verify by loading a known senator's page (e.g., `/sponsors/S000148` for Schumer) after the sync.

If the query has `WHERE votes.chamber = 'House'`, remove that filter so it returns both chambers, or add a `chamber` param defaulting to `null` (no filter).

## Step 6 — Verify

After sync completes:

```sql
SELECT chamber, COUNT(*) FROM votes GROUP BY chamber;
-- expect: House ~XXXX, Senate ~700+

SELECT COUNT(*) FROM member_votes WHERE vote_id LIKE 'senate-%';
-- expect: roughly 700 votes × ~95 senators per vote ≈ 65,000+ rows

SELECT mv.vote_cast, COUNT(*) FROM member_votes mv
JOIN votes v ON mv.vote_id = v.id
WHERE v.chamber = 'Senate'
GROUP BY mv.vote_cast;
-- should show Yea, Nay, Not Voting, maybe Present
```

Load `/sponsors/[some-senator-bioguideId]` and confirm the voting section renders with Senate votes.

## Step 7 — Wire into cron (optional for this handoff)

If the 60-second Vercel function ceiling allows, fold `sync:senate-votes` logic into `/api/sync` after the existing House vote sync. If not, leave it as a manual script and note it as a follow-up. Don't hold this handoff open for cron wiring — ship the sync + verification first.

## Out of scope

- Historical sessions (118th and earlier)
- Nomination votes (PNs) — they're in the feed but won't match any `bills` row; `bill_id` will be null, which is fine
- Party breakdown display changes on the member hub (the existing vote-cast rendering handles Senate votes automatically)

## Acceptance criteria

1. `npm run sync:senate-votes` completes without crashing
2. `votes` table has Senate rows for both sessions
3. `member_votes` has Senate rows keyed by bioguide_id
4. A senator's member hub page shows their Senate votes
5. A representative's member hub page still shows only House votes (chamber filter or hub label reads correctly)
