# 143 — Committee surface, Phase 1: schema + sync

## What this is

First of three handoffs that build the committee surface. This one lands the data layer only — schema, sync pipeline, query helpers — with no UI changes. Phase 2 builds `/committees` index. Phase 3 builds per-committee detail page. After Phase 1, the data is in the DB and the cron keeps it fresh; the dashboard doesn't change yet.

The framing-question payoff is "which committee is most active right now" — currently invisible in CBT. Bills move through committees, members serve on committees, and committee throughput is a real signal.

## Pre-flight: Congress.gov endpoint verification

Before writing schema or sync code, hit these endpoints and confirm shape. The handoff specifies field names below; if reality differs, surface in chat before locking schema. (Same liveness-check discipline that saved HOs 65 and 70 from shipping against dead endpoints, and that saved HO 142 from three bad Stooq symbols.)

```
GET https://api.congress.gov/v3/committee/119?api_key=<KEY>&limit=10
GET https://api.congress.gov/v3/committee/119/<systemCode>?api_key=<KEY>
GET https://api.congress.gov/v3/committee/119/<systemCode>/bills?api_key=<KEY>&limit=5
```

Report: do these endpoints exist on the current API tier, what fields come back, and is `committee_assignments`-style data (member rosters) on the committee detail endpoint or somewhere else? If member rosters need a separate path, name it.

## In scope

- `committees` table (one row per committee)
- `committee_bills` table (bill ↔ committee join, with referral/discharge/markup activity dates)
- `committee_members` table (member ↔ committee join, with role and party)
- Sync logic in `lib/sync.ts` (or new `lib/committees-sync.ts`) that pulls from Congress.gov
- Query helpers in `lib/queries.ts`: `getCommittees`, `getCommitteeBills(systemCode, limit)`, `getCommitteeMembers(systemCode)`, `getCommitteeActivity(days)` for the "most active recently" cut
- Wire sync into the existing daily cron pipeline (or a new dedicated route if Phase 1 reveals the data volume warrants it)
- `cron_runs` instrumentation via `wrapCronRoute` from HO 139
- `SKILL.md` updates for the three new tables and the sync pattern

## Out of scope

- Any UI work. `/committees`, `/committee/[id]`, member-hub committee badges, bill-detail committee references — all Phase 2 or 3.
- Subcommittee rosters as first-class entities. Congress.gov treats subcommittees as committees with a parent reference; capture the parent ID in `committees.parent_system_code` but don't build a separate hierarchy table.
- Historical committee data for prior Congresses (118th and earlier). Same posture as the bills sync — 119th only.
- Committee jurisdiction descriptions, contact info, or other metadata beyond what the index endpoint returns. Add later if Phase 2 reveals a need.

## Schema

Add to `scripts/migrate.ts` and run `npm run migrate` against prod:

```sql
CREATE TABLE IF NOT EXISTS committees (
  system_code TEXT PRIMARY KEY,         -- e.g. 'hsii00' (House Natural Resources), 'ssas00' (Senate Armed Services)
  name TEXT NOT NULL,
  chamber TEXT NOT NULL,                -- 'house' | 'senate' | 'joint'
  committee_type TEXT,                  -- 'Standing', 'Select', 'Special', 'Joint', 'Subcommittee', etc.
  parent_system_code TEXT,              -- nullable; non-null for subcommittees
  url TEXT,                             -- Congress.gov canonical URL
  updated_at TEXT NOT NULL              -- ISO timestamp of last sync
);

CREATE TABLE IF NOT EXISTS committee_bills (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bill_id TEXT NOT NULL,                -- references bills.id; not enforced (sync ordering)
  committee_system_code TEXT NOT NULL,  -- references committees.system_code
  activity_type TEXT,                   -- 'Referred to', 'Reported by', 'Discharged', 'Markup', etc.
  activity_date TEXT,                   -- ISO date of the activity
  updated_at TEXT NOT NULL,
  UNIQUE(bill_id, committee_system_code, activity_type, activity_date)
);

CREATE INDEX IF NOT EXISTS idx_committee_bills_bill        ON committee_bills(bill_id);
CREATE INDEX IF NOT EXISTS idx_committee_bills_committee   ON committee_bills(committee_system_code);
CREATE INDEX IF NOT EXISTS idx_committee_bills_activity    ON committee_bills(activity_date DESC);

CREATE TABLE IF NOT EXISTS committee_members (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  committee_system_code TEXT NOT NULL,
  bioguide_id TEXT NOT NULL,
  role TEXT,                            -- 'Chair', 'Ranking Member', 'Member', etc.
  party TEXT,                           -- 'D' | 'R' | 'I' | etc. (snapshot at sync time)
  updated_at TEXT NOT NULL,
  UNIQUE(committee_system_code, bioguide_id)
);

CREATE INDEX IF NOT EXISTS idx_committee_members_committee ON committee_members(committee_system_code);
CREATE INDEX IF NOT EXISTS idx_committee_members_member    ON committee_members(bioguide_id);
```

Field choices to confirm against Phase-1-pre-flight reality:

- `system_code` is Congress.gov's stable identifier (lowercase alphanumeric like `hsii00`). Confirm before using as PK.
- `activity_type` strings depend on what Congress.gov returns; the values above are guesses. Capture whatever they actually send and document.
- `role` strings for committee leadership likewise — confirm exact values returned (`Chair` vs `Chairman` vs `Chairperson` etc.).

## Sync pattern

New file `lib/committees-sync.ts` (keeping it separate from bills sync for clarity):

1. **Committees list.** Paginate `/committee/119` until exhausted. Upsert each into `committees`.
2. **Per-committee bills.** For each committee, fetch `/committee/119/<systemCode>/bills` with reasonable pagination cap. Upsert each (bill_id, committee_system_code, activity_type, activity_date) tuple into `committee_bills`. The UNIQUE constraint handles dedup.
3. **Per-committee members.** For each committee, fetch the member roster endpoint (path TBD from pre-flight). Upsert each (committee_system_code, bioguide_id) row.

Volume estimate: ~200 committees + subcommittees in the 119th Congress. Per-committee bill counts vary wildly (some have 1000+, most under 50). Conservative call count: ~600 API hits to fully sync (one list + ~200 bills + ~200 members + ~200 pagination). At Congress.gov's typical rate this is doable in a single 60s function tick for the first sync; subsequent syncs only re-fetch changed data.

**Time-budget the sync.** Mirror the HO 116 pattern — `deadlineMs` parameter, AbortController per HTTP call, cursor persistence in a `committee_sync_state` table or column so multi-tick drain is clean.

## Cron wiring

Two options. Pick based on what fits:

**Option A — fold into existing /api/sync.** Adds another step to the downstream sequence after bills sync, before summarize. Pro: no new route, no new GitHub Action. Con: tightens the 60s budget on the main sync route, which is already at 53s/55s headroom per HO 135.

**Option B — new /api/cron/committees route on its own schedule.** Daily at 11:30 UTC (after summarize at 13:00 UTC is too late; before primaries at 12:00 is fine; pick the slot that doesn't collide). Pro: isolated, easier to debug, doesn't compete with sync for time. Con: one more cron entry to track.

**Recommendation: Option B.** The cron-health audit (HO 135) just flagged /api/sync at 53s on a scheduled tick. Adding another data lift to it is asking for the next timeout. A dedicated route mirrors the pattern HO 117 established for news.

## Query helpers

In `lib/queries.ts`:

```ts
export type Committee = {
  systemCode: string;
  name: string;
  chamber: 'house' | 'senate' | 'joint';
  committeeType: string | null;
  parentSystemCode: string | null;
  url: string | null;
};

export type CommitteeActivity = {
  systemCode: string;
  name: string;
  chamber: 'house' | 'senate' | 'joint';
  recentBillCount: number;      // bills with committee activity in last N days
};

export async function getCommittees(filters?: { chamber?: string }): Promise<Committee[]>;
export async function getCommitteeBills(systemCode: string, limit?: number): Promise<Bill[]>;
export async function getCommitteeMembers(systemCode: string): Promise<MemberRow[]>;
export async function getCommitteeActivity(days?: number): Promise<CommitteeActivity[]>;
```

Cache each with `unstable_cache`, tag `'committees'`. Sync route revalidates that tag after a successful run.

## Acceptance

1. Pre-flight endpoint check posted in chat. Any schema field that doesn't match reality flagged before migration runs.
2. Migration applied to prod Turso; all three new tables exist with correct schema and indices.
3. Sync runs successfully end-to-end against prod once. `committees`, `committee_bills`, `committee_members` all populated. Row counts reported in chat (rough expectations: ~200 committees, ~5000-15000 committee_bills, ~3000-5000 committee_members).
4. `cron_runs` shows the new route logging cleanly.
5. Query helpers return non-empty data when called.
6. `SKILL.md` updated with the three new tables, the sync route, and the cron wiring choice.
7. Single commit: `feat: committee data layer (HO 143)`.

## Notes

- **Why three tables?** Bills and members are independent dimensions of a committee. Joining them through a single table (committee_assignments holding both bills and members) is the wrong shape — different cardinality, different activity semantics. Two joins keeps queries clean.
- **What about hearings?** Congress.gov has hearing data too. Out of scope for v1; reachable if Phase 2 reveals a need for "what is committee X actually doing this week" beyond bills.
- **Why parent_system_code instead of a hierarchy table?** Subcommittees rarely need to be queried separately from their parent in this dashboard. A self-reference column handles the common case (show parent name on subcommittee pages, optionally group by parent). If a real hierarchy view becomes needed, that's a Phase 3 schema add.
- **The HO 135 watch on /api/sync (53s tick) reinforces Option B for the cron split.** Not blocking — Option A is workable if the implementation comes in fast — but the operational read favors isolation.
