// Local CLI for the nominations sync (handoff 455). Same code path the cron route
// invokes in production — both share `syncNominations` from lib/nominations-sync.ts.
//
//   npm run sync:nominations -- --backfill   # full current-Congress backfill (manual)
//   npm run sync:nominations -- --repair     # close offset-skip holes → stored == live count
//   npm run sync:nominations                 # incremental off the DB frontier
//
// LIST-ONLY (HO 454): no per-PN detail fetch, so the backfill is ~1,884 rows over
// ~8 list pages — minutes, not the amendments ~1.7h. Run --repair once after a
// backfill to close any offset-skip holes the unstable updateDate-order pagination
// opens (enumerate → diff → upsert missing directly from the list item). Needs
// CONGRESS_API_KEY in .env.
import "dotenv/config";
import { repairNominations, syncNominations } from "../lib/nominations-sync";

async function main() {
  const backfill = process.argv.includes("--backfill");
  const repair = process.argv.includes("--repair");
  if (!process.env.CONGRESS_API_KEY) {
    console.error("CONGRESS_API_KEY not set — required for the Congress.gov /nomination endpoint.");
    process.exit(1);
  }
  const t0 = Date.now();
  if (repair) {
    const r = await repairNominations();
    console.log(
      `[nominations] repair liveCount=${r.liveCount} storedBefore=${r.storedBefore} storedAfter=${r.storedAfter} ` +
        `repaired=${r.repaired} passes=${r.passes} complete=${r.complete} ` +
        `(${((Date.now() - t0) / 1000).toFixed(1)}s)`,
    );
    process.exit(r.complete ? 0 : 1);
  }
  const r = await syncNominations({ backfill });
  console.log(
    `[nominations] mode=${r.mode} upserted=${r.upserted} listPages=${r.listPages} ` +
      `throttled429=${r.throttled429} deadlineHit=${r.deadlineHit} dispositionResidual=${r.dispositionResidual} ` +
      `frontier=${r.frontier} apiTotal=${r.apiTotal} (${((Date.now() - t0) / 1000).toFixed(1)}s)`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
