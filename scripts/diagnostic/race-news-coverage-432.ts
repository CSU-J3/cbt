// HO 432 read-only coverage check. Replicates CompetitiveRacesBlock's featured-
// seat selection (top-2 Senate + top-2 House off getMostCompetitiveRaces) then
// runs the §1 join: which of those 4 incumbents have >=1 person-observation, i.e.
// whether the NEW badge can light in today's sample. No writes.
//
//   npx tsx scripts/diagnostic/race-news-coverage-432.ts
import "dotenv/config";
import { createClient } from "@libsql/client";

const db = createClient({
  url: process.env.TURSO_DATABASE_URL!,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

const many = async (sql: string, args: (string | number)[] = []) =>
  (await db.execute({ sql, args })).rows;

const CYCLE = 2026;
const POOL = 30;
const PER_CHAMBER = 2;

// 1. competitiveness-ordered pool (mirrors getMostCompetitiveRaces CTE)
const pool = await many(
  `WITH race_summary AS (
     SELECT race_id, MIN(ABS(rating_score)) AS competitiveness,
            MAX(updated_at) AS latest_updated_at
     FROM race_ratings WHERE cycle = ? GROUP BY race_id
   )
   SELECT race_id FROM race_summary
   ORDER BY competitiveness ASC, latest_updated_at DESC LIMIT ?`,
  [CYCLE, POOL],
);

// 2. attach chamber + incumbent for the isSenate partition
const enriched = [];
for (const r of pool) {
  const raceId = r.race_id as string;
  const row = (
    await many(
      `SELECT r.chamber, r.incumbent_bioguide_id, m.name AS incumbent_name
       FROM races r LEFT JOIN members m ON m.bioguide_id = r.incumbent_bioguide_id
       WHERE r.id = ? LIMIT 1`,
      [raceId],
    )
  )[0];
  const chamber = (row?.chamber as string | null) ?? null;
  const isSenate =
    chamber === "senate" || (chamber === null && raceId.startsWith("S-"));
  enriched.push({
    raceId,
    isSenate,
    incumbent: (row?.incumbent_bioguide_id as string | null) ?? null,
    incumbentName: (row?.incumbent_name as string | null) ?? null,
  });
}

const senate = enriched.filter((r) => r.isSenate).slice(0, PER_CHAMBER);
const house = enriched.filter((r) => !r.isSenate).slice(0, PER_CHAMBER);
const featured = [...senate, ...house];

console.log("=== featured 4 (Senate-led) ===");
for (const f of featured) {
  console.log(
    `  ${f.raceId.padEnd(10)} inc=${(f.incumbent ?? "OPEN SEAT").padEnd(8)} ${f.incumbentName ?? ""}`,
  );
}

// 3. §1 coverage: person-observations per featured incumbent
const ids = featured.map((f) => f.raceId);
const placeholders = ids.map(() => "?").join(",");
const cov = await many(
  `SELECT r.id AS race_id, COUNT(o.obs_id) AS obs, MAX(o.observed_at) AS last_news
   FROM races r
   JOIN observation_entities oe
     ON oe.entity_type='person' AND oe.entity_value=r.incumbent_bioguide_id
   JOIN observations o ON o.obs_id=oe.obs_id
   WHERE r.id IN (${placeholders}) AND r.incumbent_bioguide_id IS NOT NULL
   GROUP BY r.id`,
  ids,
);

console.log("\n=== §1 coverage (incumbent person-observations) ===");
const covMap = new Map(cov.map((c) => [c.race_id as string, c]));
for (const f of featured) {
  const c = covMap.get(f.raceId);
  console.log(
    `  ${f.raceId.padEnd(10)} obs=${String(c?.obs ?? 0).padEnd(4)} last=${(c?.last_news as string) ?? "-"}`,
  );
}
const seatsWithNews = cov.filter((c) => Number(c.obs) > 0).length;
console.log(
  `\n${seatsWithNews}/4 featured seats have >=1 incumbent observation -> badge CAN ${seatsWithNews > 0 ? "light today" : "NOT light in this sample (genuine absence)"}.`,
);
