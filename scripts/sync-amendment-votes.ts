// Local CLI for the House amendment→vote linkage walk (HO 532). Same code path the
// amendments cron's bounded walk step invokes — both share walkAmendmentVotes from
// lib/amendment-votes-walk.ts.
//
//   npm run sync:amendment-votes -- --walk   # unbounded one-time backfill (~228 HAMDT /actions GETs)
//   npm run sync:amendment-votes             # same (the CLI has one mode: the full walk)
//
// Recovers each HAMDT's roll-call link from /actions.recordedVotes and persists it
// to amendment_votes. Senate needs no walk (votes.question carries the number, HO
// 530). Needs CONGRESS_API_KEY in .env.
import "dotenv/config";
import { walkAmendmentVotes } from "../lib/amendment-votes-walk";

async function main() {
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
