// Primary candidate scraper (handoff 91 Step 3 + handoff 92).
// Pulls 2026 primary rosters from Ballotpedia per-race election pages. Senate
// per-state pages and House per-district pages share the same "Candidates and
// election results" votebox markup, so the parser (`parseCandidatesPage`) is
// chamber-agnostic; only the URL shape differs per chamber.
//
// Senate URL: https://ballotpedia.org/United_States_Senate_election_in_{State},_2026
//   — SINGULAR "election_in". On a 404 the scraper retries the special-election
//   URL (United_States_Senate_special_election_in_{State},_2026), which is how
//   the FL and OH 2026 specials are published.
// House URL:  https://ballotpedia.org/{State}%27s_{N}{ordinal}_Congressional_District_election,_2026
//   — at-large districts (VT) substitute "At-large" for the ordinal. House
//   special elections are out of scope for handoff 92: when the normal URL
//   resolves to a special-election page the scraper returns status "special"
//   so the caller can log and move on.
//
// Each page's "Candidates and election results" section holds Ballotpedia
// "votebox" blocks. A votebox opens with <div class="race_header {kind}">
// — kind is democratic / republican / nonpartisan, and CAN BE ABSENT (a bare
// `race_header`, as on Louisiana's 2026 House pages) — followed by a
// <table class="results_table"> of <tr class="results_row ..."> rows, one per
// candidate. democratic/republican voteboxes are partisan primaries; a
// nonpartisan votebox (or a bare one whose <h5> says "nonpartisan primary")
// is an all-candidate top-N / jungle primary. The <h5> text both disambiguates
// primary vs general/runoff/special and, for a bare votebox, supplies the
// contest type the missing class would have. Per-candidate party in a
// nonpartisan votebox comes from the image-candidate-thumbnail-wrapper class
// (CA/WA/AK) or, when that is bare, the "(R)"/"(D)" suffix after the candidate
// link (Louisiana) — see openContestParty. Runoff voteboxes are skipped (their
// roster is a subset of the primary's). Candidate name is the <a> in the
// votebox-results-cell--text cell; incumbents are <u>-wrapped; the winner row
// carries a "winner" class. NY-style fusion-party voteboxes (Conservative,
// Working Families) carry no kind class and an <h5> that names no recognized
// contest, so they are still skipped.
//
// Parsing: regex, same approach as lib/race-ratings-scrape.ts and
// lib/primary-calendar-scrape.ts — no HTML-parser dependency.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

// Which primary row a candidate belongs to: the D or R partisan primary, or
// the "open" all-candidate primary (top-two / top-four / nonpartisan states).
export type CandidateContest = "D" | "R" | "open";

export type ScrapedCandidate = {
  name: string;
  contest: CandidateContest;
  party: string; // the candidate's own party letter (D/R/L/G/I/...)
  incumbent: boolean;
  isWinner: boolean;
  // HO 206: per-candidate result share, read from the SAME already-isolated
  // 2026-primary votebox the roster comes from (not a page-wide scan — the page
  // also carries historical 2024/2022 voteboxes with identical markup). NULL
  // when the box has no results yet (un-voted primary), distinguishable from 0
  // (a candidate who got 0%). `votePct` prefers the high-precision bar-width
  // style over the rounded `percentage_number` display.
  votePct: number | null;
  votes: number | null;
};

export type CandidateScrapeStatus =
  | "ok"
  | "no_page" // URL 404 / fetch failure
  | "no_section" // page exists but has no candidates section
  | "no_candidates" // section exists but parsed zero candidates
  | "special"; // normal URL resolved to a special-election page (skipped)

export type CandidateScrapeResult = {
  state: string;
  url: string;
  status: CandidateScrapeStatus;
  httpStatus?: number; // set on a "no_page" miss, for the failure report
  candidates: ScrapedCandidate[];
};

function decodeEntities(s: string): string {
  return s
    .replace(/&#0?39;/g, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&#0?34;/g, '"')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ")
    .replace(/&ndash;/g, "-")
    .trim();
}

function stripTags(s: string): string {
  return decodeEntities(s.replace(/<[^>]+>/g, " ").replace(/\s+/g, " "));
}

export function senatePageUrl(slug: string): string {
  return `https://ballotpedia.org/United_States_Senate_election_in_${slug},_2026`;
}

export function senateSpecialPageUrl(slug: string): string {
  return `https://ballotpedia.org/United_States_Senate_special_election_in_${slug},_2026`;
}

// English ordinal suffix: 1->1st, 2->2nd, 3->3rd, 4-20->th, 21->21st, etc.
// Built here so House district URLs aren't a hardcoded 1..30 table.
export function ordinal(n: number): string {
  const suffix = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return `${n}${suffix[(v - 20) % 10] ?? suffix[v] ?? suffix[0]}`;
}

// House per-district election page URL. `slug` is the state name with spaces
// underscored ("New_York"); `district` is the 1-based district number, or 0
// for an at-large seat (Vermont). States whose name ends in "s" take a bare
// apostrophe possessive ("Massachusetts'", "Texas'"); everything else "'s".
// %27 is the apostrophe.
export function houseDistrictUrl(slug: string, district: number): string {
  const possessive = slug.endsWith("s") ? "%27" : "%27s";
  const segment = district === 0 ? "At-large" : ordinal(district);
  return `https://ballotpedia.org/${slug}${possessive}_${segment}_Congressional_District_election,_2026`;
}

// Ballotpedia party token -> the one-letter code stored on candidates.
// Accepts both the full word (thumbnail-wrapper class, "Republican") and the
// single-letter abbreviation (Louisiana name suffix, "(R)").
function partyLetter(word: string): string {
  const w = word.trim().toLowerCase();
  if (w === "r" || w.startsWith("republican")) return "R";
  if (w === "d" || w.startsWith("democrat")) return "D";
  if (w === "l" || w.startsWith("libertarian")) return "L";
  if (w === "g" || w.startsWith("green")) return "G";
  return "I"; // independent / nonpartisan / unaffiliated / unknown
}

// Party for a candidate row in a nonpartisan ("open") votebox. Two markups
// occur in the wild: CA/WA/AK top-two/top-four rows tag the thumbnail wrapper
// with the full party word (image-candidate-thumbnail-wrapper Republican);
// Louisiana's nonpartisan-primary rows leave the wrapper bare and put a
// "(R)" / "(D)" abbreviation just after the candidate link. Try the wrapper,
// fall back to the abbreviation, default to independent.
function openContestParty(row: string): string {
  const wrap = row.match(/image-candidate-thumbnail-wrapper\s+([A-Za-z]+)/);
  if (wrap?.[1]) return partyLetter(wrap[1]);
  const abbr = row.match(/<\/a>\s*\(([A-Za-z]{1,12})\)/);
  if (abbr?.[1]) return partyLetter(abbr[1]);
  return "I";
}

// Parse one votebox slice into candidate rows. For D/R contests every row is
// that party; for an "open" contest the party is read per-row.
function parseVotebox(
  slice: string,
  contest: CandidateContest,
): ScrapedCandidate[] {
  const out: ScrapedCandidate[] = [];
  const table = slice.match(
    /<table class="results_table">[\s\S]*?<\/table>/,
  )?.[0];
  if (!table) return out;
  const rows = table.match(/<tr class="results_row[^"]*">[\s\S]*?<\/tr>/g) ?? [];
  for (const row of rows) {
    const link = row.match(
      /<a [^>]*href="https:\/\/ballotpedia\.org\/[^"]*"[^>]*>([\s\S]*?)<\/a>/,
    );
    const name = link?.[1] ? stripTags(link[1]) : "";
    if (!name) continue; // "Other/Write-in" aggregate rows carry no link
    let party: string;
    if (contest === "open") {
      party = openContestParty(row);
    } else {
      party = contest; // D or R
    }
    // HO 206: result share for this row. The bar-width style carries full
    // precision (e.g. width:78.40408...%); the `percentage_number` div is the
    // rounded display (78.4) — prefer the former, fall back to the latter.
    // Absent on an un-voted primary's votebox → NULL (not 0). Raw votes live in
    // the row's second `--number` cell (the first holds the percentage divs, so
    // its content starts with `<div>`, not a digit — the `>[0-9]` anchor only
    // matches the votes cell).
    const widthStr = row.match(
      /class="inner_percentage[^"]*"\s+style="width:\s*([0-9.]+)%/,
    )?.[1];
    const pctNumStr = row.match(/class="percentage_number">\s*([0-9.]+)\s*</)?.[1];
    const pctRaw =
      widthStr != null
        ? Number(widthStr)
        : pctNumStr != null
          ? Number(pctNumStr)
          : null;
    const votesStr = row.match(
      /class="votebox-results-cell--number">\s*([0-9][0-9,]*)\s*<\/td>/,
    )?.[1];
    const votesRaw = votesStr != null ? Number(votesStr.replace(/,/g, "")) : null;

    out.push({
      name,
      contest,
      party,
      incumbent: /<u>/.test(row), // Ballotpedia underlines incumbents
      isWinner: /class="results_row[^"]*\bwinner\b/.test(row),
      votePct: pctRaw != null && Number.isFinite(pctRaw) ? pctRaw : null,
      votes: votesRaw != null && Number.isFinite(votesRaw) ? votesRaw : null,
    });
  }
  return out;
}

// HO 120 per-fetch wall-clock cap. p95 was ~1.9s local in the HO 120 pre-
// flight measure → ~4s prod after the ~2× cold-network tax noted in HO 97,
// so 8s is roughly 2× that p95 — enough headroom for a slow real fetch, but
// not so much that a single hung request can burn a meaningful chunk of the
// 50s tick budget. `scrapeHouseCandidates` and `scrapeSenateCandidates` set
// their own AbortController with this deadline; on abort, the scrape
// returns `status: "no_page"` with `httpStatus: 0` so the caller can
// distinguish a timeout from a real 404 in `cron_runs.payload.fetchFailures`.
const FETCH_TIMEOUT_MS = 8_000;

async function fetchPage(
  url: string,
  signal?: AbortSignal,
): Promise<Response | null> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": USER_AGENT, Accept: "text/html" },
      redirect: "follow",
      signal,
    });
    return res;
  } catch {
    return null;
  }
}

// Marker for a real Ballotpedia race page — every 2026 district/state election
// page carries this section. Its absence on a 200 response means Ballotpedia
// served a challenge / partial page, not the article (worth a retry).
const CANDIDATES_ANCHOR = 'id="Candidates_and_election_results"';

// Dev-time HTML cache (handoff 92 note): a re-run reads disk instead of
// re-hitting Ballotpedia. Only "good" pages — ones carrying CANDIDATES_ANCHOR
// — are cached, so a transient challenge/block page is refetched next run
// rather than poisoning the cache.
const HTML_CACHE_DIR = join(process.cwd(), ".cache", "ballotpedia");

function cacheFileFor(url: string): string {
  const name = url
    .replace(/^https?:\/\/(www\.)?/, "")
    .replace(/[^a-zA-Z0-9]+/g, "_");
  return join(HTML_CACHE_DIR, `${name}.html`);
}

function readCachedHtml(url: string): string | null {
  const file = cacheFileFor(url);
  return existsSync(file) ? readFileSync(file, "utf8") : null;
}

function writeCachedHtml(url: string, html: string): void {
  // The cache is a dev-time convenience only. On a read-only filesystem —
  // e.g. a Vercel function, where process.cwd() is not writable — the write
  // fails; swallow it so the scrape proceeds uncached rather than crashing.
  try {
    mkdirSync(HTML_CACHE_DIR, { recursive: true });
    writeFileSync(cacheFileFor(url), html, "utf8");
  } catch {
    // ignore — uncached scrape is correct, just slower
  }
}

// Chamber-agnostic page parser: takes the raw HTML of a Ballotpedia election
// page and pulls every D / R / open primary roster out of its
// "Candidates and election results" section. Shared by the Senate (per-state)
// and House (per-district) scrapers — the markup is identical.
export function parseCandidatesPage(
  html: string,
  state: string,
  url: string,
): CandidateScrapeResult {
  const anchor = html.indexOf('id="Candidates_and_election_results"');
  if (anchor === -1) {
    return { state, url, status: "no_section", candidates: [] };
  }
  // On a dedicated special-election page every votebox header reads
  // "Special …", so the "drop anything special" gate below has to invert —
  // see the comment on the filter. Self-detected from the page <title> (the
  // same signal scrapeHouseCandidates uses) so no caller plumbing is needed;
  // on a regular page this is false and the gate is unchanged.
  const onSpecialPage = isSpecialElectionPage(html);
  const nextH2 = html.indexOf("<h2", anchor + 10);
  const section = html.slice(anchor, nextH2 === -1 ? anchor + 80000 : nextH2);

  const headers = [...section.matchAll(/<div class="race_header([^"]*)">/g)];
  const candidates: ScrapedCandidate[] = [];
  // Dedup by (contest, name): a runoff repeats a subset of the primary
  // roster, and some pages echo a candidate across blocks.
  const seen = new Set<string>();
  for (let i = 0; i < headers.length; i++) {
    const h = headers[i]!;
    const cls = h[1] ?? "";

    const start = h.index ?? 0;
    const end =
      i + 1 < headers.length
        ? (headers[i + 1]!.index ?? section.length)
        : section.length;
    const slice = section.slice(start, end);
    const headerText = stripTags(
      slice.match(/<h5[^>]*>([\s\S]*?)<\/h5>/)?.[1] ?? "",
    );

    // Contest type comes from the votebox's CSS modifier class
    // (race_header democratic / republican / nonpartisan). Louisiana's 2026
    // House voteboxes carry a bare `race_header` class — the contest is named
    // only in the <h5> ("Nonpartisan primary election ...") — so fall back to
    // the header text when the class carries no party hint.
    let contest: CandidateContest | null = cls.includes("democratic")
      ? "D"
      : cls.includes("republican")
        ? "R"
        : cls.includes("nonpartisan")
          ? "open"
          : null;
    if (!contest && /nonpartisan/i.test(headerText)) contest = "open";
    if (!contest) continue;

    // Keep only the primary voteboxes for this page's election: the <h5>
    // says "primary", not "runoff". This drops general-election voteboxes
    // (also "nonpartisan"-classed) and primary-runoff voteboxes (a subset of
    // the primary).
    //
    // The "special" half is page-aware. On a *regular* page, a "Special …"
    // votebox is a special-election primary embedded alongside the regular
    // primary (e.g. RI carrying both) and must be dropped. On a *dedicated*
    // special-election page (FL/OH 2026 Senate), every votebox header reads
    // "Special …" — there the legitimate D/R primaries ARE the "Special …"
    // boxes, and it's the embedded *regular* boxes (if any) that get dropped.
    // `!== onSpecialPage` expresses both: drop when special-ness doesn't
    // match the page type. On a regular page (onSpecialPage=false) this is
    // identical to the old `/special/i.test(headerText)` gate.
    if (
      !/primary/i.test(headerText) ||
      /runoff/i.test(headerText) ||
      /special/i.test(headerText) !== onSpecialPage
    ) {
      continue;
    }

    for (const c of parseVotebox(slice, contest)) {
      const key = `${c.contest}|${c.name.toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      candidates.push(c);
    }
  }

  if (candidates.length === 0) {
    return { state, url, status: "no_candidates", candidates: [] };
  }
  return { state, url, status: "ok", candidates };
}

// True when a fetched page is a special-election page rather than a regular
// 2026 race page — the <title> carries "special election". House specials are
// out of scope for handoff 92, so the caller skips these.
function isSpecialElectionPage(html: string): boolean {
  const title = html.match(/<title>([\s\S]*?)<\/title>/i)?.[1] ?? "";
  return /special election/i.test(title);
}

// Wraps a single fetch attempt in an 8s AbortController. On abort, returns
// `{ res: null, aborted: true }` so callers can short-circuit retry loops
// rather than burn `HOUSE_RETRY_BACKOFF_MS * HOUSE_FETCH_ATTEMPTS` on a stuck
// URL (HO 120).
async function fetchPageWithTimeout(
  url: string,
): Promise<{ res: Response | null; aborted: boolean }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetchPage(url, controller.signal);
    return { res, aborted: controller.signal.aborted };
  } finally {
    clearTimeout(timer);
  }
}

export async function scrapeSenateCandidates(
  state: string,
  slug: string,
): Promise<CandidateScrapeResult> {
  // Try the standard election page; fall back to the special-election URL
  // (FL / OH 2026 specials live there). HO 120: both attempts run under the
  // 8s per-fetch cap; an aborted fetch surfaces as `httpStatus: 0` so the
  // primaries-sync layer can log it under `fetchFailures` rather than the
  // generic `no_page` bucket.
  let url = senatePageUrl(slug);
  let attempt = await fetchPageWithTimeout(url);
  if (!attempt.res || !attempt.res.ok) {
    if (attempt.aborted) {
      return { state, url, status: "no_page", httpStatus: 0, candidates: [] };
    }
    url = senateSpecialPageUrl(slug);
    attempt = await fetchPageWithTimeout(url);
  }
  if (!attempt.res || !attempt.res.ok) {
    return {
      state,
      url,
      status: "no_page",
      httpStatus: attempt.aborted ? 0 : attempt.res?.status,
      candidates: [],
    };
  }
  const html = await attempt.res.text();
  return parseCandidatesPage(html, state, url);
}

const HOUSE_FETCH_ATTEMPTS = 3;
const HOUSE_RETRY_BACKOFF_MS = 2500;

// House per-district scraper. `slug` is the underscored state name; `district`
// is the 1-based district number (0 = at-large). Special-election pages are
// detected and reported as status "special" rather than parsed.
//
// Reads the disk cache first; on a miss, fetches with up to
// HOUSE_FETCH_ATTEMPTS tries. A 200 response missing CANDIDATES_ANCHOR is
// treated as a transient Ballotpedia block and retried (not trusted as a real
// "no section" result); a genuine 404 is not retried. Good pages are cached.
export async function scrapeHouseCandidates(
  state: string,
  slug: string,
  district: number,
  opts?: { bypassCache?: boolean },
): Promise<CandidateScrapeResult> {
  const url = houseDistrictUrl(slug, district);

  // HO 206: the results pass must read LIVE — the .cache/ HTML is pre-results
  // (scraped ~May 20, before the primaries voted), so a cached read backfills
  // zeros. `bypassCache` forces a fresh fetch; the roster sync leaves it unset
  // and keeps the dev cache. (scrapeSenateCandidates is already cache-free.)
  const cached = opts?.bypassCache ? null : readCachedHtml(url);
  if (cached) {
    return isSpecialElectionPage(cached)
      ? { state, url, status: "special", candidates: [] }
      : parseCandidatesPage(cached, state, url);
  }

  let last: CandidateScrapeResult = {
    state,
    url,
    status: "no_page",
    candidates: [],
  };
  for (let attempt = 0; attempt < HOUSE_FETCH_ATTEMPTS; attempt++) {
    if (attempt > 0) {
      await new Promise((r) => setTimeout(r, HOUSE_RETRY_BACKOFF_MS));
    }
    const { res, aborted } = await fetchPageWithTimeout(url);
    if (aborted) {
      // HO 120 per-fetch timeout — Ballotpedia hung on this URL. Don't burn
      // the rest of the retry budget on it; surface as a fetch failure
      // (httpStatus 0) and let the caller advance the cursor past it.
      return {
        state,
        url,
        status: "no_page",
        httpStatus: 0,
        candidates: [],
      };
    }
    if (!res || !res.ok) {
      last = {
        state,
        url,
        status: "no_page",
        httpStatus: res?.status,
        candidates: [],
      };
      if (res && res.status === 404) break; // deterministic — don't retry
      continue;
    }
    const html = await res.text();
    if (isSpecialElectionPage(html)) {
      return { state, url, status: "special", candidates: [] };
    }
    if (html.includes(CANDIDATES_ANCHOR)) {
      writeCachedHtml(url, html); // real article page — cache it
      return parseCandidatesPage(html, state, url);
    }
    // 200 but no candidates section — almost always a transient challenge
    // page; loop and retry rather than trust it as a real empty.
    last = { state, url, status: "no_section", candidates: [] };
  }
  return last;
}
