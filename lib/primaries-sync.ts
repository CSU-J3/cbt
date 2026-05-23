// Primary tracker sync (handoffs 91-96) + cron orchestration (handoff 97).
//
// The sync logic lives here in lib/ — not in scripts/ — so two callers can
// share it: the `scripts/sync-primaries.ts` CLI (via runPrimariesCli) and the
// `/api/cron/primaries` Vercel cron route (via runPrimariesCronTick). Same
// split as lib/votes-sync.ts.
//
// CLI passes:
//   (default)          handoff 91 — state-level primary calendar (all 50
//                      states) + Senate candidate rosters.
//   --region=<region>  handoff 92/93/95/96 — House candidate rosters for one
//                      region (all four regions shipped).
//   --rematch          handoff 94 — re-run the House incumbent matcher over
//                      existing primary_candidates rows; no scraping.
//
// Cron (handoff 97, +93.5): the full corpus is ~470 scrape units (1 calendar
// + 34 Senate states + 435 House districts). At ~1.5-2s per unit — the
// Ballotpedia politeness sleep dominates — a whole region blows Vercel Hobby's
// 60s function ceiling (West alone measured 153s). So the cron does NOT scrape
// a region per tick. runPrimariesCronTick walks a persistent cursor (stored in
// dashboard_state), processing CRON_SLICE units per daily tick and refreshing
// the whole corpus every ~25 days.
import { getDb } from "./db";
import { scrapeStatePrimaryCalendar } from "./primary-calendar-scrape";
import {
  scrapeHouseCandidates,
  scrapeSenateCandidates,
} from "./primary-candidates-scrape";
import { stateName } from "./states";

// 2026 Senate states. WA was dropped from the handoff's SENATE_STATES_2026
// list — Washington has no 2026 Senate race (its seats are up 2028 / 2030).
// FL and OH are 2026 specials: scrapeSenateCandidates falls back to the
// special-election URL when the regular page 404s, and parseCandidatesPage
// is page-type-aware — on a special page the "Special D/R primary" voteboxes
// are the rosters to keep (HO 106). Before HO 106 the URL resolved but the
// parser's blanket "drop anything special" gate discarded those voteboxes,
// so FL/OH always returned no_candidates.
const SENATE_STATES_2026 = [
  "AL", "AK", "AR", "CO", "DE", "GA", "ID", "IL", "IA", "KS",
  "KY", "LA", "ME", "MA", "MI", "MN", "MS", "MT", "NE", "NH",
  "NJ", "NM", "NC", "OK", "OR", "RI", "SC", "SD", "TN", "TX",
  "VA", "WY",
  "FL", "OH",
];

// House districts by region (handoff 92). Phase 2 ships the Northeast — 76
// districts across 9 states; phase 3 (handoff 93) ships the South; phase 4
// (handoff 95) ships the Midwest; phase 5 (handoff 96) ships the West.
// `district: 0` is an at-large seat (Vermont in the Northeast, Delaware in the
// South, North Dakota and South Dakota in the Midwest, Alaska and Wyoming in
// the West).
export type HouseRegion = "northeast" | "south" | "midwest" | "west";

export type HouseDistrict = { state: string; district: number };

// Seat counts per Northeast state, expanded into one HouseDistrict per seat
// below. 9 states; the expanded list must total 76 (handoff 92 acceptance
// check) — if a scrape attempts any other count, this table is wrong.
const NORTHEAST_SEATS: Record<string, number> = {
  CT: 5, ME: 2, MA: 9, NH: 2, NJ: 12, NY: 26, PA: 17, RI: 2,
};

export const HOUSE_DISTRICTS_NORTHEAST_2026: HouseDistrict[] = [
  ...Object.entries(NORTHEAST_SEATS).flatMap(([state, seats]) =>
    Array.from({ length: seats }, (_, i) => ({ state, district: i + 1 })),
  ),
  { state: "VT", district: 0 }, // Vermont at-large
];

// Seat counts per South state (handoff 93, +93.5), expanded into one
// HouseDistrict per seat below. Louisiana joined in HO 93.5: every 2026 LA
// U.S. House district page on Ballotpedia renders a single "Nonpartisan
// primary election" all-candidate votebox (the HO 93.5 handoff expected
// closed partisan D/R — the published pages show otherwise), so LA is listed
// in NONPARTISAN_HOUSE_STATES below and parses through the "open" contest
// like CA/WA/AK. 15 numbered-district states here; with Delaware's at-large
// seat appended the expanded list must total 164.
const SOUTH_SEATS: Record<string, number> = {
  AL: 7, AR: 4, FL: 28, GA: 14, KY: 6, LA: 6, MD: 8, MS: 4, NC: 14,
  OK: 5, SC: 7, TN: 9, TX: 38, VA: 11, WV: 2,
};

export const HOUSE_DISTRICTS_SOUTH_2026: HouseDistrict[] = [
  ...Object.entries(SOUTH_SEATS).flatMap(([state, seats]) =>
    Array.from({ length: seats }, (_, i) => ({ state, district: i + 1 })),
  ),
  { state: "DE", district: 0 }, // Delaware at-large
];

// Seat counts per Midwest state (handoff 95). All 12 states run standard
// closed / semi-closed partisan primaries — no jungle, top-two or top-four —
// so no parser branch is needed. 10 numbered-district states here; with the
// North Dakota and South Dakota at-large seats appended the expanded list
// must total 91 (handoff 95 acceptance check).
const MIDWEST_SEATS: Record<string, number> = {
  IL: 17, IN: 9, IA: 4, KS: 4, MI: 13, MN: 8, MO: 8, NE: 3, OH: 15, WI: 8,
};

export const HOUSE_DISTRICTS_MIDWEST_2026: HouseDistrict[] = [
  ...Object.entries(MIDWEST_SEATS).flatMap(([state, seats]) =>
    Array.from({ length: seats }, (_, i) => ({ state, district: i + 1 })),
  ),
  { state: "ND", district: 0 }, // North Dakota at-large
  { state: "SD", district: 0 }, // South Dakota at-large
];

// Seat counts per West state (handoff 96), expanded into one HouseDistrict per
// seat below. 11 numbered-district states here; with the Alaska and Wyoming
// at-large seats appended the expanded list must total 104 (handoff 96
// acceptance check). California's 52 districts are the largest single-state
// load in the project.
const WEST_SEATS: Record<string, number> = {
  AZ: 9, CA: 52, CO: 8, HI: 2, ID: 2, MT: 2, NV: 4, NM: 3, OR: 6, UT: 4, WA: 10,
};

export const HOUSE_DISTRICTS_WEST_2026: HouseDistrict[] = [
  ...Object.entries(WEST_SEATS).flatMap(([state, seats]) =>
    Array.from({ length: seats }, (_, i) => ({ state, district: i + 1 })),
  ),
  { state: "AK", district: 0 }, // Alaska at-large
  { state: "WY", district: 0 }, // Wyoming at-large
];

// States whose U.S. House districts run a single nonpartisan all-candidate
// primary instead of partisan D/R primaries. parseCandidatesPage routes these
// into the "open" contest, and syncHouseDistricts stores one
// `house-{ST}-{DD}-2026-open` row per district:
//   CA, WA — top-two (top two advance regardless of party)
//   AK     — top-four (top four advance to a ranked-choice general)
//   LA     — nonpartisan all-candidate primary (HO 93.5). The handoff expected
//            closed partisan D/R, but every 2026 LA House page on Ballotpedia
//            renders one "Nonpartisan primary election" votebox; we store what
//            the source shows. If LA's pages later switch to D/R voteboxes,
//            the structural guard in syncHouseDistricts logs it ("D/R
//            candidate(s) on a nonpartisan-state page") — the signal to drop
//            LA from this set.
// Every other state runs ordinary partisan primaries.
const NONPARTISAN_HOUSE_STATES = new Set(["CA", "WA", "AK", "LA"]);

const HOUSE_DISTRICTS_BY_REGION: Record<HouseRegion, HouseDistrict[]> = {
  northeast: HOUSE_DISTRICTS_NORTHEAST_2026,
  south: HOUSE_DISTRICTS_SOUTH_2026,
  midwest: HOUSE_DISTRICTS_MIDWEST_2026,
  west: HOUSE_DISTRICTS_WEST_2026,
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Lowercase + strip diacritics, so "Velázquez" matches Ballotpedia's
// accent-free "Velazquez" (same NFD fold lib/lis-map.ts uses for senators).
function foldName(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

// Generational suffixes dropped before keying so "Frank Pallone Jr." keys on
// "pallone", not "jr".
const NAME_SUFFIXES = new Set(["jr", "sr", "ii", "iii", "iv"]);

// Last word of a candidate name, lowercased and suffix-stripped — the
// member-match key.
function lastNameKey(name: string): string {
  const parts = name
    .replace(/[.,]/g, "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  while (
    parts.length > 1 &&
    NAME_SUFFIXES.has(parts[parts.length - 1]!.toLowerCase())
  ) {
    parts.pop();
  }
  return (parts[parts.length - 1] ?? "").toLowerCase();
}

// First word of a candidate name, lowercased — used to disambiguate a shared
// surname in the redraw fallback below.
function firstNameKey(name: string): string {
  const parts = name
    .replace(/[.,]/g, "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  return (parts[0] ?? "").toLowerCase();
}

// A current House member, with names pre-folded for matching.
type HouseMember = {
  bioguideId: string;
  name: string; // display name, as stored in members.name
  foldedName: string; // full name, accent-folded
  foldedFirst: string; // first_name column, folded
  foldedLast: string; // last_name column, folded (may be multi-word)
};

// Loads current House members (is_current = 1) into two indexes: by
// "STATE-district" for the ordinary per-seat match, and by state for the
// HO 94 redraw fallback. `states` scopes the query; null loads every state.
async function loadHouseMembers(
  db: ReturnType<typeof getDb>,
  states: string[] | null,
): Promise<{
  incumbentByDistrict: Map<string, HouseMember>;
  currentHouseByState: Map<string, HouseMember[]>;
}> {
  const where =
    states && states.length > 0
      ? `AND state IN (${states.map(() => "?").join(", ")})`
      : "";
  const rows = await db.execute({
    sql: `SELECT bioguide_id, name, first_name, last_name, state, district
            FROM members
            WHERE chamber = 'house' AND is_current = 1 ${where}`,
    args: states ?? [],
  });
  const incumbentByDistrict = new Map<string, HouseMember>();
  const currentHouseByState = new Map<string, HouseMember[]>();
  for (const r of rows.rows) {
    const st = r.state as string | null;
    if (!st) continue;
    const name = ((r.name as string | null) ?? "").trim();
    const m: HouseMember = {
      bioguideId: r.bioguide_id as string,
      name,
      foldedName: foldName(name),
      foldedFirst: foldName(((r.first_name as string | null) ?? "").trim()),
      foldedLast: foldName(((r.last_name as string | null) ?? "").trim()),
    };
    const dist = (r.district as number | null) ?? 0;
    incumbentByDistrict.set(`${st}-${dist}`, m);
    const list = currentHouseByState.get(st) ?? [];
    list.push(m);
    currentHouseByState.set(st, list);
  }
  return { incumbentByDistrict, currentHouseByState };
}

// Incumbent match for one House primary candidate. Primary path: the
// candidate's last name appears in the sitting incumbent of their own
// district (the HO 92 behaviour). Fallback (HO 94): a candidate Ballotpedia
// flags as an incumbent who did NOT match their district's member — the
// mid-decade-redraw case, where primary_candidates is keyed to the 2026
// election map and `members` to the current 119th map. Such a candidate is
// matched by last name against the state's current House delegation, so the
// match survives any redraw. The fallback is gated on the incumbent flag so
// a same-surname challenger is never misattributed to a sitting member.
function matchHouseCandidate(
  candidateName: string,
  candidateIsIncumbent: boolean,
  state: string,
  district: number,
  incumbentByDistrict: Map<string, HouseMember>,
  currentHouseByState: Map<string, HouseMember[]>,
): string | null {
  const key = foldName(lastNameKey(candidateName));
  if (!key) return null;

  // Primary path — name contained in the district's incumbent.
  const inc = incumbentByDistrict.get(`${state}-${district}`);
  if (inc && inc.foldedName.includes(key)) return inc.bioguideId;

  // Fallback path — incumbent-flagged candidates only.
  if (!candidateIsIncumbent) return null;
  const pool = currentHouseByState.get(state) ?? [];
  const hits = pool.filter(
    (m) => m.foldedLast === key || m.foldedLast.endsWith(` ${key}`),
  );
  if (hits.length === 1) return hits[0]!.bioguideId;
  if (hits.length > 1) {
    // Shared surname — disambiguate on first name.
    const fkey = foldName(firstNameKey(candidateName));
    if (fkey) {
      const narrowed = hits.filter(
        (m) => m.foldedFirst === fkey || m.foldedFirst.startsWith(fkey),
      );
      if (narrowed.length === 1) return narrowed[0]!.bioguideId;
    }
  }
  return null;
}

export type CalendarSyncSummary = { states: number };

// Pulls the 270toWin calendar and upserts a D and an R primary row per state,
// plus an 'open' row for top-two / top-four states. Row id shape is
// "senate-{STATE}-2026-{party}" — the id prefix is a fixed convention from
// the handoff (the row carries the state's primary date, which applies to
// every contest that day regardless of chamber).
export async function syncCalendar(): Promise<CalendarSyncSummary> {
  const db = getDb();
  const calendar = await scrapeStatePrimaryCalendar();
  const now = new Date().toISOString();

  for (const entry of calendar) {
    for (const party of ["D", "R"] as const) {
      const id = `senate-${entry.state}-2026-${party}`;
      await db.execute({
        sql: `INSERT INTO primaries
                (id, state, chamber, party, primary_date, runoff_date, primary_type, updated_at)
              VALUES (?, ?, 'senate', ?, ?, ?, ?, ?)
              ON CONFLICT(id) DO UPDATE SET
                primary_date = excluded.primary_date,
                runoff_date = excluded.runoff_date,
                primary_type = excluded.primary_type,
                updated_at = excluded.updated_at`,
        args: [
          id,
          entry.state,
          party,
          entry.primaryDate,
          entry.runoffDate,
          entry.primaryType,
          now,
        ],
      });
    }

    // top-two / top-four states run a single all-candidate ballot — add an
    // 'open' row alongside the D/R rows.
    if (
      entry.primaryType === "top_two" ||
      entry.primaryType === "top_four"
    ) {
      const id = `senate-${entry.state}-2026-open`;
      await db.execute({
        sql: `INSERT INTO primaries
                (id, state, chamber, party, primary_date, runoff_date, primary_type, updated_at)
              VALUES (?, ?, 'senate', 'open', ?, ?, ?, ?)
              ON CONFLICT(id) DO UPDATE SET
                primary_date = excluded.primary_date,
                runoff_date = excluded.runoff_date,
                primary_type = excluded.primary_type,
                updated_at = excluded.updated_at`,
        args: [
          id,
          entry.state,
          entry.primaryDate,
          entry.runoffDate,
          entry.primaryType,
          now,
        ],
      });
    }
  }

  console.log(`Calendar synced: ${calendar.length} states`);
  return { states: calendar.length };
}

export type SenateSyncSummary = {
  okStates: number;
  totalStates: number;
  totalCandidates: number;
  matchedCandidates: number;
  failures: string[];
  // HO 120 additions: time-budget instrumentation. CLI passes neither
  // deadlineMs nor onProgress and reads these as the obvious values
  // (budgetStopped=false, fetchFailures=[], perStateMs populated).
  budgetStopped: boolean;
  fetchFailures: string[];
  perStateMs: number[];
};

// Step 3 — Senate candidate rosters. Scrapes each 2026 Senate state's
// Ballotpedia election page, parses the D/R primary voteboxes, and upserts
// the rosters into primary_candidates. Per-state delete-then-insert keeps
// re-runs idempotent (the table has no natural unique key). Candidates are
// best-effort matched to sitting senators by last name + state — challengers
// aren't members of Congress, so most rows resolve to a NULL bioguide_id.
//
// `states` defaults to the full 2026 Senate slate; the handoff-97 cron passes
// a slice (the full 34-state pass measured ~57s, past the 60s ceiling once
// the calendar scrape is added) so one tick stays well inside the budget.
//
// `opts.deadlineMs` is the absolute Date.now() at which the caller wants the
// loop to stop *starting* new states (HO 120). `opts.onProgress(i)` runs
// after each successful upsert with the slice-relative index just completed
// — the cron route uses it to commit the cursor per-state so a tick that
// gets killed mid-slice doesn't discard the states it already finished.
export async function syncSenateCandidates(
  states: string[] = SENATE_STATES_2026,
  opts: {
    deadlineMs?: number;
    onProgress?: (i: number) => Promise<void>;
  } = {},
): Promise<SenateSyncSummary> {
  const db = getDb();
  const now = new Date().toISOString();

  const memberRows = await db.execute(
    "SELECT bioguide_id, name, state FROM members WHERE chamber = 'senate'",
  );
  const senatorsByState = new Map<
    string,
    { bioguideId: string; name: string }[]
  >();
  for (const r of memberRows.rows) {
    const st = r.state as string | null;
    if (!st) continue;
    const list = senatorsByState.get(st) ?? [];
    list.push({
      bioguideId: r.bioguide_id as string,
      name: ((r.name as string | null) ?? "").toLowerCase(),
    });
    senatorsByState.set(st, list);
  }

  function matchMember(candidateName: string, state: string): string | null {
    const key = lastNameKey(candidateName);
    if (!key) return null;
    const hits = (senatorsByState.get(state) ?? []).filter((m) =>
      m.name.includes(key),
    );
    return hits.length === 1 ? hits[0]!.bioguideId : null;
  }

  let okStates = 0;
  let totalCandidates = 0;
  let matchedCandidates = 0;
  const failures: string[] = [];
  const fetchFailures: string[] = [];
  const perStateMs: number[] = [];
  const perState: string[] = [];
  let budgetStopped = false;

  for (let i = 0; i < states.length; i++) {
    if (opts.deadlineMs !== undefined && Date.now() >= opts.deadlineMs) {
      // HO 120: stop *starting* new states once we've crossed the budget.
      // The states we already processed have their cursor committed via
      // onProgress, so the next tick picks up cleanly from i.
      budgetStopped = true;
      break;
    }
    const abbr = states[i]!;
    const slug = stateName(abbr).replace(/ /g, "_");
    const stateStart = Date.now();
    const result = await scrapeSenateCandidates(abbr, slug);
    await sleep(700); // be polite to Ballotpedia between fetches

    if (result.status !== "ok") {
      // A `no_page` with httpStatus 0 is the HO 120 per-fetch timeout
      // surfacing — log it under fetchFailures so it shows up in
      // cron_runs.payload separately from genuine 404s / parse failures.
      if (result.status === "no_page" && result.httpStatus === 0) {
        fetchFailures.push(`${abbr} — fetch timeout`);
      } else {
        failures.push(`${abbr} — ${result.status}`);
      }
      perStateMs.push(Date.now() - stateStart);
      await opts.onProgress?.(i);
      continue;
    }
    okStates++;

    // Route each candidate to its primary by contest: the D / R partisan
    // primaries, or the "open" all-candidate primary (AK's top-four). The
    // 'open' primaries row only exists for top-two/four states, so the
    // DELETE/INSERT there is a no-op for ordinary D/R states.
    for (const contest of ["D", "R", "open"] as const) {
      const primaryId = `senate-${abbr}-2026-${contest}`;
      await db.execute({
        sql: "DELETE FROM primary_candidates WHERE primary_id = ?",
        args: [primaryId],
      });
      const roster = result.candidates.filter((c) => c.contest === contest);
      for (const c of roster) {
        const bioguideId = matchMember(c.name, abbr);
        if (bioguideId) matchedCandidates++;
        totalCandidates++;
        await db.execute({
          sql: `INSERT INTO primary_candidates
                  (primary_id, name, party, incumbent, bioguide_id, status, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)`,
          args: [
            primaryId,
            c.name,
            c.party,
            c.incumbent ? 1 : 0,
            bioguideId,
            c.isWinner ? "winner" : "running",
            now,
          ],
        });
      }
    }
    perState.push(`  ${abbr}: ${result.candidates.length} candidates`);
    perStateMs.push(Date.now() - stateStart);
    await opts.onProgress?.(i);
  }

  console.log("\n=== Senate candidate sync ===");
  if (perState.length > 0) console.log(perState.join("\n"));
  console.log(`\nStates scraped OK: ${okStates}/${states.length}`);
  console.log(
    `Candidates upserted: ${totalCandidates} ` +
      `(matched to a sitting senator: ${matchedCandidates})`,
  );
  if (failures.length > 0) {
    console.log(`Failed to parse (${failures.length}):`);
    for (const f of failures) console.log(`  ${f}`);
  } else {
    console.log("Failed to parse: none");
  }
  if (fetchFailures.length > 0) {
    console.log(`Fetch timeouts (${fetchFailures.length}):`);
    for (const f of fetchFailures) console.log(`  ${f}`);
  }
  if (budgetStopped) {
    console.log("Stopped early on time budget.");
  }

  return {
    okStates,
    totalStates: states.length,
    totalCandidates,
    matchedCandidates,
    failures,
    budgetStopped,
    fetchFailures,
    perStateMs,
  };
}

export type HouseSyncSummary = {
  label: string;
  attempted: number;
  parsedOk: number;
  totalCandidates: number;
  matchedIncumbents: number;
  totalIncumbents: number;
  // HO 120 additions: time-budget instrumentation, surfaced in cron_runs
  // payload. CLI callers pass neither deadlineMs nor onProgress and read
  // these as the obvious values (budgetStopped=false, fetchFailures=[],
  // perDistrictMs populated).
  budgetStopped: boolean;
  fetchFailures: string[];
  perDistrictMs: number[];
};

// Step 4 — House candidate rosters (handoff 92, +96). For each district in the
// supplied list, scrapes the Ballotpedia per-district election page, parses
// its primary voteboxes, and upserts both the `primaries` rows and their
// `primary_candidates` rosters. Partisan districts get one D + one R row;
// nonpartisan districts (CA/WA top-two, AK top-four — see
// NONPARTISAN_HOUSE_STATES) get a single `open` row instead. Per-district
// delete-then-insert on primary_candidates keeps re-runs idempotent.
//
// `label` only names the run in the printed report — it is "northeast" etc.
// for a full-region CLI pass, "cron-slice" for a handoff-97 cron tick.
//
// The per-district primary date is the state's primary date — the calendar
// rows seeded by syncCalendar (senate-{STATE}-2026-D) carry it, so this pass
// reads them rather than re-scraping 270toWin. Run the calendar pass first if
// those rows are missing. House special elections are out of scope: districts
// whose normal URL resolves to a special-election page are logged and skipped.
// `opts.deadlineMs` is the absolute Date.now() at which the caller wants the
// loop to stop *starting* new districts (HO 120). `opts.onProgress(i)` runs
// after each district (success or skip) with the slice-relative index just
// completed — the cron route uses it to commit the cursor per-district so a
// tick that gets killed mid-slice doesn't discard the districts it already
// finished. CLI callers (sync-primaries.ts) pass neither and the loop runs
// as it always has.
export async function syncHouseDistricts(
  districts: HouseDistrict[],
  label: string,
  opts: {
    deadlineMs?: number;
    onProgress?: (i: number) => Promise<void>;
  } = {},
): Promise<HouseSyncSummary> {
  const db = getDb();
  const now = new Date().toISOString();
  if (districts.length === 0) {
    console.log(`No House districts to sync for "${label}".`);
    return {
      label,
      attempted: 0,
      parsedOk: 0,
      totalCandidates: 0,
      matchedIncumbents: 0,
      totalIncumbents: 0,
      budgetStopped: false,
      fetchFailures: [],
      perDistrictMs: [],
    };
  }
  const states = [...new Set(districts.map((d) => d.state))];
  const statePlaceholders = states.map(() => "?").join(", ");

  // Current House incumbents in scope (HO 94: is_current = 1 only, so a
  // member who died or resigned mid-term is no longer a match target — and a
  // district whose member changed mid-term, e.g. TX-18 after the Turner→
  // Menefee special, resolves to the sitting member rather than colliding).
  // matchHouseCandidate handles the per-seat match and the redraw fallback.
  const { incumbentByDistrict, currentHouseByState } = await loadHouseMembers(
    db,
    states,
  );
  const totalIncumbents = incumbentByDistrict.size;
  const matchedIncumbents = new Set<string>();

  // State primary date / type, read from the calendar rows syncCalendar seeded.
  const calRows = await db.execute({
    sql: `SELECT state, primary_date, runoff_date, primary_type
            FROM primaries
            WHERE chamber = 'senate' AND party = 'D'
              AND state IN (${statePlaceholders})`,
    args: states,
  });
  const calByState = new Map<
    string,
    {
      primaryDate: string | null;
      runoffDate: string | null;
      primaryType: string | null;
    }
  >();
  for (const r of calRows.rows) {
    calByState.set(r.state as string, {
      primaryDate: (r.primary_date as string | null) ?? null,
      runoffDate: (r.runoff_date as string | null) ?? null,
      primaryType: (r.primary_type as string | null) ?? null,
    });
  }
  const missingCalendar = states.filter((s) => !calByState.has(s));
  if (missingCalendar.length > 0) {
    console.warn(
      `WARNING: no calendar rows for ${missingCalendar.join(", ")} — run ` +
        "the calendar pass first. House rows for those states will have a " +
        "null primary date.",
    );
  }

  let attempted = 0;
  let parsedOk = 0;
  let totalCandidates = 0;
  const urlMisses: string[] = []; // no_page — genuine URL miss
  const fetchFailures: string[] = []; // HO 120: no_page with httpStatus 0 = our 8s timeout fired
  const perDistrictMs: number[] = [];
  let budgetStopped = false;
  const emptyDistricts: string[] = []; // no_section / no_candidates — no filings
  const specials: string[] = [];
  const oddities: string[] = [];

  // Per-state parse tally — backs the per-state breakdown print, which is how
  // the CA / WA / AK sanity thresholds in handoff 96 get checked.
  const perState = new Map<
    string,
    { attempted: number; parsedOk: number; candidates: number }
  >();
  const stateStat = (st: string) => {
    let s = perState.get(st);
    if (!s) {
      s = { attempted: 0, parsedOk: 0, candidates: 0 };
      perState.set(st, s);
    }
    return s;
  };

  for (let i = 0; i < districts.length; i++) {
    if (opts.deadlineMs !== undefined && Date.now() >= opts.deadlineMs) {
      // HO 120: stop *starting* new districts once the route's 50s budget is
      // exhausted. Districts already processed are cursor-committed via
      // onProgress, so the next tick resumes from i without redoing them.
      budgetStopped = true;
      break;
    }
    const d = districts[i]!;
    const districtStart = Date.now();
    attempted++;
    const stat = stateStat(d.state);
    stat.attempted++;
    const dd = String(d.district).padStart(2, "0");
    const districtLabel = `${d.state}-${dd}`;
    const slug = stateName(d.state).replace(/ /g, "_");
    const result = await scrapeHouseCandidates(d.state, slug, d.district);
    await sleep(1000); // ~1 req/sec — be polite to Ballotpedia

    if (result.status === "special") {
      specials.push(
        `${districtLabel} — special election, skipped (${result.url})`,
      );
      perDistrictMs.push(Date.now() - districtStart);
      await opts.onProgress?.(i);
      continue;
    }
    if (result.status === "no_page") {
      if (result.httpStatus === 0) {
        // HO 120 per-fetch timeout — the URL hung past 8s, we abort and move
        // on. Don't permanently block the cursor on a single dead district.
        fetchFailures.push(`${districtLabel} — fetch timeout ${result.url}`);
      } else {
        urlMisses.push(
          `${districtLabel} — HTTP ${result.httpStatus ?? "ERR"} ${result.url}`,
        );
      }
      perDistrictMs.push(Date.now() - districtStart);
      await opts.onProgress?.(i);
      continue;
    }
    if (result.status === "ok") {
      parsedOk++;
      stat.parsedOk++;
    } else {
      // no_section / no_candidates: page reachable but no roster. Still create
      // empty primaries rows below so the district stays tracked.
      emptyDistricts.push(`${districtLabel} — ${result.status}`);
    }

    // Nonpartisan-primary states (CA/WA top-two, AK top-four) run a single
    // all-candidate ballot — parseCandidatesPage routes those into the "open"
    // contest. Everywhere else runs partisan D/R primaries. The contest set is
    // chosen once per district from NONPARTISAN_HOUSE_STATES; no state checks
    // anywhere else in the loop.
    const expectsOpen = NONPARTISAN_HOUSE_STATES.has(d.state);
    const openCount = result.candidates.filter(
      (c) => c.contest === "open",
    ).length;
    const drCount = result.candidates.length - openCount;
    // Structural guard: a votebox type that doesn't match the state's expected
    // primary system means the Ballotpedia template drifted for this district.
    // Such candidates fall outside the contest set below and are not stored.
    if (expectsOpen && drCount > 0) {
      oddities.push(
        `${districtLabel} — ${drCount} D/R candidate(s) on a ` +
          "nonpartisan-state page (not stored)",
      );
    }
    if (!expectsOpen && openCount > 0) {
      oddities.push(
        `${districtLabel} — ${openCount} nonpartisan candidate(s) on a ` +
          "partisan-state page (not stored)",
      );
    }
    const contests = expectsOpen
      ? (["open"] as const)
      : (["D", "R"] as const);

    const cal = calByState.get(d.state);
    for (const contest of contests) {
      const primaryId = `house-${d.state}-${dd}-2026-${contest}`;
      await db.execute({
        sql: `INSERT INTO primaries
                (id, state, district, chamber, party,
                 primary_date, runoff_date, primary_type, updated_at)
              VALUES (?, ?, ?, 'house', ?, ?, ?, ?, ?)
              ON CONFLICT(id) DO UPDATE SET
                primary_date = excluded.primary_date,
                runoff_date = excluded.runoff_date,
                primary_type = excluded.primary_type,
                updated_at = excluded.updated_at`,
        args: [
          primaryId,
          d.state,
          dd,
          contest,
          cal?.primaryDate ?? null,
          cal?.runoffDate ?? null,
          cal?.primaryType ?? null,
          now,
        ],
      });

      // Delete-then-insert keeps re-runs idempotent (no natural unique key).
      await db.execute({
        sql: "DELETE FROM primary_candidates WHERE primary_id = ?",
        args: [primaryId],
      });
      const roster = result.candidates.filter((c) => c.contest === contest);
      for (const c of roster) {
        const bioguideId = matchHouseCandidate(
          c.name,
          c.incumbent,
          d.state,
          d.district,
          incumbentByDistrict,
          currentHouseByState,
        );
        if (bioguideId) matchedIncumbents.add(bioguideId);
        if (c.incumbent && !bioguideId) {
          oddities.push(
            `${districtLabel} ${contest}: "${c.name}" flagged incumbent but ` +
              "no members-table match for the district",
          );
        }
        totalCandidates++;
        stat.candidates++;
        await db.execute({
          sql: `INSERT INTO primary_candidates
                  (primary_id, name, party, incumbent, bioguide_id, status, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)`,
          args: [
            primaryId,
            c.name,
            c.party,
            c.incumbent ? 1 : 0,
            bioguideId,
            c.isWinner ? "winner" : "running",
            now,
          ],
        });
      }
    }
    perDistrictMs.push(Date.now() - districtStart);
    await opts.onProgress?.(i);
  }

  const unmatchedIncumbents: string[] = [];
  for (const [key, inc] of incumbentByDistrict) {
    if (!matchedIncumbents.has(inc.bioguideId)) {
      unmatchedIncumbents.push(`${key} — ${inc.name} (${inc.bioguideId})`);
    }
  }

  console.log(`\n=== House candidate sync — ${label} ===`);
  console.log(`1. Districts attempted: ${attempted}`);
  console.log(`2. Districts parsed cleanly: ${parsedOk}/${attempted}`);
  console.log(
    `3. Districts with no candidates: ${urlMisses.length} URL miss, ` +
      `${emptyDistricts.length} no filings yet`,
  );
  console.log(`4. Total candidates parsed: ${totalCandidates}`);
  console.log(
    `5. Incumbent matches: ${matchedIncumbents.size}/${totalIncumbents} ` +
      `${label} House incumbents in the members table`,
  );

  if (urlMisses.length > 0) {
    console.log(`\nURL misses (${urlMisses.length}):`);
    for (const m of urlMisses) console.log(`  ${m}`);
  }
  if (fetchFailures.length > 0) {
    console.log(`\nFetch timeouts (${fetchFailures.length}):`);
    for (const f of fetchFailures) console.log(`  ${f}`);
  }
  if (budgetStopped) {
    console.log(
      `\nStopped early on time budget (${attempted}/${districts.length} ` +
        "districts attempted).",
    );
  }
  if (emptyDistricts.length > 0) {
    console.log(`\nNo filings yet (${emptyDistricts.length}):`);
    for (const e of emptyDistricts) console.log(`  ${e}`);
  }
  if (specials.length > 0) {
    console.log(`\nSpecial elections skipped (${specials.length}):`);
    for (const s of specials) console.log(`  ${s}`);
  }
  console.log(
    `\n6. Incumbents not found in the candidate scrape ` +
      `(${unmatchedIncumbents.length}) — review for retirement, primary ` +
      "challenge, redistricting, or scrape failure:",
  );
  if (unmatchedIncumbents.length > 0) {
    for (const u of unmatchedIncumbents) console.log(`  ${u}`);
  } else {
    console.log("  none");
  }
  console.log("\n7. Per-state breakdown (parsed / attempted · candidates):");
  for (const st of [...perState.keys()].sort()) {
    const s = perState.get(st)!;
    const np = NONPARTISAN_HOUSE_STATES.has(st) ? " [nonpartisan]" : "";
    console.log(
      `  ${st}: ${s.parsedOk}/${s.attempted} · ${s.candidates}${np}`,
    );
  }

  if (oddities.length > 0) {
    console.log(`\nOddities (${oddities.length}):`);
    for (const o of oddities) console.log(`  ${o}`);
  }

  return {
    label,
    attempted,
    parsedOk,
    totalCandidates,
    matchedIncumbents: matchedIncumbents.size,
    totalIncumbents,
    budgetStopped,
    fetchFailures,
    perDistrictMs,
  };
}

// Per-region House match rate after a re-match: of the current House
// incumbents from a region's states, how many are linked to at least one
// primary candidate. Mirrors the denominator HO 92/93 reported.
async function regionHouseMatchRate(
  db: ReturnType<typeof getDb>,
  states: string[],
): Promise<{ matched: number; total: number }> {
  const ph = states.map(() => "?").join(", ");
  const total = await db.execute({
    sql: `SELECT COUNT(*) AS n FROM members
            WHERE chamber = 'house' AND is_current = 1 AND state IN (${ph})`,
    args: states,
  });
  const matched = await db.execute({
    sql: `SELECT COUNT(DISTINCT m.bioguide_id) AS n FROM members m
            WHERE m.chamber = 'house' AND m.is_current = 1
              AND m.state IN (${ph})
              AND EXISTS (
                SELECT 1 FROM primary_candidates pc
                WHERE pc.bioguide_id = m.bioguide_id
                  AND pc.primary_id LIKE 'house-%'
              )`,
    args: states,
  });
  return {
    matched: Number(matched.rows[0]!.n),
    total: Number(total.rows[0]!.n),
  };
}

// Current House incumbents from a region's states who are not linked to any
// primary candidate — the residual after a re-match. Each is a retirement, an
// other-office run, or a candidacy Ballotpedia did not flag as incumbent.
async function unmatchedHouseIncumbents(
  db: ReturnType<typeof getDb>,
  states: string[],
): Promise<string[]> {
  const ph = states.map(() => "?").join(", ");
  const rows = await db.execute({
    sql: `SELECT bioguide_id, name, state, district FROM members m
            WHERE m.chamber = 'house' AND m.is_current = 1
              AND m.state IN (${ph})
              AND NOT EXISTS (
                SELECT 1 FROM primary_candidates pc
                WHERE pc.bioguide_id = m.bioguide_id
                  AND pc.primary_id LIKE 'house-%'
              )
            ORDER BY m.state, m.district`,
    args: states,
  });
  return rows.rows.map(
    (r) =>
      `${r.state as string}-${String(r.district ?? 0).padStart(2, "0")} ` +
      `${(r.name as string | null) ?? "?"} (${r.bioguide_id as string})`,
  );
}

const NE_STATES = ["CT", "ME", "MA", "NH", "NJ", "NY", "PA", "RI", "VT"];
// The 16 South-region states (HO 93 scraped 15; Louisiana joined in HO 93.5).
const SOUTH_STATES = [
  "AL", "AR", "DE", "FL", "GA", "KY", "LA", "MD", "MS",
  "NC", "OK", "SC", "TN", "TX", "VA", "WV",
];

// HO 94 — re-runs the House incumbent matcher over every existing
// primary_candidates row without re-scraping Ballotpedia. After a members
// refresh, the (state, district) primary path plus the new (state, last_name)
// fallback resolve incumbents the original scrape missed (mid-decade redraw,
// or the Turner/Menefee district collision). Updates bioguide_id in place.
// Run with `--rematch`.
export async function rematchHouseCandidates(): Promise<void> {
  const db = getDb();
  const now = new Date().toISOString();
  const { incumbentByDistrict, currentHouseByState } = await loadHouseMembers(
    db,
    null,
  );

  const rows = await db.execute(
    `SELECT id, primary_id, name, incumbent, bioguide_id
       FROM primary_candidates
       WHERE primary_id LIKE 'house-%'`,
  );

  let total = 0;
  let nowMatched = 0; // null -> matched
  let corrected = 0; // matched -> different match
  let lost = 0; // matched -> null
  const corrections: string[] = [];
  const lostRows: string[] = [];

  for (const r of rows.rows) {
    total++;
    // primary_id shape: house-{ST}-{DD}-2026-{contest}
    const parts = (r.primary_id as string).split("-");
    const state = parts[1] ?? "";
    const district = parseInt(parts[2] ?? "", 10);
    if (!state || Number.isNaN(district)) continue;
    const name = (r.name as string | null) ?? "";
    const isIncumbent = Number(r.incumbent ?? 0) === 1;
    const oldId = (r.bioguide_id as string | null) ?? null;
    const newId = matchHouseCandidate(
      name,
      isIncumbent,
      state,
      district,
      incumbentByDistrict,
      currentHouseByState,
    );
    if (newId === oldId) continue;
    await db.execute({
      sql: `UPDATE primary_candidates SET bioguide_id = ?, updated_at = ?
              WHERE id = ?`,
      args: [newId, now, r.id as number],
    });
    const label = `${r.primary_id as string} "${name}"`;
    if (oldId === null) {
      nowMatched++;
    } else if (newId !== null) {
      corrected++;
      corrections.push(`  ${label}: ${oldId} → ${newId}`);
    } else {
      lost++;
      lostRows.push(`  ${label}: ${oldId} → null`);
    }
  }

  const ne = await regionHouseMatchRate(db, NE_STATES);
  const south = await regionHouseMatchRate(db, SOUTH_STATES);

  console.log("\n=== House incumbent re-match — HO 94 ===");
  console.log(`House primary_candidates rows scanned: ${total}`);
  console.log(`Linkage changed: ${nowMatched + corrected + lost}`);
  console.log(`  null → matched:      ${nowMatched}`);
  console.log(`  matched → corrected: ${corrected}`);
  console.log(`  matched → null:      ${lost}`);
  if (corrections.length > 0) {
    console.log("\nCorrections:");
    for (const c of corrections) console.log(c);
  }
  if (lostRows.length > 0) {
    console.log("\nLost linkages (review):");
    for (const l of lostRows) console.log(l);
  }
  console.log("\nMatch rates (region House incumbents linked to a primary):");
  console.log(`  Northeast: ${ne.matched}/${ne.total}  (HO 92 baseline 66/76)`);
  console.log(
    `  South:     ${south.matched}/${south.total}  (HO 93 baseline 116/157)`,
  );
  console.log(
    `  Combined:  ${ne.matched + south.matched}/${ne.total + south.total}`,
  );

  const unmatched = await unmatchedHouseIncumbents(db, [
    ...NE_STATES,
    ...SOUTH_STATES,
  ]);
  console.log(
    `\nUnmatched current incumbents (${unmatched.length}) — retirement, ` +
      "other-office run, or candidacy not flagged incumbent on Ballotpedia:",
  );
  for (const u of unmatched) console.log(`  ${u}`);

  await runSpotChecks(db, ne, south);
}

// HO 94 acceptance spot-checks. Each prints PASS/FAIL. Bioguide ids are
// resolved by querying `members` rather than trusting the handoff's
// from-memory guesses.
async function runSpotChecks(
  db: ReturnType<typeof getDb>,
  ne: { matched: number; total: number },
  south: { matched: number; total: number },
): Promise<void> {
  console.log("\n=== Spot-checks ===");
  let pass = 0;
  let fail = 0;
  const check = (label: string, ok: boolean, detail: string): void => {
    console.log(`  ${ok ? "PASS" : "FAIL"} — ${label} — ${detail}`);
    if (ok) pass++;
    else fail++;
  };

  // Sylvester Turner soft-marked inactive.
  const turner = await db.execute(
    `SELECT bioguide_id, name, is_current FROM members
       WHERE state = 'TX' AND last_name = 'Turner'`,
  );
  const turnerRow = turner.rows.find((r) =>
    ((r.name as string | null) ?? "").toLowerCase().includes("sylvester"),
  );
  check(
    "Sylvester Turner is_current = false",
    !!turnerRow && Number(turnerRow.is_current) === 0,
    turnerRow
      ? `${turnerRow.bioguide_id} is_current=${turnerRow.is_current}`
      : "Sylvester Turner not found in members",
  );

  // Christian Menefee — present, current, TX-18.
  const menefee = await db.execute(
    `SELECT bioguide_id, state, district, chamber, is_current FROM members
       WHERE last_name = 'Menefee'`,
  );
  const mRow = menefee.rows[0];
  check(
    "Christian Menefee in members, is_current = true, TX-18",
    !!mRow &&
      mRow.state === "TX" &&
      Number(mRow.district) === 18 &&
      mRow.chamber === "house" &&
      Number(mRow.is_current) === 1,
    mRow
      ? `${mRow.bioguide_id} ${mRow.state}-${mRow.district} is_current=${mRow.is_current}`
      : "Menefee not found in members",
  );

  // Al Green's TX-18 primary candidate row links to a member sitting at TX-9
  // (the fallback bridging the 2026 map to the 119th map).
  const green = await db.execute(
    `SELECT pc.bioguide_id AS bid, m.state, m.district, m.name
       FROM primary_candidates pc
       LEFT JOIN members m ON m.bioguide_id = pc.bioguide_id
       WHERE pc.primary_id LIKE 'house-TX-18-2026-%'
         AND pc.name LIKE '%Green%'`,
  );
  const gRow = green.rows[0];
  check(
    "Al Green's TX-18 primary row links to a member at TX-9",
    !!gRow &&
      gRow.bid != null &&
      gRow.state === "TX" &&
      Number(gRow.district) === 9,
    gRow
      ? `linked ${gRow.bid} → ${gRow.name} ${gRow.state}-${gRow.district}`
      : "no TX-18 Green primary candidate row found",
  );

  // Northeast — no redraw, so the rate must not regress below the baseline.
  check(
    "Northeast match rate not regressed (>= 66)",
    ne.matched >= 66,
    `${ne.matched}/${ne.total}`,
  );

  // South — the redraw fallback must measurably lift the rate above HO 93.
  check(
    "South match rate improved above HO 93 baseline (> 116)",
    south.matched > 116,
    `${south.matched}/${south.total}`,
  );

  console.log(`\nSpot-checks: ${pass} PASS, ${fail} FAIL`);
  if (fail > 0) process.exitCode = 1;
}

// `--region=<name>` selects the House candidate pass; absent, the CLI runs
// the calendar + Senate pass (the handoff-91 default).
function parseRegionArg(argv: string[]): HouseRegion | null {
  const arg = argv.find((a) => a.startsWith("--region="));
  if (!arg) return null;
  const value = arg.slice("--region=".length).toLowerCase();
  if (value in HOUSE_DISTRICTS_BY_REGION) return value as HouseRegion;
  throw new Error(
    `unknown --region "${value}" — expected one of: ` +
      Object.keys(HOUSE_DISTRICTS_BY_REGION).join(", "),
  );
}

// CLI entry point — `scripts/sync-primaries.ts` is a thin wrapper around this.
export async function runPrimariesCli(argv: string[]): Promise<void> {
  // `--rematch` (HO 94): re-run the House incumbent matcher over existing
  // primary_candidates rows; no scraping.
  if (argv.includes("--rematch")) {
    await rematchHouseCandidates();
    return;
  }
  const region = parseRegionArg(argv);
  if (region) {
    await syncHouseDistricts(HOUSE_DISTRICTS_BY_REGION[region], region);
    return;
  }
  await syncCalendar();
  await syncSenateCandidates();
}

// ---- Cron orchestration (handoff 97) ------------------------------------

// A unit of scrape work the cursor steps through: the calendar pass, one
// Senate state, or one House district. Senate had to be sliceable too — the
// full 34-state pass plus the calendar measured 65s, past the 60s ceiling.
type ScrapeUnit =
  | { kind: "calendar" }
  | { kind: "senate"; state: string }
  | { kind: "house"; district: HouseDistrict };

// Region order the cursor walks. Stable — the cursor is an index into the
// list buildScrapeUnits produces, so reordering this (or the HOUSE_DISTRICTS_*
// / SENATE_STATES_2026 arrays) only shifts which unit a given tick refreshes,
// never correctness.
const CRON_REGION_ORDER: HouseRegion[] = [
  "northeast",
  "south",
  "midwest",
  "west",
];

// House districts processed per cron tick. Each unit costs ~1.5-2s local,
// ~2-3s prod after the cold-network tax noted in HO 97 — the 1000ms
// Ballotpedia politeness sleep dominates. HO 120 lowered this from 20 to 12
// after the pre-flight measure showed a 20-slice projected to ~67s prod
// (over the 60s ceiling); 12 lands a tick near ~46s, leaving margin for the
// deadline check + the per-fetch 8s timeout to do their work without
// orphaning the row.
const CRON_HOUSE_SLICE = 12;

// Senate states per cron tick. Senate is much smaller (34 states total) and
// sleeps 700ms not 1000ms, so the budget is looser. HO 120 keeps this at 20
// — it's a calendar-cycle knob, not a safety knob, because the per-state
// cursor commit makes a senate tick safe even if it spans two days.
const CRON_SENATE_SLICE = 20;

// HO 120 wall-clock deadline for the cron tick. The route owns the absolute
// Date.now() at start; this is the offset. 50s leaves ~10s of headroom under
// the 60s Vercel function ceiling for the deadline-triggered tail (cursor
// commit, finishCronRun, response serialization) to land cleanly.
const DEADLINE_MS = 50_000;

// dashboard_state key holding the cron cursor — the index into buildScrapeUnits
// of the next unit to process. dashboard_state is the project's existing
// key-value store (lib/queries.ts getDashboardLead reads 'weekly_lead' from
// it); no migration needed.
const CURSOR_KEY = "primaries_cron_cursor";

function buildScrapeUnits(): ScrapeUnit[] {
  const units: ScrapeUnit[] = [{ kind: "calendar" }];
  for (const state of SENATE_STATES_2026) {
    units.push({ kind: "senate", state });
  }
  for (const region of CRON_REGION_ORDER) {
    for (const district of HOUSE_DISTRICTS_BY_REGION[region]) {
      units.push({ kind: "house", district });
    }
  }
  return units;
}

async function readCursor(db: ReturnType<typeof getDb>): Promise<number> {
  const rs = await db.execute({
    sql: "SELECT value FROM dashboard_state WHERE key = ?",
    args: [CURSOR_KEY],
  });
  const raw = rs.rows[0]?.value as string | undefined;
  const n = raw ? parseInt(raw, 10) : 0;
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

async function writeCursor(
  db: ReturnType<typeof getDb>,
  index: number,
): Promise<void> {
  await db.execute({
    sql: `INSERT INTO dashboard_state (key, value, updated_at)
          VALUES (?, ?, ?)
          ON CONFLICT(key) DO UPDATE SET
            value = excluded.value,
            updated_at = excluded.updated_at`,
    args: [CURSOR_KEY, String(index), new Date().toISOString()],
  });
}

export type PrimariesCronResult = {
  unit: "calendar" | "senate" | "house";
  cursorStart: number;
  cursorEnd: number;
  totalUnits: number;
  calendarStates?: number;
  senate?: SenateSyncSummary;
  senateSlice?: { first: string; last: string; count: number };
  house?: {
    firstDistrict: string;
    lastDistrict: string;
    count: number;
    attempted: number;
    parsedOk: number;
    totalCandidates: number;
    matchedIncumbents: number;
  };
  // HO 120 instrumentation surfaced into cron_runs.payload. budgetStopped is
  // true when the route stopped *starting* new units before the slice ended;
  // fetchFailures lists per-unit 8s fetch-timeout abortions (separate from
  // genuine 404s, which land under the existing urlMisses bucket); the
  // perDistrictMs summary mirrors HO 117's per-feed timings for ad-hoc
  // capacity tuning without a full instrumentation pass.
  budgetStopped: boolean;
  fetchFailures: string[];
  perUnitMs?: { p50: number; p95: number; max: number; count: number };
};

// Computes the p50/p95/max summary surfaced in cron_runs.payload (HO 120).
// Returns undefined when no units were measured — the cron route then omits
// the perUnitMs key entirely rather than logging a synthetic "no data" row.
function summarizeMs(
  durations: number[],
): { p50: number; p95: number; max: number; count: number } | undefined {
  if (durations.length === 0) return undefined;
  const sorted = [...durations].sort((a, b) => a - b);
  const at = (q: number) =>
    sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))]!;
  return {
    p50: at(0.5),
    p95: at(0.95),
    max: sorted[sorted.length - 1]!,
    count: sorted.length,
  };
}

// One cron tick (handoff 97, refactored HO 120). Reads the cursor, processes
// one tick's worth of work — the calendar pass, up to CRON_SENATE_SLICE Senate
// states, or up to CRON_HOUSE_SLICE House districts — and wraps to the start
// at the end of the list. HO 120 changes the cursor-write timing: the cursor
// advances **per unit** as each state/district finishes, so a tick that runs
// out of budget mid-slice keeps the units it did finish. Combined with the
// 50s wall-clock deadline + 8s per-fetch AbortController in
// `lib/primary-candidates-scrape.ts`, this closes the implicit-timeout loop
// that left orphaned `cron_runs` rows (id=9, id=19 in the prod table — the
// canonical pre-HO-120 evidence).
//
// `routeStart` is the absolute Date.now() at route entry; the route owns it
// so the deadline reflects the full function lifetime, not just this entry
// point. CLI / tests can omit it and skip the deadline entirely.
export async function runPrimariesCronTick(
  routeStart: number = Date.now(),
): Promise<PrimariesCronResult> {
  const db = getDb();
  const units = buildScrapeUnits();
  let cursor = await readCursor(db);
  if (cursor >= units.length) cursor = 0;
  const cursorStart = cursor;
  const unit = units[cursor]!;
  const base = { cursorStart, totalUnits: units.length };
  const deadlineMs = routeStart + DEADLINE_MS;

  if (unit.kind === "calendar") {
    const calendar = await syncCalendar();
    cursor = (cursor + 1) % units.length;
    await writeCursor(db, cursor);
    return {
      unit: "calendar",
      ...base,
      cursorEnd: cursor,
      calendarStates: calendar.states,
      budgetStopped: false,
      fetchFailures: [],
    };
  }

  if (unit.kind === "senate") {
    // Take up to CRON_SENATE_SLICE consecutive Senate units from the cursor.
    const slice: string[] = [];
    let sliceEnd = cursor;
    while (slice.length < CRON_SENATE_SLICE && sliceEnd < units.length) {
      const u = units[sliceEnd]!;
      if (u.kind !== "senate") break;
      slice.push(u.state);
      sliceEnd++;
    }
    // Per-state cursor commit (HO 120). `i` is the slice-relative index of
    // the unit just finished, so the absolute cursor lands at cursor + i + 1.
    const senate = await syncSenateCandidates(slice, {
      deadlineMs,
      onProgress: async (i) => {
        const next = cursor + i + 1;
        await writeCursor(db, next >= units.length ? 0 : next);
      },
    });
    // Final cursor: wherever the per-state commits landed it. Re-read to be
    // sure (cheap one-row select; correctness > saving the read).
    cursor = await readCursor(db);
    return {
      unit: "senate",
      ...base,
      cursorEnd: cursor,
      senate,
      senateSlice: {
        first: slice[0]!,
        last: slice[slice.length - 1]!,
        count: slice.length,
      },
      budgetStopped: senate.budgetStopped,
      fetchFailures: senate.fetchFailures,
      perUnitMs: summarizeMs(senate.perStateMs),
    };
  }

  // House: take up to CRON_HOUSE_SLICE consecutive House districts from the
  // cursor. Stop at the end of the unit list rather than wrapping mid-slice.
  const slice: HouseDistrict[] = [];
  let sliceEnd = cursor;
  while (slice.length < CRON_HOUSE_SLICE && sliceEnd < units.length) {
    const u = units[sliceEnd]!;
    if (u.kind !== "house") break;
    slice.push(u.district);
    sliceEnd++;
  }
  const summary = await syncHouseDistricts(slice, "cron-slice", {
    deadlineMs,
    onProgress: async (i) => {
      const next = cursor + i + 1;
      await writeCursor(db, next >= units.length ? 0 : next);
    },
  });
  cursor = await readCursor(db);

  const fmt = (d: HouseDistrict) =>
    `${d.state}-${String(d.district).padStart(2, "0")}`;
  return {
    unit: "house",
    ...base,
    cursorEnd: cursor,
    house: {
      firstDistrict: fmt(slice[0]!),
      lastDistrict: fmt(slice[slice.length - 1]!),
      count: slice.length,
      attempted: summary.attempted,
      parsedOk: summary.parsedOk,
      totalCandidates: summary.totalCandidates,
      matchedIncumbents: summary.matchedIncumbents,
    },
    budgetStopped: summary.budgetStopped,
    fetchFailures: summary.fetchFailures,
    perUnitMs: summarizeMs(summary.perDistrictMs),
  };
}
