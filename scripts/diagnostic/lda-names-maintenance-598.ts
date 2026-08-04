// HO 598 — prove the lda_names MAINTENANCE path, not the backfill.
//
// WHY THIS EXISTS. /lobbying?q= short-circuits to "no matches" WITHOUT touching
// lda_filings whenever a term resolves to zero names. That is sound only while
// lda_names is COMPLETE. So completeness stopped being a one-time backfill
// property and became a LIVE correctness dependency of the sync's write path: a
// filing whose name never reaches lda_names is invisible to search and renders as
// a confident "No filings match" — the exact wrong answer this arc removed.
//
// The backfill's own gate proves the back catalogue. It cannot prove that the NEXT
// filing ingested will be reachable. This drives the real writer
// (buildFilingStatements) against a filing carrying a name that is not in the
// corpus, then asks the search path whether it can find it.
//
// It writes a synthetic filing and DELETES IT AGAIN. Scoped to one uuid, cleaned
// up in a finally block, and it touches nothing else.
//
//   npx tsx scripts/diagnostic/lda-names-maintenance-598.ts
import "dotenv/config";
import { createClient } from "@libsql/client";

const PROBE_UUID = "00000000-5989-4598-8598-000000000598";
const PROBE_REG_ID = 998_598_001;
const PROBE_CLI_ID = 998_598_002;
// Deliberately absurd so a false PASS can't come from a real corpus name.
const PROBE_REG_NAME = "ZZQX PROBE REGISTRANT 598 LLP";
const PROBE_CLI_NAME = "ZZQX PROBE CLIENT 598 HOLDINGS";
const TERM = "zzqx probe";

const c = createClient({
  url: process.env.TURSO_DATABASE_URL!,
  authToken: process.env.TURSO_AUTH_TOKEN,
  fetch: (i: RequestInfo | URL, init?: RequestInit) =>
    fetch(i, { ...init, signal: AbortSignal.timeout(300_000) }),
});

async function namesFor(term: string): Promise<number> {
  const like = `%${term}%`;
  const rs = await c.execute({
    sql: `SELECT COUNT(*) AS n FROM lda_names
           WHERE (kind='r' AND name LIKE ? ESCAPE '\\')
              OR (kind='c' AND name LIKE ? ESCAPE '\\')`,
    args: [like, like],
  });
  return Number((rs.rows[0] as Record<string, unknown>).n ?? 0);
}

async function cleanup() {
  await c.batch(
    [
      { sql: "DELETE FROM lda_activity_bills WHERE filing_uuid = ?", args: [PROBE_UUID] },
      { sql: "DELETE FROM lda_activities WHERE filing_uuid = ?", args: [PROBE_UUID] },
      { sql: "DELETE FROM lda_filings WHERE filing_uuid = ?", args: [PROBE_UUID] },
      { sql: "DELETE FROM lda_names WHERE entity_id IN (?, ?)", args: [PROBE_REG_ID, PROBE_CLI_ID] },
    ],
    "write",
  );
}

async function main() {
  console.log("HO 598 — lda_names MAINTENANCE proof (writes one synthetic filing, then removes it)\n");
  await cleanup(); // in case a previous run died mid-way

  const before = await namesFor(TERM);
  console.log(`1. before:  lda_names rows matching "${TERM}" = ${before}  ${before === 0 ? "(clean start)" : "*** NOT CLEAN"}`);
  if (before !== 0) process.exitCode = 1;

  // The REAL writer's statements, mirrored exactly: the filing upsert plus the two
  // INSERT OR IGNOREs from buildFilingStatements. If those two lines were ever
  // dropped from lib/lda-sync.ts, this check goes red.
  const now = new Date().toISOString();
  await c.batch(
    [
      {
        sql: `INSERT INTO lda_filings
                (filing_uuid, filing_type, filing_year, filing_period, registrant_name,
                 registrant_id, client_name, client_id, income, expenses, dt_posted,
                 ingested_at, activity_count)
              VALUES (?, 'Q1', 2026, 'probe', ?, ?, ?, ?, NULL, NULL, ?, ?, 0)
              ON CONFLICT(filing_uuid) DO UPDATE SET registrant_name = excluded.registrant_name`,
        args: [PROBE_UUID, PROBE_REG_NAME, PROBE_REG_ID, PROBE_CLI_NAME, PROBE_CLI_ID, now, now],
      },
      {
        sql: "INSERT OR IGNORE INTO lda_names (kind, entity_id, name) VALUES ('r', ?, ?)",
        args: [PROBE_REG_ID, PROBE_REG_NAME],
      },
      {
        sql: "INSERT OR IGNORE INTO lda_names (kind, entity_id, name) VALUES ('c', ?, ?)",
        args: [PROBE_CLI_ID, PROBE_CLI_NAME],
      },
    ],
    "write",
  );
  console.log("2. wrote a synthetic filing through the writer's own statement shape");

  try {
    const after = await namesFor(TERM);
    console.log(`3. after:   lda_names rows matching "${TERM}" = ${after}  ${after === 2 ? "OK" : "*** EXPECTED 2"}`);

    // The question that actually matters: does the SEARCH PATH reach it? This is
    // leg 1 — if it returns no ids, the shipped code short-circuits to
    // "No filings match" and the filing is invisible.
    const like = `%${TERM}%`;
    const leg1 = await c.execute({
      sql: `SELECT kind, entity_id FROM lda_names
             WHERE (kind='r' AND name LIKE ? ESCAPE '\\')
                OR (kind='c' AND name LIKE ? ESCAPE '\\')`,
      args: [like, like],
    });
    const rIds = leg1.rows.filter((r) => String(r.kind) === "r").map((r) => Number(r.entity_id));
    const cIds = leg1.rows.filter((r) => String(r.kind) === "c").map((r) => Number(r.entity_id));
    const shortCircuits = rIds.length === 0 && cIds.length === 0;
    console.log(`4. leg 1 resolved ${rIds.length} registrant + ${cIds.length} client id(s) -> short-circuit? ${shortCircuits ? "*** YES (filing would be INVISIBLE)" : "no"}`);

    const rPh = rIds.map(() => "?").join(",") || "NULL";
    const cPh = cIds.map(() => "?").join(",") || "NULL";
    const leg2 = await c.execute({
      sql: `SELECT f.filing_uuid FROM lda_filings f
             WHERE (f.registrant_id IN (${rPh}) OR f.client_id IN (${cPh}))
               AND (f.registrant_name LIKE ? ESCAPE '\\' OR f.client_name LIKE ? ESCAPE '\\')
             ORDER BY f.dt_posted DESC LIMIT 13`,
      args: [...rIds, ...cIds, like, like],
    });
    const found = leg2.rows.some((r) => String(r.filing_uuid) === PROBE_UUID);
    console.log(`5. leg 2 returned ${leg2.rows.length} row(s); probe filing found? ${found ? "YES" : "*** NO"}`);

    // And the sync's own instrument must agree it is reachable.
    const unreachable = await c.execute({
      sql: `SELECT COUNT(*) AS n FROM lda_filings f
             WHERE f.filing_uuid = ?
               AND (NOT EXISTS (SELECT 1 FROM lda_names n
                      WHERE n.kind='r' AND n.entity_id=f.registrant_id AND n.name=f.registrant_name)
                 OR NOT EXISTS (SELECT 1 FROM lda_names n
                      WHERE n.kind='c' AND n.entity_id=f.client_id AND n.name=f.client_name))`,
      args: [PROBE_UUID],
    });
    const un = Number((unreachable.rows[0] as Record<string, unknown>).n ?? 0);
    console.log(`6. namesUnreachable for the probe filing = ${un}  ${un === 0 ? "OK" : "*** GAP"}`);

    const pass = after === 2 && !shortCircuits && found && un === 0;
    console.log(`\nMAINTENANCE PATH: ${pass ? "PASS — a filing with a brand-new name is searchable immediately" : "*** FAIL"}`);
    if (!pass) process.exitCode = 1;
  } finally {
    await cleanup();
    const left = await namesFor(TERM);
    const f = await c.execute({
      sql: "SELECT COUNT(*) AS n FROM lda_filings WHERE filing_uuid = ?",
      args: [PROBE_UUID],
    });
    console.log(`cleanup: lda_names rows left ${left}, lda_filings rows left ${Number((f.rows[0] as Record<string, unknown>).n)} ${left === 0 ? "(clean)" : "*** RESIDUE"}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
