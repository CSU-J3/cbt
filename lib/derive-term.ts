// Pure term-math helpers (handoff 63; senate role narrowed by HO 411).
// Translates Congress.gov term data into `current_term_end_year` +
// `next_election_year`. Consumed by scripts/sync-members.ts (live sync).
//
// HO 411 REPLACED the senate primary derivation: current senators now derive
// their year-pair from Senate class (senateYearsFromClass, below) — the
// startYear-based senate helpers (senateTermStart / senateNextElection /
// senateTermEnd) survive ONLY as the fallback for departed senators absent from
// legislators-current.yaml (no class available). HO 412 deleted the old
// scripts/fix-senate-term-years.ts consumer, which re-ran this startYear path
// over ALL senators and dropped stale senate races — it re-introduced the exact
// drift 411 fixed and its "races-seed.json is empty for senate" premise is now
// false (there's the S-OK curated override + seeded senate ratings).
//
// Why the fallback math is non-trivial: Congress.gov returns ONE entry per
// Congress (2-year block), not one per 6-year senate term, so a continuously
// serving senator appears as 4+ contiguous senate entries. Naive
// `latest.startYear + 6` (handoff 60) collapsed every sitting senator to
// next_election_year = 2030 — the bug senateTermStart exists to work around.

export interface Term {
  startYear?: number;
  endYear?: number;
  chamber?: string;
  congress?: number;
}

interface SenateTerm {
  startYear: number;
  congress?: number;
}

// Senate terms span exactly 3 contiguous 2-year Congresses (6 years). To
// recover the current-term start for a continuously-serving senator:
//
//   1. Find the contiguous run of senate Congresses ending at `latest`.
//   2. The 3-Congress modular offset of `latest` within that run tells us
//      how far we are into the current term.
//   3. termStart = latest.startYear - 2 * offset.
//
// Examples (using Congress 119 / startYear 2025 as the "latest"):
//   - Just-elected Class 1 (only Congress 119): offset 0 → 2025 ✓
//   - Bernie / continuously re-elected (110-119): offset (119-110)%3 = 0 → 2025 ✓
//   - Class 2 mid-term (117-119): offset (119-117)%3 = 2 → 2025 - 4 = 2021 ✓
//   - Class 3 mid-term (118-119): offset (119-118)%3 = 1 → 2025 - 2 = 2023 ✓
//
// Mid-term appointees and senators who lost and returned later will skew
// slightly; the handoff explicitly accepts that noise.
export function senateTermStart(terms: Term[]): number | null {
  const senate: SenateTerm[] = terms
    .filter(
      (t): t is Term & { startYear: number } =>
        typeof t.startYear === "number" &&
        (t.chamber ?? "").toLowerCase().includes("senate"),
    )
    .map((t) => ({ startYear: t.startYear, congress: t.congress }))
    .sort((a, b) => a.startYear - b.startYear);
  if (senate.length === 0) return null;

  const latest = senate[senate.length - 1]!;
  if (latest.congress === undefined) return latest.startYear;

  // Walk backward through senate entries collecting the contiguous run
  // ending at `latest`. Each prev Congress must be exactly 1 less than
  // the running "firstContiguous" to be part of the run.
  let firstContiguousCongress = latest.congress;
  for (let i = senate.length - 2; i >= 0; i--) {
    const prev = senate[i]!;
    if (prev.congress === firstContiguousCongress - 1) {
      firstContiguousCongress = prev.congress;
    } else {
      break;
    }
  }

  const offset = (latest.congress - firstContiguousCongress) % 3;
  return latest.startYear - 2 * offset;
}

// Senate election is the November before the term ends (term ends Jan 3
// of an odd year; election the prior Tuesday of November).
export function senateNextElection(termStart: number): number {
  return termStart + 5;
}

export function senateTermEnd(termStart: number): number {
  return termStart + 6;
}

// House terms are exactly 2 years = 1 Congress, so the latest entry's
// startYear is the current term start directly. These helpers exist so
// sync-members.ts has one place for all term math.
export function houseTermEnd(latestStartYear: number): number {
  return latestStartYear + 2;
}

export function houseNextElection(termEnd: number): number {
  return termEnd - 1;
}

// ── HO 411: derive the senator year-pair from Senate class, not term math ──
//
// A senator's Senate class fixes their election cycle exactly; the old
// startYear+6 / contiguous-run derivation drifted (18 of 100 senators carried a
// next_election_year that disagreed with their class — HO 410). Class comes from
// the last terms[] entry in legislators-current.yaml, ingested into
// members.senate_class by sync:members.
//
// Residues mod 6: class 1 ≡ 2 (…2024, 2030, 2036), class 2 ≡ 4 (…2026, 2032),
// class 3 ≡ 0 (…2028, 2034). The next election for a class is the smallest year
// ≥ the current cycle whose value mod 6 equals the residue — computed from
// `now`, NOT hardcoded, so it doesn't re-rot after November.
const CLASS_RESIDUE: Record<number, number> = { 1: 2, 2: 4, 3: 0 };

// US federal general election day: the Tuesday after the first Monday of
// November. Returns true when `now` is strictly past that day in its own year —
// the boundary that rolls a class off the just-completed cycle onto the next.
export function isPastElectionDay(now: Date): boolean {
  const year = now.getUTCFullYear();
  const nov1Dow = new Date(Date.UTC(year, 10, 1)).getUTCDay(); // 0=Sun..6=Sat
  const firstMonday = 1 + ((8 - nov1Dow) % 7); // day-of-month of first Monday
  const electionDay = firstMonday + 1; // the Tuesday after
  const election = Date.UTC(year, 10, electionDay, 23, 59, 59);
  return now.getTime() > election;
}

// The next regular general-election year for a Senate class, as of `now`.
export function nextElectionForClass(
  senateClass: number,
  now: Date,
): number | null {
  const residue = CLASS_RESIDUE[senateClass];
  if (residue === undefined) return null;
  const currentYear = now.getUTCFullYear();
  let y = currentYear;
  while (y % 6 !== residue) y++;
  // If this class's year is the current year but the election has already
  // happened, the next one is a full cycle out.
  if (y === currentYear && isPastElectionDay(now)) y += 6;
  return y;
}

// Full regular-seat year-pair from class: election year + the term end the
// following January (ney = ctey − 1). Special elections (OH/FL 2026) legitimately
// break this invariant and are handled by data/senate-special-elections.json
// ahead of this call — see sync-members.ts.
export function senateYearsFromClass(
  senateClass: number,
  now: Date,
): { nextElection: number; termEnd: number } | null {
  const ney = nextElectionForClass(senateClass, now);
  if (ney === null) return null;
  return { nextElection: ney, termEnd: ney + 1 };
}
