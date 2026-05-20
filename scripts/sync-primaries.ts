// Primary tracker sync. Passes selected by argv:
//   (default)          handoff 91 — state-level primary calendar (all 50
//                      states) + Senate candidate rosters (33 races).
//   --region=<region>  handoff 92 — House candidate rosters for one region
//                      (northeast + south shipped; midwest/west are stubs).
//   --rematch          handoff 94 — re-run the House incumbent matcher over
//                      existing primary_candidates rows; no scraping.
// `npm run sync:primaries` runs the default pass; `npm run sync:house-primaries
// -- --region=northeast` runs the House pass; `npm run sync:rematch` re-runs
// the matcher.
import "dotenv/config";
import { getDb } from "../lib/db";
import { scrapeStatePrimaryCalendar } from "../lib/primary-calendar-scrape";
import {
  scrapeHouseCandidates,
  scrapeSenateCandidates,
} from "../lib/primary-candidates-scrape";
import { stateName } from "../lib/states";

// 2026 Senate states. WA was dropped from the handoff's SENATE_STATES_2026
// list — Washington has no 2026 Senate race (its seats are up 2028 / 2030).
// FL and OH are 2026 specials; the scraper resolves their special-election
// URL automatically.
const SENATE_STATES_2026 = [
  "AL", "AK", "AR", "CO", "DE", "GA", "ID", "IL", "IA", "KS",
  "KY", "LA", "ME", "MA", "MI", "MN", "MS", "MT", "NE", "NH",
  "NJ", "NM", "NC", "OK", "OR", "RI", "SC", "SD", "TN", "TX",
  "VA", "WY",
  "FL", "OH",
];

// House districts by region (handoff 92). Phase 2 ships the Northeast — 76
// districts across 9 states; phase 3 (handoff 93) ships the South; Midwest /
// West follow in handoffs 94-95. `district: 0` is an at-large seat (Vermont
// in the Northeast, Delaware in the South).
type HouseRegion = "northeast" | "south" | "midwest" | "west";

type HouseDistrict = { state: string; district: number };

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

// Seat counts per South state (handoff 93), expanded into one HouseDistrict
// per seat below. Louisiana is intentionally absent: LA's 2026 U.S. House
// races run as a single nonpartisan majority-vote ("jungle") primary — one
// all-candidate ballot with no D/R sections — which parseCandidatesPage does
// not handle. LA-1..LA-6 are deferred to a follow-up (HO 93.5); the LA-1 page
// (.../Louisiana%27s_1st_Congressional_District_election,_2026) was checked
// manually and its voteboxes are all "Nonpartisan primary election". 14
// numbered-district states here; with Delaware's at-large seat appended the
// expanded list must total 158 (handoff 93 acceptance check, LA-deferred case).
const SOUTH_SEATS: Record<string, number> = {
  AL: 7, AR: 4, FL: 28, GA: 14, KY: 6, MD: 8, MS: 4, NC: 14,
  OK: 5, SC: 7, TN: 9, TX: 38, VA: 11, WV: 2,
};

export const HOUSE_DISTRICTS_SOUTH_2026: HouseDistrict[] = [
  ...Object.entries(SOUTH_SEATS).flatMap(([state, seats]) =>
    Array.from({ length: seats }, (_, i) => ({ state, district: i + 1 })),
  ),
  { state: "DE", district: 0 }, // Delaware at-large
];

const HOUSE_DISTRICTS_BY_REGION: Record<HouseRegion, HouseDistrict[]> = {
  northeast: HOUSE_DISTRICTS_NORTHEAST_2026,
  south: HOUSE_DISTRICTS_SOUTH_2026,
  midwest: [],
  west: [],
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

// Pulls the 270toWin calendar and upserts a D and an R primary row per state,
// plus an 'open' row for top-two / top-four states. Row id shape is
// "senate-{STATE}-2026-{party}" — the id prefix is a fixed convention from
// the handoff (the row carries the state's primary date, which applies to
// every contest that day regardless of chamber).
async function syncCalendar(): Promise<void> {
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
}

// Step 3 — Senate candidate rosters. Scrapes each 2026 Senate state's
// Ballotpedia election page, parses the D/R primary voteboxes, and upserts
// the rosters into primary_candidates. Per-state delete-then-insert keeps
// re-runs idempotent (the table has no natural unique key). Candidates are
// best-effort matched to sitting senators by last name + state — challengers
// aren't members of Congress, so most rows resolve to a NULL bioguide_id.
async function syncSenateCandidates(): Promise<void> {
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
  const perState: string[] = [];

  for (const abbr of SENATE_STATES_2026) {
    const slug = stateName(abbr).replace(/ /g, "_");
    const result = await scrapeSenateCandidates(abbr, slug);
    await sleep(700); // be polite to Ballotpedia between fetches

    if (result.status !== "ok") {
      failures.push(`${abbr} — ${result.status}`);
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
  }

  console.log("\n=== Senate candidate sync ===");
  if (perState.length > 0) console.log(perState.join("\n"));
  console.log(
    `\nStates scraped OK: ${okStates}/${SENATE_STATES_2026.length}`,
  );
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
}

// Step 4 — House candidate rosters (handoff 92). For each district in the
// region, scrapes the Ballotpedia per-district election page, parses the D/R
// primary voteboxes, and upserts both the `primaries` rows (one D + one R per
// district) and their `primary_candidates` rosters. Per-district
// delete-then-insert on primary_candidates keeps re-runs idempotent.
//
// The per-district primary date is the state's primary date — the calendar
// rows seeded by syncCalendar (senate-{STATE}-2026-D) carry it, so this pass
// reads them rather than re-scraping 270toWin. Run `npm run sync:primaries`
// first if those rows are missing. House special elections are out of scope:
// districts whose normal URL resolves to a special-election page are logged
// and skipped.
async function syncHouseCandidates(region: HouseRegion): Promise<void> {
  const db = getDb();
  const now = new Date().toISOString();
  const districts = HOUSE_DISTRICTS_BY_REGION[region];
  if (districts.length === 0) {
    console.log(`No House districts defined for region "${region}" yet.`);
    return;
  }
  const states = [...new Set(districts.map((d) => d.state))];
  const statePlaceholders = states.map(() => "?").join(", ");

  // Current House incumbents in scope (HO 94: is_current = 1 only, so a
  // member who died or resigned mid-term is no longer a match target — and a
  // district whose member changed mid-term, e.g. TX-18 after the Turner→
  // Menefee special, resolves to the sitting member rather than colliding).
  // matchHouseCandidate (module scope) handles the per-seat match and the
  // mid-decade-redraw fallback.
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
        "`npm run sync:primaries` first. House rows for those states will " +
        "have a null primary date.",
    );
  }

  let attempted = 0;
  let parsedOk = 0;
  let totalCandidates = 0;
  const urlMisses: string[] = []; // no_page — genuine URL miss
  const emptyDistricts: string[] = []; // no_section / no_candidates — no filings
  const specials: string[] = [];
  const oddities: string[] = [];

  for (const d of districts) {
    attempted++;
    const dd = String(d.district).padStart(2, "0");
    const label = `${d.state}-${dd}`;
    const slug = stateName(d.state).replace(/ /g, "_");
    const result = await scrapeHouseCandidates(d.state, slug, d.district);
    await sleep(1000); // ~1 req/sec — be polite to Ballotpedia

    if (result.status === "special") {
      specials.push(`${label} — special election, skipped (${result.url})`);
      continue;
    }
    if (result.status === "no_page") {
      urlMisses.push(
        `${label} — HTTP ${result.httpStatus ?? "ERR"} ${result.url}`,
      );
      continue;
    }
    if (result.status === "ok") {
      parsedOk++;
    } else {
      // no_section / no_candidates: page reachable but no roster. Still create
      // empty D/R primaries rows below so the district stays tracked.
      emptyDistricts.push(`${label} — ${result.status}`);
    }

    const openCount = result.candidates.filter(
      (c) => c.contest === "open",
    ).length;
    if (openCount > 0) {
      oddities.push(
        `${label} — ${openCount} candidate(s) in a nonpartisan primary ` +
          "(top-N parsing deferred; not stored)",
      );
    }

    const cal = calByState.get(d.state);
    for (const contest of ["D", "R"] as const) {
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
            `${label} ${contest}: "${c.name}" flagged incumbent but no ` +
              "members-table match for the district",
          );
        }
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
  }

  const unmatchedIncumbents: string[] = [];
  for (const [key, inc] of incumbentByDistrict) {
    if (!matchedIncumbents.has(inc.bioguideId)) {
      unmatchedIncumbents.push(`${key} — ${inc.name} (${inc.bioguideId})`);
    }
  }

  console.log(`\n=== House candidate sync — ${region} ===`);
  console.log(`1. Districts attempted: ${attempted}`);
  console.log(`2. Districts parsed cleanly: ${parsedOk}/${attempted}`);
  console.log(
    `3. Districts with no candidates: ${urlMisses.length} URL miss, ` +
      `${emptyDistricts.length} no filings yet`,
  );
  console.log(`4. Total candidates parsed: ${totalCandidates}`);
  console.log(
    `5. Incumbent matches: ${matchedIncumbents.size}/${totalIncumbents} ` +
      `${region} House incumbents in the members table`,
  );

  if (urlMisses.length > 0) {
    console.log(`\nURL misses (${urlMisses.length}):`);
    for (const m of urlMisses) console.log(`  ${m}`);
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
  if (oddities.length > 0) {
    console.log(`\nOddities (${oddities.length}):`);
    for (const o of oddities) console.log(`  ${o}`);
  }
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
// South minus LA — the 15 states HO 93 actually scraped (LA's jungle primary
// is deferred to HO 93.5).
const SOUTH_STATES = [
  "AL", "AR", "DE", "FL", "GA", "KY", "MD", "MS",
  "NC", "OK", "SC", "TN", "TX", "VA", "WV",
];

// HO 94 — re-runs the House incumbent matcher over every existing
// primary_candidates row without re-scraping Ballotpedia. After a members
// refresh, the (state, district) primary path plus the new (state, last_name)
// fallback resolve incumbents the original scrape missed (mid-decade redraw,
// or the Turner/Menefee district collision). Updates bioguide_id in place.
// Run with `--rematch`.
async function rematchHouseCandidates(): Promise<void> {
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

// `--region=<name>` selects the House candidate pass; absent, the script runs
// the calendar + Senate pass (the handoff-91 default).
function parseRegionArg(): HouseRegion | null {
  const arg = process.argv.find((a) => a.startsWith("--region="));
  if (!arg) return null;
  const value = arg.slice("--region=".length).toLowerCase();
  if (value in HOUSE_DISTRICTS_BY_REGION) return value as HouseRegion;
  throw new Error(
    `unknown --region "${value}" — expected one of: ` +
      Object.keys(HOUSE_DISTRICTS_BY_REGION).join(", "),
  );
}

async function main() {
  // `--rematch` (HO 94): re-run the House incumbent matcher over existing
  // primary_candidates rows; no scraping.
  if (process.argv.includes("--rematch")) {
    await rematchHouseCandidates();
    return;
  }
  const region = parseRegionArg();
  if (region) {
    await syncHouseCandidates(region);
    return;
  }
  await syncCalendar();
  await syncSenateCandidates();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
