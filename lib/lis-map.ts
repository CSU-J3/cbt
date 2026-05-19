// Senate-vote member-id mapping.
//
// senate.gov vote XML identifies senators by `lis_member_id` (e.g. "S428").
// Our schema keys member_votes on bioguide_id (e.g. "B001288"). To bridge them
// we need a `lis_member_id -> bioguide_id` map.
//
// Handoff 80 originally proposed pulling this from Congress.gov
// (`/v3/member?currentMember=true&chamber=Senate`), but verification showed
// Congress.gov does not expose `lisId` on either the list or per-member detail
// endpoints. Instead we lean on a property the XML *does* give us alongside
// `lis_member_id` on every member row: `last_name` + `state`. Those two
// together are unique among current senators and already present in our
// `members` table, so we resolve bioguide by (last_name, state).
//
// The exported `buildLisMap` keeps the original signature for callers but is
// resolved lazily: we don't need a LIS->bioguide map up front, only a
// (lastName, state) -> bioguide_id map plus a per-run cache. The caller
// passes member XML fields in and we return the bioguide_id.
import { getDb } from "./db";

type Db = ReturnType<typeof getDb>;

export type SenatorResolver = {
  // Resolve a senate-vote `<member>` XML element to a bioguide_id, or null
  // if no matching senator exists in `members` (e.g. interim appointee not
  // yet synced).
  resolve(lisMemberId: string, lastName: string, state: string): string | null;
  // For debug / verification.
  size(): number;
};

// senate.gov XML strips diacritics (e.g. "Lujan") while Congress.gov stores
// the canonical form ("Luján"). Fold to NFD and drop combining marks so the
// keys collide regardless of source.
function foldDiacritics(s: string): string {
  return s.normalize("NFD").replace(/\p{Diacritic}/gu, "");
}

function nameKey(lastName: string, state: string): string {
  return `${foldDiacritics(lastName).trim().toLowerCase()}|${state.trim().toUpperCase()}`;
}

// Senators not in our `members` table — `sync-members` pulls only members
// who've sponsored a bill, and `currentMember=true` excludes the departed.
// Hard-coded by (last_name, state) since these are stable historical facts.
// Without this, votes during the affected window lose 1-2 member rows each.
// Re-evaluate when `sync-members` pulls senators directly from
// /v3/member?chamber=Senate (handoff TBD).
const SENATOR_BIOGUIDE_FALLBACK: Record<string, string> = {
  "rubio|FL": "R000595", // Marco Rubio → Secretary of State, Jan 2025
  "vance|OH": "V000137", // J.D. Vance → Vice President, Jan 2025
  "armstrong|OK": "A000383", // Alan Armstrong → seated Jan 2026 (no sponsorships yet)
};

export async function buildSenatorResolver(db: Db): Promise<SenatorResolver> {
  const r = await db.execute(
    "SELECT bioguide_id, last_name, state FROM members WHERE chamber = 'senate' AND last_name IS NOT NULL AND state IS NOT NULL",
  );
  const byName = new Map<string, string>();
  for (const row of r.rows) {
    const last = row.last_name as string;
    const st = row.state as string;
    byName.set(nameKey(last, st), row.bioguide_id as string);
  }

  // Cache resolutions across the run keyed by lis_member_id so a typical
  // 700-vote backfill does ~100 map lookups, not 70k.
  const byLis = new Map<string, string | null>();
  const warnedKeys = new Set<string>();

  return {
    resolve(lisMemberId, lastName, state) {
      const cached = byLis.get(lisMemberId);
      if (cached !== undefined) return cached;
      const key = nameKey(lastName, state);
      const bioguide =
        byName.get(key) ?? SENATOR_BIOGUIDE_FALLBACK[key] ?? null;
      byLis.set(lisMemberId, bioguide);
      if (!bioguide) {
        const k = `${lastName} (${state}) lis=${lisMemberId}`;
        if (!warnedKeys.has(k)) {
          console.warn(`  no bioguide match: ${k}`);
          warnedKeys.add(k);
        }
      }
      return bioguide;
    },
    size() {
      return byName.size;
    },
  };
}
