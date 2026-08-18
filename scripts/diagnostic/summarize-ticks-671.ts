// HO 671 STEP 0.6 — the summarize tick distribution, re-measured at HEAD. READ-ONLY.
//
// HO 670 counted ticks that summarized zero. This adds the field the GUARD
// actually needs: the joint distribution of (ok, failed). A guard on `ok > 0`
// and a guard on `ok > 0 || failed > 0` behave identically unless ticks exist
// with ok = 0 and failed > 0 — so that cell is the one that decides the shape,
// and it is measured rather than assumed.
//
// The HO 669 envelope trap applies: cron_runs.payload is
// {ok, elapsedMs, payload:{summarized,…}} — the tick's own fields sit one level
// down, so a naive payload.summarized reads undefined on every row, which is
// indistinguishable from "zero bills". The raw first row is printed, both depths
// are read, and the control is that `wrote` comes back non-zero.
//
//   npx tsx scripts/diagnostic/summarize-ticks-671.ts [limit]
import "dotenv/config";
import { createClient } from "@libsql/client";

async function main() {
  const url = process.env.TURSO_DATABASE_URL;
  const authToken = process.env.TURSO_AUTH_TOKEN;
  if (!url) throw new Error("TURSO_DATABASE_URL required");
  const limit = Number(process.argv[2] ?? 300);
  const db = createClient({ url, authToken });

  const rs = await db.execute({
    sql: `SELECT started_at, status, payload
            FROM cron_runs
           WHERE route = '/api/cron/summarize'
           ORDER BY started_at DESC
           LIMIT ?`,
    args: [limit],
  });
  console.log("=".repeat(96));
  console.log(`HO 671 STEP 0.6 — summarize tick distribution (last ${rs.rows.length} ticks)`);
  console.log("=".repeat(96));
  if (rs.rows.length === 0) {
    console.log("  no rows — nothing to conclude");
    return;
  }
  console.log(`  window: ${rs.rows[rs.rows.length - 1]?.started_at} -> ${rs.rows[0]?.started_at}`);
  console.log(`  RAW first payload (shape, not assumed): ${String(rs.rows[0]?.payload).slice(0, 200)}`);

  let wroteOnly = 0; // ok > 0
  let failedOnly = 0; // ok == 0 && failed > 0   <- the cell that decides the guard
  let idle = 0; // ok == 0 && failed == 0
  let skipped = 0; // lock overlap: returns BEFORE the flush today
  let errored = 0; // status != success: the throw path never reaches the flush
  let unreadable = 0;

  for (const r of rs.rows) {
    if (String(r.status) !== "success") {
      errored += 1;
      continue;
    }
    let p: Record<string, unknown>;
    try {
      p = JSON.parse(String(r.payload)) as Record<string, unknown>;
    } catch {
      unreadable += 1;
      continue;
    }
    const inner = (p.payload ?? p) as Record<string, unknown>;
    if (typeof inner.skipped === "string") {
      skipped += 1;
      continue;
    }
    const ok = inner.summarized;
    const failed = inner.failed;
    if (typeof ok !== "number" || typeof failed !== "number") {
      unreadable += 1;
      continue;
    }
    if (ok > 0) wroteOnly += 1;
    else if (failed > 0) failedOnly += 1;
    else idle += 1;
  }

  const reachedFlush = wroteOnly + failedOnly + idle;
  const pct = (n: number) => (reachedFlush > 0 ? ((n / reachedFlush) * 100).toFixed(1) + "%" : "—");
  console.log("");
  console.log(`  ticks reaching revalidateTag("bills") today: ${reachedFlush}`);
  console.log(`    ok > 0                (guard WOULD flush): ${wroteOnly}  ${pct(wroteOnly)}`);
  console.log(`    ok = 0, failed > 0    (the deciding cell): ${failedOnly}  ${pct(failedOnly)}`);
  console.log(`    ok = 0, failed = 0    (guard would SKIP) : ${idle}  ${pct(idle)}`);
  console.log(`  lock-skipped (never reach the flush today) : ${skipped}`);
  console.log(`  errored ticks (throw path, no flush today) : ${errored}`);
  console.log(`  unreadable payloads                        : ${unreadable}`);
  console.log("");
  console.log("  CONTROL: `ok > 0` must be non-zero — if every tick reads zero, the field is");
  console.log("  being misread (HO 669 envelope trap), not the queue being idle.");
  if (wroteOnly === 0) console.log("  !! CONTROL FAILED");
  console.log("");
  console.log(`  Guard shapes are ${failedOnly === 0 ? "INDISTINGUISHABLE on this window" : "DIFFERENT on this window"}:`);
  console.log(`    ok > 0            -> ${wroteOnly} flushes/${reachedFlush} ticks`);
  console.log(`    ok > 0 || failed  -> ${wroteOnly + failedOnly} flushes/${reachedFlush} ticks`);
}

main().catch((e) => {
  console.error("FAILED:", e);
  process.exit(1);
});
