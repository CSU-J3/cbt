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
// DATE-GROUP HEADERS: here since HO 632, and the reversal is recorded rather than
// quietly overwritten. HO 609 refused them on a sound rule — the committed mock had
// no feed groups (its TODAY/YESTERDAY strings belonged to the hearings day bar) and
// the mock wins. What changed is the mock, not the rule: mock-632 carries the groups
// as knob A, so the same precedent that refused them now requires them. Grouping is
// MOVERS + NEW only, and the buckets come from lib/feed-buckets (which owns the
// per-mode field choice and the ET boundary — read its header before touching this).
import { Fragment, useEffect, useRef, useState } from "react";
import { daysSince, formatBillId, formatRelativeAge, parseTopics } from "@/lib/format";
import { EMPTY_PANEL } from "@/components/bill-panel-types";
import { BillExpandPanel } from "@/components/BillExpandPanel";
import { useSingleOpenPanel } from "@/components/useSingleOpenPanel";
import { BILL_TYPE_LABELS } from "@/lib/enums";
import { partyColor } from "@/lib/race-colors";
import { topicLabel } from "@/lib/topic-colors";
import type { FeedBill } from "@/lib/queries";
import { groupFeed, type V2MetricMode } from "@/lib/feed-buckets";

// Re-exported, not re-declared: lib/feed-buckets owns the union because its
// signature turns on it (the mode IS the bucket-field choice). Two identical
// declarations would typecheck today and drift the first time a mode is added.
export type { V2MetricMode };

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
//
// HO 609: the popover is ANCHORED TO THE VIEWPORT (position:fixed, coordinates
// from the trigger's getBoundingClientRect) rather than absolutely positioned
// inside the row. It was a CSS-only hover reveal until the feed gained an
// internal scroll; measured, the popover invoked from the last visible row of a
// scrolled feed at 1440 was clipped 37px by the scroll container. Fixed
// positioning has no clipping ancestor by construction. It dismisses on ANY
// scroll (capture phase, so the feed's own scroll counts) rather than tracking,
// and flips above / clamps left when it would leave the viewport.
type PopPos = { left: number; top: number; anchorTop: number; adjusted: boolean };

function TitleCell({ title }: { title: string }) {
  const ref = useRef<HTMLSpanElement | null>(null);
  const popRef = useRef<HTMLSpanElement | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [pop, setPop] = useState<PopPos | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setTruncated(el.scrollWidth > el.clientWidth + 1);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [title]);

  // Any scroll dismisses — capture:true so the feed's own scroll container fires
  // it too (a scroll event on an inner element doesn't bubble to window).
  useEffect(() => {
    if (!pop) return;
    const dismiss = () => setPop(null);
    window.addEventListener("scroll", dismiss, true);
    return () => window.removeEventListener("scroll", dismiss, true);
  }, [pop]);

  // One post-render correction per open: flip above the trigger if the card would
  // run off the bottom, clamp left if it would run off the right.
  useEffect(() => {
    const el = popRef.current;
    if (!pop || pop.adjusted || !el) return;
    const r = el.getBoundingClientRect();
    let left = pop.left;
    let top = pop.top;
    if (r.right > window.innerWidth - 8) {
      left = Math.max(8, window.innerWidth - 8 - r.width);
    }
    if (r.bottom > window.innerHeight - 8) {
      top = Math.max(8, pop.anchorTop - 6 - r.height);
    }
    setPop({ ...pop, left, top, adjusted: true });
  }, [pop]);

  const open = () => {
    const el = ref.current;
    if (!el || !truncated) return;
    const r = el.getBoundingClientRect();
    setPop({ left: r.left, top: r.bottom + 6, anchorTop: r.top, adjusted: false });
  };

  return (
    <span
      className={`v2f-title-wrap${truncated ? " truncated" : ""}`}
      onMouseEnter={open}
      onMouseLeave={() => setPop(null)}
    >
      <span ref={ref} className="v2f-title">
        {title}
      </span>
      {pop ? (
        <span
          ref={popRef}
          className="title-pop title-pop--fixed"
          style={{ left: pop.left, top: pop.top }}
        >
          {title}
        </span>
      ) : null}
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
    const ago = formatRelativeAge(bill.stage_observed_at, nowMs);
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
// HO 627 (owner-reported): THE ROW IS THE CLICK TARGET, everywhere in it.
//
// The defect this fixes: the id was the only COLOURED element in the row and the
// only one that NAVIGATED. C3 had deliberately made stage the sole carrier of
// colour elsewhere, so the amber id read as "the thing to click" — and clicking
// it left the dashboard instead of expanding, while clicking two pixels to its
// right expanded. The row advertised one affordance and delivered two.
//
// The rule now: a PLAIN click anywhere in the row expands it. A MODIFIED click
// (cmd/ctrl for a new tab, shift for a new window, alt for download, any
// non-primary button) navigates. That is why these stay real `<a href>` elements
// rather than becoming spans — the href is what makes new-tab, "copy link
// address", middle-click and screen-reader link semantics keep working. We only
// suppress the DEFAULT navigation on the unmodified case; we never stop the
// event bubbling, because the row's toggle is what has to receive it.
//
// Note there is no stopPropagation here by design (it is what this HO removed).
function rowLinkClick(e: React.MouseEvent<HTMLAnchorElement>) {
  if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) {
    // Let the browser do its normal thing (new tab / new window / download) —
    // but STOP the bubble, or the row toggle also fires and a cmd-click opens
    // the bill in a background tab AND leaves the row expanded behind it. That
    // is the same "one affordance, two outcomes" defect this HO is fixing, just
    // mirrored, and the HO 627 gate caught it on the first honest run: the ctrl
    // legs read `open=true · tabs 1->2` — navigation correct, toggle spurious.
    e.stopPropagation();
    return;
  }
  // Unmodified: suppress navigation and let the click reach the row's toggle.
  e.preventDefault();
}

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
              // HO 627 §4: the sponsor was the row's OTHER colour-carrying link
              // and had the same swallow-the-click problem as the id. Same
              // modifier-aware treatment — plain click expands, modified click
              // goes to the member hub. The expanded panel's own sponsor link
              // navigates on a plain click (it is a sibling of the row, not a
              // child, so it never reaches the toggle), which is the "one level
              // in" the drill moved to rather than being removed.
              onClick={rowLinkClick}
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
          handleLoaded(expandedId, EMPTY_PANEL);
      });
    return () => {
      cancelled = true;
    };
  }, [expandedId, panelCache, handleLoaded]);

  // HO 632 — null for STALLS (ungrouped by design), otherwise the non-empty
  // buckets in order. Headers render as SIBLINGS of the groups inside `.v2f`, not
  // as wrappers: the 628 hairline is `.v2f-group + .v2f-group`, so a header
  // between two groups breaks that adjacency on its own and the header's own
  // border-top takes over the seam. No override rule, and nothing nests.
  const groups = groupFeed(bills, metricMode, nowMs);

  const renderBill = (bill: FeedBill) => {
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
                {/* HO 627 §3: leading disclosure glyph. LEADING, not far-right —
                    a right-anchored caret is the exact C1 defect HO 609 removed
                    from this row, so the affordance goes at the head of line 1
                    where it costs no horizontal void. aria-hidden because the
                    row already carries role=button + aria-expanded, which is
                    what assistive tech reads; a second announcement would be
                    noise. Rotates 90deg on open (instantly, house style). */}
                <span className="v2f-disc" aria-hidden>
                  ▸
                </span>
                {/* Plain amber id, not the bordered chip (C3). Still a real link
                    (href kept for new-tab / copy-link / a11y), but a PLAIN click
                    now expands the row like every other pixel in it — see
                    rowLinkClick. */}
                <a
                  className="v2f-id"
                  href={`/bill/${bill.id}`}
                  title={BILL_TYPE_LABELS[bill.bill_type]}
                  onClick={rowLinkClick}
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
  };

  return (
    <div className="v2f">
      {groups === null
        ? bills.map(renderBill)
        : groups.map((g) => (
            // Fragment, so the header and its rows stay DIRECT children of `.v2f`
            // — a wrapper div would break the `.v2f-group + .v2f-group` adjacency
            // the 628 hairline rides, everywhere, not just at the header.
            <Fragment key={g.bucket}>
              {/* Inert by construction: no handler, no tabIndex, no role. It is a
                  caption for the rows beneath it, and aria-hidden would be wrong
                  (the text is real content); it simply isn't interactive. */}
              <div className="v2f-grp">{g.label}</div>
              {g.bills.map(renderBill)}
            </Fragment>
          ))}
    </div>
  );
}
