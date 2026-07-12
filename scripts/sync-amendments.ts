// Local CLI for the amendments sync (handoff 447). Same code path the cron route
// invokes in production — both share `syncAmendments` from lib/amendments-sync.ts.
//
//   npm run sync:amendments -- --backfill   # full current-Congress backfill (manual)
//   npm run sync:amendments -- --repair     # close offset-skip holes → stored == live count
//   npm run sync:amendments                 # incremental off the DB frontier
//
// The backfill is ~6,800 paced requests (list → detail per amendment, ~1.7h at
// cap-safe pacing — won't fit a 300s function), which is why it's a manual/local
// run, not a cron. After it, the cron only ever faces the incremental delta at the
// frontier. The list paginates by unstable updateDate order (no tiebreaker), so the
// backfill under-collects by a handful; run --repair once after a backfill to fill
// the holes deterministically (enumerate → diff → fetch missing by id). Needs
// CONGRESS_API_KEY in .env.
import "dotenv/config";
import { repairAmendments, syncAmendments } from "../lib/amendments-sync";

async function main() {
  const backfill = process.argv.includes("--backfill");
  const repair = process.argv.includes("--repair");
  if (!process.env.CONGRESS_API_KEY) {
    console.error("CONGRESS_API_KEY not set — required for the Congress.gov /amendment endpoint.");
    process.exit(1);
  }
  const t0 = Date.now();
  if (repair) {
    const r = await repairAmendments();
    console.log(
      `[amendments] repair liveCount=${r.liveCount} storedBefore=${r.storedBefore} storedAfter=${r.storedAfter} ` +
        `repaired=${r.repaired} errors=${r.errors} passes=${r.passes} complete=${r.complete} ` +
        `(${((Date.now() - t0) / 1000).toFixed(1)}s)`,
    );
    process.exit(r.complete ? 0 : 1);
  }
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
