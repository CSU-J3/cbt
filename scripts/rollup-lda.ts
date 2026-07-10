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
  computeBillDrill,
  computeIssueRollup,
  computeTopFirms,
  readLdaTables,
  uncappedLdaClient,
  writeLdaBillDrill,
  writeLdaRollup,
  writeLdaTopFirms,
} from "../lib/lda-rollup";

async function main() {
  const db = uncappedLdaClient();
  const t0 = Date.now();
  // HO 440 — one read feeds both the issue rollup and the per-bill drill (same
  // as the cron), so a manual run populates BOTH dashboard_state blobs at once.
  const generatedAt = new Date().toISOString();
  const tables = await readLdaTables(db);
  const rollup = computeIssueRollup(tables, generatedAt);
  await writeLdaRollup(db, rollup);
  const billBlob = computeBillDrill(tables, generatedAt);
  await writeLdaBillDrill(db, billBlob);
  const firmsBlob = computeTopFirms(tables, generatedAt);
  await writeLdaTopFirms(db, firmsBlob);
  db.close();
  const { stats } = rollup;
  console.log(
    `[lda:rollup] wrote blobs in ${Date.now() - t0}ms — ` +
      `${rollup.issues.length} issue codes, ${Object.keys(rollup.drill).length} drills, ` +
      `${Object.keys(billBlob.drill).length} bill drills, ` +
      `${firmsBlob.firms.length} top firms of ${firmsBlob.totalRegistrants} registrants; ` +
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
