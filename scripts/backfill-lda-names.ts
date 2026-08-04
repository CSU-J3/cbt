// HO 598 — one-time populate of lda_names from the filings already stored. Every
// filing ingested after this gets its rows from lib/lda-sync.ts's own upsert; this
// fills the back catalogue.
//
// The source is DISTINCT (id, name) PAIRS, not distinct ids. The mapping is
// many-to-many — 70 registrant ids and 91 client ids carry more than one name
// spelling — so collapsing to one name per id would silently drop the alternates
// and change search results.
//
// IDEMPOTENT via INSERT OR IGNORE against the (kind, entity_id, name) PK, so a
// re-run is a no-op and an interrupted run resumes by simply running again.
//
//   npm run backfill:lda-names
import "dotenv/config";
import { createClient, type InStatement } from "@libsql/client";

// The DISTINCT reads walk lda_filings, which HO 598 measured at 30-90s cold. The
// 10s lib/db.ts bound would abort them; this is off the request path.
const CLIENT_TIMEOUT_MS = 300_000;
const CHUNK = 200;

function db() {
  const url = process.env.TURSO_DATABASE_URL;
  if (!url) throw new Error("TURSO_DATABASE_URL is not set");
  return createClient({
    url,
    authToken: process.env.TURSO_AUTH_TOKEN,
    fetch: (i: RequestInfo | URL, init?: RequestInit) =>
      fetch(i, { ...init, signal: AbortSignal.timeout(CLIENT_TIMEOUT_MS) }),
  });
}
const ms = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(2)}s` : `${Math.round(n)}ms`);

async function main() {
  const c = db();

  const pairs: Array<[string, number, string]> = [];
  for (const [kind, idCol, nameCol] of [
    ["r", "registrant_id", "registrant_name"],
    ["c", "client_id", "client_name"],
  ] as const) {
    const t0 = performance.now();
    const rs = await c.execute(
      `SELECT DISTINCT ${idCol} AS id, ${nameCol} AS name FROM lda_filings
        WHERE ${idCol} IS NOT NULL AND ${nameCol} IS NOT NULL`,
    );
    console.log(`  ${kind}: ${rs.rows.length.toLocaleString()} distinct (id, name) pairs in ${ms(performance.now() - t0)}`);
    for (const r of rs.rows) pairs.push([kind, Number(r.id), String(r.name)]);
  }

  console.log(`writing ${pairs.length.toLocaleString()} rows in chunks of ${CHUNK}...`);
  const t0 = performance.now();
  for (let i = 0; i < pairs.length; i += CHUNK) {
    const stmts: InStatement[] = pairs.slice(i, i + CHUNK).map(([kind, id, name]) => ({
      sql: "INSERT OR IGNORE INTO lda_names (kind, entity_id, name) VALUES (?, ?, ?)",
      args: [kind, id, name],
    }));
    await c.batch(stmts, "write");
  }
  console.log(`  done in ${ms(performance.now() - t0)}`);

  const after = await c.execute(
    `SELECT COUNT(*) AS n,
            SUM(CASE WHEN kind = 'r' THEN 1 ELSE 0 END) AS r,
            SUM(CASE WHEN kind = 'c' THEN 1 ELSE 0 END) AS c FROM lda_names`,
  );
  const row = after.rows[0] as Record<string, unknown>;
  console.log(`lda_names: ${Number(row.n).toLocaleString()} rows (${Number(row.r).toLocaleString()} registrant / ${Number(row.c).toLocaleString()} client)`);

  // COMPLETENESS GATE. The rewrite's whole correctness argument is that every
  // filing's (id, name) pair is present, so check it as a set rather than trusting
  // the insert count — a missing pair makes a filing invisible to search.
  const missing = await c.execute(
    `SELECT
       (SELECT COUNT(*) FROM lda_filings f WHERE NOT EXISTS (
          SELECT 1 FROM lda_names n WHERE n.kind='r' AND n.entity_id=f.registrant_id AND n.name=f.registrant_name)) AS missR,
       (SELECT COUNT(*) FROM lda_filings f WHERE NOT EXISTS (
          SELECT 1 FROM lda_names n WHERE n.kind='c' AND n.entity_id=f.client_id AND n.name=f.client_name)) AS missC`,
  );
  const m = missing.rows[0] as Record<string, unknown>;
  const missR = Number(m.missR);
  const missC = Number(m.missC);
  console.log(`\nCOMPLETENESS: filings with no matching lda_names row — registrant ${missR}, client ${missC}`);
  if (missR === 0 && missC === 0) {
    console.log("  PASS — every filing is reachable through the lookup table.");
  } else {
    console.log("  *** FAIL — do NOT rewire the search onto this table.");
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
