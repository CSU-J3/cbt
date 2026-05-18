# 65 — Donors pipeline (OpenSecrets API)

## What this is

First donor data on the dashboard. Pulls top donors, top industries, and fundraising totals for every current member from OpenSecrets for the 2026 cycle. Stores in two new tables, surfaces a snapshot (top donor + top industry) on the member hub. Full donor detail page is a follow-up handoff once we know what the data looks like in practice.

Theme 6 continued. Builds on the bioguide capture from 60 and the affiliations table pattern from 61. Same shape: external sync, hand-curated layer where applicable, snapshot on the hub.

External API costs: OpenSecrets free tier (registration required, free for non-commercial). One Gemini-style "small change" — under nothing for our spend, since the API is free.

## In scope

- Migration: `member_donors` and `member_industries` tables
- `lib/opensecrets.ts` — client wrapper for the three endpoints we need (`getLegislators`, `candContrib`, `candIndustry`, `candSummary`)
- `scripts/sync-donors.ts` — batched sync with checkpoint state, idempotent, rate-limit-aware
- Query helpers: `getMemberDonors(bioguideId, cycle)`, `getMemberIndustries(bioguideId, cycle)`, `getMemberFundraisingSummary(bioguideId, cycle)`
- `components/MemberStats.tsx` update: add two new stat lines (top donor + top industry) reading from the new tables, plus a disabled `[VIEW DONOR DETAIL →]` placeholder button
- SKILL.md updates

## Out of scope

- 2024 cycle data (historical). One-line script change to add, but defer until we have a use for the trend.
- Donor detail sub-page (`/sponsors/[bioguideId]/donors`). Follow-up after this lands and we see what the data shape supports.
- FEC bulk data direct integration. OpenSecrets has done the aggregation; reaching past them only matters if their categorization disappoints us in practice.
- Industry breakdown chart on the home dashboard. Visualization handoff territory.
- PAC vs individual donor split. OpenSecrets exposes this but it's a fourth stat line on the hub that crowds the layout. v1 just shows "top donor org" which is what most readers want.
- Senate-only or Republican-only or any subset. Run on all current members.

## Schema

Add to `scripts/migrate.ts`:

```sql
CREATE TABLE IF NOT EXISTS member_donors (
  bioguide_id TEXT NOT NULL REFERENCES members(bioguide_id),
  cycle INTEGER NOT NULL,
  rank INTEGER NOT NULL,                  -- 1-10
  org_name TEXT NOT NULL,
  total INTEGER NOT NULL,                 -- USD cents to avoid float issues
  pacs INTEGER,                           -- contributions from PACs (subset of total)
  indivs INTEGER,                         -- contributions from individuals (subset of total)
  source_url TEXT,
  ingested_at TEXT NOT NULL,
  PRIMARY KEY (bioguide_id, cycle, rank)
);

CREATE TABLE IF NOT EXISTS member_industries (
  bioguide_id TEXT NOT NULL REFERENCES members(bioguide_id),
  cycle INTEGER NOT NULL,
  rank INTEGER NOT NULL,                  -- 1-5
  industry_name TEXT NOT NULL,
  total INTEGER NOT NULL,                 -- USD cents
  source_url TEXT,
  ingested_at TEXT NOT NULL,
  PRIMARY KEY (bioguide_id, cycle, rank)
);

CREATE TABLE IF NOT EXISTS member_fundraising (
  bioguide_id TEXT NOT NULL REFERENCES members(bioguide_id),
  cycle INTEGER NOT NULL,
  total_raised INTEGER NOT NULL,          -- USD cents
  total_spent INTEGER,                    -- nullable; OpenSecrets returns it for some cycles
  cash_on_hand INTEGER,                   -- nullable
  debts INTEGER,                          -- nullable
  source_url TEXT,
  ingested_at TEXT NOT NULL,
  PRIMARY KEY (bioguide_id, cycle)
);

CREATE TABLE IF NOT EXISTS sync_state (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_member_donors_org ON member_donors(org_name);
CREATE INDEX IF NOT EXISTS idx_member_industries_name ON member_industries(industry_name);
```

Notes:

- **All money in cents (integer)**. Float dollars cause silent precision issues. Display layer divides by 100.
- **Rank in primary key** means re-ingesting overwrites cleanly without orphan rows: when refreshing, we `DELETE WHERE bioguide_id=? AND cycle=?` first, then insert fresh ranks 1-10. The PK shape prevents accidental duplicates.
- `pacs` and `indivs` are nullable because OpenSecrets sometimes only returns the combined total.
- `sync_state` is a small generic key/value table for the checkpoint cursor (and any future sync state). One row for now: `key='donors_cursor'`, `value='<bioguide_id>'`.

## OpenSecrets setup

API key registration: https://www.opensecrets.org/api/admin/index.php?function=signup

Free tier limits aren't published precisely in the docs but empirically run around 200/day. The script needs to handle 429 responses gracefully — log and stop, resume next day from the checkpoint.

Endpoints used:

- `getLegislators?id=<state>` — returns all legislators from a state with their `cid` (CRP candidate ID). We need this once at the start of every run to build the bioguide→cid map. Called once per state (~52 calls including territories) at the top of the script.
- `candSummary?cid=<cid>&cycle=<year>` — single-cycle fundraising totals
- `candContrib?cid=<cid>&cycle=<year>` — top 10 donors
- `candIndustry?cid=<cid>&cycle=<year>` — top 10 industries (we keep top 5)

Format: `&output=json` on every request. All responses are JSON with a `response` wrapper.

## OpenSecrets client (`lib/opensecrets.ts`)

```ts
const API_BASE = 'https://www.opensecrets.org/api/';
const API_KEY = process.env.OPENSECRETS_API_KEY;

if (!API_KEY) {
  throw new Error('OPENSECRETS_API_KEY not set');
}

export interface OpenSecretsLegislator {
  cid: string;
  bioguide_id: string;
  firstlast: string;
  party: string;
  office: string;
}

export interface DonorRow {
  org_name: string;
  total: number;     // dollars
  pacs: number | null;
  indivs: number | null;
}

export interface IndustryRow {
  industry_name: string;
  total: number;
}

export interface FundraisingSummary {
  total_raised: number;
  total_spent: number | null;
  cash_on_hand: number | null;
  debts: number | null;
  source: string;    // OpenSecrets returns a source URL field
}

async function call<T>(method: string, params: Record<string, string>): Promise<T> {
  const url = new URL(API_BASE);
  url.searchParams.set('method', method);
  url.searchParams.set('apikey', API_KEY!);
  url.searchParams.set('output', 'json');
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url);
  if (res.status === 429) {
    throw new RateLimitError(`OpenSecrets rate limit hit on ${method}`);
  }
  if (!res.ok) {
    throw new Error(`OpenSecrets ${method} returned ${res.status}`);
  }
  const data = await res.json();
  return data;
}

export class RateLimitError extends Error {}

export async function getLegislatorsForState(state: string): Promise<OpenSecretsLegislator[]> {
  const data = await call<any>('getLegislators', { id: state });
  return data.response.legislator.map((l: any) => l['@attributes']);
}

export async function candSummary(cid: string, cycle: number): Promise<FundraisingSummary>;
export async function candContrib(cid: string, cycle: number): Promise<DonorRow[]>;
export async function candIndustry(cid: string, cycle: number, limit?: number): Promise<IndustryRow[]>;
```

Implementation details for each endpoint:

- `candSummary` returns one row in `response.summary.@attributes` with `total`, `spent`, `cash_on_hand`, `debt`, `source`. Map directly.
- `candContrib` returns `response.contributors.contributor[]` — an array of objects, each with `@attributes` containing `org_name`, `total`, `pacs`, `indivs`. Return top 10.
- `candIndustry` returns `response.industries.industry[]` — same shape, with `industry_name` and `total`. Return top 5 (we slice).

The OpenSecrets JSON shape is awkward (XML-flavored with `@attributes` wrappers). Don't fight it — extract once in the client wrapper and the rest of the code sees clean objects.

## Sync script (`scripts/sync-donors.ts`)

```ts
import 'dotenv/config';
import { getDb } from '../lib/db';
import {
  getLegislatorsForState,
  candSummary,
  candContrib,
  candIndustry,
  RateLimitError,
  OpenSecretsLegislator,
} from '../lib/opensecrets';

const CYCLE = 2026;
const MEMBERS_PER_RUN = 100;       // conservative ceiling — about 300 API calls
const DELAY_MS = 250;              // ~4 req/sec, gentle on free tier
const STATES = [
  'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA',
  'KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ',
  'NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT',
  'VA','WA','WV','WI','WY','DC','PR','VI','GU','MP','AS',
];

async function buildBioguideToCidMap(): Promise<Map<string, string>> {
  console.log('Building bioguide → CRP cid map from getLegislators...');
  const map = new Map<string, string>();
  for (const state of STATES) {
    try {
      const legs = await getLegislatorsForState(state);
      for (const l of legs) {
        if (l.bioguide_id && l.cid) map.set(l.bioguide_id, l.cid);
      }
      await sleep(DELAY_MS);
    } catch (err) {
      if (err instanceof RateLimitError) throw err;
      console.warn(`  ${state}: ${err}`);
    }
  }
  console.log(`Mapped ${map.size} legislators`);
  return map;
}

async function main() {
  const db = getDb();

  const cursor = await getCursor(db);
  console.log(`Resuming from cursor: ${cursor ?? 'start'}`);

  const bioguideToCid = await buildBioguideToCidMap();

  const members = await db.execute(`
    SELECT bioguide_id, name
    FROM members
    WHERE bioguide_id IS NOT NULL
    ORDER BY bioguide_id
  `);

  let processedThisRun = 0;
  let resumed = cursor === null;

  for (const row of members.rows) {
    const bioguideId = row.bioguide_id as string;

    if (!resumed) {
      if (bioguideId === cursor) resumed = true;
      continue;
    }
    if (processedThisRun >= MEMBERS_PER_RUN) {
      console.log(`Hit per-run cap. Resume tomorrow.`);
      await setCursor(db, bioguideId);
      return;
    }

    const cid = bioguideToCid.get(bioguideId);
    if (!cid) {
      console.warn(`  ${bioguideId} (${row.name}): no CRP cid mapping — skip`);
      continue;
    }

    try {
      await syncMember(db, bioguideId, cid);
      processedThisRun++;
    } catch (err) {
      if (err instanceof RateLimitError) {
        console.log(`Rate limited. Saving cursor at ${bioguideId}, resume tomorrow.`);
        await setCursor(db, bioguideId);
        return;
      }
      console.warn(`  ${bioguideId}: ${err}`);
    }

    await sleep(DELAY_MS);
  }

  await setCursor(db, null);
  console.log(`Done. Full cycle complete. Processed ${processedThisRun} this run.`);
}

async function syncMember(db: any, bioguideId: string, cid: string) {
  const summary = await candSummary(cid, CYCLE);
  const donors = await candContrib(cid, CYCLE);
  const industries = await candIndustry(cid, CYCLE);

  // Wipe and refresh
  await db.execute({ sql: 'DELETE FROM member_donors WHERE bioguide_id=? AND cycle=?', args: [bioguideId, CYCLE] });
  await db.execute({ sql: 'DELETE FROM member_industries WHERE bioguide_id=? AND cycle=?', args: [bioguideId, CYCLE] });
  await db.execute({ sql: 'DELETE FROM member_fundraising WHERE bioguide_id=? AND cycle=?', args: [bioguideId, CYCLE] });

  const now = new Date().toISOString();

  await db.execute({
    sql: `INSERT INTO member_fundraising (bioguide_id, cycle, total_raised, total_spent, cash_on_hand, debts, source_url, ingested_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [bioguideId, CYCLE, dollarsToCents(summary.total_raised), maybeCents(summary.total_spent), maybeCents(summary.cash_on_hand), maybeCents(summary.debts), summary.source, now],
  });

  for (let i = 0; i < donors.slice(0, 10).length; i++) {
    const d = donors[i];
    await db.execute({
      sql: `INSERT INTO member_donors (bioguide_id, cycle, rank, org_name, total, pacs, indivs, source_url, ingested_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [bioguideId, CYCLE, i + 1, d.org_name, dollarsToCents(d.total), maybeCents(d.pacs), maybeCents(d.indivs), summary.source, now],
    });
  }

  for (let i = 0; i < industries.slice(0, 5).length; i++) {
    const ind = industries[i];
    await db.execute({
      sql: `INSERT INTO member_industries (bioguide_id, cycle, rank, industry_name, total, source_url, ingested_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)`,
      args: [bioguideId, CYCLE, i + 1, ind.industry_name, dollarsToCents(ind.total), summary.source, now],
    });
  }
}

function dollarsToCents(n: number): number { return Math.round(n * 100); }
function maybeCents(n: number | null | undefined): number | null { return n == null ? null : Math.round(n * 100); }
function sleep(ms: number): Promise<void> { return new Promise(r => setTimeout(r, ms)); }

async function getCursor(db: any): Promise<string | null> {
  const res = await db.execute({ sql: `SELECT value FROM sync_state WHERE key='donors_cursor'`, args: [] });
  if (res.rows.length === 0) return null;
  return res.rows[0].value as string;
}

async function setCursor(db: any, val: string | null) {
  if (val === null) {
    await db.execute({ sql: `DELETE FROM sync_state WHERE key='donors_cursor'`, args: [] });
  } else {
    await db.execute({
      sql: `INSERT INTO sync_state (key, value, updated_at) VALUES ('donors_cursor', ?, ?)
            ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at`,
      args: [val, new Date().toISOString()],
    });
  }
}

main().catch(err => { console.error(err); process.exit(1); });
```

Add to `package.json`:

```json
"sync:donors": "tsx scripts/sync-donors.ts"
```

Run pattern: `npm run sync:donors`. First run processes 100 members (~300 calls plus ~52 for the legislator map = ~352 calls). If quota is 200/day, run hits 429 partway through; checkpoint saves; resume tomorrow. Realistic full coverage: 5-7 daily runs.

## Query helpers (`lib/queries.ts`)

```ts
export interface MemberDonor {
  rank: number;
  org_name: string;
  total: number;        // cents
  pacs: number | null;
  indivs: number | null;
}

export interface MemberIndustry {
  rank: number;
  industry_name: string;
  total: number;        // cents
}

export interface MemberFundraising {
  total_raised: number;
  total_spent: number | null;
  cash_on_hand: number | null;
  debts: number | null;
  source_url: string | null;
}

export async function getMemberDonors(bioguideId: string, cycle: number = 2026): Promise<MemberDonor[]>;
export async function getMemberIndustries(bioguideId: string, cycle: number = 2026): Promise<MemberIndustry[]>;
export async function getMemberFundraising(bioguideId: string, cycle: number = 2026): Promise<MemberFundraising | null>;
```

All three cached: `unstable_cache(..., ['donor-data', bioguideId, String(cycle)], { tags: ['members'], revalidate: 86400 })`. Tag is the existing `members` tag so the same revalidate flow covers donor refreshes.

## Member hub UI (`components/MemberStats.tsx` update)

Current stats block has three rows: `BILLS SPONSORED`, `BILLS ENACTED`, `AVG COSPONSORS`. Add two more rows below them when donor data exists:

```
BILLS SPONSORED         47
BILLS ENACTED           2 (4.3%)
AVG COSPONSORS          12
─────────────────────────────────
TOP DONOR               GOLDMAN SACHS · $245K
TOP INDUSTRY            Securities & Investment · $1.2M

[VIEW DONOR DETAIL →]   (disabled, "Coming soon")
```

If `getMemberDonors` returns empty (not yet synced or no data for this member), render the two lines as `—` / `—` and hide the button. Don't show "loading" or "coming soon" globally on members without data — that visual noise on most rows during the rolling backfill is worse than just blank values.

The page (`app/sponsors/[bioguideId]/page.tsx`) fetches donor data in parallel with the existing fetches:

```tsx
const [member, stats, bills, affiliations, donors, industries, fundraising] = await Promise.all([
  getMember(bioguideId),
  getMemberStats(bioguideId),
  getMemberBills(bioguideId, 10),
  getMemberAffiliations(bioguideId),
  getMemberDonors(bioguideId, 2026),
  getMemberIndustries(bioguideId, 2026),
  getMemberFundraising(bioguideId, 2026),
]);

<MemberStats stats={stats} donors={donors} industries={industries} fundraising={fundraising} />
```

Display:

- "TOP DONOR" = `donors[0].org_name` if present, formatted dollars from `total / 100`
- "TOP INDUSTRY" = `industries[0].industry_name` if present, formatted dollars from `total / 100`

Money formatter for the stats block (`lib/format.ts`):

```ts
export function formatDollarsCompact(cents: number): string {
  const dollars = cents / 100;
  if (dollars >= 1_000_000) return `$${(dollars / 1_000_000).toFixed(1)}M`;
  if (dollars >= 1_000) return `$${Math.round(dollars / 1000)}K`;
  return `$${Math.round(dollars)}`;
}
```

`$245K`, `$1.2M`, `$87` formatting matches the terminal aesthetic — compact, monospace-friendly.

`[VIEW DONOR DETAIL →]` button: rendered with reduced opacity (60-70%), `pointer-events: none`, `title="Donor detail page coming soon"`. Marks the position so the future sub-page handoff drops in without layout shift.

## SKILL.md updates

**Database schema**: add the three new tables (`member_donors`, `member_industries`, `member_fundraising`) plus `sync_state`.

**Member hub** page entry: extend to mention top donor + top industry stat lines and the (disabled) `[VIEW DONOR DETAIL →]` placeholder.

**New section: "Donor data"** (sibling to "Caucus affiliations" and "Race surface"):

> v1 covers 2026 cycle only. Sourced from OpenSecrets API (`lib/opensecrets.ts`), pulled via `npm run sync:donors`. Rate-limited free tier (~200/day) means a full backfill takes 5-7 daily runs with checkpoint resume. Schema: `member_donors` (top 10), `member_industries` (top 5), `member_fundraising` (totals). All amounts stored in cents. 2024 cycle and a full donor detail sub-page are follow-up handoffs.

**Things to watch for**: add —

> Money columns in `member_donors`, `member_industries`, `member_fundraising` are integer cents, not dollars. Use `formatDollarsCompact(cents)` from `lib/format.ts` for display. Float dollars cause silent precision drift on aggregation.

**Backfill scripts**: add `npm run sync:donors`.

**Environment variables**: add `OPENSECRETS_API_KEY=` to the list.

## Verification

1. Register for an OpenSecrets API key. Set `OPENSECRETS_API_KEY=` in `.env`.
2. `npm run migrate` — four new tables exist with primary keys + indexes.
3. `npm run sync:donors` — first run should output `Building bioguide → CRP cid map...`, then process up to 100 members. Expected end state: `Hit per-run cap. Resume tomorrow.` and a cursor saved.
4. `SELECT COUNT(DISTINCT bioguide_id) FROM member_donors WHERE cycle=2026` — should match `processedThisRun` from the script log.
5. Spot check one row: `SELECT * FROM member_donors WHERE bioguide_id='S001234' AND cycle=2026 ORDER BY rank` — 10 rows, money in cents (e.g., 24500000 for $245K).
6. Hit `/sponsors/<a-synced-bioguide>` — `MemberStats` block shows TOP DONOR and TOP INDUSTRY rows with formatted dollars.
7. Hit `/sponsors/<an-unsynced-bioguide>` — `MemberStats` shows `—` in those rows, no button. No 500.
8. Re-run `npm run sync:donors` (the next day, or with a forced cursor reset for testing) — picks up from cursor.
9. Once all members processed: cursor cleared, log shows `Done. Full cycle complete.`
10. `npm run typecheck` — clean.
11. `npm run build` — clean.

## Acceptance

Donor data populated for every member (after 5-7 daily runs). Top donor + top industry visible on every member hub. `[VIEW DONOR DETAIL →]` placeholder marks the future sub-page landing spot.

After this: time-series chart on the home dashboard (handoff 66), or donor detail sub-page (theme-6 follow-up), or pick up news validation (handoff 65-equivalent — renumber based on what ships next). User picks.
