// Local CLI for the LDA lobbying sync (handoff 435). Same code path the cron
// route invokes in production — both share `syncLda` from lib/lda-sync.ts.
//
//   npm run sync:lda -- --backfill   # full current-Congress backfill (manual)
//   npm run sync:lda                 # incremental off the dt_posted cursor
//
// The backfill is thousands of paced requests (won't fit a 60s function),
// which is why it's a manual/local run, not a cron. Needs LDA_API_KEY in .env.
import "dotenv/config";
import { syncLda } from "../lib/lda-sync";

async function main() {
  const backfill = process.argv.includes("--backfill");
  if (!process.env.LDA_API_KEY) {
    console.error(
      "LDA_API_KEY not set — anonymous is throttled too hard to backfill. Register at https://lda.gov/api/register/",
    );
    process.exit(1);
  }
  const t0 = Date.now();
  const r = await syncLda({ backfill });
  console.log(
    `[lda] mode=${r.mode} filings=${r.filingsUpserted} activities=${r.activitiesUpserted} ` +
      `billLinks=${r.billLinksUpserted} pages=${r.pagesFetched} errors=${r.fetchErrors} ` +
      `throttled429=${r.throttled429} deadlineHit=${r.deadlineHit} ` +
      `(${((Date.now() - t0) / 1000).toFixed(1)}s)`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
