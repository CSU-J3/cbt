// Single source of truth for the caucus display layer (handoff 61).
// The `affiliations` table accepts any `org` string; this config governs
// which orgs actually render and what they look like. Add a new caucus by
// extending CaucusOrg + CAUCUS_CONFIG; the data layer needs no change.

export type CaucusOrg =
  | "freedom_caucus"
  | "rsc"
  | "progressive_caucus"
  | "new_dem";

export interface CaucusInfo {
  display: string;
  fullName: string;
  party: "R" | "D";
  color: string;
  // Lower = higher priority. Drives ordering everywhere and decides which
  // badges survive header truncation (top-2). Freedom > RSC because Freedom
  // is the more differentiating signal at ~30-40 members; RSC covers most
  // of the House R conference. Progressive > New Dem for the same reason
  // on the D side.
  priority: number;
}

export const CAUCUS_CONFIG: Record<CaucusOrg, CaucusInfo> = {
  freedom_caucus: {
    display: "FREEDOM",
    fullName: "House Freedom Caucus",
    party: "R",
    color: "var(--party-republican)",
    priority: 1,
  },
  rsc: {
    display: "RSC",
    fullName: "Republican Study Committee",
    party: "R",
    color: "var(--party-republican)",
    priority: 2,
  },
  progressive_caucus: {
    display: "PROG",
    fullName: "Congressional Progressive Caucus",
    party: "D",
    color: "var(--party-democrat)",
    priority: 3,
  },
  new_dem: {
    display: "NEW DEM",
    fullName: "New Democrat Coalition",
    party: "D",
    color: "var(--party-democrat)",
    priority: 4,
  },
};

export function isCaucusOrg(s: string): s is CaucusOrg {
  return s in CAUCUS_CONFIG;
}
