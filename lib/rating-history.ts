// HO 220: rating-history change-detect logging. Appends a row to rating_history
// only when a (race_id, source)'s rating MOVES — the market_ticks append-only
// discipline, but change-gated so a quarter of identical days collapses to one
// row per actual inflection (exactly what the future sparkline wants).
//
// First run (empty history) logs every current race_ratings row as the baseline
// at today's date; after that, a row is appended ONLY when rating_score OR the
// rating label differs from that pair's latest logged value. rating_date (the
// rater's published date) is carried onto the row but is NOT part of the change
// predicate — a same-rating re-publish (new date, same score+label) must not log
// a noise point. observed_at is date-granular; UNIQUE(race_id, source,
// observed_at) + INSERT OR IGNORE make a same-day re-run a no-op.
//
// Pure data capture — no UI reads this yet (the sparkline is a future handoff),
// so there's nothing to revalidate.
import type { Client } from "@libsql/client";

export type RatingHistoryResult = {
  logged: number;
  unchanged: number;
  total: number;
};

export async function logRatingHistory(db: Client): Promise<RatingHistoryResult> {
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

  // Latest logged value per (race_id, source) — the comparison baseline. The
  // history table IS the watermark; no dashboard_state row needed. Tiny read
  // (≤347 groups today).
  const latestRs = await db.execute(`
    SELECT rh.race_id, rh.source, rh.rating_score, rh.rating
    FROM rating_history rh
    JOIN (
      SELECT race_id, source, MAX(observed_at) AS mx
      FROM rating_history
      GROUP BY race_id, source
    ) m ON m.race_id = rh.race_id AND m.source = rh.source AND m.mx = rh.observed_at
  `);
  const latest = new Map<string, { score: number; rating: string }>();
  for (const r of latestRs.rows) {
    latest.set(`${r.race_id}|${r.source}`, {
      score: Number(r.rating_score),
      rating: String(r.rating),
    });
  }

  const cur = await db.execute(
    "SELECT race_id, source, rating_score, rating, rating_date FROM race_ratings",
  );

  const inserts: { sql: string; args: (string | number | null)[] }[] = [];
  let unchanged = 0;
  for (const r of cur.rows) {
    const score = Number(r.rating_score);
    const rating = String(r.rating);
    const prev = latest.get(`${r.race_id}|${r.source}`);
    // Baseline (no prior row) OR a real move (score/label diff). NOT rating_date.
    const changed = !prev || prev.score !== score || prev.rating !== rating;
    if (!changed) {
      unchanged++;
      continue;
    }
    inserts.push({
      sql: `INSERT OR IGNORE INTO rating_history
              (race_id, source, rating_score, rating, rating_date, observed_at)
            VALUES (?, ?, ?, ?, ?, ?)`,
      args: [
        String(r.race_id),
        String(r.source),
        score,
        rating,
        (r.rating_date as string | null) ?? null,
        today,
      ],
    });
  }

  if (inserts.length > 0) await db.batch(inserts, "write");

  return { logged: inserts.length, unchanged, total: cur.rows.length };
}
