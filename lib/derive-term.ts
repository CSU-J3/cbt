// Pure term-math helpers (handoff 63). Single source of truth for
// translating Congress.gov term data into `current_term_end_year` +
// `next_election_year`. Used by scripts/sync-members.ts (live sync) and
// scripts/fix-senate-term-years.ts (one-shot fix-up).
//
// Congress.gov returns ONE entry per Congress (2-year block), not one per
// 6-year senate term. So a senator currently in their second term may
// appear as 4+ contiguous senate entries spanning multiple terms. The
// derivation handoff 60 used (`latest.startYear + 6`) collapses every
// sitting senator to next_election_year = 2030 — that bug is what this
// helper exists to fix.

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
