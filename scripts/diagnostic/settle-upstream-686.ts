// HO 686 — READ-ONLY upstream read. Does Ballotpedia carry a winner NOW for the
// settle-window rows, and what date does the source itself give the contest?
//
// BUILDS NOTHING AND WRITES NOTHING. No DB writes of any kind — the DB is read
// only to name the rows to compare against. The upstream side is a live fetch.
//
// INSTRUMENT: the EXISTING scrape path (`scrapeHouseCandidates` from
// lib/primary-candidates-scrape), NOT a raw fetch. That is deliberate — the
// question is "would the recovery heal this row", and the recovery
// (backfill-primary-results / reingest-primary-slate) reads through exactly this
// function. A raw fetch could report a winner the parser does not extract, which
// would be a wrong answer to the question actually being asked.
//
// `bypassCache: true` is MANDATORY (HO 206): `.cache/ballotpedia` is pre-results
// HTML scraped ~May 20, so a cached read reports NO winner for every contest and
// is indistinguishable from a genuine upstream gap.
//
// CONTROL. The target is read beside a contest known settled-and-healed in our
// DB. If the control shows a winner upstream and the target does not, the target's
// gap is real. If the CONTROL shows no winner either, the parser or the fetch is
// the problem and the target reading is void — a zero here would otherwise mean
// "no winner upstream" and "instrument blind" identically, which is the whole
// failure mode this control exists to separate.
//
//   npx tsx scripts/diagnostic/settle-upstream-686.ts
import "dotenv/config";
import { getDb } from "@/lib/db";
import { scrapeHouseCandidates } from "@/lib/primary-candidates-scrape";
import { stateName } from "@/lib/states";

const SLEEP_MS = 1100; // Ballotpedia politeness, matching the cron's per-unit pace
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// role: which question this seat answers. "control" must show a winner.
const SEATS: { role: string; state: string; district: number; primaryId: string }[] = [
  { role: "TARGET ", state: "AZ", district: 3, primaryId: "house-AZ-03-2026-R" },
  { role: "CONTROL", state: "WA", district: 8, primaryId: "house-WA-08-2026-open" },
];

async function main() {
  const db = getDb();
  console.log("HO 686 — upstream winner read (live Ballotpedia, via the scrape path)\n");

  for (const seat of SEATS) {
    const slug = stateName(seat.state).replace(/ /g, "_");
    const res = await scrapeHouseCandidates(seat.state, slug, seat.district, {
      bypassCache: true,
    });
    console.log(`── ${seat.role}  ${seat.state}-${String(seat.district).padStart(2, "0")}`);
    console.log(`   url=${res.url}`);
    console.log(`   status=${res.status}  candidates=${res.candidates.length}`);

    const byContest = new Map<string, typeof res.candidates>();
    for (const c of res.candidates) {
      const k = c.contest;
      if (!byContest.has(k)) byContest.set(k, []);
      byContest.get(k)!.push(c);
    }
    for (const [contest, list] of byContest) {
      const winners = list.filter((c) => c.isWinner);
      console.log(`   contest "${contest}": ${list.length} candidates, ${winners.length} marked winner`);
      for (const c of list) {
        console.log(
          `     ${c.isWinner ? "WINNER " : "       "} ${String(c.votePct ?? "—").padStart(6)}%  ${c.name} (${c.party ?? "?"})${c.incumbent ? " [INC]" : ""}`,
        );
      }
    }
    if (byContest.size === 0) console.log("   (no contests parsed)");

    // our side, for the same seat
    const ours = await db.execute({
      sql: `SELECT name, status, vote_pct FROM primary_candidates
             WHERE primary_id = ? ORDER BY (vote_pct IS NULL), vote_pct DESC`,
      args: [seat.primaryId],
    });
    const ourWinners = ours.rows.filter((r) => String(r.status) === "winner").length;
    console.log(`   OUR ${seat.primaryId}: ${ours.rows.length} rows, ${ourWinners} winner`);
    console.log("");
    await sleep(SLEEP_MS);
  }

  console.log("Read the CONTROL first: if it shows 0 winners upstream, the target reading is VOID.");
}

main().catch((e) => {
  console.error(String(e));
  process.exitCode = 1;
});
