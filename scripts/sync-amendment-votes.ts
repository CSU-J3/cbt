// Local CLI for the amendment→vote linkage layer. Two modes:
//
//   npm run sync:amendment-votes -- --senate  # materialize Senate links (HO 537)
//   npm run sync:amendment-votes -- --walk     # House linkage walk (HO 532)
//   npm run sync:amendment-votes               # default = the House walk
//
// --senate (HO 537): a pure DB recompute — parses each senate up-or-down
// amendment-question vote (votes.question) and delete-then-inserts the Senate
// links into amendment_votes. NO API calls (needs only Turso creds); idempotent.
//
// --walk (HO 532): recovers each HAMDT's roll-call link from /actions.recordedVotes
// (House questions carry no number). Needs CONGRESS_API_KEY. Senate needs no walk.
//
// Both share amendment_votes; the reads join it (getBillAmendmentVotes House path,
// and the HO 537 corpus voted cut).
import "dotenv/config";
import { walkAmendmentVotes } from "../lib/amendment-votes-walk";
import { materializeSenateAmendmentVotes } from "../lib/amendment-votes-senate";

async function main() {
  // --senate: the Senate materializer (DB-only, no CONGRESS_API_KEY needed).
  if (process.argv.includes("--senate")) {
    const t0 = Date.now();
    const r = await materializeSenateAmendmentVotes();
    console.log(
      `[amendment-votes:senate] scanned=${r.scanned} matched=${r.matched} ` +
        `linksWritten=${r.linksWritten} changed=${r.changed} unmatchedQuestions=${r.unmatchedQuestions} ` +
        `(${((Date.now() - t0) / 1000).toFixed(1)}s)`,
    );
    process.exit(0);
  }

  // default / --walk: the House linkage walk.
  if (!process.env.CONGRESS_API_KEY) {
    console.error("CONGRESS_API_KEY not set — required for the Congress.gov /amendment/.../actions endpoint.");
    process.exit(1);
  }
  const t0 = Date.now();
  const r = await walkAmendmentVotes({}); // unbounded — the CLI drains the whole queue
  console.log(
    `[amendment-votes] walked=${r.walked} linksInserted=${r.linksInserted} ` +
      `hamdtWithVote=${r.hamdtWithVote} fetchErrors=${r.fetchErrors} remaining=${r.remaining} ` +
      `(${((Date.now() - t0) / 1000).toFixed(1)}s)`,
  );
  process.exit(r.remaining === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
