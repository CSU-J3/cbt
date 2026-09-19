// HO 736 read-back — the DB half, after the 12:30Z 2026-09-19 harvest re-derive.
// READ-ONLY, and enforced rather than asserted: every statement goes through
// `read()`, which refuses anything whose first keyword is not SELECT or WITH.
// No writes, no schema, no cron, no network.
//
// TRACKED because the finding rests on it (HO 736 post-close). This read-back
// is the first of at least two — the next harvest, and `AK-AL-2026` the day a
// rater lists it (backlog: "a seat nobody rates").
//
// WHAT THIS FILE IS FOR. The harvest DELETEs and re-derives its sentinel rows
// every run, so "did the CASE re-flow" is a census question, not a diff:
// R1 the cron row, R2 the status split and the fifteen by race, R4 the
// ranked_choice exclusion (which carries ZERO rows and therefore cannot be a
// control — see the HO 736 correction), R5/R6 the roster and the IE targets.
//
//   npx tsx scripts/diagnostic/advancer-readback-736.ts
import "dotenv/config";
import { createClient, type InArgs, type ResultSet } from "@libsql/client";
import { HARVEST_SOURCE } from "../../lib/harvest-challengers";

const db = createClient({
  url: process.env.TURSO_DATABASE_URL!,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

// THE GUARD, not a promise in a comment. A header that says "every command is
// a SELECT" reads exactly the same whether or not that is true, so it is not a
// check (docs/method.md § Gates). This throws before the client is reached.
// Falsification: change any `read(...)` below to an INSERT and it dies here.
function read(sql: string, args?: InArgs): Promise<ResultSet> {
  const first = sql.trim().replace(/^--.*$/gm, "").trim().split(/\s+/)[0] ?? "";
  if (!/^(select|with)$/i.test(first))
    throw new Error(`read-only guard: refused a statement starting "${first}"`);
  return args ? db.execute({ sql, args }) : db.execute(sql);
}

function j(rows: unknown[]) {
  return rows.map((r) => JSON.stringify(r)).join("\n");
}

async function main() {
  console.log("HARVEST_SOURCE =", HARVEST_SOURCE);

  // The guard's own gate. A guard nobody fires is a comment with parentheses,
  // so this fires it on a statement that must be refused and prints the
  // refusal. These strings never reach the client.
  for (const bad of ["DELETE FROM race_candidates", "  -- c\n UPDATE races SET x=1"]) {
    let refused = false;
    try {
      await read(bad);
    } catch (e) {
      refused = /read-only guard/.test(String(e));
    }
    console.log(`guard ${refused ? "PASS" : "FAIL"} — ${JSON.stringify(bad)}`);
    if (!refused) process.exit(1);
  }

  console.log("\n=== R1 cron_runs /api/cron/race-challengers, last 4 ===");
  const r1 = await read(`SELECT id, started_at, ended_at, elapsed_ms, status, payload, error_message
       FROM cron_runs WHERE route = '/api/cron/race-challengers'
      ORDER BY started_at DESC LIMIT 4`);
  console.log(j(r1.rows));

  console.log("\n=== R2a status census on the sentinel ===");
  const r2 = await read(`SELECT status, COUNT(*) AS n FROM race_candidates
           WHERE source_url = ? GROUP BY status ORDER BY status`, [HARVEST_SOURCE]);
  console.log(j(r2.rows));

  console.log("\n=== R2b the advancers, by race ===");
  const r2b = await read(`SELECT race_id, name, party, status, updated_at FROM race_candidates
           WHERE source_url = ? AND status = 'advanced'
           ORDER BY race_id, name`, [HARVEST_SOURCE]);
  console.log(`count=${r2b.rows.length}`);
  console.log(j(r2b.rows));

  console.log("\n=== R2c advancers grouped by race_id ===");
  const r2c = await read(`SELECT race_id, COUNT(*) AS n FROM race_candidates
           WHERE source_url = ? AND status = 'advanced'
           GROUP BY race_id ORDER BY race_id`, [HARVEST_SOURCE]);
  console.log(`races=${r2c.rows.length}`);
  console.log(j(r2c.rows));

  console.log("\n=== R2d harvested rows by primary_type (the CASE's input) ===");
  const r2d = await read(`SELECT p.primary_type AS ptype, rc.status, COUNT(*) AS n
            FROM race_candidates rc
            JOIN races r ON r.id = rc.race_id
            JOIN primaries p ON p.state = r.state AND p.chamber = r.chamber
             AND ( r.chamber = 'senate' OR CAST(p.district AS INTEGER) = r.district )
            JOIN primary_candidates pc ON pc.primary_id = p.id AND pc.status = 'winner'
             AND pc.name = rc.name
           WHERE rc.source_url = ?
           GROUP BY p.primary_type, rc.status ORDER BY n DESC`, [HARVEST_SOURCE]);
  console.log(j(r2d.rows));

  console.log("\n=== R4 the ranked_choice control: ME rows on the sentinel ===");
  const r4 = await read(`SELECT rc.race_id, rc.name, rc.party, rc.status, p.primary_type
            FROM race_candidates rc
            JOIN races r ON r.id = rc.race_id
            JOIN primaries p ON p.state = r.state AND p.chamber = r.chamber
             AND ( r.chamber = 'senate' OR CAST(p.district AS INTEGER) = r.district )
           WHERE rc.source_url = ? AND r.state = 'ME'
           ORDER BY rc.race_id, rc.name`, [HARVEST_SOURCE]);
  console.log(`rows=${r4.rows.length}`);
  console.log(j(r4.rows));

  console.log("\n=== R4b every ranked_choice primary reaching a rated 2026 race ===");
  const r4b = await read(`SELECT r.id AS race_id, r.state, r.chamber, p.primary_type,
            (SELECT COUNT(*) FROM primary_candidates pc
              WHERE pc.primary_id = p.id AND pc.status = 'winner') AS winners,
            (SELECT COUNT(*) FROM race_candidates rc WHERE rc.race_id = r.id) AS roster_rows,
            (SELECT COUNT(*) FROM race_candidates rc WHERE rc.race_id = r.id
               AND rc.source_url = '${HARVEST_SOURCE}') AS sentinel_rows
       FROM races r
       JOIN primaries p ON p.state = r.state AND p.chamber = r.chamber
        AND ( r.chamber = 'senate' OR CAST(p.district AS INTEGER) = r.district )
      WHERE r.cycle = 2026 AND p.primary_type = 'ranked_choice'
        AND EXISTS (SELECT 1 FROM race_ratings rr WHERE rr.race_id = r.id AND rr.cycle = 2026)
      ORDER BY r.id`);
  console.log(`rows=${r4b.rows.length}`);
  console.log(j(r4b.rows));

  console.log("\n=== R4c any non-sentinel roster row reading won_primary in a ranked_choice seat ===");
  const r4c = await read(`SELECT rc.race_id, rc.name, rc.status, rc.source_url
       FROM race_candidates rc
       JOIN races r ON r.id = rc.race_id
       JOIN primaries p ON p.state = r.state AND p.chamber = r.chamber
        AND ( r.chamber = 'senate' OR CAST(p.district AS INTEGER) = r.district )
      WHERE p.primary_type = 'ranked_choice' AND r.cycle = 2026
        AND rc.status = 'won_primary'
      ORDER BY rc.race_id, rc.name`);
  console.log(`rows=${r4c.rows.length}`);
  console.log(j(r4c.rows));

  console.log("\n=== R6 IE targets vs the advancer set ===");
  const r6 = await read(`SELECT race_id, candidate_name, support_oppose, cycle FROM pac_ie_spending
      ORDER BY race_id, candidate_name`);
  console.log(`ie rows=${r6.rows.length}`);
  console.log(j(r6.rows));
  const advRaces = new Set(r2b.rows.map((r) => String(r.race_id)));
  console.log(
    "IE rows whose race_id has any advancer:",
    r6.rows.filter((r) => advRaces.has(String(r.race_id))).length,
  );


  console.log("\n=== R5 roster for S-AK-2026 and CA-40-2026 (order as stored) ===");
  const r5 = await read(`SELECT race_id, name, party, status, bioguide_id, source_url
       FROM race_candidates WHERE race_id IN ('S-AK-2026','CA-40-2026')
      ORDER BY race_id, name`);
  console.log(j(r5.rows));

  await db.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
