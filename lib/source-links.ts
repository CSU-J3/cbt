// HO 786: the one copy of every out-link URL a sources line uses (components/SourcesLine.tsx). Where a reader's
// link and a sync's fetch are the same upstream page, the sync reads it from here too. Import-safe, with no
// server-only import, because ElectoralBoard, a client component, renders a line that links one of these.

// A Senate roll call on senate.gov, the roll zero-padded to five digits as the vote menu prints it. The sync
// reads the XML (lib/senate-votes-sync.ts detailUrl); a reader opens the HTML page at the same path (HO 786
// STEP 0: 200, with the roll number in the body, on three real roll calls).
export function senateRollCallUrl(
  congress: number,
  session: number,
  roll: number | string,
  ext: "xml" | "htm",
): string {
  const padded = String(roll).padStart(5, "0");
  return `https://www.senate.gov/legislative/LIS/roll_call_votes/vote${congress}${session}/vote_${congress}_${session}_${padded}.${ext}`;
}

// 270toWin's 2026 statewide primary calendar: lib/primary-calendar-scrape.ts reads the primary dates from it.
export const PRIMARY_CALENDAR_URL = "https://www.270towin.com/2026-state-primary-calendar/";

// The Lobbying Disclosure Act site, whose API lib/lda-sync.ts reads. Its home redirects to /system/public/
// (HO 786 STEP 0: 200 there).
export const LDA_HOME_URL = "https://lda.gov/";
