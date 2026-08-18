// HO 527 STEP 0 — participation-dotplot distribution report (READ-ONLY, throwaway).
// Reports the 119th missed-rate distribution over the floored current population,
// split non-delegate vs delegate, to lock CAP + BINW before the component is built.
// Stays untracked (the HO 524/525 cross-check precedent). No writes.
//
//   npx tsx scripts/diagnostic/participation-dist-527.ts
import "dotenv/config";
import { getDb } from "../../lib/db";

const FLOOR = 50; // == PARTICIPATION_FLOOR
const DELEGATE_STATES = new Set(["DC", "AS", "GU", "MP", "PR", "VI"]);

type Row = {
  bioguide: string;
  name: string;
  party: string | null;
  chamber: string;
  state: string;
  total: number;
  missedPct: number;
  isDelegate: boolean;
};

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return NaN;
  if (sorted.length === 1) return sorted[0]!;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo]!;
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (pos - lo);
}

function report(label: string, vals: number[]) {
  const s = [...vals].sort((a, b) => a - b);
  const f = (x: number) => (Number.isNaN(x) ? "  —  " : x.toFixed(2).padStart(6));
  console.log(
    `  ${label.padEnd(14)} n=${String(s.length).padStart(3)}  ` +
      `min ${f(s[0] ?? NaN)}  med ${f(quantile(s, 0.5))}  p75 ${f(quantile(s, 0.75))}  ` +
      `p90 ${f(quantile(s, 0.9))}  p99 ${f(quantile(s, 0.99))}  max ${f(s[s.length - 1] ?? NaN)}`,
  );
}

async function main() {
  const db = getDb();
  const rs = await db.execute({
    sql: `SELECT mv.bioguide_id AS bioguide, m.name AS name, m.party AS party,
                 m.chamber AS chamber, m.state AS state,
                 COUNT(*) AS total,
                 SUM(CASE WHEN mv.position = 'not_voting' THEN 1 ELSE 0 END) AS nv
            FROM member_votes mv
            JOIN members m ON m.bioguide_id = mv.bioguide_id
           WHERE m.is_current = 1
           GROUP BY mv.bioguide_id`,
    args: [],
  });

  const flooredOut: { name: string; chamber: string; total: number }[] = [];
  const rows: Row[] = [];
  for (const r of rs.rows) {
    const total = Number(r.total ?? 0);
    const nv = Number(r.nv ?? 0);
    const chamber = String(r.chamber ?? "");
    const state = String(r.state ?? "");
    if (total < FLOOR) {
      flooredOut.push({ name: String(r.name ?? ""), chamber, total });
      continue;
    }
    rows.push({
      bioguide: r.bioguide as string,
      name: String(r.name ?? ""),
      party: (r.party as string | null) ?? null,
      chamber,
      state,
      total,
      missedPct: (nv / total) * 100,
      isDelegate: chamber === "house" && DELEGATE_STATES.has(state),
    });
  }

  const nonDel = rows.filter((r) => !r.isDelegate);
  const del = rows.filter((r) => r.isDelegate);
  const houseND = nonDel.filter((r) => r.chamber === "house");
  const senND = nonDel.filter((r) => r.chamber === "senate");

  console.log("\n=== HO 527 STEP 0 — 119th missed-rate distribution (floored, is_current) ===\n");
  console.log("§1 NON-DELEGATE missed-rate quantiles (%), sets CAP:");
  report("house", houseND.map((r) => r.missedPct));
  report("senate", senND.map((r) => r.missedPct));
  report("pooled", nonDel.map((r) => r.missedPct));

  const ndP99 = quantile([...nonDel.map((r) => r.missedPct)].sort((a, b) => a - b), 0.99);
  const ndMax = Math.max(...nonDel.map((r) => r.missedPct));
  console.log(`\n  (non-delegate p99 = ${ndP99.toFixed(2)}%, max = ${ndMax.toFixed(2)}%)`);

  console.log("\n§2 DELEGATE rows (territorial-state predicate) — confirm they're the high outliers:");
  del
    .sort((a, b) => b.missedPct - a.missedPct)
    .forEach((r) =>
      console.log(
        `  ${r.name.padEnd(30)} ${r.state}  ${r.chamber.padEnd(6)}  ${r.missedPct.toFixed(2)}% missed  (${r.total} votes)  ${r.missedPct > ndMax ? "> nonDel max ✓" : r.missedPct > ndP99 ? "> nonDel p99" : "!! NOT an outlier"}`,
      ),
    );
  // Cross-check: are the top missers overall exactly the delegates?
  const topOverall = [...rows].sort((a, b) => b.missedPct - a.missedPct).slice(0, 10);
  console.log("\n  top-10 missers overall (delegate set should be at/near the top):");
  topOverall.forEach((r) =>
    console.log(
      `    ${r.name.padEnd(30)} ${r.state} ${r.chamber.padEnd(6)} ${r.missedPct.toFixed(2)}%${r.isDelegate ? "  [DELEGATE]" : ""}`,
    ),
  );

  console.log("\n§3 COUNTS:");
  console.log(`  non-delegate: house ${houseND.length}, senate ${senND.length}, total ${nonDel.length}`);
  console.log(`  delegate:     ${del.length}`);
  console.log(`  floored out (<${FLOOR} votes): ${flooredOut.length}`);
  flooredOut.forEach((f) => console.log(`      ${f.name.padEnd(30)} ${f.chamber} ${f.total} votes`));
  console.log(`  plotted-vs-roster: ${nonDel.length} plotted, ${del.length} carved, ${flooredOut.length} floored\n`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
