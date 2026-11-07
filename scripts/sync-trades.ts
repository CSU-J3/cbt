// Standalone CLI for the stock-trades ingest (HO 806): the same ingestTrades
// /api/sync runs. `--dry-run` fetches, matches and diffs against the database
// and writes nothing. A CLI can't flush the cache from outside Next, so after a
// real run that wrote rows, flush `member-trades` through /api/revalidate.
//
// Usage: `npm run sync:trades [-- --dry-run]`
import "dotenv/config";
import { ingestTrades } from "../lib/trades-ingest";

async function main() {
  const r = await ingestTrades({ dryRun: process.argv.includes("--dry-run") });
  const skips = Object.entries(r.skipped);
  console.log(`dryRun:        ${r.dryRun}`);
  console.log(`fetched:       ${r.fetched}`);
  console.log(`kept:          ${r.kept}`);
  console.log(
    `skipped:       ${skips.length ? skips.map(([k, n]) => `${k} ${n}`).join(", ") : "0"}`,
  );
  console.log(`duplicateIds:  ${r.duplicateIds}`);
  console.log(`byChamber:     house ${r.byChamber.house}, senate ${r.byChamber.senate}`);
  console.log(`window:        ${r.window.from} to ${r.window.to}`);
  console.log(`domain:        ${r.domain}`);
  console.log(`inserted:      ${r.inserted}${r.dryRun ? " (would insert)" : ""}`);
  console.log(`updated:       ${r.updated}${r.dryRun ? " (would update)" : ""}`);
  console.log(`deleted:       ${r.deleted}${r.dryRun ? " (would delete)" : ""}`);
  console.log(`deleteRefused: ${r.deleteRefused}`);
  console.log(`matched:       ${r.matched} of ${r.kept}`);
  console.log(`ownerOther:    ${r.ownerOther}`);
  console.log(`unmatchedNames: ${r.unmatchedNames.length}`);
  for (const name of r.unmatchedNames) console.log(`  ${name}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
