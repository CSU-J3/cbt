// HO 143 committees sync. Three operations, three sources:
//
// 1. **Committees list** from Congress.gov `/committee/119` — full refresh
//    each tick. ~237 committees + subs, one paginated pass, sub-second.
// 2. **Committee bills** via the bill→committees direction
//    (`/bill/{congress}/{type}/{number}/committees`) — incremental. Walks
//    bills whose update_date is newer than the cursor in dashboard_state;
//    stops *starting* new bills at the deadline so each tick stays inside
//    its budget. Steady state: 50-500 bills/day. Initial backfill (~16K
//    bills) happens via scripts/backfill-committee-bills.ts, not the cron.
// 3. **Committee members** from
//    `unitedstates/congress-legislators/committee-membership-current.yaml`
//    — full refresh each tick. One HTTP fetch + YAML parse + upsert.
//    Congress.gov has no committee-roster endpoint (verified HO 143
//    pre-flight); the YAML is the canonical free source. THOMAS code →
//    Congress.gov systemCode rule: lowercase, and if length is 4 append
//    '00' (so 'SSAF' → 'ssaf00', 'SSAF13' → 'ssaf13').
//
// The /api/cron/committees route is responsible for time-budgeting; the
// helpers here accept a deadlineMs and an AbortController-driven http
// client so a slow upstream doesn't strand the tick past the 55s soft
// timeout.
import yaml from "js-yaml";
import { getDb } from "./db";

const API_BASE = "https://api.congress.gov/v3";
const CONGRESS = 119;
const COMMITTEES_LIST_LIMIT = 250;
const PER_BILL_HTTP_TIMEOUT_MS = 8_000;
const MEMBERSHIP_YAML_URL =
  "https://raw.githubusercontent.com/unitedstates/congress-legislators/main/committee-membership-current.yaml";

const BILLS_CURSOR_KEY = "committee_bills_sync_cursor";

function apiKey(): string {
  const k = process.env.CONGRESS_API_KEY;
  if (!k) throw new Error("CONGRESS_API_KEY is not set");
  return k;
}

// --- 1. Committees list -------------------------------------------------

type ApiCommittee = {
  systemCode: string;
  name: string;
  chamber: string;
  committeeTypeCode?: string;
  parent?: { systemCode: string };
  url?: string;
  isCurrent?: boolean;
  updateDate?: string;
};

export type CommitteesListResult = {
  fetched: number;
  upserted: number;
  pages: number;
};

export async function syncCommitteesList(): Promise<CommitteesListResult> {
  const key = apiKey();
  const db = getDb();
  let offset = 0;
  let pages = 0;
  let fetched = 0;
  let upserted = 0;
  const now = new Date().toISOString();
  const stmts: { sql: string; args: (string | number | null)[] }[] = [];
  while (true) {
    const url = `${API_BASE}/committee/${CONGRESS}?api_key=${key}&format=json&limit=${COMMITTEES_LIST_LIMIT}&offset=${offset}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(PER_BILL_HTTP_TIMEOUT_MS) });
    if (!res.ok) throw new Error(`committees list HTTP ${res.status} at offset ${offset}`);
    const j = (await res.json()) as { committees?: ApiCommittee[]; pagination?: { next?: string } };
    const rows = j.committees ?? [];
    pages++;
    fetched += rows.length;
    for (const c of rows) {
      if (!c.systemCode || !c.name || !c.chamber) continue;
      stmts.push({
        sql: `INSERT INTO committees
              (system_code, name, chamber, committee_type, parent_system_code, url, is_current, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?)
              ON CONFLICT(system_code) DO UPDATE SET
                name = excluded.name,
                chamber = excluded.chamber,
                committee_type = excluded.committee_type,
                parent_system_code = excluded.parent_system_code,
                url = excluded.url,
                is_current = excluded.is_current,
                updated_at = excluded.updated_at`,
        args: [
          c.systemCode,
          c.name,
          c.chamber.toLowerCase(),
          c.committeeTypeCode ?? null,
          c.parent?.systemCode ?? null,
          c.url ?? null,
          c.isCurrent === false ? 0 : 1,
          now,
        ],
      });
      upserted++;
    }
    if (!j.pagination?.next || rows.length < COMMITTEES_LIST_LIMIT) break;
    offset += COMMITTEES_LIST_LIMIT;
  }
  if (stmts.length > 0) await db.batch(stmts, "write");
  return { fetched, upserted, pages };
}

// --- 2. Committee bills (bill→committees direction) ---------------------

type BillKey = { id: string; updateDate: string; congress: number; type: string; number: number };

type ApiBillCommittees = {
  committees?: Array<{
    systemCode: string;
    activities?: Array<{ date?: string; name?: string }>;
  }>;
};

export type CommitteeBillsResult = {
  billsProcessed: number;
  rowsUpserted: number;
  deadlineHit: boolean;
  cursorStart: string;
  cursorEnd: string;
  fetchErrors: number;
};

async function readBillsCursor(): Promise<string> {
  const db = getDb();
  const rs = await db.execute({
    sql: "SELECT value FROM dashboard_state WHERE key = ?",
    args: [BILLS_CURSOR_KEY],
  });
  return (rs.rows[0]?.value as string | undefined) ?? "1970-01-01T00:00:00Z";
}

async function writeBillsCursor(value: string): Promise<void> {
  const db = getDb();
  await db.execute({
    sql: `INSERT INTO dashboard_state (key, value, updated_at)
          VALUES (?, ?, ?)
          ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    args: [BILLS_CURSOR_KEY, value, new Date().toISOString()],
  });
}

async function selectBillsSince(cursor: string, limit: number): Promise<BillKey[]> {
  const db = getDb();
  // Only fetch bills that have at least one committee referenced in raw_json.
  // Skips ~3% of rows (committees.count IS NULL) and any with count=0 — the
  // bill→committees endpoint returns empty for those anyway.
  const rs = await db.execute({
    sql: `SELECT id, update_date, congress, bill_type, bill_number
          FROM bills
          WHERE congress = ?
            AND update_date > ?
            AND json_extract(raw_json, '$.committees.count') > 0
          ORDER BY update_date ASC, id ASC
          LIMIT ?`,
    args: [CONGRESS, cursor, limit],
  });
  return rs.rows.map((r) => ({
    id: r.id as string,
    updateDate: r.update_date as string,
    congress: r.congress as number,
    type: (r.bill_type as string).toLowerCase(),
    number: r.bill_number as number,
  }));
}

async function fetchBillCommittees(bill: BillKey): Promise<ApiBillCommittees> {
  const url = `${API_BASE}/bill/${bill.congress}/${bill.type}/${bill.number}/committees?api_key=${apiKey()}&format=json`;
  const res = await fetch(url, { signal: AbortSignal.timeout(PER_BILL_HTTP_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`bill committees HTTP ${res.status} for ${bill.id}`);
  return (await res.json()) as ApiBillCommittees;
}

async function upsertCommitteeBills(
  bill: BillKey,
  data: ApiBillCommittees,
): Promise<number> {
  const db = getDb();
  const now = new Date().toISOString();
  const stmts: { sql: string; args: (string | number | null)[] }[] = [];
  for (const c of data.committees ?? []) {
    if (!c.systemCode) continue;
    const activities = c.activities && c.activities.length > 0 ? c.activities : [{ name: null, date: null }];
    for (const a of activities) {
      stmts.push({
        sql: `INSERT INTO committee_bills
              (bill_id, committee_system_code, activity_type, activity_date, updated_at)
              VALUES (?, ?, ?, ?, ?)
              ON CONFLICT(bill_id, committee_system_code, activity_type, activity_date)
              DO UPDATE SET updated_at = excluded.updated_at`,
        args: [bill.id, c.systemCode, a.name ?? null, a.date ?? null, now],
      });
    }
  }
  if (stmts.length > 0) await db.batch(stmts, "write");
  return stmts.length;
}

export type SyncCommitteeBillsOptions = {
  deadlineMs?: number;        // absolute Date.now() deadline; stops starting new bills past this
  perTickLimit?: number;      // hard cap on bills per tick (default 500)
  skipCursorAdvance?: boolean;
};

export async function syncCommitteeBills(
  opts: SyncCommitteeBillsOptions = {},
): Promise<CommitteeBillsResult> {
  const cursorStart = await readBillsCursor();
  const perTickLimit = opts.perTickLimit ?? 500;
  const deadline = opts.deadlineMs ?? Number.POSITIVE_INFINITY;
  const bills = await selectBillsSince(cursorStart, perTickLimit);
  let billsProcessed = 0;
  let rowsUpserted = 0;
  let fetchErrors = 0;
  let cursorEnd = cursorStart;
  let deadlineHit = false;
  for (const bill of bills) {
    if (Date.now() >= deadline) {
      deadlineHit = true;
      break;
    }
    try {
      const data = await fetchBillCommittees(bill);
      rowsUpserted += await upsertCommitteeBills(bill, data);
    } catch (err) {
      fetchErrors++;
      console.warn(`[committees] bill ${bill.id} fetch failed:`, err instanceof Error ? err.message : err);
    }
    billsProcessed++;
    cursorEnd = bill.updateDate; // advance only on attempted-and-completed bills
  }
  if (!opts.skipCursorAdvance && cursorEnd !== cursorStart) {
    await writeBillsCursor(cursorEnd);
  }
  return { billsProcessed, rowsUpserted, deadlineHit, cursorStart, cursorEnd, fetchErrors };
}

// --- 3. Committee members (unitedstates YAML) ---------------------------

// THOMAS code → Congress.gov systemCode. Parent codes are 4 chars (lowercase
// + '00' suffix); subcommittee codes are 6 chars (just lowercase).
function thomasToSystemCode(thomas: string): string {
  const lower = thomas.toLowerCase();
  return lower.length === 4 ? `${lower}00` : lower;
}

type YamlMember = {
  name?: string;
  party?: string;       // 'majority' | 'minority'
  rank?: number;
  title?: string;
  bioguide?: string;
};

export type CommitteeMembersResult = {
  committeesSeen: number;
  membersUpserted: number;
  unknownCommittees: string[];
};

export async function syncCommitteeMembers(): Promise<CommitteeMembersResult> {
  const res = await fetch(MEMBERSHIP_YAML_URL, { signal: AbortSignal.timeout(PER_BILL_HTTP_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`committee-membership-current.yaml HTTP ${res.status}`);
  const body = await res.text();
  const parsed = yaml.load(body) as Record<string, YamlMember[]> | undefined;
  if (!parsed || typeof parsed !== "object") {
    throw new Error("committee-membership-current.yaml did not parse to an object");
  }

  const db = getDb();
  const now = new Date().toISOString();

  // Read the current committees set to skip unknown codes (subcommittee codes
  // not yet in our table on first run, defunct committees, etc.) — log them
  // instead of inserting orphan rows.
  const known = await db.execute("SELECT system_code FROM committees");
  const knownSet = new Set(known.rows.map((r) => r.system_code as string));

  let committeesSeen = 0;
  let membersUpserted = 0;
  const unknownCommittees: string[] = [];

  // Wipe-and-rewrite per committee so roster departures (members leaving the
  // committee) clear correctly. Memberships are ~5K rows total — collect all
  // DELETE + INSERT statements and ship one batch so the daily refresh
  // stays inside the wrapper's 55s soft timeout (one-statement-per-round-
  // trip blew it at 280s during HO 143 verification).
  const stmts: { sql: string; args: (string | number | null)[] }[] = [];
  for (const [thomas, members] of Object.entries(parsed)) {
    if (!Array.isArray(members)) continue;
    const systemCode = thomasToSystemCode(thomas);
    if (!knownSet.has(systemCode)) {
      unknownCommittees.push(`${thomas}→${systemCode}`);
      continue;
    }
    committeesSeen++;
    stmts.push({
      sql: "DELETE FROM committee_members WHERE committee_system_code = ?",
      args: [systemCode],
    });
    for (const m of members) {
      if (!m.bioguide) continue;
      stmts.push({
        sql: `INSERT INTO committee_members
              (committee_system_code, bioguide_id, role, party_side, rank, updated_at)
              VALUES (?, ?, ?, ?, ?, ?)
              ON CONFLICT(committee_system_code, bioguide_id) DO UPDATE SET
                role = excluded.role,
                party_side = excluded.party_side,
                rank = excluded.rank,
                updated_at = excluded.updated_at`,
        args: [
          systemCode,
          m.bioguide,
          m.title ?? null,
          m.party ?? null,
          typeof m.rank === "number" ? m.rank : null,
          now,
        ],
      });
      membersUpserted++;
    }
  }
  if (stmts.length > 0) await db.batch(stmts, "write");

  return { committeesSeen, membersUpserted, unknownCommittees };
}
