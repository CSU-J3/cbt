// HO 143 committees sync. Three operations, three sources:
//
// 1. **Committees list** from Congress.gov `/committee/{N}` — full refresh
//    each tick. ~237 committees + subs, one paginated pass, sub-second.
// 2. **Committee bills** via the bill→committees direction
//    (`/bill/{congress}/{type}/{number}/committees`, every page), keyed PER
//    BILL since HO 753. A bill is walked when it was never walked or its
//    `changed_at` (stamped by lib/sync.ts's UPSERT_SQL when its update_date
//    moves) is newer than its `committees_walked_at`. A walk stamps the bill
//    only after its rows are written, in the same batch, so a failed fetch,
//    the deadline or the per-tick cap leaves it selected, and a late /api/sync
//    write selects it again: there is no shared cursor to move past anything.
//    A bill whose walk fails five times running is set aside (`gaveUp`) until
//    its next update_date change. Stops *starting* new bills at the deadline.
//    The one-off walk of every never-walked bill is `npm run
//    repair:committee-bills`, not the cron.
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
import { getCurrentCongress } from "./congress";
import { getDb } from "./db";

const API_BASE = "https://api.congress.gov/v3";
// HO 712: derived, and this is the ONLY rollover seam on a cron — /api/cron/committees
// runs "0 */12", so it moves on 2027-01-03 with no human present. Both uses are
// safe on an empty answer, but they are safe for different reasons:
//
//   :`/committee/${CONGRESS}` (the list) is a pure upsert — zero rows means the
//     batch is never shipped. Nothing is deleted, nothing is marked stale.
//   :selectBillsToWalk filters `bills WHERE congress = ?`, and since HO 753 the
//     walk carries no cursor (the per-bill stamps name no congress), so it starts
//     on the new Congress's bills with nothing to reset — at the cost of the
//     previous Congress's TAIL: a 119th bill re-updated after rollover (a
//     delayed enactment signature, a lame-duck action) stops being walked.
//     That is the tradeoff SKILL already documents for lib/sync.ts's bill list,
//     reaching a second site; it is accepted here for the same reason.
const CONGRESS = getCurrentCongress();
const COMMITTEES_LIST_LIMIT = 250;
const PER_BILL_HTTP_TIMEOUT_MS = 8_000;
const MEMBERSHIP_YAML_URL =
  "https://raw.githubusercontent.com/unitedstates/congress-legislators/main/committee-membership-current.yaml";

// HO 753: the per-bill walk. MAX_COMMITTEE_PAGES bounds the pagination follow
// (the endpoint pages at 20; the most any 119th bill lists is 21). GIVE_UP_AT is
// the run of failed walks at which a bill is set aside until it changes again.
// The old `committee_bills_sync_cursor` row in dashboard_state is no longer read
// or written; it is left in place.
const MAX_COMMITTEE_PAGES = 10;
export const GIVE_UP_AT = 5;

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
  pagination?: { next?: string };
};

export type CommitteeBillsResult = {
  billsProcessed: number; // attempted this tick
  billsWalked: number; // fetched and written, so stamped
  rowsUpserted: number;
  deadlineHit: boolean;
  capHit: boolean; // the selection filled the per-tick cap
  rateLimited: boolean; // a 429 ended the walk (HO 753)
  fetchErrors: number; // a write failure counts here too
  failed: { count: number; ids: string[] }; // this tick's failed walks, up to 20 ids
  remaining: number; // bills still selected after the tick
  gaveUp: { count: number; ids: string[] }; // owed a walk but set aside at GIVE_UP_AT, up to 20 ids
};

// A 429 is the key's limit, not the bill's fault: it ends the walk and counts no failure.
export class RateLimitedError extends Error {
  constructor(billId: string) {
    super(`bill committees HTTP 429 for ${billId}`);
    this.name = "RateLimitedError";
  }
}

// The deadline passed between two pages of one bill: the walk stops there, the
// bill is neither stamped nor charged, and it stays owed.
class WalkDeadlineError extends Error {
  constructor(billId: string) {
    super(`deadline reached between pages for ${billId}`);
    this.name = "WalkDeadlineError";
  }
}

// HO 753, THE WALK KEY. A bill is owed a walk when it was never walked or its
// last local change (`changed_at`, stamped by lib/sync.ts's UPSERT_SQL only when
// its update_date moves) is newer than its last walk. Nothing is shared between
// bills, so nothing one bill does can pass another over: a failed fetch, a cut
// group and a late /api/sync write all leave the bill owed. The walk predicate
// comes first so it filters on two late columns (about 60 ms over the 119th
// bills, priced at HO 753) before json_extract parses raw_json for what is left.
const OWED = "(committees_walked_at IS NULL OR committees_walked_at < changed_at)";

async function selectBillsToWalk(limit: number): Promise<BillKey[]> {
  const db = getDb();
  // Only bills that have at least one committee referenced in raw_json. Skips
  // ~3% of rows (committees.count IS NULL) and any with count=0 — the
  // bill→committees endpoint returns empty for those anyway. Stamped changes
  // sort ahead of the never-stamped backlog (NULL changed_at), so a bill that
  // changed is walked before the repair's set even if the repair is late.
  const rs = await db.execute({
    sql: `SELECT id, update_date, congress, bill_type, bill_number
          FROM bills
          WHERE congress = ?
            AND ${OWED}
            AND COALESCE(committee_walk_failures, 0) < ?
            AND json_extract(raw_json, '$.committees.count') > 0
          ORDER BY (changed_at IS NULL), changed_at ASC, id ASC
          LIMIT ?`,
    args: [CONGRESS, GIVE_UP_AT, limit],
  });
  return rs.rows.map((r) => ({
    id: r.id as string,
    updateDate: r.update_date as string,
    congress: r.congress as number,
    type: (r.bill_type as string).toLowerCase(),
    number: r.bill_number as number,
  }));
}

// What is still owed after a walk: the bills the next tick will select, and the
// ones set aside after GIVE_UP_AT failed walks (they come back on their next change).
export async function readCommitteeWalkBacklog(): Promise<{ remaining: number; gaveUp: { count: number; ids: string[] } }> {
  const db = getDb();
  const rs = await db.execute({
    sql: `SELECT SUM(CASE WHEN COALESCE(committee_walk_failures, 0) < ? THEN 1 ELSE 0 END) AS remaining,
                 SUM(CASE WHEN COALESCE(committee_walk_failures, 0) >= ? THEN 1 ELSE 0 END) AS gave_up
          FROM bills
          WHERE congress = ? AND ${OWED} AND json_extract(raw_json, '$.committees.count') > 0`,
    args: [GIVE_UP_AT, GIVE_UP_AT, CONGRESS],
  });
  const remaining = Number(rs.rows[0]?.remaining ?? 0);
  const count = Number(rs.rows[0]?.gave_up ?? 0);
  const ids = count
    ? (await db.execute({
        sql: `SELECT id FROM bills
              WHERE congress = ? AND ${OWED} AND COALESCE(committee_walk_failures, 0) >= ?
                AND json_extract(raw_json, '$.committees.count') > 0
              ORDER BY id LIMIT 20`,
        args: [CONGRESS, GIVE_UP_AT],
      })).rows.map((r) => r.id as string)
    : [];
  return { remaining, gaveUp: { count, ids } };
}

// The repair paces itself through these; the cron passes none.
export type WalkHooks = {
  beforeFetch?: () => Promise<void>;
  afterFetch?: (res: Response) => void;
};

async function fetchBillCommittees(
  bill: BillKey,
  hooks: WalkHooks = {},
  deadline = Number.POSITIVE_INFINITY,
): Promise<ApiBillCommittees> {
  const key = apiKey();
  let url = `${API_BASE}/bill/${bill.congress}/${bill.type}/${bill.number}/committees?api_key=${key}&format=json`;
  const committees: NonNullable<ApiBillCommittees["committees"]> = [];
  for (let page = 0; page < MAX_COMMITTEE_PAGES; page++) {
    // No page starts after the deadline: the budget assumed one fetch per bill.
    if (page > 0 && Date.now() >= deadline) throw new WalkDeadlineError(bill.id);
    await hooks.beforeFetch?.();
    const res = await fetch(url, { signal: AbortSignal.timeout(PER_BILL_HTTP_TIMEOUT_MS) });
    hooks.afterFetch?.(res);
    if (res.status === 429) throw new RateLimitedError(bill.id);
    if (!res.ok) throw new Error(`bill committees HTTP ${res.status} for ${bill.id}`);
    const j = (await res.json()) as ApiBillCommittees;
    committees.push(...(j.committees ?? []));
    // HO 753: the endpoint pages at 20, and the rows are the union of every page.
    // `next` carries no key, so the key is re-attached, and only for api.congress.gov.
    const next = j.pagination?.next;
    if (!next) return { committees };
    const u = new URL(next);
    if (u.hostname !== "api.congress.gov") {
      throw new Error(`bill committees for ${bill.id}: next page is off-host (${u.hostname})`);
    }
    u.searchParams.set("api_key", key);
    u.searchParams.set("format", "json");
    url = u.href;
  }
  throw new Error(`bill committees for ${bill.id}: more than ${MAX_COMMITTEE_PAGES} pages`);
}

// The rows, and the bill's walk stamp in the SAME batch: a bill is marked walked
// only if its rows landed. The stamp also clears its failure count.
async function upsertCommitteeBills(
  bill: BillKey,
  data: ApiBillCommittees,
  walkedAt: string,
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
  const rows = stmts.length;
  stmts.push({
    sql: "UPDATE bills SET committees_walked_at = ?, committee_walk_failures = 0 WHERE id = ?",
    args: [walkedAt, bill.id],
  });
  await db.batch(stmts, "write");
  return rows;
}

async function recordWalkFailure(billId: string): Promise<void> {
  await getDb().execute({
    sql: "UPDATE bills SET committee_walk_failures = COALESCE(committee_walk_failures, 0) + 1 WHERE id = ?",
    args: [billId],
  });
}

export type SyncCommitteeBillsOptions = {
  deadlineMs?: number;        // absolute Date.now() deadline; stops starting new bills past this
  perTickLimit?: number;      // hard cap on bills per tick (default 500)
  hooks?: WalkHooks;          // HO 753: the repair's pacing; the cron passes none
  // HO 753: count a failed walk toward GIVE_UP_AT (default true, the cron). The repair
  // passes false: its rounds are minutes apart, not 12 hours, so an outage during a
  // run would set bills aside in minutes with nothing to bring them back.
  countFailures?: boolean;
};

export async function syncCommitteeBills(
  opts: SyncCommitteeBillsOptions = {},
): Promise<CommitteeBillsResult> {
  const perTickLimit = opts.perTickLimit ?? 500;
  const deadline = opts.deadlineMs ?? Number.POSITIVE_INFINITY;
  const bills = await selectBillsToWalk(perTickLimit);
  let billsProcessed = 0;
  let billsWalked = 0;
  let rowsUpserted = 0;
  let fetchErrors = 0;
  let deadlineHit = false;
  let rateLimited = false;
  const failedIds: string[] = [];
  for (const bill of bills) {
    if (Date.now() >= deadline) {
      deadlineHit = true;
      break;
    }
    // The stamp is the time the walk STARTED: a /api/sync write that lands while
    // this fetch is in flight stamps a later changed_at, so the bill stays owed.
    const walkedAt = new Date().toISOString();
    billsProcessed++;
    try {
      const data = await fetchBillCommittees(bill, opts.hooks, deadline);
      rowsUpserted += await upsertCommitteeBills(bill, data, walkedAt);
      billsWalked++;
    } catch (err) {
      if (err instanceof WalkDeadlineError) {
        deadlineHit = true;
        billsProcessed--;
        console.warn(`[committees] ${err.message}; it stays owed`);
        break;
      }
      if (err instanceof RateLimitedError) {
        rateLimited = true;
        console.warn(`[committees] ${err.message}; the walk stops, and no failure is counted`);
        break;
      }
      fetchErrors++;
      if (failedIds.length < 20) failedIds.push(bill.id);
      console.warn(`[committees] bill ${bill.id} fetch failed:`, err instanceof Error ? err.message : err);
      if (opts.countFailures !== false) {
        try {
          await recordWalkFailure(bill.id);
        } catch (e) {
          console.warn(`[committees] could not count the failure for ${bill.id}:`, e instanceof Error ? e.message : e);
        }
      }
    }
  }
  const backlog = await readCommitteeWalkBacklog();
  return {
    billsProcessed,
    billsWalked,
    rowsUpserted,
    deadlineHit,
    capHit: bills.length >= perTickLimit,
    rateLimited,
    fetchErrors,
    failed: { count: fetchErrors, ids: failedIds },
    remaining: backlog.remaining,
    gaveUp: backlog.gaveUp,
  };
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
  rosterDeletesRefused: string[]; // HO 568 — codes whose delete was refused (existing roster, empty/insertless incoming)
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
  const rosterDeletesRefused: string[] = [];

  // HO 568 — the currently-rostered set, for the refusal fork below. A committee
  // with existing rows whose incoming roster is empty/insertless is a real
  // protection event (refuse + REPORT); an unrostered one is a silent skip
  // (nothing to protect, nothing lost). Keeps rosterDeletesRefused signal-
  // bearing at steady state: source-absent bodies (the 10 today) never enter the
  // loop, and a source-empty unrostered code skips silently — see HO 566 M1.
  const rosteredRs = await db.execute(
    "SELECT committee_system_code FROM committee_members GROUP BY committee_system_code",
  );
  const rosteredSet = new Set(
    rosteredRs.rows.map((r) => r.committee_system_code as string),
  );

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
    // HO 568 — build the inserts first and gate the DELETE on the INSERTABLE
    // count (entries carrying a bioguide), NOT raw array length: a non-empty
    // array of insertless entries erases just as thoroughly, so it must refuse
    // exactly like an empty one. The 564 rule ported to the standing wipe: a
    // sync must never convert absence of evidence into deletion.
    const inserts: { sql: string; args: (string | number | null)[] }[] = [];
    for (const m of members) {
      if (!m.bioguide) continue;
      inserts.push({
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
    }
    if (inserts.length === 0) {
      // Nothing authoritative to write. Refuse the delete backed by nothing;
      // only REPORT it when a roster actually existed (else nothing to protect).
      if (rosteredSet.has(systemCode)) rosterDeletesRefused.push(systemCode);
      continue;
    }
    // DELETE + its INSERTs still ship together in the ONE batch (HO 143).
    stmts.push({
      sql: "DELETE FROM committee_members WHERE committee_system_code = ?",
      args: [systemCode],
    });
    for (const ins of inserts) {
      stmts.push(ins);
      membersUpserted++;
    }
  }
  if (stmts.length > 0) await db.batch(stmts, "write");

  if (rosterDeletesRefused.length > 0) {
    console.warn(
      `[committees] roster deletes refused (HO 568): ${rosterDeletesRefused.length} — ${rosterDeletesRefused.join(", ")}`,
    );
  }

  return { committeesSeen, membersUpserted, unknownCommittees, rosterDeletesRefused };
}
