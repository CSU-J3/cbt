import type { HTMLAttributes, Ref } from "react";
import {
  PALESTINE_GRADE_CONFIG,
  PALESTINE_TRACKER_NAME,
  palestinePoolLabel,
  type PalestineGrade,
} from "@/lib/palestine-config";

// Same chrome as CaucusBadge: 12px uppercase, colored border + text on
// transparent background. Source attribution lives in the tooltip — the
// visible chip stays a single-character glance signal.
//
// HO 767: with `trigger` the chip is the grade card's trigger (components/
// GradeCard.tsx GradeChip): it takes the card's handlers and ARIA, and drops
// the native title, which would otherwise open a second tooltip over the card.
// The title names the tracker by its own name, not USCPR ("i dont want to say
// they take care of it if they dont", v9), and the rank is out of the pool the
// table holds for the member's chamber (getPalestinePools), not a typed 47.
export function PalestineBadge({
  grade,
  rank,
  pool = null,
  chamber = null,
  trigger,
}: {
  grade: PalestineGrade;
  rank: number | null;
  pool?: number | null;
  chamber?: string | null;
  trigger?: HTMLAttributes<HTMLSpanElement> & { ref?: Ref<HTMLSpanElement> };
}) {
  const info = PALESTINE_GRADE_CONFIG[grade];
  const tooltip = rank
    ? `${PALESTINE_TRACKER_NAME}: ${grade} (#${rank}${pool ? ` of ${pool} ${palestinePoolLabel(chamber)}` : ""})`
    : `${PALESTINE_TRACKER_NAME}: ${grade}`;

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
