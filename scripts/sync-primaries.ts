// Primary tracker CLI (handoffs 91-96). Thin wrapper — all logic lives in
// lib/primaries-sync.ts so the /api/cron/primaries route (handoff 97) can
// share it. Passes selected by argv:
//   (default)          calendar (all 50 states) + Senate candidate rosters.
//   --region=<region>  House candidate rosters for one region.
//   --rematch          re-run the House incumbent matcher; no scraping.
// `npm run sync:primaries` runs the default pass; `npm run sync:house-primaries
// -- --region=northeast` runs the House pass; `npm run sync:rematch` re-runs
// the matcher.
import "dotenv/config";
import { runPrimariesCli } from "../lib/primaries-sync";

runPrimariesCli(process.argv).catch((err) => {
  console.error(err);
  process.exit(1);
});
