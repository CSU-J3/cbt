"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { type MouseEvent } from "react";
import type { Stage } from "@/lib/enums";

// home-dashboard-cleanup: bottleneck funnel that replaces the row-2
// stage bubble. Sqrt-scaled horizontal bars in pipeline order (INTRO →
// COMMITTEE → FLOOR → OTHER → PRESIDENT → ENACTED). Bars are centered
// inside their track so the row stack reads as the classic bottleneck
// shape — widest at COMMITTEE, narrowing toward both ends. Click toggles
// `?stage=<id>` exactly like the prior bubble; cmd/ctrl/shift/alt-click
// keeps the browser-native /bills escape via the wrapping <a href>.

type StageBar = {
  stage: Stage;
  count: number;
  /** Percentage of substantive on-path bills, 0-100 — supplied by
   * `getStageDistribution`. Used verbatim in the hover tooltip. */
  percentage: number;
};

const STAGE_LABELS: Record<Stage, string> = {
  introduced: "INTRO",
  committee: "COMMITTEE",
  floor: "FLOOR",
  other_chamber: "OTHER",
  president: "PRESIDENT",
  enacted: "ENACTED",
};

const STAGE_TOOLTIP_LABELS: Record<Stage, string> = {
  introduced: "Introduced",
  committee: "Committee",
  floor: "Floor",
  other_chamber: "Other chamber",
  president: "President",
  enacted: "Enacted",
};

const STAGE_COLORS: Record<Stage, string> = {
  introduced: "var(--stage-introduced)",
  committee: "var(--stage-committee)",
  floor: "var(--stage-floor)",
  other_chamber: "var(--stage-other-chamber)",
  president: "var(--stage-president)",
  enacted: "var(--stage-enacted)",
};

// Floor in % of track width so the PRESIDENT row renders visibly even
// at count 0 (handoff: "min-width ~4-6px even at count 0"). The CSS
// also pins `min-width: 4px` on the bar element as a px-level backstop
// if the track gets very narrow at small viewports.
const MIN_BAR_PCT = 2.2;

export function StageFunnel({ bars }: { bars: StageBar[] }) {
  const router = useRouter();
  const params = useSearchParams();
  const currentStage = params.get("stage");

  const maxCount = bars.reduce((m, b) => Math.max(m, b.count), 0);
  const sqrtMax = Math.sqrt(maxCount) || 1;

  function buildHref(stage: Stage, isSelected: boolean): string {
    const next = new URLSearchParams(params.toString());
    if (isSelected) next.delete("stage");
    else next.set("stage", stage);
    const qs = next.toString();
    return qs ? `/?${qs}` : "/";
  }

  function handleClick(e: MouseEvent<HTMLAnchorElement>, href: string) {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) {
      return;
    }
    e.preventDefault();
    router.push(href, { scroll: false });
  }

  const anySelected =
    !!currentStage && bars.some((b) => b.stage === currentStage);

  return (
    <ul className="stage-funnel" role="list" aria-label="Stage distribution">
      {bars.map((b) => {
        const isSelected = currentStage === b.stage;
        const dimmed = anySelected && !isSelected;
        const rawPct = (Math.sqrt(b.count) / sqrtMax) * 100;
        const widthPct = Math.max(rawPct, MIN_BAR_PCT);
        const href = buildHref(b.stage, isSelected);
        const tooltip = `${STAGE_TOOLTIP_LABELS[b.stage]} · ${b.count.toLocaleString()} bills · ${b.percentage.toFixed(1)}% of corpus · click to filter`;
        return (
          <li key={b.stage}>
            <a
              href={href}
              onClick={(e) => handleClick(e, href)}
              title={tooltip}
              aria-label={tooltip}
              className={`stage-funnel-row${isSelected ? " is-selected" : ""}${dimmed ? " is-dimmed" : ""}`}
            >
              <span className="stage-funnel-label">
                {STAGE_LABELS[b.stage]}
              </span>
              <span className="stage-funnel-track">
                <span
                  className="stage-funnel-bar"
                  style={{
                    width: `${widthPct}%`,
                    backgroundColor: STAGE_COLORS[b.stage],
                  }}
                  aria-hidden
                />
              </span>
              <span className="stage-funnel-count">
                {b.count.toLocaleString()}
              </span>
            </a>
          </li>
        );
      })}
    </ul>
  );
}
