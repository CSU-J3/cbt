import { STAGE_LABELS, type Stage } from "@/lib/enums";
import { formatRelativeAgeLong } from "@/lib/format";

// Three-state stage display (HO 125). Pre-flight found only 3% of bills
// have a recorded `stage_changed_at`, so the mockup's "INTRODUCED · 9MO
// AGO → COMMITTEE · 1D AGO" literal design fails on the other 97%. This
// strip degrades gracefully:
//
//   1. stage='introduced' + no transition recorded  →  one pill "INTRODUCED · Xmo"
//   2. stage_changed_at present                     →  "INTRODUCED · Xmo → STAGE · Yd"
//   3. stage != 'introduced' but stage_changed_at NULL (the 14k legacy
//      committee bills)                             →  "INTRODUCED · Xmo → STAGE" (no time on pill 2)
//
// Pill 1 anchors to introduced_date because that column is 100% populated.
// HO 123 tooltips ride along — each pill's title comes from STAGE_LABELS.
//
// Color treatment:
//   - history pill (first one in a 2-pill render): muted via the
//     .stage-pill--history class (opacity 0.6); stage color still drives
//     the border/text so the eye reads "INTRODUCED" as the introduced
//     color even at lower contrast
//   - current pill: full saturation
//
// The strip omits introduced_date entirely if it's somehow null (defensive;
// the column is NOT NULL on every bill in the corpus today). In that
// edge case it renders the current stage as a single pill with no time.

const STAGE_COLOR: Record<string, string> = {
  introduced: "var(--stage-introduced)",
  committee: "var(--stage-committee)",
  floor: "var(--stage-floor)",
  other_chamber: "var(--stage-other-chamber)",
  president: "var(--stage-president)",
  enacted: "var(--stage-enacted)",
};

function stageColor(stage: string): string {
  return STAGE_COLOR[stage] ?? "var(--text-muted)";
}

function stageTitle(stage: string): string | undefined {
  return STAGE_LABELS[stage as Stage] ?? undefined;
}

function StagePill({
  stage,
  age,
  history = false,
}: {
  stage: string;
  age: string | null;
  history?: boolean;
}) {
  return (
    <span
      className={`stage-pill${history ? " stage-pill--history" : ""}`}
      style={{ color: stageColor(stage) }}
      title={stageTitle(stage)}
    >
      <span>{stage.replace(/_/g, " ").toUpperCase()}</span>
      {age ? (
        <>
          <span aria-hidden style={{ color: "currentColor", opacity: 0.5 }}>
            ·
          </span>
          <span>{age.toUpperCase()}</span>
        </>
      ) : null}
    </span>
  );
}

export function StagePillStrip({
  stage,
  introducedDate,
  stageChangedAt,
}: {
  stage: string | null;
  introducedDate: string | null;
  stageChangedAt: string | null;
}) {
  if (!stage) return null;

  // Case 1: introduced-only, no transition. Single pill with intro age.
  if (stage === "introduced") {
    return (
      <span className="stage-pill-strip">
        <StagePill
          stage="introduced"
          age={introducedDate ? formatRelativeAgeLong(introducedDate) : null}
        />
      </span>
    );
  }

  // Cases 2 + 3: two pills. The current pill's age is `stage_changed_at`
  // when we have it, else null (which renders as a pill without a · age
  // segment). The introduced pill always shows time-since intro when the
  // column is populated.
  const introAge = introducedDate
    ? formatRelativeAgeLong(introducedDate)
    : null;
  const currentAge = stageChangedAt
    ? formatRelativeAgeLong(stageChangedAt)
    : null;

  return (
    <span className="stage-pill-strip">
      <StagePill stage="introduced" age={introAge} history />
      <span aria-hidden className="stage-pill-arrow">
        →
      </span>
      <StagePill stage={stage} age={currentAge} />
    </span>
  );
}
