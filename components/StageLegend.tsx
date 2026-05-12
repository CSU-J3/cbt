export function StageLegend() {
  return (
    <div
      className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b px-4 py-1.5 text-[12px] uppercase tracking-[0.5px]"
      style={{
        backgroundColor: "var(--bg-panel)",
        borderColor: "var(--border-soft)",
        color: "var(--text-muted)",
      }}
      aria-label="Legend"
    >
      <span style={{ color: "var(--stage-introduced)" }}>▸ INTRO</span>
      <span style={{ color: "var(--text-dim)" }}>·</span>
      <span style={{ color: "var(--stage-committee)" }}>▸ COMMITTEE</span>
      <span style={{ color: "var(--text-dim)" }}>·</span>
      <span style={{ color: "var(--stage-floor)" }}>▸▸ FLOOR</span>
      <span style={{ color: "var(--text-dim)" }}>·</span>
      <span style={{ color: "var(--stage-other-chamber)" }}>▸▸▸ OTHER CHAMBER</span>
      <span style={{ color: "var(--text-dim)" }}>·</span>
      <span style={{ color: "var(--stage-president)" }}>▸▸▸▸ PRESIDENT</span>
      <span style={{ color: "var(--text-dim)" }}>·</span>
      <span style={{ color: "var(--stage-enacted)" }}>✓ ENACTED</span>

      <span aria-hidden className="mx-1" style={{ color: "var(--text-dim)" }}>
        ·
      </span>

      <span className="flex items-center gap-1">
        <span
          aria-hidden
          className="inline-block h-2 w-2"
          style={{ backgroundColor: "var(--party-republican)" }}
        />
        R
      </span>
      <span className="flex items-center gap-1">
        <span
          aria-hidden
          className="inline-block h-2 w-2"
          style={{ backgroundColor: "var(--party-democrat)" }}
        />
        D
      </span>
      <span className="flex items-center gap-1">
        <span
          aria-hidden
          className="inline-block h-2 w-2"
          style={{ backgroundColor: "var(--party-independent)" }}
        />
        I
      </span>
    </div>
  );
}
