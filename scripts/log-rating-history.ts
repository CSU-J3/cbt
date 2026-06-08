// HO 220: local CLI for the rating-history change-detect logger — the same
// logic /api/cron/rating-history calls, runnable by hand like sync:news /
// sync:trades. First run logs the baseline (347 rows today); re-running the
// same day logs zero. Run: `npm run log:rating-history`.
import "dotenv/config";
import { getDb } from "../lib/db";
import { logRatingHistory } from "../lib/rating-history";

async function main() {
  const r = await logRatingHistory(getDb());
  console.log(`logged: ${r.logged} / unchanged: ${r.unchanged} / total: ${r.total}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
