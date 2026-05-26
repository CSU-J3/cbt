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
