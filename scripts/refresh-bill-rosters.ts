// HO 676 — the manual entry to the roster refresh. Runs the SAME
// refreshBillRosters() the /api/cron/bill-rosters cron runs; this file adds a
// census before and after, and nothing else.
//
// WHAT THIS WRITES, exactly (and only with --write):
//   bill_cosponsors      — one row per (bill_id, bioguide_id)
//   bill_related_bills   — one row per (bill_id, related_bill_id, relationship_type)
//   bill_roster_state    — the watermark, one row per bill
//   bills.cosponsor_count — THAT COLUMN ONLY (HO 677 gave it this owner; the
//                           sync no longer writes it). No other column of
//                           `bills` is touched.
//
// READ-ONLY BY DEFAULT. A bare invocation and `--check` select, fetch and diff,
// and report what WOULD be written, touching nothing. `--write` is required to
// mutate. A flag you must remember in order NOT to write is a flag that will be
// forgotten exactly once.
//
//   npm run refresh:bill-rosters                                  # dry run, 30 bills
//   npm run refresh:bill-rosters -- --cap 120                     # dry run, 120
//   npm run refresh:bill-rosters -- --cap 30 --write
//   npm run refresh:bill-rosters -- --bills 119-s-5354,119-hr-452
//   npm run refresh:bill-rosters -- --bills 119-s-5354 --write
import "dotenv/config";
import { refreshBillRosters } from "../lib/bill-rosters-refresh";
import { getDb } from "../lib/db";

const argv = process.argv.slice(2);
const has = (f: string) => argv.includes(f);
const val = (f: string): string | null => {
  const i = argv.indexOf(f);
  if (i < 0) return null;
  return argv[i + 1] ?? null;
};

const WRITE = has("--write");
const CAP = val("--cap") ? Number(val("--cap")) : 30;
const BILLS = val("--bills")?.split(",").map((s) => s.trim()).filter(Boolean) ?? undefined;

async function census(label: string) {
  const db = getDb();
  const r = await db.execute(`
    SELECT (SELECT COUNT(*) FROM bill_cosponsors) AS cos_rows,
           (SELECT COUNT(DISTINCT bill_id) FROM bill_cosponsors) AS cos_bills,
           (SELECT COUNT(*) FROM bill_related_bills) AS rel_rows,
           (SELECT COUNT(DISTINCT bill_id) FROM bill_related_bills) AS rel_bills,
           (SELECT COUNT(*) FROM bill_roster_state) AS state_rows,
           (SELECT COUNT(*) FROM bill_roster_state WHERE changed_at IS NOT NULL) AS state_changed,
           (SELECT MIN(checked_at) FROM bill_roster_state) AS oldest_check,
           (SELECT MAX(checked_at) FROM bill_roster_state) AS newest_check`);
  const x = r.rows[0];
  console.log(`\n== ${label} ==`);
  console.log(`  bill_cosponsors    ${x?.cos_rows} rows / ${x?.cos_bills} bills`);
  console.log(`  bill_related_bills ${x?.rel_rows} rows / ${x?.rel_bills} bills`);
  console.log(`  bill_roster_state  ${x?.state_rows} rows (${x?.state_changed} with changed_at)`);
  console.log(`  checked_at range   ${x?.oldest_check} .. ${x?.newest_check}`);
}

async function main() {
  console.log(WRITE ? "MODE: --write (WILL MUTATE)" : "MODE: check (no writes)");
  console.log(BILLS ? `named slice: ${BILLS.length} bills` : `cap: ${CAP}`);

  // READ-BACK needs a before as well as an after: a write instrument that does
  // not read back is not an instrument (docs/method.md, Gates), and a single
  // after-reading cannot show a delta of zero from a delta it never had.
  await census("BEFORE");
  const r = await refreshBillRosters({ write: WRITE, cap: CAP, billIds: BILLS });

  console.log("\n== RESULT ==");
  console.log(`mode                  : ${r.mode}`);
  console.log(`selected              : ${r.selected}  (never-checked ${r.byTrigger["never-checked"]} · count-ahead ${r.byTrigger["count-ahead"]} · sweep ${r.byTrigger.sweep})`);
  console.log(`bills fetched         : ${r.fetched}`);
  console.log(`API requests spent    : ${r.requests}`);
  console.log(`bills CHANGED+written : ${r.changedBills}   <- the flush signal`);
  console.log(`bills WOULD change    : ${r.wouldChangeBills}  (check mode only)`);
  console.log(`cosponsor rows written: ${r.cosponsorRowsWritten} (deleted ${r.cosponsorRowsDeleted})`);
  console.log(`related rows written  : ${r.relatedRowsWritten} (deleted ${r.relatedRowsDeleted})`);
  console.log(`cosponsor_count fixed  : ${r.countsWritten}   <- HO 677: this module owns that column`);
  console.log(`watermarks stamped    : ${r.stamped}`);
  console.log(`deferred (unstamped)  : ${r.deferred}`);
  console.log(`empty-payload skips   : ${r.emptyPayloadSkips.length}${r.emptyPayloadSkips.length ? ` (${r.emptyPayloadSkips.slice(0, 10).join(", ")})` : ""}`);
  console.log(`deadline hit          : ${r.deadlineHit}`);
  if (r.errors.length) {
    console.log(`errors: ${r.errors.length}`);
    for (const e of r.errors.slice(0, 10)) console.log(`  ${e}`);
  }

  await census("AFTER (actual table state)");
  if (!WRITE) console.log("(check mode — this run wrote nothing; the two censuses must match)");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
