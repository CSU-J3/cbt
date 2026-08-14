// HO 577 Part 2 falsification — prove the House settled-row guard actually FIRES.
//
// An untriggered guard reads the same green as a broken one, so this drives the REAL
// syncHouseDistricts against a genuinely settled district and asserts the guard skipped
// the write. Run AFTER the repair (so GA house rows are settled at the CORRECT 05-19);
// safe to run with the local guard code against the prod DB before Part 2 is deployed.
//
// Why it cannot corrupt: GA-01 is a PAST primary — Ballotpedia serves static June
// results — so even if the guard were broken, the delete-rebuild would reinsert the same
// rows. The test asserts the guard PREVENTED that rebuild (candidate updated_at unchanged)
// and that the date is untouched. Read-first snapshot, one scrape, no --apply flag needed
// (the whole point is that a working guard writes nothing here).
//
// HO 661 — RECONCILED TO THE NEW PREDICATE. `isSettled` no longer settles on a recorded
// SHARE; it settles on DECIDED (a candidate marked status='winner') or EXPIRED (older than
// SETTLE_WINDOW_DAYS). An instrument selecting its exemplars by the retired definition
// would pick rows the guard no longer freezes and read FAIL as though the guard broke —
// the lied-twice family. The precondition below therefore asserts CALLED, not scored.
// GA-01 survives the change on its own merits (D carries 2 winner rows, R carries 1,
// measured 2026-08-14), so the targets are unchanged and the test is still non-vacuous —
// and it is genuinely-settled under the new rule by DECISION, not merely by age.
import "dotenv/config";
import { getDb } from "@/lib/db";
import { settleWindowFloor, syncHouseDistricts } from "@/lib/primaries-sync";

const NOW = new Date().toISOString();
const TODAY = NOW.slice(0, 10);
const FLOOR = settleWindowFloor(NOW); // HO 661 — the re-check window floor.
const IDS = ["house-GA-01-2026-D", "house-GA-01-2026-R"];

async function snap(db: ReturnType<typeof getDb>) {
  const dates = await db.execute({
    sql: `SELECT id, primary_date FROM primaries WHERE id IN (?, ?)`,
    args: IDS,
  });
  const roster = await db.execute({
    sql: `SELECT primary_id, COUNT(*) AS n, MAX(updated_at) AS last
            FROM primary_candidates WHERE primary_id IN (?, ?) GROUP BY primary_id`,
    args: IDS,
  });
  return {
    dates: Object.fromEntries(dates.rows.map((r) => [String(r.id), String(r.primary_date)])),
    roster: Object.fromEntries(
      roster.rows.map((r) => [String(r.primary_id), `${Number(r.n)}@${String(r.last)}`]),
    ),
  };
}

async function main() {
  const db = getDb();
  console.log(`HO 577 guard falsification. today=${TODAY} windowFloor=${FLOOR}\n`);

  // Precondition: the target rows must be SETTLED — past-dated AND (called OR expired) —
  // else the test is vacuous (the guard would legitimately not fire). isSettled predicate
  // inline; mirrors lib/primaries-sync.ts::isSettled as of HO 661. `called` is printed
  // beside `expired` deliberately: a row that is settled ONLY by age proves the window
  // expired, not that the guard freezes a decided contest, so the assertion below demands
  // CALLED and treats age as context.
  const pre = await db.execute({
    sql: `SELECT id, primary_date < ? AS past, primary_date < ? AS expired,
                 EXISTS(SELECT 1 FROM primary_candidates pc WHERE pc.primary_id=primaries.id AND pc.status='winner') AS called
            FROM primaries WHERE id IN (?, ?)`,
    args: [TODAY, FLOOR, ...IDS],
  });
  const settled = pre.rows.every((r) => Number(r.past) === 1 && Number(r.called) === 1);
  console.log(`  precondition — all target rows settled by DECISION: ${settled}`);
  for (const r of pre.rows)
    console.log(`    ${r.id}: past=${r.past} called=${r.called} (expired=${r.expired})`);
  if (!settled) {
    console.log("\n  ABORT — targets not settled (run the repair first). Test would be vacuous.");
    process.exitCode = 1;
    return;
  }

  const before = await snap(db);
  console.log(`\n  before: ${JSON.stringify(before)}`);

  // Drive the REAL sync for exactly GA district 1. The guard must skip both settled ids.
  const summary = await syncHouseDistricts([{ state: "GA", district: 1 }], "falsify-577");

  const after = await snap(db);
  console.log(`  after:  ${JSON.stringify(after)}`);
  console.log(`  settledSkipped: ${JSON.stringify(summary.settledSkipped)}`);

  // Assertions.
  const skippedBoth = IDS.every((id) => summary.settledSkipped.includes(id));
  const dateUnchanged = IDS.every((id) => before.dates[id] === after.dates[id]);
  const rosterUnchanged = IDS.every((id) => before.roster[id] === after.roster[id]);

  console.log("\n=== result ===");
  console.log(`  guard skipped both settled ids:        ${skippedBoth ? "PASS" : "FAIL"}`);
  console.log(`  primary_date unchanged (no clobber):   ${dateUnchanged ? "PASS" : "FAIL"}`);
  console.log(`  roster untouched (no delete-rebuild):  ${rosterUnchanged ? "PASS" : "FAIL"}`);
  const ok = skippedBoth && dateUnchanged && rosterUnchanged;
  console.log(`\n  GUARD FALSIFICATION: ${ok ? "PASS — the guard fires and refuses the write" : "FAIL — investigate"}`);
  if (!ok) process.exitCode = 1;
}

main().catch((e) => {
  console.error(String(e));
  process.exitCode = 1;
});
