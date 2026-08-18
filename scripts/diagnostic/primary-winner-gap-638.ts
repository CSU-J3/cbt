// HO 638 ride-along A — READ-ONLY census of completed primaries carrying no
// `status='winner'` candidate row. Fixes nothing.
//
// Why: backfill:race-challengers harvests general-election challengers via
//   JOIN primary_candidates pc ON ... AND pc.status = 'winner'
// so a completed contest with results but no winner row is INVISIBLE to it.
// ME is one such contest (Platner 72.1%, status still 'running'). This
// separates "ME is a one-off" from "the harvest has been silently
// under-harvesting on a class".
//
//   npx tsx scripts/diagnostic/primary-winner-gap-638.ts
import "dotenv/config";
import { getDb } from "../../lib/db";

async function main() {
  const db = getDb();

  // Don't assume columns — read them.
  const cols = await db.execute("PRAGMA table_info(primaries)");
  const names = cols.rows.map((r) => String(r.name));
  console.log("primaries columns:", names.join(", "));
  const hasRound = names.includes("election_round");
  console.log("election_round present:", hasRound, "\n");

  const today = new Date().toISOString().slice(0, 10);
  const roundClause = hasRound ? "AND p.election_round = 'primary'" : "";

  // A completed contest = past-dated. Split by (a) has a winner row,
  // (b) no winner row but SOME candidate carries a share, (c) no winner and
  // no shares at all (never counted / no roster).
  const rs = await db.execute({
    sql: `
      WITH done AS (
        SELECT p.id, p.chamber, p.party, p.primary_date
        FROM primaries p
        WHERE p.primary_date IS NOT NULL AND p.primary_date < ? ${roundClause}
      ),
      agg AS (
        SELECT d.id, d.chamber, d.primary_date,
               COUNT(pc.id)                                        AS cands,
               SUM(CASE WHEN pc.status='winner' THEN 1 ELSE 0 END)  AS winners,
               SUM(CASE WHEN pc.vote_pct IS NOT NULL THEN 1 ELSE 0 END) AS scored
        FROM done d
        LEFT JOIN primary_candidates pc ON pc.primary_id = d.id
        GROUP BY d.id
      )
      SELECT
        COUNT(*)                                                      AS completed,
        SUM(CASE WHEN winners > 0 THEN 1 ELSE 0 END)                  AS with_winner,
        SUM(CASE WHEN winners = 0 THEN 1 ELSE 0 END)                  AS no_winner,
        SUM(CASE WHEN winners = 0 AND scored > 0 THEN 1 ELSE 0 END)   AS no_winner_but_scored,
        SUM(CASE WHEN winners = 0 AND scored = 0 AND cands > 0 THEN 1 ELSE 0 END) AS no_winner_no_scores,
        SUM(CASE WHEN winners = 0 AND cands = 0 THEN 1 ELSE 0 END)    AS no_roster_at_all
      FROM agg`,
    args: [today],
  });
  console.log(`--- completed primaries (primary_date < ${today}) ---`);
  console.table(rs.rows);

  // The class that matters: results recorded, winner status absent.
  const detail = await db.execute({
    sql: `
      WITH agg AS (
        SELECT p.id, p.chamber, p.state, p.party, p.primary_date,
               COUNT(pc.id) AS cands,
               SUM(CASE WHEN pc.status='winner' THEN 1 ELSE 0 END) AS winners,
               SUM(CASE WHEN pc.vote_pct IS NOT NULL THEN 1 ELSE 0 END) AS scored,
               MAX(pc.vote_pct) AS top_pct
        FROM primaries p
        LEFT JOIN primary_candidates pc ON pc.primary_id = p.id
        WHERE p.primary_date IS NOT NULL AND p.primary_date < ? ${roundClause}
        GROUP BY p.id
      )
      SELECT chamber, COUNT(*) AS contests
      FROM agg WHERE winners = 0 AND scored > 0
      GROUP BY chamber`,
    args: [today],
  });
  console.log("--- no-winner-but-scored, by chamber ---");
  console.table(detail.rows);

  const sample = await db.execute({
    sql: `
      WITH agg AS (
        SELECT p.id, p.state, p.chamber, p.primary_date,
               SUM(CASE WHEN pc.status='winner' THEN 1 ELSE 0 END) AS winners,
               SUM(CASE WHEN pc.vote_pct IS NOT NULL THEN 1 ELSE 0 END) AS scored,
               MAX(pc.vote_pct) AS top_pct
        FROM primaries p
        LEFT JOIN primary_candidates pc ON pc.primary_id = p.id
        WHERE p.primary_date IS NOT NULL AND p.primary_date < ? ${roundClause}
        GROUP BY p.id
      )
      SELECT id, state, chamber, primary_date, scored, ROUND(top_pct,1) AS top_pct
      FROM agg WHERE winners = 0 AND scored > 0
      ORDER BY top_pct DESC LIMIT 15`,
    args: [today],
  });
  console.log("--- sample (highest top share, no winner row) ---");
  console.table(sample.rows);

  const me = await db.execute(
    `SELECT status, COUNT(*) n FROM primary_candidates
     WHERE primary_id LIKE 'senate-ME-2026%' GROUP BY status`,
  );
  console.log("--- ME senate primary_candidates status tally ---");
  console.table(me.rows);
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
