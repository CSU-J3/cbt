import "dotenv/config";
import { getDb } from "../../lib/db";

// HO 232 — validate the stage_transitions write-path planted in commit 47e2a35.
//
// Run AFTER a /api/cron/summarize tick (13:00 UTC daily) has had a chance to
// fire on a real stage change:  npx tsx scripts/diagnostic/validate-stage-transitions-232.ts
//
// The write lives in lib/summarize-runner.ts's `transitioned` branch: on a
// stage change it writes BOTH the single-slot bills.previous_stage/
// stage_changed_at AND one stage_transitions row, sharing the same timestamp.
// The table started EMPTY at deploy; rows only accrue from post-plant ticks.
//
// Verdict:
//   PASS         — A > 0 and every moved bill has a matching transition row.
//                  B may EXCEED A: a bill that transitions twice post-plant
//                  contributes 2 rows (B) but 1 bill (A). That's expected, not
//                  a failure — reported as a note with the repeat bill_ids.
//   INCONCLUSIVE — A === 0 && B === 0 (quiet tick, no stage changes). The write
//                  path is untested-but-not-broken; re-run after the next tick.
//   FAIL         — a moved bill with NO transition row (write didn't fire), a
//                  from/to that doesn't match the bill's slot, or an orphan
//                  transition row whose bill never moved post-plant.
const PLANT = "2026-06-11T18:38:18Z";

async function main() {
  const db = getDb();

  // A: bills whose single-slot stage_changed_at is newer than the plant.
  const movedRs = await db.execute({
    sql: `SELECT id, previous_stage, stage, stage_changed_at FROM bills
          WHERE stage_changed_at > ? ORDER BY stage_changed_at DESC`,
    args: [PLANT],
  });
  const A = movedRs.rows.length;

  // B: total stage_transitions rows (the table is post-plant only).
  const bRs = await db.execute("SELECT COUNT(*) AS n FROM stage_transitions");
  const B = Number(bRs.rows[0]?.n ?? 0);

  // Per-bill coverage: each moved bill needs >= 1 transition row, and its
  // LATEST row must match the current single-slot values (the slot holds the
  // most-recent transition).
  const missing: string[] = [];
  const mismatched: string[] = [];
  for (const r of movedRs.rows) {
    const id = r.id as string;
    const prev = (r.previous_stage as string | null) ?? null;
    const cur = (r.stage as string | null) ?? null;
    const stRs = await db.execute({
      sql: `SELECT from_stage, to_stage FROM stage_transitions
            WHERE bill_id = ? ORDER BY changed_at DESC LIMIT 1`,
      args: [id],
    });
    if (stRs.rows.length === 0) {
      missing.push(id);
      continue;
    }
    const st = stRs.rows[0]!;
    const fromOk = ((st.from_stage as string | null) ?? null) === prev;
    const toOk = ((st.to_stage as string | null) ?? null) === cur;
    if (!fromOk || !toOk) {
      mismatched.push(
        `${id}: st(${st.from_stage}→${st.to_stage}) vs bills(${prev}→${cur})`,
      );
    }
  }

  // Orphans: transition rows whose bill_id has NO post-plant stage_changed_at.
  const orphanRs = await db.execute({
    sql: `SELECT DISTINCT st.bill_id FROM stage_transitions st
          LEFT JOIN bills b ON b.id = st.bill_id AND b.stage_changed_at > ?
          WHERE b.id IS NULL`,
    args: [PLANT],
  });
  const orphans = orphanRs.rows.map((x) => x.bill_id as string);

  // Repeat bill_ids — the legitimate reason B can exceed A.
  const repeatRs = await db.execute(
    `SELECT bill_id, COUNT(*) AS n FROM stage_transitions
     GROUP BY bill_id HAVING n > 1 ORDER BY n DESC`,
  );
  const repeats = repeatRs.rows.map((x) => `${x.bill_id}×${x.n}`);

  // Spot-check sample: 3 most-recent transition rows.
  const sampleRs = await db.execute(
    `SELECT bill_id, from_stage, to_stage, changed_at FROM stage_transitions
     ORDER BY changed_at DESC LIMIT 3`,
  );

  let verdict: "PASS" | "FAIL" | "INCONCLUSIVE";
  if (A === 0 && B === 0) verdict = "INCONCLUSIVE";
  else if (missing.length || mismatched.length || orphans.length)
    verdict = "FAIL";
  else verdict = "PASS";

  console.log(`\n=== HO 232 stage_transitions validation ===`);
  console.log(`plant anchor: ${PLANT}`);
  console.log(`A (bills moved post-plant): ${A}`);
  console.log(`B (stage_transitions rows): ${B}`);
  if (B > A) {
    console.log(
      `note: B > A by ${B - A} — expected if bills transitioned more than once.`,
    );
    console.log(`      repeat bill_ids: ${repeats.length ? repeats.join(", ") : "(none — investigate the excess)"}`);
  }
  if (missing.length) console.log(`MISSING transition row: ${missing.join(", ")}`);
  if (mismatched.length)
    console.log(`MISMATCHED slot vs row:\n  ${mismatched.join("\n  ")}`);
  if (orphans.length) console.log(`ORPHAN transition rows: ${orphans.join(", ")}`);
  console.log(`spot-check (3 newest rows):`);
  for (const s of sampleRs.rows) {
    console.log(
      `  ${s.bill_id}: ${s.from_stage}→${s.to_stage} @ ${s.changed_at}`,
    );
  }
  if (verdict === "INCONCLUSIVE")
    console.log(
      `\nVERDICT: INCONCLUSIVE — quiet tick, no stage changes. Re-run after the next 13:00 UTC summarize tick.`,
    );
  else console.log(`\nVERDICT: ${verdict}`);
}

main().catch((e) => {
  console.error("DBERR:", (e as Error).message);
  process.exit(1);
});
