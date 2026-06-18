// Diagnostic (read-only, HO 268 Gate A + Phase 1): can a stage transition be
// attributed to a specific markup? The strong version (VIA <COMMITTEE> MARKUP
// firehose tags + COMMITTEE → FLOOR moves in markup blocks) needs to join a
// markup meeting's bills (meeting_bills where the meeting is a markup) to that
// week's stage-change events. The report's stage data is the bills table's
// single-slot previous_stage / stage / stage_changed_at (NOT stage_transitions
// — gatherReportData reads bills.*), so probe THAT.
// Run: `npx tsx scripts/diagnostic/report-committee-268.ts`
import "dotenv/config";
import { getDb } from "../../lib/db";

async function main() {
  const db = getDb();

  // 0. stage_changed_at coverage + range — is forward-only tracking thick enough
  //    that a recent report week even has committee→floor moves to attribute?
  const cov = await db.execute(
    `SELECT COUNT(*) total,
            SUM(CASE WHEN stage_changed_at IS NOT NULL THEN 1 ELSE 0 END) tracked,
            MIN(date(stage_changed_at)) first, MAX(date(stage_changed_at)) last
     FROM bills`,
  );
  console.log("=== stage_changed_at coverage (bills table) ===");
  console.log(JSON.stringify(cov.rows[0]));
  const movesByWeek = await db.execute(
    `SELECT strftime('%Y-%W', stage_changed_at) wk,
            MIN(date(stage_changed_at)) from_d, MAX(date(stage_changed_at)) to_d,
            COUNT(*) n,
            SUM(CASE WHEN previous_stage='committee' AND stage='floor' THEN 1 ELSE 0 END) comm_to_floor
     FROM bills WHERE stage_changed_at IS NOT NULL
     GROUP BY wk ORDER BY wk DESC LIMIT 6`,
  );
  console.log("--- recent weeks: all moves vs committee→floor ---");
  for (const r of movesByWeek.rows) {
    console.log(`${r.from_d}..${r.to_d} | moves=${r.n} | committee→floor=${r.comm_to_floor}`);
  }

  // 1. Markup meetings with bills, by week — the left side of the join.
  console.log("\n=== markup meetings with ≥1 bill, by week ===");
  const markupWeeks = await db.execute(
    `SELECT strftime('%Y-%W', m.meeting_date) wk,
            MIN(date(m.meeting_date)) from_d, MAX(date(m.meeting_date)) to_d,
            COUNT(DISTINCT m.event_id) markups,
            COUNT(DISTINCT mb.bill_id) bills
     FROM committee_meetings m
     JOIN meeting_bills mb ON mb.event_id = m.event_id
     WHERE lower(m.meeting_type) LIKE '%markup%'
     GROUP BY wk ORDER BY wk DESC LIMIT 8`,
  );
  for (const r of markupWeeks.rows) {
    console.log(`${r.from_d}..${r.to_d} | markups=${r.markups} | bills=${r.bills}`);
  }

  // 2. THE JOIN — markup-agenda bills whose bills-table stage moved to floor with
  //    stage_changed_at within ±7 days of the markup. This is the strong-version
  //    attribution. Report how many sane attributions exist across all of time.
  console.log("\n=== JOIN: markup bill → committee/other→floor move within ±7d ===");
  const join = await db.execute(
    `SELECT m.committee_system_code code, date(m.meeting_date) mtg_date,
            b.bill_type, b.bill_number, b.previous_stage, b.stage,
            date(b.stage_changed_at) moved
     FROM committee_meetings m
     JOIN meeting_bills mb ON mb.event_id = m.event_id
     JOIN bills b ON b.id = mb.bill_id
     WHERE lower(m.meeting_type) LIKE '%markup%'
       AND b.stage_changed_at IS NOT NULL
       AND b.stage = 'floor'
       AND ABS(julianday(b.stage_changed_at) - julianday(m.meeting_date)) <= 7
     ORDER BY m.meeting_date DESC
     LIMIT 25`,
  );
  console.log(`attributable rows (markup→floor within ±7d): ${join.rows.length}`);
  for (const r of join.rows) {
    console.log(
      `  ${r.code} markup ${r.mtg_date} → ${r.bill_type?.toString().toUpperCase()} ${r.bill_number} (${r.previous_stage}→${r.stage}, moved ${r.moved})`,
    );
  }

  // 2b. Looser: any forward move (not just →floor) for a markup bill within ±7d.
  const joinAny = await db.execute(
    `SELECT COUNT(*) n
     FROM committee_meetings m
     JOIN meeting_bills mb ON mb.event_id = m.event_id
     JOIN bills b ON b.id = mb.bill_id
     WHERE lower(m.meeting_type) LIKE '%markup%'
       AND b.stage_changed_at IS NOT NULL
       AND ABS(julianday(b.stage_changed_at) - julianday(m.meeting_date)) <= 7`,
  );
  console.log(`(looser: markup bill with ANY stage move within ±7d: ${joinAny.rows[0]?.n})`);

  // 3. Phase 1 — current weekly counts shape for the count strip on a real week.
  console.log("\n=== Phase 1: meeting-type mix for a recent closed week ===");
  const wk = await db.execute(
    `SELECT lower(meeting_type) LIKE '%hearing%' isH,
            lower(meeting_type) LIKE '%markup%' isM,
            COUNT(*) n
     FROM committee_meetings
     WHERE date(meeting_date) BETWEEN date('now','-21 days') AND date('now')
     GROUP BY isH, isM`,
  );
  for (const r of wk.rows) {
    const kind = r.isH ? "HEARING" : r.isM ? "MARKUP" : "BUSINESS";
    console.log(`${kind} | ${r.n}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
