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
// Parsing: regex over the single, uniform, server-rendered table rather than
// adding an HTML-parser dependency for one table.
//
// ── HO 742: THE TABLE LEFT THE PAGE, AND THE OLD GUARD WATCHED IT GO ─────────
//
// Between 2026-09-02 and 2026-09-09 Ballotpedia moved the ratings comparison
// off the wiki page and into a DEFERRED CLIENT-SIDE WIDGET. What remains where
// the table was is an empty div:
//
//   <div data-url="https://bpwidget.net/widgets/candidates/race-ratings-full-table
//                  ?defer=1&office_type=House&year=2026" data-bpw-defer></div>
//
// The old code anchored on the intro sentence and took the FIRST <table> after
// it. With the ratings table gone, that is the Cook PVI table three thousand
// characters further down — District | Incumbent | PVI, three columns, and
// (this is the part that mattered) still exactly 435 rows. So the guard that
// existed "so a silent Ballotpedia restructure fails loud" compared the one
// number the change preserved, every row then failed `cells.length < 4` and hit
// a `continue`, and the sync wrote `scraped 0 upserted 0` under a `success`
// verdict for two consecutive Wednesdays while `/api/health` read healthy.
// Measured at HO 741/742: 0 ratings returned, `race_ratings.newest` frozen at
// 2026-09-02T11:01:32Z, 435 districts stale.
//
// FOUR THINGS CHANGED, and the fourth is why the first three are not enough.
//
//  1. DISCOVERY, not a hardcoded widget URL. We still fetch HOUSE_URL, then
//     find the div whose `data-url` contains `race-ratings-full-table` AND
//     `office_type=House`, and fetch that. Matching on those two substrings
//     rather than the div's id is deliberate — `bpw-94f2ef45` is a generated
//     hash and will not survive a re-render. A year rollover is then one string
//     inside a query we read rather than one we wrote.
//  2. THE TABLE IS SELECTED BY ITS HEADER, never by position.
//  3. THE COLUMN INDICES COME FROM THAT HEADER. The widget's table is FIVE
//     columns — District | Cook Political Report | Decision Desk | Inside
//     Elections | Sabato's Crystal Ball — so the old hardcoded 1/2/3 would file
//     Decision Desk's ratings as Inside Elections and Inside Elections' as
//     Sabato, with a plausible `scraped` count and no error anywhere. There is
//     deliberately NO fallback to 1/2/3: a fallback here is the misfiling path
//     wearing a safety label.
//  4. EVERY SILENT `continue` THAT COULD SWALLOW THE WHOLE RUN IS A THROW.
//     Discovery, header, parsed-row floor and non-empty result each throw with
//     the census they saw. A throw inside `wrapCronRoute` is recorded as
//     `status = 'error'` with the message in `error_message` and the body
//     (`lib/cron-log.ts:175-183`), so `/api/health` reds on `lastStatus`. The
//     alarm the ledger asked for is the route's own failure, not a new
//     instrument.
//
// A fourth rater (Decision Desk HQ / The Hill) now arrives in the same response
// at zero extra cost. It is READ AND IGNORED here, and logged once per run as
// `column present, not ingested`, so the decision to take it is a decision
// somebody makes rather than one that happens.

import { stateAbbr } from "./states";
import { fetchError } from "./redact";

const HOUSE_URL =
  "https://ballotpedia.org/United_States_House_of_Representatives_elections,_2026";

// Browser-ish UA — Ballotpedia 202s a bare/automation UA.
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

export type RatingSource = "cook" | "inside_elections" | "sabato";

// HO 742: sources are located by HEADER TEXT, not by index. The substrings are
// the shortest that identify a column unambiguously in the widget's header
// (`District | Cook Political Report | Decision Desk | Inside Elections |
// Sabato's Crystal Ball`) — "cook" would also match "Cook Partisan Voter Index"
// on the wiki page, which is why the table is header-selected first.
const SOURCE_MATCH: { needle: string; source: RatingSource }[] = [
  { needle: "cook", source: "cook" },
  { needle: "inside elections", source: "inside_elections" },
  { needle: "sabato", source: "sabato" },
];
const DISTRICT_HEADER = "district";

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
  // HO 742: the widget's caption carries Ballotpedia's own as-of date ("2026
  // U.S. House Race Ratings as of September 15, 2026"). The wiki page gave
  // nothing better than the scrape date, so `race_ratings.rating_date` has
  // always been "when we looked"; now it can be "what they published". NULL
  // when the caption does not parse — the sync falls back to the scrape date,
  // which is exactly today's behaviour, so the fallback degrades nothing.
  asOfDate: string | null; // YYYY-MM-DD
};

async function fetchHtml(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { "User-Agent": USER_AGENT, Accept: "text/html" },
    redirect: "follow",
  });
  if (!res.ok) throw fetchError(url, res.status);
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

// District cell text is "Alabama District 1" for multi-seat states and the bare
// state name ("Alaska") for at-large. Measured on the widget at HO 742: 429 of
// the former, 6 of the latter, 0 unmatched.
//
// HO 742 — AT-LARGE SEATS ARE IN SCOPE NOW. This used to return null for them,
// on the comment "no race row exists for at-large states — backfill:races skips
// NULL-district members, same as handoff 84". That premise was RETIRED BY HO
// 711, which mints `{ST}-AL-{YYYY}` for the six at-large states and gives each
// one a `races` row; the drop survived it by four HOs. All three raters have
// `AK-AL-2026` at Likely R, and it had never received a synced rating.
//
// Only one new branch, deliberately. The "Alabama's 1st" form belongs to the
// Cook PVI table, not this one, and teaching the parser a form the source does
// not use would hide the next shape change inside a successful parse — a form
// this does not know surfaces as a floor breach, which is the signal wanted.
function toRaceId(districtCell: string): string | null {
  const text = stripTags(districtCell);
  const m = text.match(/^(.+?) District (\d{1,2})$/);
  if (m?.[1] && m[2]) {
    const abbr = stateAbbr(m[1]);
    return abbr ? `${abbr}-${m[2].padStart(2, "0")}-2026` : null;
  }
  // Bare state name, or an explicit at-large label.
  const bare = text.replace(/'s At-Large$/i, "").replace(/ At-Large$/i, "").trim();
  const abbr = stateAbbr(bare);
  return abbr ? `${abbr}-AL-2026` : null;
}

// Parse one rating cell into a normalized ScrapedRating, or null when the
// cell is Solid/Safe (skipped) or an unrecognized vocabulary (warned).
function parseRatingCell(
  raceId: string,
  source: RatingSource,
  cellHtml: string,
): Omit<ScrapedRating, "asOfDate"> | null {
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
/**
 * Find the ratings widget the page defers to.
 *
 * Matched on two substrings of the `data-url` — `race-ratings-full-table` and
 * `office_type=House` — and never on the div's id, which is a generated hash
 * (`bpw-94f2ef45`) that will not survive a re-render. Exactly one must match.
 */
export function discoverWidgetUrl(pageHtml: string): string {
  const urls = [...pageHtml.matchAll(/data-url="([^"]+)"/g)].map((m) =>
    decodeEntities(m[1] ?? ""),
  );
  const hits = urls.filter(
    (u) => u.includes("race-ratings-full-table") && u.includes("office_type=House"),
  );
  if (hits.length !== 1) {
    throw new Error(
      `Ballotpedia House page: expected exactly 1 race-ratings widget data-url, found ${hits.length}. ` +
        `data-urls on the page: ${urls.length ? urls.join(" | ") : "(none)"}`,
    );
  }
  return hits[0]!;
}

/** The caption's "as of <Month D, YYYY>", or null when it does not parse. */
const MONTHS = [
  "january", "february", "march", "april", "may", "june",
  "july", "august", "september", "october", "november", "december",
];
export function captionAsOfDate(widgetHtml: string): string | null {
  const cap = widgetHtml.match(/<caption[^>]*>([\s\S]*?)<\/caption>/);
  const text = cap ? stripTags(cap[1] ?? "") : "";
  const m = text.match(/as of ([A-Za-z]+) (\d{1,2}),\s*(\d{4})/i);
  if (!m) {
    if (text) console.warn(`  caption did not parse an as-of date: "${text}"`);
    return null;
  }
  const mo = MONTHS.indexOf(m[1]!.toLowerCase());
  if (mo === -1) {
    console.warn(`  caption month not recognized: "${text}"`);
    return null;
  }
  return `${m[3]}-${String(mo + 1).padStart(2, "0")}-${m[2]!.padStart(2, "0")}`;
}

/**
 * Parse the widget's ratings table. Separated from the fetch so the HO 742
 * shape diagnostic can run the SHIPPED parser against saved and mangled
 * fixtures — a parser only ever exercised through the network is a parser whose
 * failure modes are only ever seen in production.
 */
export function parseRatingsTable(widgetHtml: string): ScrapedRating[] {
  const tables = [...widgetHtml.matchAll(/<table[\s\S]*?<\/table>/g)].map((m) => m[0]);
  const headerOf = (t: string): string[] => {
    const thead = t.match(/<thead>([\s\S]*?)<\/thead>/);
    const scope = thead ? thead[1]! : t;
    const firstRow = scope.match(/<tr[^>]*>[\s\S]*?<\/tr>/);
    if (!firstRow) return [];
    return (firstRow[0].match(/<t[hd][^>]*>[\s\S]*?<\/t[hd]>/g) ?? []).map(stripTags);
  };

  // (1) THE TABLE IS SELECTED BY ITS HEADER.
  const matched = tables
    .map((t, i) => ({ t, i, header: headerOf(t) }))
    .filter(({ header }) => {
      const joined = header.join(" | ").toLowerCase();
      return SOURCE_MATCH.every(({ needle }) => joined.includes(needle));
    });
  if (matched.length !== 1) {
    throw new Error(
      `race-ratings widget: expected exactly 1 table whose header names Cook, Inside Elections and Sabato, ` +
        `found ${matched.length} of ${tables.length} tables. Headers seen: ` +
        (tables.length
          ? tables.map((t, i) => `[${i}] ${headerOf(t).join(" / ") || "(no header)"}`).join(" ;; ")
          : "(no tables)"),
    );
  }
  const { t: table, header } = matched[0]!;

  // (2) THE COLUMN INDICES COME FROM THAT HEADER. No fallback to literals.
  const districtCol = header.findIndex((h) => h.toLowerCase().includes(DISTRICT_HEADER));
  const sourceCols = SOURCE_MATCH.map(({ needle, source }) => ({
    source,
    index: header.findIndex((h) => h.toLowerCase().includes(needle)),
  }));
  const missing = [
    ...(districtCol === -1 ? ["District"] : []),
    ...sourceCols.filter((c) => c.index === -1).map((c) => c.source),
  ];
  if (missing.length) {
    throw new Error(
      `race-ratings widget: header matched the table but not its columns — missing ${missing.join(", ")}. ` +
        `Header: ${header.join(" / ")}`,
    );
  }
  // Every column we do NOT ingest, named once per run. Decision Desk HQ / The
  // Hill arrives here; it is received and ignored until somebody decides.
  const taken = new Set([districtCol, ...sourceCols.map((c) => c.index)]);
  header.forEach((h, i) => {
    if (!taken.has(i) && h) console.log(`  column present, not ingested: "${h}"`);
  });

  const tbody = table.match(/<tbody>([\s\S]*?)<\/tbody>/);
  const body = tbody ? tbody[1]! : table;
  const rowMatches = [...body.matchAll(/<tr[^>]*>[\s\S]*?<\/tr>/g)].map((m) => m[0]);
  const asOfDate = captionAsOfDate(widgetHtml);

  const out: ScrapedRating[] = [];
  const unknown = new Map<string, number>();
  let parsedRows = 0;
  for (const row of rowMatches) {
    const cells = row.match(/<t[hd][^>]*>[\s\S]*?<\/t[hd]>/g) ?? [];
    if (cells.length <= districtCol) continue;
    const raceId = toRaceId(cells[districtCol]!);
    if (!raceId) continue;
    parsedRows++;
    for (const { source, index } of sourceCols) {
      const cell = cells[index];
      if (cell === undefined) continue;
      const raw = stripTags(cell);
      if (raw && NORMALIZE[raw] === undefined) unknown.set(raw, (unknown.get(raw) ?? 0) + 1);
      const parsed = parseRatingCell(raceId, source, cell);
      if (parsed) out.push({ ...parsed, asOfDate });
    }
  }

  // (3) THE PARSED-ROW FLOOR. Counted where `toRaceId` is called, so a cell-shape
  // change reads as a shape change rather than as 435 silent skips. `- 5`
  // tolerates a stray spacer row; it does NOT tolerate the six at-large seats
  // being dropped again, which is the regression this number is sized against.
  if (parsedRows < EXPECTED_HOUSE_ROWS - 5) {
    throw new Error(
      `race-ratings widget: only ${parsedRows} of ${rowMatches.length} rows yielded a race id ` +
        `(expected ~${EXPECTED_HOUSE_ROWS}) — the district-cell shape changed. ` +
        `First cells: ${rowMatches
          .slice(0, 3)
          .map((r) => JSON.stringify(stripTags((r.match(/<t[hd][^>]*>[\s\S]*?<\/t[hd]>/g) ?? [])[districtCol] ?? "")))
          .join(", ")}`,
    );
  }

  // (4) A NON-EMPTY RESULT. Every district Solid/Safe is not a reading anyone
  // has ever taken; an empty result is the two-week silence this HO exists for.
  if (out.length === 0) {
    const vocab = [...unknown.entries()].map(([k, v]) => `${JSON.stringify(k)}×${v}`).join(", ");
    throw new Error(
      `race-ratings widget: parsed ${parsedRows} rows and scraped ZERO competitive ratings — ` +
        `the table parsed but no cell matched the known vocabulary. ` +
        `Unrecognized labels seen: ${vocab || "(none — every cell was Solid/Safe or empty)"}`,
    );
  }
  if (unknown.size) {
    console.warn(
      `  ${unknown.size} unrecognized rating label(s): ` +
        [...unknown.entries()].map(([k, v]) => `${JSON.stringify(k)}×${v}`).join(", "),
    );
  }
  return out;
}

/**
 * Scrape all three rater columns. Two fetches: the wiki page (to discover the
 * widget) and the widget itself (~208 KB).
 */
export async function scrapeHouseRatings(): Promise<ScrapedRating[]> {
  const pageHtml = await fetchHtml(HOUSE_URL);
  const widgetUrl = discoverWidgetUrl(pageHtml);
  console.log(`  ratings widget: ${widgetUrl}`);
  const widgetHtml = await fetchHtml(widgetUrl);
  return parseRatingsTable(widgetHtml);
}

export const BALLOTPEDIA_HOUSE_URL = HOUSE_URL;
