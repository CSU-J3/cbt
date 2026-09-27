// HO 750 — which row of a race's November ballot is the seat's stored
// incumbent. ONE pure function, two callers: the challenger harvest
// (lib/harvest-challengers.ts, which leaves the incumbent's row out of the
// roster) and the race page's stub (lib/queries.ts getIncumbentOnBallot, which
// says "Incumbent running for re-election" only when this finds the incumbent
// on the ballot).
//
// THE RULE, in order, for the rows PRINTED on the ballot (on_ballot = 1):
//   1. IDENTITY: the row whose bioguide_id equals the stored incumbent's.
//      general_ballot.bioguide_id is set by identity only (the page title
//      against member_ids.ballotpedia_title), so this never matches a namesake.
//      It is looked for on every row of the page: if identity finds the
//      incumbent only on a withdrawn-only row, they are on no printed row, and
//      test 2 is not consulted.
//   2. UNDERLINE AND SURNAME: failing identity, the ONE printed row that Ballotpedia
//      underlines (incumbent_marked = 1), that carries no bioguide, and whose
//      printed name ends with the stored incumbent's members.last_name, after
//      the normalization HO 747's census used. HO 749 measured 42 stored
//      incumbents printed on their own ballot under a page title their stored
//      title does not match (32 stale, 9 missing, WA-09's "D. Adam Smith");
//      this test reaches all 42 (HO 750 STEP 0).
//   3. Otherwise the incumbent is on no row.
// A namesake is not underlined, so it never matches test 2 (S-AK's second Dan
// Sullivan). An underlined row tied by identity to a different member (a moved
// incumbent) has a bioguide, so it never matches test 2 either; one with no
// bioguide has a different surname (TX-37's Casar, UT-04's Kennedy, UT-02's
// Blake Moore against the stored Doggett, Owens and Maloy).
// A withdrawn-only row (on_ballot = 0) is never the incumbent ON the ballot:
// NC-11's Chuck Edwards is listed withdrawn, and "running for re-election"
// would be false of him. And when identity finds the incumbent only there, the
// surname fallback is not consulted (HO 750 review).
export type BallotPerson = {
  person_key: string;
  name: string;
  bioguide_id: string | null;
  incumbent_marked: number;
  on_ballot: number;
};
export type IncumbentRoute = "identity" | "underline-surname" | "none";
export type IncumbentOnBallot<T extends BallotPerson> = { route: IncumbentRoute; row: T | null };

// HO 747's census normalization (scripts/diagnostic/general-box-census-747.ts,
// normName and SUFFIXES): NFKD with the diacritics folded, case and
// punctuation dropped, whitespace collapsed, generational suffixes ignored.
const SUFFIXES = new Set(["jr", "sr", "ii", "iii", "iv"]);
export function normName(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}
const tokens = (s: string) => normName(s).split(" ").filter((t) => t && !SUFFIXES.has(t));

// The printed name's last tokens equal the stored surname's tokens, so a
// two-word surname ("McClain Delaney", "Wasserman Schultz") matches whole.
export function surnameMatches(printedName: string, lastName: string | null | undefined): boolean {
  const n = tokens(printedName);
  const l = tokens(lastName ?? "");
  return l.length > 0 && n.length >= l.length && l.every((t, i) => n[n.length - l.length + i] === t);
}

export type StoredIncumbent = { bioguideId: string; lastName: string | null };

// IDENTITY IS DECISIVE. When a row on the page (printed or withdrawn-only) ties
// to the stored incumbent by identity, that row says where they are, and the
// surname fallback is never consulted: an incumbent identity finds only in the
// withdrawn block (NC-11's Edwards) is on no printed row, whatever else is
// underlined. The fallback is for an incumbent identity cannot find at all.
export function findIncumbentOnBallot<T extends BallotPerson>(
  rows: T[],
  incumbent: StoredIncumbent | null,
): IncumbentOnBallot<T> {
  if (!incumbent) return { route: "none", row: null };
  const byIdentity = rows.filter((r) => r.bioguide_id === incumbent.bioguideId);
  if (byIdentity.length > 0) {
    const printed = byIdentity.filter((r) => r.on_ballot === 1);
    return printed.length === 1 ? { route: "identity", row: printed[0]! } : { route: "none", row: null };
  }
  const bySurname = rows.filter((r) => r.on_ballot === 1 && isUnderlinedSurname(r, incumbent));
  if (bySurname.length === 1) return { route: "underline-surname", row: bySurname[0]! };
  return { route: "none", row: null };
}

function isUnderlinedSurname(r: BallotPerson, incumbent: StoredIncumbent): boolean {
  return r.incumbent_marked === 1 && r.bioguide_id === null && surnameMatches(r.name, incumbent.lastName);
}

// The stored incumbent's row anywhere on the page, printed or withdrawn-only,
// by the same two routes (identity decisive, then the one underlined surname
// match). The harvest uses it to keep the incumbent off its `withdrew` rows,
// where the printed-row rule above does not look: an incumbent under a stale
// title who withdrew is underlined with no bioguide, and must not be published
// as a challenger who withdrew from their own seat. A race with no stored
// incumbent has no incumbent row.
export function findIncumbentRow<T extends BallotPerson>(rows: T[], incumbent: StoredIncumbent | null): T | null {
  if (!incumbent) return null;
  const byIdentity = rows.filter((r) => r.bioguide_id === incumbent.bioguideId);
  if (byIdentity.length > 0) return byIdentity[0]!;
  const bySurname = rows.filter((r) => isUnderlinedSurname(r, incumbent));
  return bySurname.length === 1 ? bySurname[0]! : null;
}
