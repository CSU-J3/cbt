// HO 677 — the one-shot reconcile of `bills.cosponsor_count` against the roster.
//
// WHAT THIS WRITES, exactly:
//   bills.cosponsor_count — THAT COLUMN ONLY, on bills where it disagrees with
//                           bill_roster_state.active_count. Nothing else, on any
//                           table.
//
// READ-ONLY BY DEFAULT. A bare invocation and `--check` report what WOULD be
// written and touch nothing. `--write` is required to mutate.
//
// WHY A ONE-SHOT AS WELL AS THE CRON: HO 677 gave the column an owner
// (lib/bill-rosters-refresh.ts), but ownership alone cannot move the number —
// the refresh corrects a bill only when it checks it, and the sweep recycles the
// corpus in ~18.5 days. At the handover only 510 of 17,729 bills had been
// refresh-checked, so without this pass the panel would keep printing a total
// above groups that do not sum to it, on most bills, for weeks.
//
// ZERO API CALLS. `bill_roster_state.active_count` is already materialized
// (HO 676), so this is pure DB — it re-states a number we hold, it does not
// re-derive one.
//
// WHAT IT DOES NOT CLAIM. The corrections are only as fresh as each bill's last
// check, and at the time of writing 97.1% of state rows carried the HO 676 SEED
// stamp rather than a refresh check. So this reconciles the column to
// backfill-time truth (2026-08-19/20), not to now. That is bounded-stale where
// the column was previously unbounded-stale — better, not correct. Re-read
// `checked_at` before quoting any freshness claim from this script.
//
//   npx tsx scripts/reconcile-cosponsor-count-677.ts            # dry run
//   npx tsx scripts/reconcile-cosponsor-count-677.ts --write
import "dotenv/config";
import { getDb } from "../lib/db";

const WRITE = process.argv.includes("--write");
const CHUNK = 400;

type Row = { id: string; stored: number | null; roster: number };

async function census(label: string) {
  const db = getDb();
  const r = await db.execute(`
    SELECT COUNT(*) AS bills,
           SUM(CASE WHEN b.cosponsor_count IS NULL THEN 1 ELSE 0 END) AS nulls,
           SUM(CASE WHEN b.cosponsor_count = 0 THEN 1 ELSE 0 END) AS zeros,
           SUM(CASE WHEN b.cosponsor_count IS NOT NULL
                     AND b.cosponsor_count <> s.active_count THEN 1 ELSE 0 END) AS disagree,
           SUM(CASE WHEN b.cosponsor_count IS NULL
                     AND s.active_count > 0 THEN 1 ELSE 0 END) AS null_with_roster
    FROM bills b JOIN bill_roster_state s ON s.bill_id = b.id`);
  const x = r.rows[0];
  console.log(`\n== ${label} ==`);
  console.log(`  bills joined to state : ${x?.bills}`);
  console.log(`  cosponsor_count NULL  : ${x?.nulls}   (= 0 on ${x?.zeros} — the column has never stored 0)`);
  console.log(`  DISAGREE with roster  : ${x?.disagree}`);
  console.log(`  NULL despite a roster : ${x?.null_with_roster}`);
}

async function main() {
  const db = getDb();
  console.log(WRITE ? "MODE: --write (WILL MUTATE bills.cosponsor_count)" : "MODE: check (no writes)");
  await census("BEFORE");

  // The NULL rule (HO 677 STEP 0.5): active_count when > 0, NULL when 0.
  // Expressed as NULLIF so the SELECT and the write cannot disagree about it.
  const rs = await db.execute(`
    SELECT b.id, b.cosponsor_count AS stored, s.active_count AS roster
    FROM bills b JOIN bill_roster_state s ON s.bill_id = b.id
    WHERE b.cosponsor_count IS NOT (CASE WHEN s.active_count > 0 THEN s.active_count END)
    ORDER BY b.id`);
  const rows: Row[] = rs.rows.map((r) => ({
    id: String(r.id),
    stored: r.stored == null ? null : Number(r.stored),
    roster: Number(r.roster),
  }));

  let up = 0;
  let down = 0;
  let nullToValue = 0;
  let valueToNull = 0;
  for (const r of rows) {
    const target = r.roster > 0 ? r.roster : null;
    if (r.stored == null && target != null) nullToValue++;
    else if (r.stored != null && target == null) valueToNull++;
    else if (target != null && r.stored != null && target > r.stored) up++;
    else down++;
  }
  console.log(`\ncandidates: ${rows.length}`);
  console.log(`  corrected UP (roster ahead)   : ${up}`);
  console.log(`  corrected DOWN (column ahead) : ${down}`);
  console.log(`  NULL -> value                 : ${nullToValue}`);
  console.log(`  value -> NULL                 : ${valueToNull}`);
  if (down > 0) {
    console.log("  the DOWNWARD ones, named — a decrease surprises people:");
    for (const r of rows.filter((x) => x.stored != null && x.roster > 0 && x.roster < x.stored)) {
      console.log(`    ${r.id.padEnd(16)} ${r.stored} -> ${r.roster}`);
    }
  }

  if (!WRITE) {
    await census("AFTER (unchanged — check mode)");
    console.log("\n(check mode — this run wrote nothing; the two censuses must match)");
    return;
  }

  for (let i = 0; i < rows.length; i += CHUNK) {
    const slice = rows.slice(i, i + CHUNK);
    await db.batch(
      slice.map((r) => ({
        sql: `UPDATE bills SET cosponsor_count = ? WHERE id = ?`,
        args: [r.roster > 0 ? r.roster : null, r.id],
      })),
      "write",
    );
    console.log(`  wrote ${Math.min(i + CHUNK, rows.length)}/${rows.length}`);
  }

  await census("AFTER (actual table state)");

  // The column is read through `bills`-tagged cache entries, so a one-shot
  // correction is invisible until that tag is flushed. The CRON deliberately
  // does not flush it (see lib/bill-rosters-refresh.ts); this one-shot does,
  // once, which is the whole reason the cadence argument does not apply here.
  //
  // GUARDED, and the guard is not defensive habit: the writes above have already
  // COMMITTED and been read back by the time this runs, so an unreachable
  // REVALIDATE_URL must not make the process exit non-zero. It did exactly that
  // on the first real run — REVALIDATE_URL points at localhost:3000 and no server
  // was up — producing a stack trace after a fully successful reconcile, which
  // is the "unclear whether it landed" failure the Gates rule is about, inverted:
  // the write landed and the exit code said otherwise.
  const url = process.env.REVALIDATE_URL;
  const secret = process.env.CRON_SECRET;
  if (url && secret) {
    try {
      const res = await fetch(`${url}?tag=bills`, {
        method: "POST",
        headers: { Authorization: `Bearer ${secret}` },
      });
      console.log(`\nrevalidate bills -> ${res.status} ${await res.text()}`);
    } catch (e) {
      console.log(
        `\nrevalidate bills FAILED (${e instanceof Error ? e.message : String(e)}) — ` +
          `the writes above are committed and read back; flush the \`bills\` tag ` +
          `separately or the corrected column stays invisible until the next flush.`,
      );
    }
  } else {
    console.log("\nREVALIDATE_URL / CRON_SECRET not set — flush the `bills` tag manually.");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
