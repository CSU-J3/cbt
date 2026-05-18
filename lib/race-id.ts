// Deterministic race ID derivation from member data (handoff 62).
//
// House: <STATE>-<DD>-<YYYY> with zero-padded 2-digit district.
// Senate: S-<STATE>-<YYYY>.
//
// This function is the authoritative format; the backfill SQL in
// scripts/backfill-races.ts is a translation. If the format ever changes
// (mid-decade redistricting, new chamber, etc.), update both.

export interface MemberLite {
  chamber: "house" | "senate" | null;
  state: string | null;
  district: number | null;
  nextElectionYear: number | null;
}

export function raceIdFromMember(m: MemberLite): string | null {
  if (!m.chamber || !m.state || !m.nextElectionYear) return null;
  if (m.chamber === "senate") return `S-${m.state}-${m.nextElectionYear}`;
  if (m.district == null) return null;
  return `${m.state}-${String(m.district).padStart(2, "0")}-${m.nextElectionYear}`;
}
