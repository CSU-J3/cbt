// Seeds third-party race ratings (handoffs 71 + 73). Globs every file
// matching `data/race-ratings-*.json` and upserts each row keyed on
// (race_id, source). Idempotent: re-running after editing any JSON is the
// quarterly refresh workflow.
//
// race_id is a loose link to races.id; no FK constraint. Ratings sit in
// the table even if no race row exists yet — useful when the seed runs
// ahead of the next backfill:races pass.
//
// Unknown rating strings warn-and-skip. After a fourth source ships
// (it shouldn't — handoff 73 caps at three), a new vocabulary entry needs
// adding to RATING_SCORES below and the matching color maps in
// components/RatingChip.tsx + components/MemberHeader.tsx.
import "dotenv/config";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { getDb } from "../lib/db";

const RATING_SCORES: Record<string, number> = {
  // Cook + Inside Elections vocabulary
  "Solid D": -3,
  "Likely D": -2,
  "Lean D": -1,
  "Toss Up": 0,
  "Lean R": 1,
  "Likely R": 2,
  "Solid R": 3,
  // Sabato vocabulary: Safe == Solid (equivalent meaning, different label).
  "Safe D": -3,
  "Safe R": 3,
  // Inside Elections vocabulary: Tilt is a tier between Toss Up and Lean.
  // Collapsed to Lean for the integer score (the rating string is
  // preserved verbatim in the rating column, so chips still show "TILT").
  // The ABS(rating_score) <= 1 competitive filter still catches it; ties
  // within a score break on updated_at DESC.
  "Tilt D": -1,
  "Tilt R": 1,
};

interface RatingSeed {
  race_id: string;
  rating: string;
  rating_date?: string | null;
  source_url?: string | null;
}

interface SeedFile {
  source: string;
  cycle: number;
  ratings: RatingSeed[];
}

const DATA_DIR = "data";
const SEED_PATTERN = /^race-ratings-.+\.json$/;

function chamberOf(raceId: string): "senate" | "house" | "governor" | "other" {
  if (raceId.startsWith("S-")) return "senate";
  if (raceId.startsWith("G-")) return "governor";
  if (/^[A-Z]{2}-\d{2}-\d{4}$/.test(raceId)) return "house";
  return "other";
}

function readSeedFiles(): { path: string; file: SeedFile }[] {
  const entries = readdirSync(DATA_DIR)
    .filter((name) => SEED_PATTERN.test(name))
    .sort();
  return entries.map((name) => {
    const path = join(DATA_DIR, name);
    const file = JSON.parse(readFileSync(path, "utf8")) as SeedFile;
    return { path, file };
  });
}

function displayName(source: string): string {
  if (source === "inside_elections") return "Inside Elections";
  return source.charAt(0).toUpperCase() + source.slice(1);
}

async function main() {
  const db = getDb();
  const now = new Date().toISOString();
  const seeds = readSeedFiles();

  if (seeds.length === 0) {
    console.warn(`No seed files matched ${DATA_DIR}/race-ratings-*.json`);
    return;
  }

  let totalSeeded = 0;
  let totalSkipped = 0;

  for (const { path, file } of seeds) {
    const source = file.source;
    const cycle = file.cycle;
    let seeded = 0;
    let skipped = 0;
    const byChamber = { senate: 0, house: 0, governor: 0, other: 0 };

    for (const r of file.ratings ?? []) {
      const score = RATING_SCORES[r.rating];
      if (score === undefined) {
        console.warn(
          `  [${source}] ${r.race_id}: unknown rating '${r.rating}' — skip`,
        );
        skipped++;
        continue;
      }

      const id = `${r.race_id}-${source}`;
      await db.execute({
        sql: `INSERT INTO race_ratings
                (id, race_id, source, rating, rating_score, rating_date,
                 source_url, cycle, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
              ON CONFLICT(id) DO UPDATE SET
                rating = excluded.rating,
                rating_score = excluded.rating_score,
                rating_date = excluded.rating_date,
                source_url = excluded.source_url,
                cycle = excluded.cycle,
                updated_at = excluded.updated_at`,
        args: [
          id,
          r.race_id,
          source,
          r.rating,
          score,
          r.rating_date ?? null,
          r.source_url ?? null,
          cycle,
          now,
        ],
      });
      seeded++;
      byChamber[chamberOf(r.race_id)]++;
    }

    console.log(
      `seeded ${seeded} ${displayName(source)} ratings for cycle ${cycle} ` +
        `(${byChamber.senate} Senate, ${byChamber.house} House, ` +
        `${byChamber.governor} Governor)` +
        (skipped ? ` — ${skipped} skipped` : "") +
        `  [${path}]`,
    );
    totalSeeded += seeded;
    totalSkipped += skipped;
  }

  console.log(
    `total: ${totalSeeded} rows across ${seeds.length} sources` +
      (totalSkipped ? ` — ${totalSkipped} skipped` : ""),
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
