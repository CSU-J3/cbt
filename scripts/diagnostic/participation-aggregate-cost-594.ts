// HO 594 STEP 0 — what the participation aggregates actually cost. READ-ONLY.
//
// 593 named the 500: digest 4101894172, TimeoutError = the HO 238 10s
// DB_REQUEST_TIMEOUT_MS abort, on getParticipationStrip (/members) and
// getChamberParticipationContext (/members/[bioguideId]). Both are unhinted
// aggregates over member_votes JOIN members GROUP BY bioguide_id, cached at
// revalidate 3600, so the 500 is the blocking cache-miss recompute.
//
// WHY NOT EXPLAIN (oddities.md:432): EXPLAIN prices the PLAN, not the runtime
// scan. A full-corpus aggregate has a clean-looking plan. Everything here is a
// TIMED execution.
//
// MEASUREMENT CLIENT IS UNBOUNDED ON PURPOSE. lib/db.ts wraps every request in
// AbortSignal.timeout(10s) + retry-once, so a query that costs 14s reads as
// "10s then 10s again" through getDb(). To report a true worst case against the
// bound we need the untruncated number, so this builds its own client with a
// 120s ceiling. That is a measurement instrument, NOT a suggestion to raise the
// production bound (scope guard 2).
//
// LAPTOP vs RUNTIME. This runs laptop -> Turso (us-west-2); prod runs pdx1,
// co-located. Backlog:258 records routes that 500 from the laptop and 200 in
// prod, so absolute numbers here OVERSTATE the runtime. The RATIOS between
// variants are the transferable result, and the prod-side confirmation that the
// bound is genuinely breached is 593's M3 (the TimeoutError groups themselves).
//
// READ BUDGET. Every timed variant is a real scan of member_votes. REPEATS is
// deliberately small and every query run is counted and reported.
//
//   npx tsx scripts/diagnostic/participation-aggregate-cost-594.ts
//   npx tsx scripts/diagnostic/participation-aggregate-cost-594.ts --m4   # inventory only
import "dotenv/config";
import { createClient } from "@libsql/client";

const MEASURE_TIMEOUT_MS = 120_000;
const PROD_BOUND_MS = 10_000; // lib/db.ts DB_REQUEST_TIMEOUT_MS — the thing we score against
const REPEATS = 3;
const PARTICIPATION_FLOOR = 50;

let queriesRun = 0;

function measureClient() {
  const url = process.env.TURSO_DATABASE_URL;
  const authToken = process.env.TURSO_AUTH_TOKEN;
  if (!url) throw new Error("TURSO_DATABASE_URL is not set");
  return createClient({
    url,
    authToken,
    fetch: (input: RequestInfo | URL, init?: RequestInit) =>
      fetch(input, { ...init, signal: AbortSignal.timeout(MEASURE_TIMEOUT_MS) }),
  });
}

const db = measureClient();
const ms = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(2)}s` : `${Math.round(n)}ms`);

async function timeSql(sql: string, args: unknown[] = []): Promise<{ ms: number[]; rows: number }> {
  const times: number[] = [];
  let rows = 0;
  for (let i = 0; i < REPEATS; i++) {
    const t0 = performance.now();
    const res = await db.execute({ sql, args: args as never });
    times.push(performance.now() - t0);
    rows = res.rows.length;
    queriesRun++;
  }
  return { ms: times, rows };
}

function report(label: string, t: { ms: number[]; rows: number }, note = "") {
  const sorted = [...t.ms].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)] ?? 0;
  const worst = sorted[sorted.length - 1] ?? 0;
  const verdict =
    worst >= PROD_BOUND_MS ? "OVER BOUND" : worst >= PROD_BOUND_MS * 0.7 ? "NEAR BOUND" : "ok";
  console.log(
    `  ${label.padEnd(52)} median=${ms(median).padStart(8)} worst=${ms(worst).padStart(8)} rows=${String(t.rows).padStart(6)}  ${verdict}${note ? "  " + note : ""}`,
  );
  return { median, worst };
}

// The two named queries, verbatim from lib/queries.ts.
const STRIP_SQL = `SELECT mv.bioguide_id AS bioguideId, m.name AS name, m.party AS party,
                   m.chamber AS chamber,
                   CASE WHEN m.chamber = 'house'
                         AND m.state IN ('DC','AS','GU','MP','PR','VI')
                        THEN 1 ELSE 0 END AS isDelegate,
                   COUNT(*) AS total,
                   SUM(CASE WHEN mv.position = 'not_voting' THEN 1 ELSE 0 END) AS nv
              FROM member_votes mv
              JOIN members m ON m.bioguide_id = mv.bioguide_id
             WHERE m.is_current = 1
             GROUP BY mv.bioguide_id
            HAVING total >= ?`;

const CONTEXT_SQL = `SELECT m.chamber AS chamber,
                   COUNT(*) AS total,
                   SUM(CASE WHEN mv.position = 'not_voting' THEN 1 ELSE 0 END) AS nv
              FROM member_votes mv
              JOIN members m ON m.bioguide_id = mv.bioguide_id
             WHERE m.is_current = 1
             GROUP BY mv.bioguide_id
            HAVING total >= ?`;

async function m1() {
  console.log(`=== M1 — row counts and TIMED cost (bound=${ms(PROD_BOUND_MS)}, ${REPEATS} runs each) ===`);

  const counts = await db.execute(
    `SELECT (SELECT COUNT(*) FROM member_votes) AS mv,
            (SELECT COUNT(*) FROM members) AS m,
            (SELECT COUNT(*) FROM members WHERE is_current = 1) AS cur,
            (SELECT COUNT(DISTINCT bioguide_id) FROM member_votes) AS mvBio,
            (SELECT COUNT(*) FROM votes) AS votes`,
  );
  queriesRun++;
  const c = counts.rows[0] as Record<string, unknown>;
  const mvRows = Number(c.mv ?? 0);
  console.log(`  member_votes rows            : ${mvRows.toLocaleString()}`);
  console.log(`  distinct bioguide_id in mv   : ${Number(c.mvBio ?? 0).toLocaleString()}`);
  console.log(`  members rows / is_current=1  : ${Number(c.m ?? 0).toLocaleString()} / ${Number(c.cur ?? 0).toLocaleString()}`);
  console.log(`  votes rows                   : ${Number(c.votes ?? 0).toLocaleString()}`);

  console.log(`\n  -- the two named queries, as shipped --`);
  const strip = await timeSql(STRIP_SQL, [PARTICIPATION_FLOOR]);
  const s = report("getParticipationStrip (as shipped)", strip);
  const ctx = await timeSql(CONTEXT_SQL, [PARTICIPATION_FLOOR]);
  report("getChamberParticipationContext (as shipped)", ctx);

  const scanned = mvRows;
  const returned = strip.rows;
  console.log(
    `\n  SCANNED vs RETURNED: ${scanned.toLocaleString()} rows scanned -> ${returned} rows returned  (${(scanned / Math.max(returned, 1)).toFixed(0)}x)`,
  );
  console.log(
    `  The shipped comment sizes this by the ${returned} RETURNED. The work is the ${scanned.toLocaleString()} scanned.`,
  );
  return { mvRows, returned, stripWorst: s.worst, stripMedian: s.median };
}

async function m2(mvRows: number) {
  console.log(`\n=== M2 — the two fix shapes, priced ===`);

  // (a) INDEX-DRIVE. The existing index is idx_member_votes_bioguide(bioguide_id):
  // NOT covering, because the aggregate also needs `position` for the not_voting
  // SUM, so every row must be fetched from the table.
  //
  // We can price the covering index WITHOUT creating it (no DDL in a STEP 0):
  //   T_indexonly = a GROUP BY that needs ONLY bioguide_id  -> the existing index
  //                 can serve it index-only
  //   T_shipped   = the same GROUP BY that also reads `position` -> forces the
  //                 row fetch
  // The delta between them IS the row-fetch cost a covering (bioguide_id, position)
  // index would remove. That is the measured value of option (a).
  console.log(`  (a) index-drive — pricing the covering index by measuring the row-fetch delta`);
  const idxOnly = await timeSql(`SELECT bioguide_id, COUNT(*) AS total FROM member_votes GROUP BY bioguide_id`);
  const a1 = report("GROUP BY needing ONLY bioguide_id (index-only)", idxOnly);
  const withPos = await timeSql(
    `SELECT bioguide_id, COUNT(*) AS total,
            SUM(CASE WHEN position = 'not_voting' THEN 1 ELSE 0 END) AS nv
       FROM member_votes GROUP BY bioguide_id`,
  );
  const a2 = report("same GROUP BY + position (forces row fetch)", withPos);
  console.log(
    `      row-fetch cost a covering index would remove: ${ms(Math.max(0, a2.median - a1.median))} of median`,
  );

  // (b) PRECOMPUTE. Price the artefact, not the vibe: how many rows, how big is
  // the blob, and what does reading it back cost.
  console.log(`\n  (b) precompute into dashboard_state — pricing the artefact`);
  const pre = await db.execute({ sql: STRIP_SQL, args: [PARTICIPATION_FLOOR] });
  queriesRun++;
  const blob = JSON.stringify(
    pre.rows.map((r) => ({
      b: r.bioguideId, n: r.name, p: r.party, c: r.chamber,
      d: Number(r.isDelegate ?? 0), t: Number(r.total ?? 0), v: Number(r.nv ?? 0),
    })),
  );
  console.log(`      rows to store: ${pre.rows.length}   serialised blob: ${(blob.length / 1024).toFixed(1)} KB`);
  const readBack = await timeSql(`SELECT value FROM dashboard_state WHERE key = ?`, ["__nonexistent_594__"]);
  report("dashboard_state single-key read (the request-time cost)", readBack);
  console.log(`      write cadence would ride the votes sync (the tag these queries already flush on)`);
}

async function m3(stripWorst: number, stripMedian: number) {
  console.log(`\n=== M3 — is the cache posture itself part of the fix? ===`);
  console.log(`  shipped posture: unstable_cache(revalidate: 3600, tags: ["votes"]) — a BLOCKING miss.`);
  console.log(`  measured recompute: median ${ms(stripMedian)}, worst ${ms(stripWorst)} (laptop; prod is co-located and faster)`);
  const marginMedian = PROD_BOUND_MS - stripMedian;
  const marginWorst = PROD_BOUND_MS - stripWorst;
  console.log(`  margin under the ${ms(PROD_BOUND_MS)} bound: median ${ms(marginMedian)}, worst ${ms(marginWorst)}`);
  console.log(
    `  VERDICT: ${
      stripWorst >= PROD_BOUND_MS
        ? "the recompute can exceed the bound, so SOME user request eats it — the query must get faster; a warm-by-cron posture additionally removes the user from the recompute path entirely."
        : "the recompute fits the bound with margin; the cache posture alone is not the defect."
    }`,
  );
}

// ---------------------------------------------------------------------------
// M4 — inventory. Where else does "sized by rows returned" reasoning live?
// ---------------------------------------------------------------------------
type Candidate = { name: string; sql: string; args: unknown[]; why: string };

async function m4() {
  console.log(`\n=== M4 — unbounded-aggregate inventory (TIMED, not planned) ===`);

  // Aggregates over the large tables with no INDEXED BY and no bounding WHERE.
  // Shapes lifted from lib/queries.ts; each is timed, then ranked by worst case.
  const cands: Candidate[] = [
    {
      name: "member_votes GROUP BY bioguide (the named pair)",
      sql: STRIP_SQL, args: [PARTICIPATION_FLOOR],
      why: "GROUP BY over the large side, no hint — the 593 defect",
    },
    {
      // The SHIPPED text of participationAggCte() (lib/queries.ts:5813), not a
      // reconstruction. Inlined verbatim as its own SELECT so it can be timed
      // alone. 593 never named this one — it is a THIRD instance of the same
      // defect, and worse: no join, no WHERE, no hint at all.
      name: "participationAggCte (HO 535) — the UNNAMED third instance",
      sql: `SELECT mv.bioguide_id AS bid,
                   CAST(SUM(CASE WHEN mv.position = 'not_voting' THEN 1 ELSE 0 END) AS REAL)
                     / COUNT(*) AS missed_pct
              FROM member_votes mv
             GROUP BY mv.bioguide_id
            HAVING COUNT(*) >= ${PARTICIPATION_FLOOR}`,
      args: [],
      why: "UNCONDITIONAL in getMembersRanked + getCommitteeRoster — runs on every /members and /committee/[code] render, any sort",
    },
    {
      name: "lda_filings full aggregate",
      sql: `SELECT COUNT(*) AS n FROM lda_filings`, args: [],
      why: "oversized side table (HO 543/544 VOLUME-sort watch)",
    },
    {
      name: "bills corpus-wide stage aggregate (ungated)",
      sql: `SELECT stage, COUNT(*) AS n FROM bills GROUP BY stage`, args: [],
      why: "fat table, GROUP BY, no hint",
    },
    {
      name: "news_mentions GROUP BY bill",
      sql: `SELECT bill_id, COUNT(*) AS n FROM news_mentions GROUP BY bill_id`, args: [],
      why: "join-side table for the news rails",
    },
    {
      name: "observation_entities GROUP BY entity",
      sql: `SELECT entity_type, COUNT(*) AS n FROM observation_entities GROUP BY entity_type`, args: [],
      why: "HO 394 entity layer, grows with the news cron",
    },
    {
      name: "votes GROUP BY chamber",
      sql: `SELECT chamber, COUNT(*) AS n FROM votes GROUP BY chamber`, args: [],
      why: "parent of member_votes",
    },
  ];

  const results: Array<{ name: string; median: number; worst: number; rows: number; why: string }> = [];
  for (const c of cands) {
    try {
      const t = await timeSql(c.sql, c.args);
      const r = report(c.name, t);
      results.push({ name: c.name, median: r.median, worst: r.worst, rows: t.rows, why: c.why });
    } catch (e) {
      console.log(`  ${c.name.padEnd(52)} ERROR ${String(e).slice(0, 80)}`);
    }
  }

  // The negative result matters as much as the ranking: every OTHER member_votes
  // site in lib/queries.ts is bounded by an equality/IN on an indexed column, so
  // the defect is the three unbounded GROUP BYs and nothing else on this table.
  console.log(`\n  member_votes sites checked and VERIFIED BOUNDED (not timed — bounded by construction):`);
  for (const s of [
    "3452 getVotesForBills      — WHERE mv.vote_id IN (…)",
    "3809 amendment vote splits — WHERE mv.vote_id IN (…)",
    "4002 bill vote splits      — WHERE mv.vote_id IN (…)",
    "7488 getMemberVote         — WHERE vote_id = ? AND bioguide_id = ?",
    "7531 member vote count     — WHERE bioguide_id = ?",
    "7557 getMemberVoteStats    — WHERE bioguide_id = ?",
    "7618 getVoteMemberPositions— WHERE mv.vote_id = ?",
  ]) console.log(`    ${s}`);

  console.log(`\n  RANKED by worst measured time against the ${ms(PROD_BOUND_MS)} bound:`);
  for (const r of results.sort((a, b) => b.worst - a.worst)) {
    const pct = ((r.worst / PROD_BOUND_MS) * 100).toFixed(0);
    console.log(`    ${ms(r.worst).padStart(8)}  (${pct.padStart(3)}% of bound)  ${r.name}`);
    console.log(`              ${r.why}`);
  }
}

async function main() {
  const onlyM4 = process.argv.includes("--m4");
  if (onlyM4) {
    await m4();
  } else {
    const { mvRows, stripWorst, stripMedian } = await m1();
    await m2(mvRows);
    await m3(stripWorst, stripMedian);
    await m4();
  }
  console.log(`\n[594] queries executed against prod Turso: ${queriesRun}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
