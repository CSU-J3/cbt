"use client";

// HO 365 — the weekly-band rich hover card. Replaces the flat HO 284 popover
// (the Tooltip primitive only does label+body / label+count). Wraps a metric's
// inline trigger (passed as children) and, on hover/focus, shows a static card
// PORTALED to <body> at a fixed position below the metric (upward pointer). The
// portal is the proven pattern for this strip (the markets tape + the old
// MetricTip both portal) — the dashboard has stacking complexity (z-30 tapes,
// :has hover overlays) and dv2-grid paints after the band, so an in-flow
// absolute card would be occluded. Static: no transitions/animation.
import {
  type ReactNode,
  useCallback,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { topicLabel } from "@/lib/topic-colors";

// Destination ladder — fixed 5 rows in canonical order; zero-count rows stay,
// dimmed (HO 352 convention). `token` is the --stage-* CSS var (all match the
// spec hexes — no divergence). other_chamber's token is hyphenated.
const LADDER: { stage: string; label: string; token: string }[] = [
  { stage: "committee", label: "→COMMITTEE", token: "--stage-committee" },
  { stage: "floor", label: "→FLOOR", token: "--stage-floor" },
  { stage: "other_chamber", label: "→OTHER CHAMBER", token: "--stage-other-chamber" },
  { stage: "president", label: "→PRESIDENT", token: "--stage-president" },
  { stage: "enacted", label: "→ENACTED", token: "--stage-enacted" },
];

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];
function monDd(iso: string): string {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

export type WeeklyBandBreakdown =
  | { kind: "transitions"; ladder: Record<string, number> }
  | {
      kind: "hearings";
      byType: { HEARINGS: number; MARKUPS: number; BUSINESS: number };
      byChamber: { house: number; senate: number };
    }
  | {
      kind: "newbills";
      house: number;
      senate: number;
      topTopics: { topic: string; n: number }[];
    }
  | {
      kind: "enacted";
      bills: { id: string; billType: string; billNumber: number }[];
      lastEnacted: { billType: string; billNumber: number; date: string } | null;
    };

const CARD_W = 280;

export function WeeklyBandMetricCard({
  label,
  value,
  prior,
  priorDate,
  spark,
  breakdown,
  children,
}: {
  label: string;
  value: number;
  prior: number;
  /** ISO date (YYYY-MM-DD) of the prior 7d window's edge — rendered MON DD. */
  priorDate: string;
  /** ≤8 weekly values, oldest→newest; the LAST is the running (current) week. */
  spark: number[];
  breakdown: WeeklyBandBreakdown;
  children: ReactNode;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  const show = useCallback(() => {
    const el = ref.current;
    if (!el || typeof window === "undefined") return;
    const r = el.getBoundingClientRect();
    const left = Math.min(Math.max(8, r.left), window.innerWidth - CARD_W - 8);
    setPos({ left, top: r.bottom + 8 });
  }, []);
  const hide = useCallback(() => setPos(null), []);

  const diff = value - prior;
  const dir = diff > 0 ? "up" : diff < 0 ? "down" : "flat";
  const deltaText =
    dir === "flat" ? "±0" : `${dir === "up" ? "▲" : "▼"}${Math.abs(diff).toLocaleString()}`;

  const max = Math.max(1, ...spark);
  const avg = spark.length
    ? Math.round(spark.reduce((a, b) => a + b, 0) / spark.length)
    : 0;
  const hi = spark.length ? Math.max(...spark) : 0;

  const card =
    pos && typeof document !== "undefined"
      ? createPortal(
          <div
            className="wb-card"
            style={{ left: pos.left, top: pos.top, width: CARD_W }}
            aria-hidden
          >
            <div className="wb-card-arrow" aria-hidden />
            <div className="wb-card-head">{label}</div>
            <div className="wb-card-valrow">
              <span className="wb-card-val tabular-nums">
                {value.toLocaleString()}
              </span>
              <span className={`weekly-band-delta weekly-band-delta--${dir}`}>
                {deltaText} vs last wk
              </span>
            </div>
            <div className="wb-card-sub">
              last wk {prior.toLocaleString()} · {monDd(priorDate)}
            </div>

            <div className="wb-card-divider" />
            <div className="wb-card-section">
              <span className="wb-card-section-label">8-week trend</span>
              <span className="wb-card-section-stat tabular-nums">
                avg {avg} · hi {hi}
              </span>
            </div>
            <div className="wb-spark" aria-hidden>
              {spark.map((v, i) => (
                <span
                  // eslint-disable-next-line react/no-array-index-key
                  key={i}
                  className="wb-spark-bar"
                  style={{
                    height: `${Math.max(2, Math.round((v / max) * 24))}px`,
                    background:
                      i === spark.length - 1
                        ? "var(--accent-amber-bright)"
                        : "#38414f",
                  }}
                />
              ))}
            </div>

            <div className="wb-card-divider" />
            <Breakdown breakdown={breakdown} />
          </div>,
          document.body,
        )
      : null;

  return (
    <span
      ref={ref}
      className="wb-metric"
      tabIndex={0}
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
    >
      {children}
      {card}
    </span>
  );
}

function Breakdown({ breakdown }: { breakdown: WeeklyBandBreakdown }) {
  if (breakdown.kind === "transitions") {
    return (
      <div className="wb-bd">
        <div className="wb-card-section-label">where they went</div>
        {LADDER.map((row) => {
          const c = breakdown.ladder[row.stage] ?? 0;
          return (
            <div
              key={row.stage}
              className={`wb-bd-row${c === 0 ? " wb-bd-zero" : ""}`}
            >
              <span
                className="wb-tick"
                style={{ background: `var(${row.token})` }}
                aria-hidden
              />
              <span className="wb-bd-label">{row.label}</span>
              <span className="wb-bd-count tabular-nums">
                {c.toLocaleString()}
              </span>
            </div>
          );
        })}
      </div>
    );
  }

  if (breakdown.kind === "hearings") {
    const { byType, byChamber } = breakdown;
    const rows: [string, number][] = [
      ["HEARINGS", byType.HEARINGS],
      ["MARKUPS", byType.MARKUPS],
      ["BUSINESS", byType.BUSINESS],
    ];
    return (
      <div className="wb-bd">
        <div className="wb-card-section-label">by type</div>
        {rows.map(([k, n]) => (
          <div key={k} className={`wb-bd-row${n === 0 ? " wb-bd-zero" : ""}`}>
            <span className="wb-bd-label">{k}</span>
            <span className="wb-bd-count tabular-nums">
              {n.toLocaleString()}
            </span>
          </div>
        ))}
        <div className="wb-bd-inline">
          chamber{" "}
          <span className="wb-bd-inline-val tabular-nums">
            HOUSE {byChamber.house} · SENATE {byChamber.senate}
          </span>
        </div>
      </div>
    );
  }

  if (breakdown.kind === "newbills") {
    return (
      <div className="wb-bd">
        <div className="wb-card-section-label">by chamber</div>
        <div className="wb-bd-row">
          <span className="wb-bd-label">HOUSE</span>
          <span className="wb-bd-count tabular-nums">
            {breakdown.house.toLocaleString()}
          </span>
        </div>
        <div className="wb-bd-row">
          <span className="wb-bd-label">SENATE</span>
          <span className="wb-bd-count tabular-nums">
            {breakdown.senate.toLocaleString()}
          </span>
        </div>
        {breakdown.topTopics.length > 0 ? (
          <div className="wb-bd-inline">
            top topics{" "}
            <span className="wb-bd-inline-val">
              {breakdown.topTopics
                .map((t) => `${topicLabel(t.topic)} ${t.n}`)
                .join(" · ")}
            </span>
          </div>
        ) : null}
      </div>
    );
  }

  // enacted
  if (breakdown.bills.length > 0) {
    return (
      <div className="wb-bd">
        <div className="wb-card-section-label">enacted this week</div>
        {breakdown.bills.map((b) => (
          <div key={b.id} className="wb-bd-row">
            <span className="wb-bd-label">
              {b.billType.toUpperCase()} {b.billNumber}
            </span>
          </div>
        ))}
      </div>
    );
  }
  return (
    <div className="wb-bd">
      <div className="wb-bd-degrade">none reached the president</div>
      {breakdown.lastEnacted ? (
        <div className="wb-bd-inline">
          last enacted{" "}
          <span className="wb-bd-inline-val">
            {breakdown.lastEnacted.billType.toUpperCase()}{" "}
            {breakdown.lastEnacted.billNumber} · {monDd(breakdown.lastEnacted.date)}
          </span>
        </div>
      ) : null}
    </div>
  );
}
