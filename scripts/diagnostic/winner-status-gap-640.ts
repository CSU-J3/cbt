// HO 640 — READ-ONLY. Characterize the 11 completed primaries that carry
// recorded shares but no `status='winner'` row, and measure the WA
// non-measurement HO 639 filed as unmeasured.
//
// BUILDS NOTHING. No INSERT/UPDATE/DELETE, no seed calls, no writes of any
// kind. Every statement below is a SELECT or a PRAGMA.
//
// Why: `backfill:race-challengers` derives general-election challengers via
//   JOIN primary_candidates pc ON ... AND pc.status = 'winner'
// so a contest that has voted and recorded `vote_pct` but names no winner is
// INVISIBLE to it. That was the third independent bar on the S-ME defect
// (HO 638): ME carries no winner row at all, so the harvest is inert there
// regardless of the sentinel guard.
//
// HO 639 filed the 11 as a backlog QUEUED line splitting them into
// top-two/jungle (8, model error) and ranked-choice (ME, ingestion gap) —
// 8 + 1 = 9, with 2 explicitly left uncharacterized. This re-derives the
// split from the data rather than inheriting it.
//
// INSTRUMENT NOTE (HO 624 M0): @libsql/client does not surface per-statement
// `rows_read`, so this talks the /v2/pipeline HTTP protocol directly to read
// it. `rows_read` is LITERAL for predicated scans but a BARE `COUNT(*)` is
// answered from B-tree interior pages and under-reports by 227–416x — so no
// cost figure below is quoted off a bare COUNT(*); every count carries a
// predicate.
//
//   npx tsx scripts/diagnostic/winner-status-gap-640.ts
import "dotenv/config";

// ── HO 638 ride-along A figures under test ────────────────────────────────
const HO638_COMPLETED = 718;
const HO638_WITH_WINNER = 506;
const HO638_NO_WINNER = 212;
const HO638_SCORED = 11; // no winner, >=1 non-null vote_pct
const HO638_UNSCORED = 123; // no winner, roster present, all vote_pct NULL
const HO638_NO_ROSTER = 78; // no winner, no roster at all

type Exec = { rows: unknown[][]; cols: string[]; rowsRead: number; ms: number };

let httpUrl = "";
let token = "";
let totalRowsRead = 0;
let stmtCount = 0;

async function exec(sql: string, args: (string | number)[] = []): Promise<Exec> {
  const res = await fetch(`${httpUrl}/v2/pipeline`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
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
    results?: {
      type: string;
      response?: { result?: Record<string, unknown> };
      error?: unknown;
    }[];
  };
  const r = j.results?.[0];
  if (!r || r.type !== "ok" || !r.response?.result) {
    throw new Error(
      `query failed: ${JSON.stringify(r?.error ?? r).slice(0, 400)}\n  sql: ${sql.slice(0, 220)}`,
    );
  }
  const q = r.response.result as {
    rows: { value: unknown }[][];
    cols: { name: string }[];
    rows_read: number;
    query_duration_ms: number;
  };
  totalRowsRead += Number(q.rows_read ?? 0);
  stmtCount++;
  return {
    rows: q.rows.map((row) => row.map((c) => c?.value)),
    cols: q.cols.map((c) => c.name),
    rowsRead: Number(q.rows_read ?? 0),
    ms: Number(q.query_duration_ms ?? 0),
  };
}

const s = (v: unknown): string => (v === null || v === undefined ? "—" : String(v));
const n = (v: unknown): number => Number(v ?? 0);
const pad = (v: unknown, w: number) => s(v).padEnd(w);
const padL = (v: unknown, w: number) => s(v).padStart(w);
const RULE = "─".repeat(100);

function head(title: string) {
  console.log(`\n${RULE}\n${title}\n${RULE}`);
}

/** Column-aligned table print. Nothing clever; the handoff asked for a table. */
function table(cols: string[], rows: unknown[][], widths?: number[]) {
  const w =
    widths ??
    cols.map((c, i) =>
      Math.max(c.length, ...rows.map((r) => s(r[i]).length)),
    );
  const width = (i: number) => w[i] ?? 8;
  console.log("  " + cols.map((c, i) => pad(c, width(i))).join("  "));
  console.log("  " + w.map((x) => "─".repeat(x)).join("  "));
  for (const r of rows) {
    console.log("  " + r.map((v, i) => pad(v, width(i))).join("  "));
  }
}

async function main(): Promise<number> {
  const raw = process.env.TURSO_DATABASE_URL;
  if (!raw) {
    console.log(
      "TURSO_DATABASE_URL not set — run with the CBT .env (local working tree).",
    );
    return 1;
  }
  httpUrl = raw.replace(/^libsql:/, "https:");
  token = process.env.TURSO_AUTH_TOKEN ?? "";

  // ══ PHASE 0 — schema, read not assumed ═══════════════════════════════════
  head("PHASE 0 — SCHEMA (read, not assumed)");
  const pCols = (await exec("PRAGMA table_info(primaries)")).rows.map((r) =>
    String(r[1]),
  );
  const cCols = (await exec("PRAGMA table_info(primary_candidates)")).rows.map(
    (r) => String(r[1]),
  );
  console.log(`  primaries          : ${pCols.join(", ")}`);
  console.log(`  primary_candidates : ${cCols.join(", ")}`);
  const hasRound = pCols.includes("election_round");
  const hasType = pCols.includes("primary_type");
  const hasRunoff = pCols.includes("runoff_date");
  const hasRaceId = pCols.includes("race_id");
  const hasPUpdated = pCols.includes("updated_at");
  const hasCUpdated = cCols.includes("updated_at");
  console.log(
    `  present: election_round=${hasRound} primary_type=${hasType} runoff_date=${hasRunoff} race_id=${hasRaceId} p.updated_at=${hasPUpdated} pc.updated_at=${hasCUpdated}`,
  );

  const today = new Date().toISOString().slice(0, 10);
  const roundClause = hasRound ? "AND p.election_round = 'primary'" : "";
  console.log(`\n  today (script clock) = ${today}`);
  console.log(
    `  HO 638 "completed" predicate, copied verbatim from primary-winner-gap-638.ts:`,
  );
  console.log(
    `    p.primary_date IS NOT NULL AND p.primary_date < '${today}' ${roundClause}`,
  );

  // The partition, parameterised by as-of date so drift is diagnosable rather
  // than just detectable.
  const partitionSql = (round: string) => `
    WITH agg AS (
      SELECT p.id,
             COUNT(pc.id)                                             AS cands,
             SUM(CASE WHEN pc.status='winner' THEN 1 ELSE 0 END)       AS winners,
             SUM(CASE WHEN pc.vote_pct IS NOT NULL THEN 1 ELSE 0 END)  AS scored
      FROM primaries p
      LEFT JOIN primary_candidates pc ON pc.primary_id = p.id
      WHERE p.primary_date IS NOT NULL AND p.primary_date < ? ${round}
      GROUP BY p.id
    )
    SELECT
      SUM(CASE WHEN id IS NOT NULL THEN 1 ELSE 0 END)                        AS completed,
      SUM(CASE WHEN winners > 0 THEN 1 ELSE 0 END)                           AS with_winner,
      SUM(CASE WHEN winners = 0 THEN 1 ELSE 0 END)                           AS no_winner,
      SUM(CASE WHEN winners = 0 AND scored > 0 THEN 1 ELSE 0 END)            AS scored_no_winner,
      SUM(CASE WHEN winners = 0 AND scored = 0 AND cands > 0 THEN 1 ELSE 0 END) AS unscored_no_winner,
      SUM(CASE WHEN winners = 0 AND cands = 0 THEN 1 ELSE 0 END)             AS no_roster
    FROM agg`;

  // ══ PHASE 1 — reproduce 718 / 506 / 212 -> 11 / 123 / 78 ═════════════════
  head("PHASE 1 — REPRODUCE THE PARTITION (start from the whole, not the 11)");

  const live = await exec(partitionSql(roundClause), [today]);
  const liveRow = (live.rows[0] ?? []).map(n);
  const at = (i: number) => liveRow[i] ?? 0;
  const completed = at(0);
  const withWinner = at(1);
  const noWinner = at(2);
  const scoredNoWinner = at(3);
  const unscoredNoWinner = at(4);
  const noRoster = at(5);

  table(
    ["figure", "HO 638", "measured", "delta"],
    [
      ["completed", HO638_COMPLETED, completed, completed - HO638_COMPLETED],
      ["with winner", HO638_WITH_WINNER, withWinner, withWinner - HO638_WITH_WINNER],
      ["no winner", HO638_NO_WINNER, noWinner, noWinner - HO638_NO_WINNER],
      ["  (a) scored, no winner", HO638_SCORED, scoredNoWinner, scoredNoWinner - HO638_SCORED],
      ["  (b) roster, no shares", HO638_UNSCORED, unscoredNoWinner, unscoredNoWinner - HO638_UNSCORED],
      ["  (c) no roster at all", HO638_NO_ROSTER, noRoster, noRoster - HO638_NO_ROSTER],
    ],
  );

  const reproduced =
    completed === HO638_COMPLETED &&
    withWinner === HO638_WITH_WINNER &&
    noWinner === HO638_NO_WINNER &&
    scoredNoWinner === HO638_SCORED &&
    unscoredNoWinner === HO638_UNSCORED &&
    noRoster === HO638_NO_ROSTER;

  console.log(
    `\n  PARTITION ${reproduced ? "REPRODUCES" : "DOES NOT REPRODUCE"} at as-of ${today}.`,
  );

  // As-of sweep — if the denominator drifted, this names the date HO 638 ran
  // at rather than leaving "the predicate changed" as a guess. A contest's
  // completeness is a function of the clock, and HO 638 ran on a different day.
  if (!reproduced) {
    console.log(
      "\n  AS-OF SWEEP — completeness is clock-dependent; which as-of date yields 718?",
    );
    const sweepRows: unknown[][] = [];
    for (let back = 0; back <= 10; back++) {
      const d = new Date(Date.now() - back * 86_400_000)
        .toISOString()
        .slice(0, 10);
      const r = await exec(partitionSql(roundClause), [d]);
      const v = (r.rows[0] ?? []).map(n);
      sweepRows.push([
        d,
        back === 0 ? "(today)" : `-${back}d`,
        v[0],
        v[1],
        v[2],
        v[3],
        v[4],
        v[5],
        v[0] === HO638_COMPLETED ? "<== 718" : "",
      ]);
    }
    table(
      ["as-of", "", "completed", "winner", "no-win", "scored", "unscored", "no-roster", ""],
      sweepRows,
    );

    // Sensitivity: is the round filter or the strict inequality the lever?
    console.log("\n  PREDICATE SENSITIVITY at as-of " + today + ":");
    const variants: [string, string, string][] = [
      ["primary_date <  today, round='primary'", "<", roundClause],
      ["primary_date <= today, round='primary'", "<=", roundClause],
      ["primary_date <  today, ALL rounds", "<", ""],
      ["primary_date <= today, ALL rounds", "<=", ""],
    ];
    const vRows: unknown[][] = [];
    for (const [label, op, rc] of variants) {
      const r = await exec(partitionSql(rc).replace("p.primary_date < ?", `p.primary_date ${op} ?`), [today]);
      const v = (r.rows[0] ?? []).map(n);
      vRows.push([label, v[0], v[1], v[2], v[3], v[4], v[5]]);
    }
    table(
      ["variant", "completed", "winner", "no-win", "scored", "unscored", "no-roster"],
      vRows,
    );
  }

  // ══ PHASE 2 — characterize EVERY scored-no-winner contest ════════════════
  head(
    `PHASE 2 — ALL ${scoredNoWinner} SCORED-NO-WINNER CONTESTS (split re-derived from data, not inherited)`,
  );
  if (!reproduced) {
    console.log(
      "  !! PARTITION DID NOT REPRODUCE — the rows below are printed for diagnosis only.\n" +
        "  !! Do not treat the split as a re-derivation of HO 638's until the delta is ruled on.\n",
    );
  }

  const detail = await exec(
    `
    WITH agg AS (
      SELECT p.id, p.state, p.chamber, p.district, p.party AS contest_party,
             ${hasType ? "p.primary_type" : "NULL"}       AS primary_type,
             ${hasRound ? "p.election_round" : "NULL"}    AS election_round,
             p.primary_date,
             ${hasRunoff ? "p.runoff_date" : "NULL"}      AS runoff_date,
             ${hasRaceId ? "p.race_id" : "NULL"}          AS race_id,
             ${hasPUpdated ? "p.updated_at" : "NULL"}     AS p_updated,
             COUNT(pc.id)                                            AS cands,
             SUM(CASE WHEN pc.status='winner' THEN 1 ELSE 0 END)      AS winners,
             SUM(CASE WHEN pc.vote_pct IS NOT NULL THEN 1 ELSE 0 END) AS scored,
             SUM(CASE WHEN pc.status='running' THEN 1 ELSE 0 END)     AS running,
             COUNT(DISTINCT pc.status)                               AS distinct_status,
             MAX(pc.vote_pct)                                        AS top_pct
             ${hasCUpdated ? ", MAX(pc.updated_at) AS c_updated" : ", NULL AS c_updated"}
      FROM primaries p
      LEFT JOIN primary_candidates pc ON pc.primary_id = p.id
      WHERE p.primary_date IS NOT NULL AND p.primary_date < ? ${roundClause}
      GROUP BY p.id
    )
    SELECT a.*,
           (SELECT pc2.name FROM primary_candidates pc2
             WHERE pc2.primary_id = a.id AND pc2.vote_pct IS NOT NULL
             ORDER BY pc2.vote_pct DESC LIMIT 1)                     AS top_name,
           (SELECT pc3.party FROM primary_candidates pc3
             WHERE pc3.primary_id = a.id AND pc3.vote_pct IS NOT NULL
             ORDER BY pc3.vote_pct DESC LIMIT 1)                     AS top_party,
           (SELECT COUNT(*) FROM races r  WHERE r.id  = a.race_id)   AS race_row,
           (SELECT COUNT(*) FROM race_ratings rr WHERE rr.race_id = a.race_id) AS rating_rows
    FROM agg a
    WHERE a.winners = 0 AND a.scored > 0
    ORDER BY a.state, a.chamber, a.district, a.id`,
    [today],
  );

  const col = (name: string) => detail.cols.indexOf(name);
  const rows = detail.rows;

  console.log("  IDENTITY / TYPE\n");
  table(
    ["id", "st", "chamber", "dist", "c.party", "primary_type", "round", "date", "runoff_date"],
    rows.map((r) => [
      r[col("id")],
      r[col("state")],
      r[col("chamber")],
      r[col("district")],
      r[col("contest_party")],
      r[col("primary_type")],
      r[col("election_round")],
      r[col("primary_date")],
      r[col("runoff_date")],
    ]),
  );

  console.log("\n  ROSTER / RESULT SHAPE\n");
  table(
    ["id", "cands", "scored", "running", "#status", "top_pct", "top candidate", "pty"],
    rows.map((r) => [
      r[col("id")],
      r[col("cands")],
      r[col("scored")],
      r[col("running")],
      r[col("distinct_status")],
      r[col("top_pct")] === null ? "—" : Number(r[col("top_pct")]).toFixed(1),
      r[col("top_name")],
      r[col("top_party")],
    ]),
  );

  console.log("\n  HARVEST REACH / RECENCY  (the harvest only reaches RATED seats)\n");
  table(
    ["id", "race_id", "race row", "rating rows", "reachable", "p.updated_at", "max pc.updated_at"],
    rows.map((r) => [
      r[col("id")],
      r[col("race_id")],
      r[col("race_row")],
      r[col("rating_rows")],
      n(r[col("rating_rows")]) > 0 ? "YES" : "no",
      r[col("p_updated")],
      r[col("c_updated")],
    ]),
  );

  // Mechanical grouping — printed so the split is derived, not asserted.
  console.log("\n  MECHANICAL GROUPING (by contest-level party + primary_type)\n");
  const groups = new Map<string, string[]>();
  for (const r of rows) {
    const k = `party=${s(r[col("contest_party")])}  type=${s(r[col("primary_type")])}  round=${s(r[col("election_round")])}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(s(r[col("id")]));
  }
  table(
    ["group", "n", "ids"],
    [...groups.entries()].map(([k, ids]) => [k, ids.length, ids.join(" ")]),
  );

  // ══ PHASE 3 — the WA non-measurement ═════════════════════════════════════
  head("PHASE 3 — THE WA NON-MEASUREMENT: un-swept, structurally missing, or no writer?");

  console.log(
    "  WRITERS OF status='winner' (grepped at HEAD, listed so the verdict names a real path):\n" +
      "    lib/primaries-sync.ts:685,948,1380   c.isWinner ? 'winner' : 'running'   (the cron path)\n" +
      "    scripts/backfill-primary-results.ts:92                                    (HO 206 shares backfill)\n" +
      "    scripts/reingest-primary-slate.ts:110                                     (HO 506 re-ingest)\n" +
      "  SOURCE OF isWinner: lib/primary-candidates-scrape.ts:212\n" +
      "    /class=\"results_row[^\"]*\\bwinner\\b/  — Ballotpedia's votebox winner CSS class.\n" +
      "    So a winner is recorded IFF Ballotpedia marks one on that votebox.\n",
  );

  // Every completed contest sharing WA's election date — did the sweep reach
  // that date at all? If sibling contests on the same date DO carry winners,
  // the writer ran and produced nothing here.
  const byDate = await exec(
    `
    WITH agg AS (
      SELECT p.id, p.state, p.primary_date,
             COUNT(pc.id)                                            AS cands,
             SUM(CASE WHEN pc.status='winner' THEN 1 ELSE 0 END)      AS winners,
             SUM(CASE WHEN pc.vote_pct IS NOT NULL THEN 1 ELSE 0 END) AS scored
             ${hasCUpdated ? ", MAX(pc.updated_at) AS c_updated" : ", NULL AS c_updated"}
      FROM primaries p
      LEFT JOIN primary_candidates pc ON pc.primary_id = p.id
      WHERE p.primary_date IS NOT NULL AND p.primary_date < ? ${roundClause}
      GROUP BY p.id
    )
    SELECT primary_date,
           SUM(CASE WHEN id IS NOT NULL THEN 1 ELSE 0 END) AS contests,
           SUM(CASE WHEN winners > 0 THEN 1 ELSE 0 END)    AS with_winner,
           SUM(CASE WHEN scored  > 0 THEN 1 ELSE 0 END)    AS with_shares,
           MAX(c_updated)                                  AS latest_touch
    FROM agg
    WHERE primary_date >= ?
    GROUP BY primary_date
    ORDER BY primary_date DESC`,
    [today, "2026-07-01"],
  );
  console.log("  CONTESTS BY DATE since 2026-07-01 — did the writer reach this date at all?\n");
  table(
    ["primary_date", "contests", "with winner", "with shares", "latest pc.updated_at"],
    byDate.rows,
  );

  // WA specifically, every completed WA contest.
  const wa = await exec(
    `
    SELECT p.id, p.primary_date,
           ${hasType ? "p.primary_type" : "NULL"} AS primary_type,
           p.party AS contest_party,
           COUNT(pc.id)                                            AS cands,
           SUM(CASE WHEN pc.status='winner' THEN 1 ELSE 0 END)      AS winners,
           SUM(CASE WHEN pc.vote_pct IS NOT NULL THEN 1 ELSE 0 END) AS scored,
           ${hasPUpdated ? "p.updated_at" : "NULL"}                 AS p_updated
           ${hasCUpdated ? ", MAX(pc.updated_at) AS c_updated" : ", NULL AS c_updated"}
    FROM primaries p
    LEFT JOIN primary_candidates pc ON pc.primary_id = p.id
    WHERE p.state = 'WA' AND p.primary_date IS NOT NULL AND p.primary_date < ? ${roundClause}
    GROUP BY p.id
    ORDER BY p.id`,
    [today],
  );
  console.log("\n  EVERY COMPLETED WA CONTEST\n");
  table(
    ["id", "date", "type", "c.party", "cands", "winners", "scored", "p.updated_at", "max pc.updated_at"],
    wa.rows,
  );

  const waTotal = wa.rows.length;
  const waWithWinner = wa.rows.filter((r) => n(r[5]) > 0).length;
  const waTouchedAfter = wa.rows.filter((r) => {
    const t = s(r[8]);
    const d = s(r[1]);
    return t !== "—" && t.slice(0, 10) >= d;
  }).length;
  console.log(
    `\n  WA completed contests: ${waTotal} · carrying >=1 winner row: ${waWithWinner} · pc.updated_at at/after their own primary_date: ${waTouchedAfter}`,
  );

  // ME, the ranked-choice case, for contrast.
  const me = await exec(
    `SELECT pc.status, COUNT(*) AS n, ROUND(MAX(pc.vote_pct),1) AS top_pct, MAX(pc.updated_at) AS touched
     FROM primary_candidates pc
     WHERE pc.primary_id LIKE ?
     GROUP BY pc.status`,
    ["%-ME-2026%"],
  );
  console.log("\n  ME (ranked-choice) primary_candidates status tally, for contrast\n");
  table(["status", "n", "max vote_pct", "max updated_at"], me.rows);

  // ══ PHASE 4 — the two things the first pass got wrong or missed ══════════
  head("PHASE 4a — DOES top-two ACTUALLY BREAK THE MODEL? (falsify HO 639's class claim)");
  console.log(
    "  HO 639's backlog line asserts top-two/jungle contests are a CATEGORY ERROR —\n" +
      "  'two advance by design, so a single status=winner row is a category error.'\n" +
      "  That is falsifiable: if any `-open` contest carries winner rows, the model handles it.\n" +
      "  (HO 207 already says two ★s is valid and expected. This checks the DATA agrees.)\n",
  );
  const openWithWinners = await exec(
    `
    SELECT p.state,
           SUM(CASE WHEN p.id IS NOT NULL THEN 1 ELSE 0 END)   AS open_contests,
           SUM(CASE WHEN w.winners > 0 THEN 1 ELSE 0 END)      AS with_winner,
           SUM(CASE WHEN w.winners = 1 THEN 1 ELSE 0 END)      AS exactly_1,
           SUM(CASE WHEN w.winners = 2 THEN 1 ELSE 0 END)      AS exactly_2,
           SUM(CASE WHEN w.winners > 2 THEN 1 ELSE 0 END)      AS three_plus
    FROM primaries p
    JOIN (SELECT pc.primary_id,
                 SUM(CASE WHEN pc.status='winner' THEN 1 ELSE 0 END) AS winners
          FROM primary_candidates pc GROUP BY pc.primary_id) w ON w.primary_id = p.id
    WHERE p.party = 'open' AND p.primary_date IS NOT NULL AND p.primary_date < ? ${roundClause}
    GROUP BY p.state
    ORDER BY p.state`,
    [today],
  );
  console.log("  COMPLETED contest-party='open' (top-two/jungle) contests, by state\n");
  table(
    ["state", "open contests", "with winner", "winners=1", "winners=2", "winners>2"],
    openWithWinners.rows,
  );

  head("PHASE 4b — THE SETTLED FREEZE: can any of the 11 EVER receive a winner?");
  console.log(
    "  lib/primaries-sync.ts::isSettled (HO 560 C2, lines 551-565), predicate verbatim:\n" +
      "    p.primary_date < today AND EXISTS (a primary_candidates row with vote_pct NOT NULL)\n" +
      "  Called at THREE write paths before the incoming roster is built:\n" +
      "    :646  scrapeSenateSpecialState   :905  syncSenateCandidates   :1311 syncHouseDistricts\n" +
      "  status and vote_pct are written in the SAME INSERT (:685/:948/:1380), so a contest\n" +
      "  that got shares without a winner-marked votebox is settled the instant it is scored.\n",
  );
  const frozen = await exec(
    `
    WITH agg AS (
      SELECT p.id, p.primary_date,
             COUNT(pc.id)                                            AS cands,
             SUM(CASE WHEN pc.status='winner' THEN 1 ELSE 0 END)      AS winners,
             SUM(CASE WHEN pc.vote_pct IS NOT NULL THEN 1 ELSE 0 END) AS scored
      FROM primaries p
      LEFT JOIN primary_candidates pc ON pc.primary_id = p.id
      WHERE p.primary_date IS NOT NULL AND p.primary_date < ? ${roundClause}
      GROUP BY p.id
    )
    SELECT
      SUM(CASE WHEN id IS NOT NULL THEN 1 ELSE 0 END)                       AS completed,
      SUM(CASE WHEN scored > 0 THEN 1 ELSE 0 END)                           AS settled_frozen,
      SUM(CASE WHEN scored = 0 THEN 1 ELSE 0 END)                           AS still_reachable,
      SUM(CASE WHEN scored > 0 AND winners = 0 THEN 1 ELSE 0 END)           AS frozen_without_winner,
      SUM(CASE WHEN scored = 0 AND winners = 0 AND cands > 0 THEN 1 ELSE 0 END) AS reachable_no_shares
    FROM agg`,
    [today],
  );
  table(frozen.cols, frozen.rows);
  console.log(
    "\n  settled_frozen = rows isSettled refuses on EVERY tick from now on.\n" +
      "  frozen_without_winner = the 11: shares recorded, no winner, and permanently refused.",
  );

  head("PHASE 4c — HARVEST REACHABILITY, measured on the REAL join");
  console.log(
    "  CORRECTION to this probe's own first pass: it read `primaries.race_id` and reported\n" +
      "  all 11 unreachable. That column is a DEAD link (SKILL: 3/907) and is NOT what the\n" +
      "  harvest joins on. backfill-race-challengers.ts:34-40 joins state + chamber +\n" +
      "  CAST(district AS INTEGER), gated on EXISTS(race_ratings for the cycle).\n",
  );
  const reach = await exec(
    `
    WITH agg AS (
      SELECT p.id, p.state, p.chamber, p.district,
             SUM(CASE WHEN pc.status='winner' THEN 1 ELSE 0 END)      AS winners,
             SUM(CASE WHEN pc.vote_pct IS NOT NULL THEN 1 ELSE 0 END) AS scored
      FROM primaries p
      LEFT JOIN primary_candidates pc ON pc.primary_id = p.id
      WHERE p.primary_date IS NOT NULL AND p.primary_date < ? ${roundClause}
      GROUP BY p.id
    )
    SELECT a.id,
           (SELECT COUNT(*) FROM races r
             WHERE r.state = a.state AND r.chamber = a.chamber
               AND (r.chamber = 'senate' OR CAST(a.district AS INTEGER) = r.district)
               AND r.cycle = 2026)                                    AS matching_races,
           (SELECT COUNT(*) FROM races r
             WHERE r.state = a.state AND r.chamber = a.chamber
               AND (r.chamber = 'senate' OR CAST(a.district AS INTEGER) = r.district)
               AND r.cycle = 2026
               AND EXISTS (SELECT 1 FROM race_ratings rr
                            WHERE rr.race_id = r.id AND rr.cycle = 2026)) AS rated_races
    FROM agg a
    WHERE a.winners = 0 AND a.scored > 0
    ORDER BY a.id`,
    [today],
  );
  table(
    ["id", "matching races", "RATED races (harvest gate)"],
    reach.rows.map((r) => [r[0], r[1], `${s(r[2])}  ${n(r[2]) > 0 ? "<= would harvest if a winner existed" : "(unrated — harvest never reaches it anyway)"}`]),
  );

  // ══ COST ════════════════════════════════════════════════════════════════
  head("COST (HO 624 ledger discipline — no figure quoted off a bare COUNT(*))");
  const sizes = await exec(
    `SELECT
       (SELECT COUNT(*) FROM primaries WHERE id IS NOT NULL)           AS primaries_rows,
       (SELECT COUNT(*) FROM primary_candidates WHERE id IS NOT NULL)  AS candidate_rows`,
  );
  table(sizes.cols, sizes.rows);
  console.log(
    `\n  probe total: ${stmtCount} statements, ${totalRowsRead.toLocaleString("en-US")} rows_read`,
  );
  console.log(
    `  (both table counts use a predicated COUNT(*) — WHERE id IS NOT NULL — so rows_read is literal)`,
  );

  head("SUMMARY");
  console.log(`  Phase 1 partition: ${reproduced ? "REPRODUCES" : "DOES NOT REPRODUCE"} against HO 638`);
  console.log(`    measured  ${completed} / ${withWinner} / ${noWinner}  ->  ${scoredNoWinner} / ${unscoredNoWinner} / ${noRoster}`);
  console.log(`    HO 638    ${HO638_COMPLETED} / ${HO638_WITH_WINNER} / ${HO638_NO_WINNER}  ->  ${HO638_SCORED} / ${HO638_UNSCORED} / ${HO638_NO_ROSTER}`);
  console.log(`  Phase 2: ${rows.length} scored-no-winner contests printed, grouped into ${groups.size} mechanical shape(s)`);
  console.log(`  Phase 3: WA ${waTotal} completed, ${waWithWinner} with a winner row, ${waTouchedAfter} touched at/after their own date`);
  console.log(`\n  (the class ruling and the three-way WA verdict are written in chat from these numbers)`);
  return 0;
}

main().then(
  (c) => process.exit(c),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
