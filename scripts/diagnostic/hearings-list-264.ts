// Diagnostic (read-only, HO 264 Phase 1): three data assumptions behind the
// /hearings list view, settled against live data before the build —
//   (1) meetingType -> HEARING/MARKUP/BUSINESS badge map (distinct set + counts)
//   (2) meetingStatus distinct set + counts (watch-state derivation input)
//   (3) per-meeting bill-count distribution (collapsed cap = 3 + ·N more)
// Run: `npx tsx scripts/diagnostic/hearings-list-264.ts`
import "dotenv/config";
import { getDb } from "../../lib/db";

async function main() {
  const db = getDb();

  console.log("=== (1) meetingType distinct × chamber ===");
  const types = await db.execute(
    `SELECT meeting_type, chamber, COUNT(*) c
     FROM committee_meetings
     GROUP BY meeting_type, chamber
     ORDER BY meeting_type, chamber`,
  );
  for (const r of types.rows) {
    console.log(
      `${String(r.meeting_type ?? "(null)").padEnd(28)} | ${String(r.chamber).padEnd(7)} | ${r.c}`,
    );
  }
  const typeTotals = await db.execute(
    `SELECT meeting_type, COUNT(*) c FROM committee_meetings
     GROUP BY meeting_type ORDER BY c DESC`,
  );
  console.log("--- meetingType totals ---");
  for (const r of typeTotals.rows) {
    console.log(`${String(r.meeting_type ?? "(null)").padEnd(28)} | ${r.c}`);
  }

  console.log("\n=== (2) meetingStatus distinct + counts ===");
  const status = await db.execute(
    `SELECT meeting_status, COUNT(*) c FROM committee_meetings
     GROUP BY meeting_status ORDER BY c DESC`,
  );
  for (const r of status.rows) {
    console.log(`${String(r.meeting_status ?? "(null)").padEnd(28)} | ${r.c}`);
  }
  // status × time-bucket, to see if status tracks past/future or is static.
  console.log("--- status × (future/past) ---");
  const statusTime = await db.execute({
    sql: `SELECT meeting_status,
            SUM(CASE WHEN meeting_date >= ? THEN 1 ELSE 0 END) future,
            SUM(CASE WHEN meeting_date <  ? THEN 1 ELSE 0 END) past
          FROM committee_meetings
          GROUP BY meeting_status ORDER BY meeting_status`,
    args: [new Date().toISOString(), new Date().toISOString()],
  });
  for (const r of statusTime.rows) {
    console.log(
      `${String(r.meeting_status ?? "(null)").padEnd(28)} | future=${String(r.future).padStart(5)} | past=${String(r.past).padStart(5)}`,
    );
  }
  // videoUrl presence × past/future — is WATCH/STREAM derivable from videoUrl?
  console.log("--- videoUrl presence × (future/past) ---");
  const vid = await db.execute({
    sql: `SELECT
            CASE WHEN video_url IS NULL OR video_url = '' THEN 'no-url' ELSE 'has-url' END kind,
            SUM(CASE WHEN meeting_date >= ? THEN 1 ELSE 0 END) future,
            SUM(CASE WHEN meeting_date <  ? THEN 1 ELSE 0 END) past
          FROM committee_meetings
          GROUP BY kind ORDER BY kind`,
    args: [new Date().toISOString(), new Date().toISOString()],
  });
  for (const r of vid.rows) {
    console.log(
      `${String(r.kind).padEnd(10)} | future=${String(r.future).padStart(5)} | past=${String(r.past).padStart(5)}`,
    );
  }
  // sample a few has-url rows to eyeball the link shape
  const sampleVid = await db.execute(
    `SELECT chamber, meeting_status, substr(video_url,1,70) v
     FROM committee_meetings
     WHERE video_url IS NOT NULL AND video_url != ''
     LIMIT 8`,
  );
  console.log("--- sample videoUrls ---");
  for (const r of sampleVid.rows) {
    console.log(`${String(r.chamber).padEnd(7)} | ${String(r.meeting_status).padEnd(12)} | ${r.v}`);
  }

  console.log("\n=== (3) per-meeting bill-count distribution ===");
  const dist = await db.execute(
    `SELECT n, COUNT(*) meetings FROM (
       SELECT m.event_id, COUNT(mb.bill_id) n
       FROM committee_meetings m
       LEFT JOIN meeting_bills mb ON mb.event_id = m.event_id
       GROUP BY m.event_id
     ) GROUP BY n ORDER BY n`,
  );
  let total = 0;
  let over3 = 0;
  let max = 0;
  for (const r of dist.rows) {
    const n = Number(r.n);
    const meetings = Number(r.meetings);
    total += meetings;
    if (n > 3) over3 += meetings;
    if (n > max) max = n;
    console.log(`bills=${String(n).padStart(3)} | meetings=${meetings}`);
  }
  console.log(
    `--- total meetings=${total} | with >3 bills=${over3} | max bills on one meeting=${max} ---`,
  );

  // Scope sanity vs the live helpers' actual band windows.
  const bands = await db.execute({
    sql: `SELECT
            SUM(CASE WHEN meeting_date >= ? AND meeting_date <= ? THEN 1 ELSE 0 END) this_week,
            SUM(CASE WHEN meeting_date > ? AND meeting_date <= ? THEN 1 ELSE 0 END) next_week,
            SUM(CASE WHEN meeting_date < ? AND meeting_date >= ? THEN 1 ELSE 0 END) recent7
          FROM committee_meetings WHERE meeting_date IS NOT NULL`,
    args: (() => {
      const now = Date.now();
      const iso = (ms: number) => new Date(ms).toISOString();
      const D = 86_400_000;
      return [
        iso(now), iso(now + 7 * D),       // this week (next 7d)
        iso(now + 7 * D), iso(now + 14 * D), // next week
        iso(now), iso(now - 7 * D),        // recent 7d
      ];
    })(),
  });
  const b = bands.rows[0]!;
  console.log(
    `\n=== band sanity (raw date windows) === next7=${b.this_week} | 7-14d=${b.next_week} | recent7=${b.recent7}`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
