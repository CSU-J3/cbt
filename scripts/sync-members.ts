// Refreshes the `members` table from the Congress.gov 119th-Congress roster.
//
// HO 94: this used to seed from `SELECT DISTINCT sponsor_bioguide_id FROM
// bills`, which structurally missed any current member who hadn't sponsored a
// bill yet (notably special-election winners). It now enumerates the roster
// endpoint directly, so the table reflects the actual 119th membership, and
// carries an `is_current` flag so members who served part of the Congress but
// no longer do (deaths, resignations) are kept as rows rather than deleted.
//
// Endpoints (verified HO 94 — do NOT use `/member?congress=119`, which does
// not filter by Congress and returns ~2,700 historical members):
//   GET /member/congress/119                    — full 119th roster (551)
//   GET /member/congress/119?currentMember=true  — currently serving (536)
//   GET /member/{bioguideId}                     — per-member detail
//
// The 551 vs 536 gap is the inactivity signal. Detail is fetched per member
// so every existing column (birth year, depiction, derived term years) stays
// populated — the roster list endpoint is too sparse for that on its own.
//
// Manual: `npm run sync:members`. ~90s. Re-run after any special election or
// redraw; quarterly at minimum otherwise.
import "dotenv/config";
import { getDb } from "../lib/db";
import {
  houseNextElection,
  houseTermEnd,
  senateNextElection,
  senateTermEnd,
  senateTermStart,
} from "../lib/derive-term";
import { stateAbbr } from "../lib/states";

const CONGRESS = 119;
const PAGE_LIMIT = 250;
const DELAY_MS = 150;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Accepts both partyAbbreviation ("R", "D", "I", "ID") and partyName
// ("Republican", "Democratic", "Independent"). The Congress.gov member
// endpoint stores partyHistory[].partyAbbreviation as the short form, but
// fall back to substring matching for robustness.
function normalizeParty(
  party: string | null | undefined,
): "R" | "D" | "I" | null {
  if (!party) return null;
  const upper = party.trim().toUpperCase();
  if (upper === "R") return "R";
  if (upper === "D") return "D";
  const lower = party.toLowerCase();
  if (lower.includes("republican")) return "R";
  if (lower.includes("democrat")) return "D";
  return "I";
}

type Term = {
  startYear?: number;
  endYear?: number;
  chamber?: string;
  district?: number;
  stateName?: string;
  stateCode?: string;
  memberType?: string;
  congress?: number;
};

type PartyHistoryEntry = {
  partyAbbreviation?: string;
  partyName?: string;
  startYear?: number;
};

type Member = {
  bioguideId?: string;
  directOrderName?: string;
  firstName?: string;
  lastName?: string;
  partyHistory?: PartyHistoryEntry[];
  state?: string;
  birthYear?: string | number;
  depiction?: { imageUrl?: string };
  // The /member/{bioguideId} response returns terms as a direct array, NOT
  // wrapped in { item: [] } despite some doc samples suggesting otherwise.
  terms?: Term[];
};

type MemberResponse = { member?: Member };

// The /member/congress/{congress} list endpoint returns sparse member stubs;
// only the bioguideId is consumed here (detail is fetched separately).
type RosterStub = { bioguideId?: string };
type RosterResponse = {
  members?: RosterStub[];
  pagination?: { count?: number; next?: string | null };
};

function deriveChamber(term: Term | null): "house" | "senate" | null {
  const c = (term?.chamber ?? "").toLowerCase();
  if (c.includes("senate")) return "senate";
  if (c.includes("house")) return "house";
  return null;
}

function pickCurrentTerm(terms: Term[]): Term | null {
  if (terms.length === 0) return null;
  return [...terms].sort(
    (a, b) => (b.startYear ?? 0) - (a.startYear ?? 0),
  )[0]!;
}

function pickCurrentParty(history: PartyHistoryEntry[] | undefined): string | null {
  if (!history || history.length === 0) return null;
  const sorted = [...history].sort(
    (a, b) => (b.startYear ?? 0) - (a.startYear ?? 0),
  );
  return sorted[0]?.partyAbbreviation ?? sorted[0]?.partyName ?? null;
}

// Term math is split by chamber and delegated to lib/derive-term.ts. Senate
// needs the 3-Congress modular walkback (Congress.gov returns one entry per
// 2-year Congress, not per 6-year term — naive `startYear + 6` collapses
// every continuously-serving senator to the same term boundary). House is
// straightforward: one Congress = one term.
function deriveTermYears(
  chamber: "house" | "senate" | null,
  terms: Term[],
  latestTermStartYear: number | undefined,
): { endYear: number | null; nextElection: number | null } {
  if (chamber === "senate") {
    const ts = senateTermStart(terms);
    if (ts === null) return { endYear: null, nextElection: null };
    return { endYear: senateTermEnd(ts), nextElection: senateNextElection(ts) };
  }
  if (chamber === "house" && latestTermStartYear !== undefined) {
    const endYear = houseTermEnd(latestTermStartYear);
    return { endYear, nextElection: houseNextElection(endYear) };
  }
  return { endYear: null, nextElection: null };
}

async function fetchMember(
  bioguideId: string,
  apiKey: string,
): Promise<Member> {
  const url = `https://api.congress.gov/v3/member/${bioguideId}?api_key=${encodeURIComponent(apiKey)}&format=json`;
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`HTTP ${res.status}: ${body.slice(0, 200)}`);
  }
  const data = (await res.json()) as MemberResponse;
  if (!data.member) throw new Error("response missing `member`");
  return data.member;
}

// Pages a `/member/congress/{congress}` list endpoint, offset-based, and
// returns the set of bioguide ids it contains. `extraQuery` carries an
// optional filter such as `currentMember=true`.
async function fetchRosterIds(
  apiKey: string,
  extraQuery: string,
): Promise<Set<string>> {
  const ids = new Set<string>();
  let offset = 0;
  for (;;) {
    const url =
      `https://api.congress.gov/v3/member/congress/${CONGRESS}` +
      `?offset=${offset}&limit=${PAGE_LIMIT}&format=json` +
      (extraQuery ? `&${extraQuery}` : "") +
      `&api_key=${encodeURIComponent(apiKey)}`;
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`roster HTTP ${res.status}: ${body.slice(0, 200)}`);
    }
    const data = (await res.json()) as RosterResponse;
    const page = data.members ?? [];
    for (const m of page) {
      if (m.bioguideId) ids.add(m.bioguideId);
    }
    if (page.length < PAGE_LIMIT) break;
    offset += PAGE_LIMIT;
    await sleep(DELAY_MS);
  }
  return ids;
}

async function main() {
  const apiKey = process.env.CONGRESS_API_KEY;
  if (!apiKey) throw new Error("CONGRESS_API_KEY is not set");

  const db = getDb();

  // Snapshot the table before touching it so the report can distinguish
  // newly-added members from updates.
  const beforeRes = await db.execute("SELECT bioguide_id FROM members");
  const beforeIds = new Set(
    beforeRes.rows.map((r) => r.bioguide_id as string),
  );
  console.log(`Members table before: ${beforeIds.size} rows`);

  const rosterIds = await fetchRosterIds(apiKey, "");
  await sleep(DELAY_MS);
  const currentIds = await fetchRosterIds(apiKey, "currentMember=true");
  console.log(
    `Roster: ${rosterIds.size} in the 119th Congress, ` +
      `${currentIds.size} currently serving`,
  );
  if (rosterIds.size === 0) {
    throw new Error("roster endpoint returned 0 members — aborting");
  }

  let fetched = 0;
  let failed = 0;
  const newlyAdded: string[] = [];
  const markedInactive: string[] = [];
  const failures: string[] = [];

  for (const bioguideId of rosterIds) {
    const isCurrent = currentIds.has(bioguideId) ? 1 : 0;
    try {
      const member = await fetchMember(bioguideId, apiKey);
      const terms = member.terms ?? [];
      const currentTerm = pickCurrentTerm(terms);
      const chamber = deriveChamber(currentTerm);
      const { endYear: currentTermEndYear, nextElection: nextElectionYear } =
        deriveTermYears(chamber, terms, currentTerm?.startYear);
      const stateName = currentTerm?.stateName ?? member.state ?? null;
      const fallbackName =
        [member.firstName, member.lastName].filter(Boolean).join(" ") ||
        bioguideId;
      const name = member.directOrderName ?? fallbackName;
      const birthYear =
        typeof member.birthYear === "number"
          ? member.birthYear
          : member.birthYear
            ? parseInt(member.birthYear, 10) || null
            : null;
      const partyRaw = pickCurrentParty(member.partyHistory);

      await db.execute({
        sql: `INSERT INTO members (
                bioguide_id, name, first_name, last_name, party, state, state_name,
                district, chamber, birth_year, depiction_url,
                current_term_end_year, next_election_year, terms_json,
                raw_json, is_current, fetched_at
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
              ON CONFLICT(bioguide_id) DO UPDATE SET
                name = excluded.name,
                first_name = excluded.first_name,
                last_name = excluded.last_name,
                party = excluded.party,
                state = excluded.state,
                state_name = excluded.state_name,
                district = excluded.district,
                chamber = excluded.chamber,
                birth_year = excluded.birth_year,
                depiction_url = excluded.depiction_url,
                current_term_end_year = excluded.current_term_end_year,
                next_election_year = excluded.next_election_year,
                terms_json = excluded.terms_json,
                raw_json = excluded.raw_json,
                is_current = excluded.is_current,
                fetched_at = excluded.fetched_at`,
        args: [
          bioguideId,
          name,
          member.firstName ?? null,
          member.lastName ?? null,
          normalizeParty(partyRaw),
          stateAbbr(stateName) ?? currentTerm?.stateCode ?? null,
          stateName,
          currentTerm?.district ?? null,
          chamber,
          birthYear,
          member.depiction?.imageUrl ?? null,
          currentTermEndYear,
          nextElectionYear,
          JSON.stringify(terms),
          JSON.stringify(member),
          isCurrent,
          new Date().toISOString(),
        ],
      });
      fetched++;
      if (!beforeIds.has(bioguideId)) newlyAdded.push(`${bioguideId} ${name}`);
      if (isCurrent === 0) markedInactive.push(`${bioguideId} ${name}`);
    } catch (err) {
      failed++;
      const msg = err instanceof Error ? err.message : String(err);
      failures.push(`${bioguideId}: ${msg.slice(0, 120)}`);
      console.warn(`${bioguideId}: failed — ${msg.slice(0, 120)}`);
    }

    await sleep(DELAY_MS);
  }

  // Any pre-existing row whose bioguide is not in the 119th roster at all
  // (stale carryover from the old bill-sponsor seeding) is also non-current.
  const rosterList = [...rosterIds];
  const placeholders = rosterList.map(() => "?").join(", ");
  const leftover = await db.execute({
    sql: `UPDATE members SET is_current = 0
            WHERE bioguide_id NOT IN (${placeholders})`,
    args: rosterList,
  });
  const leftoverInactivated = Number(leftover.rowsAffected ?? 0);

  const afterRes = await db.execute("SELECT COUNT(*) AS n FROM members");
  const afterCount = Number(afterRes.rows[0]!.n);

  console.log("\n=== Members refresh — HO 94 ===");
  console.log(`1. Row count: ${beforeIds.size} before → ${afterCount} after`);
  console.log(`2. Newly added (${newlyAdded.length}):`);
  for (const m of newlyAdded) console.log(`     ${m}`);
  if (newlyAdded.length === 0) console.log("     none");
  console.log(
    `3. 119th members marked is_current = false (${markedInactive.length}) ` +
      "— deaths / resignations / expulsions:",
  );
  for (const m of markedInactive) console.log(`     ${m}`);
  if (markedInactive.length === 0) console.log("     none");
  if (leftoverInactivated > 0) {
    console.log(
      `   (plus ${leftoverInactivated} pre-existing non-119th rows ` +
        "set is_current = 0)",
    );
  }
  console.log(`4. Detail fetched: ${fetched}, failed: ${failed}`);
  if (failures.length > 0) {
    for (const f of failures) console.log(`     ${f}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
