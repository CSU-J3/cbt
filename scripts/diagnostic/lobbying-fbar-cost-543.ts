// HO 543 STEP 0 — /lobbying fbar features: cost + shape probe (read-only).
// The .mc-fbar shows only a scope-count today; sort/search/toggles were cut from
// the HO 486 chrome restructure ("each needs a new query or a new capability on the
// corpus feed"). This probes the three candidates COLD against the corpus feed so
// the follow-on build ships only the GO subset. NO build, NO migration, NO index
// added here — SELECT/EXPLAIN only.
//
// The feed under all three: getRecentFilings — `FROM lda_filings INDEXED BY
// idx_lda_filings_dt_posted ORDER BY dt_posted DESC LIMIT ? OFFSET ?`, clamped to
// MAX_FEED_PAGES=40 (pageSize 25 → max offset 975). Pagination total is the rollup
// blob's stats.filings (108,707), NOT a live COUNT — which is what the toggle breaks.
//
// Raw client, NO boundedFetch (the 10s bound would abort a cold query and hide its
// true cost — the vote-detail-cost-540 / lda-arc idiom). Each distinct SQL is timed
// on its first run (cold-ish). Read-only.
//
//   npx tsx scripts/diagnostic/lobbying-fbar-cost-543.ts
import "dotenv/config";
import { createClient, type Client, type Row } from "@libsql/client";

const FEED_COLS = `filing_uuid, registrant_name, client_name, dt_posted, filing_type, filing_period, income, expenses`;
const MAX_OFFSET = 975; // (MAX_FEED_PAGES=40 - 1) * pageSize=25 — the worst in-clamp page

async function timed<T>(label: string, fn: () => Promise<T>): Promise<T> {
  const t0 = Date.now();
  const r = await fn();
  console.log(`   ⏱  ${label}: ${Date.now() - t0}ms`);
  return r;
}

async function explain(db: Client, sql: string, args: unknown[] = []): Promise<void> {
  const plan = await db.execute({ sql: `EXPLAIN QUERY PLAN ${sql}`, args: args as never[] });
  for (const p of plan.rows) console.log(`      ${(p as Row).detail}`);
}

async function main(): Promise<number> {
  const url = process.env.TURSO_DATABASE_URL;
  const authToken = process.env.TURSO_AUTH_TOKEN;
  if (!url) {
    console.log("TURSO_DATABASE_URL not set — run with the CBT .env (local working tree).");
    return 1;
  }
  const db: Client = createClient({ url, authToken });
  console.log("=== HO 543 STEP 0 — /lobbying fbar features cost + shape ===\n");

  // ── CONTEXT: corpus sizes ────────────────────────────────────────────────
  console.log("── context: corpus sizes ──");
  const nFilings = await timed("COUNT(*) lda_filings (why they don't live-COUNT)", () =>
    db.execute(`SELECT COUNT(*) AS n FROM lda_filings`),
  );
  const totalFilings = Number((nFilings.rows[0] as Row).n);
  console.log(`   lda_filings rows: ${totalFilings.toLocaleString()} (blob stats.filings baseline)`);
  const nActs = await db.execute(`SELECT COUNT(*) AS n FROM lda_activities`);
  console.log(`   lda_activities rows: ${Number((nActs.rows[0] as Row).n).toLocaleString()}`);
  const nAB = await db.execute(`SELECT COUNT(*) AS n FROM lda_activity_bills`);
  console.log(`   lda_activity_bills rows: ${Number((nAB.rows[0] as Row).n).toLocaleString()}\n`);

  // ── BASELINE: the current RECENT worst-in-clamp page ─────────────────────
  console.log("── baseline: RECENT (current feed) worst page @ offset 975 ──");
  const RECENT_SQL = `SELECT ${FEED_COLS} FROM lda_filings INDEXED BY idx_lda_filings_dt_posted
                      ORDER BY dt_posted DESC LIMIT 25 OFFSET ?`;
  const recent = await timed("RECENT page cold", () => db.execute({ sql: RECENT_SQL, args: [MAX_OFFSET] }));
  console.log(`      returned ${recent.rows.length} rows`);
  await explain(db, RECENT_SQL, [MAX_OFFSET]);
  console.log("");

  // ── CUT 1: bill-linked-only toggle ───────────────────────────────────────
  console.log("── CUT 1: bill-linked-only toggle ──");
  // The EXISTS join key is filing_uuid. lda_activity_bills PK = (filing_uuid,
  // activity_ordinal, bill_id) → filing_uuid is the PK LEADING column, so the
  // EXISTS should ride the PK (no new index needed). Confirm in the plan.
  const LINKED_SQL = `SELECT ${FEED_COLS} FROM lda_filings f INDEXED BY idx_lda_filings_dt_posted
                      WHERE EXISTS (SELECT 1 FROM lda_activity_bills ab WHERE ab.filing_uuid = f.filing_uuid)
                      ORDER BY dt_posted DESC LIMIT 25 OFFSET ?`;
  const linked = await timed("bill-linked filtered page cold @ offset 975", () =>
    db.execute({ sql: LINKED_SQL, args: [MAX_OFFSET] }),
  );
  console.log(`      returned ${linked.rows.length} rows`);
  console.log(`   EXPLAIN (does the EXISTS ride lda_activity_bills' PK on filing_uuid?):`);
  await explain(db, LINKED_SQL, [MAX_OFFSET]);
  // 1b — the total-pages denominator problem.
  console.log(`   the total problem: stats.filings=${totalFilings.toLocaleString()} is WRONG when the toggle is on.`);
  const linkedTotal = await timed("COUNT(DISTINCT filing_uuid) bill-linked (live total)", () =>
    db.execute(`SELECT COUNT(DISTINCT filing_uuid) AS n FROM lda_activity_bills`),
  );
  const linkedN = Number((linkedTotal.rows[0] as Row).n);
  console.log(`      bill-linked filings: ${linkedN.toLocaleString()} (${((100 * linkedN) / totalFilings).toFixed(1)}% of corpus)`);
  console.log(`      EXPLAIN of that COUNT(DISTINCT):`);
  await explain(db, `SELECT COUNT(DISTINCT filing_uuid) AS n FROM lda_activity_bills`);
  console.log("");

  // ── CUT 2: VOLUME sort fork — measure BOTH paths ─────────────────────────
  console.log("── CUT 2: sort RECENT ⇄ VOLUME — the fork ──");
  // 2a. dollars — ORDER BY expenses DESC. No index on income/expenses → full SCAN
  //     + temp B-tree sort every page. HO 442 caveat: LD-2 dollars are partial +
  //     income-vs-expense asymmetric (Corey declined dollar *rankings*; a sort is
  //     softer but same misleads risk).
  console.log("   (a) dollars — ORDER BY expenses DESC (no index on the sort column):");
  const DOLLARS_SQL = `SELECT ${FEED_COLS} FROM lda_filings ORDER BY expenses DESC LIMIT 25 OFFSET ?`;
  const dollars = await timed("      expenses-DESC page cold @ offset 975", () =>
    db.execute({ sql: DOLLARS_SQL, args: [MAX_OFFSET] }),
  );
  console.log(`         returned ${dollars.rows.length} rows`);
  await explain(db, DOLLARS_SQL, [MAX_OFFSET]);

  // 2b. activity count per filing — the per-filing intrinsic, no dollar caveat.
  //     Sorting the WHOLE corpus by it = full-corpus aggregate + temp sort of ~all
  //     groups. Expected non-viable live → needs a precomputed activity_count column.
  console.log("   (b) activity count per filing — live full-corpus aggregate-sort:");
  const ACTCOUNT_SQL = `SELECT filing_uuid, COUNT(*) AS c FROM lda_activities
                        GROUP BY filing_uuid ORDER BY c DESC LIMIT 25`;
  const actcount = await timed("      activity-count aggregate-sort cold", () => db.execute(ACTCOUNT_SQL));
  console.log(`         top filing activity-count: ${actcount.rows.length ? (actcount.rows[0] as Row).c : "n/a"}`);
  await explain(db, ACTCOUNT_SQL);
  // distribution context for defining VOLUME(b)
  const dist = await db.execute(`
    SELECT MAX(c) AS mx, AVG(c) AS av FROM (SELECT COUNT(*) AS c FROM lda_activities GROUP BY filing_uuid)`);
  console.log(`      activities/filing: max=${(dist.rows[0] as Row).mx} avg=${Number((dist.rows[0] as Row).av).toFixed(2)}`);
  console.log("");

  // ── CUT 3: registrant/client search ──────────────────────────────────────
  console.log("── CUT 3: registrant/client search (LIKE over 108k, no name/FTS index) ──");
  // Search rides the dt_posted walk with a LIKE filter. Worst case is a RARE/ZERO-
  // match term: it must walk the ENTIRE 108k index to return <25 rows (the HO
  // 336/338 bills-LIKE cold-abort class). A COMMON term fills LIMIT 25 early = cheap
  // — so the danger is the tail, not the head. Measure both to be honest.
  const COMMON = "%LLC%"; // matches many client/registrant names → LIMIT 25 fills early
  const RARE = "%zzqx-not-a-real-lobbyist-name%"; // 0 matches → forces the full walk
  const SEARCH_SQL = `SELECT ${FEED_COLS} FROM lda_filings INDEXED BY idx_lda_filings_dt_posted
                      WHERE (registrant_name LIKE ? OR client_name LIKE ?)
                      ORDER BY dt_posted DESC LIMIT 25`;
  const common = await timed(`common term '${COMMON}' (fills early)`, () =>
    db.execute({ sql: SEARCH_SQL, args: [COMMON, COMMON] }),
  );
  console.log(`      returned ${common.rows.length} rows`);
  const rare = await timed(`RARE/zero term '${RARE}' (full-walk worst case)`, () =>
    db.execute({ sql: SEARCH_SQL, args: [RARE, RARE] }),
  );
  console.log(`      returned ${rare.rows.length} rows  ← the cold-abort risk: a full 108k walk for <25 hits`);
  console.log(`   EXPLAIN (SCAN vs SEARCH):`);
  await explain(db, SEARCH_SQL, [RARE, RARE]);
  // interim: prefix on an (unindexed) name column — still a SCAN, so no cheaper
  // without a name index. Show it.
  const PREFIX_SQL = `SELECT ${FEED_COLS} FROM lda_filings WHERE registrant_name LIKE ? ORDER BY dt_posted DESC LIMIT 25`;
  const prefix = await timed(`prefix 'American%' on registrant_name (no index)`, () =>
    db.execute({ sql: PREFIX_SQL, args: ["American%"] }),
  );
  console.log(`      returned ${prefix.rows.length} rows`);
  await explain(db, PREFIX_SQL, ["American%"]);
  console.log("");

  console.log("=== summary (read the per-cut ms + EXPLAIN above) ===");
  console.log(`  corpus: ${totalFilings.toLocaleString()} filings (blob stats.filings is a stale snapshot — compare), ${linkedN.toLocaleString()} bill-linked (${((100 * linkedN) / totalFilings).toFixed(1)}%).`);
  console.log(`  NOTE: only the first query pays the cold connection tax (the COUNT(*) reading); per-cut numbers are warm-first-hit — the representative cache-MISS cost, since the feeds are unstable_cache'd.`);
  console.log(`  CUT 1 toggle: EXISTS rides the lda_activity_bills PK (filing_uuid leading) — no new index. Filter GO; the toggle-on TOTAL needs a blob stat (live COUNT(DISTINCT) is the ~1s TEMP-B-TREE scan).`);
  console.log(`  CUT 2 VOLUME fork: (a) dollars = full SCAN + temp sort (needs an index; HO 442 misleads caveat + income-vs-expenses ambiguity) · (b) activity-count = covering-PK agg + temp sort.`);
  console.log(`  CUT 3 search: LIKE rides the dt_posted walk; worst case = a rare/zero term full-walk. Compare that ms to the bills-FTS cold-abort class before calling NO-GO.`);

  db.close();
  return 0;
}

main()
  .then((c) => {
    process.exitCode = c;
  })
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
