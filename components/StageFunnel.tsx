import Link from "next/link";
import { STAGE_LABELS, type Stage } from "@/lib/enums";
import { type DashboardFilters, getStageDistribution } from "@/lib/queries";

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

const STAGE_COLOR: Record<string, string> = {
  introduced: "var(--stage-introduced)",
  committee: "var(--stage-committee)",
  floor: "var(--stage-floor)",
  other_chamber: "var(--stage-other-chamber)",
  president: "var(--stage-president)",
  enacted: "var(--stage-enacted)",
};

function pctLabel(pct: number): string {
  if (pct <= 0) return "0%";
  if (pct < 1) return "<1%";
  return `${Math.round(pct)}%`;
}

// Toggle `stage` in the dashboard URL, preserving an active topic filter.
function buildHref(stage: string, filters?: DashboardFilters): string {
  const params = new URLSearchParams();
  if (filters?.stage !== stage) params.set("stage", stage);
  if (filters?.topic) params.set("topics", filters.topic);
  const qs = params.toString();
  return qs ? `/?${qs}` : "/";
}

export async function StageFunnel({
  filters,
}: {
  filters?: DashboardFilters;
}) {
  const { bars, offPath } = await getStageDistribution(filters);
  const maxCount = bars.reduce((m, b) => Math.max(m, b.count), 0);
  const activeStage = filters?.stage;

  return (
    <div>
      <div className="flex flex-col">
        {bars.map((b) => {
          const color = STAGE_COLOR[b.stage] ?? "var(--text-muted)";
          const width =
            maxCount > 0 && b.count > 0
              ? Math.max(1.5, (b.count / maxCount) * 100)
              : 0;
          const dimmed = !!activeStage && activeStage !== b.stage;
          return (
            <Link
              key={b.stage}
              href={buildHref(b.stage, filters)}
              className="funnel-row"
              style={{ opacity: dimmed ? 0.4 : 1 }}
              title={STAGE_LABELS[b.stage as Stage] ?? undefined}
            >
              <span
                className="text-[12px] uppercase tracking-[0.5px]"
                style={{ color }}
              >
                {STAGE_PREFIX[b.stage]} {STAGE_LABEL[b.stage]}
              </span>
              <span className="funnel-bar-track">
                <span
                  className="funnel-bar-fill"
                  style={{ width: `${width}%`, backgroundColor: color }}
                  aria-hidden
                />
              </span>
              <span
                className="text-right text-[12px] tabular-nums whitespace-nowrap"
                style={{ color: "var(--text-secondary)" }}
              >
                {b.count.toLocaleString()} ({pctLabel(b.percentage)})
              </span>
            </Link>
          );
        })}
      </div>
      {offPath > 0 ? (
        <p className="mt-2 text-[12px]" style={{ color: "var(--text-dim)" }}>
          + {offPath.toLocaleString()} bills off-path
        </p>
      ) : null}
    </div>
  );
}
