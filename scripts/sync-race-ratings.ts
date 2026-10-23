// Local CLI for the automated race-ratings sync (handoff 88). Run with
// `npm run sync:race-ratings`. Same code path the cron route invokes —
// both share runRaceRatingsSync from lib/race-ratings-sync.ts.
//
// HO 789 — THE SAVED-PAGE PATH. Cloudflare refuses the cron's read of Sabato's
// rating-changes page from pdx1 while the same agent from Corey's box is
// answered (backlog :40), so the page can be read there and ingested here. The
// rule: the read is one `curl.exe` a day from the box with the sync's own agent
// string, no retry on a challenge, no other agent string ever; the ingest is
//   npm run sync:race-ratings -- --html <file> [--supplement <csv>] --flush
// and a challenge page saved by mistake fails the parse and writes nothing.
//   --html <path>       read the saved page here and serve its text through
//                       fileScrapeRun: nothing is fetched, and the stats' dataUrl
//                       names the file.
//   --supplement <csv>  rows a person read off one of the page's image entries,
//                       two readers diffed and settled (repeatable). A board is
//                       refused before anything else runs unless every section
//                       holds the count its header prints (parseSupplementCsv).
//   --flush             POST `${REVALIDATE_URL}?tag=race-ratings` with Bearer
//                       CRON_SECRET when any leg wrote, whatever the other leg
//                       did (its writes are committed either way), as
//                       scripts/sync-fec.ts flushes; unset, it says so.
// A failed leg still exits 1 with the sync's message, after the flush.
import "dotenv/config";
import { readFileSync } from "node:fs";
import { fileScrapeRun, parseSupplementCsv, type Supplement } from "../lib/race-ratings-scrape";
import {
  RaceRatingsSyncError,
  runRaceRatingsSync,
  type RaceRatingsSyncResult,
} from "../lib/race-ratings-sync";

function parseArgs(argv: string[]): { html?: string; supplements: string[]; flush: boolean } {
  const out: { html?: string; supplements: string[]; flush: boolean } = { supplements: [], flush: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--flush") out.flush = true;
    else if (a === "--html" || a === "--supplement") {
      const v = argv[++i];
      if (!v || v.startsWith("--")) throw new Error(`${a} needs a path`);
      if (a === "--html") out.html = v;
      else out.supplements.push(v);
    } else throw new Error(`unknown argument ${JSON.stringify(a)} (the flags are --html <path>, --supplement <csv>, --flush)`);
  }
  return out;
}

function report(result: RaceRatingsSyncResult) {
  for (const [chamber, leg] of Object.entries(result)) {
    if (!leg.ok) {
      console.log(`${chamber}: FAILED · ${leg.error}`);
      continue;
    }
    const s = leg.stats;
    console.log(
      `${chamber}: ok · upserted ${s.upserted} (changed ${s.changed}, new ${s.upserted - s.changed}) · unchanged ${s.unchanged} · ` +
        `deleted ${s.deleted} · skipped_no_race_row ${s.skippedNoRaceRow}`,
    );
    for (const [source, r] of Object.entries(s.raters)) {
      console.log(
        `  ${source}: conflicts ${JSON.stringify(r.conflicts ?? [])} · offBoard ${JSON.stringify(r.offBoard ?? [])} · ` +
          `pageAsOf ${r.pageAsOf ?? "-"} · asOf ${r.asOf ?? "-"} · dataUrl ${r.dataUrl}`,
      );
    }
  }
}

async function flushTag() {
  const revalidateUrl = process.env.REVALIDATE_URL;
  const secret = process.env.CRON_SECRET;
  if (revalidateUrl && secret) {
    try {
      const res = await fetch(`${revalidateUrl}?tag=race-ratings`, {
        method: "POST",
        headers: { Authorization: `Bearer ${secret}` },
      });
      console.log(`Flush of \`race-ratings\`: ${res.status}${res.ok ? "" : " (not flushed)"}`);
    } catch (e) {
      console.warn("Revalidate POST failed (non-fatal):", e);
    }
  } else {
    console.log("REVALIDATE_URL / CRON_SECRET not set — flush the `race-ratings` tag manually.");
  }
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  // Before anything else: each supplement's own checks, a board's counts among them.
  const supplements: Supplement[] = args.supplements.map((p) => parseSupplementCsv(readFileSync(p, "utf8"), p));
  for (const s of supplements) {
    console.log(`supplement ${s.name}: ${s.kind} for the ${s.chamber}, the ${s.date} image entry, ${s.rows.length} rows, read off ${s.source}`);
  }
  // The saved page, read on this side: lib/race-ratings-scrape.ts imports no `node:` module.
  const run = args.html
    ? fileScrapeRun({ html: readFileSync(args.html, "utf8"), label: `file:${args.html.split(/[\\/]/).at(-1)}` })
    : undefined;

  let result: RaceRatingsSyncResult;
  let failure: unknown = null;
  try {
    result = await runRaceRatingsSync({ run, supplements });
  } catch (e) {
    if (!(e instanceof RaceRatingsSyncError)) throw e;
    [result, failure] = [e.result, e];
  }
  report(result);
  if (args.flush) {
    const wrote = Object.entries(result).filter(([, leg]) => leg.ok && leg.stats.upserted + leg.stats.deleted > 0);
    if (wrote.length) await flushTag();
    else console.log("No leg wrote, so there is nothing to flush.");
  }
  if (failure) {
    console.error(failure);
    return 1;
  }
  return 0;
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error(err);
    process.exit(1);
  },
);
