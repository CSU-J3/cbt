// HO 447 scheduler-confirmation check (read-only). Three states, so a
// connectivity failure is never misreported as a scheduler failure:
//   1. sibling present + amendments present -> scheduler CONFIRMED (close loop)
//   2. sibling present + amendments ABSENT  -> registration inference WRONG
//                                              (debug the vercel.json crons entry)
//   3. sibling ABSENT                       -> creds/connectivity broken; the
//                                              CHECK ITSELF failed, not the scheduler
// Connectivity is asserted by reading a recent cron_runs row from a known-firing
// sibling (/api/cron/lda, 0 8 * * *) before judging /api/cron/amendments.
//   npx tsx scripts/diagnostic/amendments-cron-check-447.ts
import "dotenv/config";
import { createClient } from "@libsql/client";

const AMENDMENTS = "/api/cron/amendments";
const SIBLING = "/api/cron/lda"; // known-firing, daily 0 8 * * *

async function main(): Promise<number> {
  const url = process.env.TURSO_DATABASE_URL;
  const authToken = process.env.TURSO_AUTH_TOKEN;
  if (!url) {
    console.log("STATE 3 (CHECK BROKEN): TURSO_DATABASE_URL not set in this env.");
    console.log("This is a creds/connectivity failure, NOT a scheduler failure.");
    console.log("Run this on a machine with the CBT .env (e.g. the local working tree).");
    return 3;
  }

  const db = createClient({ url, authToken });
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD, UTC

  const rowsFor = async (route: string, sinceIso: string) =>
    (
      await db.execute({
        sql: `SELECT id, route, started_at, status, elapsed_ms, error_message,
                     substr(payload, 1, 400) AS payload
              FROM cron_runs
              WHERE route = ? AND started_at >= ?
              ORDER BY started_at DESC`,
        args: [route, sinceIso],
      })
    ).rows;

  const fmt = (r: Record<string, unknown>) =>
    `  #${r.id}  started_at=${r.started_at}  status=${r.status}  ` +
    `elapsed_ms=${r.elapsed_ms ?? "-"}  err=${r.error_message ?? "none"}` +
    (r.payload ? `\n      payload: ${r.payload}` : "");

  console.log(`=== amendments scheduler check — ${today} (UTC) ===\n`);

  // --- Connectivity assertion via sibling (last 36h window) ---
  let sibling: Record<string, unknown>[];
  const since36h = new Date(Date.now() - 36 * 3600_000).toISOString();
  try {
    sibling = (await rowsFor(SIBLING, since36h)) as Record<string, unknown>[];
  } catch (err) {
    console.log(`STATE 3 (CHECK BROKEN): query threw — ${err instanceof Error ? err.message : String(err)}`);
    console.log("Creds/connectivity failure, NOT a scheduler failure.");
    db.close();
    return 3;
  }

  if (sibling.length === 0) {
    console.log(`STATE 3 (CHECK BROKEN): no ${SIBLING} row in the last 36h.`);
    console.log("Either the DB is unreachable/wrong or the whole scheduler is down —");
    console.log("but treat as a CHECK/connectivity problem, not proof the amendments cron failed.");
    db.close();
    return 3;
  }
  console.log(`connectivity OK — ${SIBLING} logged recently:`);
  console.log(fmt(sibling[0]!) + "\n");

  // --- The actual question: did /api/cron/amendments fire today? ---
  const amend = (await rowsFor(AMENDMENTS, `${today}T00:00:00Z`)) as Record<string, unknown>[];

  if (amend.length === 0) {
    console.log(`STATE 2 (REGISTRATION WRONG): NO ${AMENDMENTS} row started on ${today}.`);
    console.log("Sibling logged, so the DB + scheduler are alive — yet amendments did NOT fire.");
    console.log("Debug the vercel.json crons entry: exact path '/api/cron/amendments', schedule");
    console.log("'0 7 * * *', and confirm the live prod deploy is still 5c4d32b. Recall HO 314");
    console.log("(a configured Vercel cron floor that never actually fired). Report before changing.");
    db.close();
    return 2;
  }

  console.log(`STATE 1 (SCHEDULER CONFIRMED): ${amend.length} ${AMENDMENTS} row(s) today.\n`);
  for (const r of amend) console.log(fmt(r));
  console.log("\nHO 447 arc verified end-to-end: push -> deploy -> scheduled cron fired.");
  db.close();
  return 0;
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((err) => {
    console.log(`STATE 3 (CHECK BROKEN): unexpected error — ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 3;
  });
