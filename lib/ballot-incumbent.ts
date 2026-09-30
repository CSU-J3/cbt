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

// HO 751's name check, moved here unchanged at HO 759 (lib/ballotpedia-title-repair.ts
// re-exports it; lib/incumbent-qualifier.ts matches a primary row by it). The name
// check: every surname token of members.last_name, and a first-name
// token (members.first_name, or members.name less the surname), after normName,
// either WHOLE or as a PREFIX of three or more letters (the ruling: NJ-04's
// "Chris" confirms against "Christopher"). `form` records which. Tightened on
// the HO 751 review, each against a wrong person it let through:
//   · the learned title's parenthetical disambiguator is not the name
//     ("Joe Calvert (Kentucky)" must not confirm Ken Calvert by "ken");
//   · a first-name token has two letters or more (a middle initial "a" must not
//     confirm Craig A. Goldman against "Sarah A. Goldman").
//   The prefix runs EITHER way, as ruled: the ballot may carry the short form
//   (NJ-04's "chris" of "christopher") or the member row may (S-AK's member row
//   says "dan", his page "daniel"); the shorter token, three letters or more,
//   must begin the longer.
export function tokenCheck(learned: string, c: { firstName: string | null; lastName: string | null; member: string }): { ok: boolean; form: "whole" | "prefix" | null; detail: string } {
  const t = tokens(learned.replace(/\([^)]*\)/g, " "));
  const tset = new Set(t);
  const sur = tokens(c.lastName ?? "");
  const firsts = [...new Set([...tokens(c.firstName ?? ""), ...tokens(c.member).filter((x) => !sur.includes(x))])].filter((x) => x.length >= 2);
  const surOk = sur.length > 0 && sur.every((x) => tset.has(x));
  const whole = firsts.filter((x) => tset.has(x) && !sur.includes(x));
  const prefix: string[] = [];
  if (!whole.length) {
    for (const f of firsts) for (const w of t) {
      if (sur.includes(w)) continue;
      const [s, l] = f.length <= w.length ? [f, w] : [w, f];
      if (s.length >= 3 && s !== l && l.startsWith(s)) prefix.push(`${w}~${f}`);
    }
  }
  const form = whole.length ? "whole" : prefix.length ? "prefix" : null;
  return {
    ok: surOk && form !== null,
    form: surOk ? form : null,
    detail: `surname [${sur.join(" ")}] ${surOk ? "present" : "ABSENT"} · first-name [${firsts.join(" ")}] ${whole.length ? `whole [${whole.join(" ")}]` : prefix.length ? `prefix [${prefix.join(" ")}]` : "no match"}`,
  };
}
