import {
  PALESTINE_GRADE_CONFIG,
  type PalestineGrade,
} from "@/lib/palestine-config";

// Same chrome as CaucusBadge: 12px uppercase, colored border + text on
// transparent background. Source attribution lives in the tooltip — the
// visible chip stays a single-character glance signal.
export function PalestineBadge({
  grade,
  rank,
}: {
  grade: PalestineGrade;
  rank: number | null;
}) {
  const info = PALESTINE_GRADE_CONFIG[grade];
  const tooltip = rank
    ? `USCPR Palestine scorecard: ${grade} (rank #${rank} of 47)`
    : `USCPR Palestine scorecard: ${grade}`;

  return (
    <span
      className="inline-block px-2 py-[1px] text-[12px] uppercase tracking-[0.5px] tabular-nums"
      style={{
        color: info.color,
        border: `1px solid ${info.color}`,
        borderRadius: "2px",
      }}
      title={tooltip}
    >
      {info.display}
    </span>
  );
}
