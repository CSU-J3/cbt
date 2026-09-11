// Deterministic race ID derivation from member data (handoff 62).
//
// House: <STATE>-<DD>-<YYYY> with zero-padded 2-digit district.
//        <STATE>-AL-<YYYY> for an at-large seat (HO 711).
// Senate: S-<STATE>-<YYYY>.
//
// This function is the authoritative format. Three translations exist and must
// move together: the backfill SQL in scripts/backfill-races.ts, the derived-id
// CASE in getSeatOutlook (lib/queries.ts), and districtSeatId in
// lib/district-geo.ts. If the format ever changes (mid-decade redistricting,
// new chamber, etc.), update all four sites.
//
// HO 711 — AT-LARGE. Six states elect one representative statewide (AK, DE, ND,
// SD, VT, WY) and Congress.gov gives them no district number, so members.district
// is NULL. Before this HO they were excluded outright and had no race row
// anywhere in the app. The token is `AL`, which is NOT a new invention: it is
// what lib/kalshi.ts:59-62 has always emitted for an at-large ticker, and this
// rule adopts the writer's existing choice rather than minting a second one.
//
// `AL` IS ALSO ALABAMA'S POSTAL CODE. There is no id collision — Alabama's seven
// districts are numbered, so `AL-AL-YYYY` cannot arise — but a SUBSTRING test is
// wrong: `id LIKE '%-AL-%'` matches `S-AL-2026`, the Alabama Senate seat. The
// at-large test is `chamber = 'house' AND district = 0`, or an ANCHORED pattern
// (`id LIKE '__-AL-____'`), never a bare substring.
//
// A DELEGATE IS NOT AN AT-LARGE MEMBER. Both carry a NULL district; only one
// holds a contested seat. The territorial carve separates them and returns null
// for delegates, so they stay out of `races` exactly as before.

import { isTerritorialState } from "./states";

export interface MemberLite {
  chamber: "house" | "senate" | null;
  state: string | null;
  district: number | null;
  nextElectionYear: number | null;
}

// The district half of a House id. NULL and 0 are the SAME seat shape: members
// stores at-large as NULL (Congress.gov's own shape) and races stores it as 0,
// so this accepts either and yields the one token.
export function districtToken(district: number | null | undefined): string {
  if (district == null || district === 0) return "AL";
  return String(district).padStart(2, "0");
}

export function raceIdFromMember(m: MemberLite): string | null {
  if (!m.chamber || !m.state || !m.nextElectionYear) return null;
  if (m.chamber === "senate") return `S-${m.state}-${m.nextElectionYear}`;
  // A delegate has no contested seat and therefore no race row. This is the
  // carve that used to be `district == null -> null`, which swept the six
  // at-large states out along with the six delegations.
  if (m.district == null && isTerritorialState(m.state)) return null;
  return `${m.state}-${districtToken(m.district)}-${m.nextElectionYear}`;
}
