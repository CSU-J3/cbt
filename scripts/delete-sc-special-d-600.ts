// HO 600 §3 — remove the phantom `senate-SC-2026-special-D` row.
//
// WHY. South Carolina's August 11 special primary is held under S.C. Code
// §7-11-55 after the death of the Republican nominee for U.S. Senate. Because
// that candidate had general-election opposition, the special filing period was
// open to REPUBLICAN CANDIDATES ONLY — there is no Democratic contest on August
// 11, and voters who cast a June Democratic primary ballot are barred from it.
// The seeded `-special-D` row therefore asserts a contest that does not exist,
// and it is not dormant: `election_round='primary'` puts it into
// getPrimaryCalendar -> PrimaryTimeline and getDashboardPrimaries.
//
// SCOPE. ONE literal id. No `LIKE '%-special-%'` glob (HO 577 scoping
// discipline). `senate-SC-2026-{D,R}` — the settled June rows — are a different
// id set and are never touched; neither is `senate-SC-2026-special-R`, which is
// the real contest.
//
// MECHANISM. scripts/seed-special-primaries.ts is a pure INSERT ... ON CONFLICT
// DO UPDATE with NO delete pass, so removing the entry from
// data/special-primary-seeds/sc-2026-senate.json does NOT remove the live row —
// and deleting the live row alone would let the next `seed:special-primaries`
// run recreate it. BOTH halves are required, and they ship in one commit.
//
// GATE. §3 was authorized on M1 confirming the row exists with ZERO candidates.
// That gate is enforced here at runtime rather than trusted to memory: a
// non-empty roster means the premise moved and this script REFUSES, because a
// roster on this id would be evidence worth reading before anything is deleted.
//
//   npx tsx scripts/delete-sc-special-d-600.ts          # dry run (default)
//   npx tsx scripts/delete-sc-special-d-600.ts --commit # perform the delete
import "dotenv/config";
import { getDb } from "../lib/db";

const TARGET = "senate-SC-2026-special-D";
const NEVER_TOUCH = [
  "senate-SC-2026-D",
  "senate-SC-2026-R",
  "senate-SC-2026-special-R",
];

async function main() {
  const commit = process.argv.includes("--commit");
  const db = getDb();

  console.log(`HO 600 §3 — delete ${TARGET}`);
  console.log(`mode: ${commit ? "COMMIT" : "DRY RUN (pass --commit to write)"}\n`);

  // ---- print before delete: the row -------------------------------------
  const rowRs = await db.execute({
    sql: `SELECT id, state, district, chamber, party, primary_date, runoff_date,
                 primary_type, race_id, election_round, updated_at
            FROM primaries WHERE id = ?`,
    args: [TARGET],
  });
  if (rowRs.rows.length === 0) {
    console.log(`Row ${TARGET} not present — nothing to delete. (Idempotent re-run.)`);
    return;
  }
  const row = rowRs.rows[0]!;
  console.log("primaries row to delete:");
  for (const [k, v] of Object.entries(row)) {
    console.log(`    ${k.padEnd(16)} = ${JSON.stringify(v)}`);
  }

  // ---- print before delete: dependents -----------------------------------
  const depRs = await db.execute({
    sql: `SELECT id, name, party, incumbent, bioguide_id, status, vote_pct, updated_at
            FROM primary_candidates WHERE primary_id = ? ORDER BY name`,
    args: [TARGET],
  });
  console.log(`\nprimary_candidates dependents: ${depRs.rows.length}`);
  for (const d of depRs.rows) {
    console.log(
      `    ${String(d.name).padEnd(28)} party=${String(d.party)} status=${String(d.status)} pct=${String(d.vote_pct)}`,
    );
  }

  // ---- the gate ----------------------------------------------------------
  if (depRs.rows.length !== 0) {
    console.error(
      `\nREFUSING: ${TARGET} carries ${depRs.rows.length} candidate row(s).\n` +
        `§3 was authorized on a ZERO-candidate row. A roster here means the premise\n` +
        `moved — read it before deleting anything.`,
    );
    process.exit(1);
  }

  // ---- prove the blast radius is one row ---------------------------------
  const siblings = await db.execute({
    sql: `SELECT id, primary_date, election_round,
                 (SELECT COUNT(*) FROM primary_candidates pc WHERE pc.primary_id = p.id) AS n
            FROM primaries p WHERE p.id IN (?, ?, ?) ORDER BY p.id`,
    args: NEVER_TOUCH,
  });
  console.log(`\nrows that MUST survive unchanged:`);
  for (const s of siblings.rows) {
    console.log(
      `    ${String(s.id).padEnd(26)} ${String(s.primary_date)} round=${String(s.election_round)} candidates=${String(s.n)}`,
    );
  }

  if (!commit) {
    console.log(`\nDRY RUN — no writes performed. Re-run with --commit to delete.`);
    return;
  }

  // ---- delete: dependents first, then the row, both by literal id --------
  const delDeps = await db.execute({
    sql: `DELETE FROM primary_candidates WHERE primary_id = ?`,
    args: [TARGET],
  });
  const delRow = await db.execute({
    sql: `DELETE FROM primaries WHERE id = ?`,
    args: [TARGET],
  });
  console.log(
    `\ndeleted: primary_candidates=${delDeps.rowsAffected} primaries=${delRow.rowsAffected}`,
  );

  // ---- verify ------------------------------------------------------------
  const after = await db.execute({
    sql: `SELECT id, primary_date, election_round,
                 (SELECT COUNT(*) FROM primary_candidates pc WHERE pc.primary_id = p.id) AS n
            FROM primaries p
           WHERE p.state = 'SC' AND p.chamber = 'senate'
           ORDER BY p.id`,
    args: [],
  });
  console.log(`\nSC senate primaries rows after (${after.rows.length}):`);
  for (const r of after.rows) {
    console.log(
      `    ${String(r.id).padEnd(26)} ${String(r.primary_date)} round=${String(r.election_round)} candidates=${String(r.n)}`,
    );
  }
  const gone = after.rows.every((r) => String(r.id) !== TARGET);
  const survived = NEVER_TOUCH.every((id) =>
    after.rows.some((r) => String(r.id) === id),
  );
  console.log(
    `\n${TARGET} removed: ${gone}   sibling rows intact: ${survived}` +
      `\n(the primaries helpers are uncached plain db.execute, so there is no tag to flush)`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
