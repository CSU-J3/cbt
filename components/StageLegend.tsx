import { Tooltip } from "@/components/Tooltip";
import { STAGE_LABELS } from "@/lib/enums";

export function StageLegend({ bare = false }: { bare?: boolean } = {}) {
  return (
    <div
      className={`flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] uppercase tracking-[0.5px]${
        bare ? "" : " border-b px-4 py-1.5"
      }`}
      style={{
        // HO 187: `bare` strips the standalone border/bg/padding so band 5
        // (legend + pagination) owns the chrome; default keeps the full strip
        // for the other pages that still render it inside their list box.
        backgroundColor: bare ? undefined : "var(--bg-panel)",
        borderColor: bare ? undefined : "var(--border-soft)",
        color: "var(--text-muted)",
      }}
      aria-label="Legend"
    >
      <span
        style={{ color: "var(--stage-introduced)" }}
        title={STAGE_LABELS.introduced}
      >
        ▸ INTRO
      </span>
      <span style={{ color: "var(--text-dim)" }}>·</span>
      {/* HO 147: first dotted-underline Tooltip application on a coded
          term. The inner span keeps its --stage-committee color; the
          Tooltip's border-bottom underline draws in --text-dim without
          overriding the text color. The five other stages stay on
          native `title` until HO 154's app-wide migration. */}
      <Tooltip
        variant="term"
        ariaLabel={`COMMITTEE — ${STAGE_LABELS.committee}`}
        content={{
          kind: "text",
          label: "▸ COMMITTEE",
          body: STAGE_LABELS.committee,
        }}
      >
        <span style={{ color: "var(--stage-committee)" }}>▸ COMMITTEE</span>
      </Tooltip>
      <span style={{ color: "var(--text-dim)" }}>·</span>
      <span
        style={{ color: "var(--stage-floor)" }}
        title={STAGE_LABELS.floor}
      >
        ▸▸ FLOOR
      </span>
      <span style={{ color: "var(--text-dim)" }}>·</span>
      <span
        style={{ color: "var(--stage-other-chamber)" }}
        title={STAGE_LABELS.other_chamber}
      >
        ▸▸▸ OTHER CHAMBER
      </span>
      <span style={{ color: "var(--text-dim)" }}>·</span>
      <span
        style={{ color: "var(--stage-president)" }}
        title={STAGE_LABELS.president}
      >
        ▸▸▸▸ PRESIDENT
      </span>
      <span style={{ color: "var(--text-dim)" }}>·</span>
      <span
        style={{ color: "var(--stage-enacted)" }}
        title={STAGE_LABELS.enacted}
      >
        ✓ ENACTED
      </span>

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
