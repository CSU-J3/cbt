// HO 747 — what is on the November ballot? A READ-ONLY census of Ballotpedia's
// 2026 general-election boxes against the rosters we publish.
//
// WHY. The challenger harvest (`lib/harvest-challengers.ts`) publishes a PRIMARY
// result as the general-election roster, and the two diverge whenever an
// advancer or nominee leaves the ballot after the primary. HO 741 measured that
// once, at AK-AL-2026 (`ak-general-box-741.ts`): the roster the harvest would
// have published was wrong on two of four names. This reads every 2026 race's
// general box and sets it against the rows `getRaceCandidates` returns.
//
// BUILDS NOTHING. Prod is read through a reader that refuses anything but
// SELECT, and Ballotpedia with GETs. Nothing here INSERTs, UPDATEs or DELETEs
// against prod, POSTs a cron route, or touches `.cache/ballotpedia` (it never
// calls `scrapeHouseCandidates`, whose cache would hand it May's pages). The
// only writes go to docs/handoffs/747-artifacts/ (repo-ignored: pages, the
// request log, per-race JSON and CSV) and to the controls' own `file:`
// databases, whose URLs are built from a path by construction.
//
//   npx tsx scripts/diagnostic/general-box-census-747.ts --selector-check <page.html.gz>
//       STEP 0: this HO's selector beside the 741 diagnostic's, on one saved page.
//   npx tsx scripts/diagnostic/general-box-census-747.ts --only-fset
//       fetch the falsification set, run the four controls on its saved pages, stop.
//   npx tsx scripts/diagnostic/general-box-census-747.ts
//       THE PROD READING: cron_runs before · snapshot · falsification set ·
//       controls (a miss stops the run) · the rest of the census · cron_runs
//       after (a move re-snapshots and re-classifies from the saved pages) · tables.
//   npx tsx scripts/diagnostic/general-box-census-747.ts --pass2 <pass-1-run-dir>
//       PASS 2, the architect's ruled completion after pass 1 stopped on the
//       wall (terms at `pass2` below). --pass2-controls runs its stub controls alone.
//   npx tsx scripts/diagnostic/general-box-census-747.ts --controls <run-dir>
//       C1-C4 re-fired on a finished run's saved pages, no network.
//   npx tsx scripts/diagnostic/general-box-census-747.ts --reclassify <run-dir>
//       a fresh prod snapshot, classified against a finished run's saved pages.
//       No fetch.
//
// WHAT A ZERO MEANS. A page is READ (2xx carrying the anchor), NO_PAGE (a 404, or
// no page after the Senate fallback) or UNREAD (anything else). Only a READ page
// is ever classified as having no general box, so a challenge page cannot pose as
// an empty ballot. Controls C1-C4 fire each classification from the other side.
//
// RECORD (2026-09-25). Pass 1 (run 2026-09-25T19-16-25-420Z) ran on this file's
// first revision and stopped on the handoff's stop rule at FL-05-2026; pass 2
// (`--pass2`) is the architect's ruled completion. The fetch path is unchanged in
// behaviour since pass 1. The classifier changes made after it (the nickname
// initial, the surname-and-initial route, the printed party, the table-3 and
// table-6 decompositions, the article-only sentence reader) are named in
// docs/probes/747-general-box-findings.md, D5, D6, D9 and D14, and the tables
// there come from `--reclassify` on the final revision, after `--controls`.
import { config } from "dotenv";
import { createClient, type Client, type InArgs, type ResultSet } from "@libsql/client";
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import { CYCLE, HARVEST_SOURCE } from "@/lib/harvest-challengers";
import {
  houseDistrictUrl,
  parseCandidatesPage,
  senatePageUrl,
  senateSpecialPageUrl,
} from "@/lib/primary-candidates-scrape";
import { DISPLAY_STALE_STATES } from "@/lib/district-geo";
import { stateName } from "@/lib/states";

config({ path: ".env", quiet: true });

const ART = "docs/handoffs/747-artifacts";
const CRON_ROUTES = ["/api/cron/race-challengers", "/api/cron/primaries"];
const FIVE = ["CA-01-2026", "MO-05-2026", "TN-09-2026", "TX-09-2026", "TX-32-2026"];

// ── copied from lib/primary-candidates-scrape.ts (not exported) ────────────
// USER_AGENT :42-43. Ballotpedia answers a bare user agent with a 202
// challenge (ak-general-box-741.ts:37-39), so a reading under any other UA is
// not a reading of what the pipeline sees.
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";
const ANCHOR = 'id="Candidates_and_election_results"'; // :249 CANDIDATES_ANCHOR
const FETCH_TIMEOUT_MS = 8_000; // :228
const ATTEMPTS = 3; // :495 HOUSE_FETCH_ATTEMPTS
const BACKOFF_MS = 2_500; // :496 HOUSE_RETRY_BACKOFF_MS
const MIN_GAP_MS = 1_000; // lib/primaries-sync.ts:1257, `await sleep(1000)` per district
const UNREAD_STREAK = 5;
const PAUSE_MS = 60_000;

// :90-104, so a name read here is byte-for-byte the name `parseVotebox` stored.
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
// :136-143
function partyLetter(word: string): string {
  const w = word.trim().toLowerCase();
  if (w === "r" || w.startsWith("republican")) return "R";
  if (w === "d" || w.startsWith("democrat")) return "D";
  if (w === "l" || w.startsWith("libertarian")) return "L";
  if (w === "g" || w.startsWith("green")) return "G";
  return "I";
}
// :151-157, verbatim. `partyRoute` below reports WHICH route produced the
// letter and is checked against this copy on every row it reads.
function openContestParty(row: string): string {
  const wrap = row.match(/image-candidate-thumbnail-wrapper\s+([A-Za-z]+)/);
  if (wrap?.[1]) return partyLetter(wrap[1]);
  const abbr = row.match(/<\/a>\s*\(([A-Za-z]{1,12})\)/);
  if (abbr?.[1]) return partyLetter(abbr[1]);
  return "I";
}

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
// A person link's title, as a comparable key: HTML entities decoded (reading the
// attribute), the origin dropped, percent-decoded, spaces as underscores. The
// stored side is `https://ballotpedia.org/` + ballotpedia_title through the same
// function, so both sides are percent-decoded before they are compared.
const BP = "https://ballotpedia.org/";
function hrefKey(href: string | null | undefined): string | null {
  if (!href) return null;
  let s = decodeEntities(href);
  if (s.startsWith(BP)) s = s.slice(BP.length);
  try {
    s = decodeURIComponent(s);
  } catch {
    // a malformed escape stays raw rather than failing the page
  }
  return s.replace(/ /g, "_");
}
const titleKey = (title: string) => hrefKey(BP + title.replace(/ /g, "_"));

// NFKD, diacritics folded, case and punctuation dropped (the handoff's fallback).
function normName(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

// ── the page model ─────────────────────────────────────────────────────────
type Row = {
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
type WithdrawnEntry = { name: string; href: string | null; key: string | null; token: string | null };
type Withdrawn = { heading: string; entries: WithdrawnEntry[] };
type BoxKind = "general" | "primary-kept" | "primary-dropped" | "runoff" | "unrecognized";
type Contest = "D" | "R" | "open";
type Box = {
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
type PageModel = {
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
// parseCandidatesPage's own rule (:327-335, :361), so `primary-kept` is exactly
// the set of boxes the ingest reads.
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
  const h5 = stripTags(slice.match(/<h5[^>]*>([\s\S]*?)<\/h5>/)?.[1] ?? ""); // :318-320
  const { kind, contest } = boxKind(h5, cls);
  const prefix = h5.split(" for ")[0] ?? h5;
  const rows: Row[] = [];
  const noLinkRows: string[] = [];
  let marked = 0;
  const table = slice.match(/<table class="results_table">[\s\S]*?<\/table>/); // :167-169
  for (const tr of table?.[0].match(/<tr class="results_row[^"]*">[\s\S]*?<\/tr>/g) ?? []) {
    // :171
    const winner = /class="results_row[^"]*\bwinner\b/.test(tr); // :212
    if (winner) marked++;
    // :173-175, with the href kept rather than discarded
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
      underlined: /<u>/.test(tr), // :211
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
      const entries = (lis.length ? lis : [region]).flatMap((li) => {
        const a = li.match(/<a [^>]*href="(https:\/\/ballotpedia\.org\/[^"]*)"[^>]*>([\s\S]*?)<\/a>\s*(?:\(([^)]{1,40})\))?/);
        if (!a) return [];
        return [{ name: stripTags(a[2] ?? ""), href: a[1] ?? null, key: hrefKey(a[1]), token: a[3] ?? null }];
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

// The shipped parser's slicing (:303, :312-317): each box runs from its
// race_header div to the next one, or to the end of the range.
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
  const specialPage = /special election/i.test(title); // :392-395 isSpecialElectionPage
  const all = readBoxes(html, 0, html.length, false);
  const anchor = html.indexOf(ANCHOR);
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
  const nextH2 = html.indexOf("<h2", anchor + 10); // :300-301
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

// The model's kept-primary rows must be the rows the shipped parser returns,
// keyed the way it dedups (:370). A mismatch means this file's box selection is
// not the ingest's, and every href route through the primary box is suspect.
function parseCheck(html: string, model: PageModel): string | null {
  const theirs = new Set(
    parseCandidatesPage(html, "XX", "u").candidates.map(
      (c) => `${c.isSpecial ? "S" : "R"}|${c.contest}|${c.name.toLowerCase()}`,
    ),
  );
  const mine = new Set<string>();
  for (const b of model.primaries) {
    for (const r of b.rows) mine.add(`${b.special ? "S" : "R"}|${b.contest}|${r.name.toLowerCase()}`);
  }
  const onlyMine = [...mine].filter((k) => !theirs.has(k));
  const onlyTheirs = [...theirs].filter((k) => !mine.has(k));
  return onlyMine.length || onlyTheirs.length
    ? `only here ${JSON.stringify(onlyMine)} · only in parseCandidatesPage ${JSON.stringify(onlyTheirs)}`
    : null;
}

// ── read-only database access ──────────────────────────────────────────────
// SELECT only; WITH is refused too (`WITH x AS (…) DELETE …` is a write).
function reader(db: Client) {
  const guard = (sql: string) => {
    const kw = sql.trim().split(/\s+/)[0]!.toUpperCase();
    if (kw !== "SELECT") throw new Error(`read-only: refused ${kw}`);
  };
  return {
    one: (sql: string, args?: InArgs): Promise<ResultSet> => {
      guard(sql);
      return db.execute({ sql, args: args ?? [] });
    },
    many: (stmts: { sql: string; args: InArgs }[]): Promise<ResultSet[]> => {
      for (const s of stmts) guard(s.sql);
      return db.batch(stmts, "read");
    },
  };
}
type Reader = ReturnType<typeof reader>;

// lib/queries.ts:1914-1934, the SQL of `getRaceCandidates` with its comments
// dropped. The function itself is wrapped in unstable_cache and reads getDb(),
// so the script runs its SQL. Party normalisation (:1940) is display-only and is
// not applied: the comparison is by person, never by party.
const GET_RACE_CANDIDATES_SQL = `SELECT race_id, name, party, bioguide_id, status, source_url
            FROM race_candidates
            WHERE race_id = ?
            ORDER BY
              CASE
                WHEN status IN ('won_primary', 'nominee', 'advanced') THEN 0
                WHEN status = 'running' THEN 1
                WHEN status = 'declared' THEN 2
                WHEN status = 'withdrew' THEN 3
                ELSE 4
              END,
              name ASC`;
// The handoff's falsification-set query, verbatim.
const FSET_CA_SQL = `SELECT DISTINCT r.id FROM races r
     JOIN race_candidates rc ON rc.race_id = r.id
     WHERE r.cycle = 2026 AND r.chamber = 'house' AND r.state = 'CA'
       AND rc.status = 'advanced' AND rc.source_url = 'harvest:primary_winner'
       AND EXISTS (SELECT 1 FROM race_ratings rr WHERE rr.race_id = r.id AND rr.cycle = 2026)`;

type RaceRow = {
  id: string;
  chamber: string;
  state: string;
  district: number | null;
  incumbent: string | null;
  running: number | null;
};
type Pub = { name: string; party: string | null; bioguide: string | null; status: string | null; source: string | null };
type Person = {
  bioguide: string;
  name: string | null;
  first: string | null;
  last: string | null;
  party: string | null;
  title: string | null;
  hasIds: boolean;
};
type Snapshot = {
  scheme: string;
  races: RaceRow[];
  roster: Record<string, Pub[]>;
  people: Record<string, Person>;
  fset: string[];
};

async function takeSnapshot(read: Reader, scheme: string): Promise<Snapshot> {
  const rs = await read.one(
    `SELECT id, chamber, state, district, incumbent_bioguide_id, incumbent_running
       FROM races WHERE cycle = ? ORDER BY id`,
    [CYCLE],
  );
  const races: RaceRow[] = rs.rows.map((r) => ({
    id: String(r.id),
    chamber: String(r.chamber),
    state: String(r.state),
    district: r.district == null ? null : Number(r.district),
    incumbent: r.incumbent_bioguide_id == null ? null : String(r.incumbent_bioguide_id),
    running: r.incumbent_running == null ? null : Number(r.incumbent_running),
  }));
  const roster: Record<string, Pub[]> = {};
  for (let i = 0; i < races.length; i += 100) {
    const part = races.slice(i, i + 100);
    const out = await read.many(part.map((r) => ({ sql: GET_RACE_CANDIDATES_SQL, args: [r.id] })));
    part.forEach((r, j) => {
      roster[r.id] = (out[j]?.rows ?? []).map((x) => ({
        name: String(x.name),
        party: x.party == null ? null : String(x.party),
        bioguide: x.bioguide_id == null ? null : String(x.bioguide_id),
        status: x.status == null ? null : String(x.status),
        source: x.source_url == null ? null : String(x.source_url),
      }));
    });
  }
  const ppl = await read.one(
    `SELECT DISTINCT r.incumbent_bioguide_id AS b, m.name, m.first_name, m.last_name, m.party,
            mi.ballotpedia_title, (mi.bioguide_id IS NOT NULL) AS has_ids
       FROM races r
       LEFT JOIN members m ON m.bioguide_id = r.incumbent_bioguide_id
       LEFT JOIN member_ids mi ON mi.bioguide_id = r.incumbent_bioguide_id
      WHERE r.cycle = ? AND r.incumbent_bioguide_id IS NOT NULL`,
    [CYCLE],
  );
  const people: Record<string, Person> = {};
  for (const p of ppl.rows) {
    const t = p.ballotpedia_title == null ? null : String(p.ballotpedia_title).trim();
    people[String(p.b)] = {
      bioguide: String(p.b),
      name: p.name == null ? null : String(p.name),
      first: p.first_name == null ? null : String(p.first_name),
      last: p.last_name == null ? null : String(p.last_name),
      party: p.party == null ? null : String(p.party),
      title: t ? t : null,
      hasIds: Number(p.has_ids) === 1,
    };
  }
  const ca = await read.one(FSET_CA_SQL);
  const fset = ["S-AK-2026", "AK-AL-2026", ...ca.rows.map((r) => String(r.id)).sort()];
  return { scheme, races, roster, people, fset };
}

// ── fetching ───────────────────────────────────────────────────────────────
type Raw = { kind: "response"; status: number; body: string } | { kind: "timeout" } | { kind: "network"; error: string };
type Attempt = { url: string; attempt: number; result: string; bytes: number; ms: number; file: string | null; at: string };
type IO = {
  get: (url: string) => Promise<Raw>;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
  record: (raceId: string, seq: number, url: string, attempt: number, raw: Raw, ms: number) => string | null;
};
type Outcome = "ok" | "no-anchor" | "http" | "timeout" | "network";
type UrlRead = { url: string; outcome: Outcome; status: number | null; body: string | null; file: string | null };
type Verdict = "READ" | "NO_PAGE" | "UNREAD";
type PageReading = {
  raceId: string;
  verdict: Verdict;
  cause: string | null;
  url: string;
  fallback: boolean;
  attempts: Attempt[];
  file: string | null;
  html: string | null;
  // Which pass read this page and when its last request completed. Pass 1 is the
  // census as the handoff specified it; pass 2 is the architect's ruled
  // completion (see `pass2`). Pass 1 manifests predate the fields and are
  // filled from requests.log on load.
  pass?: number;
  fetchedAt?: string | null;
};

const sleepReal = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// `startGapMs` 0 is pass 1's pacing; pass 2 passes PASS2_GAP_MS.
function liveIO(pagesDir: string, tag: string, startGapMs = 0): IO {
  mkdirSync(pagesDir, { recursive: true });
  let lastEnd = 0;
  let lastStart = 0;
  return {
    now: () => Date.now(),
    sleep: sleepReal,
    // One request in flight (the caller awaits), at least MIN_GAP_MS between the
    // end of one request and the start of the next, retries included, and at
    // least `startGapMs` between two starts. The 8s cap covers the body as well
    // as the headers, so a hung body cannot hang the run.
    get: async (url) => {
      const wait = Math.max(lastEnd + MIN_GAP_MS, lastStart + startGapMs) - Date.now();
      if (wait > 0) await sleepReal(wait);
      lastStart = Date.now();
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
        lastEnd = Date.now();
      }
    },
    record: (raceId, seq, url, attempt, raw, ms) => {
      let file: string | null = null;
      let bytes = 0;
      if (raw.kind === "response") {
        bytes = Buffer.byteLength(raw.body);
        file = path.join(pagesDir, `${raceId}.${seq}.html.gz`).replace(/\\/g, "/");
        writeFileSync(file, gzipSync(raw.body));
      }
      const status = raw.kind === "response" ? String(raw.status) : raw.kind;
      // The trailing column (start of the request, after any pacing wait) was
      // added for pass 2, whose pacing is proved from it; pass 1's lines lack it.
      appendFileSync(
        `${ART}/requests.log`,
        `${tag}\t${new Date().toISOString()}\t${raceId}\t${seq}\t${url}\t${status}\t${bytes}\t${ms}ms\tattempt ${attempt}\t${file ?? "-"}\tstart ${new Date(lastStart).toISOString()}\n`,
      );
      return file;
    },
  };
}

// One URL, up to ATTEMPTS tries, mirroring scrapeHouseCandidates (:531-570): a
// timeout is not retried (:536-547), a 404 is not retried (:556), any other
// non-ok or a thrown fetch is retried (:548-557), and a 2xx without the anchor
// is retried as a challenge page (:567-569).
async function readUrl(
  raceId: string,
  url: string,
  io: IO,
  seq: { n: number },
  log: Attempt[],
  attempts = ATTEMPTS,
): Promise<UrlRead> {
  let last: UrlRead = { url, outcome: "network", status: null, body: null, file: null };
  for (let attempt = 1; attempt <= attempts; attempt++) {
    if (attempt > 1) await io.sleep(BACKOFF_MS);
    const t0 = io.now();
    const raw = await io.get(url);
    const ms = io.now() - t0;
    const file = io.record(raceId, ++seq.n, url, attempt, raw, ms);
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
    if (raw.body.includes(ANCHOR)) return { url, outcome: "ok", status: raw.status, body: raw.body, file };
    last = { url, outcome: "no-anchor", status: raw.status, body: null, file };
  }
  return last;
}

// The page verdict. The URL is the pipeline's URL: the scraper's builders, the
// slug as the sync builds it (lib/primaries-sync.ts:905, :1255).
// `tries` is ATTEMPTS in pass 1 and 1 in pass 2 (no quick retries against a
// bot wall; the pass requeues instead).
export async function readRacePage(race: RaceRow, io: IO, tries = ATTEMPTS): Promise<PageReading> {
  const slug = stateName(race.state).replace(/ /g, "_");
  const seq = { n: 0 };
  const attempts: Attempt[] = [];
  let fallback = false;
  let r: UrlRead;
  if (race.chamber === "senate") {
    r = await readUrl(race.id, senatePageUrl(slug), io, seq, attempts, tries);
    // scrapeSenateCandidates :425-431: a non-ok response, or none, falls back to
    // the special-election URL; an aborted fetch does not.
    if (r.outcome === "http" || r.outcome === "network") {
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

// ── classification ─────────────────────────────────────────────────────────
type RaceStatus = "compared" | "no-general-box" | "ambiguous-general" | "UNREAD" | "NO_PAGE" | "NOT_ATTEMPTED";
type Source = "harvested" | "curated" | "none";
type MatchRoute = "href" | "name" | "surname-initial";
type Cand = {
  race: string;
  cls: string;
  sub: string | null;
  name: string;
  status: string | null;
  source: Source;
  route: MatchRoute | null;
  ballotName: string | null;
  ballotHref: string | null;
  primaryRoute: "href" | "name" | null;
  // Context, not class: every OTHER box in the section that lists this person
  // (kind|prefix|marked), and the ballot row's party letter where there is one.
  seenIn?: string[];
  ballotParty?: string | null;
  writeIn?: boolean;
  // a D or R primary box marks this person AND at least one other row: a
  // single-winner party primary marking two is a runoff advance
  firstRoundAdvancer?: boolean;
};
type RaceResult = {
  id: string;
  chamber: string;
  state: string;
  district: number | null;
  verdict: Verdict | "NOT_ATTEMPTED";
  cause: string | null;
  status: RaceStatus;
  specialPage: boolean | null;
  generalCount: number;
  generalPrefixes: string[];
  chosen: Box | null;
  outsideGeneral: number;
  outsideGeneralUnmarked: number;
  rosterSource: Source;
  published: Pub[];
  incumbentRow: { name: string; route: IncRoute } | null;
  cands: Cand[];
  underlinedNotStored: string[];
  identityPairs: { key: string; general: string; primary: string }[];
  namesakes: string[];
  nameSplits: string[];
  parseCheck: string | null;
};
type IncBucket = "on-own-ballot" | "on-other-ballot" | "on-no-ballot" | "no-title" | "title-mismatch";
type IncResult = {
  race: string;
  chamber: string;
  state: string;
  bioguide: string;
  name: string | null;
  title: string | null;
  running: number | null;
  bucket: IncBucket;
  route: "identity" | "name" | null;
  where: string[];
  note: string;
  residue?: string[];
};
type Census = { races: RaceResult[]; incumbents: IncResult[] };

const SUFFIXES = new Set(["jr", "sr", "ii", "iii", "iv"]);
// Surname and first initial. The surname is `members.last_name`; the initial is
// accepted from `first_name`, from the first word of `members.name`, or from a
// nickname `members.name` quotes, because Congress.gov's first_name is often
// the formal name the ballot does not print: AR-01's stored incumbent is
// `Eric A. "Rick" Crawford`, and his own ballot row reads "Rick Crawford".
function nameRoute(p: Person, row: Row): boolean {
  const toks = normName(row.name).split(" ").filter((t) => t && !SUFFIXES.has(t));
  const last = normName(p.last ?? "").split(" ").filter((t) => t && !SUFFIXES.has(t));
  if (!last.length || toks.length < last.length + 1) return false;
  const ends = last.every((t, i) => toks[toks.length - last.length + i] === t);
  const nick = (p.name ?? "").match(/["“]([^"”]+)["”]/)?.[1] ?? "";
  const initials = new Set([normName(p.first ?? "")[0], normName(p.name ?? "")[0], normName(nick)[0]].filter(Boolean));
  return ends && initials.has(toks[0]?.[0]);
}
// Residual check, not a route: any row on the incumbent's OWN ballot that carries
// its surname, or is underlined. A stored incumbent read `on-no-ballot` beside
// such a row is a name-route miss to look at, not a finding to take.
function ownBallotResidue(p: Person | undefined, rows: Row[]): string[] {
  const last = normName(p?.last ?? "").split(" ").filter((t) => t && !SUFFIXES.has(t));
  const tail = last.join(" ");
  return rows
    .filter((r) => r.underlined || (tail && ` ${normName(r.name)} `.includes(` ${tail} `)))
    .map((r) => `${r.underlined ? "<u>" : ""}${r.name} [${r.key ?? "-"}]`);
}
function findPerson(p: Person | undefined, rows: Row[]): { row: Row; route: "identity" | "name" }[] {
  if (!p) return [];
  const tk = p.title ? titleKey(p.title) : null;
  const byId = tk ? rows.filter((r) => r.key === tk) : [];
  if (byId.length) return byId.map((row) => ({ row, route: "identity" as const }));
  return rows.filter((r) => nameRoute(p, r)).map((row) => ({ row, route: "name" as const }));
}
// Which ballot row(s) ARE the stored incumbent. Identity wins outright. A single
// name hit is taken. Two or more name hits are namesakes (S-AK-2026 carries the
// senator and a second candidate named Dan Sullivan, two hrefs), and the one
// Ballotpedia underlines is taken if exactly one is; otherwise none is, and the
// race says so rather than guessing.
type IncRoute = "identity" | "name" | "name+underline";
function resolveInc(hits: { row: Row; route: "identity" | "name" }[]): { rows: Row[]; route: IncRoute } | null {
  if (!hits.length) return null;
  if (hits[0]!.route === "identity") return { rows: hits.map((h) => h.row), route: "identity" };
  if (hits.length === 1) return { rows: [hits[0]!.row], route: "name" };
  const u = hits.filter((h) => h.row.underlined);
  return u.length === 1 ? { rows: [u[0]!.row], route: "name+underline" } : null;
}

function rosterSource(rows: Pub[]): Source {
  if (!rows.length) return "none";
  // The harvest skips any race carrying a non-sentinel row (HARVEST_FROM_WHERE's
  // NOT EXISTS), so one curated row makes the race curated.
  return rows.some((r) => r.source !== HARVEST_SOURCE) ? "curated" : "harvested";
}
const rowSource = (p: Pub): Source => (p.source === HARVEST_SOURCE ? "harvested" : "curated");

function pickBallot(general: Box[]): Box | null {
  if (general.length === 1) return general[0]!;
  const regular = general.filter((b) => /^general election$/i.test(b.prefix));
  return regular.length === 1 ? regular[0]! : null;
}

function classifyRace(race: RaceRow, snap: Snapshot, reading: PageReading | undefined, model: PageModel | null): RaceResult {
  const published = snap.roster[race.id] ?? [];
  const base: RaceResult = {
    id: race.id,
    chamber: race.chamber,
    state: race.state,
    district: race.district,
    verdict: reading?.verdict ?? "NOT_ATTEMPTED",
    cause: reading?.cause ?? null,
    status: "NOT_ATTEMPTED",
    specialPage: model?.specialPage ?? null,
    generalCount: model?.general.length ?? 0,
    generalPrefixes: model?.general.map((b) => b.prefix) ?? [],
    chosen: null,
    outsideGeneral: model?.outsideGeneral.length ?? 0,
    outsideGeneralUnmarked: model?.outsideGeneral.filter((b) => b.marked === 0).length ?? 0,
    rosterSource: rosterSource(published),
    published,
    incumbentRow: null,
    cands: [],
    underlinedNotStored: [],
    identityPairs: [],
    namesakes: [],
    nameSplits: [],
    parseCheck: null,
  };
  if (!reading) return base;
  if (reading.verdict !== "READ") return { ...base, status: reading.verdict };
  if (!model) throw new Error(`${race.id}: a READ page reached classification without its model`);
  if (reading.html) base.parseCheck = parseCheck(reading.html, model);
  if (model.general.length === 0) return { ...base, status: "no-general-box" };
  const chosen = pickBallot(model.general);
  const primRows = model.primaries.flatMap((b) => b.rows);
  // one normalized name under two or more hrefs, anywhere in the general and
  // kept-primary boxes: two people, whatever a name join would make of them
  const byName = new Map<string, Set<string>>();
  for (const r of [...model.general.flatMap((b) => b.rows), ...primRows]) {
    if (r.key) byName.set(normName(r.name), (byName.get(normName(r.name)) ?? new Set()).add(r.key));
  }
  base.nameSplits = [...byName].filter(([, ks]) => ks.size > 1).map(([n, ks]) => `${n} → ${[...ks].join(" | ")}`);
  // identity pairs: same href in a general and a kept primary box, different anchor text
  for (const g of model.general) {
    for (const r of g.rows) {
      for (const pr of primRows) {
        if (r.key && pr.key === r.key && pr.name !== r.name) base.identityPairs.push({ key: r.key, general: r.name, primary: pr.name });
      }
    }
  }
  const inc = race.incumbent ? snap.people[race.incumbent] : undefined;
  const allGeneralRows = model.general.flatMap((b) => b.rows);
  const incAll = resolveInc(findPerson(inc, allGeneralRows));
  base.underlinedNotStored = allGeneralRows
    .filter((r) => r.underlined && !incAll?.rows.includes(r))
    .map((r) => r.name);
  // namesakes: rows on this page (general and kept-primary boxes) that pass the
  // stored incumbent's name route under more than one href
  if (inc) {
    const hits = [...allGeneralRows, ...primRows].filter((r) => nameRoute(inc, r));
    const byKey = new Map<string, Set<string>>();
    for (const r of hits) byKey.set(r.key ?? "(no href)", (byKey.get(r.key ?? "(no href)") ?? new Set()).add(r.name));
    if (byKey.size > 1) base.namesakes = [...byKey].map(([k, names]) => `${[...names].join(" / ")} → ${k}`);
  }
  if (!chosen) return { ...base, status: "ambiguous-general" };
  base.chosen = chosen;
  const ballotAll = chosen.rows;
  const incOwn = resolveInc(findPerson(inc, ballotAll));
  base.incumbentRow = incOwn ? { name: incOwn.rows[0]!.name, route: incOwn.route } : null;
  const ballot = ballotAll.filter((r) => !incOwn?.rows.includes(r));

  const src = base.rosterSource;
  const cands: Cand[] = [];
  const otherBoxes = model.sectionBoxes.filter((b) => b.kind !== "general");
  const seenIn = (name: string, key: string | null): string[] =>
    otherBoxes.flatMap((b) =>
      b.rows
        .filter((r) => (key && r.key ? r.key === key : r.name === name || normName(r.name) === normName(name)))
        .map((r) => `${b.kind}|${b.prefix}|${r.winner ? "marked" : "unmarked"}`),
    );
  const keyOf = (name: string) => primRows.find((x) => x.name === name && x.key)?.key ?? null;
  const consumed = new Set<Row>();
  // Routes, in order: href through the primary box; normalized name; then
  // surname and first initial, taken only when exactly one row passes. The third
  // is this file's addition to the handoff's two, for a stored name that the page
  // has since printed differently: CA-10's "Jeffrey Frese" is "Jeff Frese" in
  // both of today's boxes, and S-ME's curated "Troy Jackson" is the ballot's
  // "Troy Dale Jackson". Every pair records its route, so the looser one is seen.
  const surnameInitial = (a: string, b: string) => {
    const ta = normName(a).split(" ").filter((t) => t && !SUFFIXES.has(t));
    const tb = normName(b).split(" ").filter((t) => t && !SUFFIXES.has(t));
    return ta.length > 1 && tb.length > 1 && ta[ta.length - 1] === tb[tb.length - 1] && ta[0]![0] === tb[0]![0];
  };
  const matchTo = (name: string, rows: Row[]): { row: Row; route: MatchRoute } | null => {
    for (const pr of primRows.filter((x) => x.name === name && x.key)) {
      const hit = rows.find((b) => b.key && b.key === pr.key);
      if (hit) return { row: hit, route: "href" };
    }
    const n = normName(name);
    const hit = rows.find((b) => normName(b.name) === n);
    if (hit) return { row: hit, route: "name" };
    const si = rows.filter((b) => surnameInitial(name, b.name));
    return si.length === 1 ? { row: si[0]!, route: "surname-initial" } : null;
  };
  for (const p of published) {
    const m = matchTo(p.name, ballotAll);
    const common = { race: race.id, name: p.name, status: p.status, source: rowSource(p), primaryRoute: null };
    if (m) consumed.add(m.row);
    if (p.status === "withdrew") {
      cands.push({
        ...common,
        cls: m ? "withdrew-but-on-ballot" : "agree",
        sub: m ? null : "withdrew-and-off-ballot",
        route: m?.route ?? null,
        ballotName: m?.row.name ?? null,
        ballotHref: m?.row.href ?? null,
      });
      continue;
    }
    if (m) {
      // A published row that IS the stored incumbent agrees with the ballot, and
      // is still a row the harvest meant to exclude (S-SC-2026's own incumbent
      // arrives as `won_primary`), so it carries its own sub-class.
      const isInc = !!incOwn?.rows.includes(m.row);
      cands.push({ ...common, cls: "agree", sub: isInc ? "is-the-stored-incumbent" : null, route: m.route, ballotName: m.row.name, ballotHref: m.row.href });
      continue;
    }
    const wd = chosen.withdrawn?.entries ?? [];
    let listed = false;
    for (const pr of primRows.filter((x) => x.name === p.name && x.key)) if (wd.some((w) => w.key === pr.key)) listed = true;
    if (!listed) listed = wd.some((w) => normName(w.name) === normName(p.name));
    if (!listed) listed = wd.filter((w) => surnameInitial(p.name, w.name)).length === 1;
    cands.push({
      ...common,
      cls: "published-not-on-ballot",
      sub: listed ? "withdrawn-listed" : "absent",
      route: null,
      ballotName: null,
      ballotHref: null,
      seenIn: seenIn(p.name, keyOf(p.name)),
      firstRoundAdvancer: model.primaries.some(
        (b) =>
          (b.contest === "D" || b.contest === "R") &&
          b.marked >= 2 &&
          b.rows.some((r) => r.winner && (r.name === p.name || normName(r.name) === normName(p.name))),
      ),
    });
  }
  for (const b of ballot) {
    if (consumed.has(b)) continue;
    let prim = primRows.filter((r) => r.key && r.key === b.key);
    let primaryRoute: "href" | "name" | null = prim.length ? "href" : null;
    if (!prim.length) {
      prim = primRows.filter((r) => normName(r.name) === normName(b.name));
      if (prim.length) primaryRoute = "name";
    }
    cands.push({
      race: race.id,
      cls: "on-ballot-not-published",
      sub: !prim.length ? "in-no-primary-box" : prim.some((r) => r.winner) ? "marked-in-primary" : "unmarked-in-primary",
      name: b.name,
      status: null,
      source: src,
      route: null,
      ballotName: b.name,
      ballotHref: b.href,
      primaryRoute,
      seenIn: seenIn(b.name, b.key),
      ballotParty: b.printedParty ?? b.party, // what the ballot prints; the ingest's letter where it prints none
      writeIn: !!b.writeIn,
    });
  }
  return { ...base, status: "compared", cands };
}

function classifyAll(snap: Snapshot, pages: Map<string, PageReading>, only?: string[]): Census {
  const keep = only ? new Set(only) : null;
  const races = snap.races.filter((r) => !keep || keep.has(r.id));
  const models = new Map<string, PageModel>();
  for (const r of races) {
    const pg = pages.get(r.id);
    if (pg?.verdict === "READ" && pg.html) models.set(r.id, readPageModel(pg.html));
  }
  const results = races.map((r) => classifyRace(r, snap, pages.get(r.id), models.get(r.id) ?? null));
  // Every 2026 general-box row on every READ page, for the incumbents' search.
  const pool: { race: string; state: string; row: Row }[] = [];
  for (const r of races) {
    for (const b of models.get(r.id)?.general ?? []) for (const row of b.rows) pool.push({ race: r.id, state: r.state, row });
  }
  const incumbents: IncResult[] = [];
  for (const r of races) {
    if (!r.incumbent) continue;
    const p = snap.people[r.incumbent];
    const base = {
      race: r.id,
      chamber: r.chamber,
      state: r.state,
      bioguide: r.incumbent,
      name: p?.name ?? null,
      title: p?.title ?? null,
      running: r.running,
    };
    const own = results.find((x) => x.id === r.id)!;
    const ownNote = `own page ${own.verdict}${own.verdict === "READ" ? `, ${own.status}` : ""}`;
    const inState = pool.filter((x) => x.state === r.state);
    const byName = p ? inState.filter((x) => nameRoute(p, x.row)) : [];
    const nameWhere = [...new Set(byName.map((x) => x.race))];
    if (!p?.title) {
      incumbents.push({
        ...base,
        bucket: "no-title",
        route: null,
        where: nameWhere,
        note: `${p ? (p.hasIds ? "member_ids row, empty title" : "no member_ids row") : "no members row"}; name route finds ${nameWhere.join(",") || "nothing"}; ${ownNote}`,
      });
      continue;
    }
    const tk = titleKey(p.title);
    const byId = [...new Set(pool.filter((x) => x.row.key === tk).map((x) => x.race))];
    if (byId.length) {
      const onOwn = byId.includes(r.id);
      incumbents.push({
        ...base,
        bucket: onOwn ? "on-own-ballot" : "on-other-ballot",
        route: "identity",
        where: byId,
        note: onOwn && byId.length > 1 ? `also on ${byId.filter((x) => x !== r.id).join(",")}` : ownNote,
      });
      continue;
    }
    if (nameWhere.length) {
      incumbents.push({ ...base, bucket: "title-mismatch", route: "name", where: nameWhere, note: `title ${JSON.stringify(p.title)}; ${ownNote}` });
      continue;
    }
    const residue = ownBallotResidue(p, (models.get(r.id)?.general ?? []).flatMap((b) => b.rows));
    incumbents.push({ ...base, bucket: "on-no-ballot", route: null, where: [], note: ownNote, residue });
  }
  return { races: results, incumbents };
}

// ── reporting ──────────────────────────────────────────────────────────────
const lines: string[] = [];
const say = (s = "") => {
  console.log(s);
  lines.push(s);
};
const tally = <T,>(xs: T[], key: (x: T) => string) => {
  const m = new Map<string, number>();
  for (const x of xs) m.set(key(x), (m.get(key(x)) ?? 0) + 1);
  return [...m].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
};
const fmtTally = (t: [string, number][]) => t.map(([k, v]) => `${k} ${v}`).join(" · ") || "(none)";
const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};

function boxLines(b: Box): string[] {
  const out = [`    <h5> "${b.h5}" · class ${b.cls} · rows ${b.rows.length} · marked ${b.marked} · no-link rows ${b.noLinkRows.length}`];
  for (const r of b.rows) {
    out.push(
      `      ${r.winner ? "[W]" : "   "} ${r.underlined ? "<u>" : "   "} ${r.name.padEnd(30)} ${r.party} (${r.route}${r.token ? `:${r.token}` : ""}) ${r.key ?? "-"}${r.writeIn ? ` · write-in "${r.writeIn}"` : ""}`,
    );
  }
  for (const n of b.noLinkRows) out.push(`      (no link) ${n}`);
  if (b.withdrawn) out.push(`      ${b.withdrawn.heading}: ${b.withdrawn.entries.map((e) => `${e.name}${e.token ? ` (${e.token})` : ""} ${e.key ?? "-"}`).join(" · ") || "(no entries parsed)"}`);
  return out;
}

// The page's OWN sentences: the article body only, from mw-content-text to the
// See also / Footnotes heading, so the site navigation (which carries a
// "Redistricting" menu item on every page) cannot pose as the page's prose.
function sentences(html: string, pattern: RegExp): string[] {
  const start = html.indexOf('id="mw-content-text"');
  const ends = ['id="See_also"', 'id="Footnotes"', 'class="printfooter"']
    .map((m) => html.indexOf(m, Math.max(start, 0)))
    .filter((i) => i > 0);
  const article = html.slice(Math.max(start, 0), ends.length ? Math.min(...ends) : html.length);
  const body = article.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ");
  const text = stripTags(body.replace(/&#160;/g, " ")).replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)));
  const out = new Set<string>();
  for (const s of text.split(/(?<=[.!?])\s+(?=[A-Z0-9"“(])/)) {
    if (pattern.test(s)) out.add(s.length > 200 ? `${s.slice(0, 199)}…` : s);
  }
  return [...out];
}

type ReadStats = {
  attempted: number;
  requests: number;
  retries: number;
  bytes: number;
  ms: number;
  fallbacks: number;
  stoppedAt: string | null;
  paused: boolean;
};

// The wall's shape, per pass: where each run of refused requests began (request
// index within the pass, and time), how long it ran, and when a page read again.
type Streak = {
  beganAtRequest: number;
  beganAt: string;
  firstRace: string;
  requests: number;
  readAgainAt: string | null;
  readAgainAfterS: number | null;
  readAgainRace: string | null;
};
type ReqLine = { idx: number; at: string; race: string; status: string };
type PassInfo = {
  label: string;
  window: [string, string];
  attempted: number;
  read: number;
  noPage: number;
  unread: number;
  requests: number;
  retries: number;
  bytes: number;
  stoppedAt: string | null;
  pause: string;
  streaks: Streak[];
  notes: string[];
};
// A request is refused when it answered neither a page (200) nor a 404.
function streaksOf(reqs: ReqLine[]): Streak[] {
  const out: Streak[] = [];
  let cur: Streak | null = null;
  for (const r of reqs) {
    const refused = r.status !== "200" && r.status !== "404";
    if (refused) {
      if (!cur) cur = { beganAtRequest: r.idx, beganAt: r.at, firstRace: r.race, requests: 0, readAgainAt: null, readAgainAfterS: null, readAgainRace: null };
      cur.requests++;
    } else if (cur) {
      if (r.status === "200") {
        cur.readAgainAt = r.at;
        cur.readAgainAfterS = Math.round((Date.parse(r.at) - Date.parse(cur.beganAt)) / 1000);
        cur.readAgainRace = r.race;
      }
      out.push(cur);
      cur = null;
    }
  }
  if (cur) out.push(cur);
  return out;
}
function passLines(p: PassInfo): string[] {
  const out = [
    `  ${p.label}: ${p.window[0]} → ${p.window[1]} · attempted ${p.attempted} · READ ${p.read} · NO_PAGE ${p.noPage} · UNREAD ${p.unread} · requests ${p.requests} · retries ${p.retries} · bytes ${p.bytes} (${(p.bytes / 1e6).toFixed(1)} MB) · pause ${p.pause}${p.stoppedAt ? ` · STOPPED at ${p.stoppedAt}` : " · ran to the end"}`,
  ];
  for (const s of p.streaks) {
    out.push(
      `    wall: began at request #${s.beganAtRequest} (${s.firstRace}) ${s.beganAt} · ${s.requests} refused request(s) · ${s.readAgainAt ? `read again at ${s.readAgainAt} (${s.readAgainRace}), ${s.readAgainAfterS}s after it began` : "never read again in this pass"}`,
    );
  }
  if (!p.streaks.length) out.push("    wall: no refused request in this pass");
  for (const n of p.notes) out.push(`    ${n}`);
  return out;
}

function report(
  label: string,
  snap: Snapshot,
  pages: Map<string, PageReading>,
  census: Census,
  stats: ReadStats | null,
  passes: PassInfo[] = [],
) {
  const R = census.races;
  const read = R.filter((r) => r.verdict === "READ");
  const models = new Map<string, PageModel>();
  for (const r of read) {
    const h = pages.get(r.id)?.html;
    if (h) models.set(r.id, readPageModel(h));
  }
  const tagOf = (id: string) => {
    const p = pages.get(id);
    return p?.pass ? ` [pass ${p.pass} @ ${p.fetchedAt ?? "?"}]` : "";
  };
  say(`\n══════════ READING: ${label} · snapshot scheme ${snap.scheme}: · ${R.length} races ══════════`);

  say("\n── 1. Read census");
  say(`  pages attempted ${R.filter((r) => r.verdict !== "NOT_ATTEMPTED").length} of ${R.length} · ${fmtTally(tally(R, (r) => r.verdict))}`);
  say(`  UNREAD by cause: ${fmtTally(tally(R.filter((r) => r.verdict === "UNREAD"), (r) => r.cause ?? "?"))}`);
  say(`  Senate fallbacks used: ${[...pages.values()].filter((p) => p.fallback).map((p) => `${p.raceId}→${p.verdict}`).join(", ") || "0"}`);
  say(`  special-election pages (title): ${read.filter((r) => r.specialPage).map((r) => r.id).join(", ") || "0"}`);
  if (stats) {
    say(`  requests ${stats.requests} · retries ${stats.retries} · bytes ${stats.bytes} (${(stats.bytes / 1e6).toFixed(1)} MB) · elapsed ${(stats.ms / 1000).toFixed(0)}s · 60s pause ${stats.paused ? "USED" : "not used"}${stats.stoppedAt ? ` · STOPPED at ${stats.stoppedAt} (partial census)` : ""}`);
  }
  for (const p of passes) for (const l of passLines(p)) say(l);
  if (passes.length) {
    say(`  union, by the pass whose reading each race carries: ${fmtTally(tally(R, (r) => `pass ${pages.get(r.id)?.pass ?? "-"} ${r.verdict}`))}`);
  }

  say("\n── 2. Markup census (READ pages)");
  const secBoxes = [...models.values()].flatMap((m) => m.sectionBoxes);
  say(`  in-section boxes ${secBoxes.length} · by kind: ${fmtTally(tally(secBoxes, (b) => b.kind))}`);
  say("  <h5> prefix × class modifier, inside the section:");
  for (const [k, v] of tally(secBoxes, (b) => `${b.prefix} | ${b.cls} | ${b.kind}`)) say(`    ${String(v).padStart(4)}  ${k}`);
  const unrec = secBoxes.filter((b) => b.kind === "unrecognized");
  say(`  unrecognized prefixes: ${fmtTally(tally(unrec, (b) => b.prefix))}`);
  say(`  pages by 2026 general boxes: ${fmtTally(tally(read, (r) => (r.generalCount >= 2 ? "2+" : String(r.generalCount))))}`);
  const two = read.filter((r) => r.generalCount >= 2);
  if (two.length) say(`    2+: ${two.map((r) => `${r.id} [${r.generalPrefixes.join(" | ")}]${r.status === "ambiguous-general" ? " AMBIGUOUS" : ""}`).join(" · ")}`);
  const extra = read.filter((r) => r.outsideGeneral > 0);
  say(`  pages where a page-wide general selector takes extra boxes: ${extra.length} of ${read.length} · extra boxes ${extra.reduce((a, r) => a + r.outsideGeneral, 0)}, of them with no marked row ${extra.reduce((a, r) => a + r.outsideGeneralUnmarked, 0)} (${read.filter((r) => r.outsideGeneralUnmarked > 0).length} pages)`);
  const gBoxes = [...models.values()].flatMap((m) => m.general);
  const gRows = gBoxes.flatMap((b) => b.rows);
  say(`  party-token routes, general-box rows: ${fmtTally(tally(gRows, (r) => r.route))}`);
  say(`    tokens: ${fmtTally(tally(gRows, (r) => `${r.route}:${r.token ?? "-"}→${r.party}`))}`);
  const pRows = [...models.values()].flatMap((m) => m.primaries).flatMap((b) => b.rows);
  say(`  party-token routes, kept-primary rows (context): ${fmtTally(tally(pRows, (r) => r.route))}`);
  const wi = [...models.entries()].flatMap(([id, m]) => m.general.flatMap((b) => [...b.rows.filter((r) => r.writeIn).map((r) => ({ id, t: r.writeIn! })), ...b.noLinkRows.filter((t) => /write[- ]?in/i.test(t)).map((t) => ({ id, t }))]));
  say(`  write-in markers in general boxes: ${fmtTally(tally(wi, (x) => x.t))}${wi.length ? ` (pages: ${[...new Set(wi.map((x) => x.id))].join(",")})` : ""}`);
  const nolink = gBoxes.flatMap((b) => b.noLinkRows);
  say(`  general-box rows with no person link: ${nolink.length}${nolink.length ? ` · ${fmtTally(tally(nolink, (t) => t))}` : ""}`);
  const wd = [...models.entries()].flatMap(([id, m]) => m.general.filter((b) => b.withdrawn).map((b) => ({ id, w: b.withdrawn! })));
  say(`  withdrawn blocks after a general box: ${wd.length} boxes · ${wd.reduce((a, x) => a + x.w.entries.length, 0)} names · headings ${fmtTally(tally(wd, (x) => x.w.heading))}`);
  const markedG = [...models.entries()].flatMap(([id, m]) => m.general.filter((b) => b.marked > 0).map((b) => `${id} "${b.h5}" marked ${b.marked}`));
  say(`  marked rows in any 2026 general box: ${markedG.length ? markedG.join(" · ") : "0 (expected 0 before the election)"}`);
  const pc = read.filter((r) => r.parseCheck);
  say(`  kept-primary rows vs parseCandidatesPage: ${pc.length ? `${pc.length} DIFFER: ${pc.map((r) => `${r.id} ${r.parseCheck}`).join(" · ")}` : `agree on all ${read.length} READ pages`}`);

  say("\n── 3. Divergence (compared races)");
  const cmp = R.filter((r) => r.status === "compared");
  say(`  race status: ${fmtTally(tally(R, (r) => r.status))}`);
  const C = cmp.flatMap((r) => r.cands);
  say(`  candidates by class: ${fmtTally(tally(C, (c) => (c.sub && c.cls !== "agree" ? `${c.cls}/${c.sub}` : c.cls)))}`);
  say("  class × roster source:");
  for (const [k, v] of tally(C, (c) => `${c.cls}${c.sub && c.cls !== "agree" ? `/${c.sub}` : ""} | ${c.source}`)) say(`    ${String(v).padStart(4)}  ${k}`);
  say("  class × published status:");
  for (const [k, v] of tally(C, (c) => `${c.cls}${c.sub ? `/${c.sub}` : ""} | ${c.status ?? "(unpublished)"}`)) say(`    ${String(v).padStart(4)}  ${k}`);
  const sig = (c: Cand) => [...new Set(c.seenIn ?? [])].sort().join(" + ") || "in no other box";
  say("  published-not-on-ballot, where the page puts the person (box kind|contest|marked):");
  for (const [k, v] of tally(C.filter((c) => c.cls === "published-not-on-ballot"), (c) => `${c.sub} · ${sig(c)}`)) say(`    ${String(v).padStart(4)}  ${k}`);
  say("  on-ballot-not-published by the ballot row's party letter:");
  for (const [k, v] of tally(C.filter((c) => c.cls === "on-ballot-not-published"), (c) => `${c.sub} · ${c.ballotParty ?? "?"}${c.writeIn ? " · write-in" : ""}`)) say(`    ${String(v).padStart(4)}  ${k}`);
  say("  in-no-primary-box, where else the page puts the person (write-in = the row carries a write-in marker):");
  const inNo = C.filter((c) => c.sub === "in-no-primary-box");
  for (const [k, v] of tally(inNo, (c) => `${c.ballotParty === "D" || c.ballotParty === "R" ? "D/R" : "other"}${c.writeIn ? " write-in" : ""} · ${sig(c)}`)) say(`    ${String(v).padStart(4)}  ${k}`);
  const drNo = inNo.filter((c) => (c.ballotParty === "D" || c.ballotParty === "R") && !c.writeIn);
  say(`  D/R ballot rows in no primary box and not write-ins: ${drNo.length}`);
  for (const c of drNo) say(`    ${c.race} ${c.name} (${c.ballotParty}) · ${sig(c)} · roster ${c.source}`);
  const pnob = C.filter((c) => c.cls === "published-not-on-ballot");
  const fra = pnob.filter((c) => c.firstRoundAdvancer);
  say(`  published-not-on-ballot marked as one of two or more in a D/R primary box (a first-round runoff advancer): ${fra.length} of ${pnob.length} · ${fmtTally(tally(fra, (c) => c.race.slice(0, 2)))}`);
  const runoffLosers = C.filter((c) => c.cls === "published-not-on-ballot" && (c.seenIn ?? []).some((x) => x.startsWith("runoff|") && x.endsWith("|unmarked")));
  say(`  published-not-on-ballot and unmarked in a runoff box on the page (a first-round advancer who lost the runoff): ${runoffLosers.length} · ${fmtTally(tally(runoffLosers, (c) => c.race.slice(0, 2)))}`);
  const otherPnob = C.filter((c) => c.cls === "published-not-on-ballot" && !runoffLosers.includes(c));
  for (const c of otherPnob) say(`    not a runoff loser: ${c.race} ${c.name} (${c.status}, ${c.source}) · ${c.sub} · ${sig(c)}`);
  const nonAgree = C.filter((c) => c.cls !== "agree");
  say(`  races with any non-agree candidate: ${new Set(nonAgree.map((c) => c.race)).size} of ${cmp.length} compared`);
  const uncomparedPub = R.filter((r) => r.status !== "compared").flatMap((r) => r.published.map((p) => ({ r, p })));
  say(`  published rows on races NOT compared: ${uncomparedPub.length} · ${fmtTally(tally(uncomparedPub, (x) => `${x.r.status}|${rowSource(x.p)}`))}`);
  say(`  every non-agree candidate: candidates.csv (cls != agree), ${nonAgree.length} rows`);

  say("\n── 4. Identity");
  const pairs = read.flatMap((r) => r.identityPairs.map((p) => ({ id: r.id, ...p })));
  say(`  same href, different anchor text (general vs kept primary): ${pairs.length}`);
  for (const p of pairs) say(`    ${p.id} ${p.key}: general "${p.general}" · primary "${p.primary}"`);
  const splits = read.filter((r) => r.nameSplits.length);
  say(`  one normalized name under two or more hrefs on one page (general + kept primary): ${splits.length} pages`);
  for (const r of splits) say(`    ${r.id}: ${r.nameSplits.join(" ; ")}`);
  const ns = read.filter((r) => r.namesakes.length);
  say(`  namesakes of the stored incumbent (rows passing its name route under 2+ hrefs): ${ns.length} pages`);
  for (const r of ns) say(`    ${r.id} (stored ${snap.races.find((x) => x.id === r.id)?.incumbent}): ${r.namesakes.join(" ; ")}`);
  const pubMatched = C.filter((c) => c.status !== null);
  say(`  match route for every published row on compared races: ${fmtTally(tally(pubMatched, (c) => `${c.route ?? "unmatched"}`))} (per row in candidates.csv)`);
  say(`  incumbent removed from the ballot by: ${fmtTally(tally(cmp, (r) => (r.incumbentRow ? r.incumbentRow.route : "not on this ballot")))}`);

  say("\n── 5. Ballot size (every in-section 2026 general box on a READ page)");
  const sizes = gBoxes.map((b) => b.rows.length);
  say(`  boxes ${gBoxes.length} · candidates min ${Math.min(...sizes)} · median ${median(sizes)} · max ${Math.max(...sizes)} · total ${gRows.length}`);
  say(`  size distribution: ${fmtTally(tally(sizes, (n) => String(n).padStart(2, "0")))}`);
  const pct = (n: number) => (gRows.length ? ((100 * n) / gRows.length).toFixed(1) : "0");
  const nonDR = gRows.filter((r) => r.party !== "D" && r.party !== "R");
  say(`  neither D nor R, by the INGEST's letter: ${nonDR.length} of ${gRows.length} (${pct(nonDR.length)}%) · by letter ${fmtTally(tally(gRows, (r) => r.party))} · boxes with ≥1: ${gBoxes.filter((b) => b.rows.some((r) => r.party !== "D" && r.party !== "R")).length}`);
  const pl = (r: Row) => r.printedParty ?? r.party;
  const nonDRp = gRows.filter((r) => pl(r) !== "D" && pl(r) !== "R");
  say(`  neither D nor R, by the party the ballot PRINTS (a fusion line's first party; the ingest's letter where none is printed): ${nonDRp.length} of ${gRows.length} (${pct(nonDRp.length)}%) · by letter ${fmtTally(tally(gRows, pl))} · boxes with ≥1: ${gBoxes.filter((b) => b.rows.some((r) => pl(r) !== "D" && pl(r) !== "R")).length} · rows printing no party ${gRows.filter((r) => !r.printed).length}`);
  const differ = gRows.filter((r) => r.printedParty && r.printedParty !== r.party);
  say(`  rows whose printed party's letter differs from the ingest's: ${differ.length} · ${fmtTally(tally(differ, (r) => `${r.party}→${r.printedParty} (${(r.printed ?? "").slice(0, 32)})`))}`);
  const cmpSizes = cmp.map((r) => r.chosen!.rows.length);
  const pubSizes = cmp.map((r) => r.published.filter((p) => p.status !== "withdrew").length);
  say(`  compared races: ballot rows ${cmpSizes.reduce((a, b) => a + b, 0)} (incumbents included) against published non-withdrew rows ${pubSizes.reduce((a, b) => a + b, 0)}`);

  say("\n── 6. Incumbents");
  const I = census.incumbents;
  const cov = tally(I, (i) => `${i.chamber}:${i.title ? "title" : "no-title"}`);
  say(`  ballotpedia_title coverage: ${fmtTally(cov)} · races with no stored incumbent: ${R.filter((r) => !snap.races.find((x) => x.id === r.id)?.incumbent).map((r) => r.id).join(",") || "0"}`);
  for (const ch of ["house", "senate"]) {
    const xs = I.filter((i) => i.chamber === ch);
    say(`  ${ch}: ${fmtTally(tally(xs, (i) => (i.bucket === "on-no-ballot" ? `on-no-ballot(running=${i.running ?? "NULL"})` : i.bucket)))}`);
  }
  const nob = I.filter((i) => i.bucket === "on-no-ballot" && R.find((x) => x.id === i.race)?.verdict === "READ");
  const withRes = nob.filter((i) => i.residue?.length);
  say(`  on-no-ballot with the own page READ: ${nob.length} · of them with an underlined or same-surname row on their own ballot (a name-route miss to look at, not a bucket): ${withRes.length}`);
  for (const i of withRes) say(`    residue ${i.race} ${i.name}: ${i.residue!.join(" · ")}`);
  for (const i of I.filter((x) => x.bucket !== "on-own-ballot")) {
    say(`    ${i.race} ${i.bioguide} ${i.name ?? "?"} · ${i.bucket}${i.where.length ? ` → ${i.where.join(",")}` : ""} · running ${i.running ?? "NULL"} · ${i.note}`);
  }
  const uns = read.filter((r) => r.underlinedNotStored.length);
  say(`  underlined-not-stored-incumbent: ${uns.length ? uns.map((r) => `${r.id} [${r.underlinedNotStored.join(", ")}] (stored ${snap.races.find((x) => x.id === r.id)?.incumbent ?? "none"})`).join(" · ") : "0"}`);
  const flagStates = new Set([...I.filter((i) => i.bucket === "on-other-ballot").map((i) => i.state), ...uns.map((r) => r.state)]);
  for (const st of [...flagStates].sort()) {
    const xs = I.filter((i) => i.state === st);
    say(`    state ${st}: ${fmtTally(tally(xs, (i) => i.bucket))} · underlined-not-stored ${uns.filter((r) => r.state === st).map((r) => r.id).join(",") || "0"}`);
  }

  say("\n── 7. The five seats");
  for (const id of FIVE) {
    const r = R.find((x) => x.id === id);
    const race = snap.races.find((x) => x.id === id);
    if (!r || !race) {
      say(`  ${id}: not in this reading`);
      continue;
    }
    const inc = race.incumbent ? snap.people[race.incumbent] : undefined;
    const ib = I.find((i) => i.race === id);
    say(`  ${id} · page ${r.verdict}${r.cause ? ` (${r.cause})` : ""}${tagOf(id)} · ${r.status} · stored incumbent ${race.incumbent ?? "none"} ${inc?.name ?? ""} (${inc?.party ?? "?"}) title ${JSON.stringify(inc?.title ?? null)} · running ${race.running ?? "NULL"} · bucket ${ib?.bucket ?? "-"}${ib?.where.length ? ` → ${ib.where.join(",")}` : ""}`);
    const m = models.get(id);
    for (const b of m?.general ?? []) for (const l of boxLines(b)) say(l);
    say(`    underlined-not-stored-incumbent: ${r.underlinedNotStored.join(", ") || "none"} · published: ${r.published.map((p) => `${p.name} (${p.status})`).join(", ") || "none"}`);
    const html = pages.get(id)?.html;
    if (html) {
      const red = sentences(html, /redistrict/i);
      const sur = inc?.last ? sentences(html, new RegExp(`\\b${inc.last.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i")) : [];
      say(`    sentences mentioning "redistrict": ${red.length}`);
      for (const s of red) say(`      · ${s}`);
      say(`    sentences mentioning "${inc?.last ?? "?"}": ${sur.length}${sur.length > 15 ? " (first 15 printed; all in races.json)" : ""}`);
      for (const s of sur.slice(0, 15)) say(`      · ${s}`);
    }
  }

  say("\n── 8. The falsification set");
  for (const id of snap.fset) {
    const r = R.find((x) => x.id === id);
    if (!r) continue;
    const ib = I.find((i) => i.race === id);
    say(`  ${id} · page ${r.verdict}${tagOf(id)} · ${r.status} · roster ${r.rosterSource} · incumbent ${ib?.bucket ?? "-"} ${ib?.name ?? ""}${ib?.where.length ? ` → ${ib.where.join(",")}` : ""} · removed from ballot by ${r.incumbentRow?.route ?? "-"}`);
    for (const b of models.get(id)?.general ?? []) for (const l of boxLines(b)) say(l);
    for (const c of r.cands) say(`      ${c.cls}${c.sub ? `/${c.sub}` : ""} · ${c.name} · ${c.status ?? "(unpublished)"} · ${c.source} · route ${c.route ?? c.primaryRoute ?? "-"}`);
  }
}

function writeArtifacts(dir: string, label: string, census: Census, pages: Map<string, PageReading>) {
  mkdirSync(dir, { recursive: true });
  const esc = (v: unknown) => {
    const s = v == null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const racesJson = census.races.map((r) => ({
    ...r,
    page: pages.get(r.id) ? { ...pages.get(r.id), html: undefined } : null,
    incumbent: census.incumbents.find((i) => i.race === r.id) ?? null,
    sentences: FIVE.includes(r.id) && pages.get(r.id)?.html
      ? { redistrict: sentences(pages.get(r.id)!.html!, /redistrict/i) }
      : undefined,
  }));
  writeFileSync(`${dir}/races-${label}.json`, JSON.stringify(racesJson, null, 1));
  const rh = ["id", "chamber", "pass", "fetchedAt", "verdict", "cause", "status", "specialPage", "generalCount", "ballotRows", "outsideGeneral", "rosterSource", "published", "agree", "nonAgree", "incumbentBucket", "underlinedNotStored"];
  writeFileSync(
    `${dir}/races-${label}.csv`,
    [rh.join(","), ...census.races.map((r) =>
      [r.id, r.chamber, pages.get(r.id)?.pass ?? "", pages.get(r.id)?.fetchedAt ?? "", r.verdict, r.cause, r.status, r.specialPage, r.generalCount, r.chosen?.rows.length ?? "", r.outsideGeneral, r.rosterSource, r.published.length,
        r.cands.filter((c) => c.cls === "agree").length, r.cands.filter((c) => c.cls !== "agree").length,
        census.incumbents.find((i) => i.race === r.id)?.bucket ?? "", r.underlinedNotStored.join("; ")].map(esc).join(","))].join("\n"),
  );
  const ch = ["race", "cls", "sub", "name", "status", "source", "route", "primaryRoute", "ballotName", "ballotHref", "ballotParty", "writeIn", "seenIn"];
  writeFileSync(
    `${dir}/candidates-${label}.csv`,
    [ch.join(","), ...census.races.flatMap((r) => r.cands).map((c) => ch.map((k) => esc(k === "seenIn" ? (c.seenIn ?? []).join("; ") : (c as Record<string, unknown>)[k])).join(","))].join("\n"),
  );
  const ih = ["race", "chamber", "state", "bioguide", "name", "title", "running", "bucket", "route", "where", "note"];
  writeFileSync(
    `${dir}/incumbents-${label}.csv`,
    [ih.join(","), ...census.incumbents.map((i) => ih.map((k) => esc(k === "where" ? i.where.join(";") : (i as Record<string, unknown>)[k])).join(","))].join("\n"),
  );
}

// ── controls ───────────────────────────────────────────────────────────────
// C3 and C4 run on a `file:` copy seeded from prod the way HO 745's control
// seeded its copy: only the tables the probe reads, the prod side read through
// the SELECT-only reader, and the copy's URL built as `file:${abs}` from a path
// that must end in -747-control.db. Every write in this section goes through
// `copyWrite`, which refuses any URL that is not `file:` and prints the scheme.
const COPY_DDL = [
  `CREATE TABLE races (id TEXT PRIMARY KEY, cycle INTEGER NOT NULL, chamber TEXT NOT NULL, state TEXT NOT NULL,
     district INTEGER, incumbent_bioguide_id TEXT, incumbent_running INTEGER)`,
  `CREATE TABLE race_candidates (race_id TEXT NOT NULL, name TEXT NOT NULL, party TEXT, bioguide_id TEXT,
     status TEXT, source_url TEXT, updated_at TEXT, PRIMARY KEY (race_id, name))`,
  `CREATE TABLE race_ratings (id TEXT PRIMARY KEY, race_id TEXT NOT NULL, source TEXT NOT NULL, rating TEXT NOT NULL, cycle INTEGER NOT NULL)`,
  `CREATE TABLE members (bioguide_id TEXT PRIMARY KEY, name TEXT, first_name TEXT, last_name TEXT, party TEXT)`,
  `CREATE TABLE member_ids (bioguide_id TEXT PRIMARY KEY, ballotpedia_title TEXT)`,
]; // migrate.ts shapes (:140, :158, :336, :101, :580), cut to the columns this file reads

type Seed = { table: string; cols: string[]; rows: Record<string, unknown>[] };
async function readSeed(prod: Reader): Promise<Seed[]> {
  const q = async (table: string, cols: string[], sql: string): Promise<Seed> => ({
    table,
    cols,
    rows: (await prod.one(sql, [CYCLE])).rows.map((r) => ({ ...r })),
  });
  const inc = `SELECT incumbent_bioguide_id FROM races WHERE cycle = ? AND incumbent_bioguide_id IS NOT NULL`;
  return [
    await q("races", ["id", "cycle", "chamber", "state", "district", "incumbent_bioguide_id", "incumbent_running"],
      `SELECT id, cycle, chamber, state, district, incumbent_bioguide_id, incumbent_running FROM races WHERE cycle = ?`),
    await q("race_candidates", ["race_id", "name", "party", "bioguide_id", "status", "source_url", "updated_at"],
      `SELECT rc.race_id, rc.name, rc.party, rc.bioguide_id, rc.status, rc.source_url, rc.updated_at
         FROM race_candidates rc JOIN races r ON r.id = rc.race_id WHERE r.cycle = ?`),
    await q("race_ratings", ["id", "race_id", "source", "rating", "cycle"],
      `SELECT id, race_id, source, rating, cycle FROM race_ratings WHERE cycle = ?`),
    await q("members", ["bioguide_id", "name", "first_name", "last_name", "party"],
      `SELECT bioguide_id, name, first_name, last_name, party FROM members WHERE bioguide_id IN (${inc})`),
    await q("member_ids", ["bioguide_id", "ballotpedia_title"],
      `SELECT bioguide_id, ballotpedia_title FROM member_ids WHERE bioguide_id IN (${inc})`),
  ];
}

async function copyWrite(url: string, stmts: { sql: string; args: InArgs }[], what: string) {
  const scheme = url.split(":")[0];
  if (scheme !== "file") throw new Error(`refused: control writes go to a file: database only (got scheme ${scheme}:)`);
  console.log(`    [${what}] writing to scheme ${scheme}: · ${stmts.length} statement(s)`);
  const c = createClient({ url });
  try {
    const out = await c.batch(stmts, "write");
    return out.map((r) => r.rowsAffected);
  } finally {
    c.close();
  }
}

async function seedCopy(filePath: string, seed: Seed[]): Promise<string> {
  const abs = path.resolve(filePath);
  if (!abs.endsWith("-747-control.db")) throw new Error(`refused: a control copy must be a *-747-control.db file (got ${abs})`);
  if (existsSync(abs)) rmSync(abs);
  const url = `file:${abs}`;
  await copyWrite(url, COPY_DDL.map((sql) => ({ sql, args: [] })), "ddl");
  for (const s of seed) {
    for (let i = 0; i < s.rows.length; i += 500) {
      await copyWrite(
        url,
        s.rows.slice(i, i + 500).map((r) => ({
          sql: `INSERT INTO ${s.table} (${s.cols.join(",")}) VALUES (${s.cols.map(() => "?").join(",")})`,
          args: s.cols.map((c) => (r[c] ?? null) as never),
        })),
        `seed ${s.table}`,
      );
    }
  }
  return url;
}

async function snapshotOf(url: string): Promise<Snapshot> {
  const c = createClient({ url });
  try {
    return await takeSnapshot(reader(c), url.split(":")[0]!);
  } finally {
    c.close();
  }
}

type Counts = Record<string, number>;
function raceCounts(r: RaceResult): Counts {
  const out: Counts = {};
  for (const c of r.cands) {
    const k = c.cls === "agree" ? "agree" : `${c.cls}/${c.sub ?? "-"}`;
    out[k] = (out[k] ?? 0) + 1;
    out[c.cls] = c.cls === "agree" ? out[c.cls]! : (out[c.cls] ?? 0) + 1;
  }
  return out;
}
function diffCounts(a: Counts, b: Counts): Counts {
  const out: Counts = {};
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const d = (b[k] ?? 0) - (a[k] ?? 0);
    if (d) out[k] = d;
  }
  return out;
}

async function runControls(
  prodRead: Reader,
  snap: Snapshot,
  pages: Map<string, PageReading>,
  io: IO,
  fetchMore: (ids: string[]) => Promise<void>,
): Promise<boolean> {
  let failures = 0;
  const check = (label: string, ok: boolean, detail: string) => {
    say(`  ${ok ? "PASS" : "FAIL"}  ${label}: ${detail}`);
    if (!ok) failures++;
  };
  say("\n══════════ CONTROLS (each read unperturbed, then perturbed; the delta is the reading) ══════════");

  // C1 — the selector, on AK-AL-2026's saved page (never a new fetch).
  const ak = pages.get("AK-AL-2026");
  const akRace = snap.races.find((r) => r.id === "AK-AL-2026")!;
  if (ak?.verdict !== "READ" || !ak.html) {
    check("C1 precondition", false, `AK-AL-2026 is ${ak?.verdict ?? "unfetched"}; C1 needs its saved READ page`);
    return false;
  }
  const html = ak.html;
  const m0 = readPageModel(html);
  const r0 = classifyRace(akRace, snap, ak, m0);
  say(`\n  C1 · the selector · AK-AL-2026 saved page ${ak.file}`);
  say(`    unperturbed: status ${r0.status} · general boxes ${m0.general.length} · outside-section general ${m0.outsideGeneral.length}`);
  const g = m0.general[0];
  if (!g) {
    check("C1 precondition", false, "no general box on the unperturbed page");
    return false;
  }
  const nextHead = m0.sectionBoxes.find((b) => b.offset > g.offset)?.offset ?? m0.section!.end;
  const deleted = html.slice(0, g.offset) + html.slice(nextHead);
  const mA = readPageModel(deleted);
  const rA = classifyRace(akRace, snap, { ...ak, html: deleted }, mA);
  say(`    perturbed (box deleted, ${nextHead - g.offset} bytes): status ${rA.status} · general boxes ${mA.general.length} · outside-section general ${mA.outsideGeneral.length}`);
  check("C1a deleting the box reads no-general-box", rA.status === "no-general-box", `${r0.status} → ${rA.status}`);
  check("C1a outside-section general count unchanged and > 0", mA.outsideGeneral.length === m0.outsideGeneral.length && mA.outsideGeneral.length > 0, `${m0.outsideGeneral.length} → ${mA.outsideGeneral.length}`);
  const h5re = /(<div class="race_header[^"]*">\s*<h5[^>]*>)([\s\S]*?)(<\/h5>)/;
  const at = html.slice(g.offset);
  const renamed = html.slice(0, g.offset) + at.replace(h5re, "$1Qwerty contest for U.S. House Alaska At-large District$3");
  const mB = readPageModel(renamed);
  const rB = classifyRace(akRace, snap, { ...ak, html: renamed }, mB);
  const unrecB = mB.sectionBoxes.filter((b) => b.kind === "unrecognized").map((b) => b.prefix);
  say(`    perturbed (<h5> renamed): status ${rB.status} · general boxes ${mB.general.length} · unrecognized prefixes ${JSON.stringify(unrecB)}`);
  check("C1b renaming the <h5> reads no-general-box", rB.status === "no-general-box", `${r0.status} → ${rB.status}`);
  check("C1b the markup census lists the unrecognized prefix", unrecB.includes("Qwerty contest"), JSON.stringify(unrecB));

  // C2 — the verdict, on stub responses.
  say("\n  C2 · the verdict · stub responses, no network");
  const stub = (fn: (url: string) => Raw): IO => ({ get: async (u) => fn(u), sleep: async () => {}, now: () => 0, record: () => null });
  const challenge = "<html><body>Checking your browser before accessing ballotpedia.org</body></html>";
  const houseRace = akRace;
  const senRace = snap.races.find((r) => r.id === "S-AK-2026")!;
  const p202 = await readRacePage(houseRace, stub(() => ({ kind: "response", status: 202, body: challenge })));
  const p404 = await readRacePage(houseRace, stub(() => ({ kind: "response", status: 404, body: "not found" })));
  const s404 = await readRacePage(senRace, stub(() => ({ kind: "response", status: 404, body: "not found" })));
  for (const [label, pg, race, want] of [
    ["202 without the anchor (House)", p202, houseRace, "UNREAD"],
    ["404 (House)", p404, houseRace, "NO_PAGE"],
    ["404 then 404 on the special URL (Senate)", s404, senRace, "NO_PAGE"],
  ] as const) {
    const r = classifyRace(race, snap, pg, null);
    say(`    ${label}: verdict ${pg.verdict} (${pg.cause}) · attempts ${pg.attempts.length} [${pg.attempts.map((a) => `${a.result}@${a.url.includes("special") ? "special" : "regular"}`).join(" ")}] · fallback ${pg.fallback} · race status ${r.status}`);
    check(`C2 ${label} reads ${want}, not no-general-box`, pg.verdict === want && r.status === want, `verdict ${pg.verdict}, status ${r.status}`);
  }
  check("C2 the 202 was retried to the attempt cap", p202.attempts.length === ATTEMPTS, `${p202.attempts.length} attempts`);
  check("C2 the House 404 was not retried", p404.attempts.length === 1, `${p404.attempts.length} attempt(s)`);
  check("C2 the Senate 404 fell back to the special URL", s404.fallback && s404.attempts.length === 2, `fallback ${s404.fallback}, ${s404.attempts.length} attempts`);

  // C3 / C4 — on file: copies.
  const seed = await readSeed(prodRead);
  say(`\n  seed read from prod (SELECT-only): ${seed.map((s) => `${s.table} ${s.rows.length}`).join(" · ")}`);
  const fset = snap.fset;

  // C3 — the comparison, both directions.
  const url3 = await seedCopy(`${ART}/general-box-c3-747-control.db`, seed);
  const snap3a = await snapshotOf(url3);
  const cen3a = classifyAll(snap3a, pages, fset);
  const target = cen3a.races.find((r) => r.status === "compared" && r.cands.some((c) => c.cls === "agree" && c.status && ["won_primary", "nominee", "advanced"].includes(c.status)));
  say(`\n  C3 · the comparison in both directions · copy ${url3}`);
  if (!target) {
    check("C3 precondition", false, "no falsification-set race carries an agreeing nominated row");
  } else {
    const victim = target.cands.find((c) => c.cls === "agree" && c.status && ["won_primary", "nominee", "advanced"].includes(c.status))!;
    say(`    race ${target.id}: delete "${victim.name}" (${victim.status}, on the ballot as "${victim.ballotName}"), insert "ZZ Control Candidate" won_primary ${HARVEST_SOURCE}`);
    const ra = await copyWrite(url3, [
      { sql: `DELETE FROM race_candidates WHERE race_id = ? AND name = ?`, args: [target.id, victim.name] },
      { sql: `INSERT INTO race_candidates (race_id, name, party, bioguide_id, status, source_url, updated_at) VALUES (?, 'ZZ Control Candidate', 'I', NULL, 'won_primary', ?, 'control')`, args: [target.id, HARVEST_SOURCE] },
    ], "C3 perturb");
    say(`    rowsAffected ${JSON.stringify(ra)}`);
    const snap3b = await snapshotOf(url3);
    const cen3b = classifyAll(snap3b, pages, fset);
    for (const id of fset) {
      const a = cen3a.races.find((r) => r.id === id)!;
      const b = cen3b.races.find((r) => r.id === id)!;
      const d = diffCounts(raceCounts(a), raceCounts(b));
      if (Object.keys(d).length || id === target.id) say(`    ${id}: unperturbed ${JSON.stringify(raceCounts(a))} · perturbed ${JSON.stringify(raceCounts(b))} · delta ${JSON.stringify(d)}`);
    }
    const tA = cen3a.races.find((r) => r.id === target.id)!;
    const tB = cen3b.races.find((r) => r.id === target.id)!;
    const d = diffCounts(raceCounts(tA), raceCounts(tB));
    check("C3 on-ballot-not-published +1", d["on-ballot-not-published"] === 1, JSON.stringify(d));
    check("C3 published-not-on-ballot +1", d["published-not-on-ballot"] === 1, JSON.stringify(d));
    const rest = Object.entries(d).filter(([k]) => !k.startsWith("on-ballot-not-published") && !k.startsWith("published-not-on-ballot") && k !== "agree");
    check("C3 nothing else moves on that race (agree −1 is the deleted row, a forced consequence)", rest.length === 0 && d["agree"] === -1, JSON.stringify(d));
    const others = fset.filter((id) => id !== target.id).filter((id) => {
      const a = cen3a.races.find((r) => r.id === id)!;
      const b = cen3b.races.find((r) => r.id === id)!;
      return JSON.stringify(a.cands) !== JSON.stringify(b.cands) || a.status !== b.status;
    });
    check("C3 nothing moves on any other falsification-set race", others.length === 0, others.join(",") || "none");
    const incMoved = cen3a.incumbents.filter((i) => cen3b.incumbents.find((j) => j.race === i.race)?.bucket !== i.bucket);
    check("C3 no incumbent bucket moves", incMoved.length === 0, incMoved.map((i) => i.race).join(",") || "none");
  }

  // C4 — the incumbent.
  const url4 = await seedCopy(`${ART}/general-box-c4-747-control.db`, seed);
  let snap4a = await snapshotOf(url4);
  let pool = fset.filter((id) => id.startsWith("CA-"));
  let cen4a = classifyAll(snap4a, pages, pool);
  const ownCA = () => cen4a.incumbents.filter((i) => i.bucket === "on-own-ballot" && i.race.startsWith("CA-")).map((i) => i.race);
  say(`\n  C4 · the incumbent · copy ${url4}`);
  say(`    CA falsification races whose incumbent reads on-own-ballot: ${ownCA().join(",") || "none"}`);
  const extra: string[] = [];
  while (ownCA().length < 2 && extra.length < 6) {
    const next = snap4a.races
      .filter((r) => r.state === "CA" && r.chamber === "house" && r.incumbent && !pool.includes(r.id))
      .map((r) => r.id)
      .slice(0, 2);
    if (!next.length) break;
    say(`    the set holds no such pair: fetching two more California districts for C4 (${next.join(", ")})`);
    await fetchMore(next.filter((id) => !pages.has(id)));
    extra.push(...next);
    pool = [...pool, ...next];
    cen4a = classifyAll(snap4a, pages, pool);
    say(`    now on-own-ballot: ${ownCA().join(",") || "none"}`);
  }
  const pair = ownCA().slice(0, 2);
  if (pair.length < 2) {
    check("C4 precondition", false, "no pair of CA races with both incumbents on-own-ballot");
  } else {
    const [first, second] = pair as [string, string];
    const inc2 = snap4a.races.find((r) => r.id === second)!.incumbent!;
    const inc1 = snap4a.races.find((r) => r.id === first)!.incumbent!;
    say(`    pair: ${first} (incumbent ${inc1} ${snap4a.people[inc1]?.name}) and ${second} (incumbent ${inc2} ${snap4a.people[inc2]?.name})`);
    const ra = await copyWrite(url4, [{ sql: `UPDATE races SET incumbent_bioguide_id = ? WHERE id = ?`, args: [inc2, first] }], "C4 perturb");
    say(`    rowsAffected ${JSON.stringify(ra)}`);
    snap4a = await snapshotOf(url4);
    const cen4b = classifyAll(snap4a, pages, pool);
    const a1 = cen4a.incumbents.find((i) => i.race === first)!;
    const b1 = cen4b.incumbents.find((i) => i.race === first)!;
    const b2 = cen4b.incumbents.find((i) => i.race === second)!;
    const ra1 = cen4a.races.find((r) => r.id === first)!;
    const rb1 = cen4b.races.find((r) => r.id === first)!;
    say(`    ${first}: unperturbed ${a1.bucket} → perturbed ${b1.bucket} ${b1.where.join(",")} · underlined-not-stored ${JSON.stringify(ra1.underlinedNotStored)} → ${JSON.stringify(rb1.underlinedNotStored)}`);
    say(`    ${first} class counts: ${JSON.stringify(raceCounts(ra1))} → ${JSON.stringify(raceCounts(rb1))} (the real incumbent is no longer removed from its ballot)`);
    say(`    ${second}: perturbed ${b2.bucket}`);
    check("C4 the first race moves to on-other-ballot naming the second", b1.bucket === "on-other-ballot" && b1.where.includes(second), `${a1.bucket} → ${b1.bucket} ${b1.where.join(",")}`);
    const ownName = ra1.incumbentRow?.name;
    check("C4 its own underlined row appears as underlined-not-stored-incumbent", !!ownName && ra1.underlinedNotStored.length === 0 && rb1.underlinedNotStored.includes(ownName), `${JSON.stringify(ra1.underlinedNotStored)} → ${JSON.stringify(rb1.underlinedNotStored)} (own row "${ownName}")`);
    check("C4 the second race is unmoved", b2.bucket === "on-own-ballot", b2.bucket);
  }
  say(`\nCONTROLS: ${failures === 0 ? "ALL HELD" : `${failures} FAILED — the instrument is wrong; stop`}`);
  return failures === 0;
}

// ── STEP 0: this HO's selector beside the 741 diagnostic's ─────────────────
// Copied from scripts/diagnostic/ak-general-box-741.ts (:46-55 strip, :57 Box,
// :59-79 voteboxes, :110 is2026General), because importing that file runs its
// fetch. Verbatim in behaviour; only the names carry a 741 suffix.
function strip741(s: string): string {
  return s
    .replace(/<[^>]+>/g, " ")
    .replace(/&#0?39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&#160;/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
type Box741 = { index: number; h5: string; kind: string; rows: string[]; winners: number; withdrawn: string | null };
function voteboxes741(html: string): Box741[] {
  const anchor = html.indexOf('id="Candidates_and_election_results"');
  if (anchor === -1) throw new Error("no Candidates_and_election_results section — Ballotpedia served a challenge or restructured");
  const seg = html.slice(anchor);
  const raw = [
    ...seg.matchAll(/<div class="(?:[^"]*\b)?votebox\b[^"]*"[\s\S]*?(?=<div class="(?:[^"]*\b)?votebox\b|$)/g),
  ].map((m) => m[0]);
  return raw.map((b, index) => {
    const wd = b.indexOf("Withdrawn or disqualified");
    return {
      index,
      h5: strip741((b.match(/<h5[^>]*>([\s\S]*?)<\/h5>/) ?? [null, ""])[1] ?? ""),
      kind: (b.match(/race_header\s+([a-z]+)/) ?? [null, "(bare)"])[1] ?? "(bare)",
      rows: [...b.matchAll(/<tr class="(results_row[^"]*)"[\s\S]*?<\/tr>/g)].map(
        (r) => `${/winner/.test(r[1] ?? "") ? "[WINNER] " : "[      ] "}${strip741(r[0])}`,
      ),
      winners: (b.match(/results_row[^"]*winner/g) ?? []).length,
      withdrawn: wd === -1 ? null : strip741(b.slice(wd, wd + 220)),
    };
  });
}
const is2026General741 = (b: Box741) => /^General election for U\.S\. House/i.test(b.h5) && b.winners === 0;

function selectorCheck(file: string): number {
  const html = gunzipSync(readFileSync(file)).toString("utf8");
  const m = readPageModel(html);
  say(`=== STEP 0 selector check · ${file} · ${Buffer.byteLength(html)} bytes · section ${m.section ? `${m.section.start}..${m.section.end}` : "ABSENT"} ===`);
  say("\nthis HO's selector (section = anchor to next <h2, split on race_header divs):");
  for (const b of m.sectionBoxes) {
    say(`  @${b.offset} <h5> "${b.h5}" · modifier ${b.cls} · rows ${b.rows.length} · marked ${b.marked} · withdrawn block ${b.withdrawn ? `YES (${b.withdrawn.entries.map((e) => e.name).join(", ")})` : "no"} · ${b.kind}${b.kind === "general" ? "  <== 2026 GENERAL" : ""}`);
  }
  say(`  outside the section, general boxes a page-wide selector would take: ${m.outsideGeneral.length} [${m.outsideGeneral.map((b) => `@${b.offset} "${b.prefix}" marked ${b.marked}`).join(" · ")}]`);
  say("\nthe 741 diagnostic's selector (voteboxes() :59-79, anchor to END of page, split on votebox divs; is2026General :110):");
  const v = voteboxes741(html);
  for (const b of v) say(`  [${b.index}] winners=${b.winners} rows=${b.rows.length} kind=${b.kind} h5="${b.h5}"${is2026General741(b) ? "  <== is2026General" : ""}`);
  const mine = m.general.map((b) => `${b.h5} | ${b.rows.map((r) => r.name).join(" · ")}`);
  const nameOf = (row: string) => row.replace(/^\[[ A-Z]+\]\s*/, "");
  const theirs = v.filter(is2026General741).map((b) => `${b.h5} | ${b.rows.map(nameOf).join(" ~ ")}`);
  say(`\n  this HO's 2026 general: ${JSON.stringify(mine)}`);
  say(`  741's is2026General:    ${JSON.stringify(theirs)}`);
  // Same box when the <h5> matches and every one of this HO's row names appears
  // in the 741 row text (741 keeps the whole stripped row, party suffix and all).
  const t = v.filter(is2026General741);
  const agree =
    m.general.length === 1 &&
    t.length === 1 &&
    t[0]!.h5 === m.general[0]!.h5 &&
    t[0]!.rows.length === m.general[0]!.rows.length &&
    m.general[0]!.rows.every((r, i) => (t[0]!.rows[i] ?? "").includes(r.name));
  const inSection = m.general.every((b) => m.section && b.offset >= m.section.start && b.offset < m.section.end);
  say(`\n  agree on which box is the 2026 general: ${agree ? "YES" : "NO"} · this HO's general box inside the section: ${inSection && m.general.length ? "YES" : "NO"}`);
  if (!agree || !inSection || !m.general.length) {
    say("  HALT: the two readings disagree, or the general box is not inside the section.");
    return 1;
  }
  return 0;
}

// ── the run ────────────────────────────────────────────────────────────────
async function newestCron(read: Reader): Promise<string> {
  const out: string[] = [];
  for (const route of CRON_ROUTES) {
    const rs = await read.one(`SELECT id, started_at, status FROM cron_runs WHERE route = ? ORDER BY id DESC LIMIT 1`, [route]);
    const r = rs.rows[0];
    out.push(r ? `${route} #${r.id} ${r.started_at} ${r.status}` : `${route} (none)`);
  }
  return out.join(" | ");
}

function loadPage(file: string | null): string | null {
  return file && existsSync(file) ? gunzipSync(readFileSync(file)).toString("utf8") : null;
}

async function census(onlyFset: boolean): Promise<number> {
  const t0 = Date.now();
  const tag = new Date().toISOString().replace(/[:.]/g, "-");
  const runDir = `${ART}/run-${tag}`;
  const pagesDir = `${ART}/pages/${tag}`;
  mkdirSync(runDir, { recursive: true });
  const prodUrl = process.env.TURSO_DATABASE_URL ?? "";
  if (!prodUrl.startsWith("libsql://")) throw new Error("TURSO_DATABASE_URL must be the prod libsql:// URL");
  const prod = createClient({ url: prodUrl, authToken: process.env.TURSO_AUTH_TOKEN });
  const read = reader(prod);
  say(`=== HO 747 general-box census · run ${tag} · database scheme libsql: (SELECT-only) · ${onlyFset ? "falsification set + controls only" : "full census"} ===`);
  const before = await newestCron(read);
  say(`cron_runs BEFORE the snapshot: ${before}`);
  const snap = await takeSnapshot(read, "libsql");
  writeFileSync(`${runDir}/snapshot-1.json`, JSON.stringify(snap, null, 1));
  say(`snapshot: ${snap.races.length} races · ${Object.values(snap.roster).reduce((a, x) => a + x.length, 0)} published rows · ${Object.keys(snap.people).length} incumbents · falsification set ${snap.fset.join(", ")}`);

  const io = liveIO(pagesDir, tag);
  const pages = new Map<string, PageReading>();
  const stats: ReadStats = { attempted: 0, requests: 0, retries: 0, bytes: 0, ms: 0, fallbacks: 0, stoppedAt: null, paused: false };
  let streak = 0;
  let stop = false;
  const fetchOne = async (id: string) => {
    const race = snap.races.find((r) => r.id === id);
    if (!race || pages.has(id) || stop) return;
    const pg = await readRacePage(race, io);
    pg.pass = 1;
    pg.fetchedAt = pg.attempts[pg.attempts.length - 1]?.at ?? null;
    pages.set(id, pg);
    stats.attempted++;
    stats.requests += pg.attempts.length;
    stats.retries += pg.attempts.filter((a) => a.attempt > 1).length;
    stats.bytes += pg.attempts.reduce((a, x) => a + x.bytes, 0);
    if (pg.fallback) stats.fallbacks++;
    console.log(`  ${String(stats.attempted).padStart(3)} ${id.padEnd(11)} ${pg.verdict}${pg.cause ? ` (${pg.cause})` : ""} · ${pg.attempts.map((a) => `${a.result}/${a.ms}ms`).join(" ")}`);
    if (pg.verdict === "UNREAD") {
      streak++;
      if (streak >= UNREAD_STREAK) {
        if (!stats.paused) {
          stats.paused = true;
          say(`  ${UNREAD_STREAK} UNREAD in a row at ${id}: pausing ${PAUSE_MS / 1000}s once`);
          await sleepReal(PAUSE_MS);
          streak = UNREAD_STREAK - 1; // the next UNREAD stops the run
        } else {
          stop = true;
          stats.stoppedAt = id;
          say(`  UNREAD again after the pause, at ${id}: STOPPING — partial census`);
        }
      }
    } else {
      streak = 0;
    }
  };

  say("\n── fetching the falsification set first");
  for (const id of snap.fset) await fetchOne(id);
  const ok = await runControls(read, snap, pages, io, async (ids) => {
    for (const id of ids) await fetchOne(id);
  });
  if (!ok) {
    writeFileSync(`${runDir}/report.txt`, lines.join("\n"));
    prod.close();
    return 1;
  }
  if (!onlyFset) {
    say("\n── fetching the rest of the census");
    for (const r of snap.races) await fetchOne(r.id);
  }
  stats.ms = Date.now() - t0;
  const manifest = [...pages.values()].map((p) => ({ ...p, html: undefined }));
  writeFileSync(`${runDir}/manifest.json`, JSON.stringify(manifest, null, 1));
  const after = await newestCron(read);
  say(`\ncron_runs AFTER the last fetch: ${after}${after === before ? " (unchanged)" : " — CHANGED: re-snapshotting and re-classifying from the saved pages"}`);
  const only = onlyFset ? [...pages.keys()] : undefined;
  const c1 = classifyAll(snap, pages, only);
  report("snapshot-1", snap, pages, c1, stats);
  writeArtifacts(runDir, "snapshot-1", c1, pages);
  if (after !== before) {
    const snap2 = await takeSnapshot(read, "libsql");
    writeFileSync(`${runDir}/snapshot-2.json`, JSON.stringify(snap2, null, 1));
    const c2 = classifyAll(snap2, pages, only);
    report("snapshot-2 (after the cron moved)", snap2, pages, c2, null);
    writeArtifacts(runDir, "snapshot-2", c2, pages);
  }
  say(`\nartifacts: ${runDir}/ · pages: ${pagesDir}/ · request log: ${ART}/requests.log`);
  writeFileSync(`${runDir}/report.txt`, lines.join("\n"));
  prod.close();
  return 0;
}

// ── pass 2: the architect's ruled completion (2026-09-25) ──────────────────
// Pass 1 stopped on the handoff's own stop rule at FL-05-2026 (93 attempted,
// 83 READ, 10 UNREAD on Ballotpedia's 202 JavaScript wall). The architect
// ruled a second pass, a DEVIATION from the handoff's stop rule, on these terms:
//   1. cool down >= 15 min after pass 1's last request, then refetch ONE page
//      pass 1 read (AK-AL-2026) as the control; UNREAD → wait 15 more and try
//      once more; still UNREAD → stop and report.
//   2. one request every 6 s, fixed; never faster.
//   3. no quick retries: an UNREAD page goes to the back of the queue and gets
//      one more try at the end of the pass.
//   4. five UNREAD in a row pauses the pass 15 min, once; the next UNREAD stops it.
//   5. order: the five seats' and the falsification set's unread pages; then
//      every unread page in DISPLAY_STALE_STATES plus TN; then the rest, in
//      census order.
//   6. no page pass 1 read is refetched (the control aside).
//   7. the wall's shape is recorded for both passes.
// Pass 1's 10 UNREAD stay UNREAD in pass 1's own reading; a page pass 2 reads
// carries pass 2's reading in the union, tagged as such.
const PASS2_GAP_MS = 6_000;
const PASS2_COOLDOWN_MS = 15 * 60_000;
const PASS2_PAUSE_MS = 15 * 60_000;

type QueueStep = { idx: number; reqIdx: number; id: string; retry: boolean; verdict: Verdict; cause: string | null; at: string | null };
type QueueResult = { pages: Map<string, PageReading>; steps: QueueStep[]; stoppedAt: string | null; pausedAt: string | null; deferred: string[] };

export async function runQueue(
  ids: string[],
  read: (id: string) => Promise<PageReading>,
  sleep: (ms: number) => Promise<void>,
  log: (s: string) => void,
): Promise<QueueResult> {
  const pages = new Map<string, PageReading>();
  const steps: QueueStep[] = [];
  const deferred: string[] = [];
  const state = { streak: 0, reqIdx: 0, pausedAt: null as string | null, stoppedAt: null as string | null };
  const step = async (id: string, retry: boolean) => {
    const pg = await read(id);
    pages.set(id, pg);
    const at = pg.attempts[pg.attempts.length - 1]?.at ?? null;
    steps.push({ idx: steps.length + 1, reqIdx: state.reqIdx + 1, id, retry, verdict: pg.verdict, cause: pg.cause, at });
    state.reqIdx += pg.attempts.length;
    log(`  ${String(steps.length).padStart(3)} ${retry ? "retry " : ""}${id.padEnd(11)} ${pg.verdict}${pg.cause ? ` (${pg.cause})` : ""} · ${pg.attempts.map((a) => `${a.result}@${a.at.slice(11, 19)}`).join(" ")}`);
    if (pg.verdict !== "UNREAD") {
      state.streak = 0;
      return;
    }
    if (!retry) deferred.push(id);
    state.streak++;
    if (state.streak < UNREAD_STREAK) return;
    if (!state.pausedAt) {
      state.pausedAt = id;
      log(`  ${UNREAD_STREAK} UNREAD in a row at ${id}: pausing ${PASS2_PAUSE_MS / 60_000} min, once`);
      await sleep(PASS2_PAUSE_MS);
      state.streak = UNREAD_STREAK - 1; // the next UNREAD stops the pass
    } else {
      state.stoppedAt = id;
      log(`  UNREAD again after the pause, at ${id}: STOPPING — partial union`);
    }
  };
  for (const id of ids) {
    if (state.stoppedAt) break;
    await step(id, false);
  }
  if (!state.stoppedAt && deferred.length) {
    log(`  end of queue: ${deferred.length} deferred page(s) get their one more try`);
    for (const id of [...deferred]) {
      if (state.stoppedAt) break;
      await step(id, true);
    }
  }
  return { pages, steps, stoppedAt: state.stoppedAt, pausedAt: state.pausedAt, deferred };
}

// The ruled rules 3 and 4, fired on stub responses before any network request.
async function pass2Controls(): Promise<boolean> {
  let failures = 0;
  const check = (label: string, ok: boolean, detail: string) => {
    say(`  ${ok ? "PASS" : "FAIL"}  ${label}: ${detail}`);
    if (!ok) failures++;
  };
  say("\n══════════ PASS-2 CONTROLS (stub responses, no network) ══════════");
  const good = `<html><h2><span ${ANCHOR}></span></h2></html>`;
  const run = async (script: number[][]) => {
    const races: RaceRow[] = script.map((_, i) => ({ id: `ZZ-${String(i + 1).padStart(2, "0")}-2026`, chamber: "house", state: "AK", district: i + 1, incumbent: null, running: null }));
    const byUrl = new Map(races.map((r, i) => [houseDistrictUrl("Alaska", r.district!), script[i]!] as const));
    const calls = new Map<string, number>();
    const io: IO = {
      get: async (u) => {
        const k = calls.get(u) ?? 0;
        calls.set(u, k + 1);
        const seq = byUrl.get(u)!;
        const st = seq[Math.min(k, seq.length - 1)]!;
        return { kind: "response", status: st, body: st === 200 ? good : "<html>challenge</html>" };
      },
      sleep: async () => {},
      now: () => 0,
      record: () => null,
    };
    const sleeps: number[] = [];
    const q = await runQueue(
      races.map((r) => r.id),
      (id) => readRacePage(races.find((r) => r.id === id)!, io, 1),
      async (ms) => {
        sleeps.push(ms);
      },
      () => {},
    );
    const order = q.steps.map((s) => `${s.id.slice(3, 5)}${s.retry ? "r" : ""}:${s.verdict}`).join(" ");
    return { q, sleeps, order, totalCalls: [...calls.values()].reduce((a, b) => a + b, 0) };
  };
  const a = await run([[202, 200], [404], [202, 202]]);
  say(`  A · requeue: ${a.order} · requests ${a.totalCalls} · pauses ${a.sleeps.length}`);
  check("A a 202 is one request, deferred to the back, and read on its one more try", a.order === "01:UNREAD 02:NO_PAGE 03:UNREAD 01r:READ 03r:UNREAD", a.order);
  check("A no quick retries: every step is one request", a.q.steps.length === a.totalCalls && a.totalCalls === 5, `${a.q.steps.length} steps, ${a.totalCalls} requests`);
  check("A a page refused twice ends UNREAD, never no-general-box", a.q.pages.get("ZZ-03-2026")?.verdict === "UNREAD", String(a.q.pages.get("ZZ-03-2026")?.verdict));
  const b = await run(Array.from({ length: 7 }, () => [202]));
  say(`  B · stop: ${b.order} · pauses ${JSON.stringify(b.sleeps)} · stopped at ${b.q.stoppedAt}`);
  check("B five UNREAD pause the pass 15 min once, and the next UNREAD stops it", b.sleeps.length === 1 && b.sleeps[0] === PASS2_PAUSE_MS && b.q.stoppedAt === "ZZ-06-2026", `pauses ${JSON.stringify(b.sleeps)}, stopped at ${b.q.stoppedAt}`);
  check("B nothing after the stop is fetched, retries included", b.totalCalls === 6 && !b.q.pages.has("ZZ-07-2026"), `${b.totalCalls} requests`);
  const c = await run([...Array.from({ length: 5 }, () => [202]), [200], ...Array.from({ length: 5 }, () => [202]), [200]]);
  say(`  C · once per pass: ${c.order} · pauses ${c.sleeps.length} · stopped at ${c.q.stoppedAt}`);
  check("C a read after the pause clears the streak, and a second streak stops the pass without a second pause", c.sleeps.length === 1 && c.q.stoppedAt === "ZZ-11-2026" && c.q.pages.get("ZZ-06-2026")?.verdict === "READ", `pauses ${c.sleeps.length}, stopped at ${c.q.stoppedAt}`);
  say(`PASS-2 CONTROLS: ${failures === 0 ? "ALL HELD" : `${failures} FAILED — stop`}`);
  return failures === 0;
}

function readRequestLog(tag: string): ReqLine[] {
  if (!existsSync(`${ART}/requests.log`)) return [];
  return readFileSync(`${ART}/requests.log`, "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((l) => l.split("\t"))
    .filter((f) => f[0] === tag)
    .map((f, i) => ({ idx: i + 1, at: f[1]!, race: f[2]!, status: f[5]! }));
}

async function pass2(p1Dir: string): Promise<number> {
  const p1Tag = path.basename(p1Dir).replace(/^run-/, "");
  const manifest1 = JSON.parse(readFileSync(`${p1Dir}/manifest.json`, "utf8")) as PageReading[];
  const p1Reqs = readRequestLog(p1Tag);
  if (!p1Reqs.length) throw new Error(`no requests.log lines for pass 1's tag ${p1Tag}`);
  const p1Report = readFileSync(`${p1Dir}/report.txt`, "utf8");
  const pages = new Map<string, PageReading>();
  for (const p of manifest1) {
    const last = [...p1Reqs].reverse().find((r) => r.race === p.raceId);
    pages.set(p.raceId, { ...p, pass: 1, fetchedAt: last?.at ?? null, html: p.verdict === "READ" ? loadPage(p.file) : null });
  }
  const missing = manifest1.filter((p) => p.verdict === "READ" && !pages.get(p.raceId)?.html);
  if (missing.length) throw new Error(`pass 1's saved pages missing for ${missing.map((p) => p.raceId).join(",")}`);
  // Everything this box sent Ballotpedia in the ten minutes before pass 1 began,
  // under other tags (the --only-fset run) and STEP 0's own fetch.
  const p1Start = Date.parse(p1Reqs[0]!.at);
  const prior = readFileSync(`${ART}/requests.log`, "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((l) => l.split("\t"))
    .filter((f) => f[0] !== p1Tag && Date.parse(f[1]!) < p1Start && Date.parse(f[1]!) >= p1Start - 10 * 60_000).length;
  const step0 = existsSync(`${ART}/step0-requests.log`)
    ? readFileSync(`${ART}/step0-requests.log`, "utf8").split(/\r?\n/).filter(Boolean).filter((l) => Date.parse(l.split("\t")[0]!) >= p1Start - 10 * 60_000).length
    : 0;
  const count = (v: Verdict) => manifest1.filter((p) => p.verdict === v).length;
  const p1: PassInfo = {
    label: `pass 1 (run ${p1Tag}, the handoff's rule: 1s pacing, 3 attempts at 2.5s)`,
    window: [p1Reqs[0]!.at, p1Reqs[p1Reqs.length - 1]!.at],
    attempted: manifest1.length,
    read: count("READ"),
    noPage: count("NO_PAGE"),
    unread: count("UNREAD"),
    requests: p1Reqs.length,
    retries: manifest1.reduce((a, p) => a + p.attempts.filter((x) => x.attempt > 1).length, 0),
    bytes: manifest1.reduce((a, p) => a + p.attempts.reduce((b, x) => b + x.bytes, 0), 0),
    stoppedAt: p1Report.match(/STOPPED at (\S+)/)?.[1] ?? null,
    pause: /pausing 60s once/.test(p1Report) ? "60s, used" : "60s, not used",
    streaks: streaksOf(p1Reqs),
    notes: [`requests from this box to Ballotpedia in the 10 min before pass 1's first: ${prior + step0} (the --only-fset run and STEP 0's fetch)`],
  };

  const tag = new Date().toISOString().replace(/[:.]/g, "-");
  const runDir = `${ART}/run-${tag}`;
  const pagesDir = `${ART}/pages/${tag}`;
  mkdirSync(runDir, { recursive: true });
  say(`=== HO 747 general-box census · PASS 2 (the architect's ruled completion, a deviation from the handoff's stop rule) · run ${tag} · pass 1 = ${p1Dir} ===`);
  for (const l of passLines(p1)) say(l);
  if (!(await pass2Controls())) {
    writeFileSync(`${runDir}/report.txt`, lines.join("\n"));
    return 1;
  }

  const prodUrl = process.env.TURSO_DATABASE_URL ?? "";
  if (!prodUrl.startsWith("libsql://")) throw new Error("TURSO_DATABASE_URL must be the prod libsql:// URL");
  const prod = createClient({ url: prodUrl, authToken: process.env.TURSO_AUTH_TOKEN });
  const read = reader(prod);
  const p1Before = p1Report.match(/cron_runs BEFORE the snapshot: (.*)/)?.[1] ?? "?";
  const before = await newestCron(read);
  say(`\ncron_runs before pass 1's snapshot: ${p1Before}`);
  say(`cron_runs before pass 2's snapshot: ${before}${before === p1Before ? " (unchanged)" : " — CHANGED since pass 1"}`);
  const snap = await takeSnapshot(read, "libsql");
  writeFileSync(`${runDir}/snapshot-1.json`, JSON.stringify(snap, null, 1));
  const snap1 = JSON.parse(readFileSync(`${p1Dir}/snapshot-1.json`, "utf8")) as Snapshot;
  const same = JSON.stringify(snap) === JSON.stringify(snap1);
  say(`snapshot against pass 1's: ${same ? "IDENTICAL" : "DIFFERENT"} (races ${snap.races.length}, published rows ${Object.values(snap.roster).reduce((a, x) => a + x.length, 0)}, incumbents ${Object.keys(snap.people).length})`);
  if (!same) {
    const moved = snap.races.filter((r) => JSON.stringify(snap.roster[r.id]) !== JSON.stringify(snap1.roster[r.id]) || JSON.stringify(r) !== JSON.stringify(snap1.races.find((x) => x.id === r.id)));
    say(`  races that differ: ${moved.map((r) => r.id).join(", ") || "(none; people or fset differ)"}`);
  }

  // 1. the cooldown, then the control
  const waitMs = Date.parse(p1Reqs[p1Reqs.length - 1]!.at) + PASS2_COOLDOWN_MS - Date.now();
  if (waitMs > 0) {
    say(`\ncooling down ${Math.ceil(waitMs / 1000)}s: pass 1's last request was ${p1Reqs[p1Reqs.length - 1]!.at}`);
    await sleepReal(waitMs);
  } else {
    say(`\ncooldown already met: pass 1's last request was ${p1Reqs[p1Reqs.length - 1]!.at}, ${Math.round(-waitMs / 1000) + PASS2_COOLDOWN_MS / 1000}s ago`);
  }
  const io = liveIO(pagesDir, tag, PASS2_GAP_MS);
  const akRace = snap.races.find((r) => r.id === "AK-AL-2026")!;
  const akNames = (h: string | null) => (h ? readPageModel(h).general.flatMap((b) => b.rows.map((r) => r.name)).join(" · ") : "-");
  let ctl = await readRacePage(akRace, io, 1);
  say(`control AK-AL-2026 (the only refetch): ${ctl.verdict}${ctl.cause ? ` (${ctl.cause})` : ""} at ${ctl.attempts[0]?.at}`);
  if (ctl.verdict === "UNREAD") {
    say(`  UNREAD: waiting ${PASS2_COOLDOWN_MS / 60_000} more minutes, then once more`);
    await sleepReal(PASS2_COOLDOWN_MS);
    ctl = await readRacePage(akRace, io, 1);
    say(`control AK-AL-2026, second try: ${ctl.verdict}${ctl.cause ? ` (${ctl.cause})` : ""} at ${ctl.attempts[0]?.at}`);
    if (ctl.verdict === "UNREAD") {
      say("  STILL UNREAD: pass 2 stops here and reports (the ruling's rule 1)");
      writeFileSync(`${runDir}/report.txt`, lines.join("\n"));
      prod.close();
      return 3;
    }
  }
  const p1Ak = akNames(pages.get("AK-AL-2026")?.html ?? null);
  const p2Ak = akNames(ctl.html);
  say(`  general box, pass 1: ${p1Ak}`);
  say(`  general box, now:    ${p2Ak} ${p1Ak === p2Ak ? "(same)" : "(DIFFERENT)"}`);

  // 5. the order
  const done = (id: string) => ["READ", "NO_PAGE"].includes(pages.get(id)?.verdict ?? "");
  const notRead = snap.races.map((r) => r.id).filter((id) => !done(id));
  const stale = new Set([...DISPLAY_STALE_STATES, "TN"]);
  const stateOf = (id: string) => snap.races.find((r) => r.id === id)!.state;
  const tier1 = notRead.filter((id) => FIVE.includes(id) || snap.fset.includes(id));
  const tier2 = notRead.filter((id) => !tier1.includes(id) && stale.has(stateOf(id)));
  const tier3 = notRead.filter((id) => !tier1.includes(id) && !tier2.includes(id));
  say(`\nqueue: ${notRead.length} pages not read by pass 1 · tier 1 (five seats + falsification set) ${tier1.length} [${tier1.join(", ")}] · tier 2 (${[...stale].join(",")}) ${tier2.length} · tier 3 (the rest, census order) ${tier3.length}`);
  say(`pacing: one request every ${PASS2_GAP_MS / 1000}s start to start, one attempt per URL, UNREAD requeued once at the end`);
  const q = await runQueue(
    [...tier1, ...tier2, ...tier3],
    async (id) => {
      const pg = await readRacePage(snap.races.find((r) => r.id === id)!, io, 1);
      pg.pass = 2;
      pg.fetchedAt = pg.attempts[pg.attempts.length - 1]?.at ?? null;
      return pg;
    },
    sleepReal,
    (s) => {
      console.log(s);
      if (/pausing|STOPPING|end of queue/.test(s)) lines.push(s);
    },
  );
  for (const [id, pg] of q.pages) pages.set(id, pg);

  const p2Reqs = readRequestLog(tag);
  const starts = readFileSync(`${ART}/requests.log`, "utf8")
    .split(/\r?\n/)
    .filter((l) => l.startsWith(`${tag}\t`))
    .map((l) => Date.parse(l.match(/\tstart (\S+)$/)?.[1] ?? ""))
    .filter((n) => Number.isFinite(n));
  const gaps = starts.slice(1).map((t, i) => t - starts[i]!);
  const p2Pages = [...q.pages.values()];
  const p2: PassInfo = {
    label: `pass 2 (run ${tag}, ruled: 6s start to start, 1 attempt, requeue once)`,
    window: [p2Reqs[0]?.at ?? "?", p2Reqs[p2Reqs.length - 1]?.at ?? "?"],
    attempted: q.pages.size,
    read: p2Pages.filter((p) => p.verdict === "READ").length,
    noPage: p2Pages.filter((p) => p.verdict === "NO_PAGE").length,
    unread: p2Pages.filter((p) => p.verdict === "UNREAD").length,
    requests: p2Reqs.length,
    retries: q.steps.filter((s) => s.retry).length,
    bytes: p2Pages.reduce((a, p) => a + p.attempts.reduce((b, x) => b + x.bytes, 0), 0) + ctl.attempts.reduce((b, x) => b + x.bytes, 0),
    stoppedAt: q.stoppedAt,
    pause: q.pausedAt ? `15 min, used at ${q.pausedAt}` : "15 min, not used",
    streaks: streaksOf(p2Reqs),
    notes: [
      `request #1${ctl.attempts.length > 1 ? `-${ctl.attempts.length}` : ""} is the AK-AL-2026 control, not a census page; retries above are end-of-queue second tries`,
      `pacing: minimum start-to-start gap ${gaps.length ? (Math.min(...gaps) / 1000).toFixed(2) : "-"}s over ${starts.length} requests (median ${gaps.length ? (median(gaps)! / 1000).toFixed(2) : "-"}s)`,
      `deferred to the back of the queue: ${q.deferred.length} [${q.deferred.join(", ")}]`,
    ],
  };
  const after = await newestCron(read);
  say(`\ncron_runs AFTER pass 2's last fetch: ${after}${after === p1Before ? " (unchanged since before pass 1)" : " — CHANGED: re-snapshotting and re-classifying from the saved pages"}`);
  writeFileSync(`${runDir}/manifest.json`, JSON.stringify([...q.pages.values()].map((p) => ({ ...p, html: undefined })), null, 1));
  writeFileSync(`${runDir}/manifest-union.json`, JSON.stringify([...pages.values()].map((p) => ({ ...p, html: undefined })), null, 1));
  const c = classifyAll(snap, pages);
  report("union of pass 1 and pass 2", snap, pages, c, null, [p1, p2]);
  writeArtifacts(runDir, "union", c, pages);
  if (after !== p1Before) {
    const snap2 = await takeSnapshot(read, "libsql");
    writeFileSync(`${runDir}/snapshot-2.json`, JSON.stringify(snap2, null, 1));
    const c2 = classifyAll(snap2, pages);
    report("union, re-snapshotted after the cron moved", snap2, pages, c2, null, [p1, p2]);
    writeArtifacts(runDir, "union-snapshot-2", c2, pages);
  }
  if (q.stoppedAt) say(`\nPASS 2 STOPPED at ${q.stoppedAt}: the union above is partial. No third pass without a ruling.`);
  say(`\nartifacts: ${runDir}/ · pages: ${pagesDir}/ · request log: ${ART}/requests.log`);
  writeFileSync(`${runDir}/report.txt`, lines.join("\n"));
  prod.close();
  return q.stoppedAt ? 4 : 0;
}

// C1-C4 re-fired against a finished run's saved pages, no network: the reading a
// changed classifier owes before its tables are trusted. C4's "fetch two more
// California districts" branch is refused here rather than taken.
async function controlsOnly(runDir: string): Promise<number> {
  const mfile = existsSync(`${runDir}/manifest-union.json`) ? `${runDir}/manifest-union.json` : `${runDir}/manifest.json`;
  const manifest = JSON.parse(readFileSync(mfile, "utf8")) as PageReading[];
  const pages = new Map<string, PageReading>();
  for (const p of manifest) pages.set(p.raceId, { ...p, html: p.verdict === "READ" ? loadPage(p.file) : null });
  const prod = createClient({ url: process.env.TURSO_DATABASE_URL!, authToken: process.env.TURSO_AUTH_TOKEN });
  const read = reader(prod);
  const snap = await takeSnapshot(read, "libsql");
  say(`=== HO 747 controls on saved pages · ${mfile} · no network ===`);
  const noNet: IO = { get: async () => ({ kind: "network", error: "no network in --controls" }), sleep: async () => {}, now: () => 0, record: () => null };
  const ok = await runControls(read, snap, pages, noNet, async (ids) => {
    throw new Error(`--controls refuses to fetch (${ids.join(",")}): C4 found no pair on the saved pages`);
  });
  writeFileSync(`${runDir}/controls-${new Date().toISOString().replace(/[:.]/g, "-")}.txt`, lines.join("\n"));
  prod.close();
  return ok ? 0 : 1;
}

async function reclassify(runDir: string): Promise<number> {
  const mfile = existsSync(`${runDir}/manifest-union.json`) ? `${runDir}/manifest-union.json` : `${runDir}/manifest.json`;
  const manifest = JSON.parse(readFileSync(mfile, "utf8")) as PageReading[];
  const pages = new Map<string, PageReading>();
  for (const p of manifest) pages.set(p.raceId, { ...p, html: p.verdict === "READ" ? loadPage(p.file) : null });
  const missing = manifest.filter((p) => p.verdict === "READ" && !pages.get(p.raceId)?.html);
  if (missing.length) throw new Error(`saved pages missing for ${missing.map((p) => p.raceId).join(",")}`);
  const prod = createClient({ url: process.env.TURSO_DATABASE_URL!, authToken: process.env.TURSO_AUTH_TOKEN });
  const read = reader(prod);
  const cron = await newestCron(read);
  const snap = await takeSnapshot(read, "libsql");
  const tag = new Date().toISOString().replace(/[:.]/g, "-");
  say(`=== HO 747 reclassify · ${runDir} · ${pages.size} saved readings · fresh snapshot ${tag} · cron_runs ${cron} ===`);
  const only = manifest.length < snap.races.length ? manifest.map((p) => p.raceId) : undefined;
  const c = classifyAll(snap, pages, only);
  report(`reclassify-${tag}`, snap, pages, c, null);
  writeArtifacts(runDir, `reclassify-${tag}`, c, pages);
  writeFileSync(`${runDir}/snapshot-reclassify-${tag}.json`, JSON.stringify(snap, null, 1));
  writeFileSync(`${runDir}/report-reclassify-${tag}.txt`, lines.join("\n"));
  prod.close();
  return 0;
}

const argAt = (flag: string) => {
  const i = process.argv.indexOf(flag);
  return i === -1 ? undefined : process.argv[i + 1];
};
const invoked = (process.argv[1] ?? "").replace(/\\/g, "/").endsWith("scripts/diagnostic/general-box-census-747.ts");
if (invoked) {
  void (async () => {
    const sc = argAt("--selector-check");
    const rc = argAt("--reclassify");
    const p2 = argAt("--pass2");
    const ctl = argAt("--controls");
    const code = sc
      ? selectorCheck(sc)
      : ctl
        ? await controlsOnly(ctl)
      : process.argv.includes("--pass2-controls")
        ? (await pass2Controls()) ? 0 : 1
      : p2
        ? await pass2(p2)
      : rc
        ? await reclassify(rc)
        : await census(process.argv.includes("--only-fset"));
    process.exit(code);
  })().catch((e) => {
    console.error(e);
    process.exit(2);
  });
}
