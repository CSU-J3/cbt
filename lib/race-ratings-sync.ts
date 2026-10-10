// Automated race-ratings sync orchestration (handoff 88, +89 all-three-
// sources). Reads 2026 race ratings for BOTH CHAMBERS, one reader per rater
// since HO 770 (Cook / Inside Elections / Sabato via Ballotpedia before that),
// and upserts the competitive ones into race_ratings.
// Same logic-in-lib / thin-wrapper split as lib/votes-sync.ts:
// `scripts/sync-race-ratings.ts` (CLI) and
// `app/api/sync-race-ratings/route.ts` (cron) both call runRaceRatingsSync.
//
// Only updates races that already have a `races` row — never auto-creates
// a race without incumbent data (handoff 88 acceptance #6). Rating changes
// log a CHANGED: line; that console line is the audit trail.
//
// ── HO 744: SENATE IS IN SCOPE, AND THE TWO LEGS ARE INDEPENDENT ────────────
//
// Until HO 744 the Senate was excused by a construction argument: the widget
// read `office_type=House`, so no locked cell could name an `S-{ST}-{YYYY}` id
// and Senate rows were unreachable. That was true and it was the wrong kind of
// safety — the Senate store was a January Wikipedia snapshot with no sync,
// 72 of its 105 rows Solid/Safe, while the House half said what the raters
// said this week. The widget is now discovered PER CHAMBER and the parser is
// told which one it is reading (see lib/race-ratings-scrape.ts, CHAMBER, for
// the bare-state collision that makes telling it mandatory).
//
// THE LEGS SHARE NO STATE AND NEITHER CAN DISCARD THE OTHER'S WRITES. The two
// scrapes run together under one Promise.allSettled; each chamber then upserts
// and applies departures inside its own try/catch, House then Senate, against
// disjoint id spaces, committing as it goes, and a rejected scrape is rethrown
// inside its own leg only. If a leg throws, the other still runs to completion
// and its writes stand; only AFTER both have run does this function throw,
// naming the failed chamber(s) and carrying the successful one's counts. That
// shape is not decoration: HO 742 spent a session ending a state where a
// Ballotpedia restructure froze the ratings silently, and a single sequential
// path would reintroduce exactly that — a Senate-side change re-freezing the
// House — in a new place.
//
// HO 744 — THE allSettled IS A BARRIER, AND IT IS SAFE ONLY BECAUSE EVERY FETCH
// IS BOUNDED. Neither leg writes until both scrapes have settled, so one
// unbounded hung fetch would hold BOTH chambers' writes past wrapCronRoute's 55s
// soft timeout: a `timeout` row, which /api/health counts as alive, and nothing
// written. `fetchHtml`'s per-fetch cap (lib/race-ratings-scrape.ts) turns the
// hang into a rejected scrape, so the other chamber writes and the run records
// `error`. The two ship together or not at all; the budget is in the route
// header.
//
// Loudness is unchanged. Either leg failing is still a throw, so
// `wrapCronRoute` records `status = 'error'` with the message, and
// `/api/health` reds on `lastStatus`.
//
// HO 743 — THE SYNC NOW DELETES, ON EVIDENCE AND NEVER ON ABSENCE. The widget
// renders a cell per (district, rater), so a Solid/Safe cell is the rater
// saying the seat is out of play; that, and only that, retires the row. See
// `applyDepartures` below for the predicate and what it deliberately excludes.
//
// ── HO 770: EACH RATER ITS OWN READER, AND EACH ROW ITS OWN RATER'S PAGE ────
//
// The legs work as they did: both chambers read together, then the House
// writes, then the Senate. What a leg reads is now its chamber's WIRED raters
// (lib/race-ratings-scrape.ts), each through its own reader, so inside a leg
// the writes go rater by rater: upserts, then departures, both predicates
// unchanged, every row citing its own rater's page as `source_url`. A rater
// that failed to read writes nothing and deletes nothing, and once the others
// have written the leg throws, naming it and what landed, so the run still
// records `error`. One rater is wired today, Sabato, from its change log, and
// both legs share the page's one fetch (fetchSource's cap, the same 8s).
// A log reports moves, not a table of every seat, so before a log rater writes,
// the leg checks each race's stored row against the race's chain of changes.
// A stored label that appears nowhere in the chain is a conflict: it is warned,
// counted in `stats.raters.sabato.conflicts` with its id, and not written.
// The chamber totals stay as they were (the MOVED guard reads `scraped`), and
// each rater that read adds `stats.raters.<source>`, which the guard reads too
// (lib/move-freshness.ts).
import type { Client, InStatement } from "@libsql/client";
import { getDb } from "./db";
import {
  type Chamber,
  type ChamberScrape,
  newScrapeRun,
  type RatingChange,
  type RatingSource,
  type RatingsScrape,
  scrapeChamber,
  type ScrapedRating,
} from "./race-ratings-scrape";

/** HO 770 — one rater's reading and writes, inside a leg. */
export type RaterStats = {
  ok: true;
  scraped: number;
  upserted: number;
  changed: number;
  unchanged: number;
  skippedNoRaceRow: number;
  deleted: number;
  asOf: string | null; // the source's own stamp on what was read
  sourceUrl: string;
  dataUrl: string;
  // A change-log rater's (Sabato's):
  conflicts?: string[]; // races whose stored label is nowhere in their chain; not written
  pageAsOf?: string | null; // the newest of the chamber's table dates
  unparsed?: string[]; // rows that minted no race id, or two
};

export type RaceRatingsSyncStats = {
  scraped: number;
  upserted: number;
  changed: number;
  unchanged: number;
  skippedNoRaceRow: number;
  // HO 743: rows retired because a rater now calls the seat Solid/Safe.
  deleted: number;
  // Per-source upsert tallies for the report line.
  bySource: Record<RatingSource, number>;
  // HO 743: the same split for the deletes — a lopsided tick is the first thing
  // anyone will want to read off a run that removed rows.
  deletedBySource: Record<RatingSource, number>;
  // HO 770: one entry per rater that read.
  raters: Partial<Record<RatingSource, RaterStats>>;
};

/**
 * HO 744 — one leg's outcome. A leg either produced stats or threw; the
 * message is kept so the payload records WHY a chamber is missing rather than
 * leaving a hole the reader has to interpret.
 */
export type ChamberLegResult = { ok: true; stats: RaceRatingsSyncStats } | { ok: false; error: string };

export type RaceRatingsSyncResult = Record<Chamber, ChamberLegResult>;

const CHAMBERS: Chamber[] = ["house", "senate"];
const SOURCES: RatingSource[] = ["cook", "inside_elections", "sabato"];

/**
 * Run both chambers. See the header for why the legs are independent.
 *
 * Throws AFTER both legs have run if either failed — so the successful leg's
 * writes are already committed and only the reporting is affected.
 */
export async function runRaceRatingsSync(): Promise<RaceRatingsSyncResult> {
  const db = getDb();
  const result = {} as RaceRatingsSyncResult;

  // Both scrapes in flight at once, the writes after them, House then Senate.
  // allSettled, never all: one chamber's rejected scrape must not cost the other
  // chamber its writes. HO 770: one run for both, so they share the page.
  const run = newScrapeRun();
  const scrapes = await Promise.allSettled(CHAMBERS.map((c) => scrapeChamber(c, run)));

  for (const [i, chamber] of CHAMBERS.entries()) {
    try {
      const scraped = scrapes[i]!;
      if (scraped.status === "rejected") throw scraped.reason;
      result[chamber] = { ok: true, stats: await runChamberLeg(db, chamber, scraped.value) };
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      console.error(`  ${chamber} leg FAILED: ${error}`);
      result[chamber] = { ok: false, error };
    }
  }

  const failed = CHAMBERS.filter((c) => !result[c].ok);
  if (failed.length > 0) {
    const survived = CHAMBERS.filter((c) => result[c].ok)
      .map((c) => {
        const leg = result[c] as { ok: true; stats: RaceRatingsSyncStats };
        return `${c} OK (upserted=${leg.stats.upserted} deleted=${leg.stats.deleted}, committed)`;
      })
      .join("; ");
    const detail = failed
      .map((c) => `${c}: ${(result[c] as { ok: false; error: string }).error}`)
      .join(" ;; ");
    throw new Error(
      `race-ratings sync: ${failed.length} of ${CHAMBERS.length} chamber leg(s) failed — ${detail}. ` +
        (survived ? `Writes that DID land: ${survived}.` : "No chamber completed."),
    );
  }
  return result;
}

function emptyStats(scraped: number): RaceRatingsSyncStats {
  return {
    scraped,
    upserted: 0,
    changed: 0,
    unchanged: 0,
    skippedNoRaceRow: 0,
    deleted: 0,
    bySource: { cook: 0, inside_elections: 0, sabato: 0 },
    deletedBySource: { cook: 0, inside_elections: 0, sabato: 0 },
    raters: {},
  };
}

/**
 * One chamber's writes on its raters' reads: for each rater that read, the chain
 * check, then upserts, then departures. HO 770: what `runRaceRatingsSync` did
 * per chamber before, now per rater, with each rater's own page threaded
 * through as `source_url`; and a rater that didn't read fails the leg after the
 * others have written.
 */
async function runChamberLeg(
  db: Client,
  chamber: Chamber,
  read: ChamberScrape,
): Promise<RaceRatingsSyncStats> {
  const { scrape, reads, failures } = read;
  console.log(
    `scraped ${scrape.ratings.length} competitive ${chamber} ratings · ${scrape.locked.length} locked cells · ` +
      `read ${scrape.sourcesPresent.join("/") || "(none)"}` +
      (failures.length ? ` · did not read ${failures.map((f) => f.source).join("/")}` : ""),
  );

  const stats = emptyStats(scrape.ratings.length);
  // Cache race-row existence across sources — the same raceId appears once
  // per rater, so this collapses ~3× the SELECTs into one per race.
  const raceExists = new Map<string, boolean>();

  for (const r of reads) {
    const own: RatingsScrape = {
      ratings: scrape.ratings.filter((x) => x.source === r.source),
      locked: scrape.locked.filter((x) => x.source === r.source),
      sourcesPresent: [r.source],
    };
    const { write, conflicts } = await setAsideConflicts(db, r.source, own);
    const s = emptyStats(own.ratings.length);
    await upsertRatings(db, write.ratings, r.sourceUrl, s, raceExists);
    // Departures run AFTER the upserts, so a cell that moved back into the
    // competitive band in the same tick ends competitive. One cell cannot be both
    // at once, so this ordering is not load-bearing today — it is fixed here so
    // that correctness does not depend on that staying true.
    await applyDepartures(db, write, s);
    stats.raters[r.source] = {
      ok: true,
      scraped: s.scraped,
      upserted: s.upserted,
      changed: s.changed,
      unchanged: s.unchanged,
      skippedNoRaceRow: s.skippedNoRaceRow,
      deleted: s.deleted,
      asOf: r.asOf,
      sourceUrl: r.sourceUrl,
      dataUrl: r.dataUrl,
      ...(conflicts ? { conflicts } : {}),
      ...(r.pageAsOf !== undefined ? { pageAsOf: r.pageAsOf } : {}),
      ...(r.unparsed ? { unparsed: r.unparsed } : {}),
    };
    stats.upserted += s.upserted;
    stats.changed += s.changed;
    stats.unchanged += s.unchanged;
    stats.skippedNoRaceRow += s.skippedNoRaceRow;
    stats.deleted += s.deleted;
    for (const k of SOURCES) {
      stats.bySource[k] += s.bySource[k];
      stats.deletedBySource[k] += s.deletedBySource[k];
    }
  }

  console.log(
    `${chamber} done — scraped=${stats.scraped} upserted=${stats.upserted} ` +
      `(cook=${stats.bySource.cook} ie=${stats.bySource.inside_elections} ` +
      `sabato=${stats.bySource.sabato}) changed=${stats.changed} ` +
      `unchanged=${stats.unchanged} skipped_no_race_row=${stats.skippedNoRaceRow} ` +
      `deleted=${stats.deleted} (cook=${stats.deletedBySource.cook} ` +
      `ie=${stats.deletedBySource.inside_elections} sabato=${stats.deletedBySource.sabato})`,
  );

  if (failures.length > 0) {
    const landed = reads
      .map((r) => `${r.source} upserted=${stats.raters[r.source]?.upserted} deleted=${stats.raters[r.source]?.deleted}`)
      .join("; ");
    throw new Error(
      failures.map((f) => `${f.source} did not read: ${f.error}`).join(" ;; ") +
        (landed ? `. Writes that landed in this leg: ${landed}, committed` : ". Nothing was written in this leg"),
    );
  }
  return stats;
}

/**
 * HO 770 — THE CHAIN CHECK, for a rater whose rows carry a chain of changes (a
 * change log: Sabato). The log says how each race moved and the store holds the
 * base it moved from, so a stored label that appears nowhere in the race's
 * chain means the two disagree about the race's history, and neither can be
 * taken as the correction of the other. Such a race is set aside, competitive
 * or Safe alike: not upserted, not departed, warned, and counted with its id.
 * Every other race goes on to the predicates as they stand. A rater whose rows
 * carry no chain returns `conflicts` undefined, and nothing is set aside.
 */
async function setAsideConflicts(
  db: Client,
  source: RatingSource,
  scrape: RatingsScrape,
): Promise<{ write: RatingsScrape; conflicts?: string[] }> {
  if (![...scrape.ratings, ...scrape.locked].some((x) => x.chain)) return { write: scrape };
  const rs = await db.execute({ sql: "SELECT race_id, rating FROM race_ratings WHERE source = ?", args: [source] });
  const stored = new Map(rs.rows.map((r) => [String(r.race_id), String(r.rating)]));
  const conflicts: string[] = [];
  const fits = (x: { raceId: string; chain?: readonly RatingChange[] }): boolean => {
    const label = stored.get(x.raceId);
    if (!x.chain || label === undefined || x.chain.some((c) => c.from === label || c.to === label)) return true;
    const chain = x.chain.map((c) => `${c.date} ${c.from ?? "?"} → ${c.to ?? "?"}`).join("; ");
    console.warn(`  CONFLICT: ${x.raceId}-${source} is stored as ${label}, which its chain never reads (${chain}); not written`);
    conflicts.push(x.raceId);
    return false;
  };
  return {
    write: { ratings: scrape.ratings.filter(fits), locked: scrape.locked.filter(fits), sourcesPresent: scrape.sourcesPresent },
    conflicts,
  };
}

/**
 * One rater's competitive ratings, upserted. This is the loop the leg ran
 * before HO 770, unchanged but for `source_url`, which is now the rater's own
 * page.
 */
async function upsertRatings(
  db: Client,
  ratings: ScrapedRating[],
  sourceUrl: string,
  stats: RaceRatingsSyncStats,
  raceExists: Map<string, boolean>,
): Promise<void> {
  const now = new Date().toISOString();

  for (const r of ratings) {
    let exists = raceExists.get(r.raceId);
    if (exists === undefined) {
      const raceRow = await db.execute({
        sql: "SELECT id FROM races WHERE id = ? LIMIT 1",
        args: [r.raceId],
      });
      exists = raceRow.rows.length > 0;
      raceExists.set(r.raceId, exists);
    }
    if (!exists) {
      // Race not in our DB (open seat with no incumbent row, etc.) — skip.
      stats.skippedNoRaceRow++;
      continue;
    }

    // id convention `${raceId}-${source}` matches handoff 71's seed script.
    const ratingId = `${r.raceId}-${r.source}`;
    const existing = await db.execute({
      sql: "SELECT rating FROM race_ratings WHERE id = ? LIMIT 1",
      args: [ratingId],
    });
    const prev = existing.rows[0]?.rating as string | undefined;

    if (prev === r.rating) {
      stats.unchanged++;
      continue;
    }
    if (prev && prev !== r.rating) {
      console.log(`  CHANGED: ${ratingId} ${prev} → ${r.rating}`);
      stats.changed++;
    }

    // rating_score is NOT NULL — computed in the scraper. HO 742: rating_date
    // is now the widget caption's own "as of" date when it parses, falling back
    // to the scrape date (which is what this always stored). Safe to change
    // because rating-history's change-detect predicate is score + label and
    // deliberately NOT rating_date (lib/rating-history.ts:8-12, :57-58) — it
    // only carries the value through onto its own row. source_url points at the
    // Ballotpedia page we read — HO 744: THE CHAMBER'S page. This was a hard-
    // wired BALLOTPEDIA_HOUSE_URL, which would have cited the House page as the
    // provenance of every Senate row, on rows whose entire defect was their
    // provenance. HO 770: the rater's own page, and for Sabato the rating_date
    // is the date of the race's newest change.
    await db.execute({
      sql: `INSERT INTO race_ratings
              (id, race_id, source, rating, rating_score, rating_date,
               source_url, cycle, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, 2026, ?)
            ON CONFLICT(id) DO UPDATE SET
              rating = excluded.rating,
              rating_score = excluded.rating_score,
              rating_date = excluded.rating_date,
              source_url = excluded.source_url,
              updated_at = excluded.updated_at`,
      args: [
        ratingId,
        r.raceId,
        r.source,
        r.rating,
        r.ratingScore,
        r.asOfDate ?? now.slice(0, 10),
        sourceUrl,
        now,
      ],
    });
    stats.upserted++;
    stats.bySource[r.source]++;
  }
}

/**
 * HO 743 — retire the rows the raters no longer stand behind, and log each
 * departure so the history reads `Likely R → Solid R` with a date instead of a
 * series that silently stops.
 *
 * THE PREDICATE, and it is deliberately narrow: an explicit Solid/Safe cell for
 * that exact (race, source), from a source in `sourcesPresent`, where a
 * `race_ratings` row exists. Everything else is an absence and deletes nothing —
 * an empty cell, a district row the widget did not render, an unrecognized
 * label, a column that vanished. A half-rendered widget therefore shows up as
 * missing cells (no deletes) or as a floor breach (a throw), never as a mass of
 * Solid cells; and a widget that rated every seat Solid trips the non-empty
 * throw in the scraper before this function is ever reached.
 *
 * HO 744 — THIS PREDICATE IS SHARED BY BOTH CHAMBERS, BYTE FOR BYTE. It is
 * called once per leg and is not copied, so a Senate departure is decided by
 * exactly the code that decides a House one, at ±3 like the House.
 *
 * What used to make cross-chamber damage impossible was the widget: it was
 * `office_type=House`, so every `raceId` reaching here was `{ST}-{DD|AL}` and
 * never `S-{ST}`. That is no longer true, and NOTHING HERE ENFORCES IT — the
 * `pairs` read is over all of `race_ratings`, both chambers, so this function
 * will delete whatever id the scrape hands it. The separation now lives
 * entirely in the id minting (scrape.ts, TO_RACE_ID), which is why that is
 * where the bare-state collision is documented and why the shape diagnostic
 * asserts no Senate id appears among House cells and vice versa.
 *
 * HO 770: called once per rater that read, with that rater's scrape alone, so
 * `sourcesPresent` is that one rater. For Sabato a locked cell is a race whose
 * newest change is Safe; a race whose stored row conflicts with its chain never
 * reaches here. TO_RACE_ID went with the Ballotpedia transport: the minting is
 * now the scrape's houseIds and senateIds, and the HO 770 shape diagnostic
 * asserts the two chambers' ids don't intersect.
 *
 * Exported because the HO 743/744 gates run it directly against a local
 * `file:` copy with saved widget HTML — the shipped function, not a copy.
 */
export async function applyDepartures(
  db: Client,
  scrape: RatingsScrape,
  stats: RaceRatingsSyncStats,
): Promise<void> {
  if (scrape.locked.length === 0) return;
  const present = new Set<RatingSource>(scrape.sourcesPresent);
  const today = new Date().toISOString().slice(0, 10);

  // One read for the whole tick: which (race, source) pairs exist. ~400 rows
  // against ~1,100 locked cells — the alternative is a SELECT per cell. Keyed
  // on race_id + source, which is the DELETE's own predicate, so the rows this
  // decides to remove and the rows the statement removes cannot disagree.
  const existing = await db.execute("SELECT race_id, source FROM race_ratings");
  const pairs = new Set(existing.rows.map((r) => `${r.race_id}|${r.source}`));

  const stmts: InStatement[] = [];
  for (const cell of scrape.locked) {
    if (!present.has(cell.source)) continue;
    if (!pairs.has(`${cell.raceId}|${cell.source}`)) continue; // never rated, or already gone
    console.log(`  DEPARTED: ${cell.raceId}-${cell.source} → ${cell.label} (${cell.rawRating})`);
    stmts.push({
      sql: "DELETE FROM race_ratings WHERE race_id = ? AND source = ?",
      args: [cell.raceId, cell.source],
    });
    // The departure's own history row. INSERT OR IGNORE + UNIQUE(race_id,
    // source, observed_at) makes a same-day re-run a no-op, exactly as it does
    // for lib/rating-history.ts's own writes; the score is the locked end of
    // the scale (±3), never 0, because 0 is Toss Up's.
    stmts.push({
      sql: `INSERT OR IGNORE INTO rating_history
              (race_id, source, rating_score, rating, rating_date, observed_at)
            VALUES (?, ?, ?, ?, ?, ?)`,
      args: [cell.raceId, cell.source, cell.ratingScore, cell.label, cell.asOfDate ?? today, today],
    });
    stats.deleted++;
    stats.deletedBySource[cell.source]++;
  }

  if (stmts.length > 0) await db.batch(stmts, "write");
}
