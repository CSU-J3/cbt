// HO 597 phase 2 — CONTROL for the /lobbying VOLUME materialization. READ-ONLY.
//
// The regression risk the handoff named: the old query was an agg-driven INNER
// JOIN, which DROPPED the filings with zero lda_activities rows. Materializing
// onto lda_filings turns VOLUME into a single-table sort, which brings those rows
// BACK into the candidate set. They should still sort last and still fall past the
// MAX_FEED_PAGES=40 clamp — but "should" is the word this project does not accept.
//
// So this runs the OLD SQL and the NEW SQL against the SAME live DB state and
// diffs them, rather than fingerprinting before and after in time (the corpus
// grows daily; a temporal diff cannot separate a plan change from an ingest).
//
//   npx tsx scripts/diagnostic/lda-volume-falsify-597.ts
//
// RESULT (2026-08-04, prod: 129,338 filings / 278,095 activities / 429 zero-activity):
//   C0 mass       SUM(activity_count) 278,095 == COUNT(lda_activities) 278,095   PASS
//      membership activity_count>0 128,909 == COUNT(DISTINCT filing_uuid) 128,909 PASS
//      row level  top 2,000 by count, column <> live COUNT(*): 0 rows             PASS
//   C1 visible range, 1,000 rows      IDENTICAL, position for position            PASS
//   C2 clamp boundary, three forms    IDENTICAL (25-unit, live pageSize 13, and
//                                     the shipped real LIMIT/OFFSET)
//   C3 zero-activity rows visible     0 of 429                                    PASS
//   C4 clamp margin                   rank-1000 activity_count = 11 vs 0          11 clear
//   C5 bill-linked branch             IDENTICAL across the whole visible range    PASS
//   C6 boundary-key ties              1 (the row itself) -> visible set is fully
//                                     determined, no tie-order ambiguity
//
// Laptop timings, indicative only (GREEN is the co-located probe, not this):
//   bare   old 75.20s -> new 280ms      linked  old 92.71s -> new 6.68s
// Both old figures are at LIMIT 1000, which is what makes the diff possible; the
// shipped feed asks for 13.
//
// ---------------------------------------------------------------------------
// GREEN / RED, CO-LOCATED (pdx1, throwaway preview probe on branch 597-probe,
// now deleted). One query per invocation at the shipped LIMIT 13, 90s gaps so
// every run is cold, probe client does NOT retry (lib/db.ts would spend 2x).
//
//   variant                     runs (ms)                        worst   margin
//   GREEN volume                564, 162, 36                      564ms  +9.44s
//   GREEN volume page 40        230, 363, 1481                   1.48s   +8.52s
//   GREEN volume+linked         315, 932, 2971                   2.97s   +7.03s
//   GREEN volume+linked page40  10003*, 5097, 6022, 7582, 15620  15.62s  -5.62s  BREACH
//   RED   volume                10003*  / 55002* at a 55s ceiling
//   RED   volume+linked         10001*
//   RED   volume+linked page40  10002*  / 55001* at a 55s ceiling
//   (* aborted at the ceiling, so the true duration is >= that)
//
// READ IT HONESTLY. RED breaches on EVERY VOLUME variant and does not finish in
// 55 SECONDS — worse than STEP 0 could see, because STEP 0 measured through the
// 10s+10s double-abort and so only ever learned "20s". THREE of the four GREEN
// variants clear the bound with +7.03s to +9.44s of margin.
//
// THE FOURTH DOES NOT. VOLUME x bill-linked x deep page went from ">55s, breaches
// always" to "6-15.6s, breached 2 of 5 cold runs" — a large improvement that is
// NOT a clear. It is reachable: 33,800 filings are bill-linked, and the pager
// offers 40 pages regardless of filter (the total comes from the rollup blob's
// corpus count, not the filtered set). Mechanism: the index walk is pre-ordered,
// but the EXISTS predicate is probed PER ROW, so reaching OFFSET 507 costs ~520
// correlated seeks whose cold page fetches dominate — the HO 594 residual class
// (page residency), not a plan shape. Its named fix is a second materialization
// (a bill_linked column + a (bill_linked, activity_count DESC, dt_posted DESC)
// index), which is beyond what this HO was scoped and priced for; filed in the
// backlog rather than widened into here.
//
// What DID change for it: defect 1. A breach on this key now degrades ONE request
// and the next re-queries, instead of caching the empty feed for an hour, and the
// guard's log line names the exact key (sort=volume linked=true page=40).
import "dotenv/config";
import { createClient } from "@libsql/client";

const MAX_FEED_PAGES = 40; // app/lobbying/page.tsx
const PAGE_SIZE = 13; // /lobbying unscoped feed (HO 493)
const VISIBLE = MAX_FEED_PAGES * 25; // the clamp argument is stated in the 25-row units the comment uses

function db() {
  const url = process.env.TURSO_DATABASE_URL;
  if (!url) throw new Error("TURSO_DATABASE_URL is not set");
  return createClient({
    url,
    authToken: process.env.TURSO_AUTH_TOKEN,
    // The OLD query is the aggregate this handoff retires; the 10s request bound
    // would abort it and CONTROL needs it to actually return. From the laptop it
    // exceeded 300s on the first attempt, hence the very long ceiling — and hence
    // running it TWICE in the whole script (once bare, once bill-linked) with
    // every page slice taken from those two result sets rather than re-queried
    // per page.
    fetch: (i: RequestInfo | URL, init?: RequestInit) =>
      fetch(i, { ...init, signal: AbortSignal.timeout(900_000) }),
  });
}
const c = db();
const ms = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(2)}s` : `${Math.round(n)}ms`);

// Verbatim shapes from lib/queries.ts::getRecentFilings. `linked` mirrors the
// billLinked EXISTS branch.
function oldSql(linked: boolean): string {
  return `SELECT f.filing_uuid
          FROM (
            SELECT filing_uuid, COUNT(*) AS c FROM lda_activities GROUP BY filing_uuid
          ) ac
          JOIN lda_filings f ON f.filing_uuid = ac.filing_uuid
          ${linked ? "WHERE EXISTS (SELECT 1 FROM lda_activity_bills ab WHERE ab.filing_uuid = f.filing_uuid)" : ""}
          ORDER BY ac.c DESC, f.dt_posted DESC LIMIT ? OFFSET ?`;
}
function newSql(linked: boolean): string {
  return `SELECT f.filing_uuid
          FROM lda_filings f INDEXED BY idx_lda_filings_activity
          ${linked ? "WHERE EXISTS (SELECT 1 FROM lda_activity_bills ab WHERE ab.filing_uuid = f.filing_uuid)" : ""}
          ORDER BY f.activity_count DESC, f.dt_posted DESC LIMIT ? OFFSET ?`;
}

async function seq(sql: string, limit: number, offset: number): Promise<{ ids: string[]; took: number }> {
  const t0 = performance.now();
  const r = await c.execute({ sql, args: [limit, offset] });
  return { ids: r.rows.map((x) => String(x.filing_uuid)), took: performance.now() - t0 };
}

function firstDiff(a: string[], b: string[]): number {
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) return i;
  return -1;
}

function report(label: string, a: string[], b: string[]): boolean {
  const d = firstDiff(a, b);
  console.log(
    `  ${label}: ${a.length} vs ${b.length} rows -> ` +
      (d === -1
        ? "IDENTICAL, position for position"
        : `*** DIVERGES at index ${d}: old=${a[d]} new=${b[d]}`),
  );
  return d === -1;
}

// One old-query execution + one new-query execution per branch; every page slice
// below is taken from these arrays.
async function visibleRange(linked: boolean) {
  const o = await seq(oldSql(linked), VISIBLE, 0);
  const n = await seq(newSql(linked), VISIBLE, 0);
  console.log(`  old shape ${ms(o.took)} | new shape ${ms(n.took)}   (laptop timings, indicative only — GREEN is co-located)`);
  return { old: o.ids, next: n.ids };
}

async function main() {
  console.log(`=== HO 597 CONTROL — VOLUME feed, old shape vs materialized shape ===`);
  const meta = await c.execute(`SELECT
      (SELECT COUNT(*) FROM lda_filings) AS filings,
      (SELECT COUNT(*) FROM lda_activities) AS acts,
      (SELECT COUNT(*) FROM lda_filings WHERE activity_count IS NULL) AS unfilled,
      (SELECT COUNT(*) FROM lda_filings WHERE activity_count = 0) AS zeros`);
  const m = meta.rows[0] as Record<string, unknown>;
  console.log(
    `  corpus: ${Number(m.filings).toLocaleString()} filings | ${Number(m.acts).toLocaleString()} activities | ` +
      `activity_count NULL ${Number(m.unfilled)} | = 0 ${Number(m.zeros)}`,
  );
  if (Number(m.unfilled) > 0) {
    console.log(`  *** ${Number(m.unfilled)} rows still NULL — run npm run backfill:lda-activity-count first.`);
    process.exitCode = 1;
    return;
  }

  // C0 — does the materialized column agree with the aggregate it replaced?
  //
  // NOT as a full anti-join: `lda_filings LEFT JOIN (the GROUP BY) WHERE col IS NOT
  // COALESCE(c,0)` has to materialize the aggregate AND join 129k rows against it,
  // and it exceeded 300s on the first attempt — this handoff's own lesson, met
  // while writing its CONTROL. Two set identities plus a row-level check on the
  // range that actually decides the feed give the same assurance for a fraction of
  // the work.
  console.log(`\n[C0] materialized column vs the aggregate it replaced`);
  const sums = await c.execute(
    `SELECT (SELECT SUM(activity_count) FROM lda_filings) AS colSum,
            (SELECT COUNT(*) FROM lda_activities) AS actRows,
            (SELECT COUNT(*) FROM lda_filings WHERE activity_count > 0) AS colNonZero,
            (SELECT COUNT(DISTINCT filing_uuid) FROM lda_activities) AS aggGroups`,
  );
  const s = sums.rows[0] as Record<string, unknown>;
  const massOk = Number(s.colSum) === Number(s.actRows);
  const memberOk = Number(s.colNonZero) === Number(s.aggGroups);
  console.log(
    `  mass:       SUM(activity_count) ${Number(s.colSum).toLocaleString()} vs COUNT(lda_activities) ${Number(s.actRows).toLocaleString()}  ${massOk ? "OK" : "*** MISMATCH"}`,
  );
  console.log(
    `  membership: activity_count > 0 ${Number(s.colNonZero).toLocaleString()} vs COUNT(DISTINCT filing_uuid) ${Number(s.aggGroups).toLocaleString()}  ${memberOk ? "OK" : "*** MISMATCH"}`,
  );
  // Row level, over the top slice — the only rows VOLUME can ever show.
  const topN = 2000;
  const rowCheck = await c.execute(
    `SELECT COUNT(*) AS n FROM (
       SELECT f.filing_uuid, f.activity_count AS col,
              (SELECT COUNT(*) FROM lda_activities a WHERE a.filing_uuid = f.filing_uuid) AS agg
         FROM lda_filings f INDEXED BY idx_lda_filings_activity
         ORDER BY f.activity_count DESC, f.dt_posted DESC LIMIT ${topN}
     ) WHERE col <> agg`,
  );
  const rowBad = Number((rowCheck.rows[0] as { n?: number }).n ?? 0);
  console.log(
    `  row level:  top ${topN.toLocaleString()} by count, rows where column <> live COUNT(*): ${rowBad}  ${rowBad === 0 ? "OK" : "*** MISMATCH"}`,
  );
  const bad = massOk && memberOk && rowBad === 0 ? 0 : 1;

  console.log(`\n[C1] the whole visible range — ${VISIBLE} rows (${MAX_FEED_PAGES} pages x 25)`);
  const c1 = await visibleRange(false);
  const c1ok = report("visible range", c1.old, c1.next);

  console.log(`\n[C2] the clamp boundary — the last visible page`);
  report("page 40 (25-row units)", c1.old.slice(VISIBLE - 25), c1.next.slice(VISIBLE - 25));
  const liveOff = (MAX_FEED_PAGES - 1) * PAGE_SIZE;
  report(
    `page ${MAX_FEED_PAGES} (live pageSize ${PAGE_SIZE})`,
    c1.old.slice(liveOff, liveOff + PAGE_SIZE),
    c1.next.slice(liveOff, liveOff + PAGE_SIZE),
  );
  // The slices above come from one LIMIT-1000 execution; confirm the SHIPPED
  // paging form (a real LIMIT/OFFSET on the new query) lands on the same rows.
  const paged = await seq(newSql(false), PAGE_SIZE, liveOff);
  report(`page ${MAX_FEED_PAGES} via real LIMIT/OFFSET (shipped form)`, c1.next.slice(liveOff, liveOff + PAGE_SIZE), paged.ids);

  console.log(`\n[C3] are the zero-activity filings — the ones the INNER JOIN used to drop — visible?`);
  const zeroRows = await c.execute(`SELECT filing_uuid FROM lda_filings WHERE activity_count = 0`);
  const zeroSet = new Set(zeroRows.rows.map((r) => String(r.filing_uuid)));
  const leaked = c1.next.filter((id) => zeroSet.has(id));
  console.log(
    `  zero-activity filings: ${zeroSet.size} | appearing in the visible ${VISIBLE}: ${leaked.length}` +
      (leaked.length === 0 ? "  OK — still invisible" : `  *** LEAKED: ${leaked.slice(0, 5).join(", ")}`),
  );

  console.log(`\n[C4] clamp margin, measured not assumed`);
  const b = await c.execute(
    `SELECT activity_count AS c FROM lda_filings INDEXED BY idx_lda_filings_activity
      ORDER BY activity_count DESC, dt_posted DESC LIMIT 1 OFFSET ${VISIBLE - 1}`,
  );
  const boundary = Number((b.rows[0] as { c?: number })?.c ?? 0);
  console.log(`  activity_count at rank ${VISIBLE} (last visible row): ${boundary}`);
  console.log(`  zero-activity rows carry 0 -> ${boundary} below the boundary; they cannot surface.`);

  console.log(`\n[C5] the branched path — bill-linked (?linked=1)`);
  const c5 = await visibleRange(true);
  const c5ok = report("linked visible range", c5.old, c5.next);
  report("linked page 1", c5.old.slice(0, 25), c5.next.slice(0, 25));
  report("linked page 40", c5.old.slice(VISIBLE - 25), c5.next.slice(VISIBLE - 25));

  // C6 — the honest caveat on a "position for position" claim. Two rows with the
  // SAME (activity_count, dt_posted) have no defined relative order, so two plans
  // may legitimately disagree about them. That only MATTERS at the clamp edge,
  // where it decides visibility. Count the ties that straddle it.
  console.log(`\n[C6] ties straddling the clamp boundary (where tie order would change VISIBILITY)`);
  const straddle = await c.execute(
    `SELECT COUNT(*) AS n FROM lda_filings f
      JOIN (SELECT activity_count AS ac, dt_posted AS dp FROM lda_filings INDEXED BY idx_lda_filings_activity
             ORDER BY activity_count DESC, dt_posted DESC LIMIT 1 OFFSET ${VISIBLE - 1}) k
        ON f.activity_count = k.ac AND f.dt_posted = k.dp`,
  );
  const ties = Number((straddle.rows[0] as { n?: number }).n ?? 0);
  console.log(
    `  rows sharing the boundary row's exact (activity_count, dt_posted): ${ties}` +
      (ties <= 1 ? "  OK — the boundary key is unique, so the visible set is fully determined" : `  NOTE: ${ties} rows share it; membership of the last page is tie-order dependent in BOTH shapes`),
  );

  console.log(`\n=== verdict ===`);
  console.log(`  C0 column agrees with the aggregate : ${bad === 0 ? "PASS" : "FAIL"}`);
  console.log(`  C1 visible range identical          : ${c1ok ? "PASS" : "FAIL"}`);
  console.log(`  C3 zero-activity rows invisible     : ${leaked.length === 0 ? "PASS" : "FAIL"}`);
  console.log(`  C5 bill-linked branch identical     : ${c5ok ? "PASS" : "FAIL"}`);
  if (!(bad === 0 && c1ok && leaked.length === 0 && c5ok)) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
