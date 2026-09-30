// HO 761 — ingest the runoff rounds Ballotpedia already prints (lib/runoff-repair.ts).
//
//   npm run repair:runoffs              # dry: read every page, print what would be written, write nothing
//   npm run repair:runoffs -- --write   # the same pass, writing
//
// Fetches live, one page at a time at the ballot reader's 6s start to start
// and user agent (lib/general-ballot.ts), one attempt per page; the first
// UNREAD page ends the pass. At HO 761's STEP 0 that was 104 pages (the 110
// with a runoff_date, less Louisiana's six House pages, whose Dec 12 runoff is
// ahead), about eleven minutes.
//
// No cache flush: the runoff block reads primaries uncached, and the incumbent
// qualifier (getIncumbentQualifiers, tagged `general-ballot` and `races`)
// picks up a runoff loser when either tag next expires. Two crons expire
// `races` on every tick: /api/cron/kalshi (`15 */2`) and
// /api/cron/race-challengers (`30 12`).
import "dotenv/config";
import { getDb } from "../lib/db";
import { liveIO, MIN_START_GAP_MS, pacedIO } from "../lib/general-ballot";
import { repairRunoffs } from "../lib/runoff-repair";

const WRITE = process.argv.includes("--write");

async function main() {
  const db = getDb();
  const paced = pacedIO(liveIO(), MIN_START_GAP_MS);
  console.log(`=== repair:runoffs · ${WRITE ? "WRITE" : "dry"} · ${new Date().toISOString()} ===`);
  const r = await repairRunoffs(db, paced.io, { write: WRITE, log: (l) => console.log(`  ${l}`) });
  const rp = r.report;
  const lines: [string, string[]][] = [
    [WRITE ? "inserted" : "would insert", rp.inserted],
    [WRITE ? "updated" : "would update", rp.updated],
    [WRITE ? "reopened and updated (expired, undecided)" : "would reopen and update (expired, undecided)", rp.reopened],
    ["unchanged", rp.unchanged],
    ["settled, skipped", rp.settledSkipped],
    ["no first round", rp.noFirstRound],
    ["outside the contest set", rp.outOfContestSet],
    ["unrouted: the date picks no single first round (HO 762)", rp.unrouted],
    ["undated", rp.undated],
    ["empty roster", rp.emptyRoster],
    ["page name with no stored row", rp.noMatch],
    ["box date differs from the first round's runoff_date", rp.dateDisagrees],
  ];
  console.log(`\npages: ${r.units} to read · ${r.pages.filter((p) => p.verdict === "READ").length} READ · ${r.noPage.length} NO_PAGE · ${r.notReached.length} not reached`);
  console.log(`requests ${paced.requests()} · minGapMs ${paced.minGapMs()} · runoff boxes read ${r.pages.reduce((n, p) => n + p.boxes, 0)}`);
  console.log(`dates: ${rp.dateFromBox} from the box, ${rp.dateFromFirstRound} from the first round`);
  for (const [label, l] of lines) console.log(`${label} (${l.length})${l.length ? `:\n    ${l.join("\n    ")}` : ""}`);
  console.log(`left out, runoff today or later (${r.leftFuture.length}): ${r.leftFuture.join(", ") || "none"}`);
  if (r.noPage.length) console.log(`NO_PAGE: ${r.noPage.join(", ")}`);
  if (r.stoppedAt) console.log(`STOPPED at the first UNREAD page: ${r.stoppedAt} · not reached (${r.notReached.length}): ${r.notReached.join(", ")}`);
  console.log(WRITE ? "\nwritten." : "\ndry: nothing was written.");
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
