// HO 345 — Stale reframe: wiring check. READ-ONLY. No writes, no commit.
// Direct script path, so the 10s app abort wrapper doesn't apply.
import "dotenv/config";
import { createClient } from "@libsql/client";

const db = createClient({
  url: process.env.TURSO_DATABASE_URL!,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

async function rows(sql: string, args: unknown[] = []) {
  const rs = await db.execute({ sql, args: args as never });
  return rs.rows;
}
async function one(sql: string, args: unknown[] = []): Promise<number> {
  const rs = await db.execute({ sql, args: args as never });
  return Number(rs.rows[0]?.n ?? 0);
}
function hr(t: string) {
  console.log("\n========== " + t + " ==========");
}

// Opening-week housekeeping title patterns (Q3). LIKE is case-insensitive ASCII.
const HOUSEKEEPING_PATTERNS: { label: string; like: string }[] = [
  { label: "electing officers/speaker", like: "%electing%officer%" },
  { label: "electing the speaker", like: "%electing the speaker%" },
  { label: "electing members to committees", like: "%electing%members%committee%" },
  { label: "election of members to committees", like: "%election of members%committee%" },
  { label: "inform president of election of", like: "%inform the president%election of%" },
  { label: "notify president of election of officers", like: "%notify%president%election of officer%" },
  { label: "house assembled / quorum", like: "%has assembled and a quorum%" },
  { label: "inform senate house assembled", like: "%inform the senate that the house has assembled%" },
  { label: "fixing the daily hour of meeting", like: "%hour of%meeting%" },
  { label: "electing a president pro tempore", like: "%president pro tempore%" },
  { label: "consent to assemble outside seat of govt", like: "%assemble outside%seat of%government%" },
  { label: "notify president quorum assembled", like: "%president%quorum%assembled%" },
];

async function main() {
  console.log("INSTANCE:", (process.env.TURSO_DATABASE_URL || "").replace(/\?.*/, ""));

  // ---------- schema confirmation (don't trust the base doc) ----------
  hr("SCHEMA — bills columns (PRAGMA)");
  const cols = await rows("PRAGMA table_info(bills)");
  const colSet = new Set(cols.map((c) => String(c.name)));
  for (const c of ["stage", "previous_stage", "stage_observed_at", "latest_action_date",
    "latest_action_text", "introduced_date", "is_ceremonial", "cluster_id",
    "cosponsor_count", "bill_type", "title"]) {
    console.log(`   bills.${c.padEnd(20)} ${colSet.has(c) ? "PRESENT" : "**MISSING**"}`);
  }
  const tbls = await rows(
    "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('meeting_bills','committee_meetings','stage_transitions','news_mentions') ORDER BY name",
  );
  console.log("   tables present:", tbls.map((t) => t.name).join(", "));

  // ========== Q1: stage discrete/sortable/filterable ==========
  hr("Q1 — stage enum (distinct values + counts + nulls)");
  const stageRs = await rows(
    "SELECT stage, COUNT(*) AS n FROM bills GROUP BY stage ORDER BY n DESC",
  );
  for (const r of stageRs) console.log(`   ${String(r.stage ?? "NULL").padEnd(16)} ${String(r.n).padStart(6)}`);
  const total = await one("SELECT COUNT(*) AS n FROM bills");
  console.log(`   TOTAL ${total}`);

  // ========== Q2: last-action past committee — real & varied ==========
  hr("Q2 — floor + other_chamber latest_action_date distribution (by month)");
  const monthDist = await rows(
    `SELECT substr(latest_action_date,1,7) AS ym, COUNT(*) AS n
       FROM bills
      WHERE stage IN ('floor','other_chamber')
        AND latest_action_date IS NOT NULL
      GROUP BY ym ORDER BY ym`,
  );
  for (const r of monthDist) console.log(`   ${r.ym}  ${String(r.n).padStart(5)}`);
  const nullAction = await one(
    "SELECT COUNT(*) AS n FROM bills WHERE stage IN ('floor','other_chamber') AND latest_action_date IS NULL",
  );
  console.log(`   (null latest_action_date in floor+other_chamber: ${nullAction})`);
  console.log("\n   sample floor / other_chamber rows:");
  const sample = await rows(
    `SELECT id, stage, latest_action_date, substr(title,1,70) AS t
       FROM bills WHERE stage IN ('floor','other_chamber') AND latest_action_date IS NOT NULL
      ORDER BY latest_action_date DESC LIMIT 8`,
  );
  for (const r of sample) console.log(`     ${String(r.id).padEnd(14)} ${String(r.stage).padEnd(14)} ${r.latest_action_date}  ${r.t}`);
  const sampleOld = await rows(
    `SELECT id, stage, latest_action_date, substr(title,1,70) AS t
       FROM bills WHERE stage IN ('floor','other_chamber') AND latest_action_date IS NOT NULL
      ORDER BY latest_action_date ASC LIMIT 8`,
  );
  console.log("   oldest floor / other_chamber rows:");
  for (const r of sampleOld) console.log(`     ${String(r.id).padEnd(14)} ${String(r.stage).padEnd(14)} ${r.latest_action_date}  ${r.t}`);

  // ========== Q3: procedural housekeeping class ==========
  hr("Q3 — existing flags: is_ceremonial / cluster_id on floor-stage hres/sres");
  const floorRes = await one(
    "SELECT COUNT(*) AS n FROM bills WHERE stage='floor' AND bill_type IN ('hres','sres')",
  );
  console.log(`   floor-stage hres/sres total: ${floorRes}`);
  const floorResCeremonial = await rows(
    `SELECT is_ceremonial, COUNT(*) AS n FROM bills
      WHERE stage='floor' AND bill_type IN ('hres','sres') GROUP BY is_ceremonial`,
  );
  console.log("   ...by is_ceremonial:");
  for (const r of floorResCeremonial) console.log(`     is_ceremonial=${String(r.is_ceremonial)} -> ${r.n}`);
  const floorResCluster = await rows(
    `SELECT cluster_id, COUNT(*) AS n FROM bills
      WHERE stage='floor' AND bill_type IN ('hres','sres') GROUP BY cluster_id ORDER BY n DESC`,
  );
  console.log("   ...by cluster_id:");
  for (const r of floorResCluster) console.log(`     cluster=${String(r.cluster_id ?? "NULL").padEnd(24)} -> ${r.n}`);

  hr("Q3 — title-pattern catch for opening-week housekeeping (hres/sres only)");
  const seen = new Set<string>();
  for (const p of HOUSEKEEPING_PATTERNS) {
    const matches = await rows(
      `SELECT id, bill_type, stage, latest_action_date, substr(title,1,90) AS t
         FROM bills WHERE bill_type IN ('hres','sres') AND lower(title) LIKE ?
        ORDER BY id`,
      [p.like],
    );
    console.log(`\n   [${p.label}]  pattern=${p.like}  -> ${matches.length}`);
    for (const r of matches) {
      const dup = seen.has(String(r.id)) ? " (dup)" : "";
      seen.add(String(r.id));
      console.log(`     ${String(r.id).padEnd(14)} ${String(r.stage ?? "NULL").padEnd(13)} ${String(r.latest_action_date ?? "-").padEnd(11)} ${r.t}${dup}`);
    }
  }
  console.log(`\n   UNION distinct candidate bills caught: ${seen.size}`);

  // Boundary: the Rules package must NOT be caught. Show what 'rules of the house' looks like.
  hr("Q3 — BOUNDARY: 'adopting the Rules of the House' (must NOT be filtered)");
  const rulesRows = await rows(
    `SELECT id, stage, substr(title,1,100) AS t FROM bills
      WHERE bill_type IN ('hres','sres') AND lower(title) LIKE '%rules of the house%' ORDER BY id LIMIT 10`,
  );
  for (const r of rulesRows) {
    const caught = seen.has(String(r.id)) ? "  <-- **CAUGHT BY FILTER (BAD)**" : "  (clean)";
    console.log(`   ${String(r.id).padEnd(14)} ${String(r.stage ?? "NULL").padEnd(13)} ${r.t}${caught}`);
  }

  // ========== Q4: 'past committee' group expressible ==========
  hr("Q4 — past-committee group  stage IN ('floor','other_chamber','president')");
  const grp = await rows(
    `SELECT stage, COUNT(*) AS n FROM bills
      WHERE stage IN ('floor','other_chamber','president') GROUP BY stage ORDER BY n DESC`,
  );
  let grpTotal = 0;
  for (const r of grp) { console.log(`   ${String(r.stage).padEnd(16)} ${r.n}`); grpTotal += Number(r.n); }
  console.log(`   group total (excl enacted/other/NULL): ${grpTotal}`);

  // ========== Q5: cosponsor count ==========
  hr("Q5 — cosponsor_count: column + coverage + raw_json availability + history");
  const ccCov = await rows(
    `SELECT CASE WHEN cosponsor_count IS NULL THEN 'NULL' ELSE 'populated' END AS k, COUNT(*) AS n
       FROM bills GROUP BY k`,
  );
  for (const r of ccCov) console.log(`   cosponsor_count ${String(r.k).padEnd(10)} ${r.n}`);
  const ccSample = await rows(
    "SELECT id, cosponsor_count, json_extract(raw_json,'$.cosponsors.count') AS raw FROM bills WHERE cosponsor_count IS NOT NULL ORDER BY cosponsor_count DESC LIMIT 5",
  );
  console.log("   sample (column vs raw_json $.cosponsors.count):");
  for (const r of ccSample) console.log(`     ${String(r.id).padEnd(14)} col=${String(r.cosponsor_count).padStart(4)}  raw=${r.raw}`);
  // history: any table holding a time series of cosponsor counts?
  const ccHistTables = await rows(
    "SELECT name FROM sqlite_master WHERE type='table' AND (name LIKE '%cosponsor%' OR name LIKE '%cosponsor_history%')",
  );
  console.log(`   cosponsor-history tables: ${ccHistTables.length ? ccHistTables.map((t) => t.name).join(", ") : "NONE"}`);

  // ========== Q6: hearing-to-bill linkage ==========
  hr("Q6 — hearing-to-bill linkage (meeting_bills junction)");
  const mbExists = (await rows("SELECT name FROM sqlite_master WHERE type='table' AND name='meeting_bills'")).length > 0;
  console.log(`   meeting_bills table: ${mbExists ? "PRESENT" : "ABSENT"}`);
  if (mbExists) {
    const mbCols = await rows("PRAGMA table_info(meeting_bills)");
    console.log("   meeting_bills columns:", mbCols.map((c) => `${c.name}`).join(", "));
    const mbRows = await one("SELECT COUNT(*) AS n FROM meeting_bills");
    const mbDistinctBills = await one("SELECT COUNT(DISTINCT bill_id) AS n FROM meeting_bills");
    const mtgTotal = await one("SELECT COUNT(*) AS n FROM committee_meetings");
    console.log(`   meeting_bills rows: ${mbRows}  | distinct bills with a hearing: ${mbDistinctBills}  | total meetings: ${mtgTotal}`);
    // how many of the past-committee group have a hearing link?
    const grpWithHearing = await one(
      `SELECT COUNT(DISTINCT b.id) AS n FROM bills b
         JOIN meeting_bills mb ON mb.bill_id = b.id
        WHERE b.stage IN ('floor','other_chamber','president')`,
    );
    console.log(`   past-committee-group bills that have a hearing link: ${grpWithHearing} / ${grpTotal}`);
  }

  console.log("\nDONE.");
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
