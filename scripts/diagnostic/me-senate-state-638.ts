// HO 638 Phase 1 — READ-ONLY state report for S-ME-2026. No writes.
//   npx tsx scripts/diagnostic/me-senate-state-638.ts
import "dotenv/config";
import { getDb } from "../../lib/db";

const RACE = "S-ME-2026";

async function main() {
  const db = getDb();

  console.log("\n=== races ===");
  const race = await db.execute({
    sql: `SELECT id, rating, rating_source, rating_updated_at,
                 incumbent_bioguide_id, incumbent_running, last_verified, source_url
          FROM races WHERE id = ?`,
    args: [RACE],
  });
  console.table(race.rows);

  console.log("\n=== race_candidates ===");
  const cands = await db.execute({
    sql: `SELECT name, party, bioguide_id, status, source_url
          FROM race_candidates WHERE race_id = ? ORDER BY name`,
    args: [RACE],
  });
  console.table(cands.rows);

  console.log("\n=== race_ratings ===");
  const ratings = await db.execute({
    sql: `SELECT source, rating, rating_score, rating_date, updated_at
          FROM race_ratings WHERE race_id = ? ORDER BY updated_at DESC`,
    args: [RACE],
  });
  console.table(ratings.rows);

  console.log("\n=== rating_history (ME) ===");
  const hist = await db.execute({
    sql: `SELECT source, rating, rating_score, rating_date, observed_at
          FROM rating_history WHERE race_id = ? ORDER BY observed_at DESC, source`,
    args: [RACE],
  });
  console.table(hist.rows);

  console.log("\n=== ME senate primaries + candidates ===");
  const prim = await db.execute({
    sql: `SELECT p.id, p.party, p.primary_date, p.election_round,
                 pc.name, pc.status, pc.vote_pct
          FROM primaries p
          LEFT JOIN primary_candidates pc ON pc.primary_id = p.id
          WHERE p.state = 'ME' AND p.chamber = 'senate'
          ORDER BY p.id, pc.vote_pct DESC`,
    args: [],
  });
  console.table(prim.rows);

  console.log("\n=== last_verified spread across rated 2026 races ===");
  const lv = await db.execute({
    sql: `SELECT r.last_verified, COUNT(*) AS n
          FROM races r
          WHERE r.cycle = 2026
            AND EXISTS (SELECT 1 FROM race_ratings rr WHERE rr.race_id = r.id)
          GROUP BY r.last_verified ORDER BY r.last_verified`,
    args: [],
  });
  console.table(lv.rows);

  console.log("\n=== distinct race_candidates.status values (all races) ===");
  const st = await db.execute({
    sql: `SELECT status, COUNT(*) AS n FROM race_candidates GROUP BY status ORDER BY n DESC`,
    args: [],
  });
  console.table(st.rows);
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
