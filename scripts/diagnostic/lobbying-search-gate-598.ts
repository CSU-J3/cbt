// HO 598 GATE — the name-lookup rewrite, measured before rewiring. READ-ONLY.
//
// VERDICT: **FAIL, two ways. The rewire was NOT shipped.** lda_names and the two
// id indexes ARE live and maintained (migration 4fd9b48, writer e7fdf30); only the
// read-path rewire is withheld. Nothing is half-wired — the shipped search is
// byte-unchanged except for the bounded COUNT (1afdd02).
//
// CO-LOCATED (pdx1, throwaway preview probe on branch 598-gate, now deleted), one
// query per invocation, 90s gaps, unbounded 300s client, shipped LIMIT 13:
//
//   query              term          matches   runs (ms)                worst
//   new_page           "boeing"           78   8831, 3858, 2245         8.83s
//   new_page           "llc"          50,197   182492, 40297, 33489   182.5s  FAIL
//   new_page           zero-match          0   2944, 1479, 1682         2.94s
//   new_count_bounded  "boeing"           78   3494                     3.49s
//   new_count_bounded  "llc"          50,197   3865                     3.87s
//   new_idset          "boeing"    -> 15 ids   1365                     1.37s
//   new_idset          "llc"    -> 3,928 ids   5348                     5.35s
//
// WHY IT FAILS, and it is not "the fix was too slow" — it is a MIRROR IMAGE:
//
//   the OLD path's cost is INVERSELY proportional to match density. A dense term
//   short-circuits the dt_posted walk almost at once ("llc" 3.3s); a sparse one
//   walks the whole table ("boeing" 19.8s, zero-match 91.3s).
//
//   the NEW path's cost is PROPORTIONAL to match density. A sparse term seeks a
//   handful of ids (zero-match 2.94s, "boeing" 8.83s); a dense one resolves 3,928
//   ids, seeks ~50,197 rows and TEMP B-TREEs them for the ORDER BY ("llc" 182.5s).
//
// So each path is fast exactly where the other is slow, and the crossover is match
// density. The name lookup does not beat the walk; it TRADES the walk's failure
// mode for its mirror.
//
// AND THE RARE-TERM NUMBER IS THIN, WHICH IS ITS OWN STOP. 8.83s is under the 10s
// bound by **+1.17s**, on a query whose own three runs spread 2.2s -> 8.8s (~4x).
// A margin smaller than the observed spread is not a margin. That is precisely
// what HO 594 shipped and had to retract, so it does not get shipped again.
//
// WHAT IS ESTABLISHED AND SURVIVES, so the next HO does not re-derive it:
//   - EQUIVALENCE HOLDS. Old and new returned identical rows, in identical order,
//     for a rare, a common and a zero-match term (the check below re-runs it).
//     The many-to-many id/name mapping is handled: the candidate set is by id and
//     over-matches, and the name re-check removes exactly the over-match.
//   - lda_names is COMPLETE: 0 of 129,401 filings lack a matching row.
//   - after the bounded COUNT shipped, the COMMON term is ALREADY FINE (page 3.3s
//     + count 2.25s). The only broken cases are SPARSE terms — which is the half
//     the new path fixes, and the half a density-conditional strategy would keep.
//
//   npx tsx scripts/diagnostic/lobbying-search-gate-598.ts
import "dotenv/config";
import { createClient } from "@libsql/client";

const WRITE = /\b(insert|update|delete|create|drop|alter|replace|vacuum|reindex|pragma)\b/i;
function ro(sql: string): string {
  if (WRITE.test(sql.replace(/^\s*explain\s+query\s+plan\s+/i, ""))) {
    throw new Error(`read-only guard tripped: ${sql.slice(0, 70)}`);
  }
  return sql;
}

const c = createClient({
  url: process.env.TURSO_DATABASE_URL!,
  authToken: process.env.TURSO_AUTH_TOKEN,
  fetch: (i: RequestInfo | URL, init?: RequestInit) =>
    fetch(i, { ...init, signal: AbortSignal.timeout(300_000) }),
});
const ms = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(2)}s` : `${Math.round(n)}ms`);

const COLS = `f.filing_uuid, f.registrant_name, f.client_name, f.dt_posted,
              f.filing_type, f.filing_period, f.income, f.expenses`;
// The candidate set is by ID and therefore OVER-matches (an id spelled two ways,
// only one spelling matching the term). RECHECK removes exactly that over-match,
// which is what makes the rewrite equivalent rather than merely close.
const CAND = `(f.registrant_id IN (SELECT entity_id FROM lda_names WHERE kind='r' AND name LIKE ? ESCAPE '\\')
   OR f.client_id  IN (SELECT entity_id FROM lda_names WHERE kind='c' AND name LIKE ? ESCAPE '\\'))`;
const RECHECK = `(f.registrant_name LIKE ? ESCAPE '\\' OR f.client_name LIKE ? ESCAPE '\\')`;

const NEW_PAGE = `SELECT ${COLS} FROM lda_filings f WHERE ${CAND} AND ${RECHECK}
   ORDER BY f.dt_posted DESC LIMIT 13 OFFSET 0`;
const OLD_PAGE = `SELECT ${COLS} FROM lda_filings f INDEXED BY idx_lda_filings_dt_posted
   WHERE ${RECHECK} ORDER BY f.dt_posted DESC LIMIT 13 OFFSET 0`;

async function main() {
  console.log("HO 598 GATE — equivalence re-check (timings here are LAPTOP; the gate");
  console.log("verdict is the co-located table in this file's header).\n");

  const completeness = await c.execute(
    ro(`SELECT
       (SELECT COUNT(*) FROM lda_names) AS names,
       (SELECT COUNT(*) FROM lda_filings f WHERE NOT EXISTS (
          SELECT 1 FROM lda_names n WHERE n.kind='r' AND n.entity_id=f.registrant_id AND n.name=f.registrant_name)) AS missR,
       (SELECT COUNT(*) FROM lda_filings f WHERE NOT EXISTS (
          SELECT 1 FROM lda_names n WHERE n.kind='c' AND n.entity_id=f.client_id AND n.name=f.client_name)) AS missC`),
  );
  const cm = completeness.rows[0] as Record<string, unknown>;
  console.log(
    `lda_names ${Number(cm.names).toLocaleString()} rows | filings unreachable: registrant ${Number(cm.missR)}, client ${Number(cm.missC)} -> ${Number(cm.missR) === 0 && Number(cm.missC) === 0 ? "COMPLETE" : "*** INCOMPLETE"}\n`,
  );

  let allSame = true;
  for (const term of ["boeing", "llc", "zzqxnotarealterm"]) {
    const a = `%${term}%`;
    const t0 = performance.now();
    const nw = await c.execute({ sql: ro(NEW_PAGE), args: [a, a, a, a] });
    const t1 = performance.now();
    const od = await c.execute({ sql: ro(OLD_PAGE), args: [a, a] });
    const t2 = performance.now();
    const same =
      nw.rows.map((r) => String(r.filing_uuid)).join(",") ===
      od.rows.map((r) => String(r.filing_uuid)).join(",");
    if (!same) allSame = false;
    console.log(
      `  "${term}": new ${ms(t1 - t0)} (${nw.rows.length} rows) | old ${ms(t2 - t1)} (${od.rows.length}) -> ${same ? "IDENTICAL" : "*** DIVERGES"}`,
    );
  }
  console.log(`\nEQUIVALENCE: ${allSame ? "PASS" : "FAIL"}`);
  console.log("GATE VERDICT: FAIL (see header) — rewire withheld, decision owed.");
  if (!allSame) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
