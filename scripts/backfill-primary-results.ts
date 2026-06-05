// HO 206 — one-time primary results backfill. Lights up
// `primary_candidates.vote_pct` for the already-voted rostered primaries by
// re-reading the Ballotpedia race pages LIVE (the .cache/ is pre-results) and
// extracting the per-candidate share from the SAME 2026-primary votebox the
// roster came from (parseVotebox, HO 206) — never a page-wide scan, so the
// page's historical 2024/2022 voteboxes can't leak in.
//
// This is a results UPDATE keyed on the exact (primary_id, name) — it does NOT
// delete/re-insert rosters, so candidate counts are unchanged; only un-voted
// primaries stay NULL (we only write when the scraped share is non-NULL). The
// forward sync (lib/primaries-sync.ts) fills results for each remaining contest
// as it votes, via the roster INSERT that now carries vote_pct.
//
// Run: `npm run backfill:primary-results` (past rostered seats) or
//      `npm run backfill:primary-results -- --all` (every rostered seat).
import "dotenv/config";
import { getDb } from "../lib/db";
import {
  scrapeHouseCandidates,
  scrapeSenateCandidates,
} from "../lib/primary-candidates-scrape";
import { stateName } from "../lib/states";

const SLEEP_MS = 1100; // Ballotpedia politeness, matching the cron's per-unit pace
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const db = getDb();
  const all = process.argv.includes("--all");

  // One page per SEAT (a seat's D/R/open primaries share a Ballotpedia page).
  // Default: past-dated rostered seats only — that's where results exist; a
  // future seat returns NULL shares and no-ops the UPDATE, just wasting a fetch.
  const dateClause = all ? "" : "AND p.primary_date < date('now')";
  const seatsRs = await db.execute(`
    SELECT DISTINCT p.chamber, p.state, p.district
    FROM primaries p
    WHERE p.election_round = 'primary' ${dateClause}
      AND EXISTS (SELECT 1 FROM primary_candidates pc WHERE pc.primary_id = p.id)
    ORDER BY p.chamber, p.state, p.district
  `);
  const seats = seatsRs.rows;
  console.log(
    `Backfilling results for ${seats.length} ${all ? "all" : "past"} rostered seats…`,
  );

  const before = Number(
    (
      await db.execute(
        "SELECT COUNT(*) n FROM primary_candidates WHERE vote_pct IS NOT NULL",
      )
    ).rows[0]!.n,
  );

  let okFetches = 0;
  let emptyFetches = 0;
  let rowsUpdated = 0;
  const primariesTouched = new Set<string>();
  const now = new Date().toISOString();

  for (let i = 0; i < seats.length; i++) {
    const seat = seats[i]!;
    const chamber = seat.chamber as string;
    const state = seat.state as string;
    const districtStr = (seat.district as string | null) ?? null; // "40"/"00" house, null senate
    const slug = stateName(state).replace(/ /g, "_");

    const result =
      chamber === "senate"
        ? await scrapeSenateCandidates(state, slug) // already cache-free
        : await scrapeHouseCandidates(state, slug, Number(districtStr), {
            bypassCache: true, // .cache is pre-results
          });

    if (result.candidates.length > 0) okFetches++;
    else emptyFetches++;

    for (const c of result.candidates) {
      if (c.votePct == null) continue;
      const primaryId =
        chamber === "senate"
          ? `senate-${state}-2026-${c.contest}`
          : `house-${state}-${districtStr}-2026-${c.contest}`;
      const up = await db.execute({
        sql: "UPDATE primary_candidates SET vote_pct = ?, updated_at = ? WHERE primary_id = ? AND name = ?",
        args: [c.votePct, now, primaryId, c.name],
      });
      if (up.rowsAffected > 0) {
        rowsUpdated += up.rowsAffected;
        primariesTouched.add(primaryId);
      }
    }

    if ((i + 1) % 25 === 0 || i + 1 === seats.length) {
      console.log(
        `  …${i + 1}/${seats.length} seats · ${rowsUpdated} rows updated · ${primariesTouched.size} primaries`,
      );
    }
    await sleep(SLEEP_MS);
  }

  const after = Number(
    (
      await db.execute(
        "SELECT COUNT(*) n FROM primary_candidates WHERE vote_pct IS NOT NULL",
      )
    ).rows[0]!.n,
  );
  const rowTotal = Number(
    (await db.execute("SELECT COUNT(*) n FROM primary_candidates")).rows[0]!.n,
  );

  console.log("\n=== backfill complete ===");
  console.log(`seats fetched ok: ${okFetches} | empty/failed: ${emptyFetches}`);
  console.log(`candidate rows updated this run: ${rowsUpdated}`);
  console.log(`primaries with ≥1 result: ${primariesTouched.size}`);
  console.log(
    `vote_pct populated: ${before} → ${after} of ${rowTotal} candidate rows`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
