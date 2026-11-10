// HO 811: the GradShow poster's Colorado delegation, each member's bills and laws in the dome's own scope and predicate
// (HO 799's A2), with the delegation's total and Congress as a whole beside it, read from prod with each count's
// predicate and its as-of. Read-only. A sibling of gradshow-ceremonial-799.ts and gradshow-party-810.ts, both untouched;
// its harness is the 810 script's, copied.
//
//   npx tsx scripts/diagnostic/gradshow-colorado-811.ts [--label L]
//
// One mode, in this order:
//   STEP 0  the tree at HEAD: the dome's predicate and statement compared byte for byte with the 799 script's (a
//           mismatch stops the run before prod is read); getCurrentCongress; what the members table holds and how its
//           state, chamber and is_current are written; how CT displays a member's name and a bill's title; bills_agg's
//           join; the delegate carve-out; the Nov 5 reading's constants against its artifact when that's on disk. Then
//           prod's columns, the freshness, and the members roster's own as-of (its fetched_at).
//   A       the delegation from members by state, never from names: the state field across the table; every row for
//           Colorado by code or by name, with its name as CT displays it, chamber, district, party, is_current and
//           fetched_at; each one's bills and laws in the dome. HALT if no row reads Colorado's code (no usable state
//           field), or if the current set isn't 2 senators and 8 representatives holding districts 1 to 8, one each
//           (the seats, not only the heads): what's there is printed first, and nothing after it runs. A code and name
//           that disagree, and a current member without a last name or party, are printed, not HALTs.
//   B + C   one read-only transaction (db.batch(…, "read"): BEGIN TRANSACTION READONLY, one snapshot), so B and C share
//           an as-of. B1 per member by stage (sponsor only, joined on sponsor_bioguide_id = members.bioguide_id, the
//           key bills_agg joins on), with laws, the calendar placements at floor, and the furthest stage stored and as
//           the dome reads it; B2 the delegation's total, beside the bills whose own sponsor_state is Colorado (a
//           completeness check both ways); B3 its laws; B4 its bills at floor, other_chamber or president (a list, or
//           counts by member past 15); B5 its ceremonial bills per member. C1 Congress: the dome's own statement (the
//           799 script's CUBE_SQL, verbatim) beside a COUNT, and the 126 reconciled as the 810 script does it; C2 every
//           member's bills and laws, for the median member per chamber. The script's controls (not marked HALTs) stop
//           the run on a mismatch: B1's rows against one COUNT over the delegation, B3 against B1's enacted, C1's
//           statement against its COUNT, a fourth is_ceremonial value (the 799 script's claim 3).
//
// SAFETY. As the 810 script: every statement through guard() (SELECT or WITH … SELECT only, no write keyword), B + C
// inside BEGIN TRANSACTION READONLY, prod's schema fingerprinted before and after, rows_read summed off each hrana
// pipeline response (a batch's step results included) into docs/handoffs/811-artifacts/rows-ledger.tsv (repo-ignored,
// with the run's log and JSON; a label already used is refused before prod is read). TURSO_DATABASE_URL and
// TURSO_AUTH_TOKEN are read from .env by name; every printed line passes redactSecrets, whose seam repair turns a
// printed "&&" into "&", so no code line printed here carries one. Times print in Mountain Time on a 12-hour clock with
// UTC beside.
import { config } from "dotenv";
import { createClient, type Client, type InArgs, type ResultSet, type Row } from "@libsql/client";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { getCurrentCongress } from "@/lib/congress";
import { ALLOWED_STAGES } from "@/lib/enums";
import { redactSecrets } from "@/lib/redact";

config({ path: ".env", quiet: true });

const ART = path.resolve("docs/handoffs/811-artifacts"); // repo-ignored
const LEDGER = path.join(ART, "rows-ledger.tsv");
const SIBLING = "scripts/diagnostic/gradshow-ceremonial-799.ts";
const MT = "America/Denver";
// The Congress: getCurrentCongress()'s, bound as an argument, never a literal.
const CONGRESS = getCurrentCongress();
// The delegation's state, by its code and its name; the members are read off the table by these, never named.
const STATE = "CO";
const STATE_NAME = "Colorado";
const SEATS = { senate: 2, house: 8 }; // the handoff's HALT: 2 senators and 8 representatives (districts 1 to 8)
// The dome's scope and predicate, HO 799's A2: that script's LAW and NONC, copied; STEP 0 compares each with its own.
const LAW = `bill_type IN ('hr','s','hjres','sjres')`;
const NONC = `(is_ceremonial = 0 OR is_ceremonial IS NULL)`;
const CONG = `congress = ?`;
const DOME = `${CONG} AND ${LAW} AND ${NONC}`;
const LAW_TYPES = ["hr", "s", "hjres", "sjres"];
// The delegation's bills: bills joined to members on bills_agg's key (lib/queries.ts:7576). The dome's predicate names
// only bills' columns, which members doesn't share (STEP 0 checks), so it reads unqualified inside the join.
const JOIN = `FROM bills b JOIN members m ON b.sponsor_bioguide_id = m.bioguide_id`;
const MID = `stage IN ('floor','other_chamber','president')`;
const CAL = `COALESCE(latest_action_text LIKE '%placed on%' AND latest_action_text LIKE '%calendar%', 0)`;
// The six non-voting House delegates (lib/queries.ts:7539-7543), for one control on C2's House median.
const DELEGATE_STATES = ["DC", "AS", "GU", "MP", "PR", "VI"];
// The 799 script's CUBE_SQL (:273-281), copied verbatim; STEP 0 compares it byte for byte. C1 reads the dome off it as
// that script's A2 does: the cells with a law type and is_ceremonial 0 or NULL. It has no Congress clause.
const CUBE_SQL = `SELECT bill_type, stage, is_ceremonial,
       (summary IS NOT NULL) AS gated,
       COALESCE(latest_action_text LIKE '%placed on%' AND latest_action_text LIKE '%calendar%', 0) AS cal,
       COALESCE(latest_action_text LIKE '%agreed to%', 0) AS agreed,
       COUNT(*) AS n,
       MAX(update_date) AS max_upd, MAX(summary_updated_at) AS max_sum
  FROM bills
 WHERE id IS NOT NULL
 GROUP BY 1, 2, 3, 4, 5, 6`;

// The dome as the handoff carries it: "as printed, read Nov 5, 2026, 12:37 PM MT (19:37Z): 16,664 bills, 126 enacted";
// HO 799's fourth reading, its cube as of 19:37:44.063Z (run-803.json), and its 13 law-eligible laws tagged ceremonial,
// for the 126's reconciliation (as the 810 script does it).
const PRINTED = { total: 16664, enacted: 126 };
const AT_803 = "2026-11-05T19:37:44.063Z";
const LAWS_ANY_TAG_803 = 139;
const HOLLOW_803 = ["119-hr-2170", "119-hr-2196", "119-hr-3377", "119-hr-3497", "119-hr-452", "119-hr-7194", "119-hr-7211", "119-s-1596", "119-s-2283", "119-s-3705", "119-s-4138", "119-s-790", "119-s-858"];
const RUN_803 = "docs/handoffs/799-artifacts/run-803.json";

const argAt = (flag: string) => { const i = process.argv.indexOf(flag); return i === -1 ? undefined : process.argv[i + 1]; };
const LABEL = argAt("--label") ?? "run";
const out: string[] = [];
const say = (s = "") => { const r = redactSecrets(s); out.push(r); console.log(r); };
const git = (args: string[]) => execFileSync("git", args, { encoding: "utf8" }).trim();
const fmtN = (n: number) => n.toLocaleString("en-US");
const pct2 = (a: number, b: number) => (b > 0 ? ((a / b) * 100).toFixed(2) : "n/a");
const oneLine = (sql: string) => sql.replace(/\s+/g, " ").trim();
const signed = (n: number) => (n > 0 ? `+${fmtN(n)}` : fmtN(n));
const argText = (args: InArgs) => (Array.isArray(args) && args.length ? `  · args ${JSON.stringify(args)}` : "");
const results: Record<string, unknown> = {};

// ── time ────────────────────────────────────────────────────────────────────
const sp = (s: string) => s.replace(/[  ]/g, " ");
const mtFmt = new Intl.DateTimeFormat("en-US", {
  timeZone: MT, month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", second: "2-digit", timeZoneName: "short",
});
const chatFmt = new Intl.DateTimeFormat("en-US", { timeZone: MT, month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
function asDate(x: unknown): Date | null {
  if (x == null || x === "") return null;
  const d = x instanceof Date ? x : new Date(String(x));
  return Number.isNaN(d.getTime()) ? null : d;
}
// "Nov 10, 2026, 9:14:05 AM MST (2026-11-10 16:14:05Z)"; a bare date ("2026-11-03") prints as itself.
function when(x: unknown): string {
  if (typeof x === "string" && /^\d{4}-\d{2}-\d{2}$/.test(x)) return x;
  const d = asDate(x);
  if (!d) return `${String(x)} (unparsed)`;
  return `${sp(mtFmt.format(d))} (${d.toISOString().slice(0, 19).replace("T", " ")}Z)`;
}
// The poster chat's shape: "NOV 10, 2026, 9:14 AM MT".
const chatAsOf = (d: Date) => `${sp(chatFmt.format(d)).toUpperCase()} MT`;

// ── prod, read-only, with the rows_read tap (the 810 script's) ──────────────
type StepResult = { rows_read?: unknown } | null;
const tap = { rows: 0, results: 0, responses: 0, batchSteps: [] as Array<number | null> };
async function tapFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const res = await fetch(input, { ...init, signal: AbortSignal.timeout(120_000) });
  try {
    const j = (await res.clone().json()) as { results?: Array<{ response?: { result?: { rows_read?: unknown; step_results?: StepResult[] } } }> };
    let saw = false;
    for (const r of j.results ?? []) {
      const result = r?.response?.result;
      const rr = result?.rows_read;
      if (typeof rr === "number") { tap.rows += rr; tap.results += 1; saw = true; }
      const steps = result?.step_results;
      if (Array.isArray(steps)) {
        tap.batchSteps = steps.map((s) => (s && typeof s.rows_read === "number" ? s.rows_read : null));
        for (const v of tap.batchSteps) if (v != null) { tap.rows += v; tap.results += 1; saw = true; }
      }
    }
    if (saw) tap.responses += 1;
  } catch {
    /* not a pipeline response */
  }
  return res;
}
let db: Client | null = null;
function prod(): Client {
  if (db) return db;
  const url = process.env.TURSO_DATABASE_URL ?? "";
  if (!url.startsWith("libsql://")) throw new Error("reading prod needs the prod libsql:// URL in .env (TURSO_DATABASE_URL)");
  db = createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN, fetch: tapFetch });
  return db;
}
const WRITE_WORD = /\b(INSERT|UPDATE|DELETE|REPLACE|UPSERT|CREATE|DROP|ALTER|ATTACH|DETACH|VACUUM|REINDEX|PRAGMA|BEGIN|COMMIT|ROLLBACK|SAVEPOINT|RELEASE|ANALYZE)\b/i;
function guard(label: string, sql: string) {
  if (!/^\s*(SELECT|WITH)\b/i.test(sql) || WRITE_WORD.test(sql)) throw new Error(`prod is read-only here: ${label}`);
}
let singles = 0;
let batched = 0;
let batches = 0;
async function q(label: string, sql: string, args: InArgs = []): Promise<ResultSet> {
  guard(label, sql);
  const before = tap.rows;
  const t = Date.now();
  const rs = await prod().execute({ sql, args });
  singles += 1;
  say(`  [q] ${label}`);
  say(`      ${oneLine(sql)}${argText(args)}`);
  say(`      → ${rs.rows.length} row(s) · rows_read ${tap.rows - before} · ${Date.now() - t}ms · read ${when(new Date())}`);
  return rs;
}
type Stmt = { label: string; sql: string; args: InArgs };
async function readBatch(list: Stmt[]): Promise<{ sets: ResultSet[]; sent: Date; back: Date; stepRows: Array<number | null> }> {
  for (const s of list) guard(s.label, s.sql);
  const before = tap.rows;
  tap.batchSteps = [];
  const sent = new Date();
  const sets = await prod().batch(list.map((s) => ({ sql: s.sql, args: s.args })), "read");
  const back = new Date();
  batched += list.length;
  batches += 1;
  const stepRows = tap.batchSteps.slice();
  say(`  [batch] ${list.length} statements in one read-only transaction (BEGIN TRANSACTION READONLY … COMMIT) · sent ${when(sent)} · back ${when(back)} · ${back.getTime() - sent.getTime()}ms · rows_read ${tap.rows - before} over ${stepRows.filter((v) => v != null).length} step result(s)`);
  list.forEach((s, i) => {
    say(`  [q] ${s.label}`);
    say(`      ${oneLine(s.sql)}${argText(s.args)}`);
    say(`      → ${sets[i]?.rows.length ?? "?"} row(s) · rows_read ${stepRows[i + 1] ?? "n/a"}`);
  });
  return { sets, sent, back, stepRows };
}
const num = (v: unknown) => Number(v ?? 0);
const str = (v: unknown) => (v == null ? null : String(v));
const objs = (rs: ResultSet) => rs.rows.map((r: Row) => Object.fromEntries(rs.columns.map((c, i) => [c, r[i] ?? null])));
async function schemaPrint(): Promise<string> {
  const rs = await q("the schema fingerprint (sqlite_master)", `SELECT type, name, sql FROM sqlite_master ORDER BY type, name`);
  return createHash("sha256").update(JSON.stringify(rs.rows.map((r) => [r.type, r.name, r.sql]))).digest("hex").slice(0, 16);
}
// The dome's tag test, strict, as the 810 script's: SQL's is_ceremonial = 0 is false for TEXT ''.
const inDome = (v: unknown) => v === null || v === 0;

// ── the tree ────────────────────────────────────────────────────────────────
function grepFile(file: string, needle: string | RegExp): string[] {
  const lines = readFileSync(file, "utf8").split(/\r?\n/);
  const hits: string[] = [];
  lines.forEach((l, i) => {
    if (typeof needle === "string" ? l.includes(needle) : needle.test(l)) hits.push(`${file}:${i + 1}  ${l.trim().slice(0, 150)}`);
  });
  return hits;
}
function show(label: string, file: string, needle: string | RegExp, max = 8) {
  const h = existsSync(file) ? grepFile(file, needle) : [];
  say(`  ${label}: ${h.length} hit(s)${existsSync(file) ? "" : " (no such file)"}`);
  for (const x of h.slice(0, max)) say(`    ${x}`);
  if (h.length > max) say(`    … ${h.length - max} more`);
  return h;
}

// ── STEP 0 ──────────────────────────────────────────────────────────────────
function step0Tree() {
  say(`\n── STEP 0, the tree (anchors re-derived at HEAD ${git(["rev-parse", "--short", "HEAD"])})`);
  const sib = readFileSync(SIBLING, "utf8").replace(/\r\n/g, "\n");
  const theirs: Record<string, string | null> = {
    LAW: sib.match(/^const LAW = `([^`]*)`;$/m)?.[1] ?? null,
    NONC: sib.match(/^const NONC = `([^`]*)`;$/m)?.[1] ?? null,
    CUBE_SQL: sib.match(/^const CUBE_SQL = `([^`]*)`;$/m)?.[1] ?? null,
  };
  const ours: Record<string, string> = { LAW, NONC, CUBE_SQL };
  const differ = Object.keys(ours).filter((k) => theirs[k] !== ours[k]);
  const h16 = (s: string | null) => (s == null ? "absent" : createHash("sha256").update(s).digest("hex").slice(0, 16));
  show("the dome's predicate and statement in the 799 script", SIBLING, /^const (LAW|NONC|CUBE_SQL) = `/);
  say(`  reuse: LAW, NONC and CUBE_SQL ${differ.length ? `DIFFER from the 799 script's: ${differ.join(", ")}` : "equal the 799 script's byte for byte"} (sha256 ${Object.keys(ours).map((k) => `${k} ${h16(ours[k] ?? null)}`).join(" · ")})`);
  results.reuse = { differ };
  if (differ.length) throw new Error(`cannot run (a precondition, not one of the marked HALTs): ${differ.join(", ")} differ from ${SIBLING}`);
  show("getCurrentCongress", "lib/congress.ts", /^export function getCurrentCongress|return Math\.floor\(\(congressStartYear - 2025\) \/ 2\) \+ 119;/);
  say(`  getCurrentCongress() → ${CONGRESS}: bound as congress = ? in every bills statement below but C1, the 799 statement, which has no Congress clause`);
  show("A · what members holds: the current Congress's roster, the departed kept with is_current 0", "scripts/sync-members.ts", /^\/\/ Refreshes the `members` table from the Congress\.gov roster for the CURRENT$|^\/\/ carries an `is_current` flag so members who served part of the Congress but$|^\/\/   GET \/member\/congress\/\{N\}                    — full roster|^\/\/   GET \/member\/congress\/\{N\}\?currentMember=true  — currently serving/);
  show("A · how members' is_current, chamber and state are written", "scripts/sync-members.ts", /^\s+const isCurrent = currentIds\.has\(bioguideId\) \? 1 : 0;$|^\s+const chamber = deriveChamber\(currentTerm\);$|^\s+const stateName = currentTerm\?\.stateName \?\? member\.state \?\? null;$|^\s+stateAbbr\(stateName\) \?\? currentTerm\?\.stateCode \?\? null,$/);
  show("A · how CT displays a member's name (members.name)", "components/MemberHeader.tsx", /^\s+\{member\.name\}$/);
  show("B3 · how CT displays a bill's title (bills.title)", "components/BillRow.tsx", /<span className="row-title">\{bill\.title\}<\/span>/);
  show("B · bills_agg's CTE and its join, the key the delegation's bills join on", "lib/queries.ts", /^function billsAggCte\(|WHERE sponsor_bioguide_id IS NOT NULL\$\{ceremonial\}|LEFT JOIN bills_agg b ON b\.sponsor_bioguide_id = m\.bioguide_id/);
  show("B2 · bills.sponsor_state, the completeness check's other side: the detail's first sponsor's state", "lib/sync.ts", /^      sponsor\?\.state \?\? null,$/);
  show("C2 · the delegate carve-out", "lib/queries.ts", /^\s+AND m\.state IN \('DC','AS','GU','MP','PR','VI'\) THEN NULL$/);
  if (existsSync(RUN_803)) {
    const j = JSON.parse(readFileSync(RUN_803, "utf8")) as { A?: { cubeAt?: unknown }; A2?: { byStage?: Record<string, unknown>; total?: unknown }; B?: { rows?: Array<{ id?: unknown }>; enactedAll?: unknown } };
    const ids = (j.B?.rows ?? []).map((r) => String(r.id)).sort();
    const checks: Array<[string, boolean]> = [
      ["the cube's as-of", String(j.A?.cubeAt) === AT_803],
      ["the 13 hollow laws", ids.join(",") === HOLLOW_803.join(",")],
      ["the dome's total", num(j.A2?.total) === PRINTED.total],
      ["the dome's enacted", num(j.A2?.byStage?.enacted) === PRINTED.enacted],
      ["the law-eligible laws, any tag", num(j.B?.enactedAll) === LAWS_ANY_TAG_803],
    ];
    const bad = checks.filter(([, ok]) => !ok).map(([k]) => k);
    say(`  the Nov 5 reading's artifact (${RUN_803}): ${bad.length ? `DIFFERS on ${bad.join(", ")}` : `cube as of ${AT_803}; the dome's 16,664 and 126, the 139 laws and the 13 hollow laws equal the copied constants`}`);
    if (bad.length) throw new Error(`cannot run (a precondition, not one of the marked HALTs): ${RUN_803} differs from the copied constants on ${bad.join(", ")}`);
  } else say(`  ${RUN_803} is not on disk (repo-ignored): AT_803, PRINTED and HOLLOW_803 stand as copied`);
}

async function step0Prod() {
  say(`\n── STEP 0, prod`);
  const cols = async (t: string) => (await q(`${t}' columns`, `SELECT name FROM pragma_table_info('${t}') ORDER BY cid`)).rows.map((r) => String(r.name));
  const have: Record<string, string[]> = { bills: await cols("bills"), members: await cols("members") };
  const need: Record<string, string[]> = {
    bills: ["id", "congress", "bill_type", "stage", "is_ceremonial", "summary", "title", "sponsor_name", "sponsor_party", "sponsor_state", "sponsor_bioguide_id", "stage_observed_at", "previous_stage", "latest_action_date", "latest_action_text", "update_date", "summary_updated_at"],
    members: ["bioguide_id", "name", "last_name", "party", "state", "state_name", "district", "chamber", "is_current", "current_term_end_year", "fetched_at"],
  };
  const missing = Object.entries(need).flatMap(([t, cs]) => cs.filter((c) => !(have[t] ?? []).includes(c)).map((c) => `${t}.${c}`));
  // The joins read the dome's predicate and these bills columns unqualified; a members column of the same name would make
  // them ambiguous.
  const shared = ["congress", "bill_type", "is_ceremonial", "stage", "latest_action_text", "latest_action_date", "title", "sponsor_name", "sponsor_state", "id"].filter((c) => (have.members ?? []).includes(c));
  say(`  ${Object.entries(have).map(([t, cs]) => `${t}: ${cs.length} columns`).join(" · ")} · ${missing.length ? `MISSING ${missing.join(", ")}` : "every column the reads name is present"} · members columns named like the joins' unqualified bills columns: ${shared.length ? shared.join(", ") : "none"}`);
  results.columns = have;
  if (missing.length) throw new Error(`cannot run (a precondition, not one of the marked HALTs): ${missing.join(", ")}`);
  if (shared.length) throw new Error(`cannot run (a precondition, not one of the marked HALTs): members carries ${shared.join(", ")}, so the join's unqualified predicate is ambiguous`);
}

async function freshness() {
  say(`\n── what the reads below are as of`);
  for (const route of ["/api/sync", "/api/cron/summarize"]) {
    const rs = await q(`the newest ${route} run`, `SELECT id, started_at, ended_at, status FROM cron_runs WHERE route = ? ORDER BY started_at DESC LIMIT 1`, [route]);
    const ok = await q(`${route}'s newest success`, `SELECT id, started_at, ended_at, status FROM cron_runs WHERE route = ? AND status = 'success' ORDER BY started_at DESC LIMIT 1`, [route]);
    const r = rs.rows[0];
    const o = ok.rows[0];
    say(`    ${route}: newest #${String(r?.id)} ${String(r?.status)} started ${when(r?.started_at)} · newest success #${String(o?.id)} started ${when(o?.started_at)}`);
    const fr = (results.freshness ??= {}) as Record<string, unknown>;
    fr[route] = { newest: r ? objs(rs)[0] : null, newestSuccess: o ? objs(ok)[0] : null };
  }
  const roster = objs(await q("the members roster's own as-of: rows, current, and fetched_at", `SELECT COUNT(*) AS n, SUM(CASE WHEN is_current = 1 THEN 1 ELSE 0 END) AS cur, MIN(fetched_at) AS first_fetch, MAX(fetched_at) AS last_fetch FROM members`))[0];
  say(`    members: ${fmtN(num(roster?.n))} rows, ${fmtN(num(roster?.cur))} current; fetched ${when(roster?.first_fetch)} to ${when(roster?.last_fetch)} (npm run sync:members, by hand; the roster is as of then)`);
  results.roster = roster;
}

// ── A: the delegation ───────────────────────────────────────────────────────
type Member = { bid: string; name: string; lastName: string | null; party: string | null; state: string | null; stateName: string | null; district: number | null; chamber: string | null; current: boolean; fetchedAt: string | null };
let delegation: Member[] = [];
const nameOf = (m: Member) => m.lastName ?? m.name; // the chat's surname; a missing last_name is flagged in A
async function sectionA() {
  say(`\n── A, the delegation`);
  const st = objs(await q("A · the state field across the table: distinct values, rows without one, values not two letters", `SELECT COUNT(DISTINCT state) AS states, SUM(CASE WHEN state IS NULL OR TRIM(state) = '' THEN 1 ELSE 0 END) AS blank, SUM(CASE WHEN is_current = 1 AND (state IS NULL OR TRIM(state) = '') THEN 1 ELSE 0 END) AS blank_current, SUM(CASE WHEN state IS NOT NULL AND length(state) != 2 THEN 1 ELSE 0 END) AS not_two FROM members`))[0];
  const rows = objs(await q(`A · every members row for ${STATE_NAME}, by code or by name (the roster is the current Congress's)`, `SELECT bioguide_id, name, last_name, party, state, state_name, district, chamber, is_current, current_term_end_year, fetched_at FROM members WHERE state = ? OR state_name = ? ORDER BY is_current DESC, CASE chamber WHEN 'senate' THEN 0 ELSE 1 END, district, last_name, name`, [STATE, STATE_NAME]));
  const counts = objs(await q(`A · each of those members' bills and laws in the dome (sponsor only, bills_agg's key)`, `SELECT b.sponsor_bioguide_id AS bid, COUNT(*) AS n, SUM(CASE WHEN stage = 'enacted' THEN 1 ELSE 0 END) AS laws ${JOIN} WHERE ${DOME} AND (m.state = ? OR m.state_name = ?) GROUP BY 1`, [CONGRESS, STATE, STATE_NAME]));
  const byBid = new Map(counts.map((r) => [String(r.bid), { n: num(r.n), laws: num(r.laws) }]));
  delegation = rows.map((r) => ({
    bid: String(r.bioguide_id), name: String(r.name), lastName: str(r.last_name), party: str(r.party), state: str(r.state), stateName: str(r.state_name),
    district: r.district == null ? null : num(r.district), chamber: str(r.chamber), current: num(r.is_current) === 1, fetchedAt: str(r.fetched_at),
  }));
  const disagree = delegation.filter((m) => m.state !== STATE || m.stateName !== STATE_NAME);
  say(`  the state field: ${fmtN(num(st?.states))} distinct values · rows without one ${fmtN(num(st?.blank))} (current ${fmtN(num(st?.blank_current))}) · values not two letters ${fmtN(num(st?.not_two))}`);
  say(`  ${fmtN(rows.length)} ${STATE_NAME} rows (predicate: state = '${STATE}' OR state_name = '${STATE_NAME}'), ${fmtN(rows.filter((r) => r.state === STATE).length)} by code:`);
  say(`    ${"name (members.name)".padEnd(28)}${"chamber".padEnd(9)}${"district".padEnd(10)}${"party".padEnd(7)}${"current".padEnd(9)}${"bills".padStart(7)}${"laws".padStart(6)}  bioguide · fetched`);
  for (const m of delegation) {
    const c = byBid.get(m.bid);
    say(`    ${m.name.padEnd(28)}${String(m.chamber).padEnd(9)}${(m.district == null ? "—" : String(m.district)).padEnd(10)}${String(m.party).padEnd(7)}${(m.current ? "yes" : "NO").padEnd(9)}${fmtN(c?.n ?? 0).padStart(7)}${fmtN(c?.laws ?? 0).padStart(6)}  ${m.bid} · ${when(m.fetchedAt)}`);
  }
  say(`  state code and name disagree: ${disagree.length ? disagree.map((m) => `${m.bid} (${String(m.state)}, ${String(m.stateName)})`).join(", ") : "none"}`);
  const current = delegation.filter((m) => m.current && m.state === STATE);
  const sen = current.filter((m) => m.chamber === "senate");
  const rep = current.filter((m) => m.chamber === "house");
  const otherChamber = current.filter((m) => m.chamber !== "senate" && m.chamber !== "house");
  const districts = rep.map((m) => m.district).filter((d): d is number => d != null).sort((a, b) => a - b);
  const seatsOk = districts.length === SEATS.house && districts.every((d, i) => d === i + 1);
  const unnamed = current.filter((m) => !m.lastName || !m.party);
  const former = delegation.filter((m) => !m.current);
  say(`  currently serving (is_current = 1, state = '${STATE}'): ${sen.length} senator(s), ${rep.length} representative(s) holding districts ${districts.join(", ") || "none"}${rep.length !== districts.length ? ` (${rep.length - districts.length} with no district)` : ""}${otherChamber.length ? `, and ${otherChamber.length} with another chamber value: ${otherChamber.map((m) => `${m.bid} ${String(m.chamber)}`).join(", ")}` : ""}`);
  say(`  a current member without a last name or party (the chat line needs both): ${unnamed.length ? unnamed.map((m) => `${m.bid} ${m.name} (last_name ${String(m.lastName)}, party ${String(m.party)})`).join(", ") : "none"}`);
  say(`  served for ${STATE_NAME} earlier in this Congress and left (is_current = 0): ${former.length ? former.map((m) => `${m.name} (${String(m.chamber)}${m.district == null ? "" : ` ${m.district}`}, ${String(m.party)}, fetched ${when(m.fetchedAt)}): ${fmtN(byBid.get(m.bid)?.n ?? 0)} bills, ${fmtN(byBid.get(m.bid)?.laws ?? 0)} laws`).join("; ") : "none"}`);
  results.A = { stateField: st, rows, counts, senators: sen.map((m) => m.bid), representatives: rep.map((m) => m.bid), districts, seatsOk, otherChamber: otherChamber.map((m) => m.bid), unnamed: unnamed.map((m) => m.bid), former: former.map((m) => m.bid), disagree: disagree.map((m) => m.bid) };
  const halts: string[] = [];
  // Usable: the column reads Colorado by its code. A code and name that disagree are printed above; a row hiding
  // behind a wrong code would show in the seats below.
  if (!rows.some((r) => r.state === STATE)) halts.push(`members has no usable state field: no row reads '${STATE}'`);
  if (sen.length !== SEATS.senate || rep.length !== SEATS.house || otherChamber.length || !seatsOk) halts.push(`the currently serving set is ${sen.length} senator(s) and ${rep.length} representative(s) holding districts ${districts.join(", ") || "none"}${otherChamber.length ? `, and ${otherChamber.length} other` : ""}, not ${SEATS.senate} senators and ${SEATS.house} representatives holding districts 1 to ${SEATS.house}`);
  if (halts.length) throw new Error(`HALT (A): ${halts.join("; ")}. What's there is above; nothing below runs, and the poster chat decides who prints.`);
  say(`  no HALT: the state field reads ${STATE_NAME} by its code, and the current set is ${sen.length} senators and ${rep.length} representatives holding districts 1 to ${SEATS.house}, one each`);
}

// ── B and C: one read ───────────────────────────────────────────────────────
const LADDER = [...ALLOWED_STAGES] as string[];
const RANK: Record<string, number> = Object.fromEntries(LADDER.map((s, i) => [s, i]));
const skey = (v: unknown) => (v == null ? "NULL" : String(v));
function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const a = xs.slice().sort((x, y) => x - y);
  const mid = Math.floor(a.length / 2);
  return a.length % 2 ? a[mid]! : (a[mid - 1]! + a[mid]!) / 2;
}
const fmtMed = (v: number | null) => (v == null ? "n/a" : Number.isInteger(v) ? fmtN(v) : v.toFixed(1));
type Cell = { billType: string; stage: string | null; cer: unknown; n: number };
type Med = { members: number; bills: number | null; laws: number | null };

async function sectionBC() {
  say(`\n── B and C, one read`);
  const list: Stmt[] = [
    { label: "the database's clock inside the transaction", sql: `SELECT strftime('%Y-%m-%dT%H:%M:%fZ', 'now') AS db_now`, args: [] },
    { label: `B1 · each ${STATE_NAME} member's bills by stage, by the chamber they started in, and by calendar placement`, sql: `SELECT b.sponsor_bioguide_id AS bid, stage, bill_type, ${CAL} AS cal, COUNT(*) AS n ${JOIN} WHERE ${DOME} AND m.state = ? GROUP BY 1, 2, 3, 4`, args: [CONGRESS, STATE] },
    { label: `B2 · control: the delegation's bills and laws, one COUNT`, sql: `SELECT COUNT(*) AS n, SUM(CASE WHEN stage = 'enacted' THEN 1 ELSE 0 END) AS laws ${JOIN} WHERE ${DOME} AND m.state = ?`, args: [CONGRESS, STATE] },
    { label: `B3 · the delegation's laws`, sql: `SELECT b.id AS id, title, sponsor_name, b.sponsor_bioguide_id AS bid, latest_action_date, latest_action_text ${JOIN} WHERE ${DOME} AND m.state = ? AND stage = 'enacted' ORDER BY latest_action_date, b.id`, args: [CONGRESS, STATE] },
    { label: `B4 · the delegation's bills at floor, other_chamber or president`, sql: `SELECT b.id AS id, sponsor_name, b.sponsor_bioguide_id AS bid, stage, latest_action_date, ${CAL} AS cal ${JOIN} WHERE ${DOME} AND m.state = ? AND ${MID} ORDER BY CASE stage WHEN 'president' THEN 0 WHEN 'other_chamber' THEN 1 ELSE 2 END, b.id`, args: [CONGRESS, STATE] },
    { label: `B5 · the delegation's ceremonial bills (law-eligible, is_ceremonial = 1), per member`, sql: `SELECT b.sponsor_bioguide_id AS bid, COUNT(*) AS n, SUM(CASE WHEN stage = 'enacted' THEN 1 ELSE 0 END) AS laws, GROUP_CONCAT(CASE WHEN stage = 'enacted' THEN b.id END) AS law_ids ${JOIN} WHERE ${CONG} AND ${LAW} AND is_ceremonial = 1 AND m.state = ? GROUP BY 1`, args: [CONGRESS, STATE] },
    { label: "C1 · the dome's own statement: the 799 script's CUBE_SQL, verbatim (no Congress clause)", sql: CUBE_SQL, args: [] },
    { label: "C1 · control: the dome's bills and laws, one COUNT", sql: `SELECT COUNT(*) AS n, SUM(CASE WHEN stage = 'enacted' THEN 1 ELSE 0 END) AS laws FROM bills WHERE ${DOME}`, args: [CONGRESS] },
    { label: "C1 · control: the Congress clause or none, the dome's predicate by congress", sql: `SELECT congress, COUNT(*) AS n FROM bills WHERE ${LAW} AND ${NONC} GROUP BY 1 ORDER BY 1`, args: [] },
    { label: "C1 · the 126: the dome's laws observed after the Nov 5 reading's as-of", sql: `SELECT id, sponsor_name, sponsor_party, latest_action_date, stage_observed_at FROM bills WHERE ${DOME} AND stage = 'enacted' AND stage_observed_at > ? ORDER BY stage_observed_at, id`, args: [CONGRESS, AT_803] },
    { label: "C1 · the 126: every law-eligible law, any tag", sql: `SELECT id, is_ceremonial, stage_observed_at, latest_action_date FROM bills WHERE ${CONG} AND ${LAW} AND stage = 'enacted' ORDER BY id`, args: [CONGRESS] },
    { label: "C1 · the 126: law-eligible bills that left enacted", sql: `SELECT id, stage FROM bills WHERE ${CONG} AND ${LAW} AND previous_stage = 'enacted' AND (stage IS NULL OR stage != 'enacted') ORDER BY id`, args: [CONGRESS] },
    { label: "C2 · every member's bills and laws in the dome (sponsor only, bills_agg's key)", sql: `SELECT m.bioguide_id AS bid, m.chamber AS chamber, m.is_current AS is_cur, m.state AS state, COUNT(*) AS n, SUM(CASE WHEN stage = 'enacted' THEN 1 ELSE 0 END) AS laws ${JOIN} WHERE ${DOME} GROUP BY 1, 2, 3, 4`, args: [CONGRESS] },
    { label: "C2 · control: the dome's bills whose sponsor has no members row (outside every median)", sql: `SELECT COUNT(*) AS n FROM bills b LEFT JOIN members m ON b.sponsor_bioguide_id = m.bioguide_id WHERE ${DOME} AND m.bioguide_id IS NULL`, args: [CONGRESS] },
    // Appended, so the indexes above don't move.
    { label: `B2 · completeness: the dome's bills whose own sponsor_state is '${STATE}'`, sql: `SELECT COUNT(*) AS n, SUM(CASE WHEN stage = 'enacted' THEN 1 ELSE 0 END) AS laws FROM bills WHERE ${DOME} AND sponsor_state = ?`, args: [CONGRESS, STATE] },
    { label: `B2 · completeness: of those, the ones the members join misses (no members row, or one that isn't ${STATE_NAME}'s)`, sql: `SELECT b.id AS id, sponsor_name, b.sponsor_bioguide_id AS bid, m.state AS member_state, stage FROM bills b LEFT JOIN members m ON b.sponsor_bioguide_id = m.bioguide_id WHERE ${DOME} AND sponsor_state = ? AND (m.bioguide_id IS NULL OR m.state IS NOT ?) ORDER BY b.id`, args: [CONGRESS, STATE, STATE] },
    { label: `B2 · completeness, the other way: the delegation's bills whose own sponsor_state isn't '${STATE}'`, sql: `SELECT b.id AS id, sponsor_name, sponsor_state, stage ${JOIN} WHERE ${DOME} AND m.state = ? AND (sponsor_state IS NULL OR sponsor_state != ?) ORDER BY b.id`, args: [CONGRESS, STATE, STATE] },
    { label: "control · is_ceremonial's values in the law-eligible rows (the 799 script's claim 3; a fourth value stops the run)", sql: `SELECT typeof(is_ceremonial) AS t, is_ceremonial AS v, COUNT(*) AS n FROM bills WHERE ${LAW} GROUP BY 1, 2 ORDER BY 1, 2`, args: [] },
  ];
  const { sets, back, stepRows } = await readBatch(list);
  const at = back;
  const need = (i: number): ResultSet => {
    const rs = sets[i];
    if (!rs) throw new Error(`STOP (the script's control, not a marked HALT): statement ${i} of the batch returned nothing`);
    return rs;
  };
  const dbNow = str(need(0).rows[0]?.db_now);
  say(`  the read's as-of: ${when(at)}, the batch back; the database's clock inside the transaction read ${when(dbNow)}`);
  results.asOf = { at: at.toISOString(), mt: when(at), chat: chatAsOf(at), dbNow, stepRows };
  const stops: string[] = [];

  // The tag values first: the dome's predicate means what it says only over 0, 1 and NULL.
  const tags = objs(need(17));
  const fourth = tags.filter((r) => !(r.t === "null" || (r.t === "integer" && (r.v === 0 || r.v === 1))));
  say(`  is_ceremonial in the law-eligible rows: ${tags.map((r) => `${String(r.t)} ${r.v === null ? "NULL" : JSON.stringify(r.v)} · ${fmtN(num(r.n))}`).join(" · ")}${fourth.length ? " · A FOURTH VALUE" : " · 1, 0 and NULL only"}`);
  results.tags = tags;
  if (fourth.length) throw new Error(`STOP (the script's control, the 799 script's claim 3, not a marked HALT): is_ceremonial carries ${fourth.map((r) => `${String(r.t)} ${JSON.stringify(r.v)} (${fmtN(num(r.n))})`).join(", ")}`);

  // B1: per member by stage, with the calendar placements at floor.
  const grid = new Map<string, Map<string, number>>();
  const floorCal = new Map<string, number>();
  const byOrigin = new Map<string, { house: number; senate: number }>();
  for (const r of objs(need(1))) {
    const bid = String(r.bid);
    const s = skey(r.stage);
    const row = grid.get(bid) ?? new Map<string, number>();
    row.set(s, (row.get(s) ?? 0) + num(r.n));
    grid.set(bid, row);
    if (s === "floor" && num(r.cal) === 1) floorCal.set(bid, (floorCal.get(bid) ?? 0) + num(r.n));
    const o = byOrigin.get(bid) ?? { house: 0, senate: 0 };
    if (r.bill_type === "hr" || r.bill_type === "hjres") o.house += num(r.n); else o.senate += num(r.n);
    byOrigin.set(bid, o);
  }
  const seen = new Set<string>();
  for (const row of grid.values()) for (const k of row.keys()) seen.add(k);
  const odd = [...seen].filter((s) => !LADDER.includes(s) && s !== "other" && s !== "NULL").sort();
  const cols = [...LADDER, "other", "NULL", ...odd];
  const ordered = [
    ...delegation.filter((m) => m.current && m.chamber === "senate").sort((a, b) => nameOf(a).localeCompare(nameOf(b))),
    ...delegation.filter((m) => m.current && m.chamber === "house").sort((a, b) => (a.district ?? 99) - (b.district ?? 99)),
    ...delegation.filter((m) => !m.current),
  ];
  const label = (m: Member) => (m.chamber === "senate" ? "SEN" : `${STATE}-${m.district ?? "?"}`);
  // The furthest stage a member's bills reached: stored, and as the dome reads a floor row whose latest action is a
  // calendar placement (committee).
  const furthestOf = (row: Map<string, number>, cal: number) => {
    const stored = [...row.entries()].filter(([s, n]) => n > 0 && s in RANK).map(([s]) => RANK[s]!);
    const domeWay = [...row.entries()].filter(([s, n]) => (s === "floor" ? n - cal : n) > 0 && s in RANK).map(([s]) => RANK[s]!);
    if (cal > 0 && (row.get("committee") ?? 0) === 0) domeWay.push(RANK.committee!);
    return { stored: stored.length ? LADDER[Math.max(...stored)]! : "none", domeWay: domeWay.length ? LADDER[Math.max(...domeWay)]! : "none" };
  };
  say(`\n  B1 · each ${STATE_NAME} member's bills, by sponsor only (predicate: ${DOME} AND the sponsor's members.state = '${STATE}', joined on sponsor_bioguide_id = members.bioguide_id; congress ${CONGRESS})`);
  const wid = (c: string) => Math.max(8, c.length + 1);
  say(`    ${"member".padEnd(34)}${cols.map((c) => c.padStart(wid(c))).join("")}${"bills".padStart(8)}${"laws".padStart(6)}  furthest (stored · as the dome reads it)`);
  type PM = { bid: string; name: string; surname: string; party: string | null; label: string; current: boolean; bills: number; laws: number; floorCal: number; furthest: string; furthestDome: string; byStage: Record<string, number>; origin: { house: number; senate: number } };
  const perMember: PM[] = [];
  for (const m of ordered) {
    const row = grid.get(m.bid) ?? new Map<string, number>();
    const bills = [...row.values()].reduce((a, n) => a + n, 0);
    const laws = row.get("enacted") ?? 0;
    const cal = floorCal.get(m.bid) ?? 0;
    const f = furthestOf(row, cal);
    const byStage = Object.fromEntries(cols.map((c) => [c, row.get(c) ?? 0]));
    perMember.push({ bid: m.bid, name: m.name, surname: nameOf(m), party: m.party, label: label(m), current: m.current, bills, laws, floorCal: cal, furthest: f.stored, furthestDome: f.domeWay, byStage, origin: byOrigin.get(m.bid) ?? { house: 0, senate: 0 } });
    say(`    ${`${m.name} (${label(m)}, ${String(m.party)}${m.current ? "" : ", left"})`.padEnd(34)}${cols.map((c) => fmtN(row.get(c) ?? 0).padStart(wid(c))).join("")}${fmtN(bills).padStart(8)}${fmtN(laws).padStart(6)}  ${f.stored} · ${f.domeWay}`);
  }
  const calTotal = perMember.reduce((a, p) => a + p.floorCal, 0);
  say(`    calendar placements among the floor counts (the dome reads them as committee): ${calTotal ? perMember.filter((p) => p.floorCal).map((p) => `${p.name} ${p.floorCal}`).join(", ") : "none"}`);
  const crossed = perMember.filter((p) => (p.label === "SEN" ? p.origin.house : p.origin.senate) > 0);
  say(`    a member with bills that started in the other chamber: ${crossed.length ? crossed.map((p) => `${p.name} (House-start ${p.origin.house}, Senate-start ${p.origin.senate})`).join(", ") : "none"}`);

  // B2: the delegation's total, current members and with anyone who left; and the completeness check.
  const cur = perMember.filter((p) => p.current);
  const left = perMember.filter((p) => !p.current);
  const curBills = cur.reduce((a, p) => a + p.bills, 0);
  const curLaws = cur.reduce((a, p) => a + p.laws, 0);
  const allBills = perMember.reduce((a, p) => a + p.bills, 0);
  const allLaws = perMember.reduce((a, p) => a + p.laws, 0);
  const ctl = objs(need(2))[0];
  say(`\n  B2 · the delegation's total: ${fmtN(curBills)} bills · ${fmtN(curLaws)} laws · ${pct2(curLaws, curBills)}% (the ${cur.length} serving)${left.length ? `; with the ${left.length} who left, ${fmtN(allBills)} bills · ${fmtN(allLaws)} laws · ${pct2(allLaws, allBills)}%` : "; nobody left"}`);
  say(`    control: one COUNT over the delegation's bills reads ${fmtN(num(ctl?.n))} bills, ${fmtN(num(ctl?.laws))} laws (${num(ctl?.n) === allBills && num(ctl?.laws) === allLaws ? "equal to B1's rows" : "NOT EQUAL to B1's rows"})`);
  if (num(ctl?.n) !== allBills || num(ctl?.laws) !== allLaws) stops.push(`B1's rows (${allBills} bills, ${allLaws} laws) differ from the delegation's COUNT (${num(ctl?.n)}, ${num(ctl?.laws)})`);
  const bySt = objs(need(14))[0];
  const missed = objs(need(15));
  const foreign = objs(need(16));
  say(`    completeness: the dome's bills whose own sponsor_state is '${STATE}' (bills.sponsor_state, the detail's first sponsor's state): ${fmtN(num(bySt?.n))} bills, ${fmtN(num(bySt?.laws))} laws, against the members join's ${fmtN(allBills)} and ${fmtN(allLaws)}`);
  say(`    the join misses: ${missed.length ? missed.map((r) => `${String(r.id)} (${String(r.sponsor_name)}, ${r.bid == null ? "no bioguide id" : r.member_state == null ? "no members row" : `members reads ${String(r.member_state)}`}, ${String(r.stage)})`).join("; ") : "none"}; the join's bills with another sponsor_state: ${foreign.length ? foreign.map((r) => `${String(r.id)} (${String(r.sponsor_name)}, ${String(r.sponsor_state)})`).join("; ") : "none"}`);

  // B3: the laws.
  const b3 = objs(need(3));
  const leftBids = new Set(left.map((p) => p.bid));
  say(`\n  B3 · the delegation's laws, ${fmtN(b3.length)} (predicate: B1's AND stage = 'enacted'):`);
  for (const r of b3) say(`    ${String(r.id)} · ${String(r.title)} · ${String(r.sponsor_name)}${leftBids.has(String(r.bid)) ? " (left this Congress)" : ""} · latest action ${when(r.latest_action_date)} · ${String(r.latest_action_text ?? "").slice(0, 60)}`);
  say(`    control: ${fmtN(b3.length)} against B1's laws ${fmtN(allLaws)} (${b3.length === allLaws ? "equal" : "NOT EQUAL"})`);
  if (b3.length !== allLaws) stops.push(`B3 lists ${b3.length} laws, B1's rows count ${allLaws}`);

  // B4: floor, other_chamber, president.
  const b4 = objs(need(4));
  say(`\n  B4 · the delegation's bills at floor, other_chamber or president, ${fmtN(b4.length)} (predicate: B1's AND ${MID}):`);
  if (b4.length > 15) {
    say(`    more than 15, so counts by member (the list is in the run's JSON):`);
    for (const p of perMember) {
      const mine = b4.filter((r) => String(r.bid) === p.bid);
      if (!mine.length) continue;
      const by = (s: string) => mine.filter((r) => r.stage === s).length;
      const cal = mine.filter((r) => r.stage === "floor" && num(r.cal) === 1).length;
      say(`    ${p.name} (${p.label}): president ${by("president")} · other_chamber ${by("other_chamber")} · floor ${by("floor")}${cal ? `, ${cal} of them calendar placements` : ""}`);
    }
    const tot = (s: string) => b4.filter((r) => r.stage === s).length;
    say(`    the delegation: president ${tot("president")} · other_chamber ${tot("other_chamber")} · floor ${tot("floor")} (${b4.filter((r) => r.stage === "floor" && num(r.cal) === 1).length} calendar placements) · ${fmtN(b4.length)} in all`);
  } else {
    for (const r of b4) say(`    ${String(r.id)} · ${String(r.sponsor_name)} · ${String(r.stage)}${num(r.cal) === 1 ? " (its latest action a calendar placement, which the printed dome reads as committee)" : ""}`);
  }

  // B5: ceremonial, per member.
  const b5 = new Map(objs(need(5)).map((r) => [String(r.bid), { n: num(r.n), laws: num(r.laws), lawIds: str(r.law_ids) }]));
  say(`\n  B5 · the delegation's ceremonial bills, excluded above (predicate: congress = ? AND ${LAW} AND is_ceremonial = 1, the sponsor's members.state = '${STATE}'):`);
  for (const p of perMember) {
    const c = b5.get(p.bid);
    say(`    ${p.name} (${p.label}): ${fmtN(c?.n ?? 0)}${c?.laws ? `, of them ${c.laws} law(s): ${String(c.lawIds)}` : ""}`);
  }
  const b5Total = [...b5.values()].reduce((a, c) => a + c.n, 0);
  say(`    the delegation: ${fmtN(b5Total)} ceremonial bills`);

  // C1: Congress, and the 126.
  const cells: Cell[] = need(6).rows.map((r) => ({ billType: String(r.bill_type), stage: str(r.stage), cer: r.is_ceremonial ?? null, n: num(r.n) }));
  const dome = cells.filter((c) => LAW_TYPES.includes(c.billType) && inDome(c.cer));
  const domeBills = dome.reduce((a, c) => a + c.n, 0);
  const domeLaws = dome.filter((c) => c.stage === "enacted").reduce((a, c) => a + c.n, 0);
  const c1ctl = objs(need(7))[0];
  const byCong = objs(need(8));
  const noClause = byCong.reduce((a, r) => a + num(r.n), 0);
  const inCong = byCong.filter((r) => num(r.congress) === CONGRESS).reduce((a, r) => a + num(r.n), 0);
  say(`\n  C1 · Congress: ${fmtN(domeBills)} bills · ${fmtN(domeLaws)} laws · ${pct2(domeLaws, domeBills)}% (the dome's own statement, cut to ${LAW} AND ${NONC}; no Congress clause)`);
  say(`    control: one COUNT with congress = ${CONGRESS} reads ${fmtN(num(c1ctl?.n))} bills, ${fmtN(num(c1ctl?.laws))} laws (${num(c1ctl?.n) === domeBills && num(c1ctl?.laws) === domeLaws ? "equal" : "NOT EQUAL"}); by congress ${byCong.map((r) => `${String(r.congress)} ${fmtN(num(r.n))}`).join(" · ")} (${noClause === inCong ? "one Congress" : "THE CLAUSE DROPS ROWS"})`);
  if (num(c1ctl?.n) !== domeBills || num(c1ctl?.laws) !== domeLaws) stops.push(`C1's statement (${domeBills} bills, ${domeLaws} laws) differs from its COUNT (${num(c1ctl?.n)}, ${num(c1ctl?.laws)})`);
  const since = objs(need(9));
  const laws = objs(need(10));
  const leftEnacted = objs(need(11));
  const after = (r: Record<string, unknown>) => r.stage_observed_at != null && String(r.stage_observed_at) > AT_803;
  const before = laws.filter((r) => !after(r));
  const hollow = new Set(HOLLOW_803);
  const beforeNotHollow = before.filter((r) => !hollow.has(String(r.id)));
  const movedIn = before.filter((r) => hollow.has(String(r.id)) && inDome(r.is_ceremonial));
  const movedOut = beforeNotHollow.filter((r) => !inDome(r.is_ceremonial));
  const holds = domeLaws === PRINTED.enacted;
  say(`    the 126: today ${fmtN(domeLaws)} (${signed(domeLaws - PRINTED.enacted)}); laws in the dome observed after Nov 5's as-of (${AT_803}): ${since.length ? since.map((r) => `${String(r.id)} (${String(r.sponsor_party)}, ${String(r.latest_action_date)}, observed ${when(r.stage_observed_at)})`).join(", ") : "none"}; law-eligible laws, any tag, observed at or before it or never stamped ${fmtN(before.length)} (Nov 5: ${LAWS_ANY_TAG_803}), of them not hollow on Nov 5 ${fmtN(beforeNotHollow.length)} (Nov 5's dome: ${PRINTED.enacted}); hollow then and in the dome now: ${movedIn.map((r) => String(r.id)).join(", ") || "none"}; tagged ceremonial since: ${movedOut.map((r) => String(r.id)).join(", ") || "none"}; left enacted: ${leftEnacted.map((r) => String(r.id)).join(", ") || "none"}`);
  const verdict = holds ? `the dome's 126 HOLDS: it reads ${fmtN(domeLaws)} laws today` : `the dome's 126 does not hold: it reads ${fmtN(domeLaws)} laws today (${signed(domeLaws - PRINTED.enacted)})${since.length ? `; observed since: ${since.map((r) => String(r.id)).join(", ")}` : ""}`;
  say(`    ${verdict}; the dome's bills ${fmtN(domeBills)} against the printed ${fmtN(PRINTED.total)} (${signed(domeBills - PRINTED.total)})`);

  // C2: the median member, per chamber, among members who sponsored at least one bill in the dome.
  const all = objs(need(12)).map((r) => ({ bid: String(r.bid), chamber: str(r.chamber), current: num(r.is_cur) === 1, state: str(r.state), n: num(r.n), laws: num(r.laws) }));
  const orphan = num(need(13).rows[0]?.n);
  say(`\n  C2 · the median member per chamber, among members with at least one bill in the dome (sponsor only; per member: COUNT(*) and its enacted, ${DOME}; the bills median and the laws median taken separately; an even count averages the middle two)`);
  const med: Record<string, { all: Med; current: Med; withoutDelegates: Med; currentVoting: Med }> = {};
  const m3 = (pop: typeof all): Med => ({ members: pop.length, bills: median(pop.map((r) => r.n)), laws: median(pop.map((r) => r.laws)) });
  for (const ch of ["senate", "house"]) {
    const pop = all.filter((r) => r.chamber === ch);
    const isDel = (r: (typeof all)[number]) => ch === "house" && DELEGATE_STATES.includes(String(r.state));
    med[ch] = { all: m3(pop), current: m3(pop.filter((r) => r.current)), withoutDelegates: m3(pop.filter((r) => !isDel(r))), currentVoting: m3(pop.filter((r) => r.current && !isDel(r))) };
    const v = med[ch]!;
    say(`    ${ch}: ${v.all.members} members (departed included${ch === "house" ? ", the six delegates included" : ""}) · median ${fmtMed(v.all.bills)} bills · median ${fmtMed(v.all.laws)} laws  (controls: current only ${v.current.members} · ${fmtMed(v.current.bills)} · ${fmtMed(v.current.laws)}${ch === "house" ? `; without the delegates ${v.withoutDelegates.members} · ${fmtMed(v.withoutDelegates.bills)} · ${fmtMed(v.withoutDelegates.laws)}; current and voting ${v.currentVoting.members} · ${fmtMed(v.currentVoting.bills)} · ${fmtMed(v.currentVoting.laws)}` : ""})`);
  }
  const otherCh = all.filter((r) => r.chamber !== "senate" && r.chamber !== "house");
  say(`    members with another chamber value: ${otherCh.length ? otherCh.map((r) => `${r.bid} ${String(r.chamber)}`).join(", ") : "none"}; the dome's bills whose sponsor has no members row (in no median): ${fmtN(orphan)}`);
  const sumAll = all.reduce((a, r) => a + r.n, 0);
  say(`    control: the members' bills sum to ${fmtN(sumAll)}, + ${fmtN(orphan)} without a members row = ${fmtN(sumAll + orphan)} (C1's ${fmtN(num(c1ctl?.n))}: ${sumAll + orphan === num(c1ctl?.n) ? "equal" : "NOT EQUAL"})`);
  if (sumAll + orphan !== num(c1ctl?.n)) stops.push(`C2's members' bills (${sumAll}) plus the unmatched (${orphan}) differ from C1's COUNT (${num(c1ctl?.n)})`);

  results.B1 = perMember;
  results.B2 = { current: { members: cur.length, bills: curBills, laws: curLaws, share: pct2(curLaws, curBills) }, withLeft: { bills: allBills, laws: allLaws, share: pct2(allLaws, allBills) }, control: ctl, bySponsorState: bySt, joinMisses: missed, otherSponsorState: foreign };
  results.B3 = b3;
  results.B4 = b4;
  results.B5 = Object.fromEntries(b5);
  results.C1 = { bills: domeBills, laws: domeLaws, share: pct2(domeLaws, domeBills), control: c1ctl, byCongress: byCong, since, before: before.length, beforeNotHollow: beforeNotHollow.length, movedIn: movedIn.map((r) => String(r.id)), movedOut: movedOut.map((r) => String(r.id)), leftEnacted, holds, verdict };
  results.C2 = { medians: med, otherChamber: otherCh, orphan };
  results.stops = stops;
  if (stops.length) throw new Error(`STOP (the script's controls, not a marked HALT): ${stops.join("; ")}`);

  // For the poster chat.
  say(`\n── for the poster chat`);
  const lines: string[] = [];
  for (const p of cur) lines.push(`${p.surname.toUpperCase()} · ${String(p.party)} · ${p.label}: ${fmtN(p.bills)} BILLS · ${fmtN(p.laws)} LAWS`);
  lines.push(`${STATE_NAME.toUpperCase()}: ${fmtN(curBills)} BILLS · ${fmtN(curLaws)} LAWS · ${pct2(curLaws, curBills)}%`);
  lines.push(`CONGRESS: ${fmtN(domeBills)} BILLS · ${fmtN(domeLaws)} LAWS · ${pct2(domeLaws, domeBills)}%`);
  for (const l of lines) say(`  ${l}`);
  say(`  AS OF ${chatAsOf(at)} (${when(at)})`);
  say(`  left this Congress: ${left.length ? left.map((p) => `${p.name} (${p.label}, ${String(p.party)}): ${fmtN(p.bills)} bills, ${fmtN(p.laws)} laws; ${STATE_NAME.toUpperCase()} with them: ${fmtN(allBills)} BILLS · ${fmtN(allLaws)} LAWS · ${pct2(allLaws, allBills)}%`).join("; ") : "none"}`);
  say(`  B3's laws: ${b3.length ? b3.map((r) => `${String(r.id)} · ${String(r.title)} · ${String(r.sponsor_name)}${leftBids.has(String(r.bid)) ? " (left this Congress)" : ""} · ${String(r.latest_action_date)}`).join(" | ") : "none"}`);
  say(`  ${verdict}`);
  const s = med.senate;
  const h = med.house;
  say(`  the median member with at least one bill in the dome (departed members included; the House's six delegates included; the bills median and the laws median taken separately): senate ${fmtMed(s?.all.bills ?? null)} bills · ${fmtMed(s?.all.laws ?? null)} laws; house ${fmtMed(h?.all.bills ?? null)} bills · ${fmtMed(h?.all.laws ?? null)} laws (current voting members only: senate ${fmtMed(s?.currentVoting.bills ?? null)} · ${fmtMed(s?.currentVoting.laws ?? null)}, house ${fmtMed(h?.currentVoting.bills ?? null)} · ${fmtMed(h?.currentVoting.laws ?? null)})`);
  if (missed.length) say(`  NOT COUNTED: ${missed.length} dome bill(s) whose own sponsor_state is ${STATE} but whose sponsor the members join doesn't place in ${STATE_NAME}: ${missed.map((r) => String(r.id)).join(", ")}`);
  results.chat = { lines, asOf: chatAsOf(at), holds, verdict };
}

async function main() {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    console.error("usage: npx tsx scripts/diagnostic/gradshow-colorado-811.ts [--label L]   (read-only; one mode)");
    process.exit(2);
  }
  mkdirSync(ART, { recursive: true });
  const base = path.join(ART, `run-${LABEL}`);
  if (existsSync(`${base}.log`) || existsSync(`${base}.json`)) {
    console.error(`label ${LABEL} is taken (${base}.log or .json exists); pick another with --label. Prod was not read.`);
    process.exit(2);
  }
  const start = new Date();
  say(`HO 811 · label ${LABEL} · start ${when(start)} · HEAD ${git(["rev-parse", "--short", "HEAD"])} (${git(["branch", "--show-current"])}) · node ${process.version} · congress ${CONGRESS} · ${STATE_NAME}`);
  let before = "";
  let failure: Error | null = null;
  try {
    step0Tree(); // before prod: a failed precondition never reads it
    before = await schemaPrint();
    say(`  prod's schema fingerprint before: ${before}`);
    await step0Prod();
    await freshness();
    await sectionA();
    await sectionBC();
  } catch (e) {
    failure = e as Error;
    say(`\n  ${failure.message}`);
  } finally {
    const end = new Date();
    say(`\n── safety`);
    if (before) {
      try {
        const after = await schemaPrint();
        say(`  prod's schema fingerprint: before ${before} · after ${after} · ${before === after ? "unchanged" : "CHANGED"}`);
        results.schema = { before, after, same: before === after };
      } catch (e) {
        say(`  the schema re-read failed: ${(e as Error).message}`);
      }
    } else say(`  prod was not read`);
    const expected = singles + batched + 2 * batches; // a batch's BEGIN and COMMIT steps carry the field too
    say(`  prod: ${singles} single statement(s) and ${batched} in ${batches} read-only batch(es) · ${tap.results} result(s) carried rows_read (${tap.results === expected ? "one per statement, and the batch's BEGIN and COMMIT" : `expected ${expected}`}) · rows_read ${fmtN(tap.rows)}`);
    say(`  end ${when(end)} · ${((end.getTime() - start.getTime()) / 1000).toFixed(1)}s · the log and JSON: ${base}.log, ${base}.json`);
    results.cost = { singles, batched, batches, results: tap.results, expected, rowsRead: tap.rows, start: start.toISOString(), end: end.toISOString() };
    results.failure = failure ? failure.message : null;
    const write = (what: string, fn: () => void) => {
      try {
        fn();
      } catch (e) {
        console.error(redactSecrets(`the ${what} write failed: ${(e as Error).message}`));
      }
    };
    write("log", () => writeFileSync(`${base}.log`, out.join("\n") + "\n"));
    write("JSON", () => writeFileSync(`${base}.json`, JSON.stringify(results, null, 2) + "\n"));
    write("ledger", () => {
      if (!existsSync(LEDGER)) writeFileSync(LEDGER, "label\tstart_utc\tend_utc\tstatements\tresults_with_rows_read\trows_read\tfailed\n");
      appendFileSync(LEDGER, `${LABEL}\t${start.toISOString()}\t${end.toISOString()}\t${singles + batched}\t${tap.results}\t${tap.rows}\t${failure ? "yes" : "no"}\n`);
    });
    db?.close();
  }
  if (failure) process.exitCode = 1;
}

main().catch((e) => {
  console.error(redactSecrets(String((e as Error).stack ?? e)));
  process.exitCode = 1;
});
