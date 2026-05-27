// HO 143 one-time backfill. Walks every 119th bill with committees.count>0
// in raw_json and pulls /bill/{congress}/{type}/{number}/committees from
// Congress.gov, upserting committee_bills rows. Resumable via the same
// `committee_bills_sync_cursor` dashboard_state row the cron uses — Ctrl-C
// is safe; re-running picks up where the cursor left off.
//
// Run: `npx tsx scripts/backfill-committee-bills.ts`
// Expected time: ~60-90 minutes at ~300ms per Congress.gov call for ~16K
// bills. Delete this script after the run finishes; cron handles steady
// state via /api/cron/committees (HO 143).
import "dotenv/config";
import { syncCommitteeBills } from "../lib/committees-sync";

const BATCH_SIZE = 500;

async function main() {
  console.log("[backfill] starting committee_bills backfill, batch size", BATCH_SIZE);
  let total = 0;
  let totalRows = 0;
  let totalErrors = 0;
  let batches = 0;
  const t0 = Date.now();
  while (true) {
    const result = await syncCommitteeBills({ perTickLimit: BATCH_SIZE });
    batches++;
    total += result.billsProcessed;
    totalRows += result.rowsUpserted;
    totalErrors += result.fetchErrors;
    const elapsed = Math.round((Date.now() - t0) / 1000);
    console.log(
      `[backfill] batch ${batches}: bills=${result.billsProcessed} rows=${result.rowsUpserted} errors=${result.fetchErrors} cursor=${result.cursorEnd} | totals: bills=${total} rows=${totalRows} errors=${totalErrors} elapsed=${elapsed}s`,
    );
    if (result.billsProcessed === 0) break;
  }
  const elapsed = Math.round((Date.now() - t0) / 1000);
  console.log(
    `[backfill] done — ${total} bills processed, ${totalRows} committee_bills rows upserted, ${totalErrors} fetch errors, ${elapsed}s total`,
  );
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
