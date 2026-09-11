// HO 711 — the retraction pass. ONE-SHOT, committed as the record of what was
// done, because HO 412 did the equivalent by hand and left no artifact: its
// commit message names S-CA-2026 and S-NY-2026, and the only `DELETE FROM races`
// in that diff is the footgun it was removing.
//
// DEFAULT IS DRY-RUN. Pass --write to execute. Every statement re-checks its own
// dependents IMMEDIATELY BEFORE running, not from the table below, because the
// table was read at STEP 0 and the world has moved since (it moved twice in this
// HO alone — see the NULL list).
//
//   npx tsx --env-file=.env scripts/oneshot/711-retract-phantom-races.ts
//   npx tsx --env-file=.env scripts/oneshot/711-retract-phantom-races.ts --write
//
// ─── THE HALT TABLE, as confirmed by Corey 2026-09-10 ────────────────────────
//
// DELETE · 13 phantoms. A race row for a cycle nobody stands in.
//   S-FL-2028 S-OH-2028   Rubio and Vance; both left for the executive branch
//                         and the seats' current holders stand at 2026
//   S-MN-2028 S-MS-2028   minted while those members transiently carried 2028;
//   S-NE-2028 S-NJ-2028   all four belong to other Senate classes
//   S-AK-2030 S-OR-2030   same shape one cycle out
//   S-SC-2030             SC has no Class 1 seat, so no SC senator stands at
//                         2030 at all. The row's stored incumbent is G000359,
//                         LINDSEY Graham, is_current = 0 — a DEPARTED row, not
//                         the sitting senator. SC's two seats are held by
//                         Darline Graham (G000608, class 2, 2026) and Tim Scott
//                         (S001184, class 3, 2028): two Grahams, and the bare
//                         surname read as the sitting one.
//   CA-01-2027 GA-14-2027 the House term-math phantoms: four members seated by
//   NJ-11-2027 TX-18-2027 2026 specials carried next_election_year = 2027, a
//                         year with no House election (fixed in this HO, so
//                         these rows no longer match their own incumbents)
//
// DELETE · 6 residue rows at a past cycle. Minted by the sole writer from the
// same even-start drift one cycle earlier; no primaries row backs them, no
// member alive today re-derives them, and after this HO's term-math fix the
// writer can never produce the shape again. Zero renders link them.
//   CA-01-2025 CA-14-2025 FL-20-2025 GA-13-2025 GA-14-2025 TX-23-2025
//
// NULL · vacant seats at a regular cycle. `incumbent_bioguide_id = NULL` is the
// schema's own vacancy meaning and /race/[id] already renders the placeholder. A
// departed name rendered as the incumbent is the false claim; losing it from the
// race row is a recoverable loss — who vacated is still on the member's own row.
//   COMPUTED AT RUN TIME, not listed: Corey confirmed four (CA-14, FL-20, GA-13,
//   TX-23), and by execution two of them had HEALED — the sync:members run this
//   HO mandates brought in Aisha Wahab (CA-14) and Everton Blair Jr. (GA-13),
//   who now hold those seats. Nulling a seat with a sitting incumbent would be
//   wrong, so the pass derives the list instead of trusting the snapshot.
//
// KEEP · S-FL-2026 S-OH-2026. Rated, market-linked, and the rows HO 710's seat
// outlook links to as its TBD deciding contests. The handoff's original phantom
// predicate flagged them; this is the near-miss the closure table caught.
import "dotenv/config";
import { getDb } from "../../lib/db";
import { auditRaceRows, formatRaceRowAudit } from "../../lib/race-row-audit";

const WRITE = process.argv.includes("--write");

const PHANTOMS = [
  "S-FL-2028", "S-OH-2028", "S-MN-2028", "S-MS-2028", "S-NE-2028", "S-NJ-2028",
  "S-AK-2030", "S-OR-2030", "S-SC-2030",
  "CA-01-2027", "GA-14-2027", "NJ-11-2027", "TX-18-2027",
];

const RESIDUE = [
  "CA-01-2025", "CA-14-2025", "FL-20-2025", "GA-13-2025", "GA-14-2025",
  "TX-23-2025",
];

// Every table carrying a race_id, per the HO 412 §2 enumeration plus anything
// added since. A row is only deleted when all of these read zero FOR IT.
const DEP_TABLES = [
  "race_ratings", "race_candidates", "kalshi_odds", "polymarket_odds",
  "rating_history", "primaries", "pac_ie_spending",
];

const db = getDb();
const line = (s = "") => console.log(s);

async function dependents(id: string): Promise<{ total: number; detail: string }> {
  const parts: string[] = [];
  let total = 0;
  for (const t of DEP_TABLES) {
    const q = await db.execute({
      sql: `SELECT COUNT(*) n FROM ${t} WHERE race_id = ?`,
      args: [id],
    });
    const n = Number(q.rows[0]!.n);
    total += n;
    if (n) parts.push(`${t}=${n}`);
  }
  return { total, detail: parts.join(" ") || "none" };
}

async function main() {
  line(`MODE: ${WRITE ? "WRITE" : "DRY RUN (pass --write to execute)"}`);
  line();

  // The instrument must be able to report a non-zero before any of its zeros are
  // believed — a bare catch or a mistyped table name would make every row look
  // clean. S-FL-2026 is a KEEP row and carries real dependents.
  const ctl = await dependents("S-FL-2026");
  line(`CONTROL  S-FL-2026 dependents: ${ctl.detail} (total ${ctl.total})`);
  if (ctl.total === 0) {
    line("CONTROL READ ZERO — the dependents instrument is not working. Aborting.");
    process.exitCode = 1;
    return;
  }
  line("control is non-zero, so a zero below is a reading.");
  line();

  let deleted = 0;
  let held = 0;
  for (const [label, ids] of [["PHANTOM", PHANTOMS], ["RESIDUE", RESIDUE]] as const) {
    line(`──── ${label} (${ids.length}) ────`);
    for (const id of ids) {
      const d = await dependents(id);
      if (d.total > 0) {
        line(`  HOLD   ${id.padEnd(12)} dependents: ${d.detail} — NOT deleted`);
        held++;
        continue;
      }
      if (!WRITE) {
        line(`  would delete ${id.padEnd(12)} dependents: none`);
        continue;
      }
      const r = await db.execute({ sql: `DELETE FROM races WHERE id = ?`, args: [id] });
      line(`  DELETE ${id.padEnd(12)} dependents: none   rowsAffected=${r.rowsAffected}`);
      deleted += Number(r.rowsAffected);
    }
  }

  line();
  line("──── NULL the incumbent on seats vacant at a regular cycle ────");
  // Derived, not listed: a seat that has acquired a sitting member since the
  // table was confirmed must NOT be nulled.
  const vacant = await db.execute(`
    SELECT r.id, r.incumbent_bioguide_id, m.name
      FROM races r
      JOIN members m ON m.bioguide_id = r.incumbent_bioguide_id
     WHERE r.chamber = 'house'
       AND r.cycle >= 2026
       AND m.is_current = 0
       AND NOT EXISTS (
         SELECT 1 FROM members h
          WHERE h.is_current = 1 AND h.chamber = 'house'
            AND h.state = r.state
            AND ((h.district IS NULL AND r.district = 0) OR h.district = r.district))
     ORDER BY r.id`);
  line(`  seats still vacant: ${vacant.rows.length}`);
  let nulled = 0;
  for (const v of vacant.rows) {
    if (!WRITE) {
      line(`  would NULL ${String(v.id).padEnd(12)} (was ${v.incumbent_bioguide_id}, ${v.name})`);
      continue;
    }
    const r = await db.execute({
      sql: `UPDATE races SET incumbent_bioguide_id = NULL WHERE id = ?`,
      args: [String(v.id)],
    });
    line(`  NULL   ${String(v.id).padEnd(12)} (was ${v.incumbent_bioguide_id}, ${v.name})   rowsAffected=${r.rowsAffected}`);
    nulled += Number(r.rowsAffected);
  }

  line();
  line(`summary: deleted=${deleted} held=${held} nulled=${nulled}`);

  // Read back: the rows must be gone, and the audit must read clean.
  if (WRITE) {
    line();
    const gone = await db.execute({
      sql: `SELECT COUNT(*) n FROM races WHERE id IN (${[...PHANTOMS, ...RESIDUE].map(() => "?").join(",")})`,
      args: [...PHANTOMS, ...RESIDUE],
    });
    line(`read-back: rows from the two delete lists still present: ${gone.rows[0]!.n} (expect 0)`);
    const keeps = await db.execute(
      `SELECT id FROM races WHERE id IN ('S-FL-2026','S-OH-2026') ORDER BY id`);
    line(`read-back: KEEP rows present: ${keeps.rows.map((r) => r.id).join(", ")} (expect both)`);
    const total = await db.execute(`SELECT COUNT(*) n FROM races`);
    line(`read-back: races total now ${total.rows[0]!.n}`);
  }

  line();
  line(formatRaceRowAudit(await auditRaceRows(db)));
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
