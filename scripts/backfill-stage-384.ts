// HO 384 — one-time stage backfill (advance-only).
//
// DO NOT BLIND RE-RUN. Idempotent (a second apply is a no-op once advances are
// written), but this is a bulk write on the SHARED prod Turso. Default mode is
// READ-ONLY (dry-run); writes only with `--apply`.
//
//   npx tsx scripts/backfill-stage-384.ts            # dry-run, read-only
//   npx tsx scripts/backfill-stage-384.ts --apply    # bulk write (advances only)
//
// Recomputes each bill's stage from latest_action_text via computeStage, then
// runs the HO 239 monotonicity guard (decideStage) — REUSED from the live path,
// not reimplemented, so the backfill can't drift from sync/the runner. Only the
// `stage` column is touched: no stage_transitions rows, no stage_changed_at /
// previous_stage writes (those would flood /changes + the Monday report with
// ~1.4k fake recent advances). Leaving previous_stage/stage_changed_at stale on
// corrected rows is the accepted cosmetic cost.
//
// Direct createClient (no boundedFetch wrapper) so the full-corpus read isn't
// subject to the app's 10s request abort.
import "dotenv/config";
import { createClient } from "@libsql/client";
import { computeStage, type Stage } from "../lib/enums";
import { decideStage } from "../lib/summarize-runner";

const APPLY = process.argv.includes("--apply");
const CHUNK = 300; // rows per libSQL write batch
const CHANGES_WINDOW_DAYS = 7;

const db = createClient({
  url: process.env.TURSO_DATABASE_URL!,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

function hr(t: string) {
  console.log("\n========== " + t + " ==========");
}

type Row = {
  id: string;
  stored: string | null;
  text: string | null;
  actionDate: string | null;
};

type Plan = {
  row: Row;
  computed: Stage;
  decision: ReturnType<typeof decideStage>;
};

async function loadPlans(): Promise<Plan[]> {
  const rs = await db.execute(
    `SELECT id, stage, latest_action_text, latest_action_date FROM bills`,
  );
  return rs.rows.map((r) => {
    const row: Row = {
      id: r.id as string,
      stored: (r.stage as string | null) ?? null,
      text: (r.latest_action_text as string | null) ?? null,
      actionDate: (r.latest_action_date as string | null) ?? null,
    };
    const computed = computeStage(row.text);
    // pending = null: a one-shot snapshot correction never participates in the
    // two-tick pend/confirm vote. A non-introduced downgrade → "pend", a
    // downgrade-to-introduced → "reject"; both mean the guard holds the row
    // (the would-regress bucket). Only "advance" writes.
    const decision = decideStage(row.stored, computed, null);
    return { row, computed, decision };
  });
}

function bucketAndReport(plans: Plan[]) {
  const advances = plans.filter((p) => p.decision === "advance");
  const noChange = plans.filter((p) => p.decision === "noop");
  const wouldRegress = plans.filter(
    (p) => p.decision === "pend" || p.decision === "reject",
  );

  hr(`buckets (total ${plans.length})`);
  console.table([
    { bucket: "advances (will write)", count: advances.length },
    { bucket: "no change (noop)", count: noChange.length },
    { bucket: "would-regress (guard holds)", count: wouldRegress.length },
  ]);

  // Stage-transition tally for the advances bucket.
  hr("advances — transition tally (stored → computed)");
  const tally = new Map<string, number>();
  for (const p of advances) {
    const key = `${p.row.stored ?? "NULL"} → ${p.computed}`;
    tally.set(key, (tally.get(key) ?? 0) + 1);
  }
  console.table(
    [...tally.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([transition, count]) => ({ transition, count })),
  );

  // Known-case confirmation: enacted-stored-as-something-lower, and
  // floor-stored-as-committee.
  hr("advances — known cases");
  const toEnacted = advances.filter((p) => p.computed === "enacted");
  const toFloorFromCommittee = advances.filter(
    (p) => p.computed === "floor" && p.row.stored === "committee",
  );
  console.log(
    `→ enacted: ${toEnacted.length} (expected ≥6: enacted stored as committee/other_chamber)`,
  );
  console.table(
    toEnacted.map((p) => ({
      id: p.row.id,
      stored: p.row.stored ?? "NULL",
      action: String(p.row.text ?? "").slice(0, 60),
    })),
  );
  console.log(`→ floor (stored committee): ${toFloorFromCommittee.length}`);
  console.table(
    toFloorFromCommittee.slice(0, 10).map((p) => ({
      id: p.row.id,
      action: String(p.row.text ?? "").slice(0, 60),
    })),
  );

  // Advances sample (non-enacted), for eyeballing.
  hr("advances — sample (first 15)");
  console.table(
    advances.slice(0, 15).map((p) => ({
      id: p.row.id,
      stored: p.row.stored ?? "NULL",
      computed: p.computed,
      action: String(p.row.text ?? "").slice(0, 55),
    })),
  );

  // Changes-window sanity: how many advances have a recent latest_action_date.
  const cutoff = new Date(
    Date.now() - CHANGES_WINDOW_DAYS * 24 * 60 * 60 * 1000,
  )
    .toISOString()
    .slice(0, 10);
  const inWindow = advances.filter(
    (p) => p.row.actionDate != null && p.row.actionDate >= cutoff,
  );
  hr(`advances within /changes window (latest_action_date ≥ ${cutoff})`);
  console.log(
    `${inWindow.length} of ${advances.length} advances are recent. ` +
      `(stage_changed_at is UNTOUCHED, so none of these surface on /changes — awareness only.)`,
  );

  // Would-regress FULL list — eyes on whether any are genuine over-staging.
  hr(`would-regress — FULL list (${wouldRegress.length}); guard holds all`);
  console.table(
    wouldRegress.map((p) => ({
      id: p.row.id,
      stored: p.row.stored ?? "NULL",
      computed: p.computed,
      decision: p.decision,
      action: String(p.row.text ?? "").slice(0, 55),
    })),
  );

  return { advances, noChange, wouldRegress };
}

async function apply(advances: Plan[]) {
  hr(`APPLY — writing ${advances.length} advances in chunks of ${CHUNK}`);
  let written = 0;
  for (let i = 0; i < advances.length; i += CHUNK) {
    const chunk = advances.slice(i, i + CHUNK);
    await db.batch(
      chunk.map((p) => ({
        sql: `UPDATE bills SET stage = ? WHERE id = ?`,
        args: [p.computed, p.row.id],
      })),
      "write",
    );
    written += chunk.length;
    console.log(`  wrote ${written}/${advances.length}`);
  }
  console.log(`rows written: ${written}`);
}

async function main() {
  console.log(`mode: ${APPLY ? "APPLY (writing)" : "DRY-RUN (read-only)"}`);
  const plans = await loadPlans();
  const { advances } = bucketAndReport(plans);

  if (!APPLY) {
    hr("HALT");
    console.log(
      "Dry-run complete. No writes. Re-run with --apply only after the bucket counts above are approved.",
    );
    return;
  }

  await apply(advances);

  // Verify: re-load and confirm the advances bucket is now empty (idempotency).
  hr("VERIFY — re-running buckets after write");
  const after = await loadPlans();
  const advAfter = after.filter((p) => p.decision === "advance");
  console.log(
    `advances bucket after apply: ${advAfter.length} (expected 0 — idempotent)`,
  );
  if (advAfter.length > 0) {
    console.table(
      advAfter.slice(0, 20).map((p) => ({
        id: p.row.id,
        stored: p.row.stored ?? "NULL",
        computed: p.computed,
      })),
    );
  }

  // Ungated stage distribution shift sanity.
  hr("VERIFY — stage distribution (post-write)");
  const dist = await db.execute(
    `SELECT stage, COUNT(*) AS n FROM bills GROUP BY stage ORDER BY n DESC`,
  );
  console.table(
    dist.rows.map((r) => ({ stage: r.stage ?? "NULL", n: Number(r.n) })),
  );
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
