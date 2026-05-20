// Automated race-ratings sync orchestration (handoff 88). Scrapes 2026
// House Sabato ratings via Ballotpedia and upserts the competitive ones
// into race_ratings. Same logic-in-lib / thin-wrapper split as
// lib/votes-sync.ts: `scripts/sync-race-ratings.ts` (CLI) and
// `app/api/sync-race-ratings/route.ts` (cron) both call runRaceRatingsSync.
//
// Only updates races that already have a `races` row — never auto-creates
// a race without incumbent data (handoff 88 acceptance #6). Rating changes
// log a CHANGED: line; that console line is the audit trail.
//
// Senate is out of scope: Ballotpedia has no 2026 Senate ratings table, so
// Senate Sabato ratings stay on the handoff-71 manual JSON seed.
import { getDb } from "./db";
import {
  BALLOTPEDIA_HOUSE_URL,
  scrapeHouseSabatoRatings,
} from "./race-ratings-scrape";

export type RaceRatingsSyncStats = {
  scraped: number;
  upserted: number;
  changed: number;
  unchanged: number;
  skippedNoRaceRow: number;
};

export async function runRaceRatingsSync(): Promise<RaceRatingsSyncStats> {
  const db = getDb();
  const ratings = await scrapeHouseSabatoRatings();
  console.log(`scraped ${ratings.length} competitive House Sabato ratings`);

  const stats: RaceRatingsSyncStats = {
    scraped: ratings.length,
    upserted: 0,
    changed: 0,
    unchanged: 0,
    skippedNoRaceRow: 0,
  };
  const now = new Date().toISOString();

  for (const r of ratings) {
    const raceRow = await db.execute({
      sql: "SELECT id FROM races WHERE id = ? LIMIT 1",
      args: [r.raceId],
    });
    if (raceRow.rows.length === 0) {
      // Race not in our DB (open seat with no incumbent row, etc.) — skip.
      stats.skippedNoRaceRow++;
      continue;
    }

    const existing = await db.execute({
      sql: "SELECT rating FROM race_ratings WHERE id = ? LIMIT 1",
      args: [`${r.raceId}-sabato`],
    });
    const prev = existing.rows[0]?.rating as string | undefined;

    if (prev === r.rating) {
      stats.unchanged++;
      continue;
    }
    if (prev && prev !== r.rating) {
      console.log(`  CHANGED: ${r.raceId} ${prev} → ${r.rating}`);
      stats.changed++;
    }

    // id convention `${raceId}-sabato` matches handoff 71's seed script.
    // rating_score is NOT NULL — computed in the scraper. rating_date is
    // the scrape date (Ballotpedia shows a page-level "as of" only);
    // source_url points at the Ballotpedia page we read.
    await db.execute({
      sql: `INSERT INTO race_ratings
              (id, race_id, source, rating, rating_score, rating_date,
               source_url, cycle, updated_at)
            VALUES (?, ?, 'sabato', ?, ?, ?, ?, 2026, ?)
            ON CONFLICT(id) DO UPDATE SET
              rating = excluded.rating,
              rating_score = excluded.rating_score,
              rating_date = excluded.rating_date,
              source_url = excluded.source_url,
              updated_at = excluded.updated_at`,
      args: [
        `${r.raceId}-sabato`,
        r.raceId,
        r.rating,
        r.ratingScore,
        now.slice(0, 10),
        BALLOTPEDIA_HOUSE_URL,
        now,
      ],
    });
    stats.upserted++;
  }

  console.log(
    `done — scraped=${stats.scraped} upserted=${stats.upserted} ` +
      `changed=${stats.changed} unchanged=${stats.unchanged} ` +
      `skipped_no_race_row=${stats.skippedNoRaceRow}`,
  );
  return stats;
}
