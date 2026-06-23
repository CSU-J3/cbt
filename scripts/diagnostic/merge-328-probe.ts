import "dotenv/config";
import { getDb } from "../../lib/db";

// HO 328 pre-flight — resolve the three gating premises before building.
async function main() {
  const db = getDb();

  // ---- Premise 3: live hearings feasibility ----
  console.log("=== PREMISE 3: hearings time granularity ===");
  const sample = await db.execute(
    `SELECT event_id, chamber, meeting_date, meeting_status, title
     FROM committee_meetings
     WHERE meeting_date IS NOT NULL
     ORDER BY meeting_date DESC LIMIT 12`,
  );
  for (const r of sample.rows) {
    console.log(
      `${r.meeting_date} | ${r.meeting_status} | ${r.chamber} | ${String(r.title).slice(0, 50)}`,
    );
  }
  // Does meeting_date ever carry a non-midnight time?
  const timeCheck = await db.execute(
    `SELECT
       SUM(CASE WHEN meeting_date LIKE '%T00:00%' OR meeting_date NOT LIKE '%T%' THEN 1 ELSE 0 END) AS midnight_or_dateonly,
       SUM(CASE WHEN meeting_date LIKE '%T%' AND meeting_date NOT LIKE '%T00:00%' THEN 1 ELSE 0 END) AS has_real_time,
       COUNT(*) AS total
     FROM committee_meetings WHERE meeting_date IS NOT NULL`,
  );
  console.log("time granularity:", JSON.stringify(timeCheck.rows[0]));
  // distinct meeting_status values
  const statuses = await db.execute(
    `SELECT meeting_status, COUNT(*) AS n FROM committee_meetings GROUP BY meeting_status ORDER BY n DESC`,
  );
  console.log("statuses:", JSON.stringify(statuses.rows));
  // Any meetings dated today or in the near future?
  const future = await db.execute(
    `SELECT COUNT(*) AS n, MIN(meeting_date) AS earliest, MAX(meeting_date) AS latest
     FROM committee_meetings WHERE meeting_date >= datetime('now', '-1 day')`,
  );
  console.log("today/future window:", JSON.stringify(future.rows[0]));
  console.log("now:", new Date().toISOString());

  // ---- Premise 1: per-row topic mix in ONE query (json_each fanout) ----
  console.log("\n=== PREMISE 1: per-member topic mix in one query ===");
  const t0 = Date.now();
  const topicMix = await db.execute(
    `SELECT sponsor_bioguide_id AS bid, je.value AS topic, COUNT(*) AS n
     FROM bills, json_each(bills.topics) je
     WHERE sponsor_bioguide_id IS NOT NULL
       AND topics IS NOT NULL
       AND (is_ceremonial = 0 OR is_ceremonial IS NULL)
     GROUP BY sponsor_bioguide_id, je.value`,
  );
  const ms = Date.now() - t0;
  console.log(`fanout rows: ${topicMix.rows.length} in ${ms}ms`);
  // how many distinct members covered
  const members = new Set(topicMix.rows.map((r) => r.bid));
  console.log(`distinct members with topic data: ${members.size}`);

  // ---- Premise 2: scoped roster join cheapness ----
  console.log("\n=== PREMISE 2: committee_members count ===");
  const cm = await db.execute(
    `SELECT COUNT(*) AS rows, COUNT(DISTINCT committee_system_code) AS committees FROM committee_members`,
  );
  console.log(JSON.stringify(cm.rows[0]));
}

main().then(() => process.exit(0));
