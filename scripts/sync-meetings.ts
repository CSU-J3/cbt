// HO 263: manual backfill / local run of the committee-meetings sync. The ~2,400
// detail-call backfill does NOT run inside the cron (it would hammer the shared
// CONGRESS_API_KEY budget); kick it once here. After that the committees cron
// keeps the daily delta fresh. Re-runnable: the per-chamber watermark resumes
// forward, so a second run only does what's new (or finishes a chunked drain).
//
//   npm run sync:meetings              # drain everything new since the watermark
//   npm run sync:meetings -- 500       # cap this run to 500 events (chunked drain)
import "dotenv/config";
import { syncMeetings } from "../lib/meetings-sync";

async function main() {
  const limitArg = process.argv[2];
  const perTickLimit = limitArg ? Number(limitArg) : undefined;
  if (limitArg && !Number.isFinite(perTickLimit)) {
    console.error(`invalid limit: ${limitArg}`);
    process.exit(1);
  }
  const t0 = Date.now();
  const r = await syncMeetings({ perTickLimit });
  console.log(`\n[meetings] done in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  console.log(
    `  meetings upserted: ${r.meetingsUpserted}  meeting_bills rows: ${r.billRowsUpserted}  fetchErrors: ${r.fetchErrors}`,
  );
  for (const chamber of ["house", "senate"] as const) {
    const c = r.perChamber[chamber];
    console.log(
      `  ${chamber}: collected=${c.collected} processed=${c.processed} cursor→${c.cursorEnd}`,
    );
  }
  if (r.deadlineHit) console.log("  (budget/deadline hit — re-run to continue)");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
