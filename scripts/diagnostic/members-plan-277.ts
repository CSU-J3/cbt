// HO 277 — /members timeout probe. Read-only. EXPLAIN QUERY PLAN + raw timing of
// every query the default /members load runs, against the PROD Turso DB (the
// .env creds point at cbt-csu-j3 = prod). Plan choice is server-side, so the plan
// here IS the hosted plan. Run: npx tsx scripts/diagnostic/members-plan-277.ts
import "dotenv/config";
import { createClient } from "@libsql/client";

const db = createClient({
  url: process.env.TURSO_DATABASE_URL!,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

const MEMBERS_RANKED = `
  WITH bills_agg AS (
    SELECT sponsor_bioguide_id, COUNT(*) AS total,
      SUM(CASE WHEN stage='enacted' THEN 1 ELSE 0 END) AS enacted,
      CAST(SUM(CASE WHEN stage='enacted' THEN 1 ELSE 0 END) AS REAL)/COUNT(*) AS passrate
    FROM bills WHERE sponsor_bioguide_id IS NOT NULL AND (is_ceremonial=0 OR is_ceremonial IS NULL)
    GROUP BY sponsor_bioguide_id
  )
  SELECT m.bioguide_id, m.name, m.party, m.state, m.chamber, m.district,
    COALESCE(b.total,0) AS total, COALESCE(b.enacted,0) AS enacted, b.passrate AS passrate,
    ps.grade, ps.rank, ps.total_score
  FROM members m
  LEFT JOIN bills_agg b ON b.sponsor_bioguide_id = m.bioguide_id
  LEFT JOIN palestine_scorecard ps ON ps.bioguide_id = m.bioguide_id
  WHERE m.is_current = 1
  ORDER BY CASE WHEN ?='passrate' THEN passrate END DESC,
    CASE WHEN ?='passrate' THEN total END DESC,
    CASE WHEN ?='volume' THEN total END DESC, m.name ASC
  LIMIT ? OFFSET ?`;

const SPONSOR_PRODUCTIVITY = `
  SELECT b.sponsor_bioguide_id AS bioguide_id, m.name, m.party AS party_raw, m.state, m.chamber,
    COUNT(*) AS bill_count,
    SUM(CASE WHEN b.stage IN ('committee','floor','other_chamber','president','enacted') THEN 1 ELSE 0 END) AS advanced_count,
    SUM(CASE WHEN b.stage='enacted' THEN 1 ELSE 0 END) AS enacted_count
  FROM bills b LEFT JOIN members m ON m.bioguide_id = b.sponsor_bioguide_id
  WHERE b.congress = (SELECT MAX(congress) FROM bills)
    AND (b.is_ceremonial=0 OR b.is_ceremonial IS NULL)
    AND b.stage IS NOT NULL AND b.stage != 'other' AND b.sponsor_bioguide_id IS NOT NULL
  GROUP BY b.sponsor_bioguide_id HAVING COUNT(*)>=3 ORDER BY bill_count DESC`;

const MEMBERS_COUNT = `SELECT COUNT(*) AS n FROM members m WHERE m.is_current = 1`;
const MEMBER_STATES = `SELECT DISTINCT state FROM members WHERE is_current=1 AND state IS NOT NULL ORDER BY state ASC`;

const QUERIES: Array<{ name: string; sql: string; args: (string | number)[] }> = [
  { name: "getMembersRanked", sql: MEMBERS_RANKED, args: ["volume", "volume", "volume", 50, 0] },
  { name: "getMembersRankedCount", sql: MEMBERS_COUNT, args: [] },
  { name: "getSponsorProductivity", sql: SPONSOR_PRODUCTIVITY, args: [] },
  { name: "getMemberStates", sql: MEMBER_STATES, args: [] },
];

async function main() {
  for (const q of QUERIES) {
    console.log(`\n========== ${q.name} ==========`);
    const plan = await db.execute({ sql: `EXPLAIN QUERY PLAN ${q.sql}`, args: q.args });
    for (const r of plan.rows) console.log("  " + (r.detail as string));
    // Time it twice (cold-ish then warm) — raw, no boundedFetch, no cache.
    for (const label of ["t1", "t2"]) {
      const s = Date.now();
      const rs = await db.execute({ sql: q.sql, args: q.args });
      console.log(`  ${label}: ${Date.now() - s}ms  (rows=${rs.rows.length})`);
    }
  }
}
main().then(() => process.exit(0));
