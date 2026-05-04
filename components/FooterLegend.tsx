export function FooterLegend() {
  return (
    <footer
      className="mt-auto border-t"
      style={{
        backgroundColor: "var(--bg-panel)",
        borderColor: "var(--border-strong)",
      }}
    >
      <div
        className="flex w-full flex-wrap items-center justify-between gap-3 px-4 py-2.5 text-[12px] uppercase tracking-[0.5px]"
        style={{ color: "var(--text-dim)" }}
      >
        <div className="flex items-center gap-3">
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
        <div className="flex flex-wrap items-center gap-2">
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
        </div>
      </div>
    </footer>
  );
}
