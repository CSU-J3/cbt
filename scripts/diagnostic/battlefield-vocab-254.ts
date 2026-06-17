// Diagnostic (read-only, HO 254): (1) distinct rating vocabulary per source, and
// (2) the per-seat averaged consensus on the battlefield fine-scale, so the
// marker/band/excluded split + clustering is known before the layout is built.
// Run: `npx tsx scripts/diagnostic/battlefield-vocab-254.ts`
import "dotenv/config";
import { getDb } from "../../lib/db";

// bucket string -> signed fine-scale numeric (D negative / R positive).
// Tilt = ±0.5 (IE-only tier between Toss-up and Lean); the stored rating_score
// flattens Tilt to ±1, so we MUST map from the string, not the score.
function scale(rating: string): number | null {
  if (rating === "Toss Up") return 0;
  const dir = rating.endsWith(" D") ? -1 : rating.endsWith(" R") ? 1 : null;
  if (dir === null) return null;
  if (rating.startsWith("Tilt")) return dir * 0.5;
  if (rating.startsWith("Lean")) return dir * 1;
  if (rating.startsWith("Likely")) return dir * 2;
  if (rating.startsWith("Solid") || rating.startsWith("Safe")) return dir * 3;
  return null;
}

async function main() {
  const db = getDb();

  const vocab = await db.execute(
    "SELECT source, rating, rating_score, COUNT(*) c FROM race_ratings GROUP BY source, rating, rating_score ORDER BY source, rating_score",
  );
  console.log("=== vocab ===");
  for (const row of vocab.rows) {
    console.log(
      `${String(row.source).padEnd(16)} | ${String(row.rating).padEnd(13)} | score=${String(row.rating_score).padStart(4)} | scaled=${scale(String(row.rating))} | n=${row.c}`,
    );
  }

  const rs = await db.execute({
    sql: `SELECT r.id, r.chamber,
            MAX(CASE WHEN rr.source='cook' THEN rr.rating END) cook,
            MAX(CASE WHEN rr.source='sabato' THEN rr.rating END) sabato,
            MAX(CASE WHEN rr.source='inside_elections' THEN rr.rating END) ie
          FROM races r
          INNER JOIN race_ratings rr ON rr.race_id = r.id AND rr.cycle = r.cycle
          WHERE r.cycle = ?
          GROUP BY r.id`,
    args: [2026],
  });

  // Mock lean-tier buckets (docs/dashboard-2col mock wins on layout): the
  // battlefield is competitive-only (Lean/Tilt/Toss), no Likely band.
  const tiers = { "LEAN D": 0, "TILT D": 0, "TOSS UP": 0, "TILT R": 0, "LEAN R": 0 } as Record<string, number>;
  let excluded = 0;
  for (const row of rs.rows) {
    const vals = [row.cook, row.sabato, row.ie]
      .filter((x): x is string => typeof x === "string")
      .map(scale)
      .filter((x): x is number => x !== null);
    if (vals.length === 0) continue;
    const c = vals.reduce((a, b) => a + b, 0) / vals.length;
    const abs = Math.abs(c);
    const bump = (k: string) => {
      tiers[k] = (tiers[k] ?? 0) + 1;
    };
    if (abs <= 0.25) bump("TOSS UP");
    else if (abs <= 0.75) bump(c < 0 ? "TILT D" : "TILT R");
    else if (abs <= 1.5) bump(c < 0 ? "LEAN D" : "LEAN R");
    else excluded++;
  }
  const competitive = Object.values(tiers).reduce((a, b) => a + b, 0);
  console.log("\n=== mock lean-tier split (cycle 2026) ===");
  for (const [k, v] of Object.entries(tiers)) console.log(`${k.padEnd(8)}: ${v}`);
  console.log(`competitive (on battlefield, |c|<=1.5): ${competitive}`);
  console.log(`excluded (|c|>1.5, likely/solid): ${excluded}`);
}

main().then(() => process.exit(0));
