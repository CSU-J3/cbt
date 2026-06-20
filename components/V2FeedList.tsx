"use client";

// HO 257 — Dashboard v2 feed list (MOVERS / TOP STALLS / NEW THIS WEEK). Built
// to match docs/design/dashboard-2col.html's MOVERS box, which HO 253's reuse of
// BillRowList/BillExpandedPanel never matched. v2-specific: `/`'s feed keeps the
// old components untouched. The collapsed row is the mock's boxed bill-id badge
// + title + a per-tab right indicator + caret; the expand is the mock's two-
// column panel (topic tags + stage-progress pipe + summary + conditional
// RELATED NEWS on the left; sponsor/committee/introduced/latest-action + two
// buttons on the right), identical across all three tabs.
//
// Committee + news lazy-load from the existing /api/bill/[id]/panel endpoint
// (the same one BillExpandedPanel uses); every other field rides on the FeedBill
// the server already fetched.
import {
  type CSSProperties,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  congressGovUrl,
  daysSince,
  formatBillId,
  formatDateLong,
  formatDateShort,
  formatRelativeAge,
} from "@/lib/format";
import { ALLOWED_STAGES, type Stage } from "@/lib/enums";
import { parseTopics } from "@/lib/format";
import { topicColor, topicFullLabel, topicLabel } from "@/lib/topic-colors";
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

// HO 297: collapsed-row topic chips (relocated from the expand). Chip-family
// topic treatment — topic color text + that color @45% alpha border — with a
// "CODE · Full name" hover popover per chip.
function TopicChips({ topics }: { topics: string[] }) {
  if (topics.length === 0) return null;
  return (
    <span className="v2f-topics-inline">
      {topics.map((t) => {
        const color = topicColor(t);
        return (
          <span
            key={t}
            className="v2f-topic"
            style={{
              color,
              borderColor: `color-mix(in srgb, ${color} 45%, transparent)`,
            }}
          >
            {topicLabel(t)}
            <span className="topic-pop">
              {topicLabel(t)} · {topicFullLabel(t)}
            </span>
          </span>
        );
      })}
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

// HO 298 — the 6-node stage bar (replaces the HO 257 Pipe): dated nodes, stage-
// colored connectors, and a current-node treatment that pings / parks / completes
// from the BILL'S data (not the tab) so it reads right on any tab. Suppressed when
// stage is null or off-path (`other`, indexOf → −1) — an all-future strip would
// falsely read "reached nothing", same guard as BillExpandedPanel.
const STAGE_BAR_LABEL: Record<string, string> = {
  introduced: "INTRO",
  committee: "COMMITTEE",
  floor: "FLOOR",
  other_chamber: "OTHER CHAMBER",
  president: "PRESIDENT",
  enacted: "ENACTED",
};
const STAGE_BAR_COLOR: Record<string, string> = {
  introduced: "var(--stage-introduced)",
  committee: "var(--stage-committee)",
  floor: "var(--stage-floor)",
  other_chamber: "var(--stage-other-chamber)",
  president: "var(--stage-president)",
  enacted: "var(--stage-enacted)",
};
const STAGE_BAR_STALE_DAYS = 60; // matches getStaleBills' threshold

function StageBar({ bill }: { bill: FeedBill }) {
  const cur = bill.stage ? ALLOWED_STAGES.indexOf(bill.stage as Stage) : -1;
  if (cur < 0) return null;

  // Current-node state from bill data: enacted = done (no ping); past the stale
  // threshold = parked (static glow, no ping); else moving (ping ring).
  const isEnacted = bill.stage === "enacted";
  const stale =
    !isEnacted && daysSince(bill.latest_action_date) >= STAGE_BAR_STALE_DAYS;
  const curState = isEnacted ? "done" : stale ? "parked" : "moving";

  const introDate = bill.introduced_date
    ? formatDateShort(bill.introduced_date)
    : "";
  // Current-node date = when it reached the stage (stage_changed_at), else the
  // latest action date if that's all we have.
  const curRaw = bill.stage_changed_at ?? bill.latest_action_date;
  const curDate = curRaw ? formatDateShort(curRaw) : "";

  return (
    <div className="v2f-bar" aria-label="Bill stage">
      {ALLOWED_STAGES.map((st, i) => {
        const reached = i <= cur;
        const isCur = i === cur;
        const color = STAGE_BAR_COLOR[st]!;
        // Connector to the LEFT of node i, colored node i's stage color when
        // node i is reached, else --border-strong.
        const connColor = reached ? color : "var(--border-strong)";
        // Date only under INTRO (introduced) and the current node.
        const date = i === 0 ? introDate : isCur ? curDate : "";
        const dotCls = isCur
          ? `v2f-bdot cur ${curState}`
          : reached
            ? "v2f-bdot reached"
            : "v2f-bdot future";
        return (
          <div
            key={st}
            className="v2f-bnode"
            style={
              { "--bc": connColor, "--sc": color } as CSSProperties
            }
          >
            <span className="v2f-bdotwrap">
              {isCur && curState === "moving" ? (
                <span className="v2f-bping" aria-hidden />
              ) : null}
              <span
                className={dotCls}
                style={reached ? { backgroundColor: color } : undefined}
              />
            </span>
            <span
              className={`v2f-blabel${isCur ? " cur" : reached ? " reached" : " future"}`}
              style={isCur ? { color } : undefined}
            >
              {STAGE_BAR_LABEL[st]}
            </span>
            {date ? (
              <span
                className="v2f-bdate"
                style={isCur ? { color } : undefined}
              >
                {date}
              </span>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function Expand({ bill, panel }: { bill: FeedBill; panel: PanelData | null }) {
  const committee = panel?.committees[0]?.name ?? (panel ? "—" : "loading…");
  const news = panel?.news ?? [];
  const cgUrl = congressGovUrl(bill.congress, bill.bill_type, bill.bill_number);

  // HO 297: the topic tags moved to the collapsed rowhead (TopicChips); the old
  // .v2f-topics block here is removed so there's no stray duplicate.
  return (
    <div className="v2f-exp">
      <div className="v2f-grid">
        <div>
          <StageBar bill={bill} />
          {bill.summary ? <div className="v2f-summary">{bill.summary}</div> : null}
          {/* RELATED NEWS — conditional: omit the whole section when the bill
              has no mentions (handoff: mentions are sparse). */}
          {news.length > 0 ? (
            <div className="v2f-news">
              <div className="v2f-nh">RELATED NEWS</div>
              {news.map((n) => (
                <div key={n.id} className="v2f-ni">
                  <span className="v2f-src">
                    {n.source.toUpperCase()} · {formatRelativeAge(n.publishedAt)}
                  </span>
                  <a
                    href={n.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {n.title}
                  </a>
                </div>
              ))}
            </div>
          ) : null}
        </div>

        <div className="v2f-side">
          {bill.sponsor_name ? (
            <>
              <div className="v2f-sk">SPONSOR</div>
              {/* sponsor_name already carries the full "Rep. Last, First
                  [R-AR-3]" descriptor (title + party-state-district), so it's
                  rendered as-is — no redundant party-state append. */}
              <div className="v2f-sv">{bill.sponsor_name}</div>
            </>
          ) : null}
          <div className="v2f-sk">COMMITTEE</div>
          <div className="v2f-sv">{committee}</div>
          {bill.introduced_date ? (
            <>
              <div className="v2f-sk">INTRODUCED</div>
              <div className="v2f-sv mono">{formatDateLong(bill.introduced_date)}</div>
            </>
          ) : null}
          {bill.latest_action_text || bill.latest_action_date ? (
            <>
              <div className="v2f-sk">LATEST ACTION</div>
              <div className="v2f-sv mono">
                {bill.latest_action_text ?? "—"}
                {bill.latest_action_date ? ` · ${formatRelativeAge(bill.latest_action_date)}` : ""}
              </div>
            </>
          ) : null}
          <div className="v2f-btns">
            <a href={`/bill/${bill.id}`} onClick={(e) => e.stopPropagation()}>
              FULL BILL PAGE
            </a>
            <a
              href={cgUrl}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
            >
              CONGRESS.GOV ↗
            </a>
          </div>
        </div>
      </div>
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
  const [openId, setOpenId] = useState<string | null>(null);
  const [cache, setCache] = useState<Record<string, PanelData>>({});

  // Lazy-load committee + news for the open bill (once; cached thereafter).
  useEffect(() => {
    if (!openId || cache[openId]) return;
    let cancelled = false;
    fetch(`/api/bill/${encodeURIComponent(openId)}/panel`)
      .then((r) => (r.ok ? (r.json() as Promise<PanelData>) : Promise.reject(r.status)))
      .then((json) => {
        if (!cancelled) setCache((c) => ({ ...c, [openId]: json }));
      })
      .catch(() => {
        // leave uncached → committee shows "—", news omitted; non-fatal
        if (!cancelled) setCache((c) => ({ ...c, [openId]: { committees: [], news: [] } }));
      });
    return () => {
      cancelled = true;
    };
  }, [openId, cache]);

  const toggle = useCallback(
    (id: string) => setOpenId((cur) => (cur === id ? null : id)),
    [],
  );

  return (
    <div className="v2f">
      {bills.map((bill) => {
        const open = openId === bill.id;
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
              <span className="v2f-id">
                {formatBillId(bill.bill_type, bill.bill_number)}
              </span>
              <TitleCell title={bill.title} />
              <TopicChips topics={parseTopics(bill.topics)} />
              <Metric bill={bill} mode={metricMode} />
              <span className="v2f-chev">▾</span>
            </div>
            {open ? <Expand bill={bill} panel={cache[bill.id] ?? null} /> : null}
          </div>
        );
      })}
    </div>
  );
}
