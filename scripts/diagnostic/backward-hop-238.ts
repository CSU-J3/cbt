// Backward-hop diagnostic (measure only). HO 238 sweep follow-up.
// (1) adjudicate 119-hr-8467's committee->introduced hop.
// (2) corpus-wide backward slot-pair rate from bills(previous_stage, stage).
import "dotenv/config";
import { getDb } from "../../lib/db";

const STAGE_RANK: Record<string, number> = {
  introduced: 0, committee: 1, floor: 2, other_chamber: 3, president: 4, enacted: 5,
};

async function main() {
  const db = getDb();

  // --- Item 1: the specific bill ---
  console.log("=== Item 1: 119-hr-8467 ===");
  const bill = await db.execute({
    sql: `SELECT id, title, stage, previous_stage, stage_changed_at,
                 latest_action_date, latest_action_text
          FROM bills WHERE id = ?`,
    args: ["119-hr-8467"],
  });
  const b = bill.rows[0];
  if (!b) {
    console.log("  (bill not found)");
  } else {
    console.log(`  title: ${String(b.title).slice(0, 80)}`);
    console.log(`  stage: ${b.previous_stage} -> ${b.stage}   (changed_at ${b.stage_changed_at})`);
    console.log(`  latest_action_date: ${b.latest_action_date}`);
    console.log(`  latest_action_text: ${b.latest_action_text}`);
  }
  const hist = await db.execute({
    sql: `SELECT from_stage, to_stage, changed_at
          FROM stage_transitions WHERE bill_id = ? ORDER BY changed_at ASC`,
    args: ["119-hr-8467"],
  });
  console.log(`  stage_transitions log (${hist.rows.length} rows):`);
  for (const r of hist.rows) {
    const p = r.from_stage ? STAGE_RANK[String(r.from_stage)] : undefined;
    const n = STAGE_RANK[String(r.to_stage)];
    const dir =
      p === undefined || n === undefined ? "?" : n > p ? "fwd" : n < p ? "BACK" : "same";
    console.log(`    ${r.changed_at}  ${String(r.from_stage)}->${r.to_stage}  [${dir}]`);
  }

  // --- Item 2: corpus backward rate ---
  console.log("\n=== Item 2: corpus backward slot-pair rate (bills table) ===");
  const pairs = await db.execute({
    sql: `SELECT previous_stage, stage, COUNT(*) AS n
          FROM bills
          WHERE previous_stage IS NOT NULL AND stage IS NOT NULL
          GROUP BY previous_stage, stage`,
    args: [],
  });
  let totalWithBoth = 0, backwardTotal = 0;
  const backwardPairs: Array<{ pair: string; n: number }> = [];
  for (const r of pairs.rows) {
    const prev = String(r.previous_stage), st = String(r.stage);
    const n = Number(r.n);
    totalWithBoth += n;
    const p = STAGE_RANK[prev], c = STAGE_RANK[st];
    if (p === undefined || c === undefined) continue;
    if (p > c) { backwardTotal += n; backwardPairs.push({ pair: `${prev}->${st}`, n }); }
  }
  backwardPairs.sort((a, b) => b.n - a.n);
  const pct = totalWithBoth ? ((backwardTotal / totalWithBoth) * 100).toFixed(2) : "0";
  console.log(`  bills with both slots set: ${totalWithBoth}`);
  console.log(`  backward pairs (prev ranks LATER than stage): ${backwardTotal}  (${pct}%)`);
  console.log(`  by pair:`);
  for (const bp of backwardPairs) console.log(`    ${bp.pair.padEnd(28)} ${bp.n}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
