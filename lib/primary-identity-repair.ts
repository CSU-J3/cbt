// HO 764 — repair:primary-identity. Every stored primary_candidates row gets the
// person its page prints (person_key: the row's Ballotpedia link, hrefKey) and
// the bioguide the member match now assigns (lib/primaries-sync.ts
// loadMemberMatcher: identity first, the underlined row's surname second, else
// NULL). Until HO 764 the parser dropped the link and the matcher took a
// surname, so namesakes carried members' bioguides; the cron writes person_key
// from HO 764 on, but only on the rosters it rewrites, and a settled contest is
// never rewritten. This fills the rest from the pages.
//
// WHICH PAGE. One per race: a House district's, a Senate state's (a special's
// rows share their state's page, as SC's do). A row ties to the page's kept
// rows by (primary_id, name): its round (a `-runoff` id is the runoff box's) and
// its contest (D, R or open) on that page, and its name. A name the page gives
// two different links within one round and contest is not guessed: it is
// listed, and the row keeps what it had.
//
// THE PAGES. First HO 747's saved pages, read from disk (no fetch): the latest
// run's copy of each race that carries the candidates anchor. Then, unless the
// caller turns it off, the live page at the ballot reader's 6s start to start
// (lib/general-ballot.ts readRacePage) for every race the saved set lacks or
// left a row untied on; the first UNREAD page ends the live pass (the reader's
// rule), and the races after it are listed as not reached.
//
// THE MATCH. Every row is re-matched, tied or not: a tied row by its new
// person_key, an untied one (a row today's page no longer prints, e.g. an
// uncontested primary Florida cancelled) by its stored person_key if it has one,
// else by the surname rule alone. A saved page never replaces a stored key (the
// cron's, from a later live page); a live page does. Every bioguide that changes is printed, the
// old and the new member named.
//
// Read-only unless the caller passes write: true (the CLI's --write). The write
// is UPDATE by id, person_key and bioguide_id only: no status, no share, no
// roster, so a settled contest's results are untouched.
import type { Client } from "@libsql/client";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { readRacePage, type IO } from "./general-ballot";
import { CANDIDATES_ANCHOR, parseCandidatesPage } from "./primary-candidates-scrape";
import { loadMemberMatcher, matchStoredRow } from "./primaries-sync";

export const SAVED_PAGES_DIR = "docs/handoffs/747-artifacts/pages";

type Stored = {
  id: number;
  primaryId: string;
  name: string;
  incumbent: boolean;
  bioguideId: string | null;
  personKey: string | null;
  chamber: string;
  state: string;
  district: string | null;
  raceId: string;
  round: "primary" | "runoff";
  contest: string;
};
export type IdentityChange = {
  id: number;
  primaryId: string;
  name: string;
  oldKey: string | null;
  newKey: string | null;
  oldBioguide: string | null;
  newBioguide: string | null;
  oldMember: string | null;
  newMember: string | null;
};
export type IdentityRepairResult = {
  at: string;
  write: boolean;
  rows: number;
  races: number;
  tiedSaved: number;
  tiedLive: number;
  untied: string[]; // "primary_id \"name\" (why)"
  ambiguous: string[];
  livePages: { raceId: string; verdict: string; cause: string | null; url: string }[];
  stoppedAt: string | null;
  notReached: string[];
  keysFilled: number; // rows whose person_key the repair sets or changes
  keptStored: number; // rows that keep the person_key they carry (no page of this run re-keyed them)
  changes: IdentityChange[]; // every row whose person_key or bioguide changes
  bioguideChanges: IdentityChange[];
};

// The latest saved copy of each race's page that carries the candidates anchor
// (HO 747 saved a challenge page as `.1` on a run whose later run read the page).
export function savedPageIndex(dir: string): Map<string, string> {
  const out = new Map<string, string>();
  if (!existsSync(dir)) return out;
  const runs = readdirSync(dir).filter((d) => /^\d{4}-\d\d-\d\dT/.test(d)).sort().reverse();
  for (const run of runs) {
    for (const f of readdirSync(join(dir, run)).filter((f) => f.endsWith(".html.gz")).sort()) {
      const raceId = f.slice(0, f.indexOf("."));
      if (out.has(raceId)) continue;
      const file = join(dir, run, f);
      if (readSaved(file).includes(CANDIDATES_ANCHOR)) out.set(raceId, file);
    }
  }
  return out;
}
export const readSaved = (file: string) => gunzipSync(readFileSync(file)).toString("utf8");

// The page's kept rows, "round|contest|name" → the links printed for it.
function pageIndex(html: string, state: string, url: string): Map<string, Set<string | null>> {
  const parsed = parseCandidatesPage(html, state, url);
  const idx = new Map<string, Set<string | null>>();
  const add = (round: string, c: { contest: string; name: string; personKey: string | null }) => {
    const k = `${round}|${c.contest}|${c.name}`;
    (idx.get(k) ?? idx.set(k, new Set()).get(k)!).add(c.personKey);
  };
  for (const c of parsed.candidates) add("primary", c);
  for (const r of parsed.runoffs ?? []) for (const c of r.candidates) add("runoff", c);
  return idx;
}

export async function repairPrimaryIdentity(
  db: Client,
  opts: { write: boolean; savedDir?: string | null; io?: IO | null; log?: (line: string) => void },
): Promise<IdentityRepairResult> {
  const log = opts.log ?? (() => {});
  const at = new Date().toISOString();
  const rs = await db.execute(
    `SELECT pc.id, pc.primary_id, pc.name, pc.incumbent, pc.bioguide_id, pc.person_key, p.chamber, p.state, p.district
       FROM primary_candidates pc JOIN primaries p ON p.id = pc.primary_id
      ORDER BY pc.primary_id, pc.name, pc.id`,
  );
  const rows: Stored[] = rs.rows.map((r) => {
    const primaryId = String(r.primary_id);
    const chamber = String(r.chamber);
    const state = String(r.state);
    const district = r.district == null ? null : String(r.district);
    const runoff = primaryId.endsWith("-runoff");
    const base = runoff ? primaryId.slice(0, -"-runoff".length) : primaryId;
    return {
      id: Number(r.id),
      primaryId,
      name: String(r.name),
      incumbent: Number(r.incumbent ?? 0) === 1,
      bioguideId: (r.bioguide_id as string | null) ?? null,
      personKey: (r.person_key as string | null) ?? null,
      chamber,
      state,
      district,
      raceId: chamber === "senate" ? `S-${state}-2026` : `${state}-${district === "00" ? "AL" : district}-2026`,
      round: runoff ? "runoff" : "primary",
      contest: base.slice(base.lastIndexOf("-") + 1),
    };
  });
  const byRace = new Map<string, Stored[]>();
  for (const r of rows) (byRace.get(r.raceId) ?? byRace.set(r.raceId, []).get(r.raceId)!).push(r);

  const newKey = new Map<number, string>(); // row id → the key its page prints
  const ambiguous = new Set<string>();
  const ambiguousIds = new Set<number>();
  const read = new Set<string>(); // races whose page was read (saved, or live READ)
  // A saved page (2026-09-25) never replaces a key the row already carries: that
  // key is the cron's, read from a later live page. A live page does.
  const tie = (race: Stored[], idx: Map<string, Set<string | null>>, from: "saved" | "live"): number => {
    let n = 0;
    for (const r of race) {
      if (newKey.has(r.id) || (from === "saved" && r.personKey)) continue;
      const keys = idx.get(`${r.round}|${r.contest}|${r.name}`);
      if (!keys) continue;
      const real = [...keys].filter((k): k is string => !!k);
      if (real.length === 1 && keys.size === 1) {
        newKey.set(r.id, real[0]!);
        ambiguousIds.delete(r.id);
        n++;
      } else if (keys.size > 1) {
        ambiguous.add(`${r.primaryId} "${r.name}": ${[...keys].join(" | ")}`);
        ambiguousIds.add(r.id);
      }
    }
    return n;
  };
  const keyed = (r: Stored) => newKey.has(r.id) || !!r.personKey;

  // Phase 1: the saved pages.
  const saved = opts.savedDir ? savedPageIndex(opts.savedDir) : new Map<string, string>();
  let tiedSaved = 0;
  for (const [raceId, race] of byRace) {
    const file = saved.get(raceId);
    if (!file) continue;
    read.add(raceId);
    tiedSaved += tie(race, pageIndex(readSaved(file), race[0]!.state, `saved:${file}`), "saved");
  }
  log(`saved pages: ${saved.size} on disk · ${[...byRace.keys()].filter((k) => saved.has(k)).length} of ${byRace.size} races · ${tiedSaved} rows tied`);

  // Phase 2: live, for every race the saved set lacks or left a row untied on.
  let tiedLive = 0;
  const livePages: IdentityRepairResult["livePages"] = [];
  let stoppedAt: string | null = null;
  const notReached: string[] = [];
  if (opts.io) {
    for (const [raceId, race] of byRace) {
      if (saved.has(raceId) && race.every(keyed)) continue;
      if (stoppedAt) {
        notReached.push(raceId);
        continue;
      }
      const r0 = race[0]!;
      const page = await readRacePage(
        { id: raceId, chamber: r0.chamber, state: r0.state, district: r0.chamber === "senate" ? null : Number(r0.district ?? 0) },
        opts.io,
      );
      livePages.push({ raceId, verdict: page.verdict, cause: page.cause, url: page.url });
      if (page.verdict === "NO_PAGE") {
        log(`${raceId} · NO_PAGE ${page.url}`);
        continue;
      }
      if (page.verdict !== "READ" || !page.html) {
        stoppedAt = `${raceId} (${page.cause ?? "unread"}, ${page.url})`;
        log(`${raceId} · UNREAD ${page.cause} ${page.url} — the live pass stops here`);
        continue;
      }
      read.add(raceId);
      const n = tie(race, pageIndex(page.html, r0.state, page.url), "live");
      tiedLive += n;
      log(`${raceId} · READ · ${n} row${n === 1 ? "" : "s"} tied`);
    }
  }

  // The match, every row.
  const match = await loadMemberMatcher(db);
  const names = new Map(
    (await db.execute("SELECT bioguide_id, name FROM members")).rows.map((r) => [String(r.bioguide_id), String(r.name)]),
  );
  const untied: string[] = [];
  const changes: IdentityChange[] = [];
  for (const r of rows) {
    const key = newKey.get(r.id) ?? r.personKey;
    if (!keyed(r)) {
      const live = livePages.find((p) => p.raceId === r.raceId);
      const why = ambiguousIds.has(r.id)
        ? "the page links the name two ways"
        : read.has(r.raceId)
          ? "no such row on the page"
          : live?.verdict === "NO_PAGE"
            ? "no page (404)"
            : live
              ? `page UNREAD (${live.cause ?? "unread"})`
              : notReached.includes(r.raceId)
                ? "page not reached"
                : "no page read";
      untied.push(`${r.primaryId} "${r.name}" (${why})`);
    }
    const bioguide = matchStoredRow(match, { chamber: r.chamber, state: r.state, district: r.district, name: r.name, incumbent: r.incumbent, personKey: key });
    if (key === r.personKey && bioguide === r.bioguideId) continue;
    changes.push({
      id: r.id,
      primaryId: r.primaryId,
      name: r.name,
      oldKey: r.personKey,
      newKey: key,
      oldBioguide: r.bioguideId,
      newBioguide: bioguide,
      oldMember: r.bioguideId ? (names.get(r.bioguideId) ?? "?") : null,
      newMember: bioguide ? (names.get(bioguide) ?? "?") : null,
    });
  }

  if (opts.write && changes.length > 0) {
    for (let i = 0; i < changes.length; i += 200) {
      await db.batch(
        changes.slice(i, i + 200).map((c) => ({
          sql: "UPDATE primary_candidates SET person_key = ?, bioguide_id = ?, updated_at = ? WHERE id = ?",
          args: [c.newKey, c.newBioguide, at, c.id],
        })),
        "write",
      );
    }
  }
  return {
    at,
    write: opts.write,
    rows: rows.length,
    races: byRace.size,
    tiedSaved,
    tiedLive,
    untied,
    ambiguous: [...ambiguous],
    livePages,
    stoppedAt,
    notReached,
    keysFilled: changes.filter((c) => c.newKey !== c.oldKey).length,
    keptStored: rows.filter((r) => r.personKey && !newKey.has(r.id)).length,
    changes,
    bioguideChanges: changes.filter((c) => c.newBioguide !== c.oldBioguide),
  };
}
