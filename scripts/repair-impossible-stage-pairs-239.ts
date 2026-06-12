// HO 239 one-shot repair of the impossible backward stage pairs.
//
// Scope: exactly the bills where `stage = 'introduced'` while `previous_stage`
// ranks higher — the impossible bucket (a bill cannot un-introduce; expect ~49
// from the 2026-06-12 backward-hop diagnostic). The 8 `floor→committee` and
// other plausible setbacks are NOT touched here — they may be genuine recommits
// and can't be bulk-adjudicated.
//
// Repair per row:
//   stage           <- previous_stage   (strictly closer to truth; for hr-8467
//                                         this may still understate — accepted)
//   previous_stage  <- NULL
//   stage_changed_at<- NULL
// The NULLs keep these bills OUT of MOVERS / `/changes` (an admin correction is
// not real movement). No NEW stage_transitions log rows are written — nothing
// "moved"; a wrong label was corrected.
//
// Log cleanup (the handoff's premise correction): the HO 232 plant logs every
// transition, so an impossible pair that flipped *after* the 2026-06-11 anchor
// already wrote a `committee→introduced` log row. Nulling stage_changed_at drops
// that bill from the validator's A-side (bills moved post-anchor) while the log
// row remains — an ORPHAN that FAILs the HO 232 invariant. Those rows record the
// same non-event the slot repair just undid, so we delete them too: any
// stage_transitions row whose to_stage='introduced' from a higher from_stage is
// an impossible logged transition and is removed. (Pre-anchor pairs never
// logged, so this touches only the few post-anchor ones.)
//
// Destructive-op discipline: --dry-run by default. Prints the full before/after
// table + the log rows to be removed (the recovery record). Re-run with --apply.
import "dotenv/config";
import { getDb } from "../lib/db";
import { stageRank } from "../lib/enums";

async function main() {
  const apply = process.argv.includes("--apply");
  const db = getDb();

  // Candidates: stage is introduced (rank 0) but previous_stage outranks it.
  const rs = await db.execute(
    `SELECT id, stage, previous_stage, stage_changed_at
     FROM bills
     WHERE stage = 'introduced' AND previous_stage IS NOT NULL`,
  );
  const rows = rs.rows.filter(
    (r) => stageRank(r.previous_stage as string) > stageRank("introduced"),
  );

  console.log(
    `=== HO 239 impossible-pair repair (${apply ? "APPLY" : "DRY-RUN"}) ===`,
  );
  console.log(`candidates: ${rows.length}\n`);
  console.log("bill_id".padEnd(20), "old_stage".padEnd(12), "restored_stage");
  for (const r of rows) {
    console.log(
      String(r.id).padEnd(20),
      String(r.stage).padEnd(12),
      String(r.previous_stage),
    );
  }

  // Impossible logged transitions to clear (to_stage='introduced' from higher).
  const logRs = await db.execute(
    `SELECT id, bill_id, from_stage, to_stage, changed_at
     FROM stage_transitions WHERE to_stage = 'introduced'`,
  );
  const orphanLogs = logRs.rows.filter(
    (r) => stageRank(r.from_stage as string) > stageRank("introduced"),
  );
  console.log(`\nimpossible log rows to remove: ${orphanLogs.length}`);
  for (const r of orphanLogs) {
    console.log(
      `  log#${r.id}`,
      String(r.bill_id).padEnd(16),
      `${r.from_stage}→${r.to_stage}`,
      r.changed_at,
    );
  }

  if (!apply) {
    console.log(
      `\nDRY-RUN — no writes. Re-run with --apply to repair ${rows.length} bill row(s) and delete ${orphanLogs.length} impossible log row(s).`,
    );
    return;
  }

  let done = 0;
  for (const r of rows) {
    await db.execute({
      sql: `UPDATE bills
            SET stage = ?, previous_stage = NULL, stage_changed_at = NULL
            WHERE id = ?`,
      args: [r.previous_stage as string, r.id as string],
    });
    done++;
  }
  let logsDeleted = 0;
  for (const r of orphanLogs) {
    await db.execute({
      sql: `DELETE FROM stage_transitions WHERE id = ?`,
      args: [r.id as number],
    });
    logsDeleted++;
  }
  console.log(
    `\nAPPLIED — repaired ${done} bill row(s), removed ${logsDeleted} impossible log row(s).`,
  );
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
