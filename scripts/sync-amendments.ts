// Local CLI for the amendments sync (handoff 447). Same code path the cron route
// invokes in production — both share `syncAmendments` from lib/amendments-sync.ts.
//
//   npm run sync:amendments -- --backfill   # full current-Congress backfill (manual)
//   npm run sync:amendments                 # incremental off the DB frontier
//
// The backfill is ~6,800 paced requests (list → detail per amendment, ~17 min —
// won't fit a 300s function), which is why it's a manual/local run, not a cron.
// After it, the cron only ever faces the incremental delta at the frontier.
// Needs CONGRESS_API_KEY in .env.
import "dotenv/config";
import { syncAmendments } from "../lib/amendments-sync";

async function main() {
  const backfill = process.argv.includes("--backfill");
  if (!process.env.CONGRESS_API_KEY) {
    console.error("CONGRESS_API_KEY not set — required for the Congress.gov /amendment endpoint.");
    process.exit(1);
  }
  const t0 = Date.now();
  const r = await syncAmendments({ backfill });
  console.log(
    `[amendments] mode=${r.mode} upserted=${r.upserted} listPages=${r.listPages} ` +
      `detailErrors=${r.detailErrors} throttled429=${r.throttled429} deadlineHit=${r.deadlineHit} ` +
      `frontier=${r.frontier} apiTotal=${r.apiTotal} (${((Date.now() - t0) / 1000).toFixed(1)}s)`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
