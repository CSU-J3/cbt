// Diagnostic (read-only, HO 272 Phase 1): MOVES feasibility for the v2 RACES-tab
// badge. rating_history (HO 220) appends a row per (race_id, source) only on an
// actual rating change, but the FIRST run logs a baseline row per pair — so a
// real "move" is any row whose observed_at is later than that pair's earliest.
// Reports the log shape, which races have ever really moved, and whether any of
// them are among the 4 featured competitive seats (if not, the MOVES badge
// correctly reads 0 even though the wiring is live).
// Run: `npx tsx scripts/diagnostic/races-moves-272.ts`
import "dotenv/config";
import { getDb } from "../../lib/db";

async function main() {
  const db = getDb();

  const shape = await db.execute(
    `SELECT COUNT(*) rows, COUNT(DISTINCT race_id) races,
            COUNT(DISTINCT observed_at) dates,
            MIN(observed_at) first, MAX(observed_at) last
     FROM rating_history`,
  );
  console.log("=== rating_history shape ===");
  console.log(JSON.stringify(shape.rows[0]));

  const moved = await db.execute(
    `SELECT rh.race_id, MAX(rh.observed_at) last_move
     FROM rating_history rh
     WHERE rh.observed_at > (
       SELECT MIN(r2.observed_at) FROM rating_history r2
       WHERE r2.race_id = rh.race_id AND r2.source = rh.source
     )
     GROUP BY rh.race_id`,
  );
  console.log(`\n=== races with a real move (post-baseline): ${moved.rows.length} ===`);
  for (const r of moved.rows) {
    console.log(`  ${r.race_id} @ ${r.last_move}`);
  }

  // Featured 4 = top-2 Senate + top-2 House by competitiveness (mirrors
  // getMostCompetitiveRaces + the CompetitiveRacesBlock partition).
  const pool = await db.execute(
    `WITH s AS (
       SELECT race_id, MIN(ABS(rating_score)) comp, MAX(updated_at) up
       FROM race_ratings WHERE cycle = 2026 GROUP BY race_id
     )
     SELECT race_id FROM s ORDER BY comp ASC, up DESC LIMIT 30`,
  );
  const ids = pool.rows.map((r) => String(r.race_id));
  const featured = [
    ...ids.filter((i) => i.startsWith("S-")).slice(0, 2),
    ...ids.filter((i) => !i.startsWith("S-")).slice(0, 2),
  ];
  const movedSet = new Set(moved.rows.map((r) => String(r.race_id)));
  const hits = featured.filter((i) => movedSet.has(i));
  console.log(`\n=== featured 4: ${featured.join(", ")} ===`);
  console.log(
    `MOVES badge would show: ${hits.length} (${hits.join(", ") || "none — badge reads 0, wiring still live"})`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
