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

export function StageIndicator({
  stage,
  responsive = false,
}: {
  stage: string | null;
  responsive?: boolean;
}) {
  if (!stage) return null;
  const prefix = STAGE_PREFIX[stage] ?? "▸";
  const full = STAGE_LABEL[stage] ?? stage.toUpperCase();
  const short = STAGE_LABEL_SHORT[stage] ?? full;
  const color = STAGE_COLOR[stage] ?? "var(--text-muted)";
  return (
    <span
      className="inline-flex items-center gap-1.5 text-[10px] uppercase tracking-[0.5px]"
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
  );
}
