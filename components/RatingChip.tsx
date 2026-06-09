import { RACE_RATING_SOURCES } from "@/lib/enums";
import type { RaceRating } from "@/lib/queries";
import { ratingBorderColor, ratingColor } from "@/lib/race-colors";

// Source-attributed rating chip used on /race/[id] (handoff 71). Color is
// driven by the lean; the rating's *strength* is carried in the text alone
// ("LIKELY D" reads stronger than "LEAN D") — no third tint axis. Toss-ups
// break out of the partisan colors into amber so they pop visually.
//
// HO 222: the lean-only color + 40%-opacity border logic moved to
// lib/race-colors.ts (ratingColor / ratingBorderColor) so the /races MAP card,
// the /races LIST spread bar/chip, and this chip all key off one source.
//
// Rendering: [COOK · TOSS UP]
//   - COOK in 11px muted, letter-spacing 0.5px
//   - rating in 12px (md) or 11px (sm), colored
//   - 1px border in the rating color at 40% opacity, transparent background

function sourceLabel(source: RaceRating["source"]): string {
  switch (source) {
    case "cook":
      return "Cook";
    case "sabato":
      return "Sabato";
    case "inside_elections":
      return "Inside Elections";
  }
}

export function RatingChip({
  rating,
  size = "md",
}: {
  rating: RaceRating;
  size?: "sm" | "md";
}) {
  const color = ratingColor(rating.rating);
  const borderColor = ratingBorderColor(rating.rating);
  const ratingSize = size === "sm" ? "11px" : "12px";
  const title = rating.ratingDate ? `Updated ${rating.ratingDate}` : undefined;

  return (
    <span
      className="inline-flex items-center gap-2 px-2 py-[1px] uppercase tracking-[0.5px] tabular-nums"
      style={{
        border: `1px solid ${borderColor}`,
        borderRadius: "2px",
      }}
      title={title}
    >
      <span
        className="text-[11px]"
        style={{ color: "var(--text-muted)" }}
        title={RACE_RATING_SOURCES[rating.source]}
      >
        {sourceLabel(rating.source)}
      </span>
      <span aria-hidden style={{ color: "var(--text-dim)" }}>
        ·
      </span>
      <span style={{ color, fontSize: ratingSize }}>{rating.rating}</span>
    </span>
  );
}
