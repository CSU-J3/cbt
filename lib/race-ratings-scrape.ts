// Race-ratings scraper (handoff 88). Pulls 2026 U.S. House race ratings
// from Ballotpedia's election page.
//
// Why Ballotpedia and not Sabato directly: Sabato's Crystal Ball 2026
// pages (centerforpolitics.org/crystalball/2026-house/) are JS-rendered —
// the static HTML carries zero rating data. Ballotpedia's MediaWiki
// `w/api.php` wikitext endpoint returns 404. But the rendered Ballotpedia
// election page DOES carry a clean server-rendered comparison table with
// Cook / Inside Elections / Sabato columns. We read Sabato's column from
// there. The stored `source` stays 'sabato' because the rating IS
// Sabato's verdict; only the transport is Ballotpedia.
//
// Scope: House only. Ballotpedia's 2026 Senate page has the intro
// sentence for a ratings table but no table — Senate Sabato ratings stay
// on the handoff-71 manual JSON seed until Ballotpedia publishes one.
//
// Parsing: regex over the single, uniform, server-rendered MediaWiki
// table rather than adding an HTML-parser dependency for one table. A
// row-count sanity check throws if the table shape changes (435 House
// districts expected) so a silent Ballotpedia restructure fails loud.

const HOUSE_URL =
  "https://ballotpedia.org/United_States_House_of_Representatives_elections,_2026";

// Browser-ish UA — Ballotpedia 202s a bare/automation UA.
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

// Ballotpedia's Sabato column vocabulary → the normalized labels already
// used in race_ratings (handoff 71's RATING_SCORES vocabulary). Safe* is
// deliberately absent: Solid/Safe House seats are not seeded (SKILL.md —
// 360+ partisan-locked rows of zero analytical value). A "Safe" verdict
// maps to null and the caller drops the row.
const SABATO_NORMALIZE: Record<string, string | null> = {
  "Safe Republican": null,
  "Safe Democratic": null,
  "Likely Republican": "Likely R",
  "Likely Democratic": "Likely D",
  "Lean Republican": "Lean R",
  "Lean Democratic": "Lean D",
  "Toss-up": "Toss Up",
};

// Score for the normalized label — mirrors scripts/seed-race-ratings.ts.
// race_ratings.rating_score is NOT NULL, so every upsert needs one.
const RATING_SCORE: Record<string, number> = {
  "Likely D": -2,
  "Lean D": -1,
  "Toss Up": 0,
  "Lean R": 1,
  "Likely R": 2,
};

const EXPECTED_HOUSE_ROWS = 435;

export type ScrapedRating = {
  raceId: string; // e.g. "CA-22-2026"
  rating: string; // normalized: "Lean R" | "Toss Up" | ...
  ratingScore: number;
  rawRating: string; // exactly as Ballotpedia rendered it
};

import { stateAbbr } from "./states";

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

export async function scrapeHouseSabatoRatings(): Promise<ScrapedRating[]> {
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
    const rawRating = stripTags(cells[3]!);
    const normalized = SABATO_NORMALIZE[rawRating];
    // undefined = vocabulary we didn't expect (log-worthy); null = Safe
    // (intentionally skipped). Both drop the row.
    if (normalized === undefined) {
      if (rawRating) {
        console.warn(`  unknown Sabato rating "${rawRating}" for ${raceId}`);
      }
      continue;
    }
    if (normalized === null) continue; // Safe — not seeded
    out.push({
      raceId,
      rating: normalized,
      ratingScore: RATING_SCORE[normalized] ?? 0,
      rawRating,
    });
  }
  return out;
}

export const BALLOTPEDIA_HOUSE_URL = HOUSE_URL;
