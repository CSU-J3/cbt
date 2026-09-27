// HO 749 — the manual entry to the general-ballot reader. Runs the SAME
// runGeneralBallot() the /api/cron/general-ballot cron runs; this file adds a
// census before and after, and nothing else.
//
// WHAT THIS WRITES, exactly (and only with --write):
//   general_ballot        — one row per person in a race's 2026 general box
//   general_ballot_reads  — one row per race: the last READ and the last attempt
//
// READ-ONLY BY DEFAULT. A bare invocation fetches and parses, and reports what
// WOULD be written, touching nothing (it still reads Ballotpedia, at the same
// pacing). `--write` is required to mutate.
//
//   npm run sync:general-ballot                           # dry: one cron tick's worth (40 races, 240s)
//   npm run sync:general-ballot -- --race FL-20-2026      # dry, one race
//   npm run sync:general-ballot -- --race FL-20-2026 --write
//   npm run sync:general-ballot -- --all --write          # the whole queue, no budget
//
// --all runs the whole queue without the cron's cap or budget, at the same 6s
// start-to-start pacing, under HO 747's ruled stop rule: five UNREAD in a row
// pause the pass for 15 minutes, once, and the next UNREAD stops it (a READ in
// between resets the count). Without --all, the cron's rule holds: the first
// UNREAD ends the run.
//
// HO 750: the race page reads these tables through the `general-ballot` cache
// tag, which the cron flushes on a tick that wrote a READ and this CLI cannot
// (revalidateTag needs a Next request). After a --write, flush it:
//   POST /api/revalidate?tag=general-ballot  (Bearer $CRON_SECRET)
// The roster is the challenger harvest's, so it moves at the next harvest.
import "dotenv/config";
import { getDb } from "../lib/db";
import { TICK_BUDGET_MS, TICK_CAP, runGeneralBallot } from "../lib/general-ballot";

const argv = process.argv.slice(2);
const has = (f: string) => argv.includes(f);
const val = (f: string): string | null => {
  const i = argv.indexOf(f);
  return i < 0 ? null : (argv[i + 1] ?? null);
};

const WRITE = has("--write");
const ALL = has("--all");
const RACE = val("--race");

async function census(label: string) {
  const db = getDb();
  const r = await db.execute(`
    SELECT (SELECT COUNT(*) FROM general_ballot) AS ballot_rows,
           (SELECT COUNT(DISTINCT race_id) FROM general_ballot) AS ballot_races,
           (SELECT COUNT(*) FROM general_ballot WHERE bioguide_id IS NOT NULL) AS with_bioguide,
           (SELECT COUNT(*) FROM general_ballot_reads) AS reads,
           (SELECT COUNT(*) FROM general_ballot_reads WHERE status = 'box') AS box,
           (SELECT COUNT(*) FROM general_ballot_reads WHERE status = 'no_box') AS no_box,
           (SELECT COUNT(*) FROM general_ballot_reads WHERE status = 'ambiguous') AS ambiguous,
           (SELECT COUNT(*) FROM general_ballot_reads WHERE status IS NULL) AS never_read,
           (SELECT MIN(last_attempt_at) FROM general_ballot_reads) AS oldest_attempt,
           (SELECT MAX(last_attempt_at) FROM general_ballot_reads) AS newest_attempt`);
  const x = r.rows[0];
  console.log(`\n== ${label} ==`);
  console.log(`  general_ballot        ${x?.ballot_rows} rows / ${x?.ballot_races} races (${x?.with_bioguide} with a bioguide)`);
  console.log(`  general_ballot_reads  ${x?.reads} races: box ${x?.box} · no_box ${x?.no_box} · ambiguous ${x?.ambiguous} · never READ ${x?.never_read}`);
  console.log(`  last_attempt_at range ${x?.oldest_attempt} .. ${x?.newest_attempt}`);
}

async function main() {
  if (ALL && RACE) throw new Error("--all and --race are exclusive");
  console.log(WRITE ? "MODE: --write (WILL MUTATE)" : "MODE: dry (no writes)");
  console.log(RACE ? `race: ${RACE}` : ALL ? "scope: --all (whole queue, no cap, no budget)" : `scope: one tick (cap ${TICK_CAP}, budget ${TICK_BUDGET_MS / 1000}s)`);

  // READ-BACK needs a before as well as an after (docs/method.md, Gates).
  await census("BEFORE");
  const r = await runGeneralBallot(getDb(), {
    write: WRITE,
    raceIds: RACE ? [RACE] : undefined,
    cap: ALL || RACE ? undefined : TICK_CAP,
    deadlineMs: ALL || RACE ? undefined : Date.now() + TICK_BUDGET_MS,
    stopRule: ALL ? "streak" : "first-unread",
    onRace: (l) =>
      console.log(
        `  ${l.race.padEnd(12)} ${l.verdict.padEnd(7)} ${l.status ?? l.cause ?? ""}` +
          (l.status === "box" ? ` · ${l.rows} rows · marked ${l.marked}` : "") +
          (l.folded && (l.folded.merged || l.folded.repeated || l.folded.noKey)
            ? ` · folded ${JSON.stringify(l.folded)}`
            : "") +
          ` · ${l.url}`,
      ),
  });

  console.log("\n== RESULT ==");
  console.log(`mode        : ${r.mode}`);
  console.log(`queued      : ${r.queued}  attempted ${r.attempted}  stop ${r.stop}${r.pauses ? `  pauses ${r.pauses}` : ""}`);
  console.log(`verdicts    : READ ${r.verdicts.READ} · UNREAD ${r.verdicts.UNREAD} · NO_PAGE ${r.verdicts.NO_PAGE}`);
  console.log(`statuses    : box ${r.statuses.box} · no_box ${r.statuses.no_box} · ambiguous ${r.statuses.ambiguous}`);
  console.log(`rows        : read ${r.rowsRead} · written ${r.rowsWritten}  (folded ${JSON.stringify(r.folded)}, no-link rows ${r.noLinkRows})`);
  console.log(`requests    : ${r.requests}  smallest start-to-start gap ${r.minGapMs ?? "-"}ms`);
  if (r.unread.length) console.log(`UNREAD      : ${r.unread.map((u) => `${u.race} (${u.cause})`).join(", ")}`);
  if (r.noPage.length) console.log(`NO_PAGE     : ${r.noPage.join(", ")}`);
  if (r.ambiguous.length) console.log(`ambiguous   : ${r.ambiguous.join(", ")}`);
  await census("AFTER");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
