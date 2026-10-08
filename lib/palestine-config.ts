export type PalestineGrade = "A" | "B" | "C" | "D" | "F";

export interface PalestineGradeInfo {
  color: string;
  display: string;
}

// D/F use --vote-nay (rose/coral) rather than --party-republican to avoid
// visual cross-wire with the party dot on a Dem senator's header — same
// alarm register, no party-color collision. Matches the nay color the
// existing PALESTINE SCORECARD section already uses for nay outcomes.
export const PALESTINE_GRADE_CONFIG: Record<PalestineGrade, PalestineGradeInfo> =
  {
    A: { color: "var(--text-secondary)", display: "A" },
    B: { color: "var(--text-secondary)", display: "B" },
    C: { color: "var(--accent-amber)", display: "C" },
    D: { color: "var(--vote-nay)", display: "D" },
    F: { color: "var(--vote-nay)", display: "F" },
  };

export function isPalestineGrade(g: string): g is PalestineGrade {
  return g === "A" || g === "B" || g === "C" || g === "D" || g === "F";
}

// HO 767 — the tracker the grade comes from, by its own name and address (one
// copy: the grade card, the member page's out-link and the sync's CSV export
// all read these). It opens on its House tab; the Senate tab is reached by its
// id, the one scripts/sync-palestine.ts reads.
export const PALESTINE_TRACKER_NAME = "Palestine Tracker";
export const PALESTINE_TRACKER_SHEET =
  "https://docs.google.com/spreadsheets/d/1VU1y_jSb2hanU2MrLsjRx8tujB-C--UAQ2EahaTXGUo";
export const PALESTINE_TRACKER_SENATE_GID = "1260635943";

// The tracker on the member's own tab.
export function palestineTrackerHref(chamber: string | null): string {
  return chamber === "senate"
    ? `${PALESTINE_TRACKER_SHEET}/edit#gid=${PALESTINE_TRACKER_SENATE_GID}`
    : `${PALESTINE_TRACKER_SHEET}/edit`;
}

// Whom a rank is out of: the tracker grades each chamber's Democrats.
export function palestinePoolLabel(chamber: string | null): string {
  return chamber === "senate" ? "Senate Democrats" : "House Democrats";
}
