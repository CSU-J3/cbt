"use client";

// HO 257 — Dashboard v2 feed list (MOVERS / TOP STALLS / NEW THIS WEEK), the
// right column of `/`. One component behind all three tabs, so a row change lands
// on all three at once.
//
// HO 317 extracted the rich expand to the shared components/BillExpandPanel
// (rendered identically on /bills). HO 319 reverts the dashboard trigger from
// hover back to CLICK — the hover model was transient (the panel collapsed before
// you could read it) and dead on touch. Both surfaces now expand on click via the
// same shared single-open pattern (useSingleOpenPanel): single-open, panel a
// sibling below the row, data lazy-loaded on expand, cached per bill. The shared
// BillExpandPanel / BillStageBar are unchanged — only the trigger + mount.
//
// HO 609 (P3 slice 2) — the row is the mock's two-line quiet format
// (docs/design/dashboard-layout-target.html, `.mv`). What changed and why (C3:
// colour carries meaning, not decoration — the row carried five bordered or
// coloured objects, ~120 competing marks down the column):
//
//   · bordered BillIdChip  → plain amber id text (the chip primitive itself is
//                            untouched; the weekly band + hearings still use it)
//   · boxed PartyTag       → the sponsor's own text, party-coloured, no bracket box
//   · bordered TopicChips  → plain dim uppercase text (TopicChips is shared with
//                            /bills BillRow — not modified, just not rendered here)
//   · right-anchored metric + caret → line 2's FIRST element, packed left (C1: the
//                            metric sat ~370px from the title's end on a wide
//                            column, and the caret was pinned to the row's right
//                            edge). The caret is gone; the row is still
//                            role=button/aria-expanded with a hover background.
//
// Line 2 is deliberately a BLOCK, not a flex row: one line of inline text that
// ellipsizes as a unit, which also removes it from M1's candidate set by
// construction rather than by tuning.
//
// NOT here, and not an oversight: no date-group headers. Backlog revision-J asked
// for TODAY / YESTERDAY / EARLIER THIS WEEK, but the committed mock has no feed
// groups — its TODAY/YESTERDAY strings belong to the hearings day bar — and the
// mock wins (the HO 608 polarization precedent). Per-row relative age carries it.
import { useEffect, useRef, useState } from "react";
import { daysSince, formatBillId, formatRelativeAge, parseTopics } from "@/lib/format";
import { BillExpandPanel } from "@/components/BillExpandPanel";
import { useSingleOpenPanel } from "@/components/useSingleOpenPanel";
import { BILL_TYPE_LABELS } from "@/lib/enums";
import { partyColor } from "@/lib/race-colors";
import { topicLabel } from "@/lib/topic-colors";
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

// HO 609 — stage is the ONLY colour in the row, because stage is what a reader
// scans for. Note CMTE and INTRO are DIM rather than their --stage-* tokens: the
// mock's point is that the state most of the corpus sits in should not be marked,
// so ENACTED reads green and FLOOR amber AGAINST it. The three stages past
// committee keep their existing stage tokens.
const STAGE_COLOR: Record<string, string> = {
  introduced: "var(--text-dim)",
  committee: "var(--text-dim)",
  floor: "var(--stage-floor)",
  other_chamber: "var(--stage-other-chamber)",
  president: "var(--stage-president)",
  enacted: "var(--stage-enacted)",
};

function stageColor(stage: string | null | undefined): string {
  return (stage && STAGE_COLOR[stage]) || "var(--text-dim)";
}
function stageAbbr(stage: string | null | undefined): string {
  if (!stage) return "—";
  return STAGE_ABBR[stage] ?? stage.toUpperCase();
}

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

// Per-tab stage + age indicator, line 2's leading element (it was the row's
// right-anchored column until HO 609). Movers show the abbreviated last
// transition (FROM → TO · ago); stalls show the current stage + stuck duration;
// new shows INTRO + time since introduction. Never force a FROM → TO onto a
// stall/new row (HO 257 handoff). The stage token carries the row's one colour.
function Metric({
  bill,
  mode,
  nowMs,
}: {
  bill: FeedBill;
  mode: V2MetricMode;
  nowMs: number;
}) {
  if (mode === "movers") {
    const from = bill.previous_stage ? stageAbbr(bill.previous_stage) : null;
    const ago = formatRelativeAge(bill.stage_changed_at, nowMs);
    return (
      <span className="v2f-metric">
        {from ? (
          <>
            <span className="v2f-stage-from">{from}</span>{" "}
            <span className="v2f-ar">→</span>{" "}
          </>
        ) : null}
        <span className="v2f-stage" style={{ color: stageColor(bill.stage) }}>
          {stageAbbr(bill.stage)}
        </span>{" "}
        {ago}
      </span>
    );
  }
  if (mode === "stalls") {
    return (
      <span className="v2f-metric">
        <span className="v2f-stage" style={{ color: stageColor(bill.stage) }}>
          {stageAbbr(bill.stage)}
        </span>{" "}
        {daysSince(bill.latest_action_date, nowMs)}d stuck
      </span>
    );
  }
  // new — INTRO stays literal (it labels what the age measures: time since
  // introduction, not time at the bill's current stage), and introduced is a dim
  // stage in the map anyway.
  return (
    <span className="v2f-metric">
      <span className="v2f-stage" style={{ color: stageColor("introduced") }}>
        INTRO
      </span>{" "}
      {formatRelativeAge(bill.introduced_date, nowMs)}
    </span>
  );
}

// HO 321 gave line 2 the sponsor; HO 609 made it the whole line and stripped its
// decoration. One block-level line: [stage + age] · [SPONSOR [P-ST]] · [topics].
// The sponsor keeps its /members/[bioguide] link (navigation is function, not
// decoration) but loses the underline and the PartyTag box — its party colour is
// the only thing that was carrying meaning. Topics become plain dim text: the
// shared TopicChips renderer is still what /bills uses, it just isn't rendered
// here. All three sponsor fields ride the FeedBill via the HO 300 SPONSOR_ENRICH
// join — no query change.
function SubLine({
  bill,
  mode,
  nowMs,
}: {
  bill: FeedBill;
  mode: V2MetricMode;
  nowMs: number;
}) {
  const last = (
    bill.sponsor_last_name ??
    bill.sponsor_name?.split(",")[0] ??
    ""
  ).trim();
  const topics = parseTopics(bill.topics);
  const party = bill.sponsor_party;
  const state = bill.sponsor_state;
  const sponsorText = `${last.toUpperCase()}${
    party || state ? ` [${party ?? "?"}-${state ?? "?"}]` : ""
  }`;

  return (
    <div className="v2f-l2">
      <Metric bill={bill} mode={mode} nowMs={nowMs} />
      {last ? (
        <>
          <span className="v2f-l2-sep" aria-hidden>
            ·
          </span>
          {bill.sponsor_bioguide_id ? (
            <a
              className="v2f-sponsor"
              style={{ color: partyColor(party) }}
              href={`/members/${bill.sponsor_bioguide_id}`}
              onClick={(e) => e.stopPropagation()}
            >
              {sponsorText}
            </a>
          ) : (
            <span className="v2f-sponsor" style={{ color: partyColor(party) }}>
              {sponsorText}
            </span>
          )}
        </>
      ) : null}
      {topics.length > 0 ? (
        <>
          <span className="v2f-l2-sep" aria-hidden>
            ·
          </span>
          <span className="v2f-topics-plain">
            {topics.map((t) => topicLabel(t)).join(" ")}
          </span>
        </>
      ) : null}
    </div>
  );
}

export function V2FeedList({
  bills,
  metricMode,
  nowMs,
}: {
  bills: FeedBill[];
  metricMode: V2MetricMode;
  // HO 490: page-computed clock for the per-row metric + expand-panel ages, so
  // SSR and hydration bucket identically. See lib/format.ts.
  nowMs: number;
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
              <div className="v2f-l1">
                {/* Plain amber id, not the bordered chip (C3). Still a link, and
                    still stops the click bubbling to the row toggle so it
                    navigates instead of also firing a wasted panel fetch. */}
                <a
                  className="v2f-id"
                  href={`/bill/${bill.id}`}
                  title={BILL_TYPE_LABELS[bill.bill_type]}
                  onClick={(e) => e.stopPropagation()}
                >
                  {formatBillId(bill.bill_type, bill.bill_number)}
                </a>
                <TitleCell title={bill.title} />
              </div>
              <SubLine bill={bill} mode={metricMode} nowMs={nowMs} />
            </div>
            {open ? (
              <BillExpandPanel
                bill={bill}
                nowMs={nowMs}
                panel={panelCache.get(bill.id) ?? null}
              />
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
