// HO 833 — every plan this repo pins on `bills` under a stage, read on prod's
// store. It was check:stale-count-plan (HO 831), which is now its first case.
//
// Each case takes the statement the app's own builder makes (lib/queries.ts,
// which the loaders execute) and reads it on prod:
//
//   0. The two stalled-bill counts (staleCommitteeCountQuery,
//      staleBillsCountQuery), unfiltered and per chamber: the plan reads
//      `USING COVERING INDEX idx_bills_summary_stage_stale`, so no table row is
//      read (HO 831).
//   1. /stale's row list (staleBillsQuery), per stage in STALE_FILTER_STAGES: it
//      drives from the index HO 833's rule picked for that stage. A stage
//      takes idx_bills_summary_stage_stale when that plan fetches fewer than half
//      the table rows the date walk on idx_bills_latest_action passes, with the
//      same rows in the same order. Read on prod at 3eb0291, only `committee`
//      keeps the walk (161 rows against 14,947); `introduced`, `floor` and
//      `other_chamber` move (8,692 against 94, 9,059 against 252, 3,209 against
//      550). A stage missing from EXPECTED fails: read the rule for it first.
//   2. The same row list, per stage: it returns in under 2 s on prod, three
//      runs, and its plan fetches no more than 2,000 table rows, by a COUNT.
//      The timing is a smoke bound. The row count is what catches a date walk
//      on a rare stage, whatever the store has cached: warm, 9,059 rows hid
//      inside 64 to 97 ms, and Production read 4.4 to 4.6 s.
//   3. /bills' COUNT under a stage and one topic (feedCountQuery), per stage in
//      ALLOWED_STAGES: it plans on idx_bills_summary_stage_topics and its
//      opcodes read no column from bills' table b-tree.
//   4. /bills' search COUNT under a stage (feedSearchCountQuery), per stage, one
//      term: the plan's outer loop is bills_fts.
//
// What a plan reads from the table comes from EXPLAIN's opcodes: an OpenRead on
// bills' root page, and each Column on that cursor. A plan's label isn't a
// reading (HO 831).
//
// It sends only reads: EXPLAIN QUERY PLAN, EXPLAIN, the row list itself,
// COUNTs, and two schema reads (bills' root page from sqlite_master, its columns
// from pragma_table_info), each refused unless it starts with SELECT or EXPLAIN
// and names no write word. It reads prod's store, so it isn't in ci.yml (CI's checks are
// secretless). Run it at any HO that edits buildFeedWhere, buildStaleWhere,
// getFeedBills, getStaleBills or either stalled-bill count, or that adds an
// index on bills.
//
//   npm run check:bills-plans
import "dotenv/config";
import type { InArgs } from "@libsql/client";
import { getDb } from "../lib/db";
import { ALLOWED_STAGES } from "../lib/enums";
import {
  STALE_DAYS,
  STALE_FILTER_STAGES,
  buildBillsFtsMatch,
  buildStaleWhere,
  feedCountQuery,
  feedSearchCountQuery,
  staleBillsCountQuery,
  staleBillsQuery,
  staleCommitteeCountQuery,
} from "../lib/queries";

const STALE_INDEX = "idx_bills_summary_stage_stale";
const DATE_INDEX = "idx_bills_latest_action";
const TOPICS_INDEX = "idx_bills_summary_stage_topics";
// Case 1: the index HO 833's rule picked per stage (see above).
const EXPECTED: Record<string, string> = {
  introduced: STALE_INDEX,
  committee: DATE_INDEX,
  floor: STALE_INDEX,
  other_chamber: STALE_INDEX,
};
const MAX_MS = 2000;
const MAX_TABLE_ROWS = 2000;
const TOPIC = "healthcare";
const TERM = "tax";

const READ_START = /^\s*(SELECT|EXPLAIN)\b/i;
const WRITE_WORD = /\b(INSERT|UPDATE|DELETE|UPSERT|CREATE|DROP|ALTER|ATTACH|DETACH|VACUUM|REINDEX|PRAGMA)\b/i;
type Row = Record<string, unknown>;
const db = getDb();
async function read(sql: string, args: InArgs = []): Promise<Row[]> {
  if (!READ_START.test(sql) || WRITE_WORD.test(sql)) throw new Error(`not a read: ${sql.slice(0, 80)}`);
  return (await db.execute({ sql, args })).rows as unknown as Row[];
}

let failed = 0;
let total = 0;
function report(ok: boolean, name: string, detail: string) {
  total++;
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}: ${detail}`);
}

async function plan(sql: string, args: InArgs): Promise<string[]> {
  return (await read(`EXPLAIN QUERY PLAN ${sql}`, args)).map((r) => String(r.detail));
}
// The bills line of a plan: `SEARCH bills USING [COVERING] INDEX <idx> (…)`.
function billsIndex(lines: string[]): string | null {
  for (const l of lines) {
    const m = /^(?:SEARCH|SCAN) bills USING (?:COVERING )?INDEX (\w+)/.exec(l);
    if (m) return m[1]!;
  }
  return null;
}
const root = Number((await read(`SELECT rootpage FROM sqlite_master WHERE type = 'table' AND name = 'bills'`))[0]!.rootpage);
const cols = (await read(`SELECT name FROM pragma_table_info('bills') ORDER BY cid`)).map((r) => String(r.name));
// The columns the bytecode reads from bills' table b-tree.
async function tableColumns(sql: string, args: InArgs): Promise<string[]> {
  const ops = (await read(`EXPLAIN ${sql}`, args)).map((r) => ({ opcode: String(r.opcode), p1: Number(r.p1), p2: Number(r.p2), p3: Number(r.p3) }));
  const cursors = new Set(ops.filter((o) => (o.opcode === "OpenRead" || o.opcode === "ReopenIdx") && o.p2 === root && o.p3 === 0).map((o) => o.p1));
  return [...new Set(ops.filter((o) => o.opcode === "Column" && cursors.has(o.p1)).map((o) => cols[o.p2] ?? `col${o.p2}`))];
}

// 0. The two stalled-bill counts (HO 831).
for (const [name, stmt] of [
  ["getStaleCommitteeCount · all", staleCommitteeCountQuery({})],
  ["getStaleCommitteeCount · house", staleCommitteeCountQuery({ chamber: "house" })],
  ["getStaleCommitteeCount · senate", staleCommitteeCountQuery({ chamber: "senate" })],
  ["getStaleBillsCount · all", staleBillsCountQuery()],
  ["getStaleBillsCount · house", staleBillsCountQuery("house")],
  ["getStaleBillsCount · senate", staleBillsCountQuery("senate")],
] as const) {
  const p = await plan(stmt.sql, stmt.args);
  report(new RegExp(`USING COVERING INDEX ${STALE_INDEX}\\b`).test(p.join(" | ")), `0 · ${name}`, p.join(" | "));
}

// 1 and 2. /stale's row list, per stage.
for (const stage of STALE_FILTER_STAGES) {
  const stmt = staleBillsQuery({ stage }, 50);
  const p = await plan(stmt.sql, stmt.args);
  const idx = billsIndex(p);
  const want = EXPECTED[stage];
  report(!!want && idx === want, `1 · getStaleBills · stage=${stage} · index`, want ? `drives from ${idx ?? "(no index)"}, want ${want}` : `no expected index for this stage: read HO 833's rule for it`);

  const ms: number[] = [];
  let ids: Row[] = [];
  for (let i = 0; i < 3; i++) {
    const t0 = performance.now();
    ids = await read(stmt.sql, stmt.args);
    ms.push(Math.round(performance.now() - t0));
  }
  // The table rows the plan fetches: the date walk reads one per entry it
  // passes, and it passes every entry dated on or before its last row's date
  // (it sorts only the last term, id), or the whole range below the cutoff
  // when fewer than 50 match. Any other index fetches one per entry that
  // passes the WHERE, if it holds every WHERE column (no WHERE column read from
  // the table); otherwise this case can't price it and fails.
  let rows: number | null = null;
  let how = "";
  if (idx === DATE_INDEX) {
    const cut = `latest_action_date IS NOT NULL AND latest_action_date < date('now', '-${STALE_DAYS} days')`;
    if (ids.length >= 50) {
      const last = String(ids[ids.length - 1]!.latest_action_date);
      rows = Number((await read(`SELECT COUNT(*) AS n FROM bills INDEXED BY ${DATE_INDEX} WHERE latest_action_date IS NOT NULL AND latest_action_date <= ?`, [last]))[0]!.n);
      how = `the date walk to ${last}`;
    } else {
      rows = Number((await read(`SELECT COUNT(*) AS n FROM bills INDEXED BY ${DATE_INDEX} WHERE ${cut}`))[0]!.n);
      how = `the date walk over every entry below the cutoff (${ids.length} match)`;
    }
  } else if (idx) {
    const { clauses, args } = buildStaleWhere({ stage });
    const where = clauses.join(" AND ");
    const whereCols = cols.filter((c) => new RegExp(`\\b${c}\\b`).test(where));
    const fromTable = (await tableColumns(stmt.sql, stmt.args)).filter((c) => whereCols.includes(c));
    if (fromTable.length === 0) {
      rows = Number((await read(`SELECT COUNT(*) AS n FROM bills INDEXED BY ${idx} WHERE ${where}`, args))[0]!.n);
      how = `the rows ${idx} passes to the table (every WHERE column is in it)`;
    } else {
      how = `${idx} leaves WHERE columns to the table (${fromTable.join(", ")}), so its fetches can't be counted here`;
    }
  }
  const okMs = ms.every((x) => x < MAX_MS);
  const okRows = rows !== null && rows <= MAX_TABLE_ROWS;
  report(okMs && okRows, `2 · getStaleBills · stage=${stage} · time and table rows`, `${ms.join(", ")} ms (each under ${MAX_MS}: ${okMs ? "yes" : "NO"}) · ${rows ?? "?"} table rows by ${how} (at most ${MAX_TABLE_ROWS}: ${okRows ? "yes" : "NO"})`);
}

// 3. /bills' COUNT under a stage and one topic.
for (const stage of ALLOWED_STAGES) {
  const stmt = feedCountQuery({ stage, topics: [TOPIC] });
  const p = await plan(stmt.sql, stmt.args);
  const idx = billsIndex(p);
  const fromTable = await tableColumns(stmt.sql, stmt.args);
  report(idx === TOPICS_INDEX && fromTable.length === 0, `3 · getFeedBills COUNT · stage=${stage} · topics=${TOPIC}`, `${p.join(" | ")} · table columns read: ${fromTable.length ? fromTable.join(", ") : "none"}`);
}

// 4. /bills' search COUNT under a stage.
const match = buildBillsFtsMatch(TERM);
if (!match) throw new Error(`no MATCH string for ${TERM}`);
for (const stage of ALLOWED_STAGES) {
  const stmt = feedSearchCountQuery({ stage, q: TERM }, match);
  const p = await plan(stmt.sql, stmt.args);
  const outer = /^(?:SCAN|SEARCH) (\w+)/.exec(p.find((l) => /^(?:SCAN|SEARCH) /.test(l)) ?? "")?.[1] ?? "?";
  report(outer === "bills_fts", `4 · getFeedBills search COUNT · stage=${stage} · q=${TERM}`, `outer loop ${outer} · ${p.join(" | ")}`);
}

console.log(failed ? `check:bills-plans FAILED: ${failed} of ${total} cases` : `check:bills-plans ok: ${total} of ${total} cases`);
process.exit(failed ? 1 : 0);
