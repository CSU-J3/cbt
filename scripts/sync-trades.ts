// Standalone CLI for the stock-trades ingestion pipeline (handoff 70).
// Runs the same code path the cron route uses, but with the 20-page cap
// suited to an initial backfill rather than the 3-page cap used in cron.
//
// Usage: `npm run sync:trades`
import "dotenv/config";
import { ingestTrades } from "../lib/trades-ingest";

async function main() {
  const results = await ingestTrades({ maxPagesPerChamber: 20 });
  for (const r of results) {
    const total = r.inserted + r.unmatchedNames.size;
    console.log(
      `${r.chamber}: ${r.inserted} inserted, ${r.matched} matched / ${total} total ` +
        `(pages=${r.pagesFetched}, unmatched_names=${r.unmatchedNames.size})`,
    );
    if (r.unmatchedNames.size > 0) {
      console.log(
        `  unmatched: ${[...r.unmatchedNames].slice(0, 20).join(", ")}` +
          (r.unmatchedNames.size > 20 ? ", ..." : ""),
      );
    }
    for (const e of r.errors) console.error(`  ERR: ${e}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
