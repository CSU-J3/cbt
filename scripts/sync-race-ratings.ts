// Local CLI for the automated race-ratings sync (handoff 88). Run with
// `npm run sync:race-ratings`. Same code path the cron route invokes —
// both share runRaceRatingsSync from lib/race-ratings-sync.ts.
import "dotenv/config";
import { runRaceRatingsSync } from "../lib/race-ratings-sync";

runRaceRatingsSync().catch((err) => {
  console.error(err);
  process.exit(1);
});
