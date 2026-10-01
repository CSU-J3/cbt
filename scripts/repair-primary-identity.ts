// HO 764 — fill primary_candidates.person_key from the pages and re-match every
// row's bioguide by the member match (lib/primary-identity-repair.ts).
//
//   npm run repair:primary-identity                      # dry: read, print what would change, write nothing
//   npm run repair:primary-identity -- --write           # the same pass, writing
//   npm run repair:primary-identity -- --saved-only      # HO 747's saved pages only, no fetch
//   npm run repair:primary-identity -- --saved=<dir>     # another saved-page directory
//
// Saved pages first (docs/handoffs/747-artifacts/pages, repo-ignored, read from
// disk); then live, one page at a time at the ballot reader's 6s start to start
// and user agent (lib/general-ballot.ts), one attempt per page, for every race
// the saved set lacks or left a row untied on; the first UNREAD page ends the
// live pass.
//
// No cache flush. The readers of primary_candidates.bioguide_id read it either
// uncached (the race page's runoff block, getRunoffsForRace) or under a tag a
// cron expires: the incumbent qualifier (getIncumbentQualifiers, `general-ballot`
// and `races`) and the race roster the challenger harvest publishes
// (race_candidates, written by /api/cron/race-challengers).
import "dotenv/config";
import { getDb } from "../lib/db";
import { liveIO, MIN_START_GAP_MS, pacedIO } from "../lib/general-ballot";
import { repairPrimaryIdentity, SAVED_PAGES_DIR } from "../lib/primary-identity-repair";

const WRITE = process.argv.includes("--write");
const SAVED_ONLY = process.argv.includes("--saved-only");
const SAVED = process.argv.find((a) => a.startsWith("--saved="))?.slice("--saved=".length) ?? SAVED_PAGES_DIR;

async function main() {
  const db = getDb();
  const paced = SAVED_ONLY ? null : pacedIO(liveIO(), MIN_START_GAP_MS);
  console.log(`=== repair:primary-identity · ${WRITE ? "WRITE" : "dry"}${SAVED_ONLY ? " · saved pages only" : ""} · ${new Date().toISOString()} ===`);
  const r = await repairPrimaryIdentity(db, {
    write: WRITE,
    savedDir: SAVED,
    io: paced?.io ?? null,
    log: (l) => console.log(`  ${l}`),
  });
  console.log(`\nrows ${r.rows} on ${r.races} races · tied from saved pages ${r.tiedSaved} · tied live ${r.tiedLive} · untied ${r.untied.length}`);
  if (paced) console.log(`live: ${r.livePages.length} pages read · requests ${paced.requests()} · minGapMs ${paced.minGapMs()} · NO_PAGE ${r.livePages.filter((p) => p.verdict === "NO_PAGE").length}`);
  if (r.stoppedAt) console.log(`STOPPED at the first UNREAD page: ${r.stoppedAt} · not reached (${r.notReached.length}): ${r.notReached.join(", ")}`);
  if (r.ambiguous.length) console.log(`a name the page links two ways, not guessed (${r.ambiguous.length}):\n    ${r.ambiguous.join("\n    ")}`);
  console.log(`keeping the person_key they carry (no page of this run re-keyed them): ${r.keptStored}`);
  console.log(`untied and unkeyed (${r.untied.length}), matched by the underlined row's surname alone:\n    ${r.untied.join("\n    ") || "none"}`);
  console.log(`\nperson_key ${WRITE ? "set" : "would be set"} on ${r.keysFilled} rows`);
  const who = (b: string | null, m: string | null) => (b ? `${b} (${m})` : "NULL");
  console.log(`bioguide ${WRITE ? "changed" : "would change"} on ${r.bioguideChanges.length} rows:`);
  for (const c of r.bioguideChanges) {
    console.log(`    ${c.primaryId} "${c.name}" [${c.newKey ?? "no person_key"}]: ${who(c.oldBioguide, c.oldMember)} → ${who(c.newBioguide, c.newMember)}`);
  }
  console.log(WRITE ? "\nwritten." : "\ndry: nothing was written.");
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
