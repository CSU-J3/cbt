// HO 680 STEP 3 — scrub the burned CONGRESS_API_KEY out of the three cron_runs
// rows HO 678 found it in (322, 344, 8348), then prove it exists nowhere else in
// the database.
//
// ORDERING, AND WHY IT IS NOT ARBITRARY. This runs only AFTER the owner has
// submitted the api.data.gov disable form, because these three rows are the last
// in-repo copy of the old key and the form needs it for identification. Ruled
// HO 680: STEP 1 -> STEP 2 -> HALT -> GSA form -> STEP 3.
//
// WHAT THE SCRUB DOES NOT DO. It does not reach Turso's point-in-time recovery
// window, which still holds the pre-scrub rows. The GSA disable is what closes
// that exposure; the scrub closes the live-table one. Both are needed and they
// are not substitutes.
//
// THE TWO-STAGE REPLACEMENT, and why one stage is not enough:
//   1. redactSecrets(s) — the HO 679 sink. Its PATTERN pass removes the whole
//      `api_key=<value>` parameter, which is what makes the scrub greppable
//      (`LIKE '%api_key=%'` goes to zero). Its VALUE pass cannot help here: it
//      reads process.env.CONGRESS_API_KEY, which now holds the NEW key.
//   2. .split(oldKey).join("[REDACTED:CONGRESS_API_KEY]") — catches any copy of
//      the old value sitting somewhere the parameter form does not cover, e.g.
//      echoed inside an upstream error body.
//
// The old key is never an argument, never printed, never written to a file. It
// is extracted in-process from row 322 and stays in memory. The whole-database
// scan runs in this same process for exactly that reason: after the UPDATE the
// value is unrecoverable from the database, so a second process could not be
// handed it without writing it down somewhere.
//
// Run: npx tsx scripts/diagnostic/scrub-cron-runs-680.ts
//      --dry-run   compute and report, write nothing

import { createClient } from "@libsql/client";
import { readFileSync } from "node:fs";
import { redactSecrets } from "@/lib/redact";

const DRY = process.argv.includes("--dry-run");
const IDS = [322, 344, 8348];

const printed: string[] = [];
const say = (s: string) => {
  printed.push(s);
  console.log(s);
};

for (const line of readFileSync(".env", "utf8").split(/\r?\n/)) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(line);
  if (m && m[1] && !process.env[m[1]]) {
    process.env[m[1]] = (m[2] ?? "").replace(/^["']|["']$/g, "").trim();
  }
}
const db = createClient({
  url: process.env.TURSO_DATABASE_URL ?? "",
  authToken: process.env.TURSO_AUTH_TOKEN ?? "",
});

// --- extract the old key, in process ---------------------------------------
const seed = await db.execute("SELECT error_message FROM cron_runs WHERE id = 322");
const seedMsg = String(seed.rows[0]?.error_message ?? "");
const oldKey = /api_key=([^&\s"']+)/.exec(seedMsg)?.[1] ?? "";
if (!oldKey) {
  say("ABORT: could not extract the old key from row 322. Nothing written.");
  process.exit(1);
}
say(`old key extracted in-process: ${oldKey.length} chars, alnum-only=${/^[A-Za-z0-9]+$/.test(oldKey)}`);
say(`it is NOT the current key    : ${oldKey !== process.env.CONGRESS_API_KEY}`);
say("");

// --- per-row scrub ----------------------------------------------------------
const scrub = (s: string) => redactSecrets(s).split(oldKey).join("[REDACTED:CONGRESS_API_KEY]");

say("id     | col            | bytes before -> after | api_key= after | old value after | JSON ok");
say("-------+----------------+-----------------------+----------------+-----------------+--------");
const startedAt = new Map<number, string>();

for (const id of IDS) {
  const r = await db.execute({
    sql: "SELECT error_message, payload, started_at, status FROM cron_runs WHERE id = ?",
    args: [id],
  });
  const row = r.rows[0];
  if (!row) { say(`${id}: NOT FOUND — skipped`); continue; }
  startedAt.set(id, String(row.started_at));

  const oldErr = String(row.error_message ?? "");
  const oldPay = String(row.payload ?? "");
  const newErr = scrub(oldErr);
  const newPay = scrub(oldPay);

  // A payload that stops being valid JSON is worse than one carrying a dead key.
  let jsonOk = true;
  try { JSON.parse(newPay); } catch { jsonOk = false; }
  if (!jsonOk) {
    say(`ABORT: id ${id} payload would not parse after scrub. Nothing written for any row.`);
    process.exit(1);
  }

  if (!DRY) {
    await db.execute({
      sql: "UPDATE cron_runs SET error_message = ?, payload = ? WHERE id = ?",
      args: [newErr, newPay, id],
    });
  }

  const chk = DRY ? { error_message: newErr, payload: newPay } : (await db.execute({
    sql: "SELECT error_message, payload FROM cron_runs WHERE id = ?",
    args: [id],
  })).rows[0]!;
  const e = String(chk.error_message ?? ""), p = String(chk.payload ?? "");

  say(`${id.toString().padEnd(6)} | error_message  | ${String(oldErr.length).padStart(6)} -> ${String(e.length).padEnd(6)}       | ${(e.includes("api_key=") ? "YES" : "no").padEnd(14)} | ${(e.includes(oldKey) ? "YES" : "no").padEnd(15)} | -`);
  say(`${"".padEnd(6)} | payload        | ${String(oldPay.length).padStart(6)} -> ${String(p.length).padEnd(6)}       | ${(p.includes("api_key=") ? "YES" : "no").padEnd(14)} | ${(p.includes(oldKey) ? "YES" : "no").padEnd(15)} | ${jsonOk ? "yes" : "NO"}`);
}
say("");

// --- read-back 1: whole table ----------------------------------------------
const c1 = await db.execute(
  "SELECT COUNT(*) c FROM cron_runs WHERE error_message LIKE '%api_key=%' OR payload LIKE '%api_key=%'",
);
say(`read-back 1 — cron_runs rows still carrying 'api_key=' : ${c1.rows[0]?.c}  (expect 0)`);

// --- read-back 3: the rows survived as rows ---------------------------------
const shape = await db.execute({
  sql: `SELECT id, status, started_at, error_message FROM cron_runs WHERE id IN (?, ?, ?) ORDER BY id`,
  args: IDS,
});
for (const row of shape.rows) {
  const id = Number(row.id);
  const msg = String(row.error_message ?? "");
  say(
    `read-back 3 — id ${id}: status=${row.status} ` +
      `started_at unchanged=${String(row.started_at) === startedAt.get(id)} ` +
      `begins 'fetch https://api.congress.gov/'=${msg.startsWith("fetch https://api.congress.gov/")} ` +
      `contains ' -> '=${msg.includes(" -> ")}`,
  );
}
say("");

// --- read-back 2: every text column of every table ---------------------------
// One statement per table, ORing its text columns, so each table is scanned once
// rather than once per column. The value rides as a bound parameter, never
// interpolated into SQL.
const tables = (await db.execute(
  "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
)).rows.map((r) => String(r.name));

let scanned = 0, cols = 0, hitTables: string[] = [];
for (const t of tables) {
  const info = await db.execute(`PRAGMA table_info("${t}")`);
  const textCols = info.rows
    .filter((c) => /TEXT|CHAR|CLOB|JSON|^$/i.test(String(c.type ?? "")))
    .map((c) => String(c.name));
  if (textCols.length === 0) continue;
  cols += textCols.length;
  scanned++;
  const where = textCols.map((c) => `"${c}" LIKE ?`).join(" OR ");
  const res = await db.execute({
    sql: `SELECT COUNT(*) c FROM "${t}" WHERE ${where}`,
    args: textCols.map(() => `%${oldKey}%`),
  });
  const n = Number(res.rows[0]?.c ?? 0);
  if (n > 0) { hitTables.push(`${t}=${n}`); say(`  HIT ${t}: ${n} row(s)`); }
}
say(`read-back 2 — scanned ${cols} text columns across ${scanned} tables (of ${tables.length})`);
say(`read-back 2 — rows anywhere still holding the old value: ${hitTables.length === 0 ? 0 : hitTables.join(", ")}  (expect 0)`);

// --- mandated self-scan ------------------------------------------------------
const blob = printed.join("\n");
const bad = [...blob.matchAll(/[A-Za-z0-9]{40,}/g), ...blob.matchAll(/\b[0-9a-f]{64}\b/g)];
console.log(`\nself-scan: ${bad.length === 0 ? "clean (no 40+ alnum run, no 64-hex run)" : `LEAK — ${bad.length} hit(s)`}`);
if (bad.length > 0) process.exit(1);
if (DRY) console.log("dry-run: no UPDATE was issued.");
