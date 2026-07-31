// HO 577 repair — correct the 48 clobbered house primary_date rows (STEP 0: LA/GA/SC).
//
// DATE-ONLY: this touches primaries.primary_date / runoff_date and NOTHING in
// primary_candidates — GA's 28 rows are settled (past-dated + recorded June shares), and
// the tick's roster delete-rebuild would churn those decided results, so we correct the
// date surgically instead of letting the sync self-heal.
//
// SCOPE: every SELECT and UPDATE carries `id NOT LIKE '%-special-%'` — the same filter
// Part 1's calByState uses. Without it, `state + chamber='house'` would sweep a house
// SPECIAL to the regular date (GA/SC) or NULL it (LA). Constrain the write to exactly its
// intent; the dry-run SELECTs and the apply UPDATEs use identical predicates so the
// preview and the write agree.
//
// Correct date is DERIVED from the clean regular statewide senate row (identical source
// to Part 1's calByState), not hardcoded — GA 2026-05-19, SC 2026-06-09 (both externally
// verified against the public calendar). LA is the suspended-House carve-out: its 6 house
// rows are NULLed (2026 U.S. House primary suspended by EO; 06-27 renders a completed
// contest that never happened — a false assertion, so we replace it with absence).
//
// Idempotent. DRY-RUN by default; pass --apply to write. Run AFTER Part 1 is deployed
// (else the old cron re-clobbers) and BEFORE Part 2's guard (a guard over settled rows
// would freeze the wrong date).
import "dotenv/config";
import { getDb } from "@/lib/db";

type DB = ReturnType<typeof getDb>;
const APPLY = process.argv.includes("--apply");
const nowIso = new Date().toISOString();

// Clean statewide date = Part 1's source (regular senate row).
async function cleanDate(db: DB, state: string): Promise<string | null> {
  const rs = await db.execute({
    sql: `SELECT MAX(primary_date) AS d FROM primaries
           WHERE state = ? AND election_round = 'primary' AND district IS NULL
             AND id NOT LIKE '%-special-%' AND primary_date IS NOT NULL`,
    args: [state],
  });
  const d = rs.rows[0]?.d;
  return d == null ? null : String(d);
}

// GA roster fingerprint — total candidate rows + distinct ids carrying a recorded share.
// A date-only UPDATE must leave BOTH unchanged. Captured BEFORE and AFTER so the check is
// an instrument (reads differently if rosters were touched), not an after-only tautology.
async function gaRoster(db: DB): Promise<{ rows: number; withShare: number }> {
  const rs = await db.execute(
    `SELECT COUNT(*) AS rows,
            COUNT(DISTINCT CASE WHEN vote_pct IS NOT NULL THEN primary_id END) AS withShare
       FROM primary_candidates WHERE primary_id LIKE 'house-GA-%'`,
  );
  return { rows: Number(rs.rows[0]!.rows), withShare: Number(rs.rows[0]!.withShare) };
}

async function main() {
  const db = getDb();
  console.log(`HO 577 house date repair — ${APPLY ? "APPLYING" : "DRY RUN (pass --apply to write)"}\n`);

  const rosterBefore = await gaRoster(db);

  // ── GA, SC — repair to the clean statewide date (date-only, non-special only) ─
  for (const st of ["GA", "SC"] as const) {
    const clean = await cleanDate(db, st);
    if (!clean) {
      console.log(`  ${st}: no clean statewide date found — SKIP (investigate).`);
      continue;
    }
    const off = await db.execute({
      sql: `SELECT id, primary_date FROM primaries
             WHERE state = ? AND chamber = 'house' AND id NOT LIKE '%-special-%'
               AND (primary_date IS NULL OR primary_date <> ?)
             ORDER BY id`,
      args: [st, clean],
    });
    console.log(`  ${st}: clean=${clean} · ${off.rows.length} house row(s) off-date${off.rows.length ? "" : " (nothing to do)"}`);
    for (const r of off.rows) console.log(`      ${r.id}: ${r.primary_date} → ${clean}`);
    if (APPLY && off.rows.length) {
      await db.execute({
        sql: `UPDATE primaries SET primary_date = ?, updated_at = ?
               WHERE state = ? AND chamber = 'house' AND id NOT LIKE '%-special-%'
                 AND (primary_date IS NULL OR primary_date <> ?)`,
        args: [clean, nowIso, st, clean],
      });
    }
  }

  // ── LA — suspended House: NULL primary_date + runoff_date (non-special only) ──
  {
    const off = await db.execute(
      `SELECT id, primary_date, runoff_date FROM primaries
        WHERE state = 'LA' AND chamber = 'house' AND id NOT LIKE '%-special-%'
          AND (primary_date IS NOT NULL OR runoff_date IS NOT NULL)
        ORDER BY id`,
    );
    console.log(`  LA: ${off.rows.length} house row(s) to NULL (suspended House primary)`);
    for (const r of off.rows) console.log(`      ${r.id}: date=${r.primary_date} runoff=${r.runoff_date} → NULL/NULL`);
    if (APPLY && off.rows.length) {
      await db.execute({
        sql: `UPDATE primaries SET primary_date = NULL, runoff_date = NULL, updated_at = ?
               WHERE state = 'LA' AND chamber = 'house' AND id NOT LIKE '%-special-%'`,
        args: [nowIso],
      });
    }
  }

  // ── Verification ────────────────────────────────────────────────────────────
  console.log("\n=== verification ===");
  for (const st of ["GA", "SC"] as const) {
    const clean = await cleanDate(db, st);
    const off = await db.execute({
      sql: `SELECT COUNT(*) AS n FROM primaries WHERE state = ? AND chamber = 'house'
             AND id NOT LIKE '%-special-%' AND (primary_date IS NULL OR primary_date <> ?)`,
      args: [st, clean],
    });
    console.log(`  ${st}: off-date house rows = ${Number(off.rows[0]!.n)} (0 = converged; clean=${clean})`);
  }
  const laBad = await db.execute(
    `SELECT COUNT(*) AS n FROM primaries WHERE state = 'LA' AND chamber = 'house'
       AND id NOT LIKE '%-special-%' AND primary_date IS NOT NULL`,
  );
  console.log(`  LA: house rows still carrying a primary_date = ${Number(laBad.rows[0]!.n)} (0 = suppressed)`);

  const rosterAfter = await gaRoster(db);
  const rosterSame =
    rosterBefore.rows === rosterAfter.rows && rosterBefore.withShare === rosterAfter.withShare;
  console.log(
    `  GA roster before→after: rows ${rosterBefore.rows}→${rosterAfter.rows}, ` +
      `withShare ${rosterBefore.withShare}→${rosterAfter.withShare} → ` +
      `${rosterSame ? "UNCHANGED (date-only UPDATE left primary_candidates alone)" : "CHANGED — BUG: a date-only repair must not touch rosters"}`,
  );
  if (!rosterSame) process.exitCode = 1;
}

main().catch((e) => {
  console.error(String(e));
  process.exitCode = 1;
});
