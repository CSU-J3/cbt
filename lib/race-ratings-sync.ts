// Automated race-ratings sync orchestration (handoff 88, +89 all-three-
// sources). Scrapes 2026 House Cook / Inside Elections / Sabato ratings
// via Ballotpedia and upserts the competitive ones into race_ratings.
// Same logic-in-lib / thin-wrapper split as lib/votes-sync.ts:
// `scripts/sync-race-ratings.ts` (CLI) and
// `app/api/sync-race-ratings/route.ts` (cron) both call runRaceRatingsSync.
//
// Only updates races that already have a `races` row — never auto-creates
// a race without incumbent data (handoff 88 acceptance #6). Rating changes
// log a CHANGED: line; that console line is the audit trail.
//
// Senate is out of scope HERE: the widget this reads is `office_type=House`,
// so no House locked cell can ever name an `S-{ST}-{YYYY}` id and the Senate
// rows are unreachable by construction. (A Senate widget of the same shape does
// exist — measured HO 743, and the reason it is not read yet is on the ledger,
// not that it is absent. The pre-HO-743 comment here said Ballotpedia had no
// Senate ratings table at all, which was false.)
//
// HO 743 — THE SYNC NOW DELETES, ON EVIDENCE AND NEVER ON ABSENCE. The widget
// renders a cell per (district, rater), so a Solid/Safe cell is the rater
// saying the seat is out of play; that, and only that, retires the row. See
// `applyDepartures` below for the predicate and what it deliberately excludes.
import type { Client, InStatement } from "@libsql/client";
import { getDb } from "./db";
import {
  BALLOTPEDIA_HOUSE_URL,
  type RatingSource,
  type RatingsScrape,
  scrapeHouseRatings,
} from "./race-ratings-scrape";

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
};

export async function runRaceRatingsSync(): Promise<RaceRatingsSyncStats> {
  const db = getDb();
  const scrape = await scrapeHouseRatings();
  const ratings = scrape.ratings;
  console.log(
    `scraped ${ratings.length} competitive House ratings (all sources) ` +
      `· ${scrape.locked.length} locked cells · sources ${scrape.sourcesPresent.join("/")}`,
  );

  const stats: RaceRatingsSyncStats = {
    scraped: ratings.length,
    upserted: 0,
    changed: 0,
    unchanged: 0,
    skippedNoRaceRow: 0,
    deleted: 0,
    bySource: { cook: 0, inside_elections: 0, sabato: 0 },
    deletedBySource: { cook: 0, inside_elections: 0, sabato: 0 },
  };
  const now = new Date().toISOString();

  // Cache race-row existence across sources — the same raceId appears once
  // per rater, so this collapses ~3× the SELECTs into one per race.
  const raceExists = new Map<string, boolean>();

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
    // Ballotpedia page we read.
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
        BALLOTPEDIA_HOUSE_URL,
        now,
      ],
    });
    stats.upserted++;
    stats.bySource[r.source]++;
  }

  // Departures run AFTER the upserts, so a cell that moved back into the
  // competitive band in the same tick ends competitive. One cell cannot be both
  // at once, so this ordering is not load-bearing today — it is fixed here so
  // that correctness does not depend on that staying true.
  await applyDepartures(db, scrape, stats);

  console.log(
    `done — scraped=${stats.scraped} upserted=${stats.upserted} ` +
      `(cook=${stats.bySource.cook} ie=${stats.bySource.inside_elections} ` +
      `sabato=${stats.bySource.sabato}) changed=${stats.changed} ` +
      `unchanged=${stats.unchanged} skipped_no_race_row=${stats.skippedNoRaceRow} ` +
      `deleted=${stats.deleted} (cook=${stats.deletedBySource.cook} ` +
      `ie=${stats.deletedBySource.inside_elections} sabato=${stats.deletedBySource.sabato})`,
  );
  return stats;
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
 * Senate rows cannot be touched: the widget is `office_type=House`, so every
 * `raceId` here is `{ST}-{DD|AL}-{YYYY}` and never `S-{ST}-{YYYY}`.
 *
 * Exported because the HO 743 gate runs it directly against a local `file:`
 * copy with saved widget HTML — the shipped function, not a copy of it.
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
