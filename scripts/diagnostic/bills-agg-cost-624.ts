// HO 624 STEP 0 — `bills_agg` cost probe: read-only. BUILDS NOTHING.
//
// THE QUESTION. The backlog (HO 602) records `bills_agg` as the account's largest
// single read consumer: 110M rows / 30d, 317 calls, ~347k rows per call, 26% of the
// budget. The arithmetic is not in doubt; the ATTRIBUTION is. Two facts cast doubt:
//
//   1. ~347k is not a `bills`-shaped number. The corpus is ~17k bills. But
//      `member_votes` was ~366k — and until HO 595, participationAggCte() full-scanned
//      it INSIDE THE SAME `getMembersRanked` STATEMENT that carries `bills_agg`. The
//      per-query ledger attributes by statement text; both CTEs share one statement.
//   2. The HO 602 window (30d, read in early August) STRADDLES the HO 595 fix, so it
//      contains weeks of pre-materialization executions at ~366k rows each.
//
// Null hypothesis: the 110M line is mostly the participation scan HO 595 already
// killed, wearing `bills_agg`'s name, and the true present-tense cost of this
// statement is ~25x smaller. If so, optimizing `bills_agg` now tunes a ghost — the
// HO 420/577 invalidation class at ledger scale.
//
// ── WHY THIS PROBE USES RAW HTTP AND NOT @libsql/client (the one deviation) ────────
// The house diagnostic idiom (absence-watch-588.ts, motion-outcome-model-554.ts) is
// raw `@libsql/client`. This probe does NOT use it, deliberately: `@libsql/client`
// v0.14.0 does NOT surface per-statement `rows_read` (grepped — the field is absent
// from its types and its lib-esm tree). Turso's hrana `/v2/pipeline` endpoint DOES
// return `rows_read` + `query_duration_ms` per statement.
//
// That changes what this probe is. The handoff specified M3 as an ARITHMETIC
// reconciliation — sum M1's addends, compare to the ledger's ~347k. Reading rows_read
// off the wire makes it a DIRECT MEASUREMENT of the same quantity the ledger meters,
// so the arithmetic becomes a CHECK on the measurement rather than the verdict
// itself. The handoff's own framing — "make the statement's current per-call cost an
// arithmetic fact" — is better served by measuring it than by deriving it. Everything
// is still read-only; the endpoint is the same DB over the same credentials.
//
// ── M0 IS NOT CEREMONY: THE INSTRUMENT HAS A TRAP ─────────────────────────────────
// `rows_read` is LITERAL for real scans, but a BARE `COUNT(*)` over a whole table is
// answered from B-tree interior pages and UNDER-REPORTS by orders of magnitude:
//
//     SELECT COUNT(*) FROM member_votes   ->  366,496 rows, rows_read =  1,617
//     SELECT COUNT(*) FROM bills          ->   17,463 rows, rows_read =     42
//     SELECT COUNT(*) FROM bills WHERE sponsor_bioguide_id IS NOT NULL
//                                         ->   17,463 rows, rows_read = 17,463
//
// So a bare COUNT(*) is NOT a proxy for scan cost — it is a different query with a
// different plan. Every figure this probe uses to PRICE a scan is taken from a
// predicated or aggregate form, never a bare count. M0 re-runs the calibration live
// so the reader can see the trap rather than take it on faith. (This is the HO 527
// comment's error inverted: that one sized a scan by rows RETURNED; this one would
// size it by a count that never scans.)
//
// ── EXECUTION BUDGET (handoff §3 guard 1) ─────────────────────────────────────────
// The handoff bounds "full statement executions" to exactly twice and permits counts
// and EXPLAINs freely. Honored: M5 runs the full `getMembersRanked` statement EXACTLY
// TWICE (volume sort, missed sort). M3's per-component runs are the CTE bodies and
// bounded aggregates — counts, not the full statement. No loops, no variant sweeps.
//
// NOTE ON WHAT A SINGLE SAMPLE PROVES: `rows_read` is DETERMINISTIC (it is a row
// count for a fixed plan over a fixed corpus), so two executions pin it exactly.
// `query_duration_ms` is NOT — this platform's documented 2-15x run-to-run variance
// applies, and these are laptop-to-us-west-2 readings carrying an unquantified
// network component. Read the rows figures as facts and the ms figures as one sample.
//
// Facts copied VERBATIM from lib/queries.ts (NOT imported — no queries.ts touch,
// handoff §3 guard 2). Every ref RE-READ AT HEAD 5e33c26, not trusted from the
// handoff — this file's line numbers have moved twice this month:
//   - billsAggCte(includeCeremonial)      queries.ts:6194-6217
//   - participationAggCte()               queries.ts:6243-6251
//   - MISSED_CARVE_EXPR                   queries.ts:6262-6266
//   - getMembersRanked SQL + args         queries.ts:6283-6315
//   - getCommitteeRoster SQL              queries.ts:6427-6459
//   - searchMembers' LEAN bills_agg copy  queries.ts:7583-7600  (NO INDEXED BY hint)
//   - PARTICIPATION_FLOOR = 50            queries.ts:8154
//   - buildMemberWhere default            queries.ts:6166-6189  -> ["m.is_current = 1"], []
//   - live call shape                     app/members/page.tsx:187 -> (filters, sort, 1, 600)
//     (the handoff said "page 1" and assumed the 50 default; the REAL render passes
//      LIST_LIMIT = 600, so M5 executes what actually runs in production.)
//
//   npx tsx scripts/diagnostic/bills-agg-cost-624.ts
import "dotenv/config";

// ── ledger figures under test (docs/backlog.md, HO 602; SKILL "Platform facts") ──
const LEDGER_ROWS_30D = 110_000_000;
const LEDGER_CALLS_30D = 317;
const LEDGER_PER_CALL = 347_000;
// HO 595's pre-materialization member_votes size, the ghost candidate.
const HO595_MEMBER_VOTES = 365_996;

const PARTICIPATION_FLOOR = 50; // queries.ts:8154, copied verbatim
const LIST_LIMIT = 600; // app/members/page.tsx:66, the live pageSize

type Exec = { rows: unknown[][]; rowsRead: number; ms: number; cols: string[] };

let httpUrl = "";
let token = "";

async function exec(sql: string, args: (string | number)[] = []): Promise<Exec> {
  const res = await fetch(`${httpUrl}/v2/pipeline`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      requests: [
        {
          type: "execute",
          stmt: {
            sql,
            args: args.map((a) =>
              typeof a === "number"
                ? { type: "integer", value: String(a) }
                : { type: "text", value: a },
            ),
          },
        },
        { type: "close" },
      ],
    }),
  });
  const j = (await res.json()) as {
    results?: { type: string; response?: { result?: Record<string, unknown> }; error?: unknown }[];
  };
  const r = j.results?.[0];
  if (!r || r.type !== "ok" || !r.response?.result) {
    throw new Error(`query failed: ${JSON.stringify(r?.error ?? r).slice(0, 400)}\n  sql: ${sql.slice(0, 200)}`);
  }
  const q = r.response.result as {
    rows: { value: unknown }[][];
    cols: { name: string }[];
    rows_read: number;
    query_duration_ms: number;
  };
  return {
    rows: q.rows.map((row) => row.map((c) => c?.value)),
    cols: q.cols.map((c) => c.name),
    rowsRead: Number(q.rows_read ?? 0),
    ms: Number(q.query_duration_ms ?? 0),
  };
}

const n = (v: unknown): number => Number(v ?? 0);
const pad = (v: unknown, w: number) => String(v).padEnd(w);
const padL = (v: unknown, w: number) => String(v).padStart(w);
const comma = (v: number) => v.toLocaleString("en-US");
const RULE = "─".repeat(78);

function head(title: string) {
  console.log(`\n${RULE}\n${title}\n${RULE}`);
}

// ── verbatim copies of the shipped SQL (queries.ts refs in the header) ────────────

// queries.ts:6194-6217
function billsAggCte(includeCeremonial: boolean, congressClause = ""): string {
  const ceremonial = includeCeremonial
    ? ""
    : " AND (is_ceremonial = 0 OR is_ceremonial IS NULL)";
  return `bills_agg AS (
    SELECT
      sponsor_bioguide_id,
      COUNT(*) AS total,
      SUM(CASE WHEN stage = 'enacted' THEN 1 ELSE 0 END) AS enacted,
      CAST(SUM(CASE WHEN stage = 'enacted' THEN 1 ELSE 0 END) AS REAL)
        / COUNT(*) AS passrate
    FROM bills INDEXED BY idx_bills_sponsor_agg
    WHERE sponsor_bioguide_id IS NOT NULL${ceremonial}${congressClause}
    GROUP BY sponsor_bioguide_id
  )`;
}

// queries.ts:6243-6251
function participationAggCte(): string {
  return `part_agg AS (
    SELECT
      bioguide_id AS bid,
      CAST(not_voting AS REAL) / total AS missed_pct
    FROM member_participation
    WHERE total >= ${PARTICIPATION_FLOOR}
  )`;
}

// queries.ts:6262-6266
const MISSED_CARVE_EXPR = `CASE
          WHEN m.chamber = 'house'
           AND m.state IN ('DC','AS','GU','MP','PR','VI') THEN NULL
          ELSE pa.missed_pct
        END`;

// queries.ts:6283-6310, with buildMemberWhere's default clause inlined
// (queries.ts:6170 -> ["m.is_current = 1"], args []).
function membersRankedSql(includeCeremonial: boolean): string {
  return `
      WITH ${billsAggCte(includeCeremonial)},
      ${participationAggCte()}
      SELECT
        m.bioguide_id, m.name, m.party, m.state, m.chamber, m.district,
        COALESCE(b.total,   0) AS total,
        COALESCE(b.enacted, 0) AS enacted,
        b.passrate             AS passrate,
        ps.grade               AS palestine_grade,
        ps.rank                AS palestine_rank,
        ps.total_score         AS palestine_score,
        ${MISSED_CARVE_EXPR}   AS missed_pct
      FROM members m
      LEFT JOIN bills_agg b ON b.sponsor_bioguide_id = m.bioguide_id
      LEFT JOIN palestine_scorecard ps ON ps.bioguide_id = m.bioguide_id
      LEFT JOIN part_agg pa ON pa.bid = m.bioguide_id
      WHERE m.is_current = 1
      ORDER BY
        CASE WHEN ? = 'missed'   THEN ${MISSED_CARVE_EXPR} END DESC,
        CASE WHEN ? = 'passrate' THEN passrate END DESC,
        CASE WHEN ? = 'passrate' THEN total    END DESC,
        CASE WHEN ? = 'volume'   THEN total    END DESC,
        m.name ASC
      LIMIT ? OFFSET ?
    `;
}

// queries.ts:7583-7600 — the standalone LEAN copy inside searchMembers.
// NOTE: no INDEXED BY hint, no `enacted`/`passrate`, ceremonial hardcoded off.
const SEARCH_MEMBERS_SQL = `
      WITH bills_agg AS (
        SELECT sponsor_bioguide_id, COUNT(*) AS total
        FROM bills
        WHERE sponsor_bioguide_id IS NOT NULL
          AND (is_ceremonial = 0 OR is_ceremonial IS NULL)
        GROUP BY sponsor_bioguide_id
      )
      SELECT m.bioguide_id, m.name, m.party, m.state, m.chamber, m.district,
             COALESCE(b.total, 0) AS total
      FROM members m
      LEFT JOIN bills_agg b ON b.sponsor_bioguide_id = m.bioguide_id
      WHERE m.is_current = 1
        AND (LOWER(m.name) LIKE ? OR LOWER(m.state_name) LIKE ?)
      ORDER BY total DESC, m.name ASC
      LIMIT ?
    `;

async function explain(label: string, sql: string, args: (string | number)[] = []) {
  const r = await exec(`EXPLAIN QUERY PLAN ${sql}`, args);
  console.log(`\n  ${label}`);
  const detailIdx = r.cols.indexOf("detail");
  for (const row of r.rows) {
    const detail = String(row[detailIdx >= 0 ? detailIdx : row.length - 1]);
    // \b matters: without it `SCAN bills_agg` (the tiny 546-row CTE result, which is
    // FINE to scan) false-positives as a fat-table scan. `bills_agg` has a word char
    // after `bills`, so \b excludes it and only a bare `SCAN bills` trips.
    const bad = /SCAN bills\b(?!\s+USING)|idx_bills_is_ceremonial|MULTI-INDEX OR/.test(detail);
    const cover = /COVERING INDEX/.test(detail);
    const mark = bad ? " <-- BAD" : cover ? " <-- covering" : "";
    console.log(`      ${detail}${mark}`);
  }
}

async function main(): Promise<number> {
  const raw = process.env.TURSO_DATABASE_URL;
  if (!raw) {
    console.log("TURSO_DATABASE_URL not set — run with the CBT .env (local working tree).");
    return 1;
  }
  httpUrl = raw.replace(/^libsql:/, "https:");
  token = process.env.TURSO_AUTH_TOKEN ?? "";

  console.log("=== HO 624 STEP 0 — bills_agg cost probe (read-only) ===");
  console.log(`    ledger under test: ${comma(LEDGER_ROWS_30D)} rows / ${LEDGER_CALLS_30D} calls = ~${comma(LEDGER_PER_CALL)} per call (26% of 30d budget)`);
  console.log(`    ghost candidate:   member_votes @ HO 595 = ${comma(HO595_MEMBER_VOTES)} rows`);

  // ══ M0 — instrument calibration ═════════════════════════════════════════════
  head("M0 — INSTRUMENT CALIBRATION: is rows_read literal, and where does it lie?");
  console.log("  A bare COUNT(*) is answered from B-tree interior pages and UNDER-REPORTS.");
  console.log("  Every scan priced below therefore uses a predicated/aggregate form.\n");
  console.log(`  ${pad("statement", 52)} ${padL("returned", 10)} ${padL("rows_read", 11)}  verdict`);
  const calib: { sql: string; truth?: number }[] = [
    { sql: "SELECT COUNT(*) AS n FROM member_votes" },
    { sql: "SELECT COUNT(*) AS n FROM member_votes WHERE position IS NOT NULL" },
    { sql: "SELECT COUNT(*) AS n FROM bills" },
    { sql: "SELECT COUNT(*) AS n FROM bills WHERE sponsor_bioguide_id IS NOT NULL" },
    { sql: "SELECT COUNT(*) AS n FROM members WHERE is_current = 1" },
  ];
  for (const c of calib) {
    const r = await exec(c.sql);
    const truth = n(r.rows[0]?.[0]);
    const bare = /COUNT\(\*\) AS n FROM \w+$/.test(c.sql.trim());
    const literal = r.rowsRead >= truth * 0.99;
    console.log(
      `  ${pad(c.sql.replace(/\s+/g, " "), 52)} ${padL(comma(truth), 10)} ${padL(comma(r.rowsRead), 11)}  ${
        literal ? "literal" : `UNDER by ${(truth / Math.max(r.rowsRead, 1)).toFixed(0)}x${bare ? " (bare COUNT)" : ""}`
      }`,
    );
  }

  // ══ M1 — the components, counted ════════════════════════════════════════════
  head("M1 — THE COMPONENTS, COUNTED (the addends of one getMembersRanked call)");

  const billsTotal = n((await exec("SELECT COUNT(*) AS n FROM bills WHERE id IS NOT NULL")).rows[0]?.[0]);
  const sponsored = n((await exec("SELECT COUNT(*) AS n FROM bills WHERE sponsor_bioguide_id IS NOT NULL")).rows[0]?.[0]);
  console.log(`  bills total                                 ${padL(comma(billsTotal), 10)}`);
  console.log(`  bills WHERE sponsor_bioguide_id IS NOT NULL ${padL(comma(sponsored), 10)}   <- bills_agg's scan set (ceremonial-inclusive)`);

  console.log("\n  by congress (is the `congress = 119` clause even a narrowing lever?)");
  const byCongress = await exec(
    `SELECT congress, COUNT(*) AS n FROM bills WHERE sponsor_bioguide_id IS NOT NULL GROUP BY congress ORDER BY congress`,
  );
  for (const r of byCongress.rows) {
    console.log(`      congress ${pad(r[0], 6)} ${padL(comma(n(r[1])), 10)}`);
  }
  const congressCount = byCongress.rows.length;

  console.log("\n  ceremonial split of the sponsored set (the CTE has two variants)");
  const cer = await exec(
    `SELECT CASE WHEN is_ceremonial IS NULL THEN 'NULL' ELSE CAST(is_ceremonial AS TEXT) END AS k,
            COUNT(*) AS n
       FROM bills WHERE sponsor_bioguide_id IS NOT NULL GROUP BY k ORDER BY k`,
  );
  let nonCeremonial = 0;
  for (const r of cer.rows) {
    const k = String(r[0]);
    if (k === "0" || k === "NULL") nonCeremonial += n(r[1]);
    console.log(`      is_ceremonial = ${pad(k, 6)} ${padL(comma(n(r[1])), 10)}`);
  }
  console.log(`      -> default variant (0 OR NULL) scans ${comma(nonCeremonial)}; includeCeremonial=true scans ${comma(sponsored)}`);

  const mpAll = n((await exec("SELECT COUNT(*) AS n FROM member_participation WHERE bioguide_id IS NOT NULL")).rows[0]?.[0]);
  const mpFloored = n((await exec(`SELECT COUNT(*) AS n FROM member_participation WHERE total >= ${PARTICIPATION_FLOOR}`)).rows[0]?.[0]);
  const membersCurrent = n((await exec("SELECT COUNT(*) AS n FROM members WHERE is_current = 1")).rows[0]?.[0]);
  const psRows = n((await exec("SELECT COUNT(*) AS n FROM palestine_scorecard WHERE bioguide_id IS NOT NULL")).rows[0]?.[0]);
  const mvRows = n((await exec("SELECT COUNT(*) AS n FROM member_votes WHERE position IS NOT NULL")).rows[0]?.[0]);
  console.log("");
  console.log(`  member_participation rows                   ${padL(comma(mpAll), 10)}   (floored >= ${PARTICIPATION_FLOOR}: ${comma(mpFloored)})  <- part_agg's scan set`);
  console.log(`  members WHERE is_current = 1                ${padL(comma(membersCurrent), 10)}   <- the driving table`);
  console.log(`  palestine_scorecard rows                    ${padL(comma(psRows), 10)}`);
  console.log(`  member_votes rows (the pre-595 part_agg)    ${padL(comma(mvRows), 10)}   <- NOT read by the current statement`);

  const expected = nonCeremonial + mpFloored + membersCurrent + psRows;
  console.log(`\n  ARITHMETIC EXPECTATION (default variant):`);
  console.log(`      bills_agg ${comma(nonCeremonial)} + part_agg ${comma(mpFloored)} + members ${comma(membersCurrent)} + palestine ${comma(psRows)} = ${comma(expected)}`);

  // ══ M2 — the plans, verified ════════════════════════════════════════════════
  head("M2 — THE PLANS (re-verify the plan, not the HO 277 comment)");
  await explain("billsAggCte(false) standalone", `${"WITH " + billsAggCte(false)} SELECT * FROM bills_agg`);
  await explain("billsAggCte(true) standalone", `${"WITH " + billsAggCte(true)} SELECT * FROM bills_agg`);
  await explain("participationAggCte() standalone", `${"WITH " + participationAggCte()} SELECT * FROM part_agg`);
  await explain("getMembersRanked — VOLUME sort", membersRankedSql(false), [
    "volume", "volume", "volume", "volume", LIST_LIMIT, 0,
  ]);
  await explain("getMembersRanked — MISSED sort", membersRankedSql(false), [
    "missed", "missed", "missed", "missed", LIST_LIMIT, 0,
  ]);
  await explain("searchMembers' LEAN bills_agg copy (queries.ts:7583, NO hint)", SEARCH_MEMBERS_SQL, [
    "%a%", "%a%", 25,
  ]);

  // ══ M3 — per-component rows_read (direct) ═══════════════════════════════════
  head("M3a — PER-COMPONENT rows_read, MEASURED (not derived)");
  console.log(`  ${pad("component", 46)} ${padL("rows_read", 11)} ${padL("ms", 9)} ${padL("returned", 9)}`);

  const cBills = await exec(`WITH ${billsAggCte(false)} SELECT * FROM bills_agg`);
  console.log(`  ${pad("bills_agg CTE (default, ceremonial excluded)", 46)} ${padL(comma(cBills.rowsRead), 11)} ${padL(cBills.ms.toFixed(1), 9)} ${padL(comma(cBills.rows.length), 9)}`);

  const cBillsCer = await exec(`WITH ${billsAggCte(true)} SELECT * FROM bills_agg`);
  console.log(`  ${pad("bills_agg CTE (includeCeremonial = true)", 46)} ${padL(comma(cBillsCer.rowsRead), 11)} ${padL(cBillsCer.ms.toFixed(1), 9)} ${padL(comma(cBillsCer.rows.length), 9)}`);

  const cPart = await exec(`WITH ${participationAggCte()} SELECT * FROM part_agg`);
  console.log(`  ${pad("part_agg CTE (materialized, post-595)", 46)} ${padL(comma(cPart.rowsRead), 11)} ${padL(cPart.ms.toFixed(1), 9)} ${padL(comma(cPart.rows.length), 9)}`);

  const cMembers = await exec("SELECT bioguide_id FROM members WHERE is_current = 1");
  console.log(`  ${pad("members WHERE is_current = 1", 46)} ${padL(comma(cMembers.rowsRead), 11)} ${padL(cMembers.ms.toFixed(1), 9)} ${padL(comma(cMembers.rows.length), 9)}`);

  const cPs = await exec("SELECT bioguide_id FROM palestine_scorecard");
  console.log(`  ${pad("palestine_scorecard", 46)} ${padL(comma(cPs.rowsRead), 11)} ${padL(cPs.ms.toFixed(1), 9)} ${padL(comma(cPs.rows.length), 9)}`);

  const measuredSum = cBills.rowsRead + cPart.rowsRead + cMembers.rowsRead + cPs.rowsRead;
  console.log(`  ${pad("── component sum (default variant)", 46)} ${padL(comma(measuredSum), 11)}`);

  // ══ M5 — the two full executions ════════════════════════════════════════════
  head("M5 — THE FULL STATEMENT, EXECUTED EXACTLY TWICE (the entire query burn)");
  console.log(`  live shape: getMembersRanked({}, sort, page 1, pageSize ${LIST_LIMIT})  [app/members/page.tsx:187]\n`);
  console.log(`  ${pad("execution", 40)} ${padL("rows_read", 11)} ${padL("ms", 10)} ${padL("returned", 9)}`);

  const fullVolume = await exec(membersRankedSql(false), ["volume", "volume", "volume", "volume", LIST_LIMIT, 0]);
  console.log(`  ${pad("getMembersRanked — VOLUME sort", 40)} ${padL(comma(fullVolume.rowsRead), 11)} ${padL(fullVolume.ms.toFixed(1), 10)} ${padL(comma(fullVolume.rows.length), 9)}`);

  const fullMissed = await exec(membersRankedSql(false), ["missed", "missed", "missed", "missed", LIST_LIMIT, 0]);
  console.log(`  ${pad("getMembersRanked — MISSED sort", 40)} ${padL(comma(fullMissed.rowsRead), 11)} ${padL(fullMissed.ms.toFixed(1), 10)} ${padL(comma(fullMissed.rows.length), 9)}`);

  const perCall = Math.max(fullVolume.rowsRead, fullMissed.rowsRead);
  console.log(`\n  NOTE: rows_read is deterministic for a fixed plan + corpus, so these two`);
  console.log(`        readings PIN the per-call cost. query_duration_ms is ONE SAMPLE each,`);
  console.log(`        laptop -> us-west-2, subject to this platform's 2-15x variance.`);
  console.log(`  The HO 277 comment claims "index-only / 96ms". Plan re-verified in M2;`);
  console.log(`  the 96ms was a TIMING claim and rows_read is a different currency entirely.`);

  // ══ M3 — the reconciliation, which is the verdict ═══════════════════════════
  head("M3 — THE RECONCILIATION (the verdict)");
  console.log(`  measured per-call rows_read (full statement) : ${comma(perCall)}`);
  console.log(`  arithmetic expectation from M1 addends       : ${comma(expected)}`);
  console.log(`  measured component sum from M3a              : ${comma(measuredSum)}`);
  console.log(`  ledger's attributed per-call figure          : ${comma(LEDGER_PER_CALL)}`);
  console.log(`  member_votes @ HO 595 (the ghost)            : ${comma(HO595_MEMBER_VOTES)}`);

  const dGhost = Math.abs(LEDGER_PER_CALL - HO595_MEMBER_VOTES);
  const dMeasured = Math.abs(LEDGER_PER_CALL - perCall);
  console.log(`\n  COINCIDENCE TEST (handoff M3, stated explicitly):`);
  console.log(`      |347k - member_votes|  = ${comma(dGhost)}`);
  console.log(`      |347k - measured|      = ${comma(dMeasured)}`);
  console.log(`      -> the ledger figure sits ${dGhost < dMeasured ? "NEARER THE GHOST" : "nearer the measured present-tense cost"}`);

  const ratio = perCall > 0 ? LEDGER_PER_CALL / perCall : Infinity;
  console.log(`\n  ledger / measured = ${ratio.toFixed(1)}x`);
  console.log(`  projected 30d rows at the MEASURED cost, same ${LEDGER_CALLS_30D} calls: ${comma(Math.round(perCall * LEDGER_CALLS_30D))}`);
  console.log(`      (vs the ledger's ${comma(LEDGER_ROWS_30D)} — a ${(LEDGER_ROWS_30D / Math.max(perCall * LEDGER_CALLS_30D, 1)).toFixed(1)}x overstatement if the measurement holds)`);
  console.log(`\n  VERDICT BRANCH (handoff M3):`);
  if (ratio >= 5) {
    console.log(`      Expected << 347k AND 347k ~ the pre-595 member_votes scan`);
    console.log(`      -> reads as GHOST. 625's deliverable becomes a ledger correction +`);
    console.log(`         re-attribution; the optimization target is whatever a POST-595`);
    console.log(`         window actually ranks first.`);
  } else if (ratio <= 1.5) {
    console.log(`      Expected ~ 347k -> the premise HOLDS; the cost is real and present-tense.`);
    console.log(`      625 optimizes; M4 below feeds it.`);
  } else {
    console.log(`      Neither branch cleanly: ${ratio.toFixed(1)}x apart. Report both figures; do not`);
    console.log(`      pick a branch from a middling ratio.`);
  }
  console.log(`\n  (verdict language is the HALT's; the ruling is the owner's — handoff §3 guard 3)`);

  // ══ M4 — the levers, priced but not pulled ══════════════════════════════════
  head("M4 — THE LEVERS, PRICED BUT NOT PULLED");

  console.log("  (a) the `congress = 119` narrowing clause");
  if (congressCount <= 1) {
    console.log(`      The sponsored set spans ${congressCount} congress value(s) — a congress clause`);
    console.log(`      excludes ZERO rows. NOT A LEVER. (The index already carries congress 4th.)`);
  } else {
    const cur = await exec(
      `WITH ${billsAggCte(false, " AND congress = 119")} SELECT * FROM bills_agg`,
    );
    console.log(`      narrowed CTE rows_read = ${comma(cur.rowsRead)} vs ${comma(cBills.rowsRead)} unnarrowed`);
    console.log(`      -> excludes ${comma(cBills.rowsRead - cur.rowsRead)} rows`);
  }

  console.log("\n  (b) materialization sketch — write-side size of a `member_sponsorship` table");
  const distinctSponsors = await exec(
    `SELECT COUNT(*) AS n FROM (SELECT DISTINCT sponsor_bioguide_id FROM bills WHERE sponsor_bioguide_id IS NOT NULL)`,
  );
  const ds = n(distinctSponsors.rows[0]?.[0]);
  console.log(`      distinct sponsors = ${comma(ds)}; x 2 ceremonial variants = ${comma(ds * 2)} rows`);
  console.log(`      (the HO 594/595 shape: refreshed by the daily sync, read as a JOINable relation)`);
  console.log(`      For scale: member_participation is ${comma(mpAll)} rows and reads in ${cPart.ms.toFixed(1)}ms.`);

  console.log("\n  (c) CACHE-VARIANT SURFACE — 317 calls/30d is ~10/day; variants are what multiply it");
  console.log(`      THREE DISTINCT STATEMENT TEXTS contain a \`bills_agg\` CTE. The per-query`);
  console.log(`      ledger groups by statement text, so these are SEPARATE ledger lines and the`);
  console.log(`      110M attribution belongs to whichever text the dashboard was showing:`);
  console.log(`        1. getMembersRanked   (queries.ts:6283) — hinted, + part_agg + palestine`);
  console.log(`        2. getCommitteeRoster (queries.ts:6427) — hinted, + part_agg, per committee`);
  console.log(`        3. searchMembers      (queries.ts:7583) — LEAN copy, *** NO INDEXED BY ***`);
  console.log(`      NOTE (3): the lean copy carries no hint, so on a statless planner it is the`);
  console.log(`      one most likely to mis-plan. Its EXPLAIN is in M2 — read it before assuming`);
  console.log(`      the ledger line is getMembersRanked's.`);

  // (d) price the lean copy's mis-plan. DISCLOSED DEVIATION: the handoff bounded
  // "full statement executions" to the two M5 runs. This is a THIRD full-statement
  // execution, of a DIFFERENT statement, added because M2 caught the lean copy
  // planning onto idx_bills_is_ceremonial — the exact HO 277/329 misplan class the
  // hints exist to prevent, sitting live on a request path. The burn is one ~17-35k
  // row read (vs member_votes' 366k), so it does not make the probe a burn event.
  console.log("\n  (d) PRICING THE LEAN COPY'S MIS-PLAN (disclosed extra execution — see comment)");
  const lean = await exec(SEARCH_MEMBERS_SQL, ["%smith%", "%smith%", 25]);
  console.log(`      searchMembers("smith") rows_read = ${comma(lean.rowsRead)}  ms = ${lean.ms.toFixed(1)}  returned = ${lean.rows.length}`);
  console.log(`      vs the HINTED bills_agg CTE's ${comma(cBills.rowsRead)} — ${(lean.rowsRead / Math.max(cBills.rowsRead, 1)).toFixed(2)}x`);
  console.log(`      A MULTI-INDEX OR that is USING INDEX (not COVERING) also row-fetches, so the`);
  console.log(`      gap over the hinted plan is the cost of the missing hint. Still ~an order of`);
  console.log(`      magnitude under 347k — it does NOT rescue the ledger attribution either.`);
  const committees = n(
    (await exec("SELECT COUNT(*) AS n FROM committees WHERE is_current = 1")).rows[0]?.[0],
  );
  console.log(`\n      getMembersRanked cache key = (filters{chamber,party,state,q,ceremonial} x sort x page x pageSize)`);
  console.log(`        chamber 3 (all/house/senate) x party 4 x sort 3 x ceremonial 2 = 72 before state/q/page`);
  console.log(`        x state (${n((await exec("SELECT COUNT(DISTINCT state) AS n FROM members WHERE is_current = 1")).rows[0]?.[0])} values) -> the surface is combinatorial, and EVERY miss pays the full scan`);
  console.log(`      getCommitteeRoster cache key = (systemCode x sort x ceremonial) = ${comma(committees)} x 3 x 2 = ${comma(committees * 6)}`);
  console.log(`      searchMembers cache key = per query string, 600s TTL — unbounded by construction`);

  // ══ summary ════════════════════════════════════════════════════════════════
  head("SUMMARY");
  console.log(`  M0  rows_read is literal for predicated scans; bare COUNT(*) under-reports (trap encoded)`);
  console.log(`  M1  bills_agg scan set ${comma(nonCeremonial)} (default) / ${comma(sponsored)} (ceremonial) · congress values: ${congressCount}`);
  console.log(`  M3a component sum ${comma(measuredSum)} = bills_agg ${comma(cBills.rowsRead)} + part_agg ${comma(cPart.rowsRead)} + members ${comma(cMembers.rowsRead)} + palestine ${comma(cPs.rowsRead)}`);
  console.log(`  M5  full statement per call: ${comma(fullVolume.rowsRead)} rows (volume) / ${comma(fullMissed.rowsRead)} rows (missed)`);
  console.log(`  M3  ledger ${comma(LEDGER_PER_CALL)} vs measured ${comma(perCall)} -> ${ratio.toFixed(1)}x · |347k-ghost|=${comma(dGhost)} vs |347k-measured|=${comma(dMeasured)}`);
  console.log(`  M4  congress lever: ${congressCount <= 1 ? "NONE (single congress)" : "see above"} · materialization ~${comma(ds * 2)} rows · 3 distinct bills_agg statement texts`);
  console.log(`\n  (the four HALT lines + the ruling are written in chat from these numbers)`);
  return 0;
}

main().then((c) => process.exit(c)).catch((e) => {
  console.error(e);
  process.exit(1);
});
