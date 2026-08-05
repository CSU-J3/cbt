// HO 598 — the /lobbying?q= rewrite. READ-ONLY equivalence harness + the record of
// four measurement rounds. **THE ROUTED PATH IS NOW SHIPPED** (e4f09ba, arg-binding
// fix 06d03dd). Rounds 1-3 below are kept in order because two of their conclusions
// were RETRACTED by later rounds, and the retractions are the useful part.
//
// FINAL DISPOSITION: shipped as a JUDGMENT CALL OVER A FAILED GATE, not a pass.
//   - The gate statistic was amended to upper-tail (worst - median), not max - min:
//     a FAST outlier is evidence of safety and must not harden the gate.
//   - Under the amended gate: dense +3.51s vs 3.11s PASS; empty +3.54s vs 3.34s
//     PASS; **sparse +2.27s vs 4.23s FAIL**.
//   - Shipped on STRICT DOMINANCE: the path being replaced breaches on BOTH
//     lib/db.ts attempts at its BEST observed (19.8s), so withholding preserved a
//     ~certain failure to avoid a rare one — and since 79d1276 the rare one renders
//     honestly instead of lying. HO 594's retraction was for CLOSING a loop on a
//     thin margin; this improves on one and THE LOOP STAYS OPEN.
//
// Prod, all three regimes (06d03dd): q=boeing 13 rows / count 78 (was "No filings
// match" against 78 real matches) · q=llc 13 rows / "520+" · q=zzqxnotarealterm
// 0 rows / "No filings match" in 412ms (was 91.3s).
//
// ---- historical: the pre-ship rounds ----
//
// ROUND 1 VERDICT: FAIL, two ways. lda_names and the two id indexes were live and
// maintained (migration 4fd9b48, writer e7fdf30); only the read-path rewire was
// withheld, so nothing was half-wired.
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
// ===========================================================================
// ROUND 2 — the sparse path re-measured at n=8, and the routing priced.
// VERDICT: STILL FAIL. Rewire still withheld. But the shape of the failure moved,
// and one round-1 conclusion is RETRACTED.
//
// RETRACTED: round 1 read 8.83s as "the sparse path costs ~9s" off THREE runs. At
// n=8 the median is 4.13s and 8.83s was near the top of a wide distribution — the
// 3-run sample could not tell those apart, which is exactly why it was re-run.
//
//   new_page "boeing" (sparse, 78)   n=8
//     runs   8014, 5481, 3448, 6292, 4806, 3389, 536, 2636
//     median 4127ms   worst 8014ms   best 536ms   spread 15.0x
//     margin vs 10s: median +5.87s | WORST +1.99s
//   new_page zero-match              n=8
//     runs   4127, 2866, 1614, 1542, 3319, 3466, 1237, 1045
//     median 2240ms   worst 4127ms   best 1045ms   spread 3.9x
//     margin vs 10s: median +7.76s | WORST +5.87s
//
// AGAINST THE GATE ("margin larger than the measured spread"):
//   zero-match  margin +5.87s vs spread 3.08s absolute   -> PASSES
//   sparse      margin +1.99s vs spread 7.48s absolute   -> FAILS
// A margin that is a quarter of the observed spread is not a margin.
//
// filing_count WORKS AS ASKED — density does come back in the same scan:
//   names_scan         "boeing" 34, 3221, 1367     median 1367   worst 3221
//   names_scan_density "boeing" 888, 4617, 2940    median 2940   worst 4617
//   names_scan         "llc"    947, 2641, 3502    median 2641   worst 3502
//   names_scan_density "llc"    2445, 2204, 2818   median 2445   worst 2818
// The extra column costs nothing distinguishable from the spread, and the estimate
// is a safe OVER-count (boeing 84 vs 78 real, llc 55,834 vs 50,197) because a
// filing matching both registrant and client counts twice — over-counting routes
// toward the walk, which is the conservative direction.
//
// BUT IT DOES NOT RESCUE THE DESIGN, and this is the round-2 finding: routing needs
// the density BEFORE it can choose, so it is a SEPARATE ROUND TRIP ahead of the
// page query. On this DB that round trip's own worst case is 4.6s. Routed sparse is
// therefore 4.6s + 8.0s = up to 12.6s worst — WORSE than the unrouted candidate
// path, which already carries the name scan inside its subquery. One scan can
// answer both questions; you still cannot act on the answer without paying for it.
//
// THE DERIVED THRESHOLD (computed, not fitted — recorded because it is correct and
// reusable even though it is not being shipped). The walk short-circuits once the
// page fills, so E[rows walked] ~= min(N, k*N/m) for corpus N, page k, matches m;
// the candidate path touches ~m. Equate the variable terms:
//     m* = sqrt(k * N) = sqrt(13 * 129,401) ~= 1,297   (~1% density)
// It is a FORMULA over two live quantities (PAGE_SIZE and the rollup blob's
// stats.filings), so it re-derives as the corpus grows and can never go stale the
// way a tuned constant does. It routes all three measured terms correctly and each
// sits >15x from the crossover (boeing 84 -> 15x below; llc 55,834 -> 43x above;
// zero-match 0), so the exact constant is not load-bearing. That distance from the
// crossover is the property PAGE_SIZE=13 lacked.
//
// WHAT ACTUALLY BLOCKS THIS NOW — it is no longer the query. Every candidate is
// ~2-4s median, and what breaks the gate is a 15x run-to-run spread on identical
// work. No query averaging ~4s can be *guaranteed* under 10s on that distribution.
// So the next move is a choice between: accept a median-based (probabilistic)
// bound as policy; get the sparse path to ~1s, which means not doing ~78 random
// page fetches into a 22.9 MB table; or attack the spread itself, which is the
// residency/platform question this arc has now hit in HO 594, 597 and 598.
// ===========================================================================
//
// ===========================================================================
// ROUND 3 — the ROUTED path, with leg 1's ids handed through to leg 2.
// ROUND 2'S 12.6s WAS AN ARTIFACT AND IS RETRACTED. It priced routing as
// `density query + new_page`, but new_page runs its own name scan inside its
// IN-subquery — so leg 2 was charged for work leg 1 had already done. Measured
// properly, with the ids passed through, leg 2 is 0-1.5s.
//
// Routed = leg 1 (one covering lda_names scan: ids AND filing_count together)
//          -> route on m* = sqrt(k*N) ~= 1,297
//          -> leg 2: sparse = PK seeks on the literal ids; dense = the shipped
//             dt_posted walk; empty id set = SKIP leg 2 entirely.
// 8 runs per term, 90s gaps, co-located pdx1, unbounded client:
//
//   term        path                 n  median   worst    best   spread  margin@worst
//   boeing      sparse-seek          8  3510ms  7735ms   380ms   7.36s   +2.27s
//   llc         dense-walk           8  3378ms  6491ms  2703ms   3.79s   +3.51s
//   zero-match  empty-shortcircuit   8  3119ms  6461ms  1558ms   4.90s   +3.54s
//   ALL 24 RUNS: median 3291ms, worst 7735ms, BREACHES >10s: 0
//
// Routing decisions were correct every time: boeing (density 84) -> seek,
// llc (density 55,834) -> walk, zero-match -> short-circuit.
//
// THE EMPTY SHORT-CIRCUIT IS A REAL RESULT, not an optimisation: lda_names is
// COMPLETE (0 of 129,401 filings unreachable), so an empty id set PROVES an empty
// answer, and the zero-match case never touches lda_filings at all. That is the
// 91.3s case gone entirely.
//
// AGAINST THE GATE ("margin larger than the measured spread"): boeing +2.27s vs
// 7.36s, llc +3.51s vs 3.79s, zero +3.54s vs 4.90s. **All three still fail**, so
// this is NOT shipped. Note honestly what the criterion is now binding on: the
// spread is inflated by a very FAST best case (boeing 380ms), so max-min overstates
// the risk it was written to catch. 0 of 24 runs breached. That is a judgement call
// about the criterion, and it is not mine to make quietly.
//
// ITEM 3 IS ANSWERED AND IT IS MOOT: an index on (registrant_id, dt_posted) targets
// leg 2, and leg 2 is now 0-1.5s (median 893ms sparse, 99ms dense, 0ms empty).
// Routing already removed the ~78 random fetches it was meant to remove. Do not
// build it.
//
// WHAT REMAINS IS LEG 1 — the ~33,620-row / ~1 MB covering scan of lda_names,
// median 2.6-3.3s, worst 6.6s, and it dominates every path. It is already ~1/23rd
// the bytes of the lda_filings walk this arc started from (22.9 MB -> 86s, 1 MB ->
// 6.6s, roughly linear), so shrinking data works exactly as the bytes model
// predicts — and the VARIANCE rides along at every size. That is the same
// residency question HO 594, 597 and 598 have each independently hit.
// ===========================================================================
//
// ===========================================================================
// ROUND 4 — SHIPPED. The routed rewire, and the four-sided falsification.
//
// CONTROL (this script, routed vs the shipped walk, same live DB state):
//   "boeing"    density     84 -> sparse-seek         IDENTICAL
//   "llc"       density 55,834 -> dense-walk          IDENTICAL
//   "zzqx…"     density      0 -> empty-shortcircuit  IDENTICAL
//   "insur"     density  1,119 -> sparse-seek         IDENTICAL   (0.86x m*)
//   "hospital"  density  1,500 -> dense-walk          IDENTICAL   (1.16x m*)
// The last two STRADDLE m* = 1,297, so the boundary is exercised on BOTH sides
// rather than assumed. Rows and order match the shipped predicate exactly.
//
// TIMEOUT PATH, re-fired post-rewire, one dev session, injection scoped to a
// single term so both causes are observable together:
//   q=boeing (injected failure)  -> "Search timed out — try a narrower term"
//   q=zzqx…  (genuine empty)     -> "No filings match"
//   q=llc    (control)           -> 13 rows
// Two distinct strings reached by two distinct causes. Before this arc they were
// character-for-character identical.
//
// COMPLETENESS: scripts/diagnostic/lda-names-maintenance-598.ts proves the
// MAINTENANCE path (a filing with a brand-new name is searchable immediately), and
// LdaSyncResult.namesUnreachable watches it on every tick.
//
// ONE BUG SHIPPED AND CAUGHT IN PROD IN MINUTES (fixed 06d03dd): the bounded COUNT
// still bound the two LIKE args while the routed predicate carried 17. The
// instrument named it — "expected 17, got 2" against the exact cache key. Worth
// recording WHY this harness missed it: it compares the PAGE query's rows and never
// executes the COUNT. A verification that covers one of two statements in a
// Promise.all is not coverage of the pair.
// ===========================================================================
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

const THRESHOLD = Math.round(Math.sqrt(13 * 129_401)); // m* = sqrt(k*N)

// The ROUTED path, emulating lib/queries.ts::getRecentFilings exactly: leg 1
// resolves ids + density in one covering scan, then empty / sparse-seek / dense-walk.
async function routedPage(term: string): Promise<{ ids: string[]; path: string; density: number }> {
  const like = `%${term}%`;
  const l1 = await c.execute({
    sql: ro(`SELECT kind, entity_id, filing_count FROM lda_names
              WHERE (kind='r' AND name LIKE ? ESCAPE '\\') OR (kind='c' AND name LIKE ? ESCAPE '\\')`),
    args: [like, like],
  });
  const rIds: number[] = [];
  const cIds: number[] = [];
  let density = 0;
  for (const row of l1.rows) {
    density += Number(row.filing_count ?? 0);
    if (String(row.kind) === "r") rIds.push(Number(row.entity_id));
    else cIds.push(Number(row.entity_id));
  }
  if (rIds.length === 0 && cIds.length === 0) return { ids: [], path: "empty-shortcircuit", density };
  if (density <= THRESHOLD) {
    const rPh = rIds.map(() => "?").join(",") || "NULL";
    const cPh = cIds.map(() => "?").join(",") || "NULL";
    const rs = await c.execute({
      sql: ro(`SELECT ${COLS} FROM lda_filings f
                WHERE (f.registrant_id IN (${rPh}) OR f.client_id IN (${cPh})) AND ${RECHECK}
                ORDER BY f.dt_posted DESC LIMIT 13 OFFSET 0`),
      args: [...rIds, ...cIds, like, like],
    });
    return { ids: rs.rows.map((r) => String(r.filing_uuid)), path: "sparse-seek", density };
  }
  const rs = await c.execute({ sql: ro(OLD_PAGE), args: [like, like] });
  return { ids: rs.rows.map((r) => String(r.filing_uuid)), path: "dense-walk", density };
}
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
  // The last two STRADDLE m* = 1,297 (insur 0.86x -> seek, hospital 1.16x -> walk),
  // so the boundary is exercised on both sides rather than assumed.
  for (const term of ["boeing", "llc", "zzqxnotarealterm", "insur", "hospital"]) {
    const a = `%${term}%`;
    const t0 = performance.now();
    const rt = await routedPage(term);
    const t1 = performance.now();
    const od = await c.execute({ sql: ro(OLD_PAGE), args: [a, a] });
    const t2 = performance.now();
    const same = rt.ids.join(",") === od.rows.map((r) => String(r.filing_uuid)).join(",");
    if (!same) allSame = false;
    console.log(
      `  "${term}" density ${rt.density} -> ${rt.path.padEnd(18)} routed ${ms(t1 - t0).padStart(8)} (${rt.ids.length} rows) | shipped ${ms(t2 - t1).padStart(8)} (${od.rows.length}) -> ${same ? "IDENTICAL" : "*** DIVERGES"}`,
    );
  }
  console.log(`\nEQUIVALENCE: ${allSame ? "PASS" : "FAIL"}`);
  console.log("ROUTED PATH SHIPPED (e4f09ba + 06d03dd) — see the header for the gate disposition.");
  if (!allSame) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
