// HO 750 — the race page's stub sentence, for a race with no rating, no
// rating chips, no roster rows and no runoff (components/RaceHubBody.tsx
// isStub). Until HO 750 an incumbent always read "Incumbent running for
// re-election", and nothing checked it. Now that clause is said only when the
// ballot shows the incumbent (lib/incumbent-on-ballot.ts, true); when the
// ballot was read and the incumbent is on no row (false), or there is no
// ballot reading (null), the rating clause stands alone. Nothing is said about
// WHY an incumbent is off the ballot: that copy is Corey's (the backlog line "A
// race card names a stored incumbent who is not on that seat's 2026 ballot…",
// HO 747). The open-seat sentence is unchanged.
export function stubSentence(hasIncumbent: boolean, incumbentOnBallot: boolean | null): string {
  if (!hasIncumbent) return "Open seat. Candidate filings forthcoming.";
  return incumbentOnBallot === true
    ? "Incumbent running for re-election. No competitive rating yet."
    : "No competitive rating yet.";
}
