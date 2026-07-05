// HO 427 — per-Congress polarization medians from Voteview HSall (the data gate
// for ship 3, the polarization-over-time chart).
//
// Reads the full HSall_members.csv history once, keeps strict D/R (party_code 100/
// 200), and writes one `polarization_history` row per (congress, chamber) carrying
// the median nominate_dim1 for each party. A few hundred median rows out of ~50k
// member-rows; the raw file is discarded, never stored per-member.
//
// PARTY IS BY CAUCUS (party_code) END TO END — the only option historically, since
// departed members of past Congresses aren't in `members`. This differs from
// getPolarizationBand, which filters members.party (registration); the two agree in
// the aggregate but not on caucusing independents (Kiley/King/Sanders). See the
// coverage diagnostic's 119th cross-check for the accounting.
//
// median() is pinned inline here — the identical strict method the band query and
// the dotplot component use (sort asc; odd -> middle, even -> mean of two middle).
// Three inline copies now exist; a shared dependency-free util is QUEUED cleanup
// (do NOT refactor the shipped copies in this handoff).
//
// Manual, matches sync:ideology / sync:crosswalk — nothing schedules it. Idempotent:
// a full recompute from source, upserting both medians on (congress, chamber).
import "dotenv/config";
import { getDb } from "../lib/db";
import { fetchVoteviewHSall } from "./voteview-source";

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const hi = sorted[mid] as number;
  return sorted.length % 2 === 0 ? ((sorted[mid - 1] as number) + hi) / 2 : hi;
}

// Voteview 'House' | 'Senate' -> the app's lowercase convention. 'President' rows
// (party medians undefined for a single executive) are dropped by returning null.
function normalizeChamber(vv: string): "house" | "senate" | null {
  if (vv === "House") return "house";
  if (vv === "Senate") return "senate";
  return null;
}

type Accum = { dem: number[]; rep: number[] };

async function main() {
  const db = getDb();

  // 1. Fetch + quote-aware parse the full history.
  const rows = await fetchVoteviewHSall();
  console.log(`Fetched ${rows.length} Voteview HSall rows`);

  // 2. Group dim1 by (congress, chamber, party). Strict D/R (100/200) only;
  //    null dim1 and non-two-party rows skipped.
  const groups = new Map<string, Accum>();
  let kept = 0;
  for (const m of rows) {
    if (m.nominate_dim1 == null) continue;
    if (m.party_code !== 100 && m.party_code !== 200) continue;
    const chamber = normalizeChamber(m.chamber);
    if (!chamber) continue;
    if (!Number.isFinite(m.congress)) continue;

    const key = `${m.congress}|${chamber}`;
    let acc = groups.get(key);
    if (!acc) {
      acc = { dem: [], rep: [] };
      groups.set(key, acc);
    }
    if (m.party_code === 100) acc.dem.push(m.nominate_dim1);
    else acc.rep.push(m.nominate_dim1);
    kept++;
  }
  console.log(
    `Kept ${kept} D/R rows -> ${groups.size} (congress, chamber) groups`,
  );

  // 3. Upsert one row per group with the two medians. Full recompute, so overwrite.
  let upserted = 0;
  for (const [key, acc] of groups) {
    const [congressStr, chamber] = key.split("|");
    const congress = Number(congressStr);
    const demMedian = median(acc.dem);
    const repMedian = median(acc.rep);
    await db.execute({
      sql: `INSERT INTO polarization_history (congress, chamber, dem_median, rep_median)
            VALUES (?,?,?,?)
            ON CONFLICT(congress, chamber) DO UPDATE SET
              dem_median = excluded.dem_median,
              rep_median = excluded.rep_median`,
      args: [congress, chamber as string, demMedian, repMedian],
    });
    upserted++;
  }

  console.log("\n=== Polarization-history sync — HO 427 ===");
  console.log(`fetched (HSall rows):          ${rows.length}`);
  console.log(`kept (D/R, dim1 present):      ${kept}`);
  console.log(`rows upserted (congress×chamber): ${upserted}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
