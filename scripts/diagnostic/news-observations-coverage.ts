// HO 394 — news-as-observations coverage probe (READ-ONLY). Run before and after
// a `npm run sync:news` to size the coverage gain the Observation dual-write
// buys over the bill-keyed `news_mentions`. Decides Gates A (coverage) + B
// (joinability) from data.
//
// Baseline to beat (HO 394 funnel probe, one run): 55 fetched → 13 bill-matched
// → 42 dropped. The target: that ~76% dropped population lands as
// member/committee-tagged observations.
//
// No writes. Every statement is a SELECT / EXPLAIN.
import "dotenv/config";
import { getDb } from "../../lib/db";

type Db = ReturnType<typeof getDb>;

async function scalar(db: Db, sql: string): Promise<number> {
  const r = await db.execute(sql);
  const row = r.rows[0];
  if (!row) return 0;
  const v = Object.values(row)[0];
  return typeof v === "number" ? v : Number(v ?? 0);
}

async function main(): Promise<void> {
  const db = getDb();

  // Guard: tables may not exist yet (pre-migration).
  const tbl = await db.execute(
    "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('observations','observation_entities')",
  );
  if (tbl.rows.length < 2) {
    console.log(
      "observations / observation_entities not present yet — run `npm run migrate` first.",
    );
    process.exit(0);
  }

  const obsTotal = await scalar(db, "SELECT COUNT(*) FROM observations");
  const nmTotal = await scalar(db, "SELECT COUNT(*) FROM news_mentions");

  // No-LLM-call population (adjustment 1): articles extraction never sees.
  const noLlmRegex = await scalar(
    db,
    "SELECT COUNT(*) FROM observations WHERE tags LIKE '%no_llm_call:regex%'",
  );
  const noLlmPrefilter = await scalar(
    db,
    "SELECT COUNT(*) FROM observations WHERE tags LIKE '%no_llm_call:prefilter%'",
  );
  const noLlmNoClient = await scalar(
    db,
    "SELECT COUNT(*) FROM observations WHERE tags LIKE '%no_llm_call:no_client%'",
  );
  const llmError = await scalar(
    db,
    "SELECT COUNT(*) FROM observations WHERE tags LIKE '%llm_error%'",
  );

  // Entity coverage (obs-level).
  const obsWithBill = await scalar(
    db,
    "SELECT COUNT(DISTINCT obs_id) FROM observation_entities WHERE entity_type='bill'",
  );
  const obsWithPerson = await scalar(
    db,
    "SELECT COUNT(DISTINCT obs_id) FROM observation_entities WHERE entity_type='person' AND entity_value IS NOT NULL",
  );
  const obsWithCommittee = await scalar(
    db,
    "SELECT COUNT(DISTINCT obs_id) FROM observation_entities WHERE entity_type='committee' AND entity_value IS NOT NULL",
  );
  const obsZeroEntities = await scalar(
    db,
    "SELECT COUNT(*) FROM observations o WHERE NOT EXISTS (SELECT 1 FROM observation_entities e WHERE e.obs_id = o.obs_id)",
  );
  // Captured-but-not-bill: has ≥1 non-bill entity (any) and NO bill entity.
  const capturedNonBill = await scalar(
    db,
    `SELECT COUNT(*) FROM (
       SELECT obs_id FROM observation_entities
       WHERE entity_type IN ('person','committee','org')
       GROUP BY obs_id
     ) a
     WHERE a.obs_id NOT IN (SELECT obs_id FROM observation_entities WHERE entity_type='bill')`,
  );
  // Joinable rescue (Gate B): has ≥1 RESOLVED person/committee and no bill.
  const joinableNonBill = await scalar(
    db,
    `SELECT COUNT(*) FROM (
       SELECT obs_id FROM observation_entities
       WHERE entity_type IN ('person','committee') AND entity_value IS NOT NULL
       GROUP BY obs_id
     ) a
     WHERE a.obs_id NOT IN (SELECT obs_id FROM observation_entities WHERE entity_type='bill')`,
  );

  // Resolver drop-rate (adjustment 3 — unresolved kept for audit).
  const personTotal = await scalar(
    db,
    "SELECT COUNT(*) FROM observation_entities WHERE entity_type='person'",
  );
  const personResolved = await scalar(
    db,
    "SELECT COUNT(*) FROM observation_entities WHERE entity_type='person' AND entity_value IS NOT NULL",
  );
  const committeeTotal = await scalar(
    db,
    "SELECT COUNT(*) FROM observation_entities WHERE entity_type='committee'",
  );
  const committeeResolved = await scalar(
    db,
    "SELECT COUNT(*) FROM observation_entities WHERE entity_type='committee' AND entity_value IS NOT NULL",
  );
  const orgTotal = await scalar(
    db,
    "SELECT COUNT(*) FROM observation_entities WHERE entity_type='org'",
  );

  // Distinct entity coverage. Bills/members are pure observation_entities counts
  // (no bills/members table scan). The races count is the one cross-table join —
  // both are hinted onto their indexes (must-fix: INDEXED BY on bills/races
  // access; Turso is statless).
  const distinctBills = await scalar(
    db,
    "SELECT COUNT(DISTINCT entity_value) FROM observation_entities INDEXED BY idx_obs_entities_type_value WHERE entity_type='bill' AND entity_value IS NOT NULL",
  );
  const distinctMembers = await scalar(
    db,
    "SELECT COUNT(DISTINCT entity_value) FROM observation_entities INDEXED BY idx_obs_entities_type_value WHERE entity_type='person' AND entity_value IS NOT NULL",
  );
  const RACES_JOIN_SQL =
    "SELECT COUNT(DISTINCT r.id) FROM observation_entities oe INDEXED BY idx_obs_entities_type_value " +
    "JOIN races r INDEXED BY idx_races_incumbent ON r.incumbent_bioguide_id = oe.entity_value " +
    "WHERE oe.entity_type='person' AND oe.entity_value IS NOT NULL";
  const distinctRaces = await scalar(db, RACES_JOIN_SQL);

  // news_mentions baseline (the 113 / 0.68% figure).
  const nmDistinctBills = await scalar(
    db,
    "SELECT COUNT(DISTINCT bill_id) FROM news_mentions",
  );

  const pct = (n: number, d: number) => (d > 0 ? `${((100 * n) / d).toFixed(1)}%` : "—");

  console.log("=== HO 394 OBSERVATIONS COVERAGE ===");
  console.log(`observations (all captured):        ${obsTotal}`);
  console.log(`news_mentions (bill-keyed, live):   ${nmTotal}`);
  console.log("");
  console.log("-- no-LLM-call population (extraction never ran) --");
  console.log(`  no_llm_call:regex     ${noLlmRegex}`);
  console.log(`  no_llm_call:prefilter ${noLlmPrefilter}`);
  console.log(`  no_llm_call:no_client ${noLlmNoClient}`);
  console.log(`  llm_error             ${llmError}`);
  console.log("");
  console.log("-- entity coverage (obs-level) --");
  console.log(`  obs with a bill entity:            ${obsWithBill}`);
  console.log(`  obs with a resolved person:        ${obsWithPerson}`);
  console.log(`  obs with a resolved committee:     ${obsWithCommittee}`);
  console.log(`  obs with ZERO entities (noise):    ${obsZeroEntities}  (${pct(obsZeroEntities, obsTotal)})`);
  console.log(`  captured non-bill (any entity, no bill):   ${capturedNonBill}`);
  console.log(`  >> JOINABLE rescue (resolved person/committee, no bill): ${joinableNonBill}  (${pct(joinableNonBill, obsTotal)} of obs)`);
  console.log("");
  console.log("-- resolver drop-rate (unresolved kept, value=null) --");
  console.log(`  person:    ${personResolved}/${personTotal} resolved  (drop ${pct(personTotal - personResolved, personTotal)})`);
  console.log(`  committee: ${committeeResolved}/${committeeTotal} resolved  (drop ${pct(committeeTotal - committeeResolved, committeeTotal)})`);
  console.log(`  org:       ${orgTotal} total (caucus value mostly null by design)`);
  console.log("");
  console.log("-- joinability (Gate B) --");
  console.log(`  distinct bills with an observation:   ${distinctBills}   (news_mentions baseline: ${nmDistinctBills} / ~16,623 = ${pct(nmDistinctBills, 16623)})`);
  console.log(`  distinct MEMBERS with an observation: ${distinctMembers}   (member→news, impossible before)`);
  console.log(`  distinct RACES with an observation:   ${distinctRaces}   (race→news via incumbent_bioguide_id, impossible before)`);
  console.log("");
  console.log("-- baseline (HO 394 funnel probe, one run): 55 fetched / 13 bill-matched / 42 dropped --");
  console.log("");

  // must-fix: EXPLAIN the two cross-/wide-table accesses so the plan is on record.
  console.log("-- EXPLAIN QUERY PLAN (must-fix) --");
  for (const [label, sql] of [
    ["races join (entity_value → races.incumbent_bioguide_id)", RACES_JOIN_SQL],
    [
      "distinct-bills-with-obs",
      "SELECT COUNT(DISTINCT entity_value) FROM observation_entities INDEXED BY idx_obs_entities_type_value WHERE entity_type='bill' AND entity_value IS NOT NULL",
    ],
  ] as const) {
    const plan = await db.execute(`EXPLAIN QUERY PLAN ${sql}`);
    console.log(`  ${label}:`);
    for (const row of plan.rows) console.log(`    ${row.detail ?? JSON.stringify(row)}`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
