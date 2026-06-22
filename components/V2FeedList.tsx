"use client";

// HO 257 — Dashboard v2 feed list (MOVERS / TOP STALLS / NEW THIS WEEK). The
// collapsed rowhead (id chip · sans title · shared TopicChips · per-tab metric ·
// caret) plus the expanded panel.
//
// HO 317: the rich expand was extracted to the shared components/BillExpandPanel
// (rendered identically on /bills), and the dashboard now expands on HOVER (CSS
// :hover / :focus-within, the panel mounted nested in the row) instead of click —
// single-open is automatic (one row hovered at a time). Panel data (committees /
// news / meetings) lazy-loads the first time a row is hovered or focused, cached
// per bill, so the 35 mounted-but-hidden panels don't each fire a fetch. Touch
// (no hover) + the keyboard path are noted in the handoff — focus-within covers
// keyboard; touch expand lands with the mobile redesign.
import { useEffect, useRef, useState } from "react";
import { daysSince, formatBillId, formatRelativeAge, parseTopics } from "@/lib/format";
import { BillExpandPanel } from "@/components/BillExpandPanel";
import { TopicChips } from "@/components/TopicChips";
import type { FeedBill } from "@/lib/queries";
import type { PanelData } from "@/components/BillExpandedPanel";

export type V2MetricMode = "movers" | "stalls" | "new";

// Stage → compact abbreviation for the collapsed-row transition (mock spec).
const STAGE_ABBR: Record<string, string> = {
  introduced: "INTRO",
  committee: "CMTE",
  floor: "FLOOR",
  other_chamber: "OTHER",
  president: "PRES",
  enacted: "ENACTED",
};

// HO 297: title cell with markTrunc — the full-title popover (.title-pop) arms
// only when the title actually ellipsizes (scrollWidth > clientWidth). Re-checks
// on resize so the arm state tracks the column width.
function TitleCell({ title }: { title: string }) {
  const ref = useRef<HTMLSpanElement | null>(null);
  const [truncated, setTruncated] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setTruncated(el.scrollWidth > el.clientWidth + 1);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [title]);
  return (
    <span className={`v2f-title-wrap${truncated ? " truncated" : ""}`}>
      <span ref={ref} className="v2f-title">
        {title}
      </span>
      <span className="title-pop">{title}</span>
    </span>
  );
}

// Per-tab right-side indicator. Movers show the abbreviated last transition
// (FROM → TO · ago); stalls show stuck duration; new shows time since intro.
// Never force a FROM → TO onto a stall/new row (handoff).
function Metric({ bill, mode }: { bill: FeedBill; mode: V2MetricMode }) {
  if (mode === "movers") {
    const to = bill.stage ? (STAGE_ABBR[bill.stage] ?? bill.stage.toUpperCase()) : "—";
    const from = bill.previous_stage
      ? (STAGE_ABBR[bill.previous_stage] ?? bill.previous_stage.toUpperCase())
      : null;
    const ago = formatRelativeAge(bill.stage_changed_at);
    return (
      <span className="v2f-metric">
        {from ? (
          <>
            {from} <span className="v2f-ar">→</span>{" "}
          </>
        ) : null}
        {to} · {ago}
      </span>
    );
  }
  if (mode === "stalls") {
    return (
      <span className="v2f-metric">{daysSince(bill.latest_action_date)}d stuck</span>
    );
  }
  // new
  return <span className="v2f-metric">INTRO · {formatRelativeAge(bill.introduced_date)}</span>;
}

export function V2FeedList({
  bills,
  metricMode,
}: {
  bills: FeedBill[];
  metricMode: V2MetricMode;
}) {
  const [cache, setCache] = useState<Record<string, PanelData>>({});
  const [hoverId, setHoverId] = useState<string | null>(null);

  // Lazy-load committee + news + meetings for the hovered/focused bill (once;
  // cached thereafter). The panel renders summary + stage bar + meta from the
  // FeedBill immediately; this fills the committee / news / hearing slots.
  useEffect(() => {
    if (!hoverId || cache[hoverId]) return;
    let cancelled = false;
    fetch(`/api/bill/${encodeURIComponent(hoverId)}/panel`)
      .then((r) => (r.ok ? (r.json() as Promise<PanelData>) : Promise.reject(r.status)))
      .then((json) => {
        if (!cancelled) setCache((c) => ({ ...c, [hoverId]: json }));
      })
      .catch(() => {
        // leave the slots in their empty/loading state; non-fatal
        if (!cancelled)
          setCache((c) => ({
            ...c,
            [hoverId]: { committees: [], news: [], meetings: [] },
          }));
      });
    return () => {
      cancelled = true;
    };
  }, [hoverId, cache]);

  return (
    <div className="v2f">
      {bills.map((bill) => (
        <div
          key={bill.id}
          className="v2f-group"
          tabIndex={0}
          aria-label={`${formatBillId(bill.bill_type, bill.bill_number)} — ${bill.title}`}
          onMouseEnter={() => setHoverId(bill.id)}
          onFocus={() => setHoverId(bill.id)}
        >
          <div className="v2f-row">
            <span className="v2f-id">
              {formatBillId(bill.bill_type, bill.bill_number)}
            </span>
            <TitleCell title={bill.title} />
            <TopicChips topics={parseTopics(bill.topics)} />
            <Metric bill={bill} mode={metricMode} />
            <span className="v2f-chev">▾</span>
          </div>
          <div className="bxp-exp">
            <BillExpandPanel bill={bill} panel={cache[bill.id] ?? null} />
          </div>
        </div>
      ))}
    </div>
  );
}
