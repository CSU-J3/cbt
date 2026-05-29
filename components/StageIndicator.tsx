import { Tooltip } from "@/components/Tooltip";
import { STAGE_LABELS } from "@/lib/enums";

const STAGE_PREFIX: Record<string, string> = {
  introduced: "▸",
  committee: "▸",
  floor: "▸▸",
  other_chamber: "▸▸▸",
  president: "▸▸▸▸",
  enacted: "✓",
};

const STAGE_LABEL: Record<string, string> = {
  introduced: "INTRO",
  committee: "COMMITTEE",
  floor: "FLOOR",
  other_chamber: "OTHER CHAMBER",
  president: "PRESIDENT",
  enacted: "ENACTED",
};

const STAGE_LABEL_SHORT: Record<string, string> = {
  introduced: "INTRO",
  committee: "COMM",
  floor: "FLR",
  other_chamber: "OCHM",
  president: "PRES",
  enacted: "ENCT",
};

const STAGE_COLOR: Record<string, string> = {
  introduced: "var(--stage-introduced)",
  committee: "var(--stage-committee)",
  floor: "var(--stage-floor)",
  other_chamber: "var(--stage-other-chamber)",
  president: "var(--stage-president)",
  enacted: "var(--stage-enacted)",
};

// HO 154.6: stage chips are coded terms (▸ COMMITTEE etc.) — the codes
// graduate from HO 123's native `title` attribute to the HO 147 Tooltip
// term variant. The inner span keeps the stage color; the Tooltip's
// border-bottom underline draws in --text-dim and the hover panel
// surfaces the STAGE_LABELS active-voice clause. Status-only labels
// elsewhere (StagePillStrip's "3w in Committee", PalestineBadge, etc.)
// stay on native title per the cleanup rule.
export function StageIndicator({
  stage,
  responsive = false,
  muted = false,
}: {
  stage: string | null;
  responsive?: boolean;
  muted?: boolean;
}) {
  if (!stage) return null;
  const prefix = STAGE_PREFIX[stage] ?? "▸";
  const full = STAGE_LABEL[stage] ?? stage.toUpperCase();
  const short = STAGE_LABEL_SHORT[stage] ?? full;
  const color = muted
    ? "var(--text-dim)"
    : (STAGE_COLOR[stage] ?? "var(--text-muted)");
  const description =
    STAGE_LABELS[stage as keyof typeof STAGE_LABELS] ?? stage;
  return (
    <Tooltip
      variant="term"
      ariaLabel={`${full} — ${description}`}
      content={{
        kind: "text",
        label: `${prefix} ${full}`,
        body: description,
      }}
    >
      <span
        className="inline-flex items-center gap-1.5 text-[14px] uppercase tracking-[0.5px]"
        style={{ color }}
      >
        <span aria-hidden>{prefix}</span>
        {responsive ? (
          <>
            <span className="show-desktop">{full}</span>
            <span className="show-mobile">{short}</span>
          </>
        ) : (
          <span>{full}</span>
        )}
      </span>
    </Tooltip>
  );
}
