import "dotenv/config";
import {
  addDays,
  generateWeeklyReport,
  getPriorWeek,
  type WeekRange,
} from "../lib/report-generation";
import { writeReport } from "../lib/report-generation";

async function main() {
  // Optional arg: ISO date for a specific week start. Defaults to prior week.
  const weekArg = process.argv[2];
  const week: WeekRange = weekArg
    ? { start: weekArg, end: addDays(weekArg, 6) }
    : getPriorWeek();

  console.log(`Generating report for week of ${week.start}...`);
  const report = await generateWeeklyReport(week);

  console.log("\n--- GENERATED REPORT ---\n");
  console.log(report.content_md);

  console.log("\nWriting to DB...");
  await writeReport({
    slug: report.slug,
    weekStart: week.start,
    weekEnd: week.end,
    title: report.title,
    contentMd: report.content_md,
  });
  console.log("Done.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
