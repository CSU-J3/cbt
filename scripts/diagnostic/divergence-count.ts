// Diagnostic (read-only): count Kalshi-favored-party vs rater-consensus
// disagreement across the rated seats. Mirrors getRacesIndex's join + the
// in-JS consensus pick (smallest |rating_score| wins). For each seat with a
// Kalshi market AND a resolvable favored party, compare Kalshi's favored party
// against the sign of the consensus rating_score (positive = R, negative = D).
// Run: `npx tsx scripts/diagnostic/divergence-count.ts`
import "dotenv/config";
import { getDb } from "../../lib/db";

function consensusScore(scores: Array<number | null>): number | null {
  const present = scores.filter((s): s is number => s !== null);
  if (present.length === 0) return null;
  return present.reduce((best, s) => (Math.abs(s) < Math.abs(best) ? s : best));
}

async function main() {
  const db = getDb();
  const rs = await db.execute({
    sql: `SELECT r.id, r.chamber, r.state, r.district,
                 m.name AS inc_name, m.party AS inc_party,
                 ko.favorite_label, ko.favorite_is_party, ko.favorite_party,
                 ko.implied_pct,
                 MAX(CASE WHEN rr.source='cook' THEN rr.rating_score END) AS cook,
                 MAX(CASE WHEN rr.source='sabato' THEN rr.rating_score END) AS sabato,
                 MAX(CASE WHEN rr.source='inside_elections' THEN rr.rating_score END) AS ie,
                 MAX(CASE WHEN rr.source='cook' THEN rr.rating END) AS cook_r,
                 MAX(CASE WHEN rr.source='sabato' THEN rr.rating END) AS sabato_r,
                 MAX(CASE WHEN rr.source='inside_elections' THEN rr.rating END) AS ie_r
          FROM races r
          INNER JOIN race_ratings rr ON rr.race_id = r.id AND rr.cycle = r.cycle
          LEFT JOIN members m ON m.bioguide_id = r.incumbent_bioguide_id
          LEFT JOIN kalshi_odds ko ON ko.race_id = r.id
          WHERE r.cycle = 2026
          GROUP BY r.id`,
    args: [],
  });

  let rated = 0;
  let withKalshi = 0;
  let favorPartyResolvable = 0;
  let comparable = 0; // resolvable fav party AND non-zero (non-tossup) consensus
  let tossupConsensus = 0; // consensus score == 0 (no directional consensus)
  const divergences: string[] = [];
  const agreements: string[] = [];

  for (const row of rs.rows) {
    rated++;
    const seat =
      row.chamber === "senate"
        ? `${row.state} SEN`
        : `${row.state}-${String(row.district ?? 0).padStart(2, "0")}`;

    const cs = consensusScore([
      row.cook as number | null,
      row.sabato as number | null,
      row.ie as number | null,
    ]);
    const consRating =
      (row.cook_r as string | null) ??
      (row.sabato_r as string | null) ??
      (row.ie_r as string | null) ??
      "?";

    if (row.implied_pct == null) continue;
    withKalshi++;

    // Resolve Kalshi favored party. Party-labeled markets carry favorite_party.
    // Name-labeled markets resolve against the incumbent only (the live card
    // also checks challengers, but race_candidates is empty for ~133/137, so
    // incumbent-match is the realistic resolver here).
    let favParty: string | null = (row.favorite_party as string | null) ?? null;
    const isParty = Number(row.favorite_is_party) === 1;
    if (!favParty && !isParty) {
      const fav = String(row.favorite_label ?? "")
        .toLowerCase()
        .replace(/[.,]/g, " ")
        .split(/\s+/)
        .filter(Boolean)
        .pop();
      const incLast = String(row.inc_name ?? "")
        .toLowerCase()
        .replace(/[.,]/g, " ")
        .split(/\s+/)
        .filter(Boolean)
        .pop();
      if (fav && incLast && fav === incLast) {
        const p = String(row.inc_party ?? "");
        favParty = p.startsWith("R") ? "R" : p.startsWith("D") ? "D" : p.startsWith("I") ? "I" : null;
      }
    }

    if (!favParty) continue;
    favorPartyResolvable++;

    if (cs == null) continue;
    if (cs === 0) {
      tossupConsensus++;
      continue;
    }
    comparable++;

    const consParty = cs > 0 ? "R" : "D";
    const line = `${seat.padEnd(8)}  Kalshi→${favParty} ${String(row.implied_pct).padStart(3)}%   consensus=${consRating} (score ${cs}, ${consParty})`;
    if (favParty !== consParty && (favParty === "R" || favParty === "D")) {
      divergences.push(line);
    } else {
      agreements.push(line);
    }
  }

  console.log(`\n=== DIVERGENCE-FLAG COVERAGE (rated 2026 seats) ===`);
  console.log(`rated seats (INNER JOIN race_ratings):       ${rated}`);
  console.log(`  with a Kalshi market (implied_pct set):    ${withKalshi}`);
  console.log(`  with a RESOLVABLE Kalshi favored party:    ${favorPartyResolvable}`);
  console.log(`  consensus is Toss Up (score 0, no dir):    ${tossupConsensus}`);
  console.log(`  COMPARABLE (fav party + directional cons): ${comparable}`);
  console.log(`\n  >> DIVERGENCES (Kalshi vs consensus disagree): ${divergences.length}`);
  for (const d of divergences) console.log(`     ${d}`);
  console.log(`\n  agreements: ${agreements.length}`);
  for (const a of agreements) console.log(`     ${a}`);
}

main().then(() => process.exit(0)).catch((e) => {
  console.error(e);
  process.exit(1);
});
