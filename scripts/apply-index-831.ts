import "dotenv/config";
import { createClient } from "@libsql/client";
import { redactSecrets } from "../lib/redact";

// HO 831: the one prod write, one statement, by a one-off script (831-halt-ruling.md,
// ruling 1, on HO 406's precedent). `npm run migrate` runs all of scripts/migrate.ts,
// and every run drops and rebuilds idx_lda_names_kind_name; this runs only the
// CREATE INDEX below. scripts/migrate.ts carries the same statement so a database
// built from the file has the index.
//
// It prints bills' index list, runs the statement, prints the list again, and exits
// non-zero if anything in the schema but that one index differs, if the index
// already exists with another definition, or if the statement fails. A failed write
// is not retried. It takes no arguments.
//
//   npx tsx scripts/apply-index-831.ts

const NAME = "idx_bills_summary_stage_stale";
const DDL = `CREATE INDEX IF NOT EXISTS idx_bills_summary_stage_stale
  ON bills(stage, is_ceremonial, latest_action_date, bill_type, summary)
  WHERE summary IS NOT NULL`;

if (process.argv.length > 2) {
  console.error("apply-index-831 takes no arguments");
  process.exit(2);
}

// The long-timeout client scripts/migrate.ts builds for index builds
// (getLongTimeoutDb, which isn't exported, since importing migrate.ts runs it): the
// same URL and token, with a 300s abort in place of lib/db.ts's 10s bound, so a
// build the server finishes isn't reported as failed (HO 406, HO 597).
const url = process.env.TURSO_DATABASE_URL;
if (!url) throw new Error("TURSO_DATABASE_URL is not set");
const db = createClient({
  url,
  authToken: process.env.TURSO_AUTH_TOKEN,
  fetch: (i: RequestInfo | URL, init?: RequestInit) => fetch(i, { ...init, signal: AbortSignal.timeout(300_000) }),
});

type Entry = { type: string; name: string; tbl: string; sql: string };
const norm = (s: string) => s.replace(/\s+/g, " ").trim();
async function schema(): Promise<Entry[]> {
  const rows = (await db.execute(`SELECT type, name, tbl_name, sql FROM sqlite_master ORDER BY type, name`)).rows;
  return rows.map((r) => ({ type: String(r.type), name: String(r.name), tbl: String(r.tbl_name), sql: r.sql == null ? "" : norm(String(r.sql)) }));
}
const billsIndexes = (s: Entry[]) => s.filter((e) => e.type === "index" && e.tbl === "bills").map((e) => e.name);
const key = (e: Entry) => `${e.type}\u0000${e.name}\u0000${e.tbl}\u0000${e.sql}`;

const before = await schema();
console.log(`before: bills has ${billsIndexes(before).length} indexes: ${billsIndexes(before).join(", ")}`);
const existing = before.find((e) => e.name === NAME);
if (existing && existing.sql !== norm(DDL).replace("IF NOT EXISTS ", "")) {
  console.error(`${NAME} already exists with another definition: ${existing.sql}`);
  process.exit(1);
}

let failed: unknown = null;
const t0 = Date.now();
try {
  await db.execute(DDL);
} catch (e) {
  failed = e;
}
const ms = Date.now() - t0;
if (failed) console.error(`the statement failed after ${ms} ms: ${redactSecrets(String((failed as Error).message ?? failed))}`);
else console.log(`ran in ${ms} ms: ${norm(DDL)}`);

const after = await schema();
console.log(`after:  bills has ${billsIndexes(after).length} indexes: ${billsIndexes(after).join(", ")}`);
const b = new Set(before.map(key));
const a = new Set(after.map(key));
const added = after.filter((e) => !b.has(key(e)));
const removed = before.filter((e) => !a.has(key(e)));
const expected = norm(DDL).replace("IF NOT EXISTS ", "");
const onlyTheIndex =
  removed.length === 0 &&
  (existing ? added.length === 0 : added.length === 1 && added[0]!.name === NAME && added[0]!.type === "index" && added[0]!.sql === expected);
console.log(`added: ${added.map((e) => `${e.type} ${e.name}`).join(", ") || "none"} · removed or changed: ${removed.map((e) => `${e.type} ${e.name}`).join(", ") || "none"}`);
if (failed || !onlyTheIndex) {
  console.error(failed ? "FAILED: the statement threw; not retried" : "FAILED: the schema changed by more than the one index");
  process.exit(1);
}
console.log(existing ? `${NAME} was already present with this definition; nothing changed` : `ok: ${NAME} is the one new entry in the schema`);
