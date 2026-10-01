// HO 749 — the ballot reader. Stores every 2026 race's November ballot as
// Ballotpedia's general-election box prints it, one row per person, into
// `general_ballot`, and one verdict per race into `general_ballot_reads`.
//
// WHY. The challenger harvest (lib/harvest-challengers.ts) publishes a PRIMARY
// result as the general-election roster. HO 741 measured the two diverging at
// AK-AL-2026, and HO 747's census (docs/probes/747-general-box-findings.md)
// measured it everywhere: 40 published names off the ballot (36 of them first-
// round runoff advancers, 32 of whom lost a runoff) and 483 ballot rows
// unpublished, about 60 of them major-party candidates. The close is a
// reader whose rows the harvest yields to. This file is that reader's first
// half. At HO 749 nothing read these tables, so a bad reading cost nothing
// while the reader's egress, pacing and write semantics were read in prod; its
// first full pass read clean (the WATCH, 2026-09-27). HO 750 is the second
// half: the challenger harvest publishes from them (lib/harvest-challengers.ts
// planBallotRoster), and the race page's stub asks them whether the incumbent
// is on the ballot (lib/queries.ts getIncumbentOnBallot).
//
// THE PARSER IS THE CENSUS'S, PROMOTED AS IT RAN. `readPageModel` and its
// helpers are scripts/diagnostic/general-box-census-747.ts's (:85-345), and
// `readUrl` / `readRacePage` are its fetch (:579-646), with its injectable `IO`.
// HO 747 ran them over 470 pages: one 2026 general box on 463, none on 7, two
// or more on none, and the kept-primary rows equal to parseCandidatesPage's own
// on all 470. HO 749's leg 1 holds this copy to the census's output on the same
// 470 saved pages, field by field, with the withdrawn-entry fix below named as
// its one exception. The helpers the census had copied out of
// lib/primary-candidates-scrape.ts are imported from there now, not copied.
//
// TWO DELIBERATE DIFFERENCES FROM THE CENSUS. (1) Two or more general boxes in
// the section is `ambiguous`, and nothing is stored for it. The census's
// `pickBallot` took the one box whose prefix is exactly "General election" in
// that case; the handoff rules that a reader never picks. HO 747 measured zero
// such pages, so no saved page can tell the two rules apart. (2) The
// withdrawn-entry regex in readBox is fixed, by the architect's ruling (see
// the note there): it reads 64 tokens the census missed on HO 747's pages, 4
// in the stored general box, and so 2 stored rows differ.
//
// Callers: /api/cron/general-ballot (write mode, the one call site that passes
// it) and `npm run sync:general-ballot` (dry unless --write). Read-only by
// default, the bill-rosters rule: a flag you must remember in order NOT to
// write is a flag that will be forgotten exactly once.
import type { Client, InStatement } from "@libsql/client";
import {
  CANDIDATES_ANCHOR,
  FETCH_TIMEOUT_MS,
  USER_AGENT,
  decodeEntities,
  houseDistrictUrl,
  hrefKey,
  openContestParty,
  partyLetter,
  senatePageUrl,
  senateSpecialPageUrl,
  stripTags,
  titleKey,
} from "./primary-candidates-scrape";
import { stateName } from "./states";
import { expireTag } from "./cache/expire-tag";

export const CYCLE = 2026;

// ── pacing, and why these numbers ──────────────────────────────────────────
// Ballotpedia's wall, measured at HO 747 from this box: a 2,023-byte JavaScript
// challenge served as a 202. At one request a second it arrived at request #43,
// and a retry 2.5s later got the same 202 in about 10ms. At six seconds start to
// start with one attempt per page, 387 of 387 pages read with no refusal. So:
// one request in flight, >= 6s between any two request STARTS (a Senate
// fallback is a second request and waits its turn), one attempt per race per
// run, and the first UNREAD ends a cron run rather than pressing on into a wall.
export const MIN_START_GAP_MS = 6_000;
// The cron's bounds (app/api/cron/general-ballot/route.ts): 40 races in a 240s
// budget. At 6s start to start, 40 races need 39 gaps = 234s before the last
// request starts, so the cap and the budget sit close together on purpose: a
// Senate fallback spends one slot and the budget ends that tick at 39. 12 ticks
// x 40 = 480 against 470 races is the full daily pass with ~10 slots of slack.
export const TICK_CAP = 40;
export const TICK_BUDGET_MS = 240_000;
// The CLI's --all stop rule, HO 747's ruled one (docs/probes/747-general-box-
// findings.md, D1): five UNREAD in a row pause the pass for 15 minutes, once,
// and the NEXT UNREAD stops it. A READ after the pause resets the count.
export const UNREAD_STREAK = 5;
export const STREAK_PAUSE_MS = 15 * 60_000;

// ── helpers the census copied, now imported (see the header) ───────────────
// partyRoute reports WHICH route produced the ingest's letter and is checked
// against openContestParty on every row it reads, as it was in the census.
type PartyRoute = "wrapper" | "suffix" | "neither";
function partyRoute(row: string): { route: PartyRoute; token: string | null; letter: string } {
  const wrap = row.match(/image-candidate-thumbnail-wrapper\s+([A-Za-z]+)/)?.[1];
  const abbr = row.match(/<\/a>\s*\(([A-Za-z]{1,12})\)/)?.[1];
  const out: { route: PartyRoute; token: string | null; letter: string } = wrap
    ? { route: "wrapper", token: wrap, letter: partyLetter(wrap) }
    : abbr
      ? { route: "suffix", token: abbr, letter: partyLetter(abbr) }
      : { route: "neither", token: null, letter: "I" };
  if (out.letter !== openContestParty(row)) {
    throw new Error(`partyRoute disagrees with openContestParty: ${out.letter} vs ${openContestParty(row)}`);
  }
  return out;
}

// ── identity ───────────────────────────────────────────────────────────────
// hrefKey and titleKey (a person link's title as a comparable key; this key is
// `general_ballot.person_key`) live in lib/primary-candidates-scrape.ts since
// HO 764, where the primary parser keys its rows with them too; re-exported
// here for the reader's callers.
export { hrefKey, titleKey };

// ── the page model ─────────────────────────────────────────────────────────
export type Row = {
  name: string;
  href: string | null;
  key: string | null;
  route: PartyRoute;
  token: string | null;
  party: string; // the INGEST's letter, openContestParty's precedence
  // The party the ballot PRINTS after the name, and its letter (a fusion line's
  // first party). NY and OR fusion rows print "(D / Working Families Party)"
  // beside a bare thumbnail wrapper, which the ingest's letter reads as I.
  printed: string | null;
  printedParty: string | null;
  underlined: boolean;
  winner: boolean;
  writeIn: string | null;
};
// `underlined` is HO 749's addition (the census kept no entry markup): a
// withdrawn incumbent's entry carries Ballotpedia's <u> like a ballot row.
export type WithdrawnEntry = { name: string; href: string | null; key: string | null; token: string | null; underlined: boolean };
export type Withdrawn = { heading: string; entries: WithdrawnEntry[] };
export type BoxKind = "general" | "primary-kept" | "primary-dropped" | "runoff" | "unrecognized";
export type Contest = "D" | "R" | "open";
export type Box = {
  offset: number;
  inSection: boolean;
  cls: string;
  h5: string;
  prefix: string;
  kind: BoxKind;
  contest: Contest | null;
  special: boolean;
  rows: Row[];
  noLinkRows: string[];
  withdrawn: Withdrawn | null;
  marked: number;
};
export type PageModel = {
  title: string;
  specialPage: boolean;
  section: { start: number; end: number } | null;
  sectionBoxes: Box[];
  general: Box[];
  primaries: Box[];
  outsideGeneral: Box[];
};

// THE 2026 GENERAL BOX: inside the section, and its <h5> says "general election"
// and says neither "primary" nor "runoff". The kept-primary half is
// parseCandidatesPage's own rule for `candidates`, so `primary-kept` is exactly
// the set of boxes the ingest reads as a first round. A primary-runoff box is
// `runoff` here; since HO 761 the ingest reads it too, into `runoffs`, so
// `primary_marked` still reads the first round.
function boxKind(h5: string, cls: string): { kind: BoxKind; contest: Contest | null } {
  if (/general election/i.test(h5) && !/primary/i.test(h5) && !/runoff/i.test(h5)) {
    return { kind: "general", contest: null };
  }
  let contest: Contest | null = cls.includes("democratic")
    ? "D"
    : cls.includes("republican")
      ? "R"
      : cls.includes("nonpartisan")
        ? "open"
        : null;
  if (!contest && /nonpartisan/i.test(h5)) contest = "open";
  if (contest && /primary/i.test(h5) && !/runoff/i.test(h5)) return { kind: "primary-kept", contest };
  if (/runoff/i.test(h5)) return { kind: "runoff", contest };
  if (/primary/i.test(h5)) return { kind: "primary-dropped", contest };
  return { kind: "unrecognized", contest };
}

function readBox(slice: string, offset: number, cls: string, inSection: boolean): Box {
  const h5 = stripTags(slice.match(/<h5[^>]*>([\s\S]*?)<\/h5>/)?.[1] ?? "");
  const { kind, contest } = boxKind(h5, cls);
  const prefix = h5.split(" for ")[0] ?? h5;
  const rows: Row[] = [];
  const noLinkRows: string[] = [];
  let marked = 0;
  const table = slice.match(/<table class="results_table">[\s\S]*?<\/table>/);
  // HO 758 (from its review): a RANKED-CHOICE general box (Maine's and Alaska's:
  // its header carries "Round eliminated") does not mark its winner with the
  // row's `winner` class. On HO 747's saved pages Alaska's eliminated rows carry
  // the class and the winner's does not (AK-AL 2024: Begich "Won (3)", no class),
  // and Maine's winners carry none. There the winner is the row whose last cell
  // reads "Won (N)". Only a general box takes this rule; every other box keeps
  // the class, so a kept primary's primary_marked is unchanged (Maine's RCV
  // primaries read "Advanced (N)" and carry no class, as before).
  const rcvGeneral = kind === "general" && /Round eliminated/i.test(table?.[0] ?? "");
  for (const tr of table?.[0].match(/<tr class="results_row[^"]*">[\s\S]*?<\/tr>/g) ?? []) {
    const cells = tr.match(/<td[^>]*>[\s\S]*?<\/td>/g) ?? [];
    const winner = rcvGeneral
      ? /^Won \(\d+\)$/.test(stripTags(cells[cells.length - 1] ?? ""))
      : /class="results_row[^"]*\bwinner\b/.test(tr);
    if (winner) marked++;
    const link = tr.match(/<a [^>]*href="(https:\/\/ballotpedia\.org\/[^"]*)"[^>]*>([\s\S]*?)<\/a>/);
    const name = link?.[2] ? stripTags(link[2]) : "";
    const text = stripTags(tr);
    const writeIn = text.match(/[^.;]{0,40}write[- ]?in[^.;]{0,40}/i)?.[0]?.trim() ?? null;
    if (!name) {
      noLinkRows.push(text.slice(0, 120));
      continue;
    }
    const p = partyRoute(tr);
    const printed = tr.match(/<\/a>(?:\s*<\/(?:u|b|i|strong|em)>)*\s*\(([^()<]{1,60})\)/)?.[1]?.trim() ?? null;
    rows.push({
      name,
      href: link?.[1] ?? null,
      key: hrefKey(link?.[1]),
      route: p.route,
      token: p.token,
      party: p.letter,
      printed,
      printedParty: printed ? partyLetter(printed.split("/")[0]!) : null,
      underlined: /<u>/.test(tr),
      winner,
      writeIn,
    });
  }
  // The withdrawn-or-disqualified block follows the box's table, before the
  // next votebox opens (the next box's own <h4> title sits between them).
  let withdrawn: Withdrawn | null = null;
  if (table && table.index !== undefined) {
    const after = slice.slice(table.index + table[0].length);
    const nextBox = after.search(/<div class="votebox"/);
    const zone = nextBox === -1 ? after : after.slice(0, nextBox);
    const h = zone.match(/<h([1-6])[^>]*>\s*(Withdrawn or disqualified[^<]*)<\/h\1>/i);
    if (h && h.index !== undefined) {
      const rest = zone.slice(h.index + h[0].length);
      const stop = rest.search(/<h[1-6][\s>]/);
      const region = stop === -1 ? rest : rest.slice(0, stop);
      const lis = [...region.matchAll(/<li>([\s\S]*?)<\/li>/g)].map((m) => m[1] ?? "");
      // HO 749 FIXED THIS REGEX, by the architect's ruling, and it is the one
      // place the promoted parser differs from the census's. The census needed
      // the "(X)" token straight after </a> and capped it at 40 characters, so
      // an underlined incumbent's entry, <b><u><a…>Name</a></u></b> (R), read no
      // token, and neither did NY-07's 41-character token. It now takes the
      // ballot row's closing-tag allowance and a 60-character cap, and reads the
      // entry's <u>. On HO 747's 470 pages it reads 64 tokens the census missed,
      // on 61 pages, and changes nothing else. Four are in the stored general
      // box (NC-11 Edwards, ME-02 Golden, NY-07 Rivera, NY-26 Kennedy; only the
      // first two are withdrawn-only rows, so two stored rows move). The other
      // 60 sit in boxes the reader never stores (55 kept-primary, 5 general
      // boxes outside the section). HO 749's leg 1 names all of them.
      const entries = (lis.length ? lis : [region]).flatMap((li) => {
        const a = li.match(/<a [^>]*href="(https:\/\/ballotpedia\.org\/[^"]*)"[^>]*>([\s\S]*?)<\/a>(?:\s*<\/(?:u|b|i|strong|em)>)*\s*(?:\(([^)]{1,60})\))?/);
        if (!a) return [];
        return [{ name: stripTags(a[2] ?? ""), href: a[1] ?? null, key: hrefKey(a[1]), token: a[3] ?? null, underlined: /<u>/.test(li) }];
      });
      withdrawn = { heading: stripTags(h[2] ?? ""), entries };
    }
  }
  return {
    offset,
    inSection,
    cls: cls || "(bare)",
    h5,
    prefix,
    kind,
    contest,
    special: /special/i.test(h5),
    rows,
    noLinkRows,
    withdrawn,
    marked,
  };
}

// parseCandidatesPage's slicing: each box runs from its race_header div to the
// next one, or to the end of the range.
function readBoxes(html: string, start: number, end: number, inSection: boolean): Box[] {
  const seg = html.slice(start, end);
  const heads = [...seg.matchAll(/<div class="race_header([^"]*)">/g)];
  return heads.map((h, i) => {
    const s = h.index ?? 0;
    const e = i + 1 < heads.length ? (heads[i + 1]!.index ?? seg.length) : seg.length;
    return readBox(seg.slice(s, e), start + s, (h[1] ?? "").trim(), inSection);
  });
}

export function readPageModel(html: string): PageModel {
  const title = stripTags(html.match(/<title>([\s\S]*?)<\/title>/i)?.[1] ?? "");
  const specialPage = /special election/i.test(title);
  const all = readBoxes(html, 0, html.length, false);
  const anchor = html.indexOf(CANDIDATES_ANCHOR);
  if (anchor === -1) {
    return {
      title,
      specialPage,
      section: null,
      sectionBoxes: [],
      general: [],
      primaries: [],
      outsideGeneral: all.filter((b) => b.kind === "general"),
    };
  }
  const nextH2 = html.indexOf("<h2", anchor + 10);
  const end = nextH2 === -1 ? anchor + 80000 : nextH2;
  const sectionBoxes = readBoxes(html, anchor, end, true);
  const outside = all.filter((b) => b.offset < anchor || b.offset >= end);
  return {
    title,
    specialPage,
    section: { start: anchor, end },
    sectionBoxes,
    general: sectionBoxes.filter((b) => b.kind === "general"),
    primaries: sectionBoxes.filter((b) => b.kind === "primary-kept"),
    outsideGeneral: outside.filter((b) => b.kind === "general"),
  };
}

// ── fetching ───────────────────────────────────────────────────────────────
export type Raw = { kind: "response"; status: number; body: string } | { kind: "timeout" } | { kind: "network"; error: string };
export type Attempt = { url: string; attempt: number; result: string; bytes: number; ms: number; file: string | null; at: string };
// `record` is optional here: the census saved every page it read, the reader
// saves none. A caller that wants the page keeps it off `PageReading.html`.
export type IO = {
  get: (url: string) => Promise<Raw>;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
  record?: (raceId: string, seq: number, url: string, attempt: number, raw: Raw, ms: number) => string | null;
};
type Outcome = "ok" | "no-anchor" | "http" | "timeout" | "network";
type UrlRead = { url: string; outcome: Outcome; status: number | null; body: string | null; file: string | null };
export type Verdict = "READ" | "NO_PAGE" | "UNREAD";
export type PageReading = {
  raceId: string;
  verdict: Verdict;
  cause: string | null;
  url: string;
  fallback: boolean;
  attempts: Attempt[];
  file: string | null;
  html: string | null;
};
// What readRacePage needs of a `races` row.
export type BallotRace = { id: string; chamber: string; state: string; district: number | null };

const BACKOFF_MS = 2_500;

// One URL, up to `attempts` tries, mirroring scrapeHouseCandidates: a timeout is
// not retried, a 404 is not retried, any other non-ok or a thrown fetch is
// retried, and a 2xx without the anchor is retried as a challenge page. The
// reader passes ONE attempt (HO 747 pass 2: no quick retries against a bot
// wall; a retry 2.5s after a 202 got the same 202), so the loop never repeats.
async function readUrl(
  raceId: string,
  url: string,
  io: IO,
  seq: { n: number },
  log: Attempt[],
  attempts: number,
): Promise<UrlRead> {
  let last: UrlRead = { url, outcome: "network", status: null, body: null, file: null };
  for (let attempt = 1; attempt <= attempts; attempt++) {
    if (attempt > 1) await io.sleep(BACKOFF_MS);
    const t0 = io.now();
    const raw = await io.get(url);
    const ms = io.now() - t0;
    const file = io.record?.(raceId, ++seq.n, url, attempt, raw, ms) ?? null;
    const bytes = raw.kind === "response" ? Buffer.byteLength(raw.body) : 0;
    const result = raw.kind === "response" ? String(raw.status) : raw.kind;
    log.push({ url, attempt, result, bytes, ms, file, at: new Date(io.now()).toISOString() });
    if (raw.kind === "timeout") return { url, outcome: "timeout", status: null, body: null, file };
    if (raw.kind === "network") {
      last = { url, outcome: "network", status: null, body: null, file };
      continue;
    }
    if (raw.status < 200 || raw.status > 299) {
      last = { url, outcome: "http", status: raw.status, body: null, file };
      if (raw.status === 404) return last;
      continue;
    }
    if (raw.body.includes(CANDIDATES_ANCHOR)) return { url, outcome: "ok", status: raw.status, body: raw.body, file };
    last = { url, outcome: "no-anchor", status: raw.status, body: null, file };
  }
  return last;
}

// The page verdict. A page is READ (2xx carrying the anchor), NO_PAGE (a 404,
// or a Senate 404 then a 404 on the special URL) or UNREAD (anything else, the
// 202 challenge among it). Only a READ page is ever classified as having no
// general box, so a challenge page cannot pose as an empty ballot. The URL is
// the pipeline's URL: the scraper's builders, the slug as the sync builds it.
export async function readRacePage(race: BallotRace, io: IO, tries = 1): Promise<PageReading> {
  const slug = stateName(race.state).replace(/ /g, "_");
  const seq = { n: 0 };
  const attempts: Attempt[] = [];
  let fallback = false;
  let r: UrlRead;
  if (race.chamber === "senate") {
    r = await readUrl(race.id, senatePageUrl(slug), io, seq, attempts, tries);
    // HO 749 DEPARTS FROM THE CENSUS HERE, and only here in the fetch. The
    // census mirrored scrapeSenateCandidates, which falls back to the special-
    // election URL on ANY non-ok response or a network error. For a reader that
    // is wrong twice: a 429, 403 or 5xx is the wall or an outage, not "no
    // page", and falling back then reads the special page (or its 404, which
    // would read NO_PAGE and slip past the first-UNREAD stop). So only a 404
    // falls back; everything else on the regular URL is UNREAD, like a House page.
    if (r.outcome === "http" && r.status === 404) {
      fallback = true;
      r = await readUrl(race.id, senateSpecialPageUrl(slug), io, seq, attempts, tries);
    }
  } else {
    r = await readUrl(race.id, houseDistrictUrl(slug, race.district ?? 0), io, seq, attempts, tries);
  }
  const verdict: Verdict = r.outcome === "ok" ? "READ" : r.outcome === "http" && r.status === 404 ? "NO_PAGE" : "UNREAD";
  const cause =
    verdict === "READ"
      ? null
      : verdict === "NO_PAGE"
        ? "404"
        : r.outcome === "no-anchor"
          ? `no-anchor-${r.status}`
          : r.outcome === "http"
            ? `http-${r.status}`
            : r.outcome;
  return { raceId: race.id, verdict, cause, url: r.url, fallback, attempts, file: r.file, html: r.body };
}

// The deployed fetch: the scraper's user agent (Ballotpedia answers a bare one
// with the challenge), and an 8s cap over the body as well as the headers, so a
// hung body cannot hang the run. Pacing is NOT here; `pacedIO` wraps any IO.
export function liveIO(): IO {
  return {
    now: () => Date.now(),
    sleep: (ms) => new Promise<void>((r) => setTimeout(r, ms)),
    get: async (url) => {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS);
      try {
        const res = await fetch(url, {
          headers: { "User-Agent": USER_AGENT, Accept: "text/html" },
          redirect: "follow",
          signal: ctl.signal,
        });
        const body = await res.text();
        return { kind: "response", status: res.status, body };
      } catch (e) {
        return ctl.signal.aborted ? { kind: "timeout" } : { kind: "network", error: String(e) };
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

// One request in flight (every caller awaits) and at least `gapMs` between any
// two request STARTS, measured on the wrapped IO's own clock so a test can
// inject one. `minGapMs` is the smallest gap actually measured, which the cron
// payload reports so the pacing is read in prod rather than assumed.
export type Paced = { io: IO; requests: () => number; minGapMs: () => number | null; nextStartAt: () => number };
export function pacedIO(inner: IO, gapMs: number): Paced {
  let lastStart: number | null = null;
  let requests = 0;
  let minGap: number | null = null;
  return {
    io: {
      now: inner.now,
      sleep: inner.sleep,
      record: inner.record,
      get: async (url) => {
        if (lastStart !== null) {
          // Re-read the clock after every sleep: a timer can wake a
          // millisecond before its target (HO 749's Preview POST, cron_runs
          // #20320, measured minGapMs 5999 on Vercel), and one sleep trusted
          // blindly would start the request inside the gap.
          let wait = lastStart + gapMs - inner.now();
          while (wait > 0) {
            await inner.sleep(wait);
            wait = lastStart + gapMs - inner.now();
          }
        }
        const start = inner.now();
        if (lastStart !== null) minGap = minGap === null ? start - lastStart : Math.min(minGap, start - lastStart);
        lastStart = start;
        requests++;
        return inner.get(url);
      },
    },
    requests: () => requests,
    minGapMs: () => minGap,
    nextStartAt: () => (lastStart === null ? inner.now() : Math.max(inner.now(), lastStart + gapMs)),
  };
}

// ── what a READ page stores ────────────────────────────────────────────────
export type BallotStatus = "box" | "no_box" | "ambiguous";
export type BallotRow = {
  race_id: string;
  person_key: string;
  name: string;
  printed_party: string | null;
  party: string | null;
  incumbent_marked: number;
  write_in: number;
  on_ballot: number;
  withdrawn: number;
  primary_marked: number;
  bioguide_id: string | null;
  box_prefix: string;
  read_at: string;
  // HO 758: this row's own result mark (its results row's `winner` class); 0
  // for a withdrawn-only entry, which is on no results row.
  marked: number;
};
export type PageResult =
  | { status: "box"; box: Box; rows: BallotRow[]; folded: Folded }
  | { status: "no_box" | "ambiguous"; box: null; rows: []; folded: null };
// Entries that did not become rows of their own, counted, never silent:
// `merged` withdrawn entries whose person is also a ballot row (that row
// carries withdrawn = 1), `repeated` second listings, `noKey` without a link.
export type Folded = { merged: number; repeated: number; noKey: number };

// Each member's Ballotpedia title keyed the way a ballot row's href is. IDENTITY
// ONLY, never a name: S-AK-2026's ballot carries the senator and a second Dan
// Sullivan under two hrefs, and only the one whose href is the senator's title
// gets his bioguide. Two members sharing one key would make the key ambiguous,
// and an ambiguous key yields NULL rather than a pick (measured at HO 749:
// 524 titles, 524 distinct).
// HO 751: the title is COALESCE(ballotpedia_title_resolved, ballotpedia_title).
// A resolved title (repair:ballotpedia-titles, confirmed by the stale title's
// redirect, by the disambiguation page at the stale title linking it, or by the
// name check) wins; a member never resolved is keyed exactly as before. The crosswalk overwrites ballotpedia_title on every run and never
// writes the resolved column, so a repair outlives the next sync:crosswalk.
export type Identity = Map<string, string | null>;
export async function loadIdentity(db: Client): Promise<Identity> {
  const rs = await db.execute(
    `SELECT bioguide_id, COALESCE(NULLIF(TRIM(ballotpedia_title_resolved), ''), ballotpedia_title) AS title
       FROM member_ids
      WHERE COALESCE(NULLIF(TRIM(ballotpedia_title_resolved), ''), NULLIF(TRIM(ballotpedia_title), '')) IS NOT NULL`,
  );
  const out: Identity = new Map();
  for (const r of rs.rows) {
    const k = titleKey(String(r.title).trim());
    if (!k) continue;
    const b = String(r.bioguide_id);
    out.set(k, out.has(k) && out.get(k) !== b ? null : b);
  }
  return out;
}

// A READ page's verdict and, for a box, its rows: one row per person, keyed
// (race_id, person_key), with two flags that are independent of each other
// (the architect's ruling, HO 749):
//   · on_ballot = 1 when the person is a row of the box's results table;
//   · withdrawn = 1 when the person is listed in the box's "Withdrawn or
//     disqualified candidates" block.
// Both can be 1. On HO 747's 463 boxes, 5 people are printed on the ballot AND
// listed withdrawn (NE-03, NY-06, NY-07, NY-21, NY-26): each withdrew from one
// line and stays printed on another, e.g. NY-06's Joseph Chou, printed
// "R / Conservative Party", withdrawn from "4 Our Immigrants Party". Their row
// is the ballot row (its printed party and underline) with withdrawn = 1. And 2
// withdrawn blocks list one person twice (TX-18, MD-05), same token both times:
// the first entry is the row. Both shapes are counted in `folded`.
export function pageResult(raceId: string, model: PageModel, identity: Identity, readAt: string): PageResult {
  if (model.general.length === 0) return { status: "no_box", box: null, rows: [], folded: null };
  if (model.general.length > 1) return { status: "ambiguous", box: null, rows: [], folded: null };
  const box = model.general[0]!;
  const primaryMarked = new Set(
    model.primaries.flatMap((b) => b.rows.filter((r) => r.winner && r.key).map((r) => r.key as string)),
  );
  const listedWithdrawn = new Set(
    (box.withdrawn?.entries ?? []).filter((w) => w.key).map((w) => w.key as string),
  );
  const folded: Folded = { merged: 0, repeated: 0, noKey: 0 };
  const rows: BallotRow[] = [];
  const seen = new Set<string>();
  for (const r of box.rows) {
    if (!r.key) {
      folded.noKey++;
      continue;
    }
    if (seen.has(r.key)) {
      folded.repeated++;
      continue;
    }
    seen.add(r.key);
    rows.push({
      race_id: raceId,
      person_key: r.key,
      name: r.name,
      // As printed, fusion lines whole ("R / Conservative Party"), entities
      // decoded; the letter is the printed party's first, else the ingest's.
      printed_party: r.printed ? decodeEntities(r.printed) : null,
      party: r.printedParty ?? r.party,
      incumbent_marked: r.underlined ? 1 : 0,
      write_in: r.writeIn ? 1 : 0,
      on_ballot: 1,
      withdrawn: listedWithdrawn.has(r.key) ? 1 : 0,
      primary_marked: primaryMarked.has(r.key) ? 1 : 0,
      bioguide_id: identity.get(r.key) ?? null,
      box_prefix: box.prefix,
      read_at: readAt,
      marked: r.winner ? 1 : 0,
    });
  }
  const onBallot = new Set(seen);
  for (const w of box.withdrawn?.entries ?? []) {
    if (!w.key) {
      folded.noKey++;
      continue;
    }
    if (onBallot.has(w.key)) {
      folded.merged++;
      continue;
    }
    if (seen.has(w.key)) {
      folded.repeated++;
      continue;
    }
    seen.add(w.key);
    const token = w.token ? decodeEntities(w.token) : null;
    rows.push({
      race_id: raceId,
      person_key: w.key,
      name: w.name,
      printed_party: token,
      // The letter is the token's first party, or NULL with no token: an entry
      // has no thumbnail wrapper for openContestParty to read. Its <u> is read
      // (NC-11's Chuck Edwards and ME-02's Jared Golden on HO 747's pages).
      party: token ? partyLetter(token.split("/")[0]!) : null,
      incumbent_marked: w.underlined ? 1 : 0,
      write_in: 0,
      on_ballot: 0,
      withdrawn: 1,
      primary_marked: primaryMarked.has(w.key) ? 1 : 0,
      bioguide_id: identity.get(w.key) ?? null,
      box_prefix: box.prefix,
      read_at: readAt,
      marked: 0,
    });
  }
  return { status: "box", box, rows, folded };
}

// ── writes ─────────────────────────────────────────────────────────────────
// One race, one `db.batch` transaction, `general_ballot_reads` stamped LAST:
//   READ with a box            delete the race's rows, insert the new set, stamp.
//   READ, no box or ambiguous  delete the race's rows, stamp the verdict.
//   UNREAD or NO_PAGE          touch only last_attempt_at / last_attempt; the
//                              rows and the last READ stay as they were, so an
//                              UNREAD can never pass for a read.
// Plain INSERT, not OR IGNORE: a repeated key throws and the whole batch rolls
// back, leaving the race's previous rows in place.
export type RaceWrite =
  | { verdict: "READ"; status: BallotStatus; rows: BallotRow[]; marked: number; url: string }
  | { verdict: "UNREAD" | "NO_PAGE" };
const COLS = [
  "race_id",
  "person_key",
  "name",
  "printed_party",
  "party",
  "incumbent_marked",
  "write_in",
  "on_ballot",
  "withdrawn",
  "primary_marked",
  "bioguide_id",
  "box_prefix",
  "read_at",
  // HO 758: needs general_ballot.marked (scripts/migrate.ts ensureColumn) on the
  // database before this code runs: every READ's INSERT writes it, and every
  // race page reads it (getRaceRoster, getRaceResult), so an unmigrated
  // database fails both.
  "marked",
] as const;
export function raceWriteStatements(raceId: string, w: RaceWrite, at: string): InStatement[] {
  if (w.verdict !== "READ") {
    return [
      {
        sql: `INSERT INTO general_ballot_reads (race_id, last_attempt_at, last_attempt) VALUES (?, ?, ?)
              ON CONFLICT(race_id) DO UPDATE SET
                last_attempt_at = excluded.last_attempt_at,
                last_attempt = excluded.last_attempt`,
        args: [raceId, at, w.verdict],
      },
    ];
  }
  return [
    { sql: `DELETE FROM general_ballot WHERE race_id = ?`, args: [raceId] },
    ...w.rows.map((r) => ({
      sql: `INSERT INTO general_ballot (${COLS.join(", ")}) VALUES (${COLS.map(() => "?").join(", ")})`,
      args: COLS.map((c) => r[c]),
    })),
    {
      sql: `INSERT INTO general_ballot_reads
              (race_id, status, read_at, rows, marked, source_url, last_attempt_at, last_attempt)
            VALUES (?, ?, ?, ?, ?, ?, ?, 'READ')
            ON CONFLICT(race_id) DO UPDATE SET
              status = excluded.status,
              read_at = excluded.read_at,
              rows = excluded.rows,
              marked = excluded.marked,
              source_url = excluded.source_url,
              last_attempt_at = excluded.last_attempt_at,
              last_attempt = excluded.last_attempt`,
      args: [raceId, w.status, at, w.rows.length, w.marked, w.url, at],
    },
  ];
}
export async function writeRace(db: Client, raceId: string, w: RaceWrite, at: string): Promise<void> {
  await db.batch(raceWriteStatements(raceId, w, at), "write");
}

// ── the run ────────────────────────────────────────────────────────────────
export type StopReason = "unread" | "budget" | "cap" | "queue";
export type RunOptions = {
  write?: boolean;
  // Races attempted, at most. The cron passes TICK_CAP; --all passes none.
  cap?: number;
  // Absolute, on `io.now()`'s clock. No race STARTS at or after it; a race
  // started before it (a Senate fallback included) finishes inside the 290s
  // soft timeout: 240s + a 6s wait + two 8s fetch caps + one write.
  deadlineMs?: number;
  raceIds?: string[];
  // "first-unread": the cron's rule, the first UNREAD ends the run.
  // "streak": the CLI's --all rule (UNREAD_STREAK, one STREAK_PAUSE_MS pause).
  stopRule?: "first-unread" | "streak";
  io?: IO;
  gapMs?: number;
  pauseMs?: number;
  onRace?: (line: RaceLine) => void;
};
export type RaceLine = {
  race: string;
  verdict: Verdict;
  cause: string | null;
  status: BallotStatus | null;
  rows: number;
  marked: number;
  url: string;
  folded: Folded | null;
};
export type RunResult = {
  mode: "write" | "dry";
  queued: number;
  attempted: number;
  verdicts: Record<Verdict, number>;
  statuses: Record<BallotStatus, number>;
  rowsRead: number;
  rowsWritten: number;
  stop: StopReason;
  requests: number;
  minGapMs: number | null;
  unread: { race: string; cause: string | null }[];
  noPage: string[];
  ambiguous: string[];
  noLinkRows: number;
  folded: Folded;
  pauses: number;
};

// The queue is the reads table: every 2026 race, never-attempted first, then
// least-recently-attempted, race_id breaking ties. No cursor to drift.
export async function selectQueue(db: Client, raceIds?: string[]): Promise<(BallotRace & { lastAttemptAt: string | null })[]> {
  const named = raceIds?.length ? `AND r.id IN (${raceIds.map(() => "?").join(", ")})` : "";
  const rs = await db.execute({
    sql: `SELECT r.id, r.chamber, r.state, r.district, g.last_attempt_at
            FROM races r
            LEFT JOIN general_ballot_reads g ON g.race_id = r.id
           WHERE r.cycle = ? ${named}
           ORDER BY (g.last_attempt_at IS NOT NULL), g.last_attempt_at, r.id`,
    args: [CYCLE, ...(raceIds ?? [])],
  });
  return rs.rows.map((r) => ({
    id: String(r.id),
    chamber: String(r.chamber),
    state: String(r.state),
    district: r.district == null ? null : Number(r.district),
    lastAttemptAt: r.last_attempt_at == null ? null : String(r.last_attempt_at),
  }));
}

export async function runGeneralBallot(db: Client, opts: RunOptions = {}): Promise<RunResult> {
  const write = opts.write === true;
  const paced = pacedIO(opts.io ?? liveIO(), opts.gapMs ?? MIN_START_GAP_MS);
  const io = paced.io;
  const cap = opts.cap ?? Number.POSITIVE_INFINITY;
  const rule = opts.stopRule ?? "first-unread";
  const identity = await loadIdentity(db);
  const queue = await selectQueue(db, opts.raceIds);
  const res: RunResult = {
    mode: write ? "write" : "dry",
    queued: queue.length,
    attempted: 0,
    verdicts: { READ: 0, UNREAD: 0, NO_PAGE: 0 },
    statuses: { box: 0, no_box: 0, ambiguous: 0 },
    rowsRead: 0,
    rowsWritten: 0,
    stop: "queue",
    requests: 0,
    minGapMs: null,
    unread: [],
    noPage: [],
    ambiguous: [],
    noLinkRows: 0,
    folded: { merged: 0, repeated: 0, noKey: 0 },
    pauses: 0,
  };
  let streak = 0;
  for (const race of queue) {
    if (res.attempted >= cap) {
      res.stop = "cap";
      break;
    }
    if (opts.deadlineMs !== undefined && paced.nextStartAt() >= opts.deadlineMs) {
      res.stop = "budget";
      break;
    }
    const reading = await readRacePage(race, io, 1);
    res.attempted++;
    res.verdicts[reading.verdict]++;
    const at = new Date(io.now()).toISOString();
    let line: RaceLine = {
      race: race.id,
      verdict: reading.verdict,
      cause: reading.cause,
      status: null,
      rows: 0,
      marked: 0,
      url: reading.url,
      folded: null,
    };
    let w: RaceWrite;
    if (reading.verdict === "READ") {
      // readUrl returns READ only with the body that carried the anchor.
      if (reading.html === null) throw new Error(`${race.id}: READ without a body`);
      const model = readPageModel(reading.html);
      const pr = pageResult(race.id, model, identity, at);
      res.statuses[pr.status]++;
      if (pr.status === "ambiguous") res.ambiguous.push(race.id);
      const marked = pr.box?.marked ?? 0;
      res.noLinkRows += pr.box?.noLinkRows.length ?? 0;
      if (pr.folded) {
        res.folded.merged += pr.folded.merged;
        res.folded.repeated += pr.folded.repeated;
        res.folded.noKey += pr.folded.noKey;
      }
      res.rowsRead += pr.rows.length;
      line = { ...line, status: pr.status, rows: pr.rows.length, marked, folded: pr.folded };
      w = { verdict: "READ", status: pr.status, rows: pr.rows, marked, url: reading.url };
    } else {
      if (reading.verdict === "UNREAD") res.unread.push({ race: race.id, cause: reading.cause });
      if (reading.verdict === "NO_PAGE") res.noPage.push(race.id);
      w = { verdict: reading.verdict };
    }
    if (write) {
      await writeRace(db, race.id, w, at);
      if (w.verdict === "READ") res.rowsWritten += w.rows.length;
    }
    opts.onRace?.(line);
    if (reading.verdict === "UNREAD") {
      streak++;
      if (rule === "first-unread") {
        res.stop = "unread";
        break;
      }
      if (streak >= UNREAD_STREAK) {
        if (res.pauses > 0) {
          res.stop = "unread";
          break;
        }
        res.pauses++;
        // Armed, as the census armed it: the next UNREAD stops the pass, and a
        // READ in between resets the count to 0 below.
        streak = UNREAD_STREAK - 1;
        await io.sleep(opts.pauseMs ?? STREAK_PAUSE_MS);
      }
    } else {
      streak = 0;
    }
  }
  res.requests = paced.requests();
  res.minGapMs = paced.minGapMs();
  return res;
}

// ── the cron tick, shared by the route and the legs ─────────────────────────
// The route wraps this in wrapCronRoute; HO 749's leg 4 wraps the same function
// around a `file:` copy and a fetch shim, so the tick the legs read is the tick
// that ships.
// HO 750: the race page reads these tables (lib/queries.ts
// getIncumbentOnBallot, under the `general-ballot` tag), so a tick that WROTE a
// READ expires that tag, once, and so does a tick that throws part-way (it may
// have committed some). A tick that wrote nothing (every attempt UNREAD or
// NO_PAGE, which touch only the attempt columns the page never reads) expires
// nothing. It does not expire `races`: the roster reaches the page
// through the challenger harvest, whose own cron expires `races`. `expire` is
// injectable because the default, revalidateTag, throws outside a Next request
// ("static generation store missing"): every caller outside the route passes
// its own, HO 750's leg 6 to count the calls and HO 749's leg 4 a no-op, so
// the legs still run the tick that ships in every other respect.
export async function generalBallotTick(
  db: Client,
  io: IO = liveIO(),
  expire: (tag: string) => void = expireTag,
): Promise<{ payload: RunResult; chronicErr?: string }> {
  let r: RunResult;
  try {
    r = await runGeneralBallot(db, {
      write: true,
      cap: TICK_CAP,
      deadlineMs: io.now() + TICK_BUDGET_MS,
      stopRule: "first-unread",
      io,
    });
  } catch (e) {
    // Each race commits in its own batch, so a tick that throws part-way may
    // already have written READs the page reads. Expire before the error
    // propagates: an extra flush on a failed tick costs one re-read.
    expire("general-ballot");
    throw e;
  }
  console.log(
    `[general-ballot] attempted=${r.attempted} READ=${r.verdicts.READ} UNREAD=${r.verdicts.UNREAD} ` +
      `NO_PAGE=${r.verdicts.NO_PAGE} box=${r.statuses.box} no_box=${r.statuses.no_box} ` +
      `ambiguous=${r.statuses.ambiguous} rowsWritten=${r.rowsWritten} stop=${r.stop} ` +
      `requests=${r.requests} minGapMs=${r.minGapMs}`,
  );
  // An UNREAD is the wall, or the page changing shape under us. Either is worth
  // a human's eye, and neither fails the tick: the race is stamped and requeued.
  const chronic: string[] = [];
  if (r.unread.length) chronic.push(`general-ballot UNREAD ${r.unread.map((u) => `${u.race} (${u.cause})`).join(", ")}`);
  if (r.statuses.ambiguous) chronic.push(`general-ballot ambiguous ${r.ambiguous.join(", ")}`);
  if (r.verdicts.READ > 0) expire("general-ballot");
  return { payload: r, chronicErr: chronic.length ? chronic.join(" | ") : undefined };
}
