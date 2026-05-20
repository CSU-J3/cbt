// Primary tracker sync. Two passes, selected by argv:
//   (default)          handoff 91 — state-level primary calendar (all 50
//                      states) + Senate candidate rosters (33 races).
//   --region=<region>  handoff 92 — House candidate rosters for one region
//                      (northeast shipped; south/midwest/west are stubs).
// `npm run sync:primaries` runs the default pass; `npm run sync:house-primaries
// -- --region=northeast` runs the House pass.
import "dotenv/config";
import { getDb } from "../lib/db";
import { scrapeStatePrimaryCalendar } from "../lib/primary-calendar-scrape";
import {
  scrapeHouseCandidates,
  scrapeSenateCandidates,
  type ScrapedCandidate,
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
// districts across 9 states; South / Midwest / West follow in handoffs 93-95.
// `district: 0` is an at-large seat (Vermont).
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

const HOUSE_DISTRICTS_BY_REGION: Record<HouseRegion, HouseDistrict[]> = {
  northeast: HOUSE_DISTRICTS_NORTHEAST_2026,
  south: [],
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

  // House incumbents in scope, keyed "STATE-district" (district 0 = at-large).
  const memberRows = await db.execute({
    sql: `SELECT bioguide_id, name, state, district
            FROM members
            WHERE chamber = 'house' AND state IN (${statePlaceholders})`,
    args: states,
  });
  type Incumbent = { bioguideId: string; name: string; foldedName: string };
  const incumbentByDistrict = new Map<string, Incumbent>();
  for (const r of memberRows.rows) {
    const st = r.state as string;
    const dist = (r.district as number | null) ?? 0;
    const name = ((r.name as string | null) ?? "").trim();
    incumbentByDistrict.set(`${st}-${dist}`, {
      bioguideId: r.bioguide_id as string,
      name,
      foldedName: foldName(name),
    });
  }
  const totalIncumbents = incumbentByDistrict.size;
  const matchedIncumbents = new Set<string>();

  // A candidate matches the district's incumbent when the incumbent's folded
  // name contains the candidate's last-name key — the House analog of the
  // Senate sync's by-state name match, scoped per seat. `includes` (not an
  // exact key compare) is what lets multi-word surnames ("Van Drew", "Watson
  // Coleman") and suffixed names ("Conaway Jr.") match.
  function matchHouseIncumbent(
    c: ScrapedCandidate,
    state: string,
    district: number,
  ): string | null {
    const inc = incumbentByDistrict.get(`${state}-${district}`);
    if (!inc) return null;
    const key = foldName(lastNameKey(c.name));
    return key && inc.foldedName.includes(key) ? inc.bioguideId : null;
  }

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
        const bioguideId = matchHouseIncumbent(c, d.state, d.district);
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
