import type { RaceRating } from "@/lib/queries";

// Source-attributed rating chip used on /race/[id] (handoff 71). Color is
// driven by the lean; the rating's *strength* is carried in the text alone
// ("LIKELY D" reads stronger than "LEAN D") — no third tint axis. Toss-ups
// break out of the partisan colors into amber so they pop visually.
//
// Rendering: [COOK · TOSS UP]
//   - COOK in 11px muted, letter-spacing 0.5px
//   - rating in 12px (md) or 11px (sm), colored
//   - 1px border in the rating color at 40% opacity, transparent background

// Handles every label across the three v1 sources:
//   Cook + Inside Elections: Solid / Likely / Lean / Toss Up / Lean / Likely / Solid
//   Sabato: Safe (== Solid, equivalent meaning) — substitutes at the safe end
//   Inside Elections: Tilt (a tier between Toss Up and Lean) — partisan-colored
// Toss Up is the only amber state; everything else is partisan-colored by lean.
function colorFor(rating: string): string {
  switch (rating) {
    case "Solid D":
    case "Safe D":
    case "Likely D":
    case "Lean D":
    case "Tilt D":
      return "var(--party-democrat)";
    case "Toss Up":
      return "var(--accent-amber-bright)";
    case "Tilt R":
    case "Lean R":
    case "Likely R":
    case "Solid R":
    case "Safe R":
      return "var(--party-republican)";
    default:
      return "var(--text-muted)";
  }
}

// 40%-opacity rgba forms of the CSS palette colors. Border uses a hand-
// computed rgba so the chip can sit on the dark background without the
// border washing into the text color at full saturation.
function borderColorFor(rating: string): string {
  switch (rating) {
    case "Solid D":
    case "Safe D":
    case "Likely D":
    case "Lean D":
    case "Tilt D":
      return "rgba(59, 130, 246, 0.4)"; // --party-democrat
    case "Toss Up":
      return "rgba(251, 191, 36, 0.4)"; // --accent-amber-bright
    case "Tilt R":
    case "Lean R":
    case "Likely R":
    case "Solid R":
    case "Safe R":
      return "rgba(239, 68, 68, 0.4)"; // --party-republican
    default:
      return "var(--border-strong)";
  }
}

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
  const color = colorFor(rating.rating);
  const borderColor = borderColorFor(rating.rating);
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
