// Pulls distinct sponsor bioguide_ids from `bills`, fetches each member from
// Congress.gov, upserts into `members`. Skips members refreshed within the
// last STALE_DAYS so reruns are cheap. ~600 API calls on first run, ~90s.
//
// Manual: `npm run sync:members`. Not in the cron — bios drift slowly.
import "dotenv/config";
import { getDb } from "../lib/db";

const STALE_DAYS = 30;
const DELAY_MS = 150;

// US state and territory full-name → two-letter postal code. Matches the
// `bills.sponsor_state` convention so the columns can join cleanly.
const STATE_ABBR: Record<string, string> = {
  Alabama: "AL", Alaska: "AK", Arizona: "AZ", Arkansas: "AR",
  California: "CA", Colorado: "CO", Connecticut: "CT", Delaware: "DE",
  Florida: "FL", Georgia: "GA", Hawaii: "HI", Idaho: "ID",
  Illinois: "IL", Indiana: "IN", Iowa: "IA", Kansas: "KS",
  Kentucky: "KY", Louisiana: "LA", Maine: "ME", Maryland: "MD",
  Massachusetts: "MA", Michigan: "MI", Minnesota: "MN", Mississippi: "MS",
  Missouri: "MO", Montana: "MT", Nebraska: "NE", Nevada: "NV",
  "New Hampshire": "NH", "New Jersey": "NJ", "New Mexico": "NM",
  "New York": "NY", "North Carolina": "NC", "North Dakota": "ND",
  Ohio: "OH", Oklahoma: "OK", Oregon: "OR", Pennsylvania: "PA",
  "Rhode Island": "RI", "South Carolina": "SC", "South Dakota": "SD",
  Tennessee: "TN", Texas: "TX", Utah: "UT", Vermont: "VT",
  Virginia: "VA", Washington: "WA", "West Virginia": "WV",
  Wisconsin: "WI", Wyoming: "WY",
  "District of Columbia": "DC",
  "American Samoa": "AS", Guam: "GU", "Northern Mariana Islands": "MP",
  "Puerto Rico": "PR", "Virgin Islands": "VI",
};

function stateAbbr(name: string | null | undefined): string | null {
  if (!name) return null;
  return STATE_ABBR[name] ?? null;
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

// Active-term endYear is missing in the API response, so derive it from
// chamber + startYear: House = 2-year terms, Senate = 6-year terms.
// next_election_year is endYear - 1 (Nov election the year before swear-in).
function deriveTermEndYear(
  chamber: "house" | "senate" | null,
  startYear: number | undefined,
  explicitEndYear: number | undefined,
): number | null {
  if (explicitEndYear) return explicitEndYear;
  if (!chamber || !startYear) return null;
  return chamber === "senate" ? startYear + 6 : startYear + 2;
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

async function main() {
  const apiKey = process.env.CONGRESS_API_KEY;
  if (!apiKey) throw new Error("CONGRESS_API_KEY is not set");

  const db = getDb();

  const distinctRes = await db.execute(`
    SELECT DISTINCT sponsor_bioguide_id
    FROM bills
    WHERE sponsor_bioguide_id IS NOT NULL
  `);
  const bioguideIds = distinctRes.rows.map(
    (r) => r.sponsor_bioguide_id as string,
  );
  console.log(`Distinct sponsors: ${bioguideIds.length}`);

  let fetched = 0;
  let skipped = 0;
  let failed = 0;

  for (const bioguideId of bioguideIds) {
    const existing = await db.execute({
      sql: `SELECT fetched_at FROM members WHERE bioguide_id = ?`,
      args: [bioguideId],
    });
    if (existing.rows.length > 0) {
      const ageDays =
        (Date.now() -
          new Date(existing.rows[0]!.fetched_at as string).getTime()) /
        86400000;
      if (ageDays < STALE_DAYS) {
        skipped++;
        continue;
      }
    }

    try {
      const member = await fetchMember(bioguideId, apiKey);
      const terms = member.terms ?? [];
      const currentTerm = pickCurrentTerm(terms);
      const chamber = deriveChamber(currentTerm);
      const currentTermEndYear = deriveTermEndYear(
        chamber,
        currentTerm?.startYear,
        currentTerm?.endYear,
      );
      // Terms end Jan 3 of an odd year; the prior November is the election.
      const nextElectionYear = currentTermEndYear
        ? currentTermEndYear - 1
        : null;
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
                raw_json, fetched_at
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
          new Date().toISOString(),
        ],
      });
      fetched++;
      console.log(`${bioguideId}: ${name}`);
    } catch (err) {
      failed++;
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`${bioguideId}: failed — ${msg.slice(0, 120)}`);
    }

    await new Promise((r) => setTimeout(r, DELAY_MS));
  }

  console.log(`Done. fetched=${fetched} skipped=${skipped} failed=${failed}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
