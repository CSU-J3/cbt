// HO 393 — pure, client-safe helpers for the PAC-spending (independent
// expenditure) direction line on competitive race cards. No DB, no next/cache,
// no server-only deps, so it can ride into the client card components alongside
// the FEC deep-link builder. The heavy sync/fetch lives in lib/fec.ts +
// scripts/sync-pac-ie.ts; this file is only the render-time formatting + the
// deep-link URL.

export const PAC_IE_CYCLE = 2026;

// United Democracy Project — the AIPAC-affiliated super PAC that is the sole
// IE spender in the 2026 races we track (HO 392 probe: DMFI is a rounding
// error; the AIPAC connected PAC bundles direct contributions, not IEs).
export const UDP_COMMITTEE_ID = "C00799031";
// Internal DB `spender` value (pac_ie_spending.spender) — NOT user-facing. The
// visible label names AIPAC (Corey's HO 393 decision); the UDP identity rides
// the attribution tooltip.
export const UDP_SPENDER = "UDP";

// Visible spender identity lives in the section header (full line) / glance
// prefix (dashboard) and names AIPAC directly; the full "which committee"
// attribution rides the tooltip. Corey's call: name AIPAC, not UDP.
export const PAC_IE_HEADER_LABEL = "AIPAC SUPER PAC · via FEC";
export const PAC_IE_GLANCE_LABEL = "AIPAC super PAC";
export const PAC_IE_ATTRIBUTION =
  "United Democracy Project — AIPAC's affiliated super PAC";

// Deep-link to the live FEC independent-expenditures browser, filtered to this
// spender + candidate + direction, so the reader sees the real dollars/dates at
// the source (the magnitude the app deliberately doesn't reproduce). Param names
// are the FEC data-browser's (`two_year_transaction_period`, not the API's
// `cycle`); the filter is API-verified (HO 393 pre-flight).
export function fecIeUrl(
  committeeId: string,
  candidateId: string,
  supportOppose: string,
  cycle: number,
): string {
  const p = new URLSearchParams({
    committee_id: committeeId,
    candidate_id: candidateId,
    support_oppose_indicator: supportOppose,
    two_year_transaction_period: String(cycle),
  });
  return `https://www.fec.gov/data/independent-expenditures/?${p.toString()}`;
}

// FEC candidate_name is "LAST, FIRST [MIDDLE [SUFFIX]]" (e.g. "STEVENS, HALEY",
// "CONYEARS-ERVIN, MELISSA", "MASSIE, THOMAS REP."). The card renders the
// surname only ("backing Stevens"), so take the part before the comma and
// title-case it (hyphenated surnames get each part capitalized).
export function pacSurname(candidateName: string): string {
  const last = (candidateName.split(",")[0] ?? candidateName).trim();
  return last.toLowerCase().replace(/\b([a-z])/g, (c) => c.toUpperCase());
}

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

// "2026-06-09" → "June" — powers the subordinate "· since {month}" cue from the
// group's earliest expenditure_date. Null-safe.
export function pacSinceMonth(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const m = /^\d{4}-(\d{2})/.exec(iso);
  if (!m) return null;
  const idx = Number.parseInt(m[1]!, 10) - 1;
  return MONTHS[idx] ?? null;
}
