// HO 832 — a read-only probe: which statements idx_bills_summary_stage_stale
// changed, and what /stale's row list reads.
//
// THIS SCRIPT WRITES NOTHING TO THE STORE. Every statement it sends to prod
// passes HO 824's guard on the singleton client (lib/db.ts getDb()): libSQL's
// createClient has no read-only open for a remote URL, so the guard refuses any
// statement that doesn't start with SELECT / WITH / EXPLAIN or that carries a
// write word outside its comments and string literals, any batch not in "read"
// mode, and every transaction, executeMultiple, migrate and sync. Two refused
// controls run before the first read, and the tally never counts a refusal.
//
// Its writes are local only: two empty SQLite files built from prod's DDL (no
// rows), and its JSON/text output, all under the <dir> it is given
// (docs/handoffs/832-artifacts/, gitignored). The local client refuses any path
// outside <dir>.
//
//   set -a; . ./.env; set +a
//   node node_modules/tsx/dist/cli.mjs --import ./scripts/diagnostic/next-cache-stub-757.mjs \
//     scripts/diagnostic/plans-832.ts <mode> <dir>
//
// The modes, in the order the probe ran them:
//   schema   STEP 0 claim 4 (prod's indexes on bills, any sqlite_stat table,
//            the engine's version), then the two copies: <dir>/copy-with.db
//            holds every table, index and view prod's sqlite_master lists, in
//            its rowid order; <dir>/copy-without.db the same less
//            idx_bills_summary_stage_stale. No rows, so no statistics: the
//            planner works from the schema alone, as prod's does with no
//            sqlite_stat table.
//   capture  calls the app's own loaders (next/cache stubbed by the --import
//            hook, HO 757) against prod through the guard, and records every
//            statement and its args as the client receives them. No app code
//            changes: the recorder wraps the client in this process.
//            `capture <dir>` runs the handoff's pages, `capture <dir> others`
//            every other reader that can be called read-only
//            (plans-832-calls.ts).
//   diff     first the control: ten statements that read bills without naming
//            an index, planned on prod and on copy-with.db, line for line, and
//            then every captured statement that reads bills (a difference only
//            in the temp b-tree's label, 3.45.1 against 3.47.0, counted apart).
//            If one differs it stops and says which. Then every captured
//            statement's plan on both copies; the ones that differ are kept,
//            with the old plan forced (INDEXED BY its index) checked on prod
//            against copy-without.db's.
//   time     for each kept statement, on prod: the table columns each plan
//            reads (EXPLAIN's Column opcodes on the bills cursor), the rows the
//            index hands over (a COUNT of the seek terms), one first run per
//            plan in a fresh process (the `first` mode, spawned), three warm
//            runs per plan, and whether both plans return the same rows.
//            `time <dir> <n>` runs the first n only.
//   tablerows  per stage, the rows both plans hand over and the non-ceremonial
//            ones a plan that reads a table column reads it for.
//   stale    § 2: getStaleBills' two forms, unfiltered and per chamber, with
//            the pieces of the default group's time and the candidate on the
//            new index.
//   walk     § 2: the date-index entries the single-stage form walks before
//            its LIMIT fills.
//   search   § 3: /bills' search count under a stage filter
//            (`search <dir> [terms] [stage]`).
//   slowctx  § 2: each slow /stale request's slot beside the cron_runs rows
//            that ended in the ten minutes before it
//            (`slowctx <dir> <slots.tsv>`).
//   listing  the full EXPLAIN listings of § 1's shapes 2 and 4 at committee,
//            each plan, and the plan of /bills' row SELECT under
//            stage=committee&q=tax.
//   first    (spawned by time / stale / search) one statement, once, timed,
//            after a SELECT 1 that takes the fresh connection's cost.
import { createClient, type Client, type InArgs } from "@libsql/client";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { getDb } from "../../lib/db";
import { redactSecrets } from "../../lib/redact";

const [mode, dirArg, ...rest] = process.argv.slice(2);
if (!mode || !dirArg) throw new Error("usage: plans-832.ts <mode> <dir> [...]");
const DIR = path.resolve(dirArg);
mkdirSync(DIR, { recursive: true });

const NEW_INDEX = "idx_bills_summary_stage_stale";

// ---- time: Mountain Standard Time, a fixed UTC-7 --------------------------------
const MST_MS = 7 * 3_600_000;
const mst = (t: number | string = Date.now()): string => {
  const ms = typeof t === "number" ? t : Date.parse(t);
  return new Date(ms - MST_MS).toISOString().replace("T", " ").replace(/\.\d+Z$/, "") + " MST";
};

// ---- output -----------------------------------------------------------------------
const lines: string[] = [];
const say = (s = "") => {
  const r = redactSecrets(s);
  lines.push(r);
  if (mode !== "first") console.log(r);
};
const flush = (name: string, json: unknown) => {
  writeFileSync(path.join(DIR, `${name}.json`), JSON.stringify(json, null, 2));
  writeFileSync(path.join(DIR, `${name}.txt`), lines.join("\n") + "\n");
};
const readJson = <T>(name: string): T => JSON.parse(readFileSync(path.join(DIR, `${name}.json`), "utf8")) as T;
const oneLine = (sql: string) => sql.replace(/\s+/g, " ").trim();
const sha = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 16);

// ---- the read-only guard (HO 824's, verbatim in effect) ------------------------
const READ_START = /^\s*(?:--[^\n]*\n\s*|\/\*[\s\S]*?\*\/\s*)*(SELECT|WITH|EXPLAIN)\b/i;
const WRITE_WORD = /\b(INSERT|UPDATE|DELETE|UPSERT|CREATE|DROP|ALTER|ATTACH|DETACH|VACUUM|REINDEX|PRAGMA)\b|\bREPLACE\b(?!\s*\()/i;
let guarded = 0;
let refusals = 0;
function sqlOf(stmt: unknown): string {
  if (typeof stmt === "string") return stmt;
  if (stmt && typeof stmt === "object" && "sql" in stmt) return String((stmt as { sql: unknown }).sql);
  throw new Error("[guard] unknown statement shape");
}
function argsOf(stmt: unknown, args?: unknown): InArgs {
  if (stmt && typeof stmt === "object" && "args" in stmt) return ((stmt as { args?: InArgs }).args ?? []) as InArgs;
  return (args ?? []) as InArgs;
}
// Comments and string literals blanked, the length kept (so a `?`'s offset in
// the result is its offset in the SQL).
function codeOnly(sql: string): string {
  let o = "";
  let i = 0;
  while (i < sql.length) {
    const c = sql[i]!;
    const n = sql[i + 1];
    if (c === "-" && n === "-") {
      while (i < sql.length && sql[i] !== "\n") {
        o += " ";
        i++;
      }
    } else if (c === "/" && n === "*") {
      const end = sql.indexOf("*/", i + 2);
      const stop = end < 0 ? sql.length : end + 2;
      o += " ".repeat(stop - i);
      i = stop;
    } else if (c === "'" || c === '"' || c === "`") {
      const start = i;
      i++;
      while (i < sql.length) {
        if (sql[i] === c && sql[i + 1] === c) i += 2;
        else if (sql[i] === c) break;
        else i++;
      }
      i++;
      o += c === "'" ? `'${"_".repeat(Math.max(0, i - start - 2))}'` : sql.slice(start, i);
    } else {
      o += c;
      i++;
    }
  }
  return o;
}
function check(stmt: unknown) {
  const sql = sqlOf(stmt);
  if (!READ_START.test(sql) || WRITE_WORD.test(codeOnly(sql).replace(/'_*'/g, " "))) {
    refusals++;
    throw new Error(`[guard] refused a non-read statement: ${sql.slice(0, 120)}`);
  }
  guarded++;
}

// The capture's recorder: every statement the app sends through the guarded
// client, with its args, before it runs. With `dry` on, the statement is
// recorded and NOT sent; the caller gets an empty result (§ 2 and § 3 use it so
// the probe's first run of a statement is its timed one).
type Captured = { label: string; sql: string; args: InArgs; via: "execute" | "batch"; stack: string };
let recorder: ((c: Omit<Captured, "label">) => void) | null = null;
let dry = false;
const EMPTY = { rows: [], columns: [], columnTypes: [], rowsAffected: 0, lastInsertRowid: undefined, toJSON: () => ({}) };
const callerStack = () =>
  (new Error().stack ?? "")
    .split("\n")
    .slice(3)
    .filter((l) => /[\\/](lib|app|components)[\\/]/.test(l) && !/node_modules|[\\/]scripts[\\/]/.test(l))
    .map((l) => l.trim().replace(/^at /, "").replace(/\(?[A-Za-z]:[\\/].*?CBT[\\/]/, "").replace(/\)$/, ""))
    .slice(0, 4)
    .join(" <- ");

const prod: Client = getDb();
/* eslint-disable @typescript-eslint/no-explicit-any */
const anyDb = prod as any;
const realExecute = anyDb.execute.bind(prod);
const realBatch = anyDb.batch.bind(prod);
anyDb.execute = (stmt: unknown, args?: unknown) => {
  check(stmt);
  if (recorder) recorder({ sql: sqlOf(stmt), args: argsOf(stmt, args), via: "execute", stack: callerStack() });
  if (dry && recorder) return Promise.resolve(EMPTY);
  return args === undefined ? realExecute(stmt) : realExecute(stmt, args);
};
anyDb.batch = (stmts: unknown[], m?: string) => {
  if (m !== "read") {
    refusals++;
    throw new Error(`[guard] refused a batch in mode ${m ?? "(none)"}`);
  }
  stmts.forEach(check);
  if (recorder) for (const s of stmts) recorder({ sql: sqlOf(s), args: argsOf(s), via: "batch", stack: callerStack() });
  if (dry && recorder) return Promise.resolve(stmts.map(() => EMPTY));
  return realBatch(stmts, m);
};
for (const k of ["transaction", "executeMultiple", "migrate", "sync"]) {
  anyDb[k] = () => {
    refusals++;
    throw new Error(`[guard] refused ${k}`);
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

// The two refused controls, before the first read: each must throw, and the
// tally must not move.
{
  const before = guarded;
  for (const bad of [
    { sql: "UPDATE bills SET stage = 'x' WHERE id = 'none'", args: [] },
    { sql: "SELECT 1; CREATE INDEX probe_832 ON bills(id)", args: [] },
  ]) {
    let refused = false;
    try {
      await prod.execute(bad);
    } catch (e) {
      refused = /\[guard\] refused/.test((e as Error).message);
    }
    if (!refused) throw new Error(`guard control failed: ${bad.sql}`);
  }
  if (guarded !== before) throw new Error("guard control moved the tally");
}

type Row = Record<string, unknown>;
const pq = async (sql: string, args: InArgs = []): Promise<Row[]> => (await prod.execute({ sql, args })).rows as unknown as Row[];

// ---- the local copies -------------------------------------------------------------
const COPY_WITH = path.join(DIR, "copy-with.db");
const COPY_WITHOUT = path.join(DIR, "copy-without.db");
function openLocal(file: string): Client {
  const abs = path.resolve(file);
  if (!abs.startsWith(DIR + path.sep)) throw new Error(`local copy outside ${DIR}: ${abs}`);
  return createClient({ url: `file:${abs}` });
}
const lq = async (c: Client, sql: string, args: InArgs = []): Promise<Row[]> => (await c.execute({ sql, args })).rows as unknown as Row[];

// ---- plans and opcodes --------------------------------------------------------------
type Exec = (sql: string, args: InArgs) => Promise<Row[]>;
const onProd: Exec = (sql, args) => pq(sql, args);
const onLocal =
  (c: Client): Exec =>
  (sql, args) =>
    lq(c, sql, args);
// EXPLAIN QUERY PLAN as indented lines (depth from the parent links).
async function eqp(exec: Exec, sql: string, args: InArgs): Promise<string[]> {
  const rows = await exec(`EXPLAIN QUERY PLAN ${sql}`, args);
  const depth = new Map<number, number>();
  return rows.map((r) => {
    const parent = Number(r.parent);
    const d = parent === 0 ? 0 : (depth.get(parent) ?? 0) + 1;
    depth.set(Number(r.id), d);
    return `${"  ".repeat(d)}${String(r.detail)}`;
  });
}
type Op = { addr: number; opcode: string; p1: number; p2: number; p3: number; p4: string; p5: number };
async function opcodes(exec: Exec, sql: string, args: InArgs): Promise<Op[]> {
  return (await exec(`EXPLAIN ${sql}`, args)).map((r) => ({
    addr: Number(r.addr),
    opcode: String(r.opcode),
    p1: Number(r.p1),
    p2: Number(r.p2),
    p3: Number(r.p3),
    p4: r.p4 == null ? "" : String(r.p4),
    p5: Number(r.p5),
  }));
}
// What the bytecode reads from bills' TABLE b-tree: every cursor an OpenRead
// opens on the table's root page, and every Column opcode on such a cursor
// (named by the table's column order). A plan that seeks the table only through
// a DeferredSeek reads nothing from it unless a Column follows.
type TableReads = { cursors: number[]; columns: string[]; columnOps: number; rowidOps: number; deferredSeeks: number; fullScan: boolean };
function tableReads(ops: Op[], root: number, cols: string[]): TableReads {
  const cursors = new Set(ops.filter((o) => (o.opcode === "OpenRead" || o.opcode === "ReopenIdx") && o.p2 === root && o.p3 === 0).map((o) => o.p1));
  const colOps = ops.filter((o) => o.opcode === "Column" && cursors.has(o.p1));
  return {
    cursors: [...cursors],
    columns: [...new Set(colOps.map((o) => cols[o.p2] ?? `col${o.p2}`))],
    columnOps: colOps.length,
    rowidOps: ops.filter((o) => o.opcode === "Rowid" && cursors.has(o.p1)).length,
    deferredSeeks: ops.filter((o) => o.opcode === "DeferredSeek" && cursors.has(o.p3)).length,
    fullScan: ops.some((o) => (o.opcode === "Rewind" || o.opcode === "Last") && cursors.has(o.p1)),
  };
}
const readsText = (t: TableReads) =>
  t.cursors.length === 0
    ? "the table isn't opened"
    : t.columns.length === 0
      ? `none (table cursor ${t.cursors.join(",")} opened, ${t.deferredSeeks} DeferredSeek, 0 Column)`
      : `${t.columns.join(", ")} (${t.columnOps} Column ops on cursor ${t.cursors.join(",")}${t.fullScan ? ", a full table scan" : ""})`;

// The bills references in a statement: `FROM bills` / `JOIN bills`, with an alias
// if it has one, and whether it already names an index.
const NOT_ALIAS = /^(WHERE|JOIN|LEFT|INNER|CROSS|OUTER|NATURAL|ON|ORDER|GROUP|LIMIT|INDEXED|NOT|USING|HAVING|WINDOW|UNION|EXCEPT|INTERSECT)$/i;
type Ref = { at: number; end: number; name: string; hint: string | null };
function billsRefs(sql: string): Ref[] {
  const code = codeOnly(sql);
  const out: Ref[] = [];
  // SQLite's form: `bills [AS alias] [INDEXED BY idx | NOT INDEXED]`.
  for (const m of code.matchAll(/\b(?:FROM|JOIN)\s+bills\b(?!_)/gi)) {
    let end = m.index! + m[0].length;
    let name = "bills";
    const am = /^\s+(?:AS\s+)?(\w+)/i.exec(code.slice(end));
    if (am && !NOT_ALIAS.test(am[1]!)) {
      name = am[1]!;
      end += am[0].length;
    }
    const h = /^\s+(?:INDEXED\s+BY\s+(\w+)|(NOT\s+INDEXED))/i.exec(code.slice(end));
    out.push({ at: m.index!, end, name, hint: h ? (h[1] ?? "NOT INDEXED") : null });
  }
  return out;
}
// Force an index (or NOT INDEXED) on the bills reference a plan line names.
function forceOn(sql: string, name: string, idx: string | null): string {
  const refs = billsRefs(sql).filter((r) => r.name === name && !r.hint);
  if (refs.length !== 1) throw new Error(`can't force: ${refs.length} unhinted bills references named ${name}`);
  const r = refs[0]!;
  return `${sql.slice(0, r.end)} ${idx ? `INDEXED BY ${idx}` : "NOT INDEXED"}${sql.slice(r.end)}`;
}
// Each line of a plan that reads bills through an index, or scans it.
type Access = { name: string; kind: "SEARCH" | "SCAN"; covering: boolean; index: string | null; terms: string | null };
function accesses(plan: string[], names: Set<string>): Access[] {
  const out: Access[] = [];
  for (const l of plan) {
    const m = /^\s*(SEARCH|SCAN) (\w+)(?: USING (COVERING )?INDEX (\w+)(?: \((.*)\))?| USING INTEGER PRIMARY KEY.*)?/.exec(l);
    if (m && names.has(m[2]!)) out.push({ name: m[2]!, kind: m[1] as "SEARCH" | "SCAN", covering: !!m[3], index: m[4] ?? null, terms: m[5] ?? null });
  }
  return out;
}

// ---- schema -----------------------------------------------------------------------------
type MasterRow = { rowid: number; type: string; name: string; tbl_name: string; sql: string | null };
async function modeSchema() {
  const clock = Date.now();
  say(`HO 832 plans probe · schema · ${mst(clock)} (${new Date(clock).toISOString()}) · prod, read-only`);
  const ver = String((await pq(`SELECT sqlite_version() AS v`))[0]!.v);
  const master = (await pq(`SELECT rowid, type, name, tbl_name, sql FROM sqlite_master ORDER BY rowid`)).map(
    (r) => ({ rowid: Number(r.rowid), type: String(r.type), name: String(r.name), tbl_name: String(r.tbl_name), sql: r.sql == null ? null : String(r.sql) }) as MasterRow,
  );
  const billsIdx = master.filter((m) => m.type === "index" && m.tbl_name === "bills");
  const stat = master.filter((m) => /^sqlite_stat/.test(m.name));
  say(`prod sqlite_version ${ver} · sqlite_master ${master.length} rows: ${["table", "index", "view", "trigger"].map((t) => `${master.filter((m) => m.type === t).length} ${t}s`).join(", ")}`);
  say(`STEP 0 claim 4 · indexes on bills: ${billsIdx.length} (${billsIdx.filter((m) => m.sql == null).length} automatic) · ${NEW_INDEX} ${billsIdx.some((m) => m.name === NEW_INDEX) ? "present" : "ABSENT"} · sqlite_stat tables: ${stat.length ? stat.map((m) => m.name).join(", ") : "none"}`);
  for (const m of billsIdx) say(`   ${String(m.rowid).padStart(5)}  ${m.name}${m.sql ? `  ${oneLine(m.sql)}` : "  (automatic)"}`);

  // Both copies in prod's rowid order. A virtual table makes its own shadow
  // tables, so prod's rows for them are skipped; automatic indexes have no SQL
  // and come back with their table; sqlite_sequence comes back with the first
  // AUTOINCREMENT table. Triggers are left out: no read plan uses one.
  const vtabs = master.filter((m) => m.type === "table" && /^CREATE VIRTUAL TABLE/i.test(m.sql ?? "")).map((m) => m.name);
  const shadow = (n: string) => vtabs.some((v) => n.startsWith(`${v}_`)) && master.some((m) => m.name === n && m.type === "table" && !/^CREATE VIRTUAL/i.test(m.sql ?? ""));
  const ddl = master.filter((m) => m.sql != null && m.type !== "trigger" && m.name !== "sqlite_sequence" && !/^sqlite_/.test(m.name) && !shadow(m.name));
  const skipped = master.filter((m) => !ddl.includes(m));
  const built: Record<string, unknown> = {};
  for (const [file, drop] of [[COPY_WITH, null], [COPY_WITHOUT, NEW_INDEX]] as const) {
    for (const f of [file, `${file}-journal`, `${file}-wal`, `${file}-shm`]) if (existsSync(f)) rmSync(f);
    const c = openLocal(file);
    let n = 0;
    for (const m of ddl) {
      if (m.name === drop) continue;
      await c.execute(m.sql!);
      n++;
    }
    c.close();
    // Re-open, as the probe will, and read the copy's schema back.
    const r = openLocal(file);
    const back = await lq(r, `SELECT type, name, tbl_name, sql FROM sqlite_master ORDER BY rowid`);
    const localVer = String((await lq(r, `SELECT sqlite_version() AS v`))[0]!.v);
    const backIdx = back.filter((m) => m.type === "index" && m.tbl_name === "bills").map((m) => String(m.name));
    const rows = Number((await lq(r, `SELECT COUNT(*) AS n FROM bills`))[0]!.n);
    const want = ddl.filter((m) => m.name !== drop).map((m) => `${m.type}:${m.name}:${m.sql}`);
    const got = back.map((m) => `${String(m.type)}:${String(m.name)}:${String(m.sql)}`);
    const missing = want.filter((w) => !got.includes(w));
    say(`copy ${path.basename(file)}: local sqlite ${localVer} · ${n} DDL statements run · bills indexes ${backIdx.length} · ${NEW_INDEX} ${backIdx.includes(NEW_INDEX) ? "present" : "absent"} · bills rows ${rows} · DDL equal to prod's: ${missing.length === 0 ? "yes" : `NO, ${missing.length} differ`}`);
    for (const m of missing) say(`   differs: ${m.slice(0, 160)}`);
    built[path.basename(file)] = { localVer, statements: n, billsIndexes: backIdx, rows, missing };
    r.close();
  }
  say(`skipped from prod's sqlite_master: ${skipped.map((m) => `${m.type} ${m.name}`).join(", ")}`);
  say(`statements through the guard: ${guarded} · refusals: ${refusals} (the two controls)`);
  flush("schema-832", { clock: new Date(clock).toISOString(), prodVersion: ver, master, billsIndexes: billsIdx, stat, built, skipped: skipped.map((m) => m.name), guard: { guarded, refusals } });
}

// ---- capture ----------------------------------------------------------------------------
// The loaders and their inputs come from a separate module so this file stays
// the method; see plans-832-calls.ts.
async function modeCapture() {
  // `capture <dir>` runs the handoff's pages; `capture <dir> others` every other
  // reader the hunt found that can be called read-only.
  const set = rest[0] === "others" ? "others" : "pages";
  const mod = await import("./plans-832-calls");
  const CALLS = set === "others" ? mod.OTHERS : mod.CALLS;
  const clock = Date.now();
  say(`HO 832 plans probe · capture (${set}) · ${mst(clock)} · prod, read-only, ${CALLS.length} loader calls`);
  const captured: Captured[] = [];
  const outcomes: { label: string; ok: boolean; ms: number; statements: number; error?: string }[] = [];
  let label = "";
  recorder = (c) => captured.push({ label, ...c });
  for (const [l, f] of CALLS) {
    label = l;
    const n0 = captured.length;
    const t0 = Date.now();
    try {
      await f();
      outcomes.push({ label: l, ok: true, ms: Date.now() - t0, statements: captured.length - n0 });
    } catch (e) {
      outcomes.push({ label: l, ok: false, ms: Date.now() - t0, statements: captured.length - n0, error: redactSecrets((e as Error).message).slice(0, 200) });
    }
  }
  recorder = null;
  for (const o of outcomes) say(`  ${o.ok ? "ok  " : "FAIL"} ${o.label} · ${o.statements} statements · ${o.ms} ms${o.error ? ` · ${o.error}` : ""}`);
  const bySql = new Map<string, Captured[]>();
  for (const c of captured) bySql.set(c.sql, [...(bySql.get(c.sql) ?? []), c]);
  const readsBills = [...bySql.keys()].filter((s) => billsRefs(s).length > 0);
  const unhinted = readsBills.filter((s) => billsRefs(s).some((r) => !r.hint));
  say(`captured ${captured.length} statements, ${bySql.size} distinct by SQL text, ${new Set(captured.map((c) => c.sql + "\u0000" + JSON.stringify(c.args))).size} distinct with their args`);
  say(`  reading bills: ${readsBills.length} distinct; with a bills reference that names no index: ${unhinted.length}`);
  say(`statements through the guard: ${guarded} · refusals: ${refusals} (the two controls)`);
  flush(set === "others" ? "capture-832-others" : "capture-832", { clock: new Date(clock).toISOString(), set, outcomes, captured, guard: { guarded, refusals } });
}

// ---- diff (the control first) --------------------------------------------------------------
type Stmt = { key: string; sql: string; args: InArgs; labels: string[]; stacks: string[]; refs: Ref[] };
type Kept = Stmt & {
  before: string[];
  after: string[];
  prodAfter: string[];
  afterEqualsProd: boolean;
  forced: { name: string; index: string | null }[];
  oldSql: string | null;
  prodForcedOld: string[] | null;
  forcedOldEqualsBefore: boolean | null;
  forceError?: string;
};
async function modeDiff() {
  // Both captures: the handoff's pages, then every other reader the hunt found.
  const cap = {
    captured: ["capture-832", "capture-832-others"]
      .filter((n) => existsSync(path.join(DIR, `${n}.json`)))
      .flatMap((n) => readJson<{ captured: Captured[] }>(n).captured),
  };
  const clock = Date.now();
  say(`HO 832 plans probe · diff · ${mst(clock)} · prod (EXPLAIN QUERY PLAN only) and the two local copies`);
  // Distinct (sql, args), in capture order; labels and stacks gathered.
  const map = new Map<string, Stmt>();
  for (const c of cap.captured) {
    const k = sha(c.sql + "\u0000" + JSON.stringify(c.args));
    const s = map.get(k) ?? { key: k, sql: c.sql, args: c.args, labels: [], stacks: [], refs: billsRefs(c.sql) };
    if (!s.labels.includes(c.label)) s.labels.push(c.label);
    if (c.stack && !s.stacks.includes(c.stack)) s.stacks.push(c.stack);
    map.set(k, s);
  }
  const all = [...map.values()];
  const bills = all.filter((s) => s.refs.length > 0);
  const unhinted = bills.filter((s) => s.refs.some((r) => !r.hint));
  const withC = openLocal(COPY_WITH);
  const withoutC = openLocal(COPY_WITHOUT);
  say(`local sqlite ${String((await lq(withC, "SELECT sqlite_version() AS v"))[0]!.v)} · prod ${String((await pq("SELECT sqlite_version() AS v"))[0]!.v)}`);
  say(`${all.length} distinct (sql, args) captured · ${bills.length} read bills · ${unhinted.length} with a bills reference that names no index`);

  // The control: ten distinct SQL texts from the unhinted set, first in capture
  // order, prod against copy-with.db.
  const tenSql: string[] = [];
  for (const s of unhinted) if (!tenSql.includes(s.sql) && tenSql.length < 10) tenSql.push(s.sql);
  const ten = tenSql.map((q) => unhinted.find((s) => s.sql === q)!);
  say("");
  say(`== the control: ten statements that read bills without naming an index, plan on prod = plan on copy-with.db, line for line`);
  let controlFail = 0;
  const control: unknown[] = [];
  for (const s of ten) {
    const p = await eqp(onProd, s.sql, s.args);
    const l = await eqp(onLocal(withC), s.sql, s.args);
    const eq = JSON.stringify(p) === JSON.stringify(l);
    if (!eq) controlFail++;
    control.push({ key: s.key, labels: s.labels, prod: p, local: l, equal: eq });
    say(`  ${eq ? "equal" : "DIFFERS"} · ${s.key} · ${s.labels[0]}${s.labels.length > 1 ? ` (+${s.labels.length - 1})` : ""}`);
    say(`      prod:  ${p.join(" | ")}`);
    if (!eq) say(`      local: ${l.join(" | ")}`);
  }
  say(`control: ${ten.length - controlFail} of ${ten.length} equal`);
  if (controlFail) {
    say(`STOP: the control failed on ${controlFail} statement(s); the copies don't plan as prod does, so nothing is read off them.`);
    flush("diff-832", { clock: new Date(clock).toISOString(), control, stopped: true, guard: { guarded, refusals } });
    process.exit(3);
  }
  // Then every captured statement that reads bills, the same comparison. A
  // difference that is only the temp b-tree's label (3.45.1 prints "RIGHT PART
  // OF ORDER BY" where 3.47.0 prints "LAST TERM OF ORDER BY") is counted apart.
  const LABEL = (ls: string[]) => ls.map((l) => l.replace("USE TEMP B-TREE FOR RIGHT PART OF ORDER BY", "USE TEMP B-TREE FOR LAST TERM OF ORDER BY"));
  let wideFail = 0;
  let wideLabel = 0;
  const wide: { key: string; equal: boolean; labelOnly?: boolean; prod?: string[]; local?: string[] }[] = [];
  for (const s of bills) {
    const p = await eqp(onProd, s.sql, s.args);
    const l = await eqp(onLocal(withC), s.sql, s.args);
    const eq = JSON.stringify(p) === JSON.stringify(l);
    const labelOnly = !eq && JSON.stringify(p) === JSON.stringify(LABEL(l));
    if (labelOnly) wideLabel++;
    else if (!eq) wideFail++;
    wide.push(eq ? { key: s.key, equal: true } : { key: s.key, equal: false, labelOnly, prod: p, local: l });
  }
  say(`the control widened to every captured statement that reads bills: ${bills.length - wideFail - wideLabel} of ${bills.length} equal line for line; ${wideLabel} differ only in the temp b-tree's label; ${wideFail} differ otherwise`);
  for (const w of wide.filter((x) => !x.equal)) {
    say(`  ${w.labelOnly ? "label only" : "DIFFERS"} ${w.key} · ${map.get(w.key)!.labels[0]}`);
    if (!w.labelOnly) {
      say(`      prod:  ${w.prod!.join(" | ")}`);
      say(`      local: ${w.local!.join(" | ")}`);
    }
  }
  if (wideFail) {
    say(`STOP: ${wideFail} statement(s) plan differently on the copy than on prod beyond the label.`);
    flush("diff-832", { clock: new Date(clock).toISOString(), control, wide, stopped: true, guard: { guarded, refusals } });
    process.exit(3);
  }

  // The diff: every captured statement, copy-with against copy-without.
  say("");
  say(`== the diff: each captured statement's plan without the new index (copy-without.db) and with it (copy-with.db)`);
  const kept: Kept[] = [];
  // A statement that names the new index can't be prepared without it: it is
  // HO 831's hinted count, not a plan the planner changed. Counted, not diffed.
  const namesNew = all.filter((s) => s.sql.includes(NEW_INDEX));
  say(`${namesNew.length} captured statements name ${NEW_INDEX} themselves (HO 831's two counts): ${[...new Set(namesNew.flatMap((s) => s.labels.map((l) => l.replace(/^.* · /, ""))))].join(", ")}; not diffed`);
  for (const s of all) {
    if (s.sql.includes(NEW_INDEX)) continue;
    const before = await eqp(onLocal(withoutC), s.sql, s.args);
    const after = await eqp(onLocal(withC), s.sql, s.args);
    if (JSON.stringify(before) === JSON.stringify(after)) continue;
    const prodAfter = await eqp(onProd, s.sql, s.args);
    const names = new Set(s.refs.map((r) => r.name));
    // Force each access whose index changed back to its old index.
    const b = accesses(before, names);
    const a = accesses(after, names);
    const forced: { name: string; index: string | null }[] = [];
    for (const acc of b) {
      const now = a.find((x) => x.name === acc.name);
      if (!now || now.index !== acc.index) forced.push({ name: acc.name, index: acc.index });
    }
    let oldSql: string | null = null;
    let prodForcedOld: string[] | null = null;
    let forceError: string | undefined;
    try {
      oldSql = forced.reduce((q, f) => forceOn(q, f.name, f.index), s.sql);
      prodForcedOld = await eqp(onProd, oldSql, s.args);
    } catch (e) {
      forceError = (e as Error).message;
    }
    kept.push({
      ...s,
      before,
      after,
      prodAfter,
      afterEqualsProd: JSON.stringify(prodAfter) === JSON.stringify(after),
      forced,
      oldSql,
      prodForcedOld,
      forcedOldEqualsBefore: prodForcedOld ? JSON.stringify(prodForcedOld) === JSON.stringify(before) : null,
      forceError,
    });
  }
  const keptSql = new Set(kept.map((k) => k.sql));
  say(`${kept.length} of ${all.length} distinct (sql, args) plan differently, ${keptSql.size} distinct SQL texts`);
  for (const k of kept) {
    say("");
    say(`-- ${k.key} · ${k.labels.join(" ; ")}`);
    say(`   site: ${k.stacks[0] ?? "(no app frame)"}`);
    say(`   sql:  ${oneLine(k.sql).slice(0, 400)}`);
    say(`   args: ${JSON.stringify(k.args).slice(0, 200)}`);
    say(`   before: ${k.before.join(" | ")}`);
    say(`   after:  ${k.after.join(" | ")}`);
    say(`   prod:   ${k.prodAfter.join(" | ")} · ${k.afterEqualsProd ? "= after" : "DIFFERS from after"}`);
    say(`   forced old (${k.forced.map((f) => `${f.name} → ${f.index ?? "NOT INDEXED"}`).join(", ")}): ${k.prodForcedOld ? `${k.prodForcedOld.join(" | ")} · ${k.forcedOldEqualsBefore ? "= before" : "DIFFERS from before"}` : `not built: ${k.forceError}`}`);
  }
  withC.close();
  withoutC.close();
  say("");
  say(`statements through the guard: ${guarded} · refusals: ${refusals} (the two controls)`);
  flush("diff-832", { clock: new Date(clock).toISOString(), control, wide, total: all.length, bills: bills.length, unhinted: unhinted.length, namesNew: namesNew.map((s) => s.key), kept, guard: { guarded, refusals } });
}

// ---- seek terms → a COUNT of the rows the index hands over ------------------------------
// The WHERE's top-level AND terms (outside parentheses), each with its `?` args.
type Term = { text: string; args: InArgs; cols: string[] };
function whereTerms(sql: string, args: InArgs): Term[] {
  const code = codeOnly(sql);
  // The outermost WHERE: the last one at paren depth 0.
  let depth = 0;
  let whereAt = -1;
  for (let i = 0; i < code.length; i++) {
    const c = code[i];
    if (c === "(") depth++;
    else if (c === ")") depth--;
    else if (depth === 0 && /^WHERE\b/i.test(code.slice(i, i + 6)) && /\W/.test(code[i - 1] ?? " ")) whereAt = i;
  }
  if (whereAt < 0) return [];
  let end = code.length;
  depth = 0;
  for (let i = whereAt + 5; i < code.length; i++) {
    const c = code[i];
    if (c === "(") depth++;
    else if (c === ")") depth--;
    else if (depth === 0 && /^(ORDER\s+BY|GROUP\s+BY|LIMIT)\b/i.test(code.slice(i, i + 9)) && /\W/.test(code[i - 1] ?? " ")) {
      end = i;
      break;
    }
  }
  const qBefore = (code.slice(0, whereAt + 5).match(/\?/g) ?? []).length;
  const parts: { from: number; to: number }[] = [];
  depth = 0;
  let from = whereAt + 5;
  for (let i = from; i < end; i++) {
    const c = code[i];
    if (c === "(") depth++;
    else if (c === ")") depth--;
    else if (depth === 0 && /^\sAND\s/i.test(code.slice(i, i + 5))) {
      parts.push({ from, to: i });
      from = i + 4;
    }
  }
  parts.push({ from, to: end });
  const out: Term[] = [];
  let q = qBefore;
  const arr = args as unknown[];
  for (const p of parts) {
    const text = sql.slice(p.from, p.to).trim();
    const n = (code.slice(p.from, p.to).match(/\?/g) ?? []).length;
    const cols = [...new Set((codeOnly(text).match(/\b(?:bills\.|b\.)?(stage|is_ceremonial|latest_action_date|bill_type|summary|topics|cluster_id|sponsor_bioguide_id|sponsor_name|update_date|introduced_date|congress|stage_observed_at|id|title)\b/g) ?? []).map((x) => x.replace(/^(bills|b)\./, "")))];
    out.push({ text, args: arr.slice(q, q + n) as InArgs, cols });
    q += n;
  }
  return out;
}
const INDEX_COLS: Record<string, { cols: string[]; where: string | null }> = {};
async function loadIndexCols() {
  const s = readJson<{ billsIndexes: MasterRow[] }>("schema-832");
  for (const m of s.billsIndexes) {
    if (!m.sql) continue;
    const cm = /ON bills\(([^)]*)\)(?:\s+WHERE\s+(.*))?$/i.exec(oneLine(m.sql));
    if (cm) INDEX_COLS[m.name] = { cols: cm[1]!.split(",").map((c) => c.trim().split(/\s+/)[0]!), where: cm[2] ?? null };
  }
}
// The seek terms a plan line names, e.g. "(stage=? AND is_ceremonial=?)", give
// the columns; the statement's own WHERE terms on only those columns give the
// values. The count reads the index (INDEXED BY) under its partial predicate.
function handoverCount(acc: Access, sql: string, args: InArgs): { sql: string; args: InArgs; note: string } | null {
  if (!acc.index || !INDEX_COLS[acc.index]) return null;
  const seekCols = acc.terms ? [...new Set((acc.terms.match(/\b(\w+)(?==|>|<| IN)/g) ?? []).map((x) => x.trim()))] : [];
  const terms = whereTerms(sql, args).filter((t) => t.cols.length > 0 && t.cols.every((c) => seekCols.includes(c)));
  const pred = INDEX_COLS[acc.index]!.where;
  const clauses = [pred, ...terms.map((t) => t.text.replace(/\bbills\./g, ""))].filter(Boolean) as string[];
  return {
    sql: `SELECT COUNT(*) AS n FROM bills INDEXED BY ${acc.index}${clauses.length ? ` WHERE ${clauses.join(" AND ")}` : ""}`,
    args: terms.flatMap((t) => t.args as unknown[]) as InArgs,
    note: `seeks on ${seekCols.join(", ") || "nothing (a scan)"}; terms ${terms.map((t) => oneLine(t.text)).join(" AND ") || "none"}${pred ? `; the index's predicate ${pred}` : ""}`,
  };
}

// ---- timing ------------------------------------------------------------------------------
const ms3 = (x: number) => Math.round(x * 10) / 10;
async function timed(sql: string, args: InArgs): Promise<{ ms: number; rows: Row[] }> {
  const t0 = performance.now();
  const rs = await prod.execute({ sql, args });
  return { ms: ms3(performance.now() - t0), rows: rs.rows as unknown as Row[] };
}
const rowsHash = (rows: Row[]) => sha(JSON.stringify(rows.map((r) => Object.values(r))));
// One first run in a fresh process: this script again, mode `first`, which runs
// the statement once and prints one JSON line.
function firstRun(sql: string, args: InArgs): { ms: number; connect: number; at: string; rows: number; hash: string } {
  const f = path.join(DIR, `first-${sha(sql + JSON.stringify(args))}.json`);
  writeFileSync(f, JSON.stringify({ sql, args }));
  const r = spawnSync(process.execPath, [...process.execArgv, process.argv[1]!, "first", DIR, f], { encoding: "utf8", env: process.env, timeout: 120_000 });
  rmSync(f);
  const line = (r.stdout ?? "").trim().split("\n").pop() ?? "";
  try {
    return JSON.parse(line);
  } catch {
    throw new Error(`first run failed: ${redactSecrets((r.stderr ?? "").slice(0, 300))}`);
  }
}
async function modeFirst() {
  const f = rest[0]!;
  const { sql, args } = JSON.parse(readFileSync(f, "utf8")) as { sql: string; args: InArgs };
  // A fresh process opens a fresh connection: SELECT 1 first takes that cost,
  // so the statement's time is its own (both are printed).
  const connect = (await timed("SELECT 1 AS one", [])).ms;
  const at = Date.now();
  const r = await timed(sql, args);
  console.log(JSON.stringify({ ms: r.ms, connect, at: mst(at), rows: r.rows.length, hash: rowsHash(r.rows), guarded }));
}
async function rtt(): Promise<number[]> {
  const out: number[] = [];
  for (let i = 0; i < 3; i++) out.push((await timed("SELECT 1 AS one", [])).ms);
  return out;
}

async function billsRoot(): Promise<number> {
  return Number((await pq(`SELECT rootpage FROM sqlite_master WHERE type = 'table' AND name = 'bills'`))[0]!.rootpage);
}
async function billsCols(): Promise<string[]> {
  const c = openLocal(COPY_WITH);
  const cols = (await lq(c, `SELECT name FROM pragma_table_info('bills') ORDER BY cid`)).map((r) => String(r.name));
  c.close();
  return cols;
}

async function modeTime() {
  await loadIndexCols();
  const diff = readJson<{ kept: Kept[] }>("diff-832");
  const clock = Date.now();
  say(`HO 832 plans probe · time · ${mst(clock)} · prod, read-only · ${diff.kept.length} kept statements`);
  const root = await billsRoot();
  const cols = await billsCols();
  const withoutC = openLocal(COPY_WITHOUT);
  say(`bills' root page on prod ${root}; ${cols.length} columns`);
  say(`round trip, SELECT 1 ×3: ${(await rtt()).join(", ")} ms`);
  const out: unknown[] = [];
  // `time <dir> [n]`: the first n kept statements only (a trial run).
  const limit = rest[0] ? Number(rest[0]) : Infinity;
  let i = 0;
  for (const k of diff.kept) {
    i++;
    if (i > limit) break;
    if (!k.oldSql) {
      say(`-- ${k.key}: no forced old form (${k.forceError}); skipped`);
      continue;
    }
    say("");
    say(`-- ${k.key} · ${k.labels[0]}${k.labels.length > 1 ? ` (+${k.labels.length - 1} more inputs)` : ""}`);
    const names = new Set(k.refs.map((r) => r.name));
    // Columns read from the table, by opcode, on prod (each plan) and on the copy (before).
    const opsNew = await opcodes(onProd, k.sql, k.args);
    const opsOld = await opcodes(onProd, k.oldSql, k.args);
    const opsCopyBefore = await opcodes(onLocal(withoutC), k.sql, k.args);
    const rNew = tableReads(opsNew, root, cols);
    const rOld = tableReads(opsOld, root, cols);
    const copyRoot = Number((await lq(withoutC, `SELECT rootpage FROM sqlite_master WHERE type = 'table' AND name = 'bills'`))[0]!.rootpage);
    const rCopy = tableReads(opsCopyBefore, copyRoot, cols);
    say(`   table columns read · old (forced, prod): ${readsText(rOld)}`);
    say(`   table columns read · new (prod):         ${readsText(rNew)}`);
    say(`   cross-check · before on copy-without.db: ${readsText(rCopy)} · ${JSON.stringify([...rCopy.columns].sort()) === JSON.stringify([...rOld.columns].sort()) ? "same columns as the forced old on prod" : "DIFFERENT columns from the forced old on prod"}`);
    // The rows each plan's index hands over.
    const hand: Record<string, unknown> = {};
    for (const [way, plan] of [["old", k.prodForcedOld!], ["new", k.prodAfter]] as const) {
      const acc = accesses(plan, names).find((a) => a.index);
      const hc = acc ? handoverCount(acc, k.sql, k.args) : null;
      if (!hc) {
        hand[way] = { note: "no index access on bills to count" };
        say(`   rows handed over · ${way}: — (no index access on bills)`);
        continue;
      }
      const t = await timed(hc.sql, hc.args);
      const n = Number(t.rows[0]!.n);
      hand[way] = { n, ...hc };
      say(`   rows handed over · ${way} (${acc!.index}): ${n} · ${hc.note}`);
    }
    // First runs, each in a fresh process; the order alternates by statement.
    const order = i % 2 ? (["old", "new"] as const) : (["new", "old"] as const);
    const first: Record<string, unknown> = {};
    for (const way of order) {
      const r = firstRun(way === "old" ? k.oldSql : k.sql, k.args);
      first[way] = r;
      say(`   first run · ${way} (fresh process, ${r.at}; its SELECT 1 first ${r.connect} ms): ${r.ms} ms · ${r.rows} rows`);
    }
    // Three warm runs each, interleaved.
    const warm: Record<"old" | "new", number[]> = { old: [], new: [] };
    const hashes: Record<"old" | "new", string[]> = { old: [], new: [] };
    const counts: Record<"old" | "new", number> = { old: 0, new: 0 };
    for (let j = 0; j < 3; j++) {
      for (const way of ["old", "new"] as const) {
        const r = await timed(way === "old" ? k.oldSql : k.sql, k.args);
        warm[way].push(r.ms);
        hashes[way].push(rowsHash(r.rows));
        counts[way] = r.rows.length;
      }
    }
    const same = new Set([...hashes.old, ...hashes.new]).size === 1;
    say(`   warm · old: ${warm.old.join(", ")} ms · new: ${warm.new.join(", ")} ms`);
    say(`   result check: ${same ? `equal (${counts.new} rows, hash ${hashes.new[0]})` : `DIFFERENT (old ${counts.old} rows ${[...new Set(hashes.old)].join("/")}, new ${counts.new} rows ${[...new Set(hashes.new)].join("/")})`}`);
    out.push({ key: k.key, labels: k.labels, readsOld: rOld, readsNew: rNew, readsCopyBefore: rCopy, hand, first, warm, same, rows: counts });
  }
  withoutC.close();
  say("");
  say(`round trip, SELECT 1 ×3: ${(await rtt()).join(", ")} ms`);
  say(`statements through the guard: ${guarded} · refusals: ${refusals} (the two controls)`);
  flush("time-832", { clock: new Date(clock).toISOString(), root, out, guard: { guarded, refusals } });
}

// ---- § 2, /stale's row list -------------------------------------------------------------
async function modeStale() {
  await loadIndexCols();
  const Q = await import("../../lib/queries");
  const clock = Date.now();
  say(`HO 832 plans probe · stale (§ 2) · ${mst(clock)} · prod, read-only`);
  const root = await billsRoot();
  const cols = await billsCols();
  say(`round trip, SELECT 1 ×3: ${(await rtt()).join(", ")} ms`);
  // The statements, as getStaleBills builds them: captured dry, so this mode
  // runs none before its timed first run. The capture mode, run earlier, may
  // have (at HO 832 it had run five of the six about ten minutes before).
  const forms: [string, Record<string, unknown>][] = [
    ["default group · all", {}],
    ["default group · house", { chamber: "house" }],
    ["default group · senate", { chamber: "senate" }],
    ["stage=committee · all", { stage: "committee" }],
    ["stage=committee · house", { stage: "committee", chamber: "house" }],
    ["stage=committee · senate", { stage: "committee", chamber: "senate" }],
  ];
  const stmts: { label: string; sql: string; args: InArgs }[] = [];
  dry = true;
  for (const [label, f] of forms) {
    const got: { sql: string; args: InArgs }[] = [];
    recorder = (c) => got.push({ sql: c.sql, args: c.args });
    await Q.getStaleBills(f as never, 50);
    recorder = null;
    if (got.length !== 1) throw new Error(`${label}: getStaleBills sent ${got.length} statements`);
    stmts.push({ label, ...got[0]! });
  }
  dry = false;
  const out: unknown[] = [];
  for (const s of stmts) {
    say("");
    say(`-- getStaleBills · ${s.label}`);
    say(`   sql: ${oneLine(s.sql).slice(0, 700)}`);
    say(`   args: ${JSON.stringify(s.args)}`);
    // First run first, in a fresh process.
    const first = firstRun(s.sql, s.args);
    say(`   first run (fresh process, ${first.at}; its SELECT 1 first ${first.connect} ms): ${first.ms} ms · ${first.rows} rows`);
    const plan = await eqp(onProd, s.sql, s.args);
    const reads = tableReads(await opcodes(onProd, s.sql, s.args), root, cols);
    say(`   plan: ${plan.join(" | ")}`);
    say(`   table columns read: ${readsText(reads)}`);
    const warm: number[] = [];
    let ids: string[] = [];
    for (let j = 0; j < 3; j++) {
      const r = await timed(s.sql, s.args);
      warm.push(r.ms);
      ids = r.rows.map((x) => String(x.id));
    }
    say(`   warm ×3: ${warm.join(", ")} ms · returns ${ids.length} rows`);
    // Rows the index hands over, and rows matching the whole WHERE.
    const hint = /FROM bills INDEXED BY (\w+)/.exec(s.sql)![1]!;
    const acc = accesses(plan, new Set(["bills"])).find((a) => a.index === hint);
    const hc = acc ? handoverCount(acc, s.sql, s.args) : null;
    let handed: number | null = null;
    if (hc) {
      handed = Number((await timed(hc.sql, hc.args)).rows[0]!.n);
      say(`   rows the index hands over (${hint}): ${handed} · ${hc.note}`);
    }
    // The pieces: the FROM's joins, the WHERE, the ORDER BY, each found at
    // parenthesis depth 0 (the mention subquery carries its own WHERE).
    const code = codeOnly(s.sql);
    const head = `FROM bills INDEXED BY ${hint}`;
    const from = code.indexOf(head);
    const at = (kw: RegExp, after: number) => {
      let depth = 0;
      for (let i = after; i < code.length; i++) {
        const c = code[i];
        if (c === "(") depth++;
        else if (c === ")") depth--;
        else if (depth === 0 && /\W/.test(code[i - 1] ?? " ") && kw.test(code.slice(i, i + 12))) return i;
      }
      return -1;
    };
    const whereAt = at(/^WHERE\b/, from + head.length);
    const orderAt = at(/^ORDER\s+BY\b/, whereAt);
    const limitAt = at(/^LIMIT \?/, orderAt);
    if (from < 0 || whereAt < 0 || orderAt < 0 || limitAt < 0) throw new Error(`${s.label}: the statement's shape moved`);
    const joins = s.sql.slice(from + head.length, whereAt);
    const where = s.sql.slice(whereAt + 5, orderAt);
    const orderBy = s.sql.slice(orderAt, limitAt).replace(/^ORDER\s+BY/, "");
    const qIn = (x: string) => (codeOnly(x).match(/\?/g) ?? []).length;
    const selectQ = qIn(s.sql.slice(0, s.sql.indexOf("FROM bills INDEXED BY")));
    const joinQ = qIn(joins);
    const whereArgs = (s.args as unknown[]).slice(selectQ + joinQ, selectQ + joinQ + qIn(where)) as InArgs;
    const limitArg = (s.args as unknown[]).slice(-1) as InArgs;
    const pieces: [string, string, InArgs][] = [
      ["a · COUNT(*) over the WHERE, no joins (the rows the sort takes)", `SELECT COUNT(*) AS n FROM bills INDEXED BY ${hint} WHERE ${where}`, whereArgs],
      ["b · SELECT id, the WHERE, ORDER BY, LIMIT, no joins", `SELECT id FROM bills INDEXED BY ${hint} WHERE ${where} ORDER BY ${orderBy} LIMIT ?`, [...(whereArgs as unknown[]), ...(limitArg as unknown[])] as InArgs],
      ["c · as b, with the statement's joins", `SELECT bills.id FROM bills INDEXED BY ${hint}${joins} WHERE ${where} ORDER BY ${orderBy} LIMIT ?`, [...((s.args as unknown[]).slice(selectQ, selectQ + joinQ)), ...(whereArgs as unknown[]), ...(limitArg as unknown[])] as InArgs],
    ];
    const split: Record<string, unknown> = {};
    for (const [label, sql, args] of pieces) {
      const p = await eqp(onProd, sql, args);
      const t: number[] = [];
      let n: number | null = null;
      for (let j = 0; j < 3; j++) {
        const r = await timed(sql, args);
        t.push(r.ms);
        n = label.startsWith("a") ? Number(r.rows[0]!.n) : r.rows.length;
      }
      split[label] = { plan: p, warm: t, n };
      say(`   ${label}: ${t.join(", ")} ms · ${label.startsWith("a") ? `${n} rows match` : `${n} rows`} · plan ${p.join(" | ")}`);
    }
    // The candidate, read only: the same statement on the new index.
    const candSql = s.sql.replace(`FROM bills INDEXED BY ${hint}`, `FROM bills INDEXED BY ${NEW_INDEX}`);
    const cPlan = await eqp(onProd, candSql, s.args);
    const cReads = tableReads(await opcodes(onProd, candSql, s.args), root, cols);
    const cWarm: number[] = [];
    let cIds: string[] = [];
    for (let j = 0; j < 3; j++) {
      const r = await timed(candSql, s.args);
      cWarm.push(r.ms);
      cIds = r.rows.map((x) => String(x.id));
    }
    const cAcc = accesses(cPlan, new Set(["bills"])).find((a) => a.index === NEW_INDEX);
    const cHc = cAcc ? handoverCount(cAcc, s.sql, s.args) : null;
    const cHanded = cHc ? Number((await timed(cHc.sql, cHc.args)).rows[0]!.n) : null;
    const sameIds = JSON.stringify(cIds) === JSON.stringify(ids);
    say(`   candidate INDEXED BY ${NEW_INDEX}: plan ${cPlan.join(" | ")}`);
    say(`      table columns read: ${readsText(cReads)}`);
    say(`      rows the index hands over: ${cHanded ?? "—"}${cHc ? ` · ${cHc.note}` : ""}`);
    say(`      warm ×3: ${cWarm.join(", ")} ms · ${cIds.length} ids · the ids and their order ${sameIds ? "EQUAL the current form's" : "DIFFER from the current form's"}`);
    if (!sameIds) {
      const firstDiff = cIds.findIndex((x, j) => x !== ids[j]);
      say(`      first difference at position ${firstDiff}: current ${ids[firstDiff]} · candidate ${cIds[firstDiff]}`);
    }
    out.push({ ...s, first, plan, reads, warm, rows: ids.length, ids, handed, split, candidate: { sql: candSql, plan: cPlan, reads: cReads, warm: cWarm, handed: cHanded, ids: cIds, sameIds } });
  }
  say("");
  say(`statements through the guard: ${guarded} · refusals: ${refusals} (the two controls)`);
  flush("stale-832", { clock: new Date(clock).toISOString(), out, guard: { guarded, refusals } });
}

// ---- § 3, /bills' search count under a stage filter -----------------------------------
async function modeSearch() {
  const Q = await import("../../lib/queries");
  const clock = Date.now();
  say(`HO 832 plans probe · search (§ 3) · ${mst(clock)} · prod, read-only`);
  say(`round trip, SELECT 1 ×3: ${(await rtt()).join(", ")} ms`);
  const terms = (rest[0] ?? "tax,veterans,border,energy,water").split(",");
  const stage = rest[1] ?? "committee";
  const out: unknown[] = [];
  let shown = false;
  for (const term of terms) {
    const got: { sql: string; args: InArgs }[] = [];
    dry = true;
    recorder = (c) => got.push({ sql: c.sql, args: c.args });
    await Q.getFeedBills({ stage, q: term } as never);
    recorder = null;
    dry = false;
    const count = got.find((g) => /^\s*SELECT COUNT\(\*\)/i.test(g.sql));
    if (!count) throw new Error(`no count statement for ${term}`);
    // The full-text side driving: CROSS JOIN fixes the join order in SQLite, so
    // bills_fts is the outer loop and bills is read by rowid.
    const fts = count.sql.replace(/FROM bills_fts JOIN bills ON/, "FROM bills_fts CROSS JOIN bills ON");
    if (fts === count.sql) throw new Error("the count's FROM moved");
    const plan = await eqp(onProd, count.sql, count.args);
    const ftsPlan = await eqp(onProd, fts, count.args);
    say("");
    say(`-- stage=${stage} q=${term}`);
    if (!shown) {
      say(`   sql: ${oneLine(count.sql)}`);
      say(`   args: ${JSON.stringify(count.args)}`);
      // What else would make the planner drive from the full-text side: each read as a plan only.
      for (const [label, alt] of [
        ["bills NOT INDEXED", count.sql.replace(/JOIN bills ON/, "JOIN bills NOT INDEXED ON")],
        ["unary + on the stage term", count.sql.replace(/bills\.stage = \?/, "+bills.stage = ?")],
        ["CROSS JOIN", fts],
      ] as const) {
        say(`   alternative · ${label}: ${(await eqp(onProd, alt, count.args)).join(" | ")}`);
      }
      shown = true;
    }
    const first = { planner: firstRun(count.sql, count.args), fts: firstRun(fts, count.args) };
    const warm: Record<"planner" | "fts", number[]> = { planner: [], fts: [] };
    const n: Record<"planner" | "fts", number[]> = { planner: [], fts: [] };
    for (let j = 0; j < 3; j++) {
      for (const way of ["planner", "fts"] as const) {
        const r = await timed(way === "planner" ? count.sql : fts, count.args);
        warm[way].push(r.ms);
        n[way].push(Number(r.rows[0]!.n));
      }
    }
    const same = new Set([...n.planner, ...n.fts]).size === 1;
    say(`   plan as the planner picks: ${plan.join(" | ")}`);
    say(`   plan with the full-text side driving (CROSS JOIN): ${ftsPlan.join(" | ")}`);
    say(`   first run (fresh process; SELECT 1 first ${first.planner.connect} / ${first.fts.connect} ms) · planner ${first.planner.ms} ms at ${first.planner.at} · fts ${first.fts.ms} ms at ${first.fts.at}`);
    say(`   warm ×3 · planner ${warm.planner.join(", ")} ms · fts ${warm.fts.join(", ")} ms`);
    say(`   count · planner ${n.planner[0]} · fts ${n.fts[0]} · ${same ? "equal" : "DIFFERENT"}`);
    out.push({ term, stage, sql: count.sql, args: count.args, fts, plan, ftsPlan, first, warm, n, same });
  }
  say("");
  say(`statements through the guard: ${guarded} · refusals: ${refusals} (the two controls)`);
  flush(`search-832-${stage}`, { clock: new Date(clock).toISOString(), out, guard: { guarded, refusals } });
}

// ---- § 2's slow requests: the crons that ended in the ten minutes before each -----
// `slowctx <dir> <slots.tsv>`: each slot (UTC, from the Vercel MCP drill) beside
// every cron_runs row that ended in the ten minutes before the slot's end. The
// routes that write bills rows are marked: /api/sync (the bills sync),
// /api/cron/summarize, /api/cron/committees and /api/cron/bill-rosters.
async function modeSlowCtx() {
  const file = rest[0];
  if (!file) throw new Error("usage: slowctx <dir> <slots.tsv>");
  const WRITES_BILLS = new Set(["/api/sync", "/api/cron/summarize", "/api/cron/committees", "/api/cron/bill-rosters"]);
  const slots = readFileSync(file, "utf8")
    .split(/\r?\n/)
    .filter((l) => l && !l.startsWith("#"))
    .map((l) => l.split("\t"))
    .map(([slot, n, max]) => ({ slot: slot!, n: Number(n), max: Number(max) }));
  const clock = Date.now();
  say(`HO 832 plans probe · slowctx · ${mst(clock)} · prod cron_runs, read-only · ${slots.length} slots`);
  const out: unknown[] = [];
  for (const s of slots) {
    const end = Date.parse(s.slot) + 10_000;
    const from = new Date(end - 10 * 60_000 - 10_000).toISOString();
    const to = new Date(end).toISOString();
    const rows = await pq(
      `SELECT route, started_at, ended_at, elapsed_ms, status FROM cron_runs WHERE ended_at >= ? AND ended_at <= ? ORDER BY ended_at`,
      [from, to],
    );
    const inflight = await pq(
      `SELECT route, started_at, ended_at, elapsed_ms, status FROM cron_runs WHERE started_at <= ? AND (ended_at IS NULL OR ended_at > ?) AND started_at >= ? ORDER BY started_at`,
      [to, to, new Date(end - 3_600_000).toISOString()],
    );
    const fmt = (r: Row) => `${String(r.route)}${WRITES_BILLS.has(String(r.route)) ? " [writes bills]" : ""} ${mst(String(r.started_at)).slice(11, 19)}→${r.ended_at ? mst(String(r.ended_at)).slice(11, 19) : "—"} ${String(r.elapsed_ms ?? "—")} ms ${String(r.status)}`;
    const billsSync = rows.some((r) => String(r.route) === "/api/sync");
    say(`${s.slot} (${mst(s.slot).slice(5, 19)}) n=${s.n} max ${s.max} ms · ended in the 10 min before: ${rows.length ? rows.map(fmt).join("; ") : "none"} · the bills sync: ${billsSync ? "YES" : "no"} · in flight at the slot: ${inflight.length ? inflight.map(fmt).join("; ") : "none"}`);
    out.push({ ...s, ended: rows, inflight, billsSync });
  }
  say(`statements through the guard: ${guarded} · refusals: ${refusals} (the two controls)`);
  flush("slowctx-832", { clock: new Date(clock).toISOString(), out, guard: { guarded, refusals } });
}

// ---- § 1's table reads, per stage --------------------------------------------------------
// Both plans seek (stage=?) under summary IS NOT NULL, so each hands over the
// stage's summarized rows. In prod's bytecode (the `listing` mode, shapes 2
// and 4 at committee) the ceremonial test reads the index (is_ceremonial is its
// second column) before any Column on the table cursor, so a plan that reads a
// table column reads it for the rows that pass that test: the stage's summarized
// non-ceremonial rows. A cluster filter drops the ceremonial gate, so there
// every handed-over row is read.
async function modeTableRows() {
  const clock = Date.now();
  say(`HO 832 plans probe · tablerows · ${mst(clock)} · prod, read-only`);
  const out: unknown[] = [];
  for (const stage of ["introduced", "committee", "floor", "other_chamber", "president", "enacted"]) {
    const r = (
      await pq(
        `SELECT COUNT(*) AS handed, SUM(CASE WHEN is_ceremonial = 0 OR is_ceremonial IS NULL THEN 1 ELSE 0 END) AS nonceremonial FROM bills INDEXED BY idx_bills_summary_stage_topics WHERE summary IS NOT NULL AND stage = ?`,
        [stage],
      )
    )[0]!;
    say(`  ${stage.padEnd(14)} handed over ${String(r.handed).padStart(6)} · non-ceremonial (the table rows read) ${String(r.nonceremonial).padStart(6)}`);
    out.push({ stage, handed: Number(r.handed), nonceremonial: Number(r.nonceremonial) });
  }
  say(`statements through the guard: ${guarded} · refusals: ${refusals} (the two controls)`);
  flush("tablerows-832", { clock: new Date(clock).toISOString(), out, guard: { guarded, refusals } });
}

// ---- § 2's single-stage form: the index entries walked before the LIMIT fills ---
// It walks idx_bills_latest_action in date order from the oldest dated row and
// sorts only the last term (id), so it reads every entry dated on or before the
// 50th row's date. Read from stale-832.json's ids.
async function modeWalk() {
  const st = readJson<{ out: { label: string; ids: string[] }[] }>("stale-832");
  const clock = Date.now();
  say(`HO 832 plans probe · walk · ${mst(clock)} · prod, read-only`);
  const out: unknown[] = [];
  for (const s of st.out.filter((x) => x.label.startsWith("stage=committee"))) {
    const ph = s.ids.map(() => "?").join(",");
    const last = String((await pq(`SELECT MAX(latest_action_date) AS d FROM bills WHERE id IN (${ph})`, s.ids))[0]!.d);
    const n = Number((await pq(`SELECT COUNT(*) AS n FROM bills INDEXED BY idx_bills_latest_action WHERE latest_action_date IS NOT NULL AND latest_action_date <= ?`, [last]))[0]!.n);
    say(`  getStaleBills · ${s.label}: the 50th row's date ${last} · entries walked (dated on or before it) ${n}`);
    out.push({ label: s.label, last, walked: n });
  }
  say(`statements through the guard: ${guarded} · refusals: ${refusals} (the two controls)`);
  flush("walk-832", { clock: new Date(clock).toISOString(), out, guard: { guarded, refusals } });
}

// ---- the listings behind two readings -------------------------------------------
// `listing <dir>`, on prod: (1) the full EXPLAIN listing (addr, opcode, p1-p3)
// of shapes 2 and 4 at stage=committee, each plan (the new one as picked, the
// old one forced), so the order of the ceremonial test (a Column on the index
// cursor) against the first Column on the table cursor is read, not inferred;
// (2) the plan of /bills' row SELECT under stage=committee&q=tax, as captured.
async function modeListing() {
  const diff = readJson<{ kept: Kept[] }>("diff-832");
  const cap = readJson<{ captured: Captured[] }>("capture-832");
  const clock = Date.now();
  say(`HO 832 plans probe · listing · ${mst(clock)} · prod, read-only`);
  const root = await billsRoot();
  const out: unknown[] = [];
  for (const [shape, re] of [
    ["2 (house)", /bill_type IN \('hr','hjres','hconres','hres'\)/],
    ["4 (topic)", /topics LIKE \?/],
  ] as const) {
    const k = diff.kept.find((x) => /^\s*SELECT COUNT/.test(x.sql) && re.test(x.sql) && (x.args as unknown[]).includes("committee") && !x.sql.includes("bills_fts"));
    if (!k || !k.oldSql) throw new Error(`no kept statement for shape ${shape}`);
    for (const [way, sql] of [["new (as picked)", k.sql], ["old (forced)", k.oldSql]] as const) {
      const ops = await opcodes(onProd, sql, k.args);
      const tableCur = new Set(ops.filter((o) => o.opcode === "OpenRead" && o.p2 === root && o.p3 === 0).map((o) => o.p1));
      const idxCur = new Set(ops.filter((o) => o.opcode === "OpenRead" && o.p2 !== root).map((o) => o.p1));
      const firstTable = ops.find((o) => o.opcode === "Column" && tableCur.has(o.p1));
      const firstIdx = ops.find((o) => o.opcode === "Column" && idxCur.has(o.p1));
      say("");
      say(`-- shape ${shape} · stage=committee · ${way}`);
      say(`   sql: ${oneLine(sql)}`);
      say(`   table cursor(s) ${[...tableCur].join(",") || "none"} · index cursor(s) ${[...idxCur].join(",")} · first Column on an index cursor at addr ${firstIdx?.addr ?? "—"} · first Column on the table cursor at addr ${firstTable?.addr ?? "— (none)"}`);
      for (const o of ops) say(`   ${String(o.addr).padStart(3)} ${o.opcode.padEnd(14)} ${o.p1} ${o.p2} ${o.p3} ${o.p4.slice(0, 24)}`);
      out.push({ shape, way, sql, ops, tableCur: [...tableCur], idxCur: [...idxCur], firstIdx: firstIdx?.addr ?? null, firstTable: firstTable?.addr ?? null });
    }
  }
  const sel = cap.captured.find((c) => c.label === "/bills stage=committee&q=tax · getFeedBills" && /^\s*SELECT bills\.id/.test(c.sql));
  if (!sel) throw new Error("no captured row SELECT for stage=committee&q=tax");
  const selPlan = await eqp(onProd, sel.sql, sel.args);
  say("");
  say(`-- /bills stage=committee&q=tax · the row SELECT, as captured · args ${JSON.stringify(sel.args)}`);
  say(`   plan: ${selPlan.join(" | ")}`);
  say(`statements through the guard: ${guarded} · refusals: ${refusals} (the two controls)`);
  flush("listing-832", { clock: new Date(clock).toISOString(), out, rowSelect: { args: sel.args, plan: selPlan }, guard: { guarded, refusals } });
}

if (mode === "schema") await modeSchema();
else if (mode === "listing") await modeListing();
else if (mode === "walk") await modeWalk();
else if (mode === "slowctx") await modeSlowCtx();
else if (mode === "tablerows") await modeTableRows();
else if (mode === "capture") await modeCapture();
else if (mode === "diff") await modeDiff();
else if (mode === "time") await modeTime();
else if (mode === "stale") await modeStale();
else if (mode === "search") await modeSearch();
else if (mode === "first") await modeFirst();
else throw new Error(`unknown mode ${mode}`);
