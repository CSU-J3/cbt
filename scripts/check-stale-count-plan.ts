// HO 831 — both stalled-bill counts read a covering index on prod's store.
//
// getStaleCommitteeCount (/stale's footer) and getStaleBillsCount (the TOP
// STALLS badge on /) count buildStaleWhere's gate. Forced onto
// idx_bills_summary_stage (stage, is_ceremonial) WHERE summary IS NOT NULL,
// each read latest_action_date and bill_type from the table row of every
// non-ceremonial row the index found: of ~18k committee rows with a summary for
// the footer, of ~1.6k past-committee rows for the badge. That was fast on a
// warm store, and on Nov 23 at 2:05 PM MST Production's requests to the store
// hit the 10 s abort on /stale alone. idx_bills_summary_stage_stale (stage,
// is_ceremonial, latest_action_date, bill_type, summary) WHERE summary IS NOT
// NULL holds every column the gate names, unfiltered or by chamber, so the
// count never reads a table row.
//
// For each count, unfiltered and per chamber, the check takes the statement the
// app's own builder makes (staleCommitteeCountQuery / staleBillsCountQuery in
// lib/queries.ts, which the counts execute) and asserts that its plan on prod
// reads `USING COVERING INDEX idx_bills_summary_stage_stale`. It runs only
// EXPLAIN QUERY PLAN.
//
// It reads prod's store, so it isn't in ci.yml (CI's checks are secretless). Run
// it at any HO that edits buildStaleWhere, buildFeedWhere or either count.
//
//   npm run check:stale-count-plan
import "dotenv/config";
import { getDb } from "../lib/db";
import { staleBillsCountQuery, staleCommitteeCountQuery } from "../lib/queries";

const INDEX = "idx_bills_summary_stage_stale";
const WRITE_WORD = /\b(INSERT|UPDATE|DELETE|UPSERT|CREATE|DROP|ALTER|ATTACH|DETACH|VACUUM|REINDEX|PRAGMA)\b/i;

const cases: Array<[string, { sql: string; args: (string | number)[] }]> = [
  ["getStaleCommitteeCount · all", staleCommitteeCountQuery({})],
  ["getStaleCommitteeCount · house", staleCommitteeCountQuery({ chamber: "house" })],
  ["getStaleCommitteeCount · senate", staleCommitteeCountQuery({ chamber: "senate" })],
  ["getStaleBillsCount · all", staleBillsCountQuery()],
  ["getStaleBillsCount · house", staleBillsCountQuery("house")],
  ["getStaleBillsCount · senate", staleBillsCountQuery("senate")],
];

const db = getDb();
let failed = 0;
for (const [name, stmt] of cases) {
  if (!/^\s*SELECT\b/i.test(stmt.sql) || WRITE_WORD.test(stmt.sql)) throw new Error(`${name}: not a read: ${stmt.sql.slice(0, 80)}`);
  const rs = await db.execute({ sql: `EXPLAIN QUERY PLAN ${stmt.sql}`, args: stmt.args });
  const plan = rs.rows.map((r) => String(r.detail)).join(" | ");
  const ok = new RegExp(`USING COVERING INDEX ${INDEX}\\b`).test(plan);
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}: ${plan}`);
}
console.log(failed ? `check:stale-count-plan FAILED: ${failed} of ${cases.length} plans don't read USING COVERING INDEX ${INDEX}` : `check:stale-count-plan ok: ${cases.length} of ${cases.length} plans read USING COVERING INDEX ${INDEX}`);
process.exit(failed ? 1 : 0);
