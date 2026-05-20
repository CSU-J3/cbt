// Race-ratings scraper (handoff 88, +89 all-three-sources). Pulls 2026
// U.S. House race ratings from Ballotpedia's election page.
//
// Why Ballotpedia and not the raters directly: Sabato's Crystal Ball 2026
// pages (centerforpolitics.org/crystalball/2026-house/) are JS-rendered —
// the static HTML carries zero rating data. Ballotpedia's MediaWiki
// `w/api.php` wikitext endpoint returns 404. But the rendered Ballotpedia
// election page DOES carry a clean server-rendered comparison table with
// Cook / Inside Elections / Sabato columns. We read all three. The stored
// `source` is the rater whose verdict it is; only the transport is
// Ballotpedia.
//
// Scope: House only. Ballotpedia's 2026 Senate page has the intro
// sentence for a ratings table but no table — Senate ratings stay on the
// handoff-71 manual JSON seed until Ballotpedia publishes one.
//
// Parsing: regex over the single, uniform, server-rendered MediaWiki
// table rather than adding an HTML-parser dependency for one table. A
// row-count sanity check throws if the table shape changes (435 House
// districts expected) so a silent Ballotpedia restructure fails loud.

import { stateAbbr } from "./states";

const HOUSE_URL =
  "https://ballotpedia.org/United_States_House_of_Representatives_elections,_2026";

// Browser-ish UA — Ballotpedia 202s a bare/automation UA.
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

export type RatingSource = "cook" | "inside_elections" | "sabato";

// Ballotpedia table column index → source. Column 0 is the district.
const SOURCE_COLUMN: { index: number; source: RatingSource }[] = [
  { index: 1, source: "cook" },
  { index: 2, source: "inside_elections" },
  { index: 3, source: "sabato" },
];

// Ballotpedia preserves each rater's own vocabulary per column. Mapping to
// the normalized labels already used in race_ratings (handoff 71's
// RATING_SCORES vocabulary). The four partisan-locked labels — Cook/IE
// "Solid" and Sabato "Safe" — map to null: Solid/Safe House seats are not
// seeded (SKILL.md: 360+ partisan-locked rows of zero analytical value).
// Inside Elections' "Tilt" tier maps through verbatim.
const NORMALIZE: Record<string, string | null> = {
  "Solid Republican": null,
  "Solid Democratic": null,
  "Safe Republican": null,
  "Safe Democratic": null,
  "Likely Republican": "Likely R",
  "Likely Democratic": "Likely D",
  "Lean Republican": "Lean R",
  "Lean Democratic": "Lean D",
  "Tilt Republican": "Tilt R",
  "Tilt Democratic": "Tilt D",
  "Toss-up": "Toss Up",
};

// Score for the normalized label — mirrors scripts/seed-race-ratings.ts.
// race_ratings.rating_score is NOT NULL, so every upsert needs one. Tilt
// collapses to the Lean score (±1); the rating string keeps "Tilt" so the
// chip still renders the source's own tier.
const RATING_SCORE: Record<string, number> = {
  "Likely D": -2,
  "Lean D": -1,
  "Tilt D": -1,
  "Toss Up": 0,
  "Tilt R": 1,
  "Lean R": 1,
  "Likely R": 2,
};

const EXPECTED_HOUSE_ROWS = 435;

export type ScrapedRating = {
  raceId: string; // e.g. "CA-22-2026"
  source: RatingSource;
  rating: string; // normalized: "Lean R" | "Toss Up" | "Tilt D" | ...
  ratingScore: number;
  rawRating: string; // exactly as Ballotpedia rendered it
};

async function fetchHtml(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { "User-Agent": USER_AGENT, Accept: "text/html" },
    redirect: "follow",
  });
  if (!res.ok) throw new Error(`Ballotpedia fetch ${res.status}: ${url}`);
  return res.text();
}

// Decode the handful of HTML entities Ballotpedia emits inside cells.
function decodeEntities(s: string): string {
  return s
    .replace(/&#0?39;/g, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ")
    .trim();
}

function stripTags(s: string): string {
  return decodeEntities(s.replace(/<[^>]+>/g, " ").replace(/\s+/g, " "));
}

// Ballotpedia district cell text is "Alabama District 1" for multi-seat
// states and the bare state name ("Alaska") for at-large. Returns the
// race_id, or null for at-large (no race row exists for at-large states —
// backfill:races skips NULL-district members, same as handoff 84).
function toRaceId(districtCell: string): string | null {
  const text = stripTags(districtCell);
  const m = text.match(/^(.+?) District (\d{1,2})$/);
  if (!m || !m[1] || !m[2]) return null; // at-large or unparseable — skip
  const abbr = stateAbbr(m[1]);
  if (!abbr) return null;
  return `${abbr}-${m[2].padStart(2, "0")}-2026`;
}

// Parse one rating cell into a normalized ScrapedRating, or null when the
// cell is Solid/Safe (skipped) or an unrecognized vocabulary (warned).
function parseRatingCell(
  raceId: string,
  source: RatingSource,
  cellHtml: string,
): ScrapedRating | null {
  const rawRating = stripTags(cellHtml);
  const normalized = NORMALIZE[rawRating];
  if (normalized === undefined) {
    // Vocabulary we didn't expect — worth a log. Empty cells (a rater
    // hasn't rated the seat) are common and silently skipped.
    if (rawRating) {
      console.warn(`  unknown ${source} rating "${rawRating}" for ${raceId}`);
    }
    return null;
  }
  if (normalized === null) return null; // Solid/Safe — not seeded
  return {
    raceId,
    source,
    rating: normalized,
    ratingScore: RATING_SCORE[normalized] ?? 0,
    rawRating,
  };
}

// Scrapes all three rater columns from the Ballotpedia House ratings
// table. Returns a flat array — one entry per (race, source) pair where
// the rating is competitive (non-Solid/Safe).
export async function scrapeHouseRatings(): Promise<ScrapedRating[]> {
  const html = await fetchHtml(HOUSE_URL);

  // The ratings comparison table follows this intro sentence. Anchoring on
  // it avoids grabbing one of the page's other ~15 tables.
  const anchor = html.indexOf("compares U.S. House race ratings");
  if (anchor === -1) {
    throw new Error("Ballotpedia House page: ratings-table intro not found");
  }
  const tableStart = html.indexOf("<table", anchor);
  const tableEnd = html.indexOf("</table>", tableStart);
  if (tableStart === -1 || tableEnd === -1) {
    throw new Error("Ballotpedia House page: ratings table not found");
  }
  const table = html.slice(tableStart, tableEnd + 8);

  const bodyStart = table.indexOf("<tbody");
  const body = bodyStart === -1 ? table : table.slice(bodyStart);
  const rowMatches = body.match(/<tr>[\s\S]*?<\/tr>/g) ?? [];

  if (rowMatches.length < EXPECTED_HOUSE_ROWS - 5) {
    // -5 tolerates a stray header/spacer row; a real structural change
    // (column reorder, table replaced) collapses the count far below this.
    throw new Error(
      `Ballotpedia House table shape changed: got ${rowMatches.length} rows, expected ~${EXPECTED_HOUSE_ROWS}`,
    );
  }

  const out: ScrapedRating[] = [];
  for (const row of rowMatches) {
    const cells = row.match(/<t[hd][^>]*>[\s\S]*?<\/t[hd]>/g) ?? [];
    // Expected cell order: District, Cook, Inside Elections, Sabato.
    if (cells.length < 4) continue;
    const raceId = toRaceId(cells[0]!);
    if (!raceId) continue; // at-large / unparseable
    for (const { index, source } of SOURCE_COLUMN) {
      const parsed = parseRatingCell(raceId, source, cells[index]!);
      if (parsed) out.push(parsed);
    }
  }
  return out;
}

export const BALLOTPEDIA_HOUSE_URL = HOUSE_URL;
