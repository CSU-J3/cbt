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
// Senate is out of scope: Ballotpedia has no 2026 Senate ratings table, so
// Senate ratings stay on the handoff-71 manual JSON seed.
import { getDb } from "./db";
import {
  BALLOTPEDIA_HOUSE_URL,
  type RatingSource,
  scrapeHouseRatings,
} from "./race-ratings-scrape";

export type RaceRatingsSyncStats = {
  scraped: number;
  upserted: number;
  changed: number;
  unchanged: number;
  skippedNoRaceRow: number;
  // Per-source upsert tallies for the report line.
  bySource: Record<RatingSource, number>;
};

export async function runRaceRatingsSync(): Promise<RaceRatingsSyncStats> {
  const db = getDb();
  const ratings = await scrapeHouseRatings();
  console.log(`scraped ${ratings.length} competitive House ratings (all sources)`);

  const stats: RaceRatingsSyncStats = {
    scraped: ratings.length,
    upserted: 0,
    changed: 0,
    unchanged: 0,
    skippedNoRaceRow: 0,
    bySource: { cook: 0, inside_elections: 0, sabato: 0 },
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

    // rating_score is NOT NULL — computed in the scraper. rating_date is
    // the scrape date (Ballotpedia shows a page-level "as of" only);
    // source_url points at the Ballotpedia page we read.
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
        now.slice(0, 10),
        BALLOTPEDIA_HOUSE_URL,
        now,
      ],
    });
    stats.upserted++;
    stats.bySource[r.source]++;
  }

  console.log(
    `done — scraped=${stats.scraped} upserted=${stats.upserted} ` +
      `(cook=${stats.bySource.cook} ie=${stats.bySource.inside_elections} ` +
      `sabato=${stats.bySource.sabato}) changed=${stats.changed} ` +
      `unchanged=${stats.unchanged} skipped_no_race_row=${stats.skippedNoRaceRow}`,
  );
  return stats;
}
