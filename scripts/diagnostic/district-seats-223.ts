// Diagnostic (read-only, HO 223 Phase A): dump the getRacesIndex(2026) House
// seat keys, grouped by state, and flag the seats in states that redrew between
// the 118th/119th (AL GA LA NC NY) or for the 120th mid-decade (TX CA MO NC OH
// UT). Also surfaces the incumbent + consensus competitiveness so we can name
// the specific competitive seats where boundary-cycle choice actually matters.
// Run: `npx tsx scripts/diagnostic/district-seats-223.ts`
import "dotenv/config";
import { getDb } from "../../lib/db";

const REDRAW_118_119 = new Set(["AL", "GA", "LA", "NC", "NY"]);
const REDRAW_120 = new Set(["TX", "CA", "MO", "NC", "OH", "UT"]);

function cons(s: Array<number | null>): number | null {
  const p = s.filter((x): x is number => x !== null);
  if (!p.length) return null;
  return p.reduce((b, x) => (Math.abs(x) < Math.abs(b) ? x : b));
}
function comp(score: number | null): string {
  if (score == null) return "?";
  const a = Math.abs(score);
  return a === 0 ? "TOSS" : a === 1 ? "LEAN" : "lik/sol";
}

async function main() {
  const db = getDb();
  const rs = await db.execute({
    sql: `SELECT r.id, r.chamber, r.state, r.district, r.cycle,
                 r.incumbent_bioguide_id, m.name AS inc, m.district AS m_district,
                 MAX(CASE WHEN rr.source='cook' THEN rr.rating_score END) c,
                 MAX(CASE WHEN rr.source='sabato' THEN rr.rating_score END) s,
                 MAX(CASE WHEN rr.source='inside_elections' THEN rr.rating_score END) i
          FROM races r
          INNER JOIN race_ratings rr ON rr.race_id = r.id AND rr.cycle = r.cycle
          LEFT JOIN members m ON m.bioguide_id = r.incumbent_bioguide_id
          WHERE r.cycle = 2026 GROUP BY r.id`,
    args: [],
  });

  const house: any[] = [];
  const senate: any[] = [];
  for (const row of rs.rows) {
    const o = {
      id: row.id as string,
      state: row.state as string,
      district: row.district as number | null,
      mDistrict: row.m_district as number | null,
      inc: (row.inc as string | null) ?? "(open/unmapped)",
      score: cons([row.c as any, row.s as any, row.i as any]),
    };
    if ((row.chamber as string) === "senate") senate.push(o);
    else house.push(o);
  }

  // Per-state House counts
  const byState = new Map<string, any[]>();
  for (const h of house) {
    if (!byState.has(h.state)) byState.set(h.state, []);
    byState.get(h.state)!.push(h);
  }

  console.log(`\n=== HO 223 Phase A — getRacesIndex(2026) seat keys ===`);
  console.log(`House seats: ${house.length} · Senate: ${senate.length} · total ${house.length + senate.length}`);
  console.log(`House states: ${[...byState.keys()].sort().join(" ")}`);

  console.log(`\n--- Race-row district vs member.district mismatches (boundary-cycle tell) ---`);
  let mismatch = 0;
  for (const h of house) {
    if (h.district !== h.mDistrict) {
      mismatch++;
      console.log(`  ${h.id}  race.district=${h.district}  member.district=${h.mDistrict}  (${h.inc})`);
    }
  }
  if (mismatch === 0) console.log(`  none — every House race.district == its incumbent's member.district`);

  console.log(`\n--- Seats in 118→119 redraw states (AL GA LA NC NY) ---`);
  for (const st of [...REDRAW_118_119].sort()) {
    const seats = byState.get(st) ?? [];
    console.log(`  ${st}: ${seats.length} seat(s) -> ${seats.map((x) => `${x.id.replace("-2026", "")}[${comp(x.score)}]`).join(" ")}`);
  }

  console.log(`\n--- Seats in 120th mid-decade redraw states (TX CA MO NC OH UT) ---`);
  for (const st of [...REDRAW_120].sort()) {
    const seats = byState.get(st) ?? [];
    console.log(`  ${st}: ${seats.length} seat(s) -> ${seats.map((x) => `${x.id.replace("-2026", "")}[${comp(x.score)}]`).join(" ")}`);
  }

  console.log(`\n--- COMPETITIVE (toss-up/lean) seats in ANY redraw state ---`);
  const allRedraw = new Set([...REDRAW_118_119, ...REDRAW_120]);
  const hot = house
    .filter((h) => allRedraw.has(h.state) && h.score != null && Math.abs(h.score) <= 1)
    .sort((a, b) => a.state.localeCompare(b.state) || (a.district ?? 0) - (b.district ?? 0));
  for (const h of hot) {
    console.log(`  ${h.id.replace("-2026", "")}  ${comp(h.score)}  ${h.inc}`);
  }
  console.log(`  (${hot.length} competitive seats sit in redrawn states)`);

  // At-large / DC / territory check
  console.log(`\n--- At-large / zero-district House seats (district-id resolution) ---`);
  const al = house.filter((h) => h.district === 0 || h.district == null);
  console.log(al.length ? al.map((x) => `${x.id} (district=${x.district})`).join(", ") : "  none");
}

main().then(() => process.exit(0)).catch((e) => {
  console.error(e);
  process.exit(1);
});
