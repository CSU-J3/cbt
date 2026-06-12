// Reusable primary-results re-ingestion for a single state's slate on a given
// date. Mirrors backfill-primary-results.ts's VERIFIED idempotent semantics —
// UPDATE primary_candidates.vote_pct/status keyed on (primary_id, name), writing
// only when the live Ballotpedia votebox returns a non-NULL share; it never
// deletes/re-inserts rosters. Both chambers (House subset for House-only states
// like CA; Senate handled the same as the backfill).
//
// Args (positional): STATE (default CA), DATE YYYY-MM-DD (default 2026-06-02).
//   npx tsx scripts/reingest-primary-slate.ts [STATE] [YYYY-MM-DD]
//   npm run reingest:primary-slate -- CA 2026-06-02
//
// Built for the recurring need: the early-July CA certification pass (June shares
// are mid-count) and the next stale/slow-count slate. Output distinguishes rows
// NEW (vote_pct NULL → set), UPDATED (re-written), NO-MATCH (votebox share with
// no matching roster row — drift/write-ins), and seats with NO VOTEBOX at source.
//
// No cache flush: the primaries surfaces are uncached (force-dynamic /primaries +
// plain db.execute helpers; neither this nor the forward sync flushes a tag), so
// fresh shares show on the next request.
import "dotenv/config";
import { getDb } from "../lib/db";
import {
  scrapeHouseCandidates,
  scrapeSenateCandidates,
} from "../lib/primary-candidates-scrape";
import { stateName } from "../lib/states";

const STATE = (process.argv[2] || "CA").toUpperCase();
const DATE = process.argv[3] || "2026-06-02";
const SLEEP_MS = 1100; // Ballotpedia politeness, matching the cron's per-unit pace
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(DATE)) {
    console.error(`bad date "${DATE}" — expected YYYY-MM-DD`);
    process.exit(1);
  }
  const db = getDb();
  const slug = stateName(STATE).replace(/ /g, "_");

  // One page per seat (a seat's contests share a Ballotpedia page).
  const seatsRs = await db.execute({
    sql: `SELECT DISTINCT p.chamber, p.district
          FROM primaries p
          WHERE p.state = ? AND p.primary_date = ? AND p.election_round = 'primary'
            AND EXISTS (SELECT 1 FROM primary_candidates pc WHERE pc.primary_id = p.id)
          ORDER BY p.chamber, p.district`,
    args: [STATE, DATE],
  });
  const seats = seatsRs.rows;
  if (seats.length === 0) {
    console.log(`No rostered ${STATE} primaries on ${DATE} — nothing to do.`);
    return;
  }

  // Before-state of every candidate's vote_pct, to classify new vs updated.
  const beforeRs = await db.execute({
    sql: `SELECT pc.primary_id, pc.name, pc.vote_pct
          FROM primary_candidates pc
          JOIN primaries p ON p.id = pc.primary_id
          WHERE p.state = ? AND p.primary_date = ? AND p.election_round = 'primary'`,
    args: [STATE, DATE],
  });
  const beforePct = new Map<string, number | null>();
  for (const r of beforeRs.rows) {
    beforePct.set(
      `${r.primary_id as string} ${r.name as string}`,
      (r.vote_pct as number | null) ?? null,
    );
  }

  console.log(
    `Re-ingesting ${STATE} ${DATE} slate: ${seats.length} seats, ${beforeRs.rows.length} candidate rows.\n`,
  );

  let rowsNew = 0;
  let rowsUpdated = 0;
  let rowsNoMatch = 0;
  let seatsOk = 0;
  const noVoteboxSeats: string[] = [];
  const now = new Date().toISOString();

  for (let i = 0; i < seats.length; i++) {
    const seat = seats[i]!;
    const chamber = seat.chamber as string;
    const districtStr = (seat.district as string | null) ?? null;
    const seatLabel = `${STATE}-${districtStr ?? "SEN"}`;

    const result =
      chamber === "senate"
        ? await scrapeSenateCandidates(STATE, slug) // already cache-free
        : await scrapeHouseCandidates(STATE, slug, Number(districtStr), {
            bypassCache: true, // .cache is pre-results
          });

    const withShare = result.candidates.filter((c) => c.votePct != null);
    if (withShare.length === 0) noVoteboxSeats.push(seatLabel);
    else seatsOk++;

    for (const c of withShare) {
      const primaryId =
        chamber === "senate"
          ? `senate-${STATE}-2026-${c.contest}`
          : `house-${STATE}-${districtStr}-2026-${c.contest}`;
      const before = beforePct.get(`${primaryId} ${c.name}`);
      const up = await db.execute({
        sql: "UPDATE primary_candidates SET vote_pct = ?, status = ?, updated_at = ? WHERE primary_id = ? AND name = ?",
        args: [
          c.votePct,
          c.isWinner ? "winner" : "running",
          now,
          primaryId,
          c.name,
        ],
      });
      if (up.rowsAffected > 0) {
        if (before == null) rowsNew++;
        else rowsUpdated++;
      } else {
        rowsNoMatch++;
      }
    }

    await sleep(SLEEP_MS);
  }

  console.log("\n=== re-ingestion complete ===");
  console.log(`state/date: ${STATE} ${DATE}`);
  console.log(`seats fetched with a votebox: ${seatsOk}/${seats.length}`);
  console.log(`rows NEW (NULL → value):        ${rowsNew}`);
  console.log(`rows UPDATED (value re-written): ${rowsUpdated}`);
  console.log(`rows NO-MATCH (share, no roster row): ${rowsNoMatch}`);
  console.log(
    `seats with NO VOTEBOX at source (${noVoteboxSeats.length}): ${noVoteboxSeats.join(", ") || "none"}`,
  );
  console.log(
    `\nLanded (new+updated): ${rowsNew + rowsUpdated} rows. ${
      rowsNew + rowsUpdated > 0
        ? "No cache flush needed — primaries surfaces are uncached."
        : "Nothing changed."
    }`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
