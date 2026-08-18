// HO 670 (review) — what the /welcome page's 14 reads are cached WITH.
//
// The warm figure came back 0 rows_read, which contradicts the review's premise
// that the expensive calls are uncached. A measurement that surprises needs its
// mechanism read, not assumed: this prints the `unstable_cache` key, revalidate
// and tags for each of the page's calls straight out of lib/queries.ts, plus a
// negative control (a name that is NOT unstable_cache-wrapped must report so).
//
//   npx tsx scripts/diagnostic/cache-options-670.ts
import { readFileSync } from "node:fs";

const SRC = readFileSync("lib/queries.ts", "utf8");

const CALLS = [
  "getStageChangesCount",
  "getCorpusStats",
  "getStageDistribution",
  "getLatestMarketTicks",
  "getStageChanges",
  "getStaleBills",
  "getFeedBills",
  "getMembersRanked",
  "getLobbyingRollup",
  "getUpcomingMeetings",
  "getRecentMeetings",
  "getBreakingNewsForHome",
  "getMostCompetitiveRaces",
  "getClusterStats",
];
// Negative control: a real export of lib/queries.ts that is a plain function, not
// unstable_cache. If this reports a revalidate, the parser is matching noise.
const CONTROL_UNCACHED = "getRecentFilings";

function report(name: string): string {
  const decl = SRC.indexOf(`export const ${name} = unstable_cache(`);
  if (decl === -1) {
    const fn = SRC.indexOf(`export async function ${name}(`);
    return fn === -1 ? "NOT FOUND" : "NOT unstable_cache (plain function)";
  }
  // The options object is the tail of the unstable_cache call: find the
  // `["key"],` line after the declaration and read to the closing `);`.
  const tail = SRC.slice(decl, decl + 40000);
  const keyIdx = tail.indexOf(`["${name}"]`);
  if (keyIdx === -1) return "unstable_cache, key line not found";
  const opts = tail.slice(keyIdx, tail.indexOf(");", keyIdx) + 2);
  const rev = /revalidate:\s*([0-9_]+|false)/.exec(opts);
  const tags = /tags:\s*\[([^\]]*)\]/.exec(opts);
  return (
    "unstable_cache · revalidate " +
    (rev?.[1] ?? "(none)") +
    " · tags " +
    (tags?.[1]?.replace(/["\s]/g, "") ?? "(none)")
  );
}

console.log("=".repeat(92));
console.log("HO 670 — cache options for the /welcome reads (source of the warm-zero)");
console.log("=".repeat(92));
for (const c of CALLS) console.log(`  ${c.padEnd(24)} ${report(c)}`);
console.log(`\n  CONTROL (expect 'NOT unstable_cache'):`);
console.log(`  ${CONTROL_UNCACHED.padEnd(24)} ${report(CONTROL_UNCACHED)}`);
