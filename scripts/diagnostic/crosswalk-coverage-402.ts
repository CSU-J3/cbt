// HO 402 — crosswalk coverage diagnostic (READ-ONLY). Sizes the match rate vs
// CURRENT members and the FEC candidate bridge, and surfaces the actionable
// disagreements between the existing fuzzy `members.fec_candidate_id` and the
// authoritative crosswalk set. No writes.
//
// Run after `sync:crosswalk`:  npx tsx scripts/diagnostic/crosswalk-coverage-402.ts
import "dotenv/config";
import { getDb } from "../../lib/db";

type Db = ReturnType<typeof getDb>;

async function scalar(db: Db, sql: string): Promise<number> {
  const r = await db.execute(sql);
  const v = r.rows[0] ? Object.values(r.rows[0])[0] : 0;
  return typeof v === "number" ? v : Number(v ?? 0);
}

async function list(db: Db, sql: string): Promise<string[]> {
  const r = await db.execute(sql);
  return r.rows.map((row) => String(Object.values(row)[0]));
}

async function main() {
  const db = getDb();

  const total = await scalar(db, "SELECT COUNT(*) FROM members");
  const current = await scalar(
    db,
    "SELECT COUNT(*) FROM members WHERE is_current = 1",
  );
  const populated = await scalar(db, "SELECT COUNT(*) FROM member_ids");
  const withIcpsr = await scalar(
    db,
    "SELECT COUNT(*) FROM member_ids WHERE icpsr IS NOT NULL",
  );
  const withFec = await scalar(
    db,
    "SELECT COUNT(DISTINCT bioguide_id) FROM member_fec_ids",
  );
  const withWiki = await scalar(
    db,
    "SELECT COUNT(*) FROM member_ids WHERE wikipedia_title IS NOT NULL",
  );
  const distinctFec = await scalar(
    db,
    "SELECT COUNT(DISTINCT fec_candidate_id) FROM member_fec_ids",
  );

  // Agreement: the fuzzy members.fec_candidate_id appears in the member's
  // authoritative crosswalk set. Necessary-but-not-sufficient for a sync-fec
  // switch (the set holds every career ID; sync-fec needs the current-office one).
  const agree = await scalar(
    db,
    `SELECT COUNT(*) FROM members m
     WHERE m.fec_candidate_id IS NOT NULL
       AND EXISTS (
         SELECT 1 FROM member_fec_ids f
         WHERE f.bioguide_id = m.bioguide_id
           AND f.fec_candidate_id = m.fec_candidate_id
       )`,
  );

  // Disagreement (the actionable number): the fuzzy pick is NOT in the member's
  // crosswalk set — AND the member HAS a non-empty set. Requiring a non-empty
  // set keeps members with no crosswalk row (or the rare no-fec-array record) out
  // of this bucket; they're trivially "not in an empty set" and already surface
  // under "no crosswalk row" below. What's left is real mismatch = probable bad
  // fuzzy pick.
  const DISAGREE_WHERE = `m.fec_candidate_id IS NOT NULL
       AND EXISTS (SELECT 1 FROM member_fec_ids f2 WHERE f2.bioguide_id = m.bioguide_id)
       AND NOT EXISTS (
         SELECT 1 FROM member_fec_ids f
         WHERE f.bioguide_id = m.bioguide_id
           AND f.fec_candidate_id = m.fec_candidate_id
       )`;
  const disagree = await scalar(
    db,
    `SELECT COUNT(*) FROM members m WHERE ${DISAGREE_WHERE}`,
  );
  const disagreeList = await db.execute(
    `SELECT m.bioguide_id, m.name, m.fec_candidate_id AS fuzzy
     FROM members m WHERE ${DISAGREE_WHERE}
     ORDER BY m.bioguide_id`,
  );

  // Current members with no crosswalk row at all.
  const noRow = await list(
    db,
    `SELECT m.bioguide_id FROM members m
     WHERE m.is_current = 1
       AND NOT EXISTS (SELECT 1 FROM member_ids x WHERE x.bioguide_id = m.bioguide_id)
     ORDER BY m.bioguide_id`,
  );

  // Crosswalk rows whose bioguide isn't a member (should be 0 — the sync gate
  // skips these — but a drift check is cheap).
  const orphanRows = await list(
    db,
    `SELECT x.bioguide_id FROM member_ids x
     WHERE NOT EXISTS (SELECT 1 FROM members m WHERE m.bioguide_id = x.bioguide_id)
     ORDER BY x.bioguide_id`,
  );

  const pct = (n: number, d: number) =>
    d > 0 ? `${((100 * n) / d).toFixed(1)}%` : "—";

  console.log("=== HO 402 CROSSWALK COVERAGE ===\n");
  console.log(`members total ............................. ${total}`);
  console.log(`members current (is_current=1) ............ ${current}`);
  console.log(
    `member_ids populated ...................... ${populated}   (${pct(populated, current)} vs CURRENT)`,
  );
  console.log(
    `  with icpsr .............................. ${withIcpsr}   (${pct(withIcpsr, current)})   <- gates Voteview`,
  );
  console.log(
    `  with >=1 fec_candidate_id ............... ${withFec}   (${pct(withFec, current)})   <- money bridge`,
  );
  console.log(
    `  with wikipedia_title .................... ${withWiki}   (${pct(withWiki, current)})   <- gates pageviews`,
  );
  console.log(
    `distinct fec_candidate_id in member_fec_ids  ${distinctFec}   <- size of the candidate bridge`,
  );
  console.log(
    `members whose fuzzy fec_candidate_id is`,
  );
  console.log(`  IN their crosswalk set (agreement) ...... ${agree}`);
  console.log(
    `  ABSENT despite a non-empty set .......... ${disagree}   <- probable bad fuzzy pick`,
  );
  for (const r of disagreeList.rows) {
    console.log(
      `      ${r.bioguide_id}  ${String(r.name ?? "").padEnd(24)} fuzzy=${r.fuzzy}`,
    );
  }
  console.log(
    `current members with NO crosswalk row ..... ${noRow.length}`,
  );
  if (noRow.length > 0) console.log(`      ${noRow.join(", ")}`);
  console.log(
    `crosswalk rows not in members (drift) ..... ${orphanRows.length}`,
  );
  if (orphanRows.length > 0) console.log(`      ${orphanRows.join(", ")}`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
