// Diagnostic (read-only, HO 267 Phase 1): sizing for the two secondary hearings
// cuts that reuse the Piece 1 row —
//   (1) committee cut (getMeetingsByCommittee): per-committee meeting-count
//       distribution + the upcoming/recent split, to decide grouped bands vs
//       flat and where to cap the recent band.
//   (2) bill cut (getMeetingsForBill): meetings-per-bill distribution, to set
//       the cap before a "see all on /hearings" link.
// Run: `npx tsx scripts/diagnostic/hearings-secondary-267.ts`
import "dotenv/config";
import { getDb } from "../../lib/db";

function pctile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const i = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[i]!;
}

async function main() {
  const db = getDb();
  const now = new Date().toISOString();

  console.log("=== (1) committee cut — meetings per committee ===");
  const perCom = await db.execute({
    sql: `SELECT committee_system_code code, COUNT(*) n,
            SUM(CASE WHEN meeting_date >= ? THEN 1 ELSE 0 END) upcoming,
            SUM(CASE WHEN meeting_date <  ? THEN 1 ELSE 0 END) past
     FROM committee_meetings
     WHERE committee_system_code IS NOT NULL AND meeting_date IS NOT NULL
     GROUP BY committee_system_code`,
    args: [now, now],
  });
  const counts = perCom.rows.map((r) => Number(r.n)).sort((a, b) => a - b);
  const upcomings = perCom.rows.map((r) => Number(r.upcoming));
  const total = counts.length;
  const max = counts[counts.length - 1] ?? 0;
  const maxUpcoming = Math.max(0, ...upcomings);
  console.log(
    `committees=${total} | max total=${max} | p50=${pctile(counts, 50)} | p90=${pctile(counts, 90)} | >10: ${counts.filter((n) => n > 10).length} | >25: ${counts.filter((n) => n > 25).length}`,
  );
  console.log(`max UPCOMING on a single committee=${maxUpcoming}`);
  // top committees by volume + their upcoming/past split
  const top = [...perCom.rows]
    .sort((a, b) => Number(b.n) - Number(a.n))
    .slice(0, 8);
  console.log("--- top 8 by total ---");
  for (const r of top) {
    console.log(
      `${String(r.code).padEnd(8)} | total=${String(r.n).padStart(3)} | upcoming=${String(r.upcoming).padStart(2)} | past=${String(r.past).padStart(3)}`,
    );
  }

  console.log("\n=== (2) bill cut — meetings per bill ===");
  const perBill = await db.execute(
    `SELECT n, COUNT(*) bills FROM (
       SELECT bill_id, COUNT(*) n FROM meeting_bills GROUP BY bill_id
     ) GROUP BY n ORDER BY n`,
  );
  const billCounts: number[] = [];
  let billsTotal = 0;
  let over8 = 0;
  let maxBill = 0;
  for (const r of perBill.rows) {
    const n = Number(r.n);
    const bills = Number(r.bills);
    billsTotal += bills;
    if (n > 8) over8 += bills;
    if (n > maxBill) maxBill = n;
    for (let i = 0; i < bills; i++) billCounts.push(n);
    console.log(`meetings=${String(n).padStart(2)} | bills=${bills}`);
  }
  billCounts.sort((a, b) => a - b);
  console.log(
    `--- bills with ≥1 meeting=${billsTotal} | max meetings on one bill=${maxBill} | p50=${pctile(billCounts, 50)} | p90=${pctile(billCounts, 90)} | >8: ${over8} ---`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
