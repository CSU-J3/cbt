"use client";

// HO 257 — Dashboard v2 feed list (MOVERS / TOP STALLS / NEW THIS WEEK). The
// collapsed rowhead (id chip · sans title · shared TopicChips · per-tab metric ·
// caret) plus the expanded panel.
//
// HO 317 extracted the rich expand to the shared components/BillExpandPanel
// (rendered identically on /bills). HO 319 reverts the dashboard trigger from
// hover back to CLICK — the hover model was transient (the panel collapsed before
// you could read it) and dead on touch. Both surfaces now expand on click via the
// same shared single-open pattern (useSingleOpenPanel): single-open, panel a
// sibling below the row, data lazy-loaded on expand, cached per bill. The shared
// BillExpandPanel / BillStageBar are unchanged — only the trigger + mount.
import { useEffect, useRef, useState } from "react";
import { daysSince, formatRelativeAge, parseTopics } from "@/lib/format";
import { BillExpandPanel } from "@/components/BillExpandPanel";
import { BillIdChip } from "@/components/BillIdChip";
import { PartyTag } from "@/components/PartyTag";
import { TopicChips } from "@/components/TopicChips";
import { useSingleOpenPanel } from "@/components/useSingleOpenPanel";
import type { FeedBill } from "@/lib/queries";

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

// HO 321: collapsed-row line 2 — sponsor LASTNAME (links to the member page, the
// same `/members/[bioguide]` route the expand's sponsor card resolves to) + a
// party-colored [party-state] bracket + a middot + the shared TopicChips
// (relocated from line 1, unchanged). All three sponsor fields ride the FeedBill
// via the HO 300 SPONSOR_ENRICH join — no query change.
function SubLine({ bill }: { bill: FeedBill }) {
  const last = (
    bill.sponsor_last_name ??
    bill.sponsor_name?.split(",")[0] ??
    ""
  ).trim();
  const topics = parseTopics(bill.topics);
  if (!last && topics.length === 0) return null;

  return (
    <div className="v2f-subline">
      {last ? (
        bill.sponsor_bioguide_id ? (
          <a
            className="v2f-sponsor-last"
            href={`/members/${bill.sponsor_bioguide_id}`}
            onClick={(e) => e.stopPropagation()}
          >
            {last.toUpperCase()}
          </a>
        ) : (
          <span className="v2f-sponsor-last v2f-sponsor-last--plain">
            {last.toUpperCase()}
          </span>
        )
      ) : null}
      {last ? (
        <PartyTag
          party={bill.sponsor_party}
          state={bill.sponsor_state}
          className="v2f-subline-bracket"
        />
      ) : null}
      {last && topics.length > 0 ? (
        <span className="v2f-subline-sep">·</span>
      ) : null}
      {topics.length > 0 ? <TopicChips topics={topics} responsive /> : null}
    </div>
  );
}

export function V2FeedList({
  bills,
  metricMode,
}: {
  bills: FeedBill[];
  metricMode: V2MetricMode;
}) {
  // Same click single-open contract /bills uses (HO 319): one row open at a time,
  // panel data cached per bill.
  const { expandedId, toggle, panelCache, handleLoaded } = useSingleOpenPanel();

  // Lazy-load committees / news / meetings for the open bill on expand (cached
  // thereafter). The panel renders summary + stage bar + meta from the FeedBill
  // immediately; this fills the committee / news / hearing slots.
  useEffect(() => {
    if (!expandedId || panelCache.has(expandedId)) return;
    let cancelled = false;
    fetch(`/api/bill/${encodeURIComponent(expandedId)}/panel`)
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((json) => {
        if (!cancelled) handleLoaded(expandedId, json);
      })
      .catch(() => {
        if (!cancelled)
          handleLoaded(expandedId, { committees: [], news: [], meetings: [] });
      });
    return () => {
      cancelled = true;
    };
  }, [expandedId, panelCache, handleLoaded]);

  return (
    <div className="v2f">
      {bills.map((bill) => {
        const open = expandedId === bill.id;
        return (
          <div key={bill.id} className={`v2f-group${open ? " open" : ""}`}>
            <div
              className="v2f-row"
              role="button"
              tabIndex={0}
              aria-expanded={open}
              onClick={() => toggle(bill.id)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  toggle(bill.id);
                }
              }}
            >
              <BillIdChip
                billType={bill.bill_type}
                billNumber={bill.bill_number}
                href={`/bill/${bill.id}`}
                onClick={(e) => e.stopPropagation()}
              />
              <div className="v2f-main">
                <TitleCell title={bill.title} />
                <SubLine bill={bill} />
              </div>
              <Metric bill={bill} mode={metricMode} />
              <span className="v2f-chev">▾</span>
            </div>
            {open ? (
              <BillExpandPanel bill={bill} panel={panelCache.get(bill.id) ?? null} />
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
