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
//
// ── HO 770: ONE READER PER RATER, AND SABATO'S CHANGE LOG IS THE FIRST ──────
//
// The Ballotpedia transport is gone from this file. Its widget stopped
// answering a plain GET: the ratings table now comes from a POST that carries
// a signed per-page token (`wgBPWDeferToken`, HO 769 STEP 0), and replaying
// that token is ruled out. The raters were then weighed one at a time:
//  - Wikipedia's 2026 ratings tables lag the raters they cite. On 2026-10-09
//    the House table dated its Cook, IE and Sabato columns Aug. 25, 20 and 26,
//    and 19 of 28 sampled Cook cells differed from Cook's own page, so reading
//    it would roll the store back and log the rollback as a move.
//  - Cook's site is public, but its Terms & Conditions bar "any robot, spider,
//    or other automatic device, process, or means to access the Website for
//    any purpose". No code here fetches cookpolitical.com. Its API is by
//    request, and access was asked for on 2026-10-09.
//  - Inside Elections publishes its ratings as a JSON export under its ratings
//    pages' Export → API, but Cloudflare answers this file's user agent with
//    its block page (403, 2026-10-10). IE's reader waits on IE.
//  - Sabato's Crystal Ball publishes its ratings pages as map images, and its
//    rating-changes page as text: dated tables of old → new ratings for the
//    House, the Senate and governors. That page is the one source wired.
// A change log is enough because the store already holds a base, Ballotpedia's
// reading of 2026-09-30: each race's newest change is the rater's current
// rating, and a race with no change keeps the row it has. A stored row whose
// label appears nowhere in its race's chain of changes can't be squared with
// the log, so the sync sets it aside as a conflict rather than write over it
// (lib/race-ratings-sync.ts).
//
// What HO 742-744 learned carries over: throws that carry their census,
// absolute floors per chamber, a chamber passed and never inferred, departures
// on evidence and never on absence, and the 8s cap. The user agent says what
// it is. A source that refuses an honest fetcher is a finding to report, never
// a reason to disguise the fetcher.

import { STATE_ABBR_TO_NAME, isTerritorialState } from "./states";
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
//
// HO 770: Sabato's page carries every chamber's tables, so the chamber also
// picks which tables are read. A table is the chamber's only when its section
// heading and its header's id cell both say so (parseSabatoChanges).
export type Chamber = "house" | "senate";

// HO 770: the agent names the project and where to find it. The browser string
// it replaced existed for Ballotpedia's 202 wall.
const USER_AGENT = "CBT-ratings-sync/1.0 (+https://github.com/CSU-J3/cbt)";

export type RatingSource = "cook" | "inside_elections" | "sabato";

// HO 770 — THE RATERS EACH CHAMBER READS. Sabato's Crystal Ball, from its
// rating-changes page, for both chambers. Inside Elections is not wired:
// Cloudflare answers this file's agent with its block page, and its reader
// waits on IE allowing the agent. Cook is not wired: its terms bar automated
// access to the site, and its reader waits on the API access asked for on
// 2026-10-09. An unwired rater's rows are left exactly as they are: no
// upserts, no departures, and their `rating_date` shows their age.
export const WIRED: Record<Chamber, readonly RatingSource[]> = {
  house: ["sabato"],
  senate: ["sabato"],
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
  // HO 743: the partisan-locked ends of the same scale. These never reach a
  // ScrapedRating (a locked label goes to `locked`, LOCKED below); they are
  // here so the DEPARTURE row a locked cell writes is scored by the
  // same map as every other row, and they carry the values the seeder already
  // assigns (scripts/seed-race-ratings.ts — "Solid D"/"Safe D" -3, "Solid R"/
  // "Safe R" 3). NOT 0: 0 is Toss Up's, so a seat going safe would otherwise
  // be logged at dead-centre of the very axis the history exists to plot.
  "Solid D": -3,
  "Safe D": -3,
  "Solid R": 3,
  "Safe R": 3,
};

// HO 743's locked-label idea, kept. A label at either partisan-locked end is
// the rater saying the seat is out of play: evidence that can retire a row
// (applyDepartures, lib/race-ratings-sync.ts), never a rating to seed. Cook
// and IE say Solid; Sabato says Safe.
const LOCKED = new Set(["Solid D", "Solid R", "Safe D", "Safe R"]);

/** HO 770 — one step in a change-log rater's chain for a race. */
export type RatingChange = {
  date: string; // YYYY-MM-DD, the date of the change's table
  from: string | null; // normalized; null when outside the vocabulary
  to: string | null;
};

export type ScrapedRating = {
  raceId: string; // e.g. "CA-22-2026"
  source: RatingSource;
  rating: string; // normalized: "Lean R" | "Toss Up" | "Tilt D" | ...
  ratingScore: number;
  rawRating: string; // exactly as the rater's page rendered it
  // HO 742: the widget's caption carries Ballotpedia's own as-of date ("2026
  // U.S. House Race Ratings as of September 15, 2026"). The wiki page gave
  // nothing better than the scrape date, so `race_ratings.rating_date` has
  // always been "when we looked"; now it can be "what they published". NULL
  // when the caption does not parse — the sync falls back to the scrape date,
  // which is exactly today's behaviour, so the fallback degrades nothing.
  // HO 770: for Sabato, the date of the race's newest change.
  asOfDate: string | null; // YYYY-MM-DD
  // HO 770: a change-log rater's every change for this race, oldest first.
  // The sync checks the stored row against it before writing; absent for a
  // rater whose source is a table of current ratings.
  chain?: readonly RatingChange[];
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
 *
 * HO 770: for Sabato, a race whose newest change moved it to Safe, which is the
 * rater saying so on that change's date. A race the log never mentions is an
 * absence and appears nowhere.
 */
export type LockedCell = {
  raceId: string;
  source: RatingSource;
  label: string; // the rater's own word, normalized: "Solid R" | "Safe D" | ...
  ratingScore: number; // ±3 — the locked ends of the same scale (RATING_SCORE)
  rawRating: string; // exactly as the rater's page rendered it
  asOfDate: string | null; // as on ScrapedRating
  chain?: readonly RatingChange[]; // as on ScrapedRating
};

/**
 * What a read yields: the competitive ratings, and (HO 743) the locked cells
 * and the raters they came from.
 *
 * `sourcesPresent` is the list of raters that read, and the sync refuses to
 * delete for a source outside it. HO 770: from `scrapeChamber` it is exactly the
 * wired raters whose read succeeded, so a rater that failed deletes nothing
 * and its leg fails after the others have written.
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
//
// HO 770: a run makes one fetch, Sabato's page, and both legs share it
// (newScrapeRun). A hang therefore fails both legs inside the one cap, and a
// page that arrives but doesn't parse for a chamber fails only that leg.
const FETCH_TIMEOUT_MS = 8_000;

/**
 * Every reader's fetch: this file's agent, an `Accept` per call, the 8s budget
 * over headers and body, and `fetchError` on a non-2xx answer, carrying the
 * refusal's shape (HO 771, refusalShape), or with status 0 on our own timeout.
 * Exported so the shape diagnostic's controls run it against local servers.
 */
export async function fetchSource(url: string, accept: string): Promise<string> {
  const signal = AbortSignal.timeout(FETCH_TIMEOUT_MS);
  // Our budget running out, not the host's answer. Through `fetchError` like
  // every URL-bearing throw (HO 679); status 0 marks our own timeout, as the
  // primaries scrape's `httpStatus: 0` does.
  const timedOut = (e: unknown) => {
    throw signal.aborted ? fetchError(url, 0, `no answer within the ${FETCH_TIMEOUT_MS}ms per-fetch budget`) : e;
  };
  const res = await fetch(url, {
    headers: { "User-Agent": USER_AGENT, Accept: accept },
    redirect: "follow",
    signal,
  }).catch(timedOut);
  // A refusal is the host's answer, so it never reads as status 0, even when
  // its body runs out the budget.
  if (!res.ok) throw fetchError(url, res.status, await refusalShape(res, signal));
  return await res.text().catch(timedOut);
}

/**
 * HO 771 — what a refusal looked like. HO 770's one POST got Sabato's 403 from
 * pdx1 with the status alone (#23996), so nobody could say whether it was
 * Cloudflare's challenge or its block page. A non-2xx answer now has its body
 * read inside the same budget, and the thrown message carries the refusal's
 * shape: `cf-mitigated`, `server` and `cf-ray` when the answer has them, the
 * body's size, and its HTML <title>, 80 characters at most. Response headers
 * only, never a request header, and the message still goes through
 * `fetchError`, so it's redacted. A body that doesn't arrive inside the budget
 * still throws, with the status and the headers it has.
 */
async function refusalShape(res: Response, signal: AbortSignal): Promise<string> {
  const parts: string[] = [];
  for (const h of ["cf-mitigated", "server", "cf-ray"]) {
    const v = res.headers.get(h);
    if (v) parts.push(`${h} ${v}`);
  }
  try {
    const body = new Uint8Array(await res.arrayBuffer());
    const n = body.byteLength;
    parts.push(`${n.toLocaleString("en-US")} ${n === 1 ? "byte" : "bytes"}`);
    const title = /<title[^>]*>([\s\S]*?)<\/title>/i
      .exec(new TextDecoder().decode(body))?.[1]
      ?.replace(/\s+/g, " ")
      .trim();
    if (title) parts.push(`"${title.slice(0, 80)}"`);
  } catch {
    parts.push(signal.aborted ? `body not read within the ${FETCH_TIMEOUT_MS}ms budget` : "body unreadable");
  }
  return parts.join(", ");
}

/**
 * HO 770 — one run's fetches. Both chambers read the same page, so a run
 * fetches it once and both legs await the same answer: a hang costs the cap
 * once and fails both legs inside it, while each chamber still parses on its
 * own.
 */
export type ScrapeRun = { get(url: string, accept: string): Promise<string> };

export function newScrapeRun(): ScrapeRun {
  const inflight = new Map<string, Promise<string>>();
  return {
    get(url, accept) {
      const key = `${accept} ${url}`;
      let p = inflight.get(key);
      if (!p) {
        p = fetchSource(url, accept);
        inflight.set(key, p);
      }
      return p;
    },
  };
}

// Decode the handful of HTML entities the page emits in cells and headings.
function decodeEntities(s: string): string {
  return s
    .replace(/&#0?39;|&#x27;|&#8217;|&rsquo;/gi, "'")
    .replace(/&nbsp;|&#160;|&#xa0;/gi, " ")
    .replace(/&amp;/g, "&");
}

function stripTags(s: string): string {
  return decodeEntities(s.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

// ── HO 770: Sabato's Crystal Ball, from its rating-changes page ─────────────

/** The page Sabato's ratings are read from, and the `source_url` its rows cite. */
export const SABATO_CHANGES_URL = "https://centerforpolitics.org/crystalball/2026-rating-changes/";

// Sabato's words as the Old Rating and New Rating columns print them, to the
// normalized labels race_ratings already holds. Measured at STEP 0 (S1,
// 2026-10-10): these seven and no others. "Leans" is the store's "Lean", and
// Safe D and Safe R are the locked ends. Any other label is counted and never
// written, so a race whose newest label is one keeps the row it has.
const SABATO_LABEL: Record<string, string> = {
  "Safe Democratic": "Safe D",
  "Likely Democratic": "Likely D",
  "Leans Democratic": "Lean D",
  "Toss-up": "Toss Up",
  "Leans Republican": "Lean R",
  "Likely Republican": "Likely R",
  "Safe Republican": "Safe R",
};

// The floors, per chamber and absolute, for HO 744's reason: a proportional
// tolerance forgives a different number of missing rows in each chamber. A
// change log only grows (136 House rows and 26 Senate on 2026-10-08), so a
// floor under today's count still catches a page that lost most of a section.
// Apart from the floor, at most UNPARSED_MAX rows per chamber may mint no race
// id, or two: one or two odd cells are a typo, more are a change of shape.
const MIN_ROWS: Record<Chamber, number> = { house: 100, senate: 20 };
const UNPARSED_MAX = 2;

type Section = Chamber | "governor";

// The section headings, as the page writes them: `<h2>`s reading "Senate
// rating changes", "Governor rating changes" and "House rating changes".
const SECTION_HEADING = /^(Senate|Governor|House) rating changes$/i;

// What a header row says its table is, by the id column's own text: `District`
// for the House, `Senator` (once, `Senate`) for the Senate, `Governor` for
// governors.
function sectionOfHeaderCell(text: string): Section | null {
  switch (text.toLowerCase()) {
    case "district":
      return "house";
    case "senator":
    case "senate":
      return "senate";
    case "governor":
      return "governor";
    default:
      return null;
  }
}

// A date line's text, in the forms the page uses ("Oct. 8, 2026", "Sept. 22,
// 2026", "Sept 29, 2026", "June 11, 2026"), as YYYY-MM-DD; anything else null.
const MONTH: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4,
  may: 5, jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8,
  sep: 9, sept: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11,
  dec: 12, december: 12,
};
function parseChangeDate(text: string): string | null {
  const m = /^([A-Za-z]+)\.? (\d{1,2}), (\d{4})$/.exec(text);
  const month = m ? MONTH[m[1]!.toLowerCase()] : undefined;
  if (!m || month === undefined) return null;
  const day = Number(m[2]);
  const d = new Date(Date.UTC(Number(m[3]), month - 1, day));
  if (d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) return null;
  return d.toISOString().slice(0, 10);
}

const isState = (abbr: string) => abbr in STATE_ABBR_TO_NAME && !isTerritorialState(abbr);

// A House row names its seat as `ST-N` or `ST-AL` ("Bryan Steil (R, WI-1)",
// "NE-2 Open (Bacon, R)", "FL-22 (New)") and mints `{ST}-{NN|AL}-2026`.
function houseIds(cell: string): string[] {
  const ids = [...cell.matchAll(/\b([A-Z]{2})-(\d{1,2}|AL)\b/g)]
    .filter((m) => isState(m[1]!))
    .map((m) => `${m[1]}-${m[2] === "AL" ? "AL" : m[2]!.padStart(2, "0")}-2026`);
  return [...new Set(ids)];
}

// A Senate row names its state once ("Dan Sullivan (R-AK)", "IA Open (Ernst,
// R)") and mints `S-{ST}-2026`.
function senateIds(cell: string): string[] {
  const ids = [...cell.matchAll(/(?:^|[\s(,-])([A-Z]{2})(?=$|[\s),-])/g)]
    .map((m) => m[1]!)
    .filter(isState)
    .map((st) => `S-${st}-2026`);
  return [...new Set(ids)];
}

/** A House or Senate row that minted no race id, or two. */
export type UnparsedRow = { table: number; date: string; cell: string };

export type SabatoChanges = RatingsScrape & {
  // This chamber's tables, by their index among the page's tables.
  tables: { index: number; date: string; inherited: boolean; rows: number }[];
  rows: number; // rows that minted exactly one race id
  unparsed: UnparsedRow[];
  unknown: Record<string, number>; // labels outside the vocabulary, old and new, with counts
  pageAsOf: string | null; // the newest of this chamber's table dates
};

/**
 * Sabato's rating-changes page, read for one chamber. Pure, and exported so the
 * shape diagnostic runs the shipped parser on the saved page and its mangled
 * copies.
 *
 * Each table is one date's changes, a row per race: the id cell, then the old
 * and new ratings. A race's chain is its rows across the tables, oldest first,
 * and its newest change is Sabato's current rating for it: a competitive label
 * goes to `ratings` and a Safe one to `locked`, each dated by its table. A race
 * the page never mentions appears in neither.
 */
export function parseSabatoChanges(html: string, chamber: Chamber): SabatoChanges {
  const where = `Sabato rating changes (${chamber})`;
  const headings = [...html.matchAll(/<h2\b[^>]*>([\s\S]*?)<\/h2>/gi)].map((m) => ({
    at: m.index ?? 0,
    end: (m.index ?? 0) + m[0].length,
    text: stripTags(m[1] ?? ""),
  }));
  type Table = {
    index: number;
    section: Section | null; // what its heading says
    heading: string | null;
    header: string[];
    rows: string[][];
    idCol: number;
    byHeader: Section | null; // what its header's id cell says
    date: string | null;
    inherited: boolean;
    noDate: string; // why it has no date, when it hasn't
  };
  const spans = [...html.matchAll(/<table\b[\s\S]*?<\/table>/gi)];
  const tables: Table[] = [];
  for (const [i, m] of spans.entries()) {
    const at = m.index ?? 0;
    const h = headings.filter((x) => x.at < at).at(-1) ?? null;
    const hm = h ? SECTION_HEADING.exec(h.text) : null;
    const rows = [...m[0].matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map((r) =>
      [...(r[1] ?? "").matchAll(/<t([hd])\b[^>]*>([\s\S]*?)<\/t\1>/gi)].map((c) => stripTags(c[2] ?? "")),
    );
    const header = rows[0] ?? [];
    const idCol = header.findIndex((c) => sectionOfHeaderCell(c) !== null);

    // THE DATE. A table's own date line is a paragraph between it and what
    // stands above it (the table above, or its section heading) whose whole
    // text is a date. The S1 ruling (HO 770) adds one rule, for the page as
    // Sabato lays it out: a table with nothing but whitespace between it and
    // the table above, in the same section, takes that table's date, since the
    // date line above both governs the block. One table does today: table 39,
    // two House rows (AL-02 Likely Republican → Leans Republican, TX-34 Toss-up
    // → Leans Democratic) directly under the Sept. 10, 2026 table (MO-02,
    // MO-05). Any other table without its own date line throws, and so does a
    // section's first table, which has no table above it to take one from.
    const prev = i > 0 ? spans[i - 1]! : null;
    const above = prev && (!h || (prev.index ?? 0) > h.at) ? tables[i - 1]! : null;
    const from = above && prev ? (prev.index ?? 0) + prev[0].length : h ? h.end : 0;
    const gap = html.slice(from, at);
    const lines = [...gap.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)]
      .map((p) => parseChangeDate(stripTags(p[1] ?? "")))
      .filter((d): d is string => d !== null);
    let date: string | null = null;
    let inherited = false;
    let noDate = "";
    if (lines.length === 1) date = lines[0]!;
    else if (lines.length > 1) noDate = `${lines.length} date lines above it (${lines.join(", ")})`;
    else if (above && /^\s*$/.test(gap)) {
      if (above.date !== null) [date, inherited] = [above.date, true];
      else noDate = `only whitespace above it, and table ${above.index} above it has no date either (${above.noDate})`;
    } else if (above) {
      noDate = `no date line between it and table ${above.index}, only ${JSON.stringify(stripTags(gap).slice(0, 160))}`;
    } else {
      noDate = "no date line under its section heading, and no table above it in the section to take one from";
    }
    tables.push({
      index: i,
      section: hm ? (hm[1]!.toLowerCase() as Section) : null,
      heading: h?.text ?? null,
      header,
      rows,
      idCol,
      byHeader: idCol === -1 ? null : sectionOfHeaderCell(header[idCol]!),
      date,
      inherited,
      noDate,
    });
  }

  // THE CHAMBER. A table is this chamber's when its section heading and its
  // header's id cell both say so, and if only one does the page has moved under
  // us and the parse throws. A table placed in another section, by both or by
  // either alone, stays out of this chamber's reading: that is what lets the
  // House parse a page whose Senate heading is gone. A table with no chamber by
  // either throws in every leg, since it could be any chamber's.
  const mine: Table[] = [];
  for (const t of tables) {
    const shown = `heading ${JSON.stringify(t.heading)}, header ${t.header.join(" | ") || "(none)"}`;
    if (t.section === chamber && t.byHeader === chamber) mine.push(t);
    else if (t.section === chamber || t.byHeader === chamber) {
      throw new Error(
        `${where}: table ${t.index}'s heading says ${t.section ?? "no chamber"} and its header says ` +
          `${t.byHeader ?? "no chamber"} (${shown})`,
      );
    } else if (t.section === null && t.byHeader === null) {
      throw new Error(`${where}: table ${t.index} has no chamber by its heading or its header (${shown})`);
    }
  }

  type Step = RatingChange & { rawTo: string };
  const chains = new Map<string, Step[]>();
  const seenOn = new Map<string, number>(); // `${raceId}|${date}` → the table it was first seen in
  const unparsed: UnparsedRow[] = [];
  const unknown: Record<string, number> = {};
  const label = (raw: string): string | null => {
    const l = SABATO_LABEL[raw];
    if (l === undefined) unknown[raw] = (unknown[raw] ?? 0) + 1;
    return l ?? null;
  };
  const mint = chamber === "house" ? houseIds : senateIds;
  let parsed = 0;
  for (const t of mine) {
    if (t.date === null) throw new Error(`${where}: table ${t.index} has no date: ${t.noDate}`);
    // THE COLUMNS come from the header's text, never from position (HO 742).
    const oldCol = t.header.findIndex((c) => /^old rating$/i.test(c));
    const newCol = t.header.findIndex((c) => /^new rating$/i.test(c));
    if (oldCol === -1 || newCol === -1) {
      throw new Error(
        `${where}: table ${t.index} (${t.date}) has no ${oldCol === -1 ? "Old Rating" : "New Rating"} column ` +
          `(header ${t.header.join(" | ") || "(none)"})`,
      );
    }
    for (const cells of t.rows.slice(1)) {
      const cell = cells[t.idCol] ?? "";
      const ids = mint(cell);
      if (ids.length !== 1) {
        unparsed.push({ table: t.index, date: t.date, cell });
        continue;
      }
      parsed++;
      const raceId = ids[0]!;
      const first = seenOn.get(`${raceId}|${t.date}`);
      if (first !== undefined) {
        throw new Error(
          `${where}: ${raceId} changed twice on ${t.date} (tables ${first} and ${t.index}), ` +
            `so the page doesn't say which change came last`,
        );
      }
      seenOn.set(`${raceId}|${t.date}`, t.index);
      const rawTo = cells[newCol] ?? "";
      const step: Step = { date: t.date, from: label(cells[oldCol] ?? ""), to: label(rawTo), rawTo };
      const chain = chains.get(raceId);
      if (chain) chain.push(step);
      else chains.set(raceId, [step]);
    }
  }

  // THE FLOOR, with the unparsed rows' bound beside it.
  if (parsed < MIN_ROWS[chamber] || unparsed.length > UNPARSED_MAX) {
    throw new Error(
      `${where}: ${parsed} rows minted a race id (floor ${MIN_ROWS[chamber]}) and ${unparsed.length} didn't ` +
        `(at most ${UNPARSED_MAX}), across ${mine.length} tables — the page's shape changed. Unparsed: ` +
        (unparsed.map((u) => `${u.date} ${JSON.stringify(u.cell)}`).slice(0, 5).join(", ") || "none"),
    );
  }

  // Each race's newest change is its current rating.
  const ratings: ScrapedRating[] = [];
  const locked: LockedCell[] = [];
  for (const [raceId, steps] of chains) {
    steps.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    const newest = steps.at(-1)!;
    if (newest.to === null) continue; // outside the vocabulary: counted, never written
    const chain = steps.map(({ date, from, to }) => ({ date, from, to }));
    const base = { raceId, source: "sabato" as const, ratingScore: RATING_SCORE[newest.to] ?? 0, rawRating: newest.rawTo, asOfDate: newest.date, chain };
    if (LOCKED.has(newest.to)) locked.push({ ...base, label: newest.to });
    else ratings.push({ ...base, rating: newest.to });
  }

  // A NON-EMPTY RESULT. A page where no race's newest label is competitive is
  // not a reading anyone has taken.
  const vocab = Object.entries(unknown)
    .map(([k, v]) => `${JSON.stringify(k)}×${v}`)
    .join(", ");
  if (ratings.length === 0) {
    throw new Error(
      `${where}: ${parsed} rows and ZERO competitive current ratings — no race's newest label is in the vocabulary. ` +
        `Unrecognized labels seen: ${vocab || "(none; every race's newest label is Safe)"}`,
    );
  }
  if (vocab) console.warn(`  ${Object.keys(unknown).length} unrecognized rating label(s), never written: ${vocab} (${chamber})`);
  for (const u of unparsed) console.warn(`  unparsed row, ${u.date} table ${u.table}: ${JSON.stringify(u.cell)} (${chamber})`);

  const dated = mine.map((t) => ({ index: t.index, date: t.date ?? "", inherited: t.inherited, rows: t.rows.length - 1 }));
  return {
    ratings,
    locked,
    sourcesPresent: ["sabato"],
    tables: dated,
    rows: parsed,
    unparsed,
    unknown,
    pageAsOf: dated.map((t) => t.date).sort().at(-1) ?? null,
  };
}

/** HO 770 — where one rater's read came from, for its rows and its stats. */
export type RaterRead = {
  source: RatingSource;
  sourceUrl: string; // the page its rows cite as source_url
  dataUrl: string; // what was fetched to read it; for a page, the page itself
  asOf: string | null; // the source's own stamp on what was read (a page's article:modified_time)
  pageAsOf?: string | null; // a change log's newest table date, this chamber
  unparsed?: string[]; // a change log's rows that minted no race id, or two
};

type Reader = (chamber: Chamber, run: ScrapeRun) => Promise<{ read: RaterRead; scrape: RatingsScrape }>;

async function readSabato(chamber: Chamber, run: ScrapeRun): Promise<{ read: RaterRead; scrape: RatingsScrape }> {
  const html = await run.get(SABATO_CHANGES_URL, "text/html");
  const parsed = parseSabatoChanges(html, chamber);
  const asOf = /<meta\b[^>]*property="article:modified_time"[^>]*content="([^"]+)"/i.exec(html)?.[1] ?? null;
  const inherited = parsed.tables.filter((t) => t.inherited);
  console.log(
    `  sabato (${chamber}): ${parsed.tables.length} tables, ${parsed.rows} rows, current ${parsed.ratings.length} ` +
      `competitive and ${parsed.locked.length} Safe · newest table ${parsed.pageAsOf} · page modified ${asOf ?? "(no stamp)"}` +
      (inherited.length ? ` · dated by the table above: ${inherited.map((t) => `table ${t.index} (${t.date})`).join(", ")}` : ""),
  );
  return {
    scrape: { ratings: parsed.ratings, locked: parsed.locked, sourcesPresent: ["sabato"] },
    read: {
      source: "sabato",
      sourceUrl: SABATO_CHANGES_URL,
      dataUrl: SABATO_CHANGES_URL,
      asOf,
      pageAsOf: parsed.pageAsOf,
      unparsed: parsed.unparsed.map((u) => `${u.date} ${u.cell}`),
    },
  };
}

// The raters with a reader. One in WIRED without a reader fails its leg by name.
const READERS: Partial<Record<RatingSource, Reader>> = { sabato: readSabato };

/** What `scrapeChamber` returns: the raters that read, merged, their provenance, and the failures. */
export type ChamberScrape = {
  scrape: RatingsScrape;
  reads: RaterRead[];
  failures: { source: RatingSource; error: string }[];
};

/**
 * One chamber: its WIRED readers under Promise.allSettled, so a rater that fails
 * costs only its own rows. `scrape.sourcesPresent` names exactly the raters that
 * read. The sync writes those and then fails the leg on any failure. A caller
 * reading both chambers passes one run, so the page is fetched once.
 */
export async function scrapeChamber(chamber: Chamber, run: ScrapeRun = newScrapeRun()): Promise<ChamberScrape> {
  const wired = WIRED[chamber];
  const settled = await Promise.allSettled(
    wired.map(async (source) => {
      const reader = READERS[source];
      if (!reader) throw new Error(`${source} is wired for the ${chamber} but has no reader`);
      return reader(chamber, run);
    }),
  );
  const out: ChamberScrape = { scrape: { ratings: [], locked: [], sourcesPresent: [] }, reads: [], failures: [] };
  settled.forEach((s, i) => {
    const source = wired[i]!;
    if (s.status === "fulfilled") {
      out.scrape.ratings.push(...s.value.scrape.ratings);
      out.scrape.locked.push(...s.value.scrape.locked);
      out.scrape.sourcesPresent.push(source);
      out.reads.push(s.value.read);
    } else {
      out.failures.push({ source, error: s.reason instanceof Error ? s.reason.message : String(s.reason) });
    }
  });
  return out;
}
