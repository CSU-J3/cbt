// Local CLI for the news ingestion pipeline (handoff 64). Run manually
// with `npm run sync:news`. Same code path the cron route invokes in
// production — both share `ingestNews` from lib/news-ingest.ts.
import "dotenv/config";
import { ingestNews } from "../lib/news-ingest";

async function main() {
  const results = await ingestNews();
  for (const r of results) {
    console.log(
      `${r.source}: fetched=${r.itemsFetched} mentions=${r.mentionsInserted} skipped_unknown_bill=${r.mentionsSkippedUnknownBill} llm_calls=${r.llmCalls} llm_matches=${r.llmMatches} llm_errors=${r.llmErrors}`,
    );
    for (const e of r.errors) console.error(`  ERR: ${e}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
