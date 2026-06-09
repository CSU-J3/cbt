// Diagnostic (read-only, HO 222 CHECK 2): incumbent cash-on-hand distribution
// across toss-up + lean rated 2026 rows, House and Senate SEPARATELY, to decide
// whether a natural gap justifies an amber "cash-thin" threshold. Mirrors
// getRacesIndex's consensus pick (smallest |rating_score| across sources).
// Run: `npx tsx scripts/diagnostic/cash-dist-222.ts`
import "dotenv/config";
import { getDb } from "../../lib/db";

function consensusScore(scores: Array<number | null>): number | null {
  const present = scores.filter((s): s is number => s !== null);
  if (present.length === 0) return null;
  return present.reduce((best, s) => (Math.abs(s) < Math.abs(best) ? s : best));
}

function fmt(cents: number | null): string {
  if (cents == null) return "—(no filing)";
  return "$" + (cents / 100).toLocaleString("en-US", { maximumFractionDigits: 0 });
}

async function main() {
  const db = getDb();
  const rs = await db.execute({
    sql: `SELECT r.id, r.chamber, r.state, r.district,
                 r.incumbent_running,
                 mf.cash_on_hand AS cash,
                 MAX(CASE WHEN rr.source='cook' THEN rr.rating_score END) AS cook,
                 MAX(CASE WHEN rr.source='sabato' THEN rr.rating_score END) AS sabato,
                 MAX(CASE WHEN rr.source='inside_elections' THEN rr.rating_score END) AS ie
          FROM races r
          INNER JOIN race_ratings rr ON rr.race_id = r.id AND rr.cycle = r.cycle
          LEFT JOIN member_fundraising mf
                 ON mf.bioguide_id = r.incumbent_bioguide_id AND mf.cycle = r.cycle
          WHERE r.cycle = 2026
          GROUP BY r.id`,
    args: [],
  });

  const buckets: Record<"house" | "senate", { cash: number[]; nulls: number; open: number }> = {
    house: { cash: [], nulls: 0, open: 0 },
    senate: { cash: [], nulls: 0, open: 0 },
  };
  let totalRows = 0;
  let tossLean = 0;

  for (const row of rs.rows) {
    totalRows++;
    const cs = consensusScore([
      row.cook as number | null,
      row.sabato as number | null,
      row.ie as number | null,
    ]);
    if (cs == null || Math.abs(cs) > 1) continue; // toss-up + lean (incl tilt ±1) only
    tossLean++;
    const ch = (row.chamber as string) === "senate" ? "senate" : "house";
    const isOpen = row.incumbent_running != null && Number(row.incumbent_running) === 0;
    if (isOpen) buckets[ch].open++;
    const cash = row.cash == null ? null : Number(row.cash);
    if (cash == null) buckets[ch].nulls++;
    else buckets[ch].cash.push(cash);
  }

  console.log(`\n=== HO 222 CHECK 2 — cash-on-hand on toss-up+lean rated seats ===`);
  console.log(`total rated 2026 rows: ${totalRows} · toss-up+lean (|score|<=1): ${tossLean}\n`);

  for (const ch of ["senate", "house"] as const) {
    const b = buckets[ch];
    const sorted = [...b.cash].sort((a, z) => a - z);
    console.log(`--- ${ch.toUpperCase()} (toss-up+lean) ---`);
    console.log(`  rows with cash: ${sorted.length} · null/no-filing: ${b.nulls} · open-seat: ${b.open}`);
    console.log(`  ASC distribution:`);
    for (const c of sorted) console.log(`     ${fmt(c)}`);
    if (sorted.length > 1) {
      // Largest multiplicative gap between adjacent values (a "natural break").
      let best = { gap: 0, lo: 0, hi: 0 };
      for (let i = 1; i < sorted.length; i++) {
        const lo = sorted[i - 1]!;
        const hi = sorted[i]!;
        const gap = lo > 0 ? hi / lo : Infinity;
        if (gap > best.gap && lo > 0) best = { gap, lo, hi };
      }
      console.log(
        `  largest adjacent multiplicative gap: ${best.gap.toFixed(2)}x  (${fmt(best.lo)} -> ${fmt(best.hi)})`,
      );
    }
    console.log("");
  }
}

main().then(() => process.exit(0)).catch((e) => {
  console.error(e);
  process.exit(1);
});
