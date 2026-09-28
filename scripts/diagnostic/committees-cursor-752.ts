// HO 752: has the committees cursor lost anything? A READ-ONLY probe of the
// bills cursor and the two meetings watermarks, with Congress.gov as the authority.
//
//   npx tsx scripts/diagnostic/committees-cursor-752.ts --controls --out <dir>   # the controls, on a file: copy
//   npx tsx scripts/diagnostic/committees-cursor-752.ts --prod       # the prod reading
//     [--key cursor|changed_at]          HO 753: `cursor` (default) keys the candidates on the
//                                        committee_bills_sync_cursor; `changed_at` keys them on the
//                                        per-bill walk (committees_walked_at IS NULL OR < changed_at)
//     [--db <file:…|libsql:…>]           read this database instead of TURSO_DATABASE_URL (a legs copy)
//     --out <dir> [--only bills|meetings] artifacts to <dir> (required; never 752-artifacts); bills and census
//                                        only, or (HO 754) the meetings section only
//     [--meetings watermark|table]       HO 754: `watermark` (default) classifies the events at or below
//                                        meeting_sync_state as HO 752 did; `table` classifies every listed
//                                        event against committee_meetings with no watermark (the walk HO 754
//                                        built), names each stored row the list does not report as marked
//                                        absent or not, and names the events the walk has set aside
//     [--log-failed=<bill>@<tick>,...]   the bills the runtime logs name as a tick's
//                                        failed fetch, read inside the logs window
//
// It builds nothing and writes nothing to prod: SELECTs through a reader that
// refuses anything else, and GETs to api.congress.gov in the sync's own URL
// shapes (lib/committees-sync.ts:189 for a bill's committees, not exported, so
// copied; lib/meetings-sync.ts's readWholeList and fetchMeetingDetail for the meetings list and detail,
// copied so every GET goes through one paced, logged getter). GETs start at
// least 200ms apart and are capped at 1,000 a run; a 429 stops the run with
// what was read, and every section says how many GETs the cap or a stop cut.
// The key is CONGRESS_API_KEY, read by name; every string that could carry a
// URL passes redactSecrets (lib/redact.ts:92) before it is printed or written.
//
// What it reads (docs/handoffs/752-committees-cursor-probe.md):
//   1. the walked set at or below the bills cursor with no committee_bills row
//      (the candidates), and the walked set above it (pending);
//   2. each candidate resolved against its committees endpoint: `lost` (a
//      committee with a systemCode is listed, so upsertCommitteeBills would
//      have written a row), `empty` (none, the :203 skip), `error`;
//   3. each `lost` bill attributed to a path from the tick payloads
//      (truncation / failure / race / unattributed): a reading of payloads, not
//      a proof of mechanism;
//   4. the stale class: a seeded sample of 200 walked bills WITH rows, each
//      endpoint's activities against the stored rows;
//   5. meetings per chamber, classified from the SAVED list: every event at or
//      below the watermark against committee_meetings (current / older / newer
//      / missing, then lost / null-detail / error), the pending above, and how
//      often the list's updateDate equals the detail's;
//   6. the census the backlog line carried, re-derived over the walked set.
//
// Two departures, named: a bill's committees endpoint pages at 20 and the sync
// reads page 1 only, so page 1 decides every verdict (the sync's view) and any
// further page is read too and reported apart; and --controls ends with a sixth,
// network-free check of the verdict branches, the list's completeness and the
// read guard, beyond the handoff's five.
import { config } from "dotenv";
import { createClient, type Client, type InArgs, type InStatement, type InValue, type ResultSet } from "@libsql/client";
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { redactSecrets } from "@/lib/redact";

config({ path: ".env", quiet: true });

const API_BASE = "https://api.congress.gov/v3"; // lib/committees-sync.ts:27 (not exported)
const CONGRESS = 119;
const ART = "docs/handoffs/752-artifacts";
const GAP_MS = 200;
const CAP = 1000;
const BILL_TIMEOUT_MS = 8_000; // lib/committees-sync.ts:43
const MEETING_TIMEOUT_MS = 15_000; // lib/meetings-sync.ts HTTP_TIMEOUT_MS
const LIST_LIMIT = 250; // lib/meetings-sync.ts LIST_LIMIT
const PER_TICK_LIMIT = 500; // the bills default, lib/committees-sync.ts:230 (the route passes none, route.ts:74-76)
const CANDIDATE_SAMPLE = 500;
const STALE_SAMPLE = 200;
const AGREE_SAMPLE = 50;
const SEED = 752;
const S = (v: unknown) => (v == null ? null : String(v));
// HO 753: walked and not owed since (the complement of lib/committees-sync.ts's OWED).
const WALK_CURRENT = "b.committees_walked_at IS NOT NULL AND (b.changed_at IS NULL OR b.committees_walked_at >= b.changed_at)";
const NOT_FETCHED = "not fetched";
// Binds every output to the bytes that produced it.
const SCRIPT_SHA = createHash("sha256").update(readFileSync(process.argv[1]!)).digest("hex").slice(0, 12);

// ── a seeded PRNG (mulberry32), so every sample is reproducible ─────────────
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function sample<T>(xs: T[], n: number, seed: number): T[] {
  const r = rng(seed);
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a.slice(0, n);
}

// ── reading ────────────────────────────────────────────────────────────────
type Read = (sql: string, args?: InArgs) => Promise<ResultSet>;
function readerOf(db: Client): Read {
  return (sql, args) => {
    // SELECT only: a WITH prefix can carry a write (`WITH x AS (…) DELETE …`).
    if (!/^\s*SELECT\b/i.test(sql)) throw new Error("read-only: refused a non-SELECT");
    return db.execute({ sql, args: args ?? [] });
  };
}

// ── the paced, capped, logged GET ─────────────────────────────────────────
type Got = { status: number | null; json: Record<string, unknown> | null; error: string | null };
export type Getter = { get: (label: string, pathQuery: string, timeoutMs: number) => Promise<Got>; requests: () => number; stopped: () => string | null; minGapMs: () => number | null };
function makeGetter(logFile: string): Getter {
  const key = (process.env.CONGRESS_API_KEY ?? "").trim();
  if (!key) throw new Error("CONGRESS_API_KEY is not set");
  let requests = 0;
  let last: number | null = null;
  let minGap: number | null = null;
  let stopped: string | null = null;
  return {
    requests: () => requests,
    stopped: () => stopped,
    minGapMs: () => minGap,
    get: async (label, pathQuery, timeoutMs) => {
      if (stopped) return { status: null, json: null, error: `${NOT_FETCHED}: ${stopped}` };
      if (requests >= CAP) {
        stopped = `the ${CAP}-request cap`;
        return { status: null, json: null, error: `${NOT_FETCHED}: ${stopped}` };
      }
      if (last !== null) {
        let wait = last + GAP_MS - Date.now();
        while (wait > 0) {
          await new Promise((r) => setTimeout(r, wait));
          wait = last + GAP_MS - Date.now();
        }
      }
      const t0 = Date.now();
      if (last !== null) minGap = Math.min(minGap ?? Infinity, t0 - last);
      last = t0;
      requests++;
      const sep = pathQuery.includes("?") ? "&" : "?";
      let got: Got;
      try {
        const res = await fetch(`${API_BASE}${pathQuery}${sep}api_key=${key}&format=json`, { signal: AbortSignal.timeout(timeoutMs) });
        const json = res.ok ? ((await res.json()) as Record<string, unknown>) : null;
        if (!res.ok) await res.text().catch(() => "");
        got = { status: res.status, json, error: res.ok ? null : `HTTP ${res.status}` };
        if (res.status === 429) stopped = "a 429 from api.congress.gov";
      } catch (e) {
        got = { status: null, json: null, error: redactSecrets(e instanceof Error ? `${e.name}: ${e.message}` : String(e)) };
      }
      appendFileSync(logFile, redactSecrets(`${new Date(t0).toISOString()} #${requests} ${label} GET ${API_BASE}${pathQuery} → ${got.status ?? got.error} ${Date.now() - t0}ms\n`));
      return got;
    },
  };
}
const cut = (errors: (string | null)[]) => errors.filter((e) => e?.startsWith(NOT_FETCHED)).length;

// ── 1 & 2. the bills: candidates, pending, resolution ──────────────────────
export type BillKey = { id: string; update_date: string; type: string; number: number };
const billKeyOf = (r: ResultSet["rows"][number]): BillKey => ({ id: String(r.id), update_date: String(r.update_date), type: String(r.bill_type).toLowerCase(), number: Number(r.bill_number) });
export async function readCursor(read: Read) {
  return String((await read(`SELECT value FROM dashboard_state WHERE key = 'committee_bills_sync_cursor'`)).rows[0]?.value ?? "1970-01-01T00:00:00Z");
}
export type Key = "cursor" | "changed_at";
export async function billsSets(read: Read, key: Key = "cursor") {
  const cursor = await readCursor(read);
  if (key === "changed_at") {
    // HO 753: the walk's own selection (lib/committees-sync.ts selectBillsToWalk), every bill owed a
    // walk, the given-up ones included and counted apart. The walk predicate runs before json_extract.
    const all = (await read(`SELECT COUNT(*) AS n FROM bills WHERE congress = ? AND json_extract(raw_json, '$.committees.count') > 0`, [CONGRESS])).rows[0]!;
    const owed = (await read(
      `SELECT b.id, b.update_date, b.bill_type, b.bill_number, COALESCE(b.committee_walk_failures, 0) AS f FROM bills b
        WHERE b.congress = ? AND (b.committees_walked_at IS NULL OR b.committees_walked_at < b.changed_at)
          AND json_extract(b.raw_json, '$.committees.count') > 0
        ORDER BY (b.changed_at IS NULL), b.changed_at, b.id`,
      [CONGRESS],
    )).rows;
    return { cursor, walked: Number(all.n ?? 0), pending: 0, candidates: owed.map(billKeyOf), gaveUp: owed.filter((r) => Number(r.f) >= 5).length };
  }
  const counts = (await read(
    `SELECT SUM(CASE WHEN update_date <= ? THEN 1 ELSE 0 END) AS walked, SUM(CASE WHEN update_date > ? THEN 1 ELSE 0 END) AS pending
       FROM bills WHERE congress = ? AND json_extract(raw_json, '$.committees.count') > 0`,
    [cursor, cursor, CONGRESS],
  )).rows[0]!;
  const candidates = (await read(
    `SELECT b.id, b.update_date, b.bill_type, b.bill_number FROM bills b
      WHERE b.congress = ? AND b.update_date <= ?
        AND json_extract(b.raw_json, '$.committees.count') > 0
        AND NOT EXISTS (SELECT 1 FROM committee_bills cb WHERE cb.bill_id = b.id)
      ORDER BY b.update_date, b.id`,
    [CONGRESS, cursor],
  )).rows.map(billKeyOf);
  return { cursor, walked: Number(counts.walked ?? 0), pending: Number(counts.pending ?? 0), candidates, gaveUp: 0 };
}
export const billPath = (b: BillKey) => `/bill/${CONGRESS}/${b.type}/${b.number}/committees`; // lib/committees-sync.ts:189
type Committee = { systemCode?: string; name?: string; activities?: { name?: string; date?: string }[] };
// Page 1 in the sync's own shape is what upsertCommitteeBills sees: the endpoint
// pages at 20 committees and the sync never reads `pagination` (:188-193). The
// rest is read here too (a departure from the sync's shape, named), and kept apart.
export type BillCommittees = { page1: Committee[]; beyond: Committee[]; count: number | null; error: string | null };
export async function fetchBillCommittees(g: Getter, label: string, b: BillKey): Promise<BillCommittees> {
  const r = await g.get(label, billPath(b), BILL_TIMEOUT_MS);
  if (!r.json) return { page1: [], beyond: [], count: null, error: r.error };
  const page1 = (r.json.committees as Committee[] | undefined) ?? [];
  const pg = r.json.pagination as { count?: number; next?: string } | undefined;
  const count = pg?.count == null ? null : Number(pg.count);
  if (!pg?.next && (count == null || count <= page1.length)) return { page1, beyond: [], count, error: null };
  const r2 = await g.get(`${label} (beyond page 1)`, `${billPath(b)}?offset=${page1.length}&limit=250`, BILL_TIMEOUT_MS);
  if (!r2.json) return { page1, beyond: [], count, error: `beyond page 1: ${r2.error}` };
  return { page1, beyond: (r2.json.committees as Committee[] | undefined) ?? [], count, error: null };
}
const codesOf = (cs: Committee[]) => cs.map((c) => c.systemCode).filter((c): c is string => !!c);
// firstActivity: the earliest activity date among page 1's committees with a
// systemCode. A committee acting before a tick started was on the endpoint when
// that tick could have walked it, barring upstream publication lag.
export type Resolved = BillKey & { verdict: "lost" | "empty" | "error"; codes: string[]; beyond: string[]; firstActivity: string | null; error: string | null };
export async function resolveBill(g: Getter, b: BillKey): Promise<Resolved> {
  const f = await fetchBillCommittees(g, `bill ${b.id}`, b);
  if (f.error && !f.page1.length) return { ...b, verdict: "error", codes: [], beyond: [], firstActivity: null, error: f.error };
  const codes = codesOf(f.page1);
  const dates = f.page1.filter((c) => c.systemCode).flatMap((c) => (c.activities ?? []).map((a) => a.date).filter((d): d is string => !!d)).sort();
  return { ...b, verdict: codes.length ? "lost" : "empty", codes, beyond: codesOf(f.beyond), firstActivity: dates[0] ?? null, error: f.error };
}

// ── 3. attribution, pure ───────────────────────────────────────────────────
export type Tick = { id: number; status: string; started_at: string; error?: string | null; bills: { cursorStart: string; cursorEnd: string; billsProcessed: number; deadlineHit: boolean; fetchErrors: number } | null;
  // HO 753: a per-bill walk tick has no cursor range; its stats are read apart, so attribution stays cursor-era only.
  walk?: { billsProcessed: number; billsWalked: number; deadlineHit: boolean; capHit: boolean; rateLimited: boolean; fetchErrors: number; failed: number; gaveUp: number; remaining: number } | null };
export type Path = "truncation" | "failure" | "race" | "unattributed";
// race's parts: the handoff's race is U strictly inside a CLEAN tick's range
// (clean-inside). Two shapes it does not name also land there, each kept apart:
// U strictly inside a tick that stopped early with no fetch errors
// (early-inside: the loop only breaks before starting a bill, so every selected
// bill below cursorEnd was walked, lib/committees-sync.ts:236-252, and this one
// too was not in the select), and U at a clean tick's cursorEnd (clean-at-end).
export type RaceSub = "clean-inside" | "early-inside" | "clean-at-end";
export function attribute(u: string, ticks: Tick[]): { path: Path; sub: RaceSub | null; tick: number | null; holders: number; why: string } {
  const holders = ticks.filter((t) => t.status === "success" && t.bills && t.bills.cursorStart < u && u <= t.bills.cursorEnd);
  if (!holders.length) {
    // Name which: U at or before the first success tick's cursorStart predates
    // the history; otherwise it sits in a gap between two success ranges, and
    // the ticks between them (by id) are the unread ones that moved the cursor.
    const ok = ticks.filter((t) => t.status === "success" && t.bills);
    const first = ok[0];
    if (!first || u <= first.bills!.cursorStart) return { path: "unattributed", sub: null, tick: null, holders: 0, why: `U predates the history${first ? `: at or below the first success tick's cursorStart (#${first.id}'s, ${first.bills!.cursorStart})` : ""}` };
    const before = [...ok].reverse().find((t) => t.bills!.cursorEnd < u);
    const after = ok.find((t) => t.bills!.cursorStart >= u);
    const between = ticks.filter((t) => t.status !== "success" && (!before || t.id > before.id) && (!after || t.id < after.id)).map((t) => `#${t.id} ${t.status}`);
    return { path: "unattributed", sub: null, tick: null, holders: 0, why: `U sits in a hole: after #${before?.id ?? "?"} (cursorEnd ${before?.bills!.cursorEnd ?? "?"}), before ${after ? `#${after.id} (cursorStart ${after.bills!.cursorStart})` : "any later success tick"}; between them ${between.join(", ") || "no unread tick"}` };
  }
  const t = holders[0]!;
  const b = t.bills!;
  const early = b.deadlineHit || b.billsProcessed >= PER_TICK_LIMIT;
  const more = holders.length > 1 ? ` (${holders.length} ticks hold U; read the first, #${t.id})` : "";
  const stop = b.deadlineHit ? "stopped early (deadlineHit)" : b.billsProcessed >= PER_TICK_LIMIT ? `stopped early (billsProcessed ${b.billsProcessed})` : "had no early stop";
  if (u === b.cursorEnd && early) return { path: "truncation", sub: null, tick: t.id, holders: holders.length, why: `U is the cursorEnd of #${t.id}, which ${stop}${more}` };
  if (b.fetchErrors > 0) return { path: "failure", sub: null, tick: t.id, holders: holders.length, why: `#${t.id} had fetchErrors ${b.fetchErrors} and ${stop}: a candidate until its log line names the bill${more}` };
  const sub: RaceSub = u === b.cursorEnd ? "clean-at-end" : early ? "early-inside" : "clean-inside";
  return { path: "race", sub, tick: t.id, holders: holders.length, why: `U sits ${u === b.cursorEnd ? "at the cursorEnd, not strictly inside, of" : "strictly inside"} #${t.id}'s range, which ${stop} and had no fetch errors${sub === "early-inside" ? " (outside the handoff's race: an early stop, but U below cursorEnd; consistent with no select holding it, barring publication lag)" : ""}${more}` };
}
// A tick can fail at most fetchErrors bills, so the failure-path candidates it
// holds bound how many of them are its failed fetch.
export function failureBound(attributed: Iterable<{ path: Path; tick: number | null }>, ticks: Tick[]) {
  const per = new Map<number, number>();
  for (const a of attributed) if (a.path === "failure" && a.tick != null) per.set(a.tick, (per.get(a.tick) ?? 0) + 1);
  const rows = [...per].map(([id, nb]) => ({ id, nb, fe: ticks.find((t) => t.id === id)?.bills?.fetchErrors ?? 0 }));
  return { rows, atMost: rows.reduce((s, x) => s + Math.min(x.nb, x.fe), 0), of: rows.reduce((s, x) => s + x.nb, 0) };
}
// Every failed fetch, not only those on candidates. A candidate in a tick with
// fetch errors could be its failed bill (any path: the bill at a truncated
// cursorEnd too), up to that tick's fetchErrors; a runtime log that names a
// non-candidate as the tick's failure takes that failure off the candidates.
export function fetchTally(ticks: Tick[], attributed: Iterable<{ tick: number | null }>, namedNonCandidates: Map<number, number> = new Map()) {
  const inTick = new Map<number, number>();
  for (const a of attributed) if (a.tick != null) inTick.set(a.tick, (inTick.get(a.tick) ?? 0) + 1);
  const fe = ticks.filter((t) => t.status === "success" && (t.bills?.fetchErrors ?? 0) > 0);
  const total = fe.reduce((s, t) => s + t.bills!.fetchErrors, 0);
  const blind = fe.reduce((s, t) => s + Math.min(t.bills!.fetchErrors, inTick.get(t.id) ?? 0), 0);
  const informed = fe.reduce((s, t) => s + Math.min(Math.max(0, t.bills!.fetchErrors - (namedNonCandidates.get(t.id) ?? 0)), inTick.get(t.id) ?? 0), 0);
  return { total, ticks: fe.length, blind, informed, noCandidate: fe.filter((t) => !(inTick.get(t.id) ?? 0)).map((t) => `#${t.id}`) };
}
export async function readTicks(read: Read): Promise<Tick[]> {
  const rs = await read(`SELECT id, status, started_at, payload, error_message FROM cron_runs WHERE route = '/api/cron/committees' ORDER BY id`);
  return rs.rows.map((r) => {
    let bills: Tick["bills"] = null;
    let walk: Tick["walk"] = null;
    if (r.status === "success" && r.payload) {
      try {
        // lib/cron-log.ts:166 wraps the route's payload: {ok, elapsedMs, payload}
        const b = (JSON.parse(String(r.payload)) as { payload?: { bills?: Record<string, unknown> } }).payload?.bills;
        if (b && b.cursorStart != null && b.cursorEnd != null) bills = { cursorStart: String(b.cursorStart), cursorEnd: String(b.cursorEnd), billsProcessed: Number(b.billsProcessed ?? 0), deadlineHit: !!b.deadlineHit, fetchErrors: Number(b.fetchErrors ?? 0) };
        else if (b && b.billsWalked != null) walk = { billsProcessed: Number(b.billsProcessed ?? 0), billsWalked: Number(b.billsWalked), deadlineHit: !!b.deadlineHit, capHit: !!b.capHit, rateLimited: !!b.rateLimited, fetchErrors: Number(b.fetchErrors ?? 0), failed: Number((b.failed as { count?: number } | undefined)?.count ?? 0), gaveUp: Number((b.gaveUp as { count?: number } | undefined)?.count ?? 0), remaining: Number(b.remaining ?? 0) };
      } catch { /* a malformed payload stays null and cannot attribute */ }
    }
    return { id: Number(r.id), status: String(r.status), started_at: String(r.started_at), error: r.error_message == null ? null : redactSecrets(String(r.error_message)).slice(0, 200), bills, walk };
  });
}

// ── 4. the stale class ─────────────────────────────────────────────────────
export async function staleSampleOf(read: Read, cursor: string, key: Key = "cursor"): Promise<{ sample: BillKey[]; population: number }> {
  // HO 753: under the changed_at key the frozen cursor bounds nothing; the sample is the walk-current
  // bills, since an owed bill's unwalked activities would read as at-or-before stale.
  const bound = key === "cursor" ? "AND b.update_date <= ?" : `AND ${WALK_CURRENT}`;
  const withRows = (await read(
    `SELECT b.id, b.update_date, b.bill_type, b.bill_number FROM bills b
      WHERE b.congress = ? ${bound} AND json_extract(b.raw_json, '$.committees.count') > 0
        AND EXISTS (SELECT 1 FROM committee_bills cb WHERE cb.bill_id = b.id)
      ORDER BY b.id`,
    key === "cursor" ? [CONGRESS, cursor] : [CONGRESS],
  )).rows.map(billKeyOf);
  return { sample: sample(withRows, STALE_SAMPLE, SEED), population: withRows.length };
}
export async function storedRowsFor(read: Read, ids: string[]) {
  const out = new Map<string, Set<string>>();
  for (const id of ids) out.set(id, new Set());
  for (let i = 0; i < ids.length; i += 200) {
    const part = ids.slice(i, i + 200);
    const rs = await read(`SELECT bill_id, committee_system_code, activity_type, activity_date FROM committee_bills WHERE bill_id IN (${part.map(() => "?").join(",")})`, part);
    for (const r of rs.rows) out.get(String(r.bill_id))!.add(`${r.committee_system_code}|${S(r.activity_type) ?? ""}|${S(r.activity_date) ?? ""}`);
  }
  return out;
}
type Activity = { code: string; name: string | null; date: string | null };
// What upsertCommitteeBills would write for this response (lib/committees-sync.ts:202-213):
// top-level committees with a systemCode, one row per activity, one null row with none.
export function expectedActivities(committees: Committee[]): Activity[] {
  const out: Activity[] = [];
  for (const c of committees) {
    if (!c.systemCode) continue;
    const acts = c.activities && c.activities.length ? c.activities : [{ name: undefined, date: undefined }];
    for (const a of acts) out.push({ code: c.systemCode, name: a.name ?? null, date: a.date ?? null });
  }
  return out;
}
export type Side = "at-or-before" | "after" | "no-date";
export function staleOf(b: BillKey, expected: Activity[], stored: Set<string>) {
  return expected
    .filter((e) => !stored.has(`${e.code}|${e.name ?? ""}|${e.date ?? ""}`))
    .map((e) => ({ ...e, side: (e.date == null ? "no-date" : e.date <= b.update_date ? "at-or-before" : "after") as Side }));
}

// ── 5. meetings ────────────────────────────────────────────────────────────
type ListItem = { eventId: string; updateDate: string };
// Fetch every page (the list URL lib/meetings-sync.ts reads, in steps of 250 with no overlap:
// the instrument's own complete read, with tie windows below) and save it raw, redacted.
type SavedPage = { offset: number; recovery?: boolean; pagination: { count?: number; next?: string } | null; committeeMeetings: { eventId?: string | number; updateDate?: string }[] };
export async function fetchAndSaveList(g: Getter, chamber: string, file: string) {
  const pages: SavedPage[] = [];
  let offset = 0, pagingEnded = false, error: string | null = null;
  while (pages.length < 40) {
    const r = await g.get(`meetings list ${chamber} @${offset}`, `/committee-meeting/${CONGRESS}/${chamber}?limit=${LIST_LIMIT}&offset=${offset}`, MEETING_TIMEOUT_MS);
    if (!r.json) { error = r.error; break; }
    const rows = (r.json.committeeMeetings as SavedPage["committeeMeetings"] | undefined) ?? [];
    pages.push({ offset, pagination: (r.json.pagination as SavedPage["pagination"]) ?? null, committeeMeetings: rows });
    if (!(r.json.pagination as { next?: string } | undefined)?.next || rows.length < LIST_LIMIT) { pagingEnded = true; break; }
    offset += LIST_LIMIT;
  }
  // Offset pages over tied updateDates can repeat one event and skip another at
  // a page boundary. Where a boundary falls inside a tie, read one window
  // centred on it, so the whole tie comes back in a single response.
  const raw = pages.flatMap((p) => p.committeeMeetings);
  const tied: number[] = [];
  for (let b = LIST_LIMIT; b < raw.length; b += LIST_LIMIT) if (raw[b - 1]?.updateDate && raw[b - 1]!.updateDate === raw[b]?.updateDate) tied.push(b);
  for (const b of tied) {
    const off = Math.max(0, b - LIST_LIMIT / 2);
    const r = await g.get(`meetings list ${chamber} @${off} (tie at ${b})`, `/committee-meeting/${CONGRESS}/${chamber}?limit=${LIST_LIMIT}&offset=${off}`, MEETING_TIMEOUT_MS);
    if (!r.json) { error = `recovery @${off}: ${r.error}`; continue; }
    pages.push({ offset: off, recovery: true, pagination: (r.json.pagination as SavedPage["pagination"]) ?? null, committeeMeetings: (r.json.committeeMeetings as SavedPage["committeeMeetings"] | undefined) ?? [] });
  }
  writeFileSync(file, redactSecrets(JSON.stringify({ chamber, congress: CONGRESS, fetchedAt: new Date().toISOString(), pagingEnded, tiedBoundaries: tied, error, pages }, null, 1)));
  return { pages: pages.filter((p) => !p.recovery).length, recoveryPages: pages.filter((p) => p.recovery).length, tied, error };
}
// Everything downstream reads the saved file, never the network. Complete means
// paging ended AND the unique ids equal the upstream's own count.
export function loadList(file: string) {
  const saved = JSON.parse(readFileSync(file, "utf8")) as { pagingEnded: boolean; tiedBoundaries?: number[]; pages: SavedPage[] };
  const mainRaw = saved.pages.filter((p) => !p.recovery).flatMap((p) => p.committeeMeetings);
  const tieDates = new Set((saved.tiedBoundaries ?? []).map((b) => String(mainRaw[b]?.updateDate)));
  const byId = new Map<string, ListItem>();
  const firstPos = new Map<string, number>();
  const repeats: string[] = [];
  const recovered: string[] = [];
  let pos = 0, mainUnique = 0;
  for (const p of saved.pages) for (const x of p.committeeMeetings) {
    if (!p.recovery) pos++;
    if (x.eventId == null || !x.updateDate) continue;
    const id = String(x.eventId);
    const prev = byId.get(id);
    if (prev) {
      if (!p.recovery) repeats.push(`${id}@${firstPos.get(id)},${pos} (1-based) ${x.updateDate}`);
      if (x.updateDate > prev.updateDate) prev.updateDate = x.updateDate;
      continue;
    }
    if (p.recovery) recovered.push(`${id} ${x.updateDate}`);
    else { mainUnique++; firstPos.set(id, pos); }
    byId.set(id, { eventId: id, updateDate: String(x.updateDate) });
  }
  const main = saved.pages.filter((p) => !p.recovery);
  const count = main.length && main[0]!.pagination?.count != null ? Number(main[0]!.pagination!.count) : null;
  const unique = byId.size;
  return { items: [...byId.values()], repeats, recovered, tieDates, count, unique, mainUnique, rawRows: pos, complete: !!saved.pagingEnded && count != null && unique === count };
}
export type EventClass = "current" | "older" | "newer" | "missing" | "pending";
export type MeetingsMode = "watermark" | "table";
const hasColumn = async (read: Read, table: string, col: string) => Number((await read(`SELECT COUNT(*) AS n FROM pragma_table_info(?) WHERE name = ?`, [table, col])).rows[0]?.n) === 1;
const hasTable = async (read: Read, table: string) => Number((await read(`SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name = ?`, [table])).rows[0]?.n) === 1;
export async function classifyEvents(read: Read, chamber: string, list: ListItem[], tieDates: Set<string> = new Set(), mode: MeetingsMode = "watermark") {
  // HO 754: the table mode reads no watermark; every listed event is compared.
  const watermark = mode === "table" ? null : String((await read(`SELECT update_date FROM meeting_sync_state WHERE chamber = ?`, [chamber])).rows[0]?.update_date ?? "1970-01-01T00:00:00Z");
  const absentCol = await hasColumn(read, "committee_meetings", "absent_upstream_at");
  // Every stored row, whatever its chamber or congress: a row filed under the
  // other chamber is not missing, it is counted apart.
  const stored = new Map((await read(`SELECT event_id, congress, chamber, update_date${absentCol ? ", absent_upstream_at" : ", NULL AS absent_upstream_at"} FROM committee_meetings`)).rows.map((r) => [String(r.event_id), { congress: Number(r.congress), chamber: String(r.chamber), update_date: String(r.update_date), absent: r.absent_upstream_at == null ? null : String(r.absent_upstream_at) }]));
  // The reverse direction, for completeness of the list: rows the list does not report.
  const listed = new Set(list.map((e) => e.eventId));
  // A row at a tied boundary's timestamp may be a pagination skip; any other is an
  // event the upstream list no longer reports (nothing deletes committee_meetings rows).
  const notListed = [...stored].filter(([id, s]) => s.congress === CONGRESS && s.chamber === chamber && !listed.has(id)).map(([id, s]) => ({ eventId: id, stored: s.update_date, atTie: tieDates.has(s.update_date), absent: s.absent }));
  let otherChamber = 0;
  const events = list.map((e) => {
    const s = stored.get(e.eventId);
    if (s && s.chamber !== chamber) otherChamber++;
    let cls: EventClass;
    if (watermark != null && e.updateDate > watermark) cls = "pending";
    else cls = s == null ? "missing" : s.update_date === e.updateDate ? "current" : s.update_date < e.updateDate ? "older" : "newer";
    return { ...e, stored: s?.update_date ?? null, cls, absent: s?.absent ?? null };
  });
  // HO 754: the events the walk has set aside, and any with a failure on record.
  const walkState = mode === "table" && (await hasTable(read, "committee_meeting_walk_state"))
    ? (await read(`SELECT event_id, failures, gave_up_at_update, last_error FROM committee_meeting_walk_state WHERE failures > 0 ORDER BY event_id`)).rows.filter((r) => listed.has(String(r.event_id)) || stored.get(String(r.event_id))?.chamber === chamber).map((r) => ({ eventId: String(r.event_id), failures: Number(r.failures), gaveUpAt: S(r.gave_up_at_update), error: S(r.last_error) }))
    : [];
  return { watermark: watermark ?? "none (table, HO 754)", events, otherChamber, notListed, absentCol, walkState };
}
export async function meetingDetail(g: Getter, chamber: string, eventId: string): Promise<{ verdict: "lost" | "null-detail" | "error"; updateDate: string | null; error: string | null }> {
  const r = await g.get(`meeting ${chamber}/${eventId}`, `/committee-meeting/${CONGRESS}/${chamber}/${eventId}`, MEETING_TIMEOUT_MS); // lib/meetings-sync.ts fetchMeetingDetail's URL
  if (!r.json) return { verdict: "error", updateDate: null, error: r.error };
  const m = r.json.committeeMeeting as { updateDate?: string } | undefined;
  return m ? { verdict: "lost", updateDate: m.updateDate ?? null, error: null } : { verdict: "null-detail", updateDate: null, error: null }; // fetchMeetingDetail's `?? null`
}

// ── 6. the census ──────────────────────────────────────────────────────────
async function census(read: Read, cursor: string, ticks: Tick[], nowIso: string, key: Key = "cursor") {
  const groupsOf = async (extra: string, args: InValue[]) => {
    const r = (await read(
      `SELECT COUNT(*) AS groups, SUM(n) AS bills, MAX(n) AS largest FROM (
         SELECT update_date, COUNT(*) AS n FROM bills
          WHERE congress = ? AND json_extract(raw_json, '$.committees.count') > 0 ${extra}
          GROUP BY update_date HAVING COUNT(*) > 1)`,
      [CONGRESS, ...args],
    )).rows[0]!;
    return { groups: Number(r.groups ?? 0), bills: Number(r.bills ?? 0), largest: Number(r.largest ?? 0) };
  };
  const since = new Date(Date.parse(nowIso) - 30 * 86400_000).toISOString();
  const recent = ticks.filter((t) => t.started_at >= since);
  const ok = recent.filter((t) => t.status === "success");
  const tally = (ts: Tick[]) => ts.reduce<Record<string, number>>((m, t) => ((m[t.status] = (m[t.status] ?? 0) + 1), m), {});
  return {
    sameDateGroups: { walked: await groupsOf("", []), atOrBelow: await groupsOf("AND update_date <= ?", [cursor]), above: await groupsOf("AND update_date > ?", [cursor]) },
    // Zero GETs: walked bills with rows whose stored committees fall short of the
    // bill's own committees.count, which is where page 1's 20-committee cut shows.
    // HO 753: under the changed_at key there is no cursor to bound it; the whole walked set.
    shortOfCount: (await read(
      `SELECT b.id, b.update_date, json_extract(b.raw_json, '$.committees.count') AS cc, COUNT(DISTINCT cb.committee_system_code) AS n${key === "changed_at" ? `, CASE WHEN ${WALK_CURRENT} THEN 0 ELSE 1 END AS owed` : ", 0 AS owed"}
         FROM bills b JOIN committee_bills cb ON cb.bill_id = b.id
        WHERE b.congress = ? ${key === "cursor" ? "AND b.update_date <= ?" : ""} AND json_extract(b.raw_json, '$.committees.count') > 0
        GROUP BY b.id HAVING n < cc ORDER BY b.id`,
      key === "cursor" ? [CONGRESS, cursor] : [CONGRESS],
    )).rows.map((r) => ({ id: String(r.id), cc: Number(r.cc), n: Number(r.n), owed: Number(r.owed) === 1 })),
    // HO 753, changed_at key only: walked and current (not owed), yet no rows. The endpoint listed no
    // committee with a systemCode when it was walked; a fault only if its count says otherwise.
    stampedNoRows: key === "changed_at" ? (await read(
      `SELECT b.id, b.update_date, b.bill_type, b.bill_number FROM bills b
        WHERE b.congress = ? AND json_extract(b.raw_json, '$.committees.count') > 0
          AND ${WALK_CURRENT}
          AND NOT EXISTS (SELECT 1 FROM committee_bills cb WHERE cb.bill_id = b.id)
        ORDER BY b.id`,
      [CONGRESS],
    )).rows.map(billKeyOf) : null,
    last30: {
      since,
      byStatus: tally(recent),
      success: ok.length,
      noStats: ok.filter((t) => !t.bills && !t.walk).length,
      walk: (() => { const w = ok.filter((t) => t.walk); const last = w[w.length - 1]?.walk; return { ticks: w.length, deadlineHit: w.filter((t) => t.walk!.deadlineHit).length, capHit: w.filter((t) => t.walk!.capHit).length, rateLimited: w.filter((t) => t.walk!.rateLimited).length, fetchErrors: w.filter((t) => t.walk!.fetchErrors > 0).length, latestRemaining: last?.remaining ?? null, latestGaveUp: last?.gaveUp ?? null }; })(),
      deadlineHit: ok.filter((t) => t.bills?.deadlineHit).length,
      atLimit: ok.filter((t) => (t.bills?.billsProcessed ?? 0) >= PER_TICK_LIMIT).length,
      fetchErrors: ok.filter((t) => (t.bills?.fetchErrors ?? 0) > 0).length,
    },
    allTime: tally(ticks),
    unread: ticks.filter((t) => t.status !== "success").map((t) => `#${t.id} ${t.started_at} ${t.status}`),
    // `0 */12` since the first 00:00 row: a 12-hour window with no row at all is a run nothing recorded.
    missingSlots: (() => {
      const first = ticks.find((t) => t.started_at.slice(11, 13) === "00");
      const out: string[] = [];
      if (!first) return { from: null as number | null, slots: out };
      const H = 12 * 3600_000;
      for (let t0 = Date.parse(first.started_at.slice(0, 11) + "00:00:00Z"); t0 + H <= Date.parse(nowIso); t0 += H) {
        const a = new Date(t0).toISOString(), z = new Date(t0 + H).toISOString();
        if (!ticks.some((t) => t.started_at >= a && t.started_at < z)) out.push(a.replace(".000Z", "Z"));
      }
      return { from: first.id, slots: out };
    })(),
  };
}

// ── the rows a reading follows (read before and after) ─────────────────────
async function stamp(read: Read, key: Key = "cursor") {
  const cursor = await readCursor(read); // frozen since HO 753: the walk no longer writes it
  const watermarks = (await read(`SELECT chamber, update_date FROM meeting_sync_state ORDER BY chamber`)).rows.map((r) => `${r.chamber}=${r.update_date}`);
  const newest = (await read(`SELECT route, id, started_at, status FROM cron_runs WHERE id IN (SELECT MAX(id) FROM cron_runs WHERE route IN ('/api/cron/committees', '/api/cron/committee-meetings', '/api/sync') GROUP BY route) ORDER BY route`)).rows.map((r) => `${r.route}#${r.id} ${r.started_at} ${r.status}`);
  // HO 754: the meetings walk writes committee_meetings and its absent stamp; follow both.
  const mt = (await read(`SELECT COUNT(*) AS n, MAX(update_date) AS u${(await hasColumn(read, "committee_meetings", "absent_upstream_at")) ? ", SUM(absent_upstream_at IS NOT NULL) AS a" : ", NULL AS a"} FROM committee_meetings`)).rows[0]!;
  // Review: COUNT and MAX miss a refresh below the newest row (npm run sync:meetings writes no
  // cron_runs row), so the rows themselves are hashed, and the walk state followed.
  const absentSel = (await hasColumn(read, "committee_meetings", "absent_upstream_at")) ? "absent_upstream_at" : "NULL";
  const rowsHash = createHash("sha256").update((await read(`SELECT event_id, update_date, ${absentSel} AS a FROM committee_meetings ORDER BY event_id`)).rows.map((r) => `${r.event_id}|${r.update_date}|${r.a ?? ""}`).join("\n")).digest("hex").slice(0, 12);
  const ws = (await hasTable(read, "committee_meeting_walk_state")) ? (await read(`SELECT COUNT(*) AS n, MAX(last_attempt_at) AS l, COALESCE(SUM(failures), 0) AS f FROM committee_meeting_walk_state`)).rows[0]! : null;
  // HO 753: the repair writes no cron_runs row, so follow what it and the walk write.
  const cb = (await read(`SELECT COUNT(*) AS n, MAX(updated_at) AS u FROM committee_bills`)).rows[0]!;
  const walk = key === "changed_at" ? (await read(`SELECT MAX(committees_walked_at) AS w, COALESCE(SUM(committee_walk_failures), 0) AS f FROM bills WHERE congress = ?`, [CONGRESS])).rows[0]! : null;
  return JSON.stringify({ cursor, watermarks, newest, committeeBills: [cb.n, cb.u], meetings: [mt.n, mt.u, mt.a, rowsHash], ...(ws ? { meetingWalkState: [ws.n, ws.l, ws.f] } : {}), ...(walk ? { lastWalk: walk.w, failures: walk.f } : {}) });
}

// ── CSV ────────────────────────────────────────────────────────────────────
const csv = (rows: (string | number | null)[][]) => redactSecrets(rows.map((r) => r.map((v) => (v == null ? "" : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v))).join(",")).join("\n") + "\n");

// ── the prod reading ───────────────────────────────────────────────────────
async function prod() {
  const argv = (flag: string) => { const i = process.argv.indexOf(flag); return i === -1 ? undefined : process.argv[i + 1]; };
  const KEY = (argv("--key") ?? "cursor") as Key;
  if (KEY !== "cursor" && KEY !== "changed_at") throw new Error(`--key must be cursor|changed_at, got ${KEY}`);
  const ONLY_BILLS = argv("--only") === "bills";
  const ONLY_MEETINGS = argv("--only") === "meetings"; // HO 754
  const MMODE = (argv("--meetings") ?? "watermark") as MeetingsMode;
  if (MMODE !== "watermark" && MMODE !== "table") throw new Error(`--meetings must be watermark|table, got ${MMODE}`);
  const OUT = argv("--out");
  const norm = (p: string) => { const r = path.resolve(p); return process.platform === "win32" ? r.toLowerCase() : r; };
  if (!OUT || norm(OUT) === norm(ART)) throw new Error("the reading needs --out <dir> other than docs/handoffs/752-artifacts, so HO 752's artifacts are not overwritten");
  mkdirSync(OUT, { recursive: true });
  const url = argv("--db") ?? process.env.TURSO_DATABASE_URL ?? "";
  const scheme = url.split(":")[0];
  if (scheme !== "libsql" && scheme !== "file") throw new Error(`the reading takes a libsql:// or file: URL (got ${scheme}:)`);
  const db = createClient(scheme === "file" ? { url } : { url, authToken: process.env.TURSO_AUTH_TOKEN });
  const read = readerOf(db);
  const log = path.join(OUT, "requests.log");
  appendFileSync(log, `\n=== prod reading ${new Date().toISOString()} ===\n`);
  const g = makeGetter(log);
  const out: string[] = [];
  const say = (s: string) => { const r = redactSecrets(s); console.log(r); out.push(r); };
  const logFailed = (process.argv.find((a) => a.startsWith("--log-failed="))?.slice("--log-failed=".length) ?? "").split(",").filter(Boolean).map((x) => { const [bill, tick] = x.split("@"); return { bill: bill!, tick: Number(tick) }; });
  const before = await stamp(read, KEY);
  say(`=== HO 752 prod reading · ${new Date().toISOString()} · script sha256 ${SCRIPT_SHA} · ${scheme}: · key ${KEY}${ONLY_BILLS ? " · bills only" : ""}${ONLY_MEETINGS ? " · meetings only" : ""} · meetings ${MMODE} ===\nbefore: ${before}`);
  if (ONLY_MEETINGS) {
    await meetingsSection(g, read, say, OUT, MMODE);
    const after = await stamp(read, KEY);
    say(`\nafter: ${after}\n${before === after ? "the rows it follows did not move" : "MOVED between before and after: re-read and report both"}`);
    say(`GETs used ${g.requests()} of ${CAP} · smallest start-to-start gap ${g.minGapMs()}ms${g.stopped() ? ` · STOPPED: ${g.stopped()}` : ""}`);
    writeFileSync(path.join(OUT, "reading.txt"), redactSecrets(out.join("\n") + "\n"));
    db.close();
    return;
  }

  // 1-2. bills
  const bs = await billsSets(read, KEY);
  const cands = bs.candidates.length > CANDIDATE_SAMPLE ? sample(bs.candidates, CANDIDATE_SAMPLE, SEED) : bs.candidates;
  const resolved: Resolved[] = [];
  for (const b of cands) resolved.push(await resolveBill(g, b));
  const n = (v: Resolved["verdict"]) => resolved.filter((r) => r.verdict === v).length;
  // 3. attribution
  const ticks = await readTicks(read);
  writeFileSync(path.join(OUT, "ticks.csv"), csv([["id", "started_at", "status", "cursorStart", "cursorEnd", "billsProcessed", "deadlineHit", "fetchErrors", "error_message"], ...ticks.map((t) => [t.id, t.started_at, t.status, t.bills?.cursorStart ?? null, t.bills?.cursorEnd ?? null, t.bills?.billsProcessed ?? null, t.bills == null ? null : String(t.bills.deadlineHit), t.bills?.fetchErrors ?? null, t.error ?? null])]));
  const attributed = new Map(resolved.filter((r) => r.verdict === "lost").map((r) => [r.id, attribute(r.update_date, ticks)]));
  const byPath: Record<Path, number> = { truncation: 0, failure: 0, race: 0, unattributed: 0 };
  for (const a of attributed.values()) byPath[a.path]++;
  const setHead = KEY === "changed_at"
    ? `key changed_at (no cursor bound; the frozen cursor ${bs.cursor} shown for reference) · walked set ${bs.walked} · owed ${bs.candidates.length} (given up ${bs.gaveUp})`
    : `cursor ${bs.cursor} · walked set at or below ${bs.walked} · pending above ${bs.pending}`;
  say(`\nbills: ${setHead} · candidates ${bs.candidates.length}${cands.length < bs.candidates.length ? ` (sampled ${cands.length}, seed ${SEED})` : " (all resolved, no sample)"} · lost ${n("lost")} · empty ${n("empty")} · error ${n("error")}${cut(resolved.map((r) => r.error)) ? ` (cap/stop cut ${cut(resolved.map((r) => r.error))})` : ""} · candidates listing committees beyond page 1 ${resolved.filter((r) => r.beyond.length).length}`);
  say(`lost by path: ${JSON.stringify(byPath)} (a reading of the payloads, not a proof of mechanism)`);
  if (KEY === "changed_at") say("  key changed_at: the path lines read the cursor ticks' payloads and do not describe this key's set");
  const subN = (s: RaceSub) => [...attributed.values()].filter((a) => a.sub === s).length;
  say(`  race: strictly inside a clean tick (the handoff's race) ${subN("clean-inside")} · strictly inside an early-stopped tick with no fetch errors (not in the handoff's four; named) ${subN("early-inside")} · at a clean tick's cursorEnd ${subN("clean-at-end")}`);
  const pre = [...attributed.values()].filter((a) => a.path === "unattributed" && a.why.startsWith("U predates")).length;
  say(`  unattributed: predates the history ${pre} · in a hole ${byPath.unattributed - pre}`);
  const fb = failureBound(attributed.values(), ticks);
  if (fb.rows.length) say(`  failure bound: ${fb.rows.map((x) => `#${x.id} ${x.nb} bills vs fetchErrors ${x.fe}`).join(" · ")} → at most ${fb.atMost} of ${fb.of} can be that tick's failed fetch`);
  // Whether each lost bill's endpoint listed a committee when its holding tick ran
  // (its first committee activity predates the tick's start) or may have been
  // empty then (walked while empty, then never re-walked: the same payload shape).
  const listedThen = (r: Resolved) => { const a = attributed.get(r.id)!; const t = ticks.find((x) => x.id === a.tick); return t && r.firstActivity ? r.firstActivity < t.started_at : null; };
  for (const p of ["truncation", "failure", "race"] as Path[]) {
    const rs = resolved.filter((r) => r.verdict === "lost" && attributed.get(r.id)!.path === p);
    say(`  ${p}: first committee activity before the holding tick started ${rs.filter((r) => listedThen(r) === true).length} (an empty endpoint then would need publication lag) · on or after it ${rs.filter((r) => listedThen(r) === false).length} (consistent with walked while empty) · no activity date ${rs.filter((r) => listedThen(r) === null).length}`);
  }
  // Every failed fetch, not only those on candidates. The runtime-log reads named
  // on the command line (--log-failed bill@tick,...) take their ticks' failures off the candidates.
  const namedNonCand = new Map<number, number>();
  for (const x of logFailed) if (!bs.candidates.some((c) => c.id === x.bill)) namedNonCand.set(x.tick, (namedNonCand.get(x.tick) ?? 0) + 1);
  const ft = fetchTally(ticks, attributed.values(), namedNonCand);
  const namedWithRows = logFailed.filter((x) => !bs.candidates.some((c) => c.id === x.bill)).length;
  say(`  failed fetches over all success ticks: ${ft.total} in ${ft.ticks} ticks · candidates (any path) can account for at most ${ft.blind} (log-blind), ${ft.informed} once the log reads are counted · so at least ${ft.total - ft.blind} (log-informed ${ft.total - ft.informed}) fell outside the candidates their own tick holds, IF no failed bill's update_date has since moved into another tick's range at or below the cursor (U history isn't kept) · the rest fell on bills with rows already, walked again since, or moved above the cursor · the floor with no condition is the log-named bills that are not candidates: ${namedWithRows} · fetch-error ticks holding no candidate: ${ft.noCandidate.join(", ") || "none"}`);
  for (const r of resolved.filter((x) => x.verdict === "lost")) { const a = attributed.get(r.id)!; say(`  ${r.id} U=${r.update_date} [${r.codes.join(" ")}${r.beyond.length ? ` + beyond page 1: ${r.beyond.join(" ")}` : ""}] → ${a.path}${a.sub ? `/${a.sub}` : ""}${a.tick ? ` #${a.tick}` : ""}: ${a.why}`); }
  for (const r of resolved.filter((x) => x.verdict === "error")) say(`  error ${r.id}: ${r.error}`);
  writeFileSync(path.join(OUT, "bills-candidates.csv"), csv([["bill_id", "update_date", "verdict", "committees_page1", "committees_beyond_page1", "first_activity", "path", "race_sub", "tick", "tick_started_at", "listed_then", "why", "error"], ...resolved.map((r) => { const a = attributed.get(r.id); const t = a ? ticks.find((x) => x.id === a.tick) : undefined; const lt = a ? listedThen(r) : null; return [r.id, r.update_date, r.verdict, r.codes.join(" "), r.beyond.join(" "), r.firstActivity, a?.path ?? null, a?.sub ?? null, a?.tick ?? null, t?.started_at ?? null, lt == null ? null : String(lt), a?.why ?? null, r.error]; })]));

  // 3b. The bills the runtime logs name as failed fetches (read by the operator
  // inside the logs window and passed as --log-failed=bill@tick,...): each read
  // against its rows and its endpoint, candidate or not.
  if (logFailed.length) say(`\nlog-named failed fetches (${logFailed.length}, from the runtime logs of ${[...new Set(logFailed.map((x) => `#${x.tick}`))].join(", ")}):`);
  const lfRows: (string | number | null)[][] = [];
  for (const x of logFailed) {
    const row = (await read(`SELECT id, update_date, bill_type, bill_number FROM bills WHERE id = ?`, [x.bill])).rows[0];
    if (!row) { say(`  ${x.bill}: no bills row`); continue; }
    const b = billKeyOf(row);
    const t = ticks.find((y) => y.id === x.tick);
    const inRange = !!t?.bills && t.bills.cursorStart < b.update_date && b.update_date <= t.bills.cursorEnd;
    const info = (await read(`SELECT COUNT(*) AS n, MAX(updated_at) AS last FROM committee_bills WHERE bill_id = ?`, [x.bill])).rows[0]!;
    const st = (await storedRowsFor(read, [x.bill])).get(x.bill)!;
    const fc = await fetchBillCommittees(g, `log-named ${x.bill}`, b);
    const miss = fc.error && !fc.page1.length ? [] : staleOf(b, expectedActivities(fc.page1), st);
    const cand = bs.candidates.some((c) => c.id === x.bill);
    const where = inRange ? `inside #${x.tick}'s range` : `outside #${x.tick}'s range (moved since)`;
    const ep = fc.error && !fc.page1.length ? `error ${fc.error}` : `activities missing ${miss.length}${miss.length ? ` [${miss.map((m) => `${m.code} "${m.name}" ${m.date} (${m.side})`).join("; ")}]` : ""}`;
    say(`  ${x.bill} (#${x.tick}): candidate ${cand} · U ${b.update_date} ${where}${b.update_date > bs.cursor ? " · above the cursor (pending)" : ""} · rows ${info.n}, last written ${info.last ?? "never"} · endpoint ${ep}${fc.beyond.length ? ` · committees beyond page 1 ${codesOf(fc.beyond).join(" ")}` : ""}`);
    for (const m of miss.length ? miss : [null]) lfRows.push([x.bill, x.tick, String(cand), b.update_date, String(inRange), Number(info.n), S(info.last), m?.code ?? null, m?.name ?? null, m?.date ?? null, m?.side ?? null]);
  }
  if (logFailed.length) writeFileSync(path.join(OUT, "log-failed.csv"), csv([["bill_id", "tick", "candidate", "update_date", "u_in_tick_range", "rows", "rows_last_written", "missing_code", "missing_activity", "missing_date", "side"], ...lfRows]));

  // 4. stale (skipped with --only bills)
  if (!ONLY_BILLS) {
  const { sample: staleSample, population: withRowsN } = await staleSampleOf(read, bs.cursor, KEY);
  const stored = await storedRowsFor(read, staleSample.map((b) => b.id));
  type StaleRow = { b: BillKey; fetched: boolean; error: string | null; expected: number; stored: number; missing: ReturnType<typeof staleOf>; beyond: Activity[] };
  const stale: StaleRow[] = [];
  for (const b of staleSample) {
    const f = await fetchBillCommittees(g, `stale ${b.id}`, b);
    const fetched = !f.error || f.page1.length > 0;
    const exp = expectedActivities(f.page1);
    // Page 1 is the sync's view and splits at-or-before/after; beyond page 1 the sync never reads, kept apart.
    stale.push({ b, fetched, error: f.error, expected: new Set(exp.map((e) => `${e.code}|${e.name ?? ""}|${e.date ?? ""}`)).size, stored: stored.get(b.id)!.size, missing: fetched ? staleOf(b, exp, stored.get(b.id)!) : [], beyond: expectedActivities(f.beyond) });
  }
  const acts = stale.flatMap((s) => s.missing);
  writeFileSync(path.join(OUT, "stale-sample.csv"), csv([["bill_id", "update_date", "fetched", "expected_page1_distinct", "stored", "missing_code", "missing_activity", "missing_date", "side", "beyond_page1_activities", "error"], ...stale.flatMap((s) => (s.missing.length ? s.missing.map((m) => [s.b.id, s.b.update_date, String(s.fetched), s.expected, s.stored, m.code, m.name, m.date, m.side, s.beyond.length, s.error]) : [[s.b.id, s.b.update_date, String(s.fetched), s.expected, s.stored, null, null, null, null, s.beyond.length, s.error]]))]));
  const side = (x: Side) => acts.filter((a) => a.side === x).length;
  const staleBills = stale.filter((s) => s.missing.length);
  say(`\nstale sample (seed ${SEED}): bills ${stale.length} · fetched ${stale.filter((s) => s.fetched).length}${cut(stale.map((s) => s.error)) ? ` (cap/stop cut ${cut(stale.map((s) => s.error))})` : ""} · bills stale ${staleBills.length} · activities missing ${acts.length}: at or before the stored update_date ${side("at-or-before")} · after it ${side("after")} · no date ${side("no-date")} · sampled bills with committees beyond page 1 ${stale.filter((s) => s.beyond.length).length} (activities ${stale.reduce((x, s) => x + s.beyond.length, 0)}, never read by the sync)`);
  for (const s of staleBills) say(`  ${s.b.id} U=${s.b.update_date}: ${s.missing.map((m) => `${m.code} "${m.name}" ${m.date} (${m.side})`).join("; ")}`);
  // Whose frontier: the bill's own upstream date (lib/sync.ts:72-73, updateDateIncludingText ?? updateDate)
  // against the stored one. Ahead means /api/sync hasn't taken the update; equal means the committee
  // activity didn't move the bill's date, so only the committees walk could have caught it.
  const syncWm = String((await read(`SELECT MAX(update_date) AS m FROM bills`)).rows[0]?.m ?? "");
  for (const sb of staleBills.filter((x) => x.missing.some((m) => m.side === "after"))) {
    const r = await g.get(`bill detail ${sb.b.id}`, `/bill/${CONGRESS}/${sb.b.type}/${sb.b.number}`, BILL_TIMEOUT_MS);
    const bill = (r.json?.bill ?? null) as { updateDate?: string; updateDateIncludingText?: string } | null;
    const up = bill ? String(bill.updateDateIncludingText ?? bill.updateDate ?? "").replace(/\.\d+Z$/, "Z") : null;
    const verdict = !up ? `not read (${r.error ?? "no bill"})` : up > sb.b.update_date ? `upstream ahead (${up}): /api/sync's frontier${up <= syncWm ? `, below /api/sync's watermark ${syncWm}, the older-tail drop's shape` : `, above its watermark ${syncWm}, not yet listed`}` : up === sb.b.update_date ? `upstream equal (${up}): the committee activity didn't move the bill's date, so it is the committees walk's, not /api/sync's` : `upstream behind the stored date (${up})`;
    say(`  ${sb.b.id}: stored ${sb.b.update_date} · ${verdict}`);
  }
  // What 200 can see: a failure on a bill with rows lands in the sample about 200/N of the time.
  if (withRowsN === 0) say("  the sample's reach: n/a (no walk-current bills with rows)");
  if (withRowsN > 0) say(`  the sample's reach: 200 of ${withRowsN} walked bills with rows expects about ${((ft.total * STALE_SAMPLE) / withRowsN).toFixed(2)} of up to ${ft.total} bills a failed fetch touched, so its at-or-before count does not bound the failure path (the log-named bills above read that side directly)`);

  }

  // 5. meetings, from the saved lists (skipped with --only bills)
  if (!ONLY_BILLS) await meetingsSection(g, read, say, OUT, MMODE);

  // 6. census
  const c = await census(read, bs.cursor, ticks, new Date().toISOString(), KEY);
  const gs = (x: { groups: number; bills: number; largest: number }) => `${x.groups} (bills in them ${x.bills}, largest ${x.largest})`;
  say(`\ncensus: same-update_date groups over the walked set ${gs(c.sameDateGroups.walked)}: at or below the cursor ${gs(c.sameDateGroups.atOrBelow)} · pending above ${gs(c.sameDateGroups.above)} (a group is one timestamp, so the parts sum: ${c.sameDateGroups.walked.groups === c.sameDateGroups.atOrBelow.groups + c.sameDateGroups.above.groups && c.sameDateGroups.walked.bills === c.sameDateGroups.atOrBelow.bills + c.sameDateGroups.above.bills ? "they do" : "MISMATCH"})`);
  const shortFault = c.shortOfCount.filter((x) => !x.owed), shortOwed = c.shortOfCount.filter((x) => x.owed);
  say(`  walked bills with rows whose stored committees fall short of committees.count (no GETs): ${shortFault.length}${shortFault.length ? ` [${shortFault.map((x) => `${x.id} ${x.n}/${x.cc}`).join(", ")}]` : ""} · ${KEY === "changed_at" ? "over the whole walked set, walk-current bills only" : `at or below the cursor (${bs.pending} walked-set bills above it not read)`}`);
  if (shortOwed.length) say(`  short but owed a walk (pending, not a fault): ${shortOwed.length} [${shortOwed.slice(0, 20).map((x) => `${x.id} ${x.n}/${x.cc}`).join(", ")}]`);
  say(`  last 30 days (since ${c.last30.since}): ticks ${JSON.stringify(c.last30.byStatus)} · success ${c.last30.success}, of which deadlineHit ${c.last30.deadlineHit}, billsProcessed at the ${PER_TICK_LIMIT} limit ${c.last30.atLimit}, fetchErrors > 0 ${c.last30.fetchErrors}, no bills stats ${c.last30.noStats}`);
  if (c.stampedNoRows) {
    // A walk stamps a bill with no rows only when its fetched pages listed no committee with a systemCode.
    // Resolved now, sampled like the candidates: a `lost` here is a bill the walk will not revisit until it changes.
    const snr = c.stampedNoRows.length > CANDIDATE_SAMPLE ? sample(c.stampedNoRows, CANDIDATE_SAMPLE, SEED) : c.stampedNoRows;
    const snrRes: Resolved[] = [];
    for (const b of snr) snrRes.push(await resolveBill(g, b));
    const v = (x: Resolved["verdict"]) => snrRes.filter((r) => r.verdict === x).length;
    say(`  walked and current, yet no rows: ${c.stampedNoRows.length}${snr.length < c.stampedNoRows.length ? ` (sampled ${snr.length}, seed ${SEED})` : ""} · resolved now: lost ${v("lost")} · empty ${v("empty")} · error ${v("error")}${cut(snrRes.map((r) => r.error)) ? ` (cap/stop cut ${cut(snrRes.map((r) => r.error))})` : ""}`);
    for (const r of snrRes.filter((x) => x.verdict === "lost")) say(`    ${r.id} U=${r.update_date} [${r.codes.join(" ")}]: walked and stamped with no rows, now listing committees; not revisited until it changes`);
  }
  say(`  per-bill walk ticks (HO 753) in the last 30 days: ${c.last30.walk.ticks}, of which deadlineHit ${c.last30.walk.deadlineHit}, capHit ${c.last30.walk.capHit}, rateLimited ${c.last30.walk.rateLimited}, fetchErrors > 0 ${c.last30.walk.fetchErrors} · the latest reads remaining ${c.last30.walk.latestRemaining ?? "n/a"}, set aside ${c.last30.walk.latestGaveUp ?? "n/a"}`);
  say(`  all time by status: ${JSON.stringify(c.allTime)} · the unread ticks (non-success rows): ${c.unread.join(", ") || "none"}`);
  say(`  12-hour slots with no committees row since #${c.missingSlots.from}, the first 00:00 run: ${c.missingSlots.slots.length}${c.missingSlots.slots.length ? ` [${c.missingSlots.slots.join(", ")}]` : ""}`);

  const after = await stamp(read, KEY);
  say(`\nafter: ${after}\n${before === after ? "the rows it follows did not move" : "MOVED between before and after: re-read and report both"}`);
  say(`GETs used ${g.requests()} of ${CAP} · smallest start-to-start gap ${g.minGapMs()}ms${g.stopped() ? ` · STOPPED: ${g.stopped()}` : ""}`);
  writeFileSync(path.join(OUT, "reading.txt"), redactSecrets(out.join("\n") + "\n"));
  db.close();
}

// ── 5. meetings, the reading (HO 754: a function, shared by the whole reading and --only meetings) ──
async function meetingsSection(g: Getter, read: Read, say: (s: string) => void, OUT: string, mode: MeetingsMode) {
  for (const chamber of ["house", "senate"]) {
    const file = path.join(OUT, `meetings-list-${chamber}.json`);
    const fetched = await fetchAndSaveList(g, chamber, file);
    const list = loadList(file);
    const { watermark, events, otherChamber, notListed, absentCol, walkState } = await classifyEvents(read, chamber, list.items, list.tieDates, mode);
    const cnt = (c: EventClass) => events.filter((e) => e.cls === c).length;
    const details = new Map<string, Awaited<ReturnType<typeof meetingDetail>>>();
    for (const e of events.filter((x) => x.cls === "missing")) details.set(e.eventId, await meetingDetail(g, chamber, e.eventId));
    const agreeSet = [...sample(events.filter((e) => e.cls === "current"), AGREE_SAMPLE, SEED), ...events.filter((e) => e.cls === "older" || e.cls === "newer")];
    let agree = 0, compared = 0;
    const agreeErrors: (string | null)[] = [];
    const disagree: string[] = [];
    for (const e of agreeSet) {
      const d = await meetingDetail(g, chamber, e.eventId);
      agreeErrors.push(d.error);
      if (d.verdict !== "lost" || !d.updateDate) continue;
      compared++;
      if (d.updateDate === e.updateDate) agree++;
      else disagree.push(`${e.eventId} (${e.cls}) list ${e.updateDate} · detail ${d.updateDate} · stored ${e.stored}`);
    }
    writeFileSync(path.join(OUT, `meetings-${chamber}.csv`), csv([["event_id", "list_update_date", "stored_update_date", "class", "detail"], ...events.map((e) => [e.eventId, e.updateDate, e.stored, e.cls, details.get(e.eventId)?.verdict ?? null])]));
    const dv = (v: string) => [...details.values()].filter((d) => d.verdict === v).length;
    say(`\nmeetings ${chamber}: upstream count ${list.count} · unique ${list.unique} (${list.mainUnique} from ${list.rawRows} main-page rows over ${fetched.pages} pages + ${list.recovered.length} from ${fetched.recoveryPages} recovery window(s)) · ${list.complete ? "complete" : `INCOMPLETE (shortfall ${list.count == null ? "?" : list.count - list.unique}${fetched.error ? `; ${fetched.error}` : ""})`} · boundaries inside a tie ${fetched.tied.length ? fetched.tied.join(", ") : "none"}, re-read by ${fetched.recoveryPages} centred window(s), recovering ${list.recovered.length}${list.recovered.length ? ` [${list.recovered.join("; ")}]` : ""} · repeated ids ${list.repeats.length}${list.repeats.length ? ` [${list.repeats.join("; ")}]` : ""} · filed under the other chamber ${otherChamber} · stored ${CONGRESS}th rows the list does not report ${notListed.length} (at a tied boundary's timestamp ${notListed.filter((e) => e.atTie).length}) · ${mode === "table" ? `against the table, no watermark (HO 754): every listed event ${events.length}` : `watermark ${watermark} · at or below ${events.length - cnt("pending")}`}: current ${cnt("current")} · older ${cnt("older")} · newer ${cnt("newer")} · missing ${cnt("missing")} (lost ${dv("lost")} · null-detail ${dv("null-detail")} · error ${dv("error")})${mode === "table" ? "" : ` · pending above ${cnt("pending")}`}`);
    if (mode === "table") {
      const marked = notListed.filter((e) => e.absent != null);
      // Review: a row the list carries but a stamp still hides is a fault the marked count
      // cannot show; and an event changed upstream after the last walk's run started is owed,
      // not a fault, so older/missing are split at that run's started_at.
      const listedMarked = events.filter((e) => e.absent != null);
      const lastWalk = String((await read(`SELECT MAX(started_at) AS s FROM cron_runs WHERE route = '/api/cron/committee-meetings'`)).rows[0]?.s ?? "");
      const since = (c: EventClass) => events.filter((e) => e.cls === c && lastWalk !== "" && e.updateDate > lastWalk);
      say(`  HO 754, listed yet marked absent (hidden while Congress.gov lists it): ${listedMarked.length}${listedMarked.length ? ` [${listedMarked.map((e) => `${e.eventId} at ${e.absent}`).join(", ")}]` : ""}`);
      say(`  HO 754, split at the last committee-meetings run (${lastWalk || "none"}): older ${cnt("older")} (changed upstream after it ${since("older").length}) · missing ${cnt("missing")} (added after it ${since("missing").length}); only those before it are the walk's to have done`);
      say(`  HO 754, the table's reading: stored ${CONGRESS}th rows the list does not report ${notListed.length} · marked absent ${marked.length}${absentCol ? "" : " (no absent_upstream_at column)"} · unmarked ${notListed.length - marked.length}${notListed.length - marked.length ? ` [${notListed.filter((e) => e.absent == null).map((e) => e.eventId).join(", ")}]` : ""}`);
      for (const e of marked) say(`    marked ${e.eventId} at ${e.absent} (stored ${e.stored})`);
      const aside = walkState.filter((w) => w.failures >= 5);
      say(`  walk state: events with a failure on record ${walkState.length} · set aside (5 or more) ${aside.length}${aside.length ? ` [${aside.map((w) => `${w.eventId} at ${w.gaveUpAt}`).join(", ")}]` : ""}`);
      for (const w of walkState) say(`    ${w.eventId}: failures ${w.failures}${w.gaveUpAt ? ` · set aside at ${w.gaveUpAt}` : ""} · last error ${w.error ?? "none"}`);
    }
    for (const e of events.filter((x) => x.cls === "missing")) say(`  missing ${e.eventId} list ${e.updateDate} → ${details.get(e.eventId)?.verdict}${details.get(e.eventId)?.error ? ` (${details.get(e.eventId)?.error})` : ""}`);
    for (const e of events.filter((x) => x.cls === "older" || x.cls === "newer")) say(`  ${e.cls} ${e.eventId} list ${e.updateDate} · stored ${e.stored}`);
    say(`  list-vs-detail updateDate: ${agree} of ${compared} agree (${Math.min(AGREE_SAMPLE, cnt("current"))} current sampled + ${cnt("older") + cnt("newer")} older/newer; details not read ${agreeSet.length - compared}${cut(agreeErrors) ? `, cap/stop cut ${cut(agreeErrors)}` : ""})`);
    for (const d of disagree) say(`  disagree ${d}`);
    if (notListed.some((e) => e.atTie)) say(`  stored, not listed, at a tied boundary's timestamp (a pagination skip the window did not recover, or dropped upstream): ${notListed.filter((e) => e.atTie).map((e) => `${e.eventId} (${e.stored})`).join(", ")}`);
    if (notListed.some((e) => !e.atTie)) say(`  stored, not listed, not the upstream count's (events the list no longer reports; outside the line's mechanism, nothing deletes committee_meetings rows): ${notListed.filter((e) => !e.atTie).map((e) => `${e.eventId} (${e.stored})`).join(", ")}`);
    if (notListed.length) {
      const nd: string[] = [];
      for (const e of notListed) { const d = await meetingDetail(g, chamber, e.eventId); nd.push(d.verdict === "error" ? (d.error ?? "error") : d.verdict); }
      const tallyNd = nd.reduce<Record<string, number>>((m, v) => ((m[v] = (m[v] ?? 0) + 1), m), {});
      say(`  their details: ${JSON.stringify(tallyNd)} (an HTTP 404 is an event Congress.gov deleted, HO 717's gone_upstream)`);
    }
  }

}

// ── the controls, on a file: copy ──────────────────────────────────────────
function copyUrl(name: string, dir: string) {
  const abs = path.resolve(dir, name);
  if (!abs.endsWith("-752-control.db")) throw new Error(`refused: a copy must be a *-752-control.db file (got ${abs})`);
  return { abs, url: `file:${abs}` };
}
async function perturb(url: string, stmts: InStatement[], what: string, quiet = false) {
  const scheme = url.split(":")[0];
  if (scheme !== "file") throw new Error(`refused: ${what} runs against file: only (got ${scheme}:)`);
  if (!quiet) console.log(`    [${what}] ran against scheme ${scheme}:`);
  const c = createClient({ url });
  try {
    return (await c.batch(stmts, "write")).map((r) => r.rowsAffected);
  } finally {
    c.close();
  }
}
async function controls() {
  // HO 753: the controls write to a required --out too, so HO 752's saved control artifacts stand.
  const i = process.argv.indexOf("--out");
  const OUT = i === -1 ? undefined : process.argv[i + 1];
  if (!OUT || path.resolve(OUT).toLowerCase() === path.resolve(ART).toLowerCase()) throw new Error("--controls needs --out <dir> other than docs/handoffs/752-artifacts");
  mkdirSync(OUT, { recursive: true });
  const prodUrl = process.env.TURSO_DATABASE_URL ?? "";
  if (!prodUrl.startsWith("libsql://")) throw new Error("the seed reads prod; expects the prod libsql:// URL");
  const prodDb = createClient({ url: prodUrl, authToken: process.env.TURSO_AUTH_TOKEN });
  const pr = readerOf(prodDb);
  const log = path.join(OUT, "requests.log");
  appendFileSync(log, `\n=== controls ${new Date().toISOString()} ===\n`);
  const g = makeGetter(log);
  let fails = 0;
  const check = (label: string, ok: boolean, detail: string) => { const line = redactSecrets(`  ${ok ? "PASS" : "FAIL"}  ${label}: ${detail}`); console.log(line); if (!ok) fails++; };

  // Seed ONLY the rows the probe reads, from prod by SELECT.
  const { abs, url } = copyUrl("probe-752-control.db", OUT);
  if (existsSync(abs)) rmSync(abs);
  const seed = {
    bills: (await pr(`SELECT id, congress, update_date, bill_type, bill_number, json_extract(raw_json, '$.committees.count') AS cc FROM bills WHERE congress = ?`, [CONGRESS])).rows,
    cb: (await pr(`SELECT bill_id, committee_system_code, activity_type, activity_date FROM committee_bills`)).rows,
    ds: (await pr(`SELECT key, value FROM dashboard_state WHERE key = 'committee_bills_sync_cursor'`)).rows,
    cm: (await pr(`SELECT event_id, congress, chamber, update_date FROM committee_meetings`)).rows,
    ms: (await pr(`SELECT chamber, update_date FROM meeting_sync_state`)).rows,
  };
  prodDb.close();
  await perturb(url, [
    `CREATE TABLE bills (id TEXT PRIMARY KEY, congress INTEGER, update_date TEXT, bill_type TEXT, bill_number INTEGER, raw_json TEXT)`,
    `CREATE TABLE committee_bills (bill_id TEXT, committee_system_code TEXT, activity_type TEXT, activity_date TEXT)`,
    `CREATE TABLE dashboard_state (key TEXT PRIMARY KEY, value TEXT)`,
    `CREATE TABLE committee_meetings (event_id TEXT PRIMARY KEY, congress INTEGER, chamber TEXT, update_date TEXT)`,
    `CREATE TABLE meeting_sync_state (chamber TEXT PRIMARY KEY, update_date TEXT)`,
    `CREATE TABLE cron_runs (id INTEGER PRIMARY KEY, route TEXT, started_at TEXT, status TEXT, payload TEXT)`,
  ].map((sql) => ({ sql, args: [] })), "seed: tables");
  type Row = ResultSet["rows"][number];
  const ins = async (rows: ResultSet["rows"], sql: string, args: (r: Row) => unknown[]) => {
    for (let i = 0; i < rows.length; i += 500) await perturb(url, rows.slice(i, i + 500).map((r) => ({ sql, args: args(r).map((v) => (v ?? null) as InValue) })), "seed: rows", true);
  };
  await ins(seed.bills, `INSERT INTO bills VALUES (?, ?, ?, ?, ?, ?)`, (r) => [r.id, r.congress, r.update_date, r.bill_type, r.bill_number, JSON.stringify({ committees: { count: r.cc == null ? null : Number(r.cc) } })]);
  await ins(seed.cb, `INSERT INTO committee_bills VALUES (?, ?, ?, ?)`, (r) => [r.bill_id, r.committee_system_code, r.activity_type, r.activity_date]);
  await ins(seed.ds, `INSERT INTO dashboard_state VALUES (?, ?)`, (r) => [r.key, r.value]);
  await ins(seed.cm, `INSERT INTO committee_meetings VALUES (?, ?, ?, ?)`, (r) => [r.event_id, r.congress, r.chamber, r.update_date]);
  await ins(seed.ms, `INSERT INTO meeting_sync_state VALUES (?, ?)`, (r) => [r.chamber, r.update_date]);
  const copy = createClient({ url });
  const cr = readerOf(copy);
  console.log(`=== HO 752 controls · ${new Date().toISOString()} · script sha256 ${SCRIPT_SHA} · ${url.split(":")[0]}: copy seeded: bills ${seed.bills.length} · committee_bills ${seed.cb.length} · committee_meetings ${seed.cm.length} · cursor ${String(seed.ds[0]?.value)} ===`);

  // 1. The candidates and their resolution together.
  console.log("\n── Control 1 · a lost bill, planted");
  const u1 = await billsSets(cr);
  const withRows = (await staleSampleOf(cr, u1.cursor)).sample;
  let chosen: Resolved | null = null;
  for (const b of withRows.slice(0, 5)) { const r = await resolveBill(g, b); if (r.verdict === "lost") { chosen = r; break; } }
  if (!chosen) throw new Error("control 1: none of five sampled bills lists a committee");
  console.log(`    chosen: ${chosen.id} (update_date ${chosen.update_date}; endpoint lists ${chosen.codes.join(", ")})`);
  const del1 = await perturb(url, [{ sql: `DELETE FROM committee_bills WHERE bill_id = ?`, args: [chosen.id] }], "control 1: delete its committee_bills rows");
  const p1 = await billsSets(cr);
  const added = p1.candidates.filter((c) => !u1.candidates.some((x) => x.id === c.id));
  const res1 = added.length === 1 ? await resolveBill(g, added[0]!) : null;
  check("candidates +1, and that bill classified lost",
    p1.candidates.length === u1.candidates.length + 1 && added.length === 1 && added[0]!.id === chosen.id && res1?.verdict === "lost",
    `rows deleted ${del1[0]} · candidates unperturbed ${u1.candidates.length} → perturbed ${p1.candidates.length} · added ${added.map((a) => a.id).join(",") || "none"} · resolved ${res1?.verdict ?? "n/a"} [${res1?.codes.join(" ") ?? ""}]`);

  // 2. The pending boundary.
  console.log("\n── Control 2 · the pending boundary");
  const second = p1.candidates.find((c) => c.id !== chosen!.id)!;
  const above = new Date(Date.parse(p1.cursor) + 1000).toISOString().replace(".000Z", "Z");
  await perturb(url, [{ sql: `UPDATE bills SET update_date = ? WHERE id = ?`, args: [above, second.id] }], "control 2: move a second candidate one second above the cursor");
  const p2 = await billsSets(cr);
  check("it leaves the candidates and counts as pending",
    p2.candidates.length === p1.candidates.length - 1 && !p2.candidates.some((c) => c.id === second.id) && p2.pending === p1.pending + 1 && p2.walked === p1.walked - 1,
    `${second.id} ${second.update_date} → ${above} (cursor ${p1.cursor}) · candidates ${p1.candidates.length} → ${p2.candidates.length} · pending ${p1.pending} → ${p2.pending} · walked ${p1.walked} → ${p2.walked}`);

  // 3. The stale class: one activity row of a bill from the probe's stale sample,
  // the draw taken before control 1's delete (the prod reading's sample while prod
  // is unchanged; a redraw after the delete shuffles a different 200).
  console.log("\n── Control 3 · a stale activity, planted");
  const staleSample = withRows;
  const rows3 = await storedRowsFor(cr, staleSample.map((b) => b.id));
  const sb = staleSample.find((b) => b.id !== chosen!.id && [...rows3.get(b.id)!].filter((k) => !k.endsWith("||")).length >= 2)!;
  const f3 = await fetchBillCommittees(g, `control 3 ${sb.id}`, sb);
  if (f3.error) throw new Error(`control 3: ${sb.id} endpoint ${f3.error}`);
  const exp3 = expectedActivities(f3.page1);
  const st0 = staleOf(sb, exp3, rows3.get(sb.id)!);
  const victim = exp3.find((e) => e.name != null && rows3.get(sb.id)!.has(`${e.code}|${e.name}|${e.date ?? ""}`))!;
  const del3 = await perturb(url, [{ sql: `DELETE FROM committee_bills WHERE bill_id = ? AND committee_system_code = ? AND activity_type = ? AND activity_date = ?`, args: [sb.id, victim.code, victim.name, victim.date] }], "control 3: delete one activity row");
  const st1 = staleOf(sb, exp3, (await storedRowsFor(cr, [sb.id])).get(sb.id)!);
  const named = st1.find((m) => m.code === victim.code && m.name === victim.name && m.date === victim.date);
  check("that bill reads stale, naming the activity (one fetch, read against the rows before and after)",
    del3[0]! >= 1 && st1.length === st0.length + del3[0]! && !!named && !st0.some((m) => m.code === victim.code && m.name === victim.name && m.date === victim.date),
    `${sb.id} (1-based position ${staleSample.indexOf(sb) + 1} of the stale sample drawn before control 1) · rows deleted ${del3[0]} · missing unperturbed ${st0.length} → perturbed ${st1.length} · names ${named ? `${named.code} "${named.name}" ${named.date} (${named.side})` : "NOTHING"}`);

  // 4. Meetings, from the saved list with no refetch.
  console.log("\n── Control 4 · meetings: a missing event and an older one, planted");
  const lf = path.join(OUT, "control-meetings-list-house.json");
  await fetchAndSaveList(g, "house", lf);
  const reqs = g.requests();
  const l4 = loadList(lf);
  const u4 = await classifyEvents(cr, "house", l4.items, l4.tieDates);
  const [gone, aged] = sample(u4.events.filter((e) => e.cls === "current"), 2, SEED + 4);
  const olderDate = new Date(Date.parse(aged!.updateDate) - 86400_000).toISOString().replace(".000Z", "Z");
  await perturb(url, [
    { sql: `DELETE FROM committee_meetings WHERE event_id = ?`, args: [gone!.eventId] },
    { sql: `UPDATE committee_meetings SET update_date = ? WHERE event_id = ?`, args: [olderDate, aged!.eventId] },
  ], "control 4: delete one event row below the watermark, set another a day older");
  const l4b = loadList(lf);
  const p4 = await classifyEvents(cr, "house", l4b.items, l4b.tieDates);
  const refetched = g.requests() - reqs;
  const det = await meetingDetail(g, "house", gone!.eventId);
  const k = (x: typeof u4, c: EventClass) => x.events.filter((e) => e.cls === c).length;
  check("missing +1 then lost on its detail, and older +1, from the saved list with no refetch",
    k(p4, "missing") === k(u4, "missing") + 1 && k(p4, "older") === k(u4, "older") + 1 && p4.events.find((e) => e.eventId === gone!.eventId)?.cls === "missing" && p4.events.find((e) => e.eventId === aged!.eventId)?.cls === "older" && refetched === 0 && det.verdict === "lost",
    `list ${l4.unique} of count ${l4.count} (${l4.complete ? "complete" : "INCOMPLETE"}) · watermark ${u4.watermark} · missing ${k(u4, "missing")} → ${k(p4, "missing")} (${gone!.eventId}, list ${gone!.updateDate}; detail → ${det.verdict}) · older ${k(u4, "older")} → ${k(p4, "older")} (${aged!.eventId}: ${aged!.updateDate} → stored ${olderDate}) · list GETs between the two reads ${refetched}`);

  // 5. Attribution: four ticks, read clean (unperturbed) and then each built to land a bill in one path.
  console.log("\n── Control 5 · attribution on four synthetic ticks");
  const T = (id: number, cs: string, ce: string, bp: number, dh: boolean, fe: number): Tick => ({ id, status: "success", started_at: cs, bills: { cursorStart: cs, cursorEnd: ce, billsProcessed: bp, deadlineHit: dh, fetchErrors: fe } });
  const clean: Tick[] = [
    T(1, "2026-01-01T00:00:00Z", "2026-01-02T00:00:00Z", 120, false, 0),
    T(2, "2026-01-02T00:00:00Z", "2026-01-03T00:00:00Z", 80, false, 0),
    T(3, "2026-01-03T00:00:00Z", "2026-01-04T00:00:00Z", 60, false, 0),
    T(4, "2026-01-04T00:00:00Z", "2026-01-05T00:00:00Z", 40, false, 0),
  ];
  const built: Tick[] = [
    T(1, "2026-01-01T00:00:00Z", "2026-01-02T00:00:00Z", 120, true, 0), // stopped early at its cursorEnd
    T(2, "2026-01-02T00:00:00Z", "2026-01-03T00:00:00Z", 80, false, 2), // fetch errors
    T(3, "2026-01-03T00:00:00Z", "2026-01-04T00:00:00Z", 60, false, 0), // clean
    { id: 4, status: "timeout", started_at: "2026-01-04T00:00:00Z", bills: null }, // a hole
  ];
  const cases: [string, Path][] = [["2026-01-02T00:00:00Z", "truncation"], ["2026-01-02T12:00:00Z", "failure"], ["2026-01-03T12:00:00Z", "race"], ["2026-01-04T12:00:00Z", "unattributed"]];
  for (const [u, want] of cases) {
    const a0 = attribute(u, clean), a1 = attribute(u, built);
    check(`a bill at ${u} lands in ${want}`, a1.path === want && (want === "race" || a0.path !== want), `unperturbed ${a0.path}${a0.sub ? `/${a0.sub}` : ""} (#${a0.tick}) → perturbed ${a1.path}${a1.sub ? `/${a1.sub}` : ""}${a1.tick ? ` (#${a1.tick})` : ""}: ${a1.why}`);
  }
  // race's parts (beyond the handoff's four, named): the race case is clean-inside; a U strictly
  // inside the early-stopped #1 moves clean-inside → early-inside and says so; a clean cursorEnd is clean-at-end.
  const rc = attribute("2026-01-03T12:00:00Z", built), ei0 = attribute("2026-01-01T12:00:00Z", clean), ei1 = attribute("2026-01-01T12:00:00Z", built), ce = attribute("2026-01-04T00:00:00Z", built);
  check("race splits: clean-inside, early-inside (its text names the early stop), clean-at-end",
    rc.sub === "clean-inside" && rc.why.includes("had no early stop") && ei0.sub === "clean-inside" && ei1.path === "race" && ei1.sub === "early-inside" && ei1.why.includes("stopped early (deadlineHit)") && !ei1.why.includes("no early stop") && ce.path === "race" && ce.sub === "clean-at-end",
    `2026-01-03T12 → ${rc.sub} · 2026-01-01T12 unperturbed ${ei0.sub} → perturbed ${ei1.sub} (${ei1.why}) · 2026-01-04T00 → ${ce.sub}`);
  // The unattributed split the reading reports: the hole names the unread tick, and a U before the first range predates.
  const hole = attribute("2026-01-04T12:00:00Z", built), preh = attribute("2025-12-31T00:00:00Z", built);
  check("unattributed splits: the hole names #4, an earlier U predates", hole.why.startsWith("U sits in a hole") && hole.why.includes("#4 timeout") && preh.path === "unattributed" && preh.why.startsWith("U predates"), `hole → ${hole.why} · 2025-12-31 → ${preh.why}`);
  // The prod reading's holes have success ticks on both sides; so does this one.
  const two: Tick[] = [T(1, "2026-01-01T00:00:00Z", "2026-01-02T00:00:00Z", 50, false, 0), { id: 2, status: "timeout", started_at: "2026-01-02T12:00:00Z", bills: null }, { id: 3, status: "error", started_at: "2026-01-03T00:00:00Z", bills: null }, T(4, "2026-01-03T00:00:00Z", "2026-01-04T00:00:00Z", 50, false, 0)];
  const h2 = attribute("2026-01-02T12:00:00Z", two);
  check("a two-sided hole names both neighbours and exactly the unread ticks between", h2.path === "unattributed" && h2.why.includes("after #1 ") && h2.why.includes("before #4 ") && h2.why.endsWith("between them #2 timeout, #3 error"), h2.why);
  // The failure bound and the fetch tally, on ticks built for them.
  const bt: Tick[] = [T(1, "2026-02-01T00:00:00Z", "2026-02-02T00:00:00Z", 50, true, 1), T(2, "2026-02-02T00:00:00Z", "2026-02-03T00:00:00Z", 50, true, 2), T(3, "2026-02-03T00:00:00Z", "2026-02-04T00:00:00Z", 50, true, 1)];
  const ba = [{ path: "failure" as Path, tick: 1 }, { path: "failure" as Path, tick: 1 }, { path: "truncation" as Path, tick: 2 }];
  const fb5 = failureBound(ba, bt), ft5 = fetchTally(bt, ba), ft5n = fetchTally(bt, ba, new Map([[1, 1]]));
  check("failure bound (2 bills vs fetchErrors 1 → at most 1 of 2) and the tally (4 in 3 ticks; blind 2, a log naming #1's failure elsewhere → 1; #3 holds none)",
    fb5.atMost === 1 && fb5.of === 2 && ft5.total === 4 && ft5.ticks === 3 && ft5.blind === 2 && ft5n.informed === 1 && ft5.noCandidate.join() === "#3",
    `bound at most ${fb5.atMost} of ${fb5.of} · total ${ft5.total} in ${ft5.ticks} · blind ${ft5.blind} · informed ${ft5n.informed} · no candidate ${ft5.noCandidate.join()}`);

  // 6. Beyond the handoff's five (named): the verdict branches, the list's
  // completeness and the read guard, network-free. Controls 1 and 4 pick bills
  // whose endpoint already read `lost`, so they cannot catch a classifier that
  // over-reports it; these stubs can fail in every direction.
  console.log("\n── Check 6 · verdict branches, list completeness and the read guard, network-free (beyond the five)");
  const stub = (answers: (Record<string, unknown> | null)[]): Getter => {
    let i = 0;
    return { get: async () => { const j = answers[i++] ?? null; return { status: j ? 200 : null, json: j, error: j ? null : "stub failure" }; }, requests: () => i, stopped: () => null, minGapMs: () => null };
  };
  const kb: BillKey = { id: "119-hr-0", update_date: "2026-01-01T00:00:00Z", type: "hr", number: 0 };
  const twenty = Array.from({ length: 20 }, (_, i) => ({ systemCode: `c${i}` }));
  const v = {
    lost: await resolveBill(stub([{ committees: [{ systemCode: "a" }] }]), kb),
    noCode: await resolveBill(stub([{ committees: [{ name: "x" }] }]), kb),
    none: await resolveBill(stub([{ committees: [] }]), kb),
    err: await resolveBill(stub([null]), kb),
    paged: await resolveBill(stub([{ committees: twenty, pagination: { count: 21, next: "n" } }, { committees: [{ systemCode: "z" }] }]), kb),
  };
  check("resolveBill: lost / empty (no systemCode) / empty (none) / error / a 21st committee kept beyond page 1",
    v.lost.verdict === "lost" && v.noCode.verdict === "empty" && v.none.verdict === "empty" && v.err.verdict === "error" && v.paged.verdict === "lost" && v.paged.codes.length === 20 && v.paged.beyond.join() === "z",
    `${v.lost.verdict} · ${v.noCode.verdict} · ${v.none.verdict} · ${v.err.verdict} · paged ${v.paged.verdict} ${v.paged.codes.length}+[${v.paged.beyond.join(" ")}]`);
  const md = {
    lost: await meetingDetail(stub([{ committeeMeeting: { updateDate: "2026-01-01T00:00:00Z" } }]), "house", "1"),
    nul: await meetingDetail(stub([{ request: {} }]), "house", "1"),
    err: await meetingDetail(stub([null]), "house", "1"),
  };
  check("meetingDetail: lost / null-detail / error", md.lost.verdict === "lost" && md.nul.verdict === "null-detail" && md.err.verdict === "error", `${md.lost.verdict} · ${md.nul.verdict} · ${md.err.verdict}`);
  const ev = (id: string, u: string) => ({ eventId: id, updateDate: u });
  const pagesMain = [
    { offset: 0, pagination: { count: 4, next: "n" }, committeeMeetings: [ev("a", "2026-01-03T00:00:00Z"), ev("b", "2026-01-02T00:00:00Z")] },
    { offset: 2, pagination: { count: 4 }, committeeMeetings: [ev("b", "2026-01-02T00:00:00Z"), ev("d", "2026-01-01T00:00:00Z")] },
  ];
  const lfNo = path.join(OUT, "control-loadlist-norecovery.json"), lfYes = path.join(OUT, "control-loadlist-recovery.json");
  writeFileSync(lfNo, JSON.stringify({ pagingEnded: true, tiedBoundaries: [], pages: pagesMain }));
  writeFileSync(lfYes, JSON.stringify({ pagingEnded: true, tiedBoundaries: [], pages: [...pagesMain, { offset: 1, recovery: true, pagination: { count: 4 }, committeeMeetings: [ev("b", "2026-01-02T00:00:00Z"), ev("c", "2026-01-02T00:00:00Z")] }] }));
  const ln = loadList(lfNo), ly = loadList(lfYes);
  check("loadList: a repeat with a skip reads INCOMPLETE (3 of 4); the recovery window completes it (4 of 4)",
    !ln.complete && ln.unique === 3 && ln.count === 4 && ln.repeats.length === 1 && ly.complete && ly.unique === 4 && ly.recovered.join() === "c 2026-01-02T00:00:00Z" && ly.repeats.length === 1,
    `without ${ln.unique}/${ln.count} ${ln.complete ? "complete" : "INCOMPLETE"} repeats [${ln.repeats.join("; ")}] · with ${ly.unique}/${ly.count} ${ly.complete ? "complete" : "INCOMPLETE"} recovered [${ly.recovered.join("; ")}]`);
  let refused = false;
  try { await cr(`WITH x AS (SELECT 1) DELETE FROM committee_bills WHERE 0`); } catch { refused = true; }
  const allowed = Number((await cr(`SELECT COUNT(*) AS n FROM committee_bills`)).rows[0]?.n) > 0;
  check("the reader refuses a WITH-prefixed write and reads a SELECT", refused && allowed, `WITH … DELETE refused ${refused} · SELECT read ${allowed}`);

  // 7. Beyond the five (HO 753, named): the changed_at key, network-free. The copy gains the three
  // walk columns through perturb (file: only); then it is read with every stamp NULL, with every bill
  // walked after its change, and with four bills planted, one per case the key must tell apart.
  console.log("\n── Check 7 · the changed_at key, network-free (HO 753, beyond the five)");
  await perturb(url, ["changed_at TEXT", "committees_walked_at TEXT", "committee_walk_failures INTEGER"].map((c) => ({ sql: `ALTER TABLE bills ADD COLUMN ${c}`, args: [] })), "check 7: the three walk columns");
  const k0 = await billsSets(cr, "changed_at");
  check("every stamp NULL: every walked-set bill is owed, none set aside", k0.candidates.length === k0.walked && k0.walked > 0 && k0.gaveUp === 0, `owed ${k0.candidates.length} of ${k0.walked} · set aside ${k0.gaveUp}`);
  await perturb(url, [{ sql: "UPDATE bills SET changed_at = '2026-01-01T00:00:00.000Z', committees_walked_at = '2026-01-02T00:00:00.000Z', committee_walk_failures = 0", args: [] }], "check 7: every bill walked after its change");
  const k1 = await billsSets(cr, "changed_at");
  check("every bill walked after its change: none owed", k1.candidates.length === 0 && k1.gaveUp === 0, `owed ${k1.candidates.length} · set aside ${k1.gaveUp}`);
  const four = k0.candidates.slice(0, 4).map((b) => b.id);
  const [A, B, C, D] = four as [string, string, string, string];
  await perturb(url, [
    { sql: "UPDATE bills SET committees_walked_at = NULL WHERE id = ?", args: [A] },
    { sql: "UPDATE bills SET committees_walked_at = '2025-12-31T00:00:00.000Z' WHERE id = ?", args: [B] },
    { sql: "UPDATE bills SET committees_walked_at = '2025-12-31T00:00:00.000Z', committee_walk_failures = 5 WHERE id = ?", args: [C] },
    { sql: "UPDATE bills SET committees_walked_at = '2026-01-01T00:00:00.000Z' WHERE id = ?", args: [D] },
  ], "check 7: A never walked, B changed since its walk, C set aside, D walked at the instant of its change");
  const k2 = await billsSets(cr, "changed_at");
  const owed = new Set(k2.candidates.map((b) => b.id));
  check("owed A, B and C (C set aside), not D", owed.size === 3 && owed.has(A) && owed.has(B) && owed.has(C) && !owed.has(D) && k2.gaveUp === 1, `owed ${[...owed].join(", ")} · set aside ${k2.gaveUp} · D ${D} ${owed.has(D) ? "OWED" : "not owed"}`);
  // The census: a bill short of its count ABOVE the frozen cursor counts under changed_at, not under the cursor.
  const E = k0.candidates.find((b) => !four.includes(b.id) && b.update_date <= p2.cursor)!;
  const eRows = (await storedRowsFor(cr, [E.id])).get(E.id)!.size;
  const aboveE = new Date(Date.parse(p2.cursor) + 86400_000).toISOString().replace(".000Z", "Z");
  await perturb(url, [{ sql: "UPDATE bills SET update_date = ?, raw_json = json_set(raw_json, '$.committees.count', 99) WHERE id = ?", args: [aboveE, E.id] }], "check 7: one bill above the cursor, short of its count");
  const cCur = await census(cr, p2.cursor, [], new Date().toISOString(), "cursor");
  const cKey = await census(cr, p2.cursor, [], new Date().toISOString(), "changed_at");
  check("stored-short under changed_at sees a bill above the cursor, the cursor's does not", eRows > 0 && cKey.shortOfCount.some((x) => x.id === E.id) && !cCur.shortOfCount.some((x) => x.id === E.id), `${E.id} (rows ${eRows}, count 99, update_date ${aboveE}) · changed_at ${cKey.shortOfCount.length} short · cursor ${cCur.shortOfCount.length} short`);
  // An owed bill (changed since its walk) whose count rose is pending, not a fault: the gate number leaves it out.
  const withRowsIds = new Set((await cr(`SELECT DISTINCT bill_id FROM committee_bills`)).rows.map((r) => String(r.bill_id)));
  const Fb = k0.candidates.find((b) => !four.includes(b.id) && b.id !== E.id && withRowsIds.has(b.id))!;
  await perturb(url, [{ sql: "UPDATE bills SET committees_walked_at = '2025-12-31T00:00:00.000Z', raw_json = json_set(raw_json, '$.committees.count', 99) WHERE id = ?", args: [Fb.id] }], "check 7: one owed bill with rows, its count raised");
  const cKey2 = await census(cr, p2.cursor, [], new Date().toISOString(), "changed_at");
  const fRow = cKey2.shortOfCount.find((x) => x.id === Fb.id);
  const eRow = cKey2.shortOfCount.find((x) => x.id === E.id);
  check("an owed short bill reads pending, not a fault; a walk-current one reads a fault", !!fRow && fRow.owed === true && !!eRow && eRow.owed === false, `${Fb.id} owed ${String(fRow?.owed)} · ${E.id} owed ${String(eRow?.owed)}`);
  copy.close();
  console.log(`\nGETs used ${g.requests()} · smallest start-to-start gap ${g.minGapMs()}ms · CONTROLS: ${fails === 0 ? "ALL GREEN" : `${fails} FAILED`}`);
  process.exitCode = fails === 0 ? 0 : 1;
}

const mode = process.argv[2];
(mode === "--controls" ? controls() : mode === "--prod" ? prod() : Promise.reject(new Error("usage: --controls | --prod"))).catch((e) => {
  console.error(redactSecrets(e instanceof Error ? e.stack ?? e.message : String(e)));
  process.exit(2);
});
