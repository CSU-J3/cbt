// Diagnostic (read-only, HO 266 Phase 1): sizing for the dashboard ON THE HILL
// band — a this-week (Mon–Fri) compact committee calendar.
//   (1) per-weekday count this week → confirm the cap-5 + "+N more" collapse.
//   (2) LIVE NOW callout → how many meetings are live right now under the Piece 1
//       watchState rule (the band shows one if any, else omits the callout).
// Run: `npx tsx scripts/diagnostic/hearings-hill-266.ts`
import "dotenv/config";
import { getDb } from "../../lib/db";
import { addDaysToKey, etDayKey, etTodayKey, mondayOfKey, watchState } from "../../lib/hearings";

const DOW = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];

async function main() {
  const db = getDb();
  const now = Date.now();
  const todayKey = etTodayKey(now);
  const monKey = mondayOfKey(todayKey);

  console.log(`today(ET)=${todayKey} | WEEK OF ${monKey} (Mon–Fri)`);

  // Pull a window covering this week + a margin, bucket by ET day.
  const startMs = Date.parse(`${monKey}T12:00:00Z`) - 2 * 86_400_000;
  const endMs = Date.parse(`${addDaysToKey(monKey, 5)}T12:00:00Z`) + 2 * 86_400_000;
  const rs = await db.execute({
    sql: `SELECT event_id, chamber, meeting_date, meeting_type, meeting_status,
                 video_url, title, committee_system_code
          FROM committee_meetings
          WHERE meeting_date IS NOT NULL AND meeting_date >= ? AND meeting_date < ?`,
    args: [new Date(startMs).toISOString(), new Date(endMs).toISOString()],
  });

  // (1) per-weekday this week (Mon–Fri)
  const weekKeys = Array.from({ length: 5 }, (_, i) => addDaysToKey(monKey, i));
  const byDay = new Map<string, number>();
  for (const r of rs.rows) {
    const k = etDayKey(r.meeting_date as string);
    if (weekKeys.includes(k)) byDay.set(k, (byDay.get(k) ?? 0) + 1);
  }
  console.log("\n=== (1) per-weekday this week ===");
  let max = 0;
  for (const k of weekKeys) {
    const wd = new Date(`${k}T12:00:00Z`).getUTCDay();
    const n = byDay.get(k) ?? 0;
    if (n > max) max = n;
    console.log(`${k} ${DOW[wd]} | ${n}${k === todayKey ? "  <- TODAY" : ""}`);
  }
  console.log(`MAX single weekday=${max} | cap 5 collapses days with >5 to "+N more"`);

  // (2) LIVE NOW — meetings live right now under the Piece 1 watchState rule
  console.log("\n=== (2) LIVE NOW (watchState === 'live') ===");
  const live = rs.rows
    .map((r) => ({
      meetingDate: r.meeting_date as string,
      meetingStatus: (r.meeting_status as string) ?? "",
      videoUrl: (r.video_url as string | null) ?? null,
      title: (r.title as string) ?? "",
      committee: (r.committee_system_code as string | null) ?? null,
    }))
    .filter((m) => watchState(m, now) === "live");
  console.log(`live meetings now: ${live.length}`);
  for (const m of live) {
    console.log(`  ${m.meetingDate} | ${m.committee} | ${m.title.slice(0, 60)}`);
  }
  if (live.length === 0) {
    console.log("(none live → header callout omitted; rule confirmed in lib/hearings.watchState)");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
