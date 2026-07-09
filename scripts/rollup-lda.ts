// HO 437 — recompute the /lobbying rollup blob on demand (dashboard_state
// `lda_lobbying_rollup`). Runs the SAME computeLdaRollup the daily cron runs, via
// the same UNCAPPED client, so the historical backfill can populate the surface
// once immediately instead of waiting for the first cron tick.
//
//   npm run lda:rollup
//
// A CLI can't revalidateTag (Next-runtime only — the Data-Cache-persists gotcha),
// so this only writes the blob. getLobbyingRollup's 1h TTL (or the next cron's
// revalidateTag("lda")) surfaces it; force it now with
//   curl -X POST -H "Authorization: Bearer $CRON_SECRET" "$BASE/api/revalidate?tag=lda"
import "dotenv/config";
import {
  computeLdaRollup,
  uncappedLdaClient,
  writeLdaRollup,
} from "../lib/lda-rollup";

async function main() {
  const db = uncappedLdaClient();
  const t0 = Date.now();
  const rollup = await computeLdaRollup(db, new Date().toISOString());
  await writeLdaRollup(db, rollup);
  db.close();
  const { stats } = rollup;
  console.log(
    `[lda:rollup] wrote blob in ${Date.now() - t0}ms — ` +
      `${rollup.issues.length} issue codes, ${Object.keys(rollup.drill).length} drills; ` +
      `stats: ${stats.filings} filings / ${stats.activities} activities / ` +
      `${stats.registrants} registrants / ${stats.clients} clients / ` +
      `${stats.billLinkedPct.toFixed(1)}% bill-linked`,
  );
  process.exit(0);
}

main().catch((e) => {
  console.error(`[lda:rollup] failed: ${(e as Error).message}`);
  process.exit(1);
});
