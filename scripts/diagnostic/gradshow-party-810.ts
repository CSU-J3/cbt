// HO 810: the GradShow poster's bills and laws by sponsor's party, in the dome's own scope and predicate (HO 799's A2),
// read from prod with each count's predicate and its as-of; the dome itself in the same read, beside its Nov 5 reading,
// with the laws observed since. Read-only. A sibling of gradshow-ceremonial-799.ts, which is untouched.
//
//   npx tsx scripts/diagnostic/gradshow-party-810.ts [--label L]
//
// One mode, in this order:
//   STEP 0  the tree at HEAD: the dome's predicate and statement compared byte for byte with the 799 script's (a
//           mismatch stops the run before prod is read); getCurrentCongress; sponsor_party's one writer, the value it
//           binds, what waits on update_date and what doesn't, and when an existing bill is upserted again (the
//           listings that queue it, runSync's callers, the cron's schedule); bills_agg's join; members.party's
//           normalization; the members probe B5 names, looked for; the Nov 5 reading's constants against its
//           artifact when that's on disk. Then prod's columns and the freshness.
//   A       one statement: every distinct sponsor_party in the dome's scope and predicate with its count, its SQLite
//           type, length and bytes beside; NULL and the empty string on their own lines; a COUNT control. Then
//           members.party's values (the premise, and what the poster chat maps against). HALT on a value other than R,
//           D or I, or on NULL plus empty over 0.5% of the rows, and nothing after members.party runs. Then, beside
//           A's code answer and each optional (a failed read is logged and the run goes on): the sponsors whose bills
//           carry two parties, with each party's dates and the member's partyHistory; sponsors whose bills' party
//           isn't members.party; and the column against raw_json's sponsors[0].party, the detail it was written from.
//   B + C   one read-only transaction (db.batch(…, "read"), as general-box-census-747.ts reads: BEGIN TRANSACTION
//           READONLY, one snapshot), so B and C share an as-of. C1 is the dome's own statement (the 799 script's
//           CUBE_SQL, copied verbatim, no Congress clause) cut to its A2 predicate; B1 party by stage with the Congress
//           clause, its own statement; B2 the House-start and Senate-start tables, two more; B3, B4 and C2's lists;
//           the controls: is_ceremonial's values (the 799 script's claim 3), a COUNT, the predicate by congress, C2 by
//           julianday(), the minute before the Nov 5 as-of, C2's first transitions to enacted, the laws that left
//           enacted, and every law-eligible law (any tag) for the 126's reconciliation.
//           HALTs, checked straight after B1 and B2 print, and nothing after them runs: B1's column totals against
//           C1's counts; B2's two tables against B1 cell for cell (inside one snapshot that's an identity, a check on
//           this script's aggregation); B2's tables against C1's cells by chamber (added: it can fire); and A's two
//           conditions on B1's own parties. A fourth is_ceremonial value stops the run too (the script's control).
//
// SAFETY. Prod is only READ: every statement goes through guard(), which refuses anything but SELECT or WITH … SELECT
// and any statement naming a write keyword, and B + C runs inside BEGIN TRANSACTION READONLY besides; prod's schema is
// fingerprinted before and after, as the 787 and 799 scripts do. rows_read is summed off each hrana pipeline response,
// a batch's step results included, and the total appended to docs/handoffs/810-artifacts/rows-ledger.tsv (repo-
// ignored, with the run's log and JSON; a label already used is refused before prod is read). TURSO_DATABASE_URL and
// TURSO_AUTH_TOKEN are read from .env by name; every printed line passes redactSecrets, whose seam repair turns a
// printed "&&" into "&", so no code line printed here carries one. Times print in Mountain Time on a 12-hour clock
// (MST or MDT as the day has it) with UTC beside.
import { config } from "dotenv";
import { createClient, type Client, type InArgs, type ResultSet, type Row } from "@libsql/client";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { getCurrentCongress } from "@/lib/congress";
import { ALLOWED_STAGES } from "@/lib/enums";
import { redactSecrets } from "@/lib/redact";

config({ path: ".env", quiet: true });

const ART = path.resolve("docs/handoffs/810-artifacts"); // repo-ignored
const LEDGER = path.join(ART, "rows-ledger.tsv");
const SIBLING = "scripts/diagnostic/gradshow-ceremonial-799.ts";
const MT = "America/Denver";
// The Congress: getCurrentCongress()'s, bound as an argument, never a literal.
const CONGRESS = getCurrentCongress();
// The dome's scope and predicate, HO 799's A2: that script's LAW and NONC, copied; STEP 0 compares each with its own.
const LAW = `bill_type IN ('hr','s','hjres','sjres')`;
const NONC = `(is_ceremonial = 0 OR is_ceremonial IS NULL)`;
const CONG = `congress = ?`;
const DOME = `${CONG} AND ${LAW} AND ${NONC}`;
const HOUSE = `bill_type IN ('hr','hjres')`;
const SENATE = `bill_type IN ('s','sjres')`;
const LATE = `stage IN ('floor','other_chamber','president','enacted')`;
const LAW_TYPES = ["hr", "s", "hjres", "sjres"];
const HOUSE_TYPES = ["hr", "hjres"];
const SENATE_TYPES = ["s", "sjres"];
// The 799 statement's calendar flag, for B3's floor rows.
const CAL = `COALESCE(latest_action_text LIKE '%placed on%' AND latest_action_text LIKE '%calendar%', 0)`;
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

// The dome as the handoff carries it: "as printed, read Nov 5, 2026, 12:37 PM MT (19:37Z)".
const PRINTED: Record<string, number> = { introduced: 105, committee: 15622, floor: 246, other_chamber: 565, president: 0, enacted: 126 };
const PRINTED_TOTALS = { total: 16664, ceremonial: 405, lawEligible: 17069 };
// HO 799's fourth reading, the one the handoff's time names (docs/probes/799-gradshow-ceremonial.md:319-353; the run's
// JSON, docs/handoffs/799-artifacts/run-803.json): the dome's stored stages, its cube read at 19:37:44.063Z. Its floor
// holds 48 calendar placements (:349); the handoff's floor and committee read as these with the 48 moved down to
// committee (294 - 48 = 246, 15,574 + 48 = 15,622).
const STORED_803: Record<string, number> = { introduced: 105, committee: 15574, floor: 294, other_chamber: 565, president: 0, enacted: 126, other: 0, NULL: 0 };
const STORED_803_TOTALS = { total: 16664, floorCal: 48, ceremonial: 405, lawEligible: 17069, lawEnactedAnyTag: 139, enacted: 126 };
const AT_803 = "2026-11-05T19:37:44.063Z";
const MINUTE_803 = "2026-11-05T19:37:00.000Z"; // the handoff's 19:37Z, to the minute
const DAY_803 = "2026-11-05"; // a law whose latest action is dated after this day can't be one of Nov 5's
// The 13 law-eligible laws tagged ceremonial at that reading (run-803.json B.rows, id-sorted), for the 126's
// reconciliation; STEP 0 compares them, and AT_803, with the artifact when it's on disk.
const HOLLOW_803 = ["119-hr-2170", "119-hr-2196", "119-hr-3377", "119-hr-3497", "119-hr-452", "119-hr-7194", "119-hr-7211", "119-s-1596", "119-s-2283", "119-s-3705", "119-s-4138", "119-s-790", "119-s-858"];
const RUN_803 = "docs/handoffs/799-artifacts/run-803.json";
const PARTY_ORDER = ["R", "D", "I"];
const PARTY_NAME: Record<string, string> = { R: "REPUBLICANS", D: "DEMOCRATS", I: "INDEPENDENTS" };

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

// ── prod, read-only, with the rows_read tap ─────────────────────────────────
// A single statement's pipeline result carries result.rows_read; a batch's carries result.step_results[], one per step
// (BEGIN, the statements, COMMIT, and a ROLLBACK step that runs only on failure).
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
// One read-only transaction: @libsql/client's "read" mode sends BEGIN TRANSACTION READONLY, the statements and COMMIT
// in one pipeline request, so every statement reads the same snapshot.
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
// The dome's tag test, strict: SQL's is_ceremonial = 0 is false for TEXT '' (TEXT sorts above every number), so JS
// doesn't coerce either.
const inDome = (v: unknown) => v === null || v === 0;
const tagOf = (v: unknown, awaiting: unknown) => (v === null ? (num(awaiting) === 1 ? "untagged, awaiting the summarizer" : "untagged, summarized") : v === 0 ? "tagged 0" : v === 1 ? "tagged 1, ceremonial" : `tag ${JSON.stringify(v)}`);

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
// git grep exits 1 when nothing matches; anything else is an error and is thrown.
function gitGrep(args: string[]): string[] {
  try {
    return git(["grep", ...args]).split("\n").filter(Boolean).map((l) => l.slice(0, 200));
  } catch (e) {
    if ((e as { status?: number }).status === 1) return [];
    throw e;
  }
}

// ── STEP 0 ──────────────────────────────────────────────────────────────────
function step0Tree() {
  say(`\n── STEP 0, the tree (anchors re-derived at HEAD ${git(["rev-parse", "--short", "HEAD"])})`);
  // The reuse, byte for byte. The 799 script is checked out CRLF; a template literal's value has LF, so the file's
  // CRLF is normalized before the compare, as the compiler does.
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
  results.reuse = { differ, ours: Object.fromEntries(Object.keys(ours).map((k) => [k, h16(ours[k] ?? null)])), theirs: Object.fromEntries(Object.keys(theirs).map((k) => [k, h16(theirs[k] ?? null)])) };
  if (differ.length) throw new Error(`cannot run (a precondition, not one of the marked HALTs): ${differ.join(", ")} differ from ${SIBLING}`);

  show("getCurrentCongress", "lib/congress.ts", /^export function getCurrentCongress|return Math\.floor\(\(congressStartYear - 2025\) \/ 2\) \+ 119;/);
  say(`  getCurrentCongress() → ${CONGRESS}: bound as congress = ? in every statement below but C1, the 799 statement, which has no Congress clause`);

  // A: where sponsor_party comes from, and when it's written.
  show("A · UPSERT_SQL: the column at insert, and again on every conflict", "lib/sync.ts", /^const UPSERT_SQL = `$|^INSERT INTO bills \($|^  sponsor_name, sponsor_party, sponsor_state, sponsor_bioguide_id,$|^ON CONFLICT\(id\) DO UPDATE SET$|^  sponsor_party = excluded\.sponsor_party,$/);
  show("A · the value bound: the detail's first sponsor's party, as given (no mapping, no COALESCE)", "lib/sync.ts", /^  const sponsor = detail\.sponsors\?\.\[0\];$|^      sponsor\?\.party \?\? null,$|^    sql: UPSERT_SQL,$/);
  show("A · what waits on update_date moving (the stamps; substantive, which drives the seven summary-reset columns; stageAdvanced, which drives the stage trio): sponsor_party doesn't", "lib/sync.ts", /^  changed_at = CASE WHEN excluded\.update_date != bills\.update_date|^  committee_walk_failures = CASE WHEN excluded\.update_date != bills\.update_date|^  const substantive = byAction \|\| byText \|\| crsMoved;$|^  const stageObservedAt = stageAdvanced \? /);
  show("A · when an existing bill is upserted again: only from sync_queue, which the listings fill (the frontier listing every tick; the wide listing, 48 hours behind it, once a UTC day)", "lib/sync.ts", /^const WIDE_WINDOW_MS = |^async function enqueue\(|^async function walkList\(|^    stats\.listComplete = await walkList\(|^      const wideFrom = isoSeconds\(|^\s+const result = await upsertBill\(db, detail\);$|^\s+await db\.execute\(\{ sql: "DELETE FROM sync_queue WHERE bill_id = \? AND source = \?"/);
  const callers = gitGrep(["-n", "-E", "runSync\\(\\{", "--", "app", "scripts", "lib"]);
  say(`  A · runSync's callers (git grep -E "runSync\\(\\{"): ${callers.length} hit(s)`);
  for (const c of callers) say(`    ${c}`);
  let cron = "unread";
  try {
    const v = JSON.parse(readFileSync("vercel.json", "utf8")) as { crons?: Array<{ path?: string; schedule?: string }> };
    cron = v.crons?.find((c) => c.path === "/api/sync")?.schedule ?? "absent";
  } catch (e) {
    cron = `unread: ${(e as Error).message}`;
  }
  say(`  A · vercel.json's /api/sync schedule: ${cron}`);
  const pattern = "sponsor_party[[:space:]]*=|INTO bills[[:space:](]|INTO bills$";
  const writers = gitGrep(["-n", "-E", pattern, "--", "lib", "app", "scripts", "components", ":!scripts/diagnostic"]);
  say(`  A · statements that write bills.sponsor_party, or insert into bills, outside scripts/diagnostic (git grep -E "${pattern}"): ${writers.length} hit(s)`);
  for (const w of writers) say(`    ${w}`);
  results.writers = { writers, callers, cron };
  show("A · bills_agg's CTE and its join", "lib/queries.ts", /^function billsAggCte\(|WHERE sponsor_bioguide_id IS NOT NULL\$\{ceremonial\}|LEFT JOIN bills_agg b ON b\.sponsor_bioguide_id = m\.bioguide_id/);
  show("A · members.party: the member's latest party, normalized", "scripts/sync-members.ts", /^function normalizeParty\($|^function pickCurrentParty\(|const partyRaw = pickCurrentParty\(member\.partyHistory\);|^\s+normalizeParty\(partyRaw\),$|^\s+party = excluded\.party,$/);

  // B5: the members probe's findings file, if it's in docs/probes/.
  const dir = "docs/probes";
  const files = readdirSync(dir).filter((f) => f.endsWith(".md")).sort();
  const named = files.filter((f) => /member/i.test(f));
  const a3: string[] = [];
  for (const f of files) a3.push(...grepFile(`${dir}/${f}`, /\bA\.?3\b/).slice(0, 3));
  say(`  B5 · docs/probes/ holds ${files.length} findings files: ${files.join(", ")}`);
  say(`  B5 · a file named for members: ${named.length ? named.join(", ") : "none"}; lines naming A3 or A.3 (three a file at most): ${a3.length || "none"}`);
  for (const h of a3) say(`    ${h}`);
  results.b5 = { files, named, a3 };

  // The Nov 5 reading's constants against its artifact.
  if (existsSync(RUN_803)) {
    const j = JSON.parse(readFileSync(RUN_803, "utf8")) as { A?: { cubeAt?: unknown }; A2?: { byStage?: Record<string, unknown>; calByStage?: Record<string, unknown>; total?: unknown }; B?: { rows?: Array<{ id?: unknown }>; enactedAll?: unknown } };
    const ids = (j.B?.rows ?? []).map((r) => String(r.id)).sort();
    const checks: Array<[string, boolean]> = [
      ["the cube's as-of", String(j.A?.cubeAt) === AT_803],
      ["the 13 hollow laws", ids.join(",") === HOLLOW_803.join(",")],
      ["A2's stages", Object.entries(STORED_803).every(([k, v]) => k === "other" || k === "NULL" || num(j.A2?.byStage?.[k]) === v)],
      ["A2's total", num(j.A2?.total) === STORED_803_TOTALS.total],
      ["A2's calendar rows at floor", num(j.A2?.calByStage?.floor) === STORED_803_TOTALS.floorCal],
      ["the law-eligible laws, any tag", num(j.B?.enactedAll) === STORED_803_TOTALS.lawEnactedAnyTag],
    ];
    const bad = checks.filter(([, ok]) => !ok).map(([k]) => k);
    say(`  the Nov 5 reading's artifact (${RUN_803}): ${bad.length ? `DIFFERS on ${bad.join(", ")}` : `cube as of ${AT_803}; the stored stages, the total, the 48 calendar rows at floor, the 139 laws and the 13 hollow laws all equal the copied constants`}`);
    results.run803 = { checks: Object.fromEntries(checks) };
    if (bad.length) throw new Error(`cannot run (a precondition, not one of the marked HALTs): ${RUN_803} differs from the copied constants on ${bad.join(", ")}`);
  } else {
    say(`  ${RUN_803} is not on disk (repo-ignored): AT_803, STORED_803 and HOLLOW_803 stand as copied`);
    results.run803 = { absent: true };
  }
}

async function step0Prod() {
  say(`\n── STEP 0, prod`);
  const cols = async (t: string) => (await q(`${t}' columns`, `SELECT name FROM pragma_table_info('${t}') ORDER BY cid`)).rows.map((r) => String(r.name));
  const have: Record<string, string[]> = { bills: await cols("bills"), members: await cols("members"), stage_transitions: await cols("stage_transitions") };
  const need: Record<string, string[]> = {
    bills: ["id", "congress", "bill_type", "stage", "is_ceremonial", "summary", "sponsor_party", "sponsor_name", "sponsor_bioguide_id", "stage_observed_at", "previous_stage", "introduced_date", "latest_action_date", "latest_action_text", "update_date", "summary_updated_at", "changed_at", "raw_json"],
    members: ["bioguide_id", "name", "party", "is_current", "raw_json"],
    stage_transitions: ["bill_id", "to_stage", "observed_at"],
  };
  const missing = Object.entries(need).flatMap(([t, cs]) => cs.filter((c) => !(have[t] ?? []).includes(c)).map((c) => `${t}.${c}`));
  say(`  ${Object.entries(have).map(([t, cs]) => `${t}: ${cs.length} columns`).join(" · ")} · ${missing.length ? `MISSING ${missing.join(", ")}` : "every column the reads name is present"}`);
  results.columns = have;
  if (missing.length) throw new Error(`cannot run (a precondition, not one of the marked HALTs): ${missing.join(", ")}`);
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
}

// ── A: the party field ──────────────────────────────────────────────────────
const isRDI = (t: unknown, v: unknown) => t === "text" && (v === "R" || v === "D" || v === "I");
async function sectionA() {
  say(`\n── A, the party field`);
  const sql = `SELECT sponsor_party AS v, typeof(sponsor_party) AS t, length(sponsor_party) AS len, hex(sponsor_party) AS hx, COUNT(*) AS n
  FROM bills
 WHERE ${DOME}
 GROUP BY 1, 2
 ORDER BY n DESC, v`;
  let vals: Record<string, unknown>[] = [];
  let ctl = 0;
  let total = 0;
  for (const read of [1, 2]) {
    vals = objs(await q(`A · read ${read}: every distinct sponsor_party in the dome's scope and predicate`, sql, [CONGRESS]));
    ctl = num((await q(`A · read ${read}, control: the same scope's rows, one COUNT`, `SELECT COUNT(*) AS n FROM bills WHERE ${DOME}`, [CONGRESS])).rows[0]?.n);
    total = vals.reduce((a, r) => a + num(r.n), 0);
    if (total === ctl) break;
    say(`  read ${read}: the values sum to ${fmtN(total)} against the control's ${fmtN(ctl)}; a sync can land between statements, so ${read === 1 ? "both are re-read once" : "the run stops"}`);
  }
  if (total !== ctl) throw new Error(`STOP (the script's control, not a marked HALT): A's values sum to ${fmtN(total)}, the control reads ${fmtN(ctl)}, twice`);
  const nul = vals.filter((r) => r.t === "null").reduce((a, r) => a + num(r.n), 0);
  const empty = vals.filter((r) => r.t === "text" && r.v === "").reduce((a, r) => a + num(r.n), 0);
  const others = vals.filter((r) => r.t !== "null" && !(r.t === "text" && r.v === "") && !isRDI(r.t, r.v));
  say(`  predicate: ${DOME} (congress ${CONGRESS})`);
  for (const r of vals.filter((x) => x.t !== "null" && !(x.t === "text" && x.v === ""))) {
    say(`    ${JSON.stringify(r.v)} · ${fmtN(num(r.n))} (${String(r.t)}, length ${String(r.len)}, bytes ${String(r.hx)})${isRDI(r.t, r.v) ? "" : " · NOT R, D OR I"}`);
  }
  say(`    NULL · ${fmtN(nul)}`);
  say(`    '' (the empty string) · ${fmtN(empty)}`);
  const share = total > 0 ? ((nul + empty) / total) * 100 : 0;
  say(`    sum ${fmtN(total)}, equal to the control's ${fmtN(ctl)}; NULL plus empty ${fmtN(nul + empty)} of ${fmtN(total)} = ${share.toFixed(3)}% (the HALT's bound is 0.5%)`);
  const halts: string[] = [];
  if (others.length) halts.push(`a value other than R, D or I: ${others.map((r) => `${JSON.stringify(r.v)} (${String(r.t)}, bytes ${String(r.hx)}) ${fmtN(num(r.n))}`).join(", ")}`);
  if (share > 0.5) halts.push(`NULL plus empty is ${fmtN(nul + empty)} of ${fmtN(total)} rows, ${share.toFixed(3)}%, over 0.5%`);
  results.A = { predicate: DOME, congress: CONGRESS, values: vals, nul, empty, total, control: ctl, sharePct: share, others: others.length, halts };

  // The premise "members.party is normalized to R, D and I", read; on a HALT it's what the poster chat maps against.
  const mp = objs(await q("members.party's values, by is_current", `SELECT party AS v, typeof(party) AS t, is_current, COUNT(*) AS n FROM members GROUP BY 1, 2, 3 ORDER BY 3 DESC, 4 DESC`));
  say(`  members.party: ${mp.map((r) => `${r.v === null ? "NULL" : JSON.stringify(r.v)} (is_current ${String(r.is_current)}) ${fmtN(num(r.n))}`).join(" · ")}`);
  results.membersParty = mp;
  if (halts.length) throw new Error(`HALT (A): ${halts.join("; ")}. The values are above; nothing below runs, and the poster chat decides how to map them.`);
  say(`  no HALT: R, D and I only, and NULL plus empty ${share.toFixed(3)}%`);
}

// Beside A's answer from the code: what the rows themselves say. Evidence for a finding, not one of A's counts, and
// optional: a failed read is logged and the run goes on to B and C.
async function optional(label: string, fn: () => Promise<void>) {
  try {
    await fn();
  } catch (e) {
    say(`    ${label}: the read failed (${(e as Error).message}); optional, so the run goes on`);
    ((results.AevidenceFailed ??= []) as string[]).push(`${label}: ${(e as Error).message}`);
  }
}
async function sectionAEvidence() {
  say(`\n── A, beside the code: what the rows say`);
  const ev: Record<string, unknown> = {};
  results.Aevidence = ev;
  const MULTI = `SELECT sponsor_bioguide_id FROM bills WHERE ${DOME} GROUP BY 1 HAVING COUNT(DISTINCT sponsor_party) > 1`;
  await optional("sponsors with two parties", async () => {
    const rows = objs(await q("A · sponsors whose bills in the dome carry more than one sponsor_party: each party's bills, their dates, and the newest write", `SELECT sponsor_bioguide_id AS bid, sponsor_party AS party, COUNT(*) AS n, MIN(introduced_date) AS first_intro, MAX(introduced_date) AS last_intro, MAX(update_date) AS last_update, MAX(changed_at) AS last_changed, MAX(sponsor_name) AS name FROM bills WHERE ${DOME} AND sponsor_bioguide_id IN (${MULTI}) GROUP BY 1, 2 ORDER BY 1, 4`, [CONGRESS, CONGRESS]));
    const hist = objs(await q("A · those members' partyHistory (members.raw_json, the Congress.gov member record sync-members stores)", `SELECT bioguide_id AS bid, name, party, CASE WHEN json_valid(raw_json) THEN json_extract(raw_json, '$.partyHistory') END AS history FROM members WHERE bioguide_id IN (${MULTI}) ORDER BY 1`, [CONGRESS]));
    if (!rows.length) say(`    none: every sponsor's bills in the dome carry one sponsor_party`);
    for (const r of rows) say(`    ${String(r.bid)} · sponsor_party ${String(r.party)} · ${fmtN(num(r.n))} bills · introduced ${String(r.first_intro)} to ${String(r.last_intro)} · newest update_date ${when(r.last_update)} · newest changed_at ${when(r.last_changed)} · ${String(r.name)}`);
    for (const h of hist) say(`    ${String(h.bid)} ${String(h.name)} · members.party ${String(h.party)} · partyHistory ${String(h.history)}`);
    ev.multi = rows;
    ev.history = hist;
  });
  await optional("sponsors against members.party", async () => {
    const differ = objs(await q("A · sponsors whose bills' sponsor_party isn't their members.party, any stage (the join bills_agg uses)", `WITH s AS (SELECT sponsor_bioguide_id, sponsor_party, COUNT(*) AS n FROM bills WHERE ${DOME} GROUP BY 1, 2) SELECT s.sponsor_bioguide_id AS bid, s.sponsor_party AS party, s.n AS n, m.bioguide_id AS member_id, m.name AS member_name, m.party AS member_party, m.is_current AS is_current FROM s LEFT JOIN members m ON s.sponsor_bioguide_id = m.bioguide_id WHERE m.party IS NOT s.sponsor_party ORDER BY s.n DESC, 1`, [CONGRESS]));
    const noRow = differ.filter((r) => r.member_id === null);
    const realDiff = differ.filter((r) => r.member_id !== null);
    say(`    a members row whose party differs: ${realDiff.length ? realDiff.map((r) => `${String(r.bid)} ${String(r.member_name)}: bills ${String(r.party)} ×${fmtN(num(r.n))}, members ${String(r.member_party)} (is_current ${String(r.is_current)})`).join(" · ") : "none"}`);
    say(`    no members row for the sponsor: ${noRow.length ? noRow.map((r) => `${String(r.bid)} (${String(r.party)}) ×${fmtN(num(r.n))}`).join(" · ") : "none"}`);
    ev.differ = realDiff;
    ev.noMembersRow = noRow;
  });
  await optional("the column against raw_json", async () => {
    const raw = objs(await q("A · the column against the detail it was written from (raw_json's $.sponsors[0].party)", `SELECT COUNT(*) AS n, SUM(CASE WHEN json_valid(raw_json) THEN (CASE WHEN sponsor_party IS json_extract(raw_json, '$.sponsors[0].party') THEN 1 ELSE 0 END) ELSE 0 END) AS same, SUM(CASE WHEN json_valid(raw_json) THEN 0 ELSE 1 END) AS invalid FROM bills WHERE ${DOME}`, [CONGRESS]))[0];
    say(`    sponsor_party equals raw_json's $.sponsors[0].party on ${fmtN(num(raw?.same))} of ${fmtN(num(raw?.n))} rows; raw_json invalid or NULL on ${fmtN(num(raw?.invalid))}`);
    ev.raw = raw;
  });
}

// ── B and C: one read ───────────────────────────────────────────────────────
type Grid = Map<string, Map<string, number>>; // party → stage → n
const pkey = (v: unknown) => (v == null ? "NULL" : String(v) === "" ? "''" : String(v));
const skey = (v: unknown) => (v == null ? "NULL" : String(v));
const sumMap = (m: Map<string, number> | undefined) => [...(m ?? new Map<string, number>()).values()].reduce((a, n) => a + n, 0);
function grid(rs: ResultSet): Grid {
  const g: Grid = new Map();
  for (const r of rs.rows) {
    const p = pkey(r.party);
    const s = skey(r.stage);
    const row = g.get(p) ?? new Map<string, number>();
    row.set(s, (row.get(s) ?? 0) + num(r.n));
    g.set(p, row);
  }
  return g;
}
const LADDER = [...ALLOWED_STAGES] as string[];
// The ladder, then other and NULL, then any other stored value, so nothing a statement returns falls out of a table.
function stageCols(...ms: Array<Map<string, number>>): string[] {
  const seen = new Set<string>();
  for (const m of ms) for (const k of m.keys()) seen.add(k);
  const odd = [...seen].filter((s) => !LADDER.includes(s) && s !== "other" && s !== "NULL").sort();
  return [...LADDER, "other", "NULL", ...odd];
}
function partiesOf(...gs: Grid[]): string[] {
  const seen = new Set<string>(PARTY_ORDER);
  for (const g of gs) for (const k of g.keys()) seen.add(k);
  return [...PARTY_ORDER, ...[...seen].filter((p) => !PARTY_ORDER.includes(p)).sort()];
}
function table(title: string, predicate: string, g: Grid, cols: string[], parties: string[]) {
  say(`\n  ${title}`);
  say(`    predicate: ${predicate} (congress ${CONGRESS})`);
  const wid = (c: string) => Math.max(8, c.length + 1);
  say(`    ${"party".padEnd(8)}${cols.map((c) => c.padStart(wid(c))).join("")}${"total".padStart(9)}${"enacted share".padStart(15)}`);
  const colTotals: Record<string, number> = {};
  const rows: Record<string, { byStage: Record<string, number>; total: number; enacted: number; share: string }> = {};
  for (const p of parties) {
    const row = g.get(p) ?? new Map<string, number>();
    const total = sumMap(row);
    const enacted = row.get("enacted") ?? 0;
    const byStage = Object.fromEntries(cols.map((c) => [c, row.get(c) ?? 0]));
    for (const c of cols) colTotals[c] = (colTotals[c] ?? 0) + (row.get(c) ?? 0);
    rows[p] = { byStage, total, enacted, share: pct2(enacted, total) };
    say(`    ${p.padEnd(8)}${cols.map((c) => fmtN(row.get(c) ?? 0).padStart(wid(c))).join("")}${fmtN(total).padStart(9)}${`${pct2(enacted, total)}%`.padStart(15)}`);
  }
  const all = Object.values(colTotals).reduce((a, n) => a + n, 0);
  say(`    ${"total".padEnd(8)}${cols.map((c) => fmtN(colTotals[c] ?? 0).padStart(wid(c))).join("")}${fmtN(all).padStart(9)}${`${pct2(colTotals.enacted ?? 0, all)}%`.padStart(15)}`);
  return { predicate, rows, colTotals, total: all };
}

type Cell = { billType: string; stage: string | null; cer: unknown; gated: boolean; cal: boolean; n: number; maxUpd: string | null; maxSum: string | null };
async function sectionBC() {
  say(`\n── B and C, one read`);
  const list: Stmt[] = [
    { label: "the database's clock inside the transaction", sql: `SELECT strftime('%Y-%m-%dT%H:%M:%fZ', 'now') AS db_now`, args: [] },
    { label: "C1 · the dome's own statement: the 799 script's CUBE_SQL, verbatim (no Congress clause)", sql: CUBE_SQL, args: [] },
    { label: "B1 · party by stage in the dome's scope and predicate", sql: `SELECT sponsor_party AS party, stage, COUNT(*) AS n FROM bills WHERE ${DOME} GROUP BY 1, 2`, args: [CONGRESS] },
    { label: "B2 · the same, bills that started in the House", sql: `SELECT sponsor_party AS party, stage, COUNT(*) AS n FROM bills WHERE ${DOME} AND ${HOUSE} GROUP BY 1, 2`, args: [CONGRESS] },
    { label: "B2 · the same, bills that started in the Senate", sql: `SELECT sponsor_party AS party, stage, COUNT(*) AS n FROM bills WHERE ${DOME} AND ${SENATE} GROUP BY 1, 2`, args: [CONGRESS] },
    { label: "control · is_ceremonial's values in the law-eligible rows (the 799 script's claim 3; a fourth value stops the run)", sql: `SELECT typeof(is_ceremonial) AS t, is_ceremonial AS v, COUNT(*) AS n FROM bills WHERE ${LAW} GROUP BY 1, 2 ORDER BY 1, 2`, args: [] },
    { label: "control · the dome's scope and predicate, one COUNT", sql: `SELECT COUNT(*) AS n FROM bills WHERE ${DOME}`, args: [CONGRESS] },
    { label: "control · the Congress clause or none: the dome's predicate by congress", sql: `SELECT congress, COUNT(*) AS n FROM bills WHERE ${LAW} AND ${NONC} GROUP BY 1 ORDER BY 1`, args: [] },
    { label: "B3 · bills an independent sponsored, at floor or later", sql: `SELECT id, sponsor_name, sponsor_bioguide_id, sponsor_state, stage, latest_action_date, ${CAL} AS cal FROM bills WHERE ${DOME} AND sponsor_party = 'I' AND ${LATE} ORDER BY id`, args: [CONGRESS] },
    { label: "B4 · the dome's laws, joined to members as bills_agg joins them (sponsor_bioguide_id = members.bioguide_id)", sql: `WITH enacted AS (SELECT id, sponsor_name, sponsor_bioguide_id, sponsor_party FROM bills WHERE ${DOME} AND stage = 'enacted') SELECT e.id AS id, e.sponsor_name AS sponsor_name, e.sponsor_bioguide_id AS bid, e.sponsor_party AS party, m.bioguide_id AS member_id, m.name AS member_name, m.party AS member_party, m.is_current AS is_current FROM enacted e LEFT JOIN members m ON e.sponsor_bioguide_id = m.bioguide_id ORDER BY e.id`, args: [CONGRESS] },
    { label: "C2 · the dome's laws observed after the Nov 5 reading's as-of", sql: `SELECT id, sponsor_name, sponsor_party, latest_action_date, stage_observed_at, previous_stage, is_ceremonial, (summary IS NULL) AS awaiting, latest_action_text FROM bills WHERE ${DOME} AND stage = 'enacted' AND stage_observed_at > ? ORDER BY stage_observed_at, id`, args: [CONGRESS, AT_803] },
    { label: "C2 · control: the same count by julianday()", sql: `SELECT COUNT(*) AS n FROM bills WHERE ${DOME} AND stage = 'enacted' AND julianday(stage_observed_at) > julianday(?)`, args: [CONGRESS, AT_803] },
    { label: "C2 · control: the dome's laws observed inside the handoff's minute, before the reading's as-of", sql: `SELECT id, stage_observed_at FROM bills WHERE ${DOME} AND stage = 'enacted' AND stage_observed_at > ? AND stage_observed_at <= ? ORDER BY id`, args: [CONGRESS, MINUTE_803, AT_803] },
    { label: "C2 · control: each listed law's first transition to enacted (stage_transitions)", sql: `SELECT bill_id, MIN(observed_at) AS first_enacted, COUNT(*) AS n FROM stage_transitions WHERE to_stage = 'enacted' AND bill_id IN (SELECT id FROM bills WHERE ${DOME} AND stage = 'enacted' AND stage_observed_at > ?) GROUP BY 1 ORDER BY 1`, args: [CONGRESS, AT_803] },
    { label: "C2 · control: law-eligible bills that left enacted (previous_stage = 'enacted')", sql: `SELECT id, stage, previous_stage, stage_observed_at, is_ceremonial FROM bills WHERE ${CONG} AND ${LAW} AND previous_stage = 'enacted' AND (stage IS NULL OR stage != 'enacted') ORDER BY id`, args: [CONGRESS] },
    { label: "C2 · the reconciliation: every law-eligible law, any tag", sql: `SELECT id, is_ceremonial, (summary IS NULL) AS awaiting, sponsor_party, stage_observed_at, latest_action_date FROM bills WHERE ${CONG} AND ${LAW} AND stage = 'enacted' ORDER BY id`, args: [CONGRESS] },
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

  // is_ceremonial's values first: the dome's predicate means what it says only over 0, 1 and NULL.
  const tags = objs(need(5));
  const fourth = tags.filter((r) => !(r.t === "null" || (r.t === "integer" && (r.v === 0 || r.v === 1))));
  say(`  is_ceremonial in the law-eligible rows: ${tags.map((r) => `${String(r.t)} ${r.v === null ? "NULL" : JSON.stringify(r.v)} · ${fmtN(num(r.n))}`).join(" · ")}${fourth.length ? " · A FOURTH VALUE" : " · 1, 0 and NULL only"}`);
  results.tags = tags;
  if (fourth.length) throw new Error(`STOP (the script's control, the 799 script's claim 3, not a marked HALT): is_ceremonial carries ${fourth.map((r) => `${String(r.t)} ${JSON.stringify(r.v)} (${fmtN(num(r.n))})`).join(", ")}`);

  // C1, off the dome's own statement.
  const cells: Cell[] = need(1).rows.map((r) => ({
    billType: String(r.bill_type), stage: str(r.stage), cer: r.is_ceremonial ?? null, gated: num(r.gated) === 1,
    cal: num(r.cal) === 1, n: num(r.n), maxUpd: str(r.max_upd), maxSum: str(r.max_sum),
  }));
  const isLaw = (c: Cell) => LAW_TYPES.includes(c.billType);
  const dome = cells.filter((c) => isLaw(c) && inDome(c.cer));
  const byStage = (cs: Cell[]) => {
    const m = new Map<string, number>();
    for (const c of cs) m.set(skey(c.stage), (m.get(skey(c.stage)) ?? 0) + c.n);
    return m;
  };
  const c1 = byStage(dome);
  const c1House = byStage(dome.filter((c) => HOUSE_TYPES.includes(c.billType)));
  const c1Senate = byStage(dome.filter((c) => SENATE_TYPES.includes(c.billType)));
  const floorCal = dome.filter((c) => c.stage === "floor" && c.cal).reduce((a, c) => a + c.n, 0);
  const cerNow = cells.filter((c) => isLaw(c) && c.cer === 1).reduce((a, c) => a + c.n, 0);
  const lawNow = cells.filter(isLaw).reduce((a, c) => a + c.n, 0);
  const untagged = dome.filter((c) => c.cer === null);
  const untaggedGated = untagged.filter((c) => c.gated).reduce((a, c) => a + c.n, 0);
  const untaggedAwaiting = untagged.filter((c) => !c.gated).reduce((a, c) => a + c.n, 0);
  const c1Total = sumMap(c1);
  const maxOf = (vals: Array<string | null>) => vals.filter((v): v is string => !!v).sort().at(-1) ?? null;

  // B1 and B2, each its own statement.
  const b1 = grid(need(2));
  const bh = grid(need(3));
  const bs = grid(need(4));
  const b1Stages = new Map<string, number>();
  for (const row of b1.values()) for (const [s, n] of row) b1Stages.set(s, (b1Stages.get(s) ?? 0) + n);
  const cols = stageCols(c1, b1Stages, ...[...bh.values()], ...[...bs.values()]);
  const parties = partiesOf(b1, bh, bs);
  const B1 = table("B1 · party by stage, the dome's scope and predicate", DOME, b1, cols, parties);
  const B2h = table("B2 · bills that started in the House (hr, hjres)", `${DOME} AND ${HOUSE}`, bh, cols, parties);
  const B2s = table("B2 · bills that started in the Senate (s, sjres)", `${DOME} AND ${SENATE}`, bs, cols, parties);

  // The HALTs, straight after the tables they judge; nothing after them runs on a hit.
  say(`\n  the HALT checks`);
  const halts: string[] = [];
  const c1Row = cols.map((c) => `${c} ${fmtN(c1.get(c) ?? 0)}`).join(" · ");
  const colDiff = cols.filter((c) => (B1.colTotals[c] ?? 0) !== (c1.get(c) ?? 0));
  say(`    C1, the dome's own statement, by stage: ${c1Row} · total ${fmtN(c1Total)}`);
  say(`    1 · B1's column totals ${colDiff.length ? `DIFFER from C1's on ${colDiff.join(", ")}` : `equal C1's in every column, ${fmtN(B1.total)} in all`}`);
  if (colDiff.length) halts.push(`B1's column totals differ from C1's on ${colDiff.map((c) => `${c} (B1 ${fmtN(B1.colTotals[c] ?? 0)}, C1 ${fmtN(c1.get(c) ?? 0)})`).join(", ")}`);
  const cellDiff: string[] = [];
  for (const p of parties) for (const c of cols) {
    const h = bh.get(p)?.get(c) ?? 0;
    const s = bs.get(p)?.get(c) ?? 0;
    const b = b1.get(p)?.get(c) ?? 0;
    if (h + s !== b) cellDiff.push(`${p} ${c}: ${fmtN(h)} + ${fmtN(s)} against ${fmtN(b)}`);
  }
  say(`    2 · B2's House and Senate tables ${cellDiff.length ? `DON'T sum to B1 in ${cellDiff.length} cell(s): ${cellDiff.join("; ")}` : `sum to B1 in every cell (${parties.length} parties × ${cols.length} stages), ${fmtN(B2h.total)} + ${fmtN(B2s.total)} = ${fmtN(B1.total)}`} (one snapshot, and the two predicates split the four types, so this checks the script's own aggregation)`);
  if (cellDiff.length) halts.push(`B2's two tables don't sum to B1: ${cellDiff.join("; ")}`);
  const chamberDiff: string[] = [];
  for (const [name, t, cm] of [["House", B2h, c1House], ["Senate", B2s, c1Senate]] as const) {
    for (const c of cols) if ((t.colTotals[c] ?? 0) !== (cm.get(c) ?? 0)) chamberDiff.push(`${name} ${c}: B2 ${fmtN(t.colTotals[c] ?? 0)}, C1 ${fmtN(cm.get(c) ?? 0)}`);
  }
  say(`    3 · B2's tables against C1's cells by chamber (C1's hr and hjres cells, its s and sjres cells): ${chamberDiff.length ? `DIFFER: ${chamberDiff.join("; ")}` : "equal in every column"}`);
  if (chamberDiff.length) halts.push(`B2's tables differ from C1's cells by chamber: ${chamberDiff.join("; ")}`);
  const odd = parties.filter((p) => !PARTY_ORDER.includes(p) && p !== "NULL" && p !== "''" && (B1.rows[p]?.total ?? 0) > 0);
  const blank = (B1.rows.NULL?.total ?? 0) + (B1.rows["''"]?.total ?? 0);
  const blankPct = B1.total > 0 ? (blank / B1.total) * 100 : 0;
  say(`    4 · A's two conditions on B1's own parties: ${odd.length ? `a value other than R, D or I: ${odd.join(", ")}` : "R, D and I only"}; NULL plus empty ${fmtN(blank)}, ${blankPct.toFixed(3)}%`);
  if (odd.length) halts.push(`A's condition on B1's read: a value other than R, D or I: ${odd.join(", ")}`);
  if (blankPct > 0.5) halts.push(`A's condition on B1's read: NULL plus empty is ${blankPct.toFixed(3)}%, over 0.5%`);
  results.B1 = B1;
  results.B2 = { house: B2h, senate: B2s };
  results.BChalts = halts;
  if (halts.length) throw new Error(`HALT (B): ${halts.join("; ")}. B1, B2 and C1's line are above; nothing below runs.`);
  say(`    no HALT`);

  // The controls on the scope.
  const ctl = num(need(6).rows[0]?.n);
  const byCong = objs(need(7));
  const noClause = byCong.reduce((a, r) => a + num(r.n), 0);
  const inCong = byCong.filter((r) => num(r.congress) === CONGRESS).reduce((a, r) => a + num(r.n), 0);
  say(`    control: one COUNT over the dome's scope and predicate reads ${fmtN(ctl)} (${ctl === B1.total ? "equal to B1" : "NOT EQUAL to B1"}; the same snapshot and predicate, so an identity)`);
  say(`    control: the dome's predicate by congress, ${byCong.map((r) => `${String(r.congress)} ${fmtN(num(r.n))}`).join(" · ")}: no clause ${fmtN(noClause)}, congress ${CONGRESS} ${fmtN(inCong)} (${noClause === inCong ? "one Congress, so the clause changes nothing" : "THE CLAUSE DROPS ROWS"})`);

  // B3: independents at floor or later.
  const b3 = objs(need(8));
  say(`\n  B3 · bills an independent sponsored (sponsor_party = 'I') at floor or later, ${fmtN(b3.length)}:`);
  say(`    predicate: ${DOME} AND sponsor_party = 'I' AND ${LATE}`);
  for (const r of b3) say(`    ${String(r.id)} · ${String(r.sponsor_name)} · ${String(r.stage)}${num(r.cal) === 1 ? " (its latest action a calendar placement, which the printed dome reads as committee)" : ""} · latest action ${when(r.latest_action_date)}`);

  // B4: the laws' sponsors against members.party.
  const b4 = objs(need(9));
  const noBid = b4.filter((r) => r.bid === null);
  const noMember = b4.filter((r) => r.bid !== null && r.member_id === null);
  const differ = b4.filter((r) => r.member_id !== null && r.member_party !== r.party);
  say(`\n  B4 · the ${fmtN(b4.length)} laws in the dome (stage = 'enacted'), each sponsor's sponsor_party against members.party (joined on sponsor_bioguide_id = members.bioguide_id, bills_agg's key):`);
  say(`    sponsor_party differs from members.party: ${differ.length ? "" : "none"}`);
  for (const r of differ) say(`      ${String(r.id)} · ${String(r.sponsor_name)} · sponsor_party ${String(r.party)} · members.party ${String(r.member_party)} (${String(r.member_name)}, is_current ${String(r.is_current)})`);
  say(`    no sponsor_bioguide_id (bills_agg's WHERE drops these): ${noBid.length ? noBid.map((r) => String(r.id)).join(", ") : "none"}`);
  say(`    a sponsor_bioguide_id with no members row: ${noMember.length ? noMember.map((r) => `${String(r.id)} (${String(r.bid)})`).join(", ") : "none"}`);
  say(`    the laws counted here, ${fmtN(b4.length)}, against C1's enacted ${fmtN(c1.get("enacted") ?? 0)} (${b4.length === (c1.get("enacted") ?? 0) ? "equal" : "NOT EQUAL"})`);

  // B5.
  const b5 = results.b5 as { named: string[]; a3: string[] } | undefined;
  say(`\n  B5 · the members probe's A.3 split (119 enacted at the time): ${b5?.named.length ? `files named for members: ${b5.named.join(", ")}` : "no findings file in docs/probes/ is named for members"}; STEP 0 lists every line naming A3 or A.3, and whether one holds the split is read off those lines`);

  // C1: today against Nov 5.
  say(`\n  C1 · the dome today, the dome's own statement cut to ${LAW} AND ${NONC} (no Congress clause), against Nov 5`);
  const stagesC = stageCols(c1);
  say(`    ${"stage".padEnd(15)}${"Nov 5, stored".padStart(15)}${"today, stored".padStart(15)}${"Δ".padStart(8)}${"Nov 5, handoff".padStart(16)}${"today, same way".padStart(17)}${"Δ".padStart(8)}`);
  const asHandoff = (s: string, m: Map<string, number>, cal: number) => (s === "floor" ? (m.get("floor") ?? 0) - cal : s === "committee" ? (m.get("committee") ?? 0) + cal : m.get(s) ?? 0);
  const c1rows: Record<string, unknown> = {};
  for (const s of stagesC) {
    const was = STORED_803[s] ?? 0;
    const now = c1.get(s) ?? 0;
    const pWas = PRINTED[s];
    const pNow = asHandoff(s, c1, floorCal);
    c1rows[s] = { storedNov5: was, storedNow: now, delta: now - was, handoffNov5: pWas ?? null, handoffWayNow: pNow, handoffDelta: pWas == null ? null : pNow - pWas };
    say(`    ${s.padEnd(15)}${fmtN(was).padStart(15)}${fmtN(now).padStart(15)}${signed(now - was).padStart(8)}${(pWas == null ? "" : fmtN(pWas)).padStart(16)}${(pWas == null ? "" : fmtN(pNow)).padStart(17)}${(pWas == null ? "" : signed(pNow - pWas)).padStart(8)}`);
  }
  say(`    ${"total".padEnd(15)}${fmtN(STORED_803_TOTALS.total).padStart(15)}${fmtN(c1Total).padStart(15)}${signed(c1Total - STORED_803_TOTALS.total).padStart(8)}${fmtN(PRINTED_TOTALS.total).padStart(16)}${fmtN(c1Total).padStart(17)}${signed(c1Total - PRINTED_TOTALS.total).padStart(8)}`);
  say(`    calendar placements at floor: Nov 5 ${fmtN(STORED_803_TOTALS.floorCal)}, today ${fmtN(floorCal)} (cal = ${CAL}, the 799 statement's value); "the same way" moves them from floor to committee, as the handoff's Nov 5 figures read`);
  say(`    ceremonial, law-eligible (${LAW} AND is_ceremonial = 1): Nov 5 ${fmtN(STORED_803_TOTALS.ceremonial)}, today ${fmtN(cerNow)} (${signed(cerNow - STORED_803_TOTALS.ceremonial)})`);
  say(`    law-eligible, any tag (${LAW}): Nov 5 ${fmtN(STORED_803_TOTALS.lawEligible)}, today ${fmtN(lawNow)} (${signed(lawNow - STORED_803_TOTALS.lawEligible)})`);
  say(`    untagged inside the dome (is_ceremonial IS NULL): ${fmtN(untaggedGated + untaggedAwaiting)} · with a summary ${fmtN(untaggedGated)} · awaiting the summarizer ${fmtN(untaggedAwaiting)} (Nov 5: 5, the parse-fails)`);
  say(`    the cube: ${cells.length} cells · newest update_date ${when(maxOf(cells.map((c) => c.maxUpd)))} · newest summary_updated_at ${when(maxOf(cells.map((c) => c.maxSum)))}`);

  // C2: the laws the printed dome doesn't show.
  const c2 = objs(need(10));
  const c2j = num(need(11).rows[0]?.n);
  const c2min = objs(need(12));
  const firsts = new Map(objs(need(13)).map((r) => [String(r.bill_id), { first: str(r.first_enacted), n: num(r.n) }]));
  const left = objs(need(14));
  say(`\n  C2 · the dome's laws whose stage_observed_at is after the Nov 5 reading's as-of (${AT_803}), ${fmtN(c2.length)}:`);
  say(`    predicate: ${DOME} AND stage = 'enacted' AND stage_observed_at > '${AT_803}'`);
  for (const r of c2) {
    const f = firsts.get(String(r.id));
    const already = f?.first != null && f.first <= AT_803;
    say(`    ${String(r.id)} · ${String(r.sponsor_name)} · sponsor_party ${String(r.sponsor_party)} · latest action ${when(r.latest_action_date)} · observed ${when(r.stage_observed_at)} · from ${String(r.previous_stage)} · ${tagOf(r.is_ceremonial, r.awaiting)} · first to enacted ${f?.first ? when(f.first) : "no transition row"}${already ? " (ALREADY ENACTED BY NOV 5)" : ""} · ${String(r.latest_action_text ?? "").slice(0, 70)}`);
  }
  const alreadyIds = c2.filter((r) => { const f = firsts.get(String(r.id)); return f?.first != null && f.first <= AT_803; }).map((r) => String(r.id));
  say(`    control: by julianday() ${fmtN(c2j)} (${c2j === c2.length ? "equal" : "NOT EQUAL"}); observed inside the handoff's minute before the as-of (${MINUTE_803} to ${AT_803}): ${c2min.length ? c2min.map((r) => `${String(r.id)} ${String(r.stage_observed_at)}`).join(", ") : "none"}`);
  say(`    control: listed laws whose first transition to enacted came at or before the Nov 5 as-of (so the printed dome counted them): ${alreadyIds.length ? alreadyIds.join(", ") : "none"}`);
  say(`    control: law-eligible bills that left enacted (previous_stage = 'enacted', stage now another): ${left.length ? left.map((r) => `${String(r.id)} now ${String(r.stage)}`).join(", ") : "none"}`);

  // The 126, reconciled: every law-eligible law, any tag, split at the Nov 5 as-of.
  const laws = objs(need(15));
  const after = (r: Record<string, unknown>) => r.stage_observed_at != null && String(r.stage_observed_at) > AT_803;
  const hollow = new Set(HOLLOW_803);
  const before = laws.filter((r) => !after(r));
  const since = laws.filter(after);
  const beforeIn = before.filter((r) => inDome(r.is_ceremonial));
  const sinceIn = since.filter((r) => inDome(r.is_ceremonial));
  const beforeNotHollow = before.filter((r) => !hollow.has(String(r.id)));
  const hollowBefore = before.filter((r) => hollow.has(String(r.id)));
  const movedIn = hollowBefore.filter((r) => inDome(r.is_ceremonial));
  const movedOut = beforeNotHollow.filter((r) => !inDome(r.is_ceremonial));
  const lateDated = before.filter((r) => r.latest_action_date != null && String(r.latest_action_date) > DAY_803);
  const sinceOut = since.filter((r) => !inDome(r.is_ceremonial));
  const enactedNow = c1.get("enacted") ?? 0;
  say(`\n  C2 · the 126, reconciled (every law-eligible law, any tag: ${CONG} AND ${LAW} AND stage = 'enacted', ${fmtN(laws.length)} today)`);
  say(`    observed at or before ${AT_803}, or never stamped: ${fmtN(before.length)} (Nov 5's laws, any tag, were ${fmtN(STORED_803_TOTALS.lawEnactedAnyTag)}: ${before.length === STORED_803_TOTALS.lawEnactedAnyTag ? "equal" : "NOT EQUAL"}); observed after: ${fmtN(since.length)}`);
  say(`    of those at or before: the 13 laws hollow on Nov 5 ${fmtN(hollowBefore.length)} of 13; the rest ${fmtN(beforeNotHollow.length)} (the printed dome's 126: ${beforeNotHollow.length === STORED_803_TOTALS.enacted ? "equal" : "NOT EQUAL"})`);
  say(`    hollow on Nov 5 and in the dome now: ${movedIn.length ? movedIn.map((r) => `${String(r.id)} (${tagOf(r.is_ceremonial, r.awaiting)})`).join(", ") : "none"}`);
  say(`    in the dome on Nov 5 and tagged ceremonial now: ${movedOut.length ? movedOut.map((r) => String(r.id)).join(", ") : "none"}`);
  say(`    observed after and tagged ceremonial (outside the dome): ${sinceOut.length ? sinceOut.map((r) => String(r.id)).join(", ") : "none"}`);
  say(`    at or before, with a latest action dated after ${DAY_803} (so it can't be one of Nov 5's): ${lateDated.length ? lateDated.map((r) => `${String(r.id)} ${String(r.latest_action_date)}`).join(", ") : "none"}`);
  say(`    the dome's laws today: ${fmtN(beforeIn.length)} from at or before + ${fmtN(sinceIn.length)} observed after = ${fmtN(beforeIn.length + sinceIn.length)} (C1's enacted ${fmtN(enactedNow)}: ${beforeIn.length + sinceIn.length === enactedNow ? "equal" : "NOT EQUAL"})`);
  const holds = enactedNow === STORED_803_TOTALS.enacted;
  const verdict = holds
    ? `the dome's 126 HOLDS: it reads ${fmtN(enactedNow)} laws today`
    : `the dome's 126 does not hold: it reads ${fmtN(enactedNow)} laws today (${signed(enactedNow - STORED_803_TOTALS.enacted)}): ${[sinceIn.length ? `observed since, ${sinceIn.map((r) => String(r.id)).join(", ")}` : "", movedIn.length ? `hollow then and in the dome now, ${movedIn.map((r) => String(r.id)).join(", ")}` : "", movedOut.length ? `tagged ceremonial since, ${movedOut.map((r) => String(r.id)).join(", ")}` : ""].filter(Boolean).join("; ")}`;
  say(`    ${verdict}`);

  results.B3 = b3;
  results.B4 = { laws: b4.length, differ, noBid, noMember };
  results.C1 = { rows: c1rows, total: c1Total, floorCal, ceremonial: cerNow, lawEligible: lawNow, untagged: { gated: untaggedGated, awaiting: untaggedAwaiting }, cells: cells.length, newestUpdate: maxOf(cells.map((c) => c.maxUpd)), newestSummary: maxOf(cells.map((c) => c.maxSum)) };
  results.C2 = { rows: c2, julianday: c2j, inMinute: c2min, firsts: Object.fromEntries(firsts), alreadyEnacted: alreadyIds, leftEnacted: left, reconcile: { laws: laws.length, before: before.length, since: since.length, hollowBefore: hollowBefore.length, beforeNotHollow: beforeNotHollow.length, beforeIn: beforeIn.length, sinceIn: sinceIn.length, movedIn: movedIn.map((r) => String(r.id)), movedOut: movedOut.map((r) => String(r.id)), sinceOut: sinceOut.map((r) => String(r.id)), lateDated: lateDated.map((r) => String(r.id)) }, holds, verdict };
  results.controls = { count: ctl, byCongress: byCong, noClause, inCongress: inCong };

  // For the poster chat.
  say(`\n── for the poster chat`);
  const lines: string[] = [];
  for (const p of PARTY_ORDER) {
    const r = B1.rows[p];
    lines.push(`${PARTY_NAME[p]}: ${fmtN(r?.total ?? 0)} BILLS · ${fmtN(r?.enacted ?? 0)} LAWS · ${pct2(r?.enacted ?? 0, r?.total ?? 0)}%`);
  }
  for (const l of lines) say(`  ${l}`);
  say(`  AS OF ${chatAsOf(at)} (${when(at)})`);
  const unlisted = parties.filter((p) => !PARTY_ORDER.includes(p) && (B1.rows[p]?.total ?? 0) > 0);
  if (unlisted.length) say(`  outside the three lines: ${unlisted.map((p) => `${p} ${fmtN(B1.rows[p]?.total ?? 0)} bills, ${fmtN(B1.rows[p]?.enacted ?? 0)} laws`).join(" · ")}`);
  say(`  ${verdict}${c2.length ? `; C2, observed since: ${c2.map((r) => `${String(r.id)} (${String(r.sponsor_party)}, ${String(r.latest_action_date)})`).join(", ")}` : "; C2, observed since: none"}`);
  say(`  B2, the chamber a bill started in:`);
  say(`    | party | House bills | House laws | House rate | Senate bills | Senate laws | Senate rate |`);
  say(`    |---|---:|---:|---:|---:|---:|---:|`);
  for (const p of PARTY_ORDER) {
    const h = B2h.rows[p];
    const s = B2s.rows[p];
    say(`    | ${p} | ${fmtN(h?.total ?? 0)} | ${fmtN(h?.enacted ?? 0)} | ${pct2(h?.enacted ?? 0, h?.total ?? 0)}% | ${fmtN(s?.total ?? 0)} | ${fmtN(s?.enacted ?? 0)} | ${pct2(s?.enacted ?? 0, s?.total ?? 0)}% |`);
  }
  results.chat = { lines, asOf: chatAsOf(at), holds, verdict };
}

async function main() {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    console.error("usage: npx tsx scripts/diagnostic/gradshow-party-810.ts [--label L]   (read-only; one mode)");
    process.exit(2);
  }
  mkdirSync(ART, { recursive: true });
  const base = path.join(ART, `run-${LABEL}`);
  if (existsSync(`${base}.log`) || existsSync(`${base}.json`)) {
    console.error(`label ${LABEL} is taken (${base}.log or .json exists); pick another with --label. Prod was not read.`);
    process.exit(2);
  }
  const start = new Date();
  say(`HO 810 · label ${LABEL} · start ${when(start)} · HEAD ${git(["rev-parse", "--short", "HEAD"])} (${git(["branch", "--show-current"])}) · node ${process.version} · congress ${CONGRESS}`);
  let before = "";
  let failure: Error | null = null;
  try {
    step0Tree(); // before prod: a failed precondition never reads it
    before = await schemaPrint();
    say(`  prod's schema fingerprint before: ${before}`);
    await step0Prod();
    await freshness();
    await sectionA();
    await sectionAEvidence();
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
    // The log and JSON first, the ledger last, each on its own, so one failed write can't take the others with it.
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
