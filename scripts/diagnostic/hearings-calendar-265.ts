// Diagnostic (read-only, HO 265 Phase 1): per-weekday meeting distribution for
// the /hearings two-week Mon–Fri calendar grid, so the per-cell block cap
// (before "+N more") is set to real data. Buckets the this+next-week window by
// ET calendar day (the grid renders in ET — Piece 1 decision) and reports the
// per-day count, the max single weekday, and how many fall on a weekend (the
// grid drops Sat/Sun).
// Run: `npx tsx scripts/diagnostic/hearings-calendar-265.ts`
import "dotenv/config";
import { getDb } from "../../lib/db";
import { etDayKey } from "../../lib/hearings";

const DOW = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];

function weekdayOf(dayKey: string): number {
  return new Date(`${dayKey}T12:00:00Z`).getUTCDay();
}

async function main() {
  const db = getDb();
  const now = Date.now();
  const todayKey = etDayKey(new Date(now).toISOString());
  const dow = weekdayOf(todayKey);
  // Monday of the current ET week (Mon=1 … Sun=0 → days since Monday).
  const sinceMon = (dow + 6) % 7;
  const mondayMs = Date.parse(`${todayKey}T00:00:00Z`) - sinceMon * 86_400_000;
  const mondayKey = etDayKey(new Date(mondayMs).toISOString());
  const endMs = mondayMs + 14 * 86_400_000; // exclusive: start of week 3
  const endKey = etDayKey(new Date(endMs).toISOString());

  console.log(
    `today(ET)=${todayKey} ${DOW[dow]} | window weeks: WEEK OF ${mondayKey} .. (exclusive ${endKey})`,
  );

  // Pull a generous UTC range around the window, bucket by ET day.
  const rs = await db.execute({
    sql: `SELECT meeting_date, chamber, meeting_type FROM committee_meetings
          WHERE meeting_date IS NOT NULL
            AND meeting_date >= ? AND meeting_date < ?`,
    args: [
      new Date(mondayMs - 2 * 86_400_000).toISOString(),
      new Date(endMs + 2 * 86_400_000).toISOString(),
    ],
  });

  const byDay = new Map<string, number>();
  for (const r of rs.rows) {
    const k = etDayKey(r.meeting_date as string);
    if (k >= mondayKey && k < endKey) byDay.set(k, (byDay.get(k) ?? 0) + 1);
  }

  // enumerate the 14 calendar days of the window
  let maxWeekday = 0;
  let weekendTotal = 0;
  let weekdayTotal = 0;
  console.log("\n=== per-day (full two-week window) ===");
  for (let i = 0; i < 14; i++) {
    const k = etDayKey(new Date(mondayMs + i * 86_400_000).toISOString());
    const wd = weekdayOf(k);
    const n = byDay.get(k) ?? 0;
    const isWeekend = wd === 0 || wd === 6;
    if (isWeekend) weekendTotal += n;
    else {
      weekdayTotal += n;
      if (n > maxWeekday) maxWeekday = n;
    }
    console.log(
      `${k} ${DOW[wd]}${isWeekend ? " (weekend, dropped)" : ""} | ${n}${k === todayKey ? "  <- TODAY" : ""}`,
    );
  }

  console.log(
    `\n=== summary === Mon–Fri total=${weekdayTotal} | weekend(dropped)=${weekendTotal} | MAX single weekday=${maxWeekday}`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
