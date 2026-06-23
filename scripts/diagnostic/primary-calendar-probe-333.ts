// HO 333 Phase 1 — primary-calendar HALT-gate probe. READ-ONLY.
// Confirms the `primaries` table carries PAST dates (cyan VOTED half of the
// timeline) AND future dates (amber UPCOMING), each with a contest count and the
// set of states voting that date, for the 2026 cycle. HALT if forward-only.
import "dotenv/config";
import { createClient } from "@libsql/client";

const db = createClient({
  url: process.env.TURSO_DATABASE_URL!,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

const today = new Date().toISOString().slice(0, 10);

async function main() {
  // 1. Window span + past/future split (election_round='primary' only, matching
  //    the index helpers).
  const span = await db.execute(
    `SELECT MIN(primary_date) AS min_d, MAX(primary_date) AS max_d,
            COUNT(*) AS total_rows,
            SUM(CASE WHEN primary_date < '${today}' THEN 1 ELSE 0 END) AS past_rows,
            SUM(CASE WHEN primary_date >= '${today}' THEN 1 ELSE 0 END) AS future_rows,
            SUM(CASE WHEN primary_date IS NULL THEN 1 ELSE 0 END) AS null_date_rows
     FROM primaries WHERE election_round = 'primary'`,
  );
  console.log(`today = ${today}`);
  console.log("SPAN / SPLIT:", span.rows[0]);

  // 2. Per-date rollup: date, contest count, distinct state count + state list.
  const byDate = await db.execute(
    `SELECT primary_date,
            COUNT(*) AS contest_count,
            COUNT(DISTINCT state) AS state_count,
            GROUP_CONCAT(DISTINCT state) AS states
     FROM primaries
     WHERE election_round = 'primary' AND primary_date IS NOT NULL
     GROUP BY primary_date
     ORDER BY primary_date ASC`,
  );
  console.log(`\nDISTINCT PRIMARY DATES: ${byDate.rows.length}`);
  let pastDates = 0;
  let futureDates = 0;
  for (const r of byDate.rows) {
    const d = r.primary_date as string;
    const isPast = d < today;
    if (isPast) pastDates++;
    else futureDates++;
    const flag = isPast ? "VOTED " : "UPCOM ";
    console.log(
      `  ${flag} ${d}  contests=${String(r.contest_count).padStart(3)}  states=${String(r.state_count).padStart(2)}  ${r.states}`,
    );
  }
  console.log(`\nPAST dates=${pastDates}  FUTURE dates=${futureDates}`);

  // 3. The specific mock claim: Aug 4 2026 should highlight AZ KS MI MO WA.
  const aug4 = await db.execute(
    `SELECT DISTINCT state FROM primaries
     WHERE election_round = 'primary' AND primary_date = '2026-08-04' ORDER BY state`,
  );
  console.log(
    `\n2026-08-04 states (mock says AZ KS MI MO WA): ${aug4.rows.map((r) => r.state).join(" ")}`,
  );

  // 4. HALT verdict.
  const verdict =
    pastDates > 0 && futureDates > 0
      ? "PASS — past + future dates both present; timeline can render both halves"
      : "HALT — calendar is not two-sided (past or future dates missing)";
  console.log(`\nVERDICT: ${verdict}`);
}

main().catch((e) => {
  console.error("PROBE FAILED:", e);
  process.exit(1);
});
