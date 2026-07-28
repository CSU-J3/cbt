// HO 547 pre-build measurement (read-only) — VOLUME × search cold.
// STEP 0 (HO 546) measured search against the RECENT path only. VOLUME is the
// agg-driven INNER JOIN carrying a ~7s cold miss (HO 544 WATCH). A LIKE filter on
// VOLUME defeats the LIMIT short-circuit — the outer rows are ordered by activity
// count, so to collect 25 that ALSO match the term the query walks deeper (a rare/
// zero-match term walks the WHOLE materialized agg). This prices that worst case
// against the 10s wall to decide: does search COMPOSE with VOLUME, or FORCE RECENT?
//
// The worst case (VOLUME + zero-match) runs FIRST, fully cold — that's the number
// that decides. Later runs are page-cache-warm-assisted (same agg), labelled so.
//
// Raw @libsql/client, NO boundedFetch (the 10s bound would abort + hide the true
// cost). Read-only: SELECT / EXPLAIN only.
//
//   npx tsx scripts/diagnostic/lobbying-volume-search-547.ts
import "dotenv/config";
import { createClient, type Client, type Row } from "@libsql/client";

const COLS = `f.filing_uuid, f.registrant_name, f.client_name, f.dt_posted, f.filing_type, f.filing_period, f.income, f.expenses`;
const RECENT_COLS = `filing_uuid, registrant_name, client_name, dt_posted, filing_type, filing_period, income, expenses`;
// The search predicate: substring on registrant OR client, with ESCAPE so % / _ are literal.
const SEARCH = `(f.registrant_name LIKE ? ESCAPE '\\' OR f.client_name LIKE ? ESCAPE '\\')`;
const SEARCH_RECENT = `(registrant_name LIKE ? ESCAPE '\\' OR client_name LIKE ? ESCAPE '\\')`;

function likeArg(term: string): string {
  return `%${term.replace(/[\\%_]/g, "\\$&")}%`;
}

async function timed<T>(label: string, fn: () => Promise<T>): Promise<T> {
  const t0 = Date.now();
  const r = await fn();
  console.log(`   ⏱  ${label}: ${Date.now() - t0}ms`);
  return r;
}

async function explain(db: Client, sql: string, args: unknown[]): Promise<void> {
  const plan = await db.execute({ sql: `EXPLAIN QUERY PLAN ${sql}`, args: args as never[] });
  for (const p of plan.rows) console.log(`      · ${(p as Row).detail}`);
}

// VOLUME sql (agg-driven INNER JOIN), optionally + linked + search — mirrors getRecentFilings.
function volSql(opts: { linked?: boolean; search?: boolean }): string {
  const clauses: string[] = [];
  if (opts.linked) clauses.push(`EXISTS (SELECT 1 FROM lda_activity_bills ab WHERE ab.filing_uuid = f.filing_uuid)`);
  if (opts.search) clauses.push(SEARCH);
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : ``;
  return `SELECT ${COLS}
          FROM ( SELECT filing_uuid, COUNT(*) AS c FROM lda_activities GROUP BY filing_uuid ) ac
          JOIN lda_filings f ON f.filing_uuid = ac.filing_uuid
          ${where}
          ORDER BY ac.c DESC, f.dt_posted DESC LIMIT ? OFFSET ?`;
}
function recentSql(opts: { linked?: boolean; search?: boolean }): string {
  const clauses: string[] = [];
  if (opts.linked) clauses.push(`EXISTS (SELECT 1 FROM lda_activity_bills ab WHERE ab.filing_uuid = f.filing_uuid)`);
  if (opts.search) clauses.push(SEARCH);
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : ``;
  return `SELECT ${COLS} FROM lda_filings f INDEXED BY idx_lda_filings_dt_posted ${where} ORDER BY f.dt_posted DESC LIMIT ? OFFSET ?`;
}

async function main(): Promise<number> {
  const url = process.env.TURSO_DATABASE_URL;
  if (!url) { console.log("TURSO_DATABASE_URL not set — run with the CBT .env."); return 1; }
  const db: Client = createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN });
  console.log("=== HO 547 pre-build — VOLUME × search cold (decides compose vs force-RECENT) ===\n");

  const ZERO = likeArg("ZZQXNOMATCHZZ"); // matches nothing → full walk (worst case)
  const COMMON = likeArg("CORNERSTONE"); // top firm, 1,865 filings
  const P25 = [25, 0];

  // ── THE DECIDER: VOLUME + zero-match, FIRST + COLD ────────────────────────
  console.log("── DECIDER: VOLUME + zero-match search (first, fully cold — the worst walk) ──");
  await explain(db, volSql({ search: true }), [ZERO, ZERO, ...P25]);
  await timed("VOLUME + '%ZZQXNOMATCHZZ%' (zero match)", () =>
    db.execute({ sql: volSql({ search: true }), args: [ZERO, ZERO, ...P25] }),
  );
  console.log("");

  // ── context: VOLUME base (warm-assisted now — same agg pages cached) ──────
  console.log("── VOLUME base, no search (warm-assisted; HO 544 WATCH baseline ~7s cold) ──");
  await timed("VOLUME base", () => db.execute({ sql: volSql({}), args: P25 }));
  console.log("");

  console.log("── VOLUME + common term '%CORNERSTONE%' (warm-assisted) ──");
  const vc = await timed("VOLUME + common", () => db.execute({ sql: volSql({ search: true }), args: [COMMON, COMMON, ...P25] }));
  console.log(`   rows: ${vc.rows.length}`);
  console.log("── VOLUME + linked + common (warm-assisted) ──");
  await timed("VOLUME + linked + common", () => db.execute({ sql: volSql({ linked: true, search: true }), args: [COMMON, COMMON, ...P25] }));
  console.log("");

  // ── RECENT × search (confirm HO 543's 200ms–1.2s + EXPLAIN the OR under the forced index) ──
  console.log("── RECENT + search: EXPLAIN (confirm plain scan under forced idx_lda_filings_dt_posted, no MULTI-INDEX-OR) ──");
  await explain(db, recentSql({ search: true }), [ZERO, ZERO, ...P25]);
  console.log("");
  console.log("── RECENT + zero-match (worst walk on the recent path) ──");
  const rz = await timed("RECENT + zero-match", () => db.execute({ sql: recentSql({ search: true }), args: [ZERO, ZERO, ...P25] }));
  console.log(`   rows: ${rz.rows.length}`);
  console.log("── RECENT + common ──");
  const rc = await timed("RECENT + common", () => db.execute({ sql: recentSql({ search: true }), args: [COMMON, COMMON, ...P25] }));
  console.log(`   rows: ${rc.rows.length}`);
  console.log("── RECENT + linked + zero-match (EXPLAIN + time) ──");
  await explain(db, recentSql({ linked: true, search: true }), [ZERO, ZERO, ...P25]);
  await timed("RECENT + linked + zero-match", () => db.execute({ sql: recentSql({ linked: true, search: true }), args: [ZERO, ZERO, ...P25] }));
  console.log("");

  // ── the live COUNT total under each shape (the pagination-total the build runs in parallel) ──
  console.log("── live COUNT(*) totals (run in Promise.all with the page query) ──");
  await explain(db, `SELECT COUNT(*) AS n FROM lda_filings f WHERE ${SEARCH}`, [ZERO, ZERO]);
  await timed("COUNT recent-shape + zero-match", () =>
    db.execute({ sql: `SELECT COUNT(*) AS n FROM lda_filings f WHERE ${SEARCH}`, args: [ZERO, ZERO] }),
  );
  await timed("COUNT recent-shape + common", () =>
    db.execute({ sql: `SELECT COUNT(*) AS n FROM lda_filings f WHERE ${SEARCH}`, args: [COMMON, COMMON] }),
  );
  // VOLUME-shape count (INNER JOIN to agg) — only needed if search composes with VOLUME
  await timed("COUNT volume-shape + zero-match (agg-joined)", () =>
    db.execute({ sql: `SELECT COUNT(*) AS n FROM ( SELECT filing_uuid FROM lda_activities GROUP BY filing_uuid ) ac JOIN lda_filings f ON f.filing_uuid = ac.filing_uuid WHERE ${SEARCH}`, args: [ZERO, ZERO] }),
  );
  return 0;
}

main().then((c) => process.exit(c)).catch((e) => { console.error(e); process.exit(1); });
