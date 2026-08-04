// HO 595 STEP 0 — what shape gets member_votes off the request path. READ-ONLY.
//
// 594 settled that the covering index is a large real improvement that does NOT
// close the defect: co-located steady state 140ms-1.5s, but the first touch of the
// member_votes index pages after a >60s gap costs 8.2-14.1s, worst 20.003s
// (TimeoutError, both attempts lost). Worst-case margin: -4.1s. Neither more
// indexing nor a cron warm can close that — a covering index still has to read
// non-resident pages, and sub-60s residency outruns cron granularity.
//
// EVERY MEASUREMENT HERE IS AT THE QUERY LEVEL, never the route level (594 finding
// #2): lib/db.ts retries once, so a route 500 needs BOTH attempts to breach and the
// route-failure rate is roughly the SQUARE of the query-breach rate. Route counts
// systematically understate this class — that is why 593's M2 table was unrankable.
//
// The co-located half (M4 + the residency control) does NOT live here: laptop
// timings cannot carry a tail claim (594). It runs from a throwaway preview route,
// and this file records the numbers it produced.
//
// CO-LOCATED RESULTS (pdx1, throwaway preview route on branch 595-probe, now
// deleted). Query-level, one execution each, 90s gaps so every run is cold:
//
//   query                        run1      run2      run3    worst
//   small_dashboard_state         15ms      26ms      15ms     26ms   <- never spikes
//   small_members (553 rows)      27ms    2.47s*     343ms    2.47s   (*first-in-request)
//   participation (the subject)  8.46s     7.39s     1.87s    8.46s   85% of bound
//   lda_volume_driver           20.005s   14.55s     6.95s   20.005s  TimeoutError, 128,702 rows
//   lda_count                    2.62s     2.79s     339ms    2.79s
//   bills_gated                  1.66s     1.54s     233ms    1.66s
//   bills_stage                  827ms     398ms     846ms    846ms
//   news_group                    42ms      43ms      12ms     43ms
//
// Two things fall straight out:
//   1. THE MATERIALIZATION THESIS HOLDS. A single-key dashboard_state read never
//      exceeded 26ms cold and a 553-row table read is ~343ms; neither shows the
//      residency decay the 366k-row aggregate does. Small IS resident.
//   2. lda_activities' VOLUME driver is a WORSE live offender than the subject of
//      this HO — 20.005s means both lib/db.ts attempts were lost. Inventory only.
//
//   npx tsx scripts/diagnostic/participation-materialize-595.ts
import "dotenv/config";
import { createClient } from "@libsql/client";

const BOUND_MS = 10_000;
const FLOOR = 50;
const REPEATS = 3;
let queriesRun = 0;

function db() {
  const url = process.env.TURSO_DATABASE_URL;
  if (!url) throw new Error("TURSO_DATABASE_URL is not set");
  return createClient({
    url,
    authToken: process.env.TURSO_AUTH_TOKEN,
    fetch: (i: RequestInfo | URL, init?: RequestInit) =>
      fetch(i, { ...init, signal: AbortSignal.timeout(120_000) }),
  });
}
const c = db();
const ms = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(2)}s` : `${Math.round(n)}ms`);

async function timed(sql: string, args: unknown[] = []) {
  const t: number[] = [];
  let rows = 0;
  for (let i = 0; i < REPEATS; i++) {
    const t0 = performance.now();
    const r = await c.execute({ sql, args: args as never });
    t.push(performance.now() - t0);
    rows = r.rows.length;
    queriesRun++;
  }
  const s = [...t].sort((a, b) => a - b);
  return { median: s[Math.floor(s.length / 2)] ?? 0, worst: s[s.length - 1] ?? 0, rows };
}

// ---------------------------------------------------------------------------
// M1 — the shape fork. The discriminator is the CONSUMERS, not the storage.
// ---------------------------------------------------------------------------
async function m1() {
  console.log(`=== M1 — shape fork: 536-row materialized table vs dashboard_state blob ===`);

  // How the CTE is actually consumed today (lib/queries.ts):
  //   5896 / 6045  LEFT JOIN part_agg pa ON pa.bid = m.bioguide_id
  //   5892 / 6035  SELECT ... MISSED_CARVE_EXPR AS missed_pct
  //   5899 / 6049  ORDER BY CASE WHEN ? = 'missed' THEN MISSED_CARVE_EXPR END DESC
  //   plus LIMIT/OFFSET pagination in the same statement
  // MISSED_CARVE_EXPR reads `pa.missed_pct` and is repeated in the ORDER BY on
  // purpose (HO 535, :5852): an ORDER BY expression resolves a bare column against
  // the INPUT tables, not the SELECT alias, so ordering by the alias would rank a
  // delegate by their raw rate while displaying "—".
  console.log(`
  CONSUMER SHAPE (the thing that decides this):
    part_agg is LEFT JOINed and its column is used in SELECT, in ORDER BY, and
    upstream of LIMIT/OFFSET pagination — all inside one SQL statement.

  (A) MATERIALIZED TABLE  member_participation(bioguide_id PK, missed_pct, total)
      Change surface: participationAggCte()'s body only — 'part_agg AS (SELECT ...
      FROM member_votes ...)' becomes a plain source. The LEFT JOIN, the
      MISSED_CARVE_EXPR carve-out, the ORDER BY and the pagination are BYTE-UNCHANGED.
      Ranking stays in SQL. 3 call sites keep working with 1 edit.

  (B) dashboard_state BLOB
      Change surface: every consumer. The ranking + pagination cannot stay in SQL
      because the sort key would live in JS, so getMembersRanked and
      getCommitteeRoster would each have to pull the filtered member set, join in
      JS, re-implement MISSED_CARVE_EXPR by hand, sort, and paginate — moving the
      exact subtlety HO 535 wrote a 6-line comment to protect into hand-written
      code, twice. The strip and the chamber context would be fine either way.`);

  // Price the reads. There is no 536-row participation table yet (no DDL in a
  // STEP 0), so use the closest existing analogue: `members` is 553 rows and is
  // the very table these would join against.
  const small = await timed(`SELECT bioguide_id, party, chamber, state FROM members`);
  console.log(`\n  read cost, 553-row analogue (members full read): median ${ms(small.median)} worst ${ms(small.worst)} rows=${small.rows}`);
  const blobRead = await timed(`SELECT value FROM dashboard_state WHERE key = ?`, ["lobbying_rollup"]);
  console.log(`  read cost, dashboard_state single key           : median ${ms(blobRead.median)} worst ${ms(blobRead.worst)} rows=${blobRead.rows}`);

  const strip = await c.execute({
    sql: `SELECT mv.bioguide_id AS b, COUNT(*) AS total,
                 SUM(CASE WHEN mv.position='not_voting' THEN 1 ELSE 0 END) AS nv
            FROM member_votes mv INDEXED BY idx_member_votes_participation
           GROUP BY mv.bioguide_id HAVING COUNT(*) >= ${FLOOR}`,
    args: [],
  });
  queriesRun++;
  const blob = JSON.stringify(
    strip.rows.map((r) => ({ b: r.b, t: Number(r.total ?? 0), v: Number(r.nv ?? 0) })),
  );
  console.log(`  artefact size: ${strip.rows.length} rows -> ${(blob.length / 1024).toFixed(1)} KB as a blob`);
  console.log(`  as a table   : ${strip.rows.length} rows x ~24B ≈ ${((strip.rows.length * 24) / 1024).toFixed(1)} KB + PK index — permanently resident at this size`);
  console.log(`\n  RECOMMENDATION: (A) the table. Both storage shapes read in ms; the fork is`);
  console.log(`  decided by the consumers, and (B) forces SQL ranking + pagination + the`);
  console.log(`  HO 535 carve-out into JS at two call sites for no measured gain.`);
}

// ---------------------------------------------------------------------------
// M2 — freshness, as a trade with a number on it.
// ---------------------------------------------------------------------------
async function m2() {
  console.log(`\n=== M2 — freshness trade ===`);
  const r = await c.execute(
    `SELECT COUNT(*) AS votes,
            (SELECT COUNT(*) FROM member_votes) AS mv,
            (SELECT COUNT(DISTINCT bioguide_id) FROM member_votes) AS members
       FROM votes`,
  );
  queriesRun++;
  const row = r.rows[0] as Record<string, unknown>;
  const votes = Number(row.votes ?? 0);
  const mv = Number(row.mv ?? 0);
  const members = Number(row.members ?? 0);
  const perMember = mv / Math.max(members, 1);

  // How fast can the metric actually move? It is CUMULATIVE over a member's career
  // votes, so one additional roll call moves it by at most 1/(n+1).
  const maxDelta = (1 / (perMember + 1)) * 100;
  console.log(`  votes: ${votes.toLocaleString()}   member_votes: ${mv.toLocaleString()}   ~${perMember.toFixed(0)} votes/member`);
  console.log(`  ONE additional roll call moves a member's cumulative missed% by at most ${maxDelta.toFixed(3)} pp`);
  console.log(`  today: unstable_cache revalidate 3600 -> values already up to 1h stale`);
  console.log(`  refresh carrier: /api/sync-votes, cron "0 10 * * *" = ONCE DAILY (vercel.json:60)`);
  console.log(`    -> materialized staleness would be up to ~24h, vs ~1h today. That is the trade.`);
  console.log(`    The House does not vote every day; on a heavy day (~20 roll calls) the drift`);
  console.log(`    ceiling is ~${(maxDelta * 20).toFixed(2)} pp, and the surface renders one decimal.`);
  console.log(`  NOT glossed: 24h > 1h is a real regression in freshness. It is defensible only`);
  console.log(`  because the metric is cumulative over ~${perMember.toFixed(0)} votes; if the refresh should be`);
  console.log(`  tighter, the votes sync is also the writer, so a second daily tick is the lever.`);
}

// ---------------------------------------------------------------------------
// M3 — does the covering index still earn its keep once the request path is off?
// ---------------------------------------------------------------------------
async function m3() {
  console.log(`\n=== M3 — keep or drop idx_member_votes_participation ===`);
  const agg = (hint: string) => `SELECT mv.bioguide_id AS b, COUNT(*) AS total,
        SUM(CASE WHEN mv.position='not_voting' THEN 1 ELSE 0 END) AS nv
   FROM member_votes mv ${hint}
  GROUP BY mv.bioguide_id HAVING COUNT(*) >= ${FLOOR}`;

  // "Without the index" is measured WITHOUT dropping it: forcing the older
  // non-covering idx_member_votes_bioguide reproduces the pre-594 plan exactly
  // (SCAN + row fetch for `position`).
  const withIdx = await timed(agg("INDEXED BY idx_member_votes_participation"));
  console.log(`  refresh job WITH index   : median ${ms(withIdx.median)} worst ${ms(withIdx.worst)}`);
  const withoutIdx = await timed(agg("INDEXED BY idx_member_votes_bioguide"));
  console.log(`  refresh job WITHOUT index: median ${ms(withoutIdx.median)} worst ${ms(withoutIdx.worst)}   (pre-594 plan, forced)`);
  console.log(`\n  against 594 C5's write cost on the DELETE-AND-REBUILD-per-vote path:`);
  console.log(`    before index: median 2.49s worst 4.99s`);
  console.log(`    after  index: median 5.12s worst 17.10s      (~2x median, ~3.4x worst)`);
  const stillBreaches = withoutIdx.worst >= BOUND_MS;
  console.log(`\n  RECOMMENDATION: ${
    stillBreaches
      ? "KEEP. Without it the refresh itself is " + ms(withoutIdx.worst) + " worst, i.e. still past the " + ms(BOUND_MS) +
        " bound — the refresh job runs through the same lib/db.ts client and would abort. The index stops being a request-path fix and becomes the thing that lets the refresh job finish inside the bound at all. Its 2x write cost is charged once per vote on a daily sync; the alternative is a refresh that cannot complete."
      : "DROP is arguable — the refresh completes inside the bound without it, so the 2x write cost buys little."
  }`);
  console.log(`  (Either way it is its own migration in its own commit — never folded into the rewire.)`);
}

// ---------------------------------------------------------------------------
// M4 — blast radius. Laptop numbers are INDICATIVE ONLY; the co-located run is
// what counts and is recorded alongside.
// ---------------------------------------------------------------------------
async function m4() {
  console.log(`\n=== M4 — request-path queries that read a large table (inventory, fix nothing) ===`);
  const cands: Array<{ name: string; sql: string; why: string }> = [
    {
      // The SHIPPED driving subquery of the VOLUME sort (lib/queries.ts:3006), not a
      // reconstruction. An earlier pass here timed `GROUP BY registrant_name` on
      // lda_filings at 27s and nearly reported it as a finding — that query is not one
      // the app runs. Same mistake 594 M4 made with participationAggCte; time shipped
      // SQL or nothing.
      name: "lda_activities GROUP BY filing_uuid (VOLUME driver, HO 544)",
      sql: `SELECT filing_uuid, COUNT(*) AS c FROM lda_activities GROUP BY filing_uuid`,
      why: "the handoff's named first entry; drives the /lobbying VOLUME sort",
    },
    {
      name: "lda_filings full count",
      sql: `SELECT COUNT(*) AS n FROM lda_filings`,
      why: "oversized side table",
    },
    {
      name: "bills corpus stage aggregate",
      sql: `SELECT stage, COUNT(*) AS n FROM bills GROUP BY stage`,
      why: "fat table, request-path dashboard aggregate",
    },
    {
      name: "bills topic aggregate (ungated)",
      sql: `SELECT COUNT(*) AS n FROM bills WHERE summary IS NOT NULL`,
      why: "summary-gated corpus count, the HO 277 class",
    },
    {
      name: "news_mentions GROUP BY bill",
      sql: `SELECT bill_id, COUNT(*) AS n FROM news_mentions GROUP BY bill_id`,
      why: "news rail join side",
    },
    {
      name: "observation_entities GROUP BY entity",
      sql: `SELECT entity_type, COUNT(*) AS n FROM observation_entities GROUP BY entity_type`,
      why: "grows with the news cron",
    },
    {
      name: "member_votes participation (the subject)",
      sql: `SELECT mv.bioguide_id, COUNT(*) AS n FROM member_votes mv INDEXED BY idx_member_votes_participation GROUP BY mv.bioguide_id HAVING COUNT(*) >= ${FLOOR}`,
      why: "baseline for comparison",
    },
  ];

  const out: Array<{ name: string; worst: number; median: number; why: string }> = [];
  for (const q of cands) {
    try {
      const t = await timed(q.sql);
      out.push({ name: q.name, worst: t.worst, median: t.median, why: q.why });
      console.log(`  ${q.name.padEnd(44)} median=${ms(t.median).padStart(8)} worst=${ms(t.worst).padStart(8)}`);
    } catch (e) {
      console.log(`  ${q.name.padEnd(44)} ERROR ${String(e).slice(0, 70)}`);
    }
  }
  console.log(`\n  RANKED by worst (LAPTOP — indicative only, see the co-located table in the commit):`);
  for (const r of out.sort((a, b) => b.worst - a.worst)) {
    console.log(`    ${ms(r.worst).padStart(8)}  ${r.name}\n              ${r.why}`);
  }
}

async function main() {
  await m1();
  await m2();
  await m3();
  await m4();
  console.log(`\n[595] queries executed against prod Turso: ${queriesRun}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
