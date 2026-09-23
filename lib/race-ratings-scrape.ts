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
// Scope: House AND Senate (HO 744). One parser, parameterized by chamber —
// see CHAMBER, below, for what the parameter picks and what it deliberately
// does not. The pre-HO-744 comment here said Ballotpedia's 2026 Senate page
// "has the intro sentence for a ratings table but no table"; that was true of
// the wiki page and stopped being the whole story when the table moved into a
// widget, which is discovered per `office_type` and exists for both chambers.
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

// ── HO 744: THE CHAMBER IS A PARAMETER, BECAUSE A BARE STATE NAME IS NOT ────
//
// The Senate widget is the same widget: same host, same `race-ratings-full-
// table` path, same five columns, same caption form, same eleven labels. Two
// things differ, and only one of them is visible.
//
// The visible one is the id column's header — `State` where the House says
// `District`. That is a token.
//
// The invisible one is the trap. A Senate `State` cell reads "Alabama" —
// BARE — and `toHouseRaceId` turns a bare state name into `{ST}-AL-2026`,
// the at-large House id HO 711 minted. Nothing about the cell's text
// distinguishes the two chambers; "Alaska" is a valid House at-large cell and
// a valid Senate cell, and the House branch happily mints `AK-AL-2026` from
// the Senate row. Measured at HO 744 STEP 0 against the 2026-09-15 widget:
// all 35 Senate rows mint `{ST}-AL-2026`, FOUR of which name live House races
// (AK, DE, SD, WY — not six; ND and VT have no 2026 Senate race, so the widget
// never renders them). The live consequence today is an UPSERT, not a delete:
// `AK-AL-2026` holds three competitive House rows (Likely R ×3) and Alaska's
// Senate cells are Toss-up/Tilt R/Toss-up, so pointing the House parser at the
// Senate widget would silently rewrite Alaska's House ratings with Alaska's
// Senate ratings. DE/SD/WY are Solid/Safe on the Senate side and hold no House
// rating rows, so HO 743's departure rule finds nothing and deletes nothing —
// it is guarded on "a row exists", and that guard is the only thing standing
// between this and four deleted House races. One seeded at-large rating would
// remove it.
//
// So: the parser is TOLD its chamber. It is never inferred from the cell.
export type Chamber = "house" | "senate";

const HOUSE_URL =
  "https://ballotpedia.org/United_States_House_of_Representatives_elections,_2026";
const SENATE_URL = "https://ballotpedia.org/United_States_Senate_elections,_2026";

// The page a chamber's ratings are discovered from, and the `source_url` its
// rows cite. Writing the House page onto a Senate row would put the wrong
// provenance on the rows whose entire defect was their provenance.
const BALLOTPEDIA_URL: Record<Chamber, string> = {
  house: HOUSE_URL,
  senate: SENATE_URL,
};

// The widget's `office_type` query value, which is also what `discoverWidgetUrl`
// matches on. Capitalized exactly as Ballotpedia writes it.
const OFFICE_TYPE: Record<Chamber, string> = {
  house: "House",
  senate: "Senate",
};

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
// HO 744: the id column's header token, per chamber. The House widget's first
// column is `District`, the Senate's is `State`; everything to the right of it
// is identical and is still located by SOURCE_MATCH.
const ID_HEADER: Record<Chamber, string> = {
  house: "district",
  senate: "state",
};

// Ballotpedia preserves each rater's own vocabulary per column. Mapping to
// the normalized labels already used in race_ratings (handoff 71's
// RATING_SCORES vocabulary). The four partisan-locked labels — Cook/IE
// "Solid" and Sabato "Safe" — map to null: Solid/Safe House seats are not
// seeded (SKILL.md: 360+ partisan-locked rows of zero analytical value).
// Inside Elections' "Tilt" tier maps through verbatim.
//
// HO 743 — A LOCKED CELL IS NOW EVIDENCE, NOT AN ABSENCE. `null` here still
// means "do not seed this", and it now ALSO means "this rater says the seat is
// out of play today", which is the one thing that can retire a row this sync
// wrote months ago. The four are lifted out into LOCKED_LABEL below and
// returned alongside the competitive ratings; nothing about the mapping moves.
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
  // HO 743: the partisan-locked ends of the same scale. These are never
  // produced by `parseRatingCell` (NORMALIZE sends the four labels to null);
  // they are here so the DEPARTURE row a locked cell writes is scored by the
  // same map as every other row, and they carry the values the seeder already
  // assigns (scripts/seed-race-ratings.ts — "Solid D"/"Safe D" -3, "Solid R"/
  // "Safe R" 3). NOT 0: 0 is Toss Up's, so a seat going safe would otherwise
  // be logged at dead-centre of the very axis the history exists to plot.
  "Solid D": -3,
  "Safe D": -3,
  "Solid R": 3,
  "Safe R": 3,
};

// HO 743: the rater's own word for a locked seat, kept verbatim so the
// departure row says "Solid R" where Cook/IE said it and "Safe D" where Sabato
// did. Keys are exactly the NORMALIZE entries that map to null — a label in one
// and not the other is a bug, which `race-ratings-shape-742.ts` asserts.
const LOCKED_LABEL: Record<string, string> = {
  "Solid Republican": "Solid R",
  "Solid Democratic": "Solid D",
  "Safe Republican": "Safe R",
  "Safe Democratic": "Safe D",
};

// HO 744 — THE PARSED-ROW FLOOR IS PER CHAMBER, AND SO IS ITS TOLERANCE.
//
// This is the one of the four throws that could NOT be left alone. It read
// `parsedRows < EXPECTED_HOUSE_ROWS - 5` — a hard 430 — so a 35-row Senate
// table fails it unconditionally, forever, on every run. The header throw
// fires first today, which is exactly why the floor stays invisible until the
// header token is fixed and then becomes a permanent error.
//
// The tolerance is absolute and per chamber, NOT proportional: `-5` on 435 is
// a stray spacer row, and the same 5 on 35 would swallow six missing states
// without a sound. Senate is `0` — the widget renders every seat in the cycle
// or the shape changed, and there is no spacer row to forgive. Measured at
// HO 744 STEP 0: 435 House rows, 35 Senate rows, 0 unparsed in either.
const EXPECTED_ROWS: Record<Chamber, number> = { house: 435, senate: 35 };
const ROW_FLOOR_TOLERANCE: Record<Chamber, number> = { house: 5, senate: 0 };

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

/**
 * HO 743 — a cell in which a rater says the seat is NOT in play.
 *
 * The widget renders a cell for every one of the 435 districts × 3 raters, so a
 * Solid/Safe cell is the rater saying so today, in the same response that
 * carries the competitive ratings and at no extra fetch. That is what makes a
 * DELETE safe: the sync retires a row on an explicit statement, never on an
 * absence. An empty cell, a missing row and a source whose column vanished for
 * a week are all absences and none of them appears here.
 */
export type LockedCell = {
  raceId: string;
  source: RatingSource;
  label: string; // the rater's own word, normalized: "Solid R" | "Safe D" | ...
  ratingScore: number; // ±3 — the locked ends of the same scale (RATING_SCORE)
  rawRating: string; // exactly as Ballotpedia rendered it
  asOfDate: string | null; // the caption's date, as on ScrapedRating
};

/**
 * What one parse of the widget yields. `ratings` is what it has always been
 * and is byte-identical in shape; the other two are HO 743.
 *
 * `sourcesPresent` is the list of raters whose header cell MATCHED, and the
 * sync refuses to delete for a source outside it. Say plainly what it is worth
 * today: past the missing-columns throw above, all three columns matched by
 * construction, so this is always the full set and the per-source guard the
 * backlog line asked for is ALREADY HELD BY THAT THROW — a rater's column
 * dropping out of the widget errors the tick instead of deleting that rater's
 * every row. It is returned and checked anyway because the delete must not
 * inherit its safety from a throw two hundred lines away that a later edit
 * could narrow; if that throw ever becomes per-source, this is where the
 * deletion stops.
 */
export type RatingsScrape = {
  ratings: ScrapedRating[];
  locked: LockedCell[];
  sourcesPresent: RatingSource[];
};

// HO 744 — EVERY FETCH IS BOUNDED, page and widget, both chambers. None was, at
// any SHA, so a host that accepted and never answered held the run until
// wrapCronRoute's 55s soft timeout, which records `timeout` — and /api/health
// counts `timeout` as alive. With the two scrapes now behind one
// Promise.allSettled (lib/race-ratings-sync.ts) that would be a green run with
// NEITHER chamber written. Bounded, the hung fetch rejects, only its leg fails,
// and the run records `error` inside the budget.
//
// 8s is the number the primaries scrape uses against ballotpedia.org
// (lib/primary-candidates-scrape.ts, HO 120), where it bounds time-to-headers
// only; here one budget covers headers AND body, and bpwidget.net too. Against
// it: 187-437 ms for whole pdx1 runs that fetched the House page and wrote
// nothing (#325, #16049, #17773). The ~208 KB House widget has no solo timing
// from pdx1; whole widget-path runs, ~330 DB round trips included, are
// 4.3-5.0 s. The arithmetic that picks 8s is in the route header. The signal
// errors `res.text()` too, so a stalled body is bounded (measured HO 744 on
// Node 25; the deployed runtime is 24.x).
const FETCH_TIMEOUT_MS = 8_000;

async function fetchHtml(url: string): Promise<string> {
  const signal = AbortSignal.timeout(FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": USER_AGENT, Accept: "text/html" },
      redirect: "follow",
      signal,
    });
    if (!res.ok) throw fetchError(url, res.status);
    return await res.text();
  } catch (e) {
    // Our budget running out, not the host's answer. Through `fetchError` like
    // every URL-bearing throw (HO 679); status 0 marks our own timeout, as the
    // primaries scrape's `httpStatus: 0` does.
    if (signal.aborted) {
      throw fetchError(url, 0, `no answer within the ${FETCH_TIMEOUT_MS}ms per-fetch budget`);
    }
    throw e;
  }
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
// HO 744: RENAMED, BEHAVIOUR UNCHANGED. Every line below is what `toRaceId`
// did before, byte for byte; the name now says which chamber's ids it mints,
// because the bare-state branch is the ambiguity documented at CHAMBER above —
// this function will happily turn a SENATE widget's "Alaska" into
// `AK-AL-2026`, a live House race. It is only ever called with House cells.
function toHouseRaceId(districtCell: string): string | null {
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

// HO 744 — the Senate id form, `S-{ST}-2026` (lib/race-id.ts; the seed files
// and `races` agree).
//
// ONE FORM, AND NOTHING ELSE. Measured at STEP 0 against the 2026-09-15
// widget: all 35 `State` cells are bare state names — no "Florida (Special)",
// no parenthetical of any kind — and FL and OH appear exactly once each, so
// the special-election collapse the cook seed's `note` warns about
// (`races` keys Senate seats by next_election_year alone, so a regular AND a
// special row for one state would both mint `S-{ST}-2026` and the second
// would silently overwrite the first) IS NOT LIVE. It is one Ballotpedia
// re-render away from being live, so a cell this does not recognize returns
// null and is counted as an unparsed row — which trips the Senate floor's
// zero tolerance and throws — rather than being guessed at. A shape this does
// not know must surface as a failure, never inside a successful parse.
function toSenateRaceId(stateCell: string): string | null {
  const text = stripTags(stateCell);
  const abbr = stateAbbr(text);
  return abbr ? `S-${abbr}-2026` : null;
}

const TO_RACE_ID: Record<Chamber, (cell: string) => string | null> = {
  house: toHouseRaceId,
  senate: toSenateRaceId,
};

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

/**
 * Find the ratings widget the page defers to, for one chamber.
 *
 * Matched on two substrings of the `data-url` — `race-ratings-full-table` and
 * `office_type=<Chamber>` — and never on the div's id, which is a generated
 * hash (`bpw-94f2ef45`) that will not survive a re-render. Exactly one must
 * match. HO 744: the office-type half is a parameter; both chamber pages carry
 * exactly one such div, measured at STEP 0. (The gubernatorial page carries an
 * `office_type=Governor` one too — out of scope, since `races` has no governor
 * rows for a rating to land on.)
 */
export function discoverWidgetUrl(pageHtml: string, chamber: Chamber): string {
  const officeType = OFFICE_TYPE[chamber];
  const urls = [...pageHtml.matchAll(/data-url="([^"]+)"/g)].map((m) =>
    decodeEntities(m[1] ?? ""),
  );
  const hits = urls.filter(
    (u) => u.includes("race-ratings-full-table") && u.includes(`office_type=${officeType}`),
  );
  if (hits.length !== 1) {
    throw new Error(
      `Ballotpedia ${officeType} page: expected exactly 1 race-ratings widget data-url ` +
        `(office_type=${officeType}), found ${hits.length}. ` +
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
// HO 744: `chamber` only tags the warnings. The two scrapes now overlap, so a
// line's position in the log no longer says which widget it came from; the tag
// goes on the END so the quoted form every doc greps for is unchanged.
export function captionAsOfDate(widgetHtml: string, chamber?: Chamber): string | null {
  const tag = chamber ? ` (${chamber})` : "";
  const cap = widgetHtml.match(/<caption[^>]*>([\s\S]*?)<\/caption>/);
  const text = cap ? stripTags(cap[1] ?? "") : "";
  const m = text.match(/as of ([A-Za-z]+) (\d{1,2}),\s*(\d{4})/i);
  if (!m) {
    if (text) console.warn(`  caption did not parse an as-of date: "${text}"${tag}`);
    return null;
  }
  const mo = MONTHS.indexOf(m[1]!.toLowerCase());
  if (mo === -1) {
    console.warn(`  caption month not recognized: "${text}"${tag}`);
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
export function parseRatingsTable(widgetHtml: string, chamber: Chamber): RatingsScrape {
  const idHeader = ID_HEADER[chamber];
  const toRaceId = TO_RACE_ID[chamber];
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
      `race-ratings widget (${chamber}): expected exactly 1 table whose header names Cook, Inside Elections and Sabato, ` +
        `found ${matched.length} of ${tables.length} tables. Headers seen: ` +
        (tables.length
          ? tables.map((t, i) => `[${i}] ${headerOf(t).join(" / ") || "(no header)"}`).join(" ;; ")
          : "(no tables)"),
    );
  }
  const { t: table, header } = matched[0]!;

  // (2) THE COLUMN INDICES COME FROM THAT HEADER. No fallback to literals.
  // HO 744: the id column's token is the chamber's — `district` or `state`.
  const districtCol = header.findIndex((h) => h.toLowerCase().includes(idHeader));
  const sourceCols = SOURCE_MATCH.map(({ needle, source }) => ({
    source,
    index: header.findIndex((h) => h.toLowerCase().includes(needle)),
  }));
  const missing = [
    ...(districtCol === -1 ? [idHeader] : []),
    ...sourceCols.filter((c) => c.index === -1).map((c) => c.source),
  ];
  if (missing.length) {
    throw new Error(
      `race-ratings widget (${chamber}): header matched the table but not its columns — missing ${missing.join(", ")}. ` +
        `Header: ${header.join(" / ")}`,
    );
  }
  // Every column we do NOT ingest, named once per run. Decision Desk HQ / The
  // Hill arrives here; it is received and ignored until somebody decides.
  const taken = new Set([districtCol, ...sourceCols.map((c) => c.index)]);
  header.forEach((h, i) => {
    if (!taken.has(i) && h) console.log(`  column present, not ingested: "${h}" (${chamber})`);
  });

  const tbody = table.match(/<tbody>([\s\S]*?)<\/tbody>/);
  const body = tbody ? tbody[1]! : table;
  const rowMatches = [...body.matchAll(/<tr[^>]*>[\s\S]*?<\/tr>/g)].map((m) => m[0]);
  const asOfDate = captionAsOfDate(widgetHtml, chamber);

  const out: ScrapedRating[] = [];
  const locked: LockedCell[] = [];
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
      // HO 743: a locked cell, collected rather than skipped. This reads the
      // RAW label, not a null return — `parseRatingCell` returns null for an
      // empty cell and an unknown one too, and those are absences.
      const lockedLabel = LOCKED_LABEL[raw];
      if (lockedLabel) {
        locked.push({
          raceId,
          source,
          label: lockedLabel,
          ratingScore: RATING_SCORE[lockedLabel] ?? 0,
          rawRating: raw,
          asOfDate,
        });
        continue;
      }
      const parsed = parseRatingCell(raceId, source, cell);
      if (parsed) out.push({ ...parsed, asOfDate });
    }
  }

  // (3) THE PARSED-ROW FLOOR. Counted where `toRaceId` is called, so a cell-shape
  // change reads as a shape change rather than as 435 silent skips. House's `- 5`
  // tolerates a stray spacer row; it does NOT tolerate the six at-large seats
  // being dropped again, which is the regression this number is sized against.
  // Senate's tolerance is 0 — see EXPECTED_ROWS for why the House number could
  // not simply be reused.
  const floor = EXPECTED_ROWS[chamber] - ROW_FLOOR_TOLERANCE[chamber];
  if (parsedRows < floor) {
    throw new Error(
      `race-ratings widget (${chamber}): only ${parsedRows} of ${rowMatches.length} rows yielded a race id ` +
        `(expected ${EXPECTED_ROWS[chamber]}, floor ${floor}) — the ${idHeader}-cell shape changed. ` +
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
      `race-ratings widget (${chamber}): parsed ${parsedRows} rows and scraped ZERO competitive ratings — ` +
        `the table parsed but no cell matched the known vocabulary. ` +
        `Unrecognized labels seen: ${vocab || "(none — every cell was Solid/Safe or empty)"}`,
    );
  }
  if (unknown.size) {
    console.warn(
      `  ${unknown.size} unrecognized rating label(s): ` +
        [...unknown.entries()].map(([k, v]) => `${JSON.stringify(k)}×${v}`).join(", ") +
        ` (${chamber})`,
    );
  }
  return { ratings: out, locked, sourcesPresent: sourceCols.map((c) => c.source) };
}

/**
 * Scrape all three rater columns for one chamber. Two fetches: the wiki page
 * (to discover the widget) and the widget itself (~208 KB House, ~16 KB
 * Senate).
 *
 * HO 744: the two named callers below are thin — the chamber is the only thing
 * that differs, and it is passed, never inferred.
 */
export async function scrapeRatings(chamber: Chamber): Promise<RatingsScrape> {
  const pageHtml = await fetchHtml(BALLOTPEDIA_URL[chamber]);
  const widgetUrl = discoverWidgetUrl(pageHtml, chamber);
  console.log(`  ratings widget (${chamber}): ${widgetUrl}`);
  const widgetHtml = await fetchHtml(widgetUrl);
  return parseRatingsTable(widgetHtml, chamber);
}

export async function scrapeHouseRatings(): Promise<RatingsScrape> {
  return scrapeRatings("house");
}

export async function scrapeSenateRatings(): Promise<RatingsScrape> {
  return scrapeRatings("senate");
}

export const BALLOTPEDIA_HOUSE_URL = HOUSE_URL;
export const BALLOTPEDIA_SENATE_URL = SENATE_URL;
/** The page a chamber's rows cite as `source_url`. */
export function ballotpediaUrlFor(chamber: Chamber): string {
  return BALLOTPEDIA_URL[chamber];
}
