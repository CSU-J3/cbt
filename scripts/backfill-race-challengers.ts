// HO 213 Part A: the MANUAL path for the challenger harvest — the harvest
// itself lives in lib/harvest-challengers.ts as of HO 660, shared with the
// daily cron (/api/cron/race-challengers). This wrapper is the hand-run: it
// adds the before-census, the sample eyeball and the flush reminder that a
// scheduled fire has no use for. Wiring a clock did not retire the hand-run.
//
// What the shared harvest does, in one line each (full rationale in the lib):
// non-incumbent primary winners → race_candidates for every 2026 seat whose
// primary has voted (the rated-index gate went at HO 741), idempotent under the
// `harvest:primary_winner` sentinel, hand-curated rosters (HO 171/174/182)
// untouched, coverage partial by design. HO 750: every race with a `box` read
// and no curated roster now takes the November ballot instead, under
// `harvest:general_ballot`; the primary-sourced rows cover the races with no box.
//
// Run: `npm run backfill:race-challengers`. Then flush the cache:
//   POST /api/revalidate?tag=races  (seed scripts don't auto-flush, per SKILL).
//   The CRON path flushes itself; only this one leaves it to you.
import "dotenv/config";
import { getDb } from "../lib/db";
import { BALLOT_SOURCE, HARVEST_SOURCE, harvestChallengers } from "../lib/harvest-challengers";

async function main() {
  const db = getDb();

  const before = await db.execute(
    `SELECT COUNT(*) AS rows, COUNT(DISTINCT race_id) AS races FROM race_candidates`,
  );
  console.log(
    `race_candidates before: ${before.rows[0]?.rows ?? 0} rows / ${before.rows[0]?.races ?? 0} races`,
  );

  const result = await harvestChallengers(db);
  console.log(`run stamp: ${result.runStamp}`);
  console.log(`cleared ${result.cleared} prior harvested rows`);
  console.log(`inserted ${result.inserted} harvested challenger rows`);
  console.log(
    `\nharvested: ${result.rows} rows across ${result.races} races ` +
      `(of ${result.seats} 2026 seats; the rated index is ${result.ratedIndex})`,
  );
  // HO 750: two sentinels, the ballot-sourced roster and the primary-sourced one.
  console.log(`by sentinel: ${JSON.stringify(result.bySource)}`);
  console.log(
    `ballot-sourced races ${result.ballotRaces} · rows planned ${result.ballotPlanned} · ` +
      `ignored on a (race, name) collision ${result.ballotIgnored}`,
  );
  console.log(`incumbent rule routes: ${JSON.stringify(result.incumbentRoutes)}`);
  console.log(
    `curated races diverging from the ballot: ${result.curatedDivergence.length ? result.curatedDivergence.join(" · ") : "none"}`,
  );
  // HO 757: the others on party-primary ballots, the fusion prints kept, and the O others' parties.
  console.log(`on_ballot (others, ruled C): ${JSON.stringify(result.onBallot)} · fusion prints ${result.fusionPrints} · O parties printed ${result.oPrints}`);
  // HO 758: Louisiana's jungle seats.
  console.log(`jungle (Louisiana's Nov-3 box): ${JSON.stringify(result.jungle)}`);

  // Sample for eyeballing — wrapper-only; the cron logs figures, not rows.
  const sample = await db.execute({
    sql: `SELECT rc.race_id, rc.name, rc.party
          FROM race_candidates rc WHERE rc.source_url IN (?, ?)
          ORDER BY rc.race_id, rc.name LIMIT 16`,
    args: [HARVEST_SOURCE, BALLOT_SOURCE],
  });
  console.log("\nsample harvested challengers:");
  for (const r of sample.rows)
    console.log(`  ${r.race_id}: ${r.name} (${r.party})`);

  console.log(
    "\nDONE. Flush cache: POST /api/revalidate?tag=races (with Bearer CRON_SECRET).",
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
