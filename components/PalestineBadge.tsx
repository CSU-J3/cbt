import type { HTMLAttributes, Ref } from "react";
import {
  PALESTINE_GRADE_CONFIG,
  type PalestineGrade,
} from "@/lib/palestine-config";

// Same chrome as CaucusBadge: 12px uppercase, colored border + text on
// transparent background. Source attribution lives in the tooltip — the
// visible chip stays a single-character glance signal.
//
// HO 767: with `trigger` the chip is the grade card's trigger (components/
// GradeCard.tsx GradeChip): it takes the card's handlers and ARIA, and drops
// the native title, which would otherwise open a second tooltip over the card.
export function PalestineBadge({
  grade,
  rank,
  trigger,
}: {
  grade: PalestineGrade;
  rank: number | null;
  trigger?: HTMLAttributes<HTMLSpanElement> & { ref?: Ref<HTMLSpanElement> };
}) {
  const info = PALESTINE_GRADE_CONFIG[grade];
  const tooltip = rank
    ? `USCPR Palestine scorecard: ${grade} (rank #${rank} of 47)`
    : `USCPR Palestine scorecard: ${grade}`;

  return (
    <span
      className={`inline-block px-2 py-[1px] text-[length:var(--fs-12)] uppercase tracking-[0.5px] tabular-nums${trigger ? " palestine-badge--trigger" : ""}`}
      style={{
        color: info.color,
        border: `1px solid ${info.color}`,
        borderRadius: "2px",
      }}
      title={trigger ? undefined : tooltip}
      {...trigger}
    >
      {info.display}
    </span>
  );
}
