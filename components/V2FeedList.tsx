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
import { stateName } from "@/lib/states";
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

// HO 297/316: collapsed-row topic chips. The chip now lives in the shared
// components/TopicChips.tsx (HO 316 consolidation); V2FeedList just renders it.

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

  // HO 303 (B6 coherence): ISO dates (formatDateLong, YYYY-MM-DD) to match the
  // meta column's INTRODUCED on the same card — not the MM-DD-YY formatDateShort.
  const introDate = bill.introduced_date
    ? formatDateLong(bill.introduced_date)
    : "";
  // Current-node date = when it reached the stage (stage_changed_at), else the
  // latest action date if that's all we have.
  const curRaw = bill.stage_changed_at ?? bill.latest_action_date;
  const curDate = curRaw ? formatDateLong(curRaw) : "";

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

// HO 300 — the SPONSOR hover card (v2 meta column). Mirrors SponsorHoverName's
// logic (natural name, party color, initials fallback) but with the v2 mock's
// sizing + a "State · Chamber" meta line + an inline party tag. Sponsor chamber
// == the bill's originating chamber, so bill_type gives Rep./Sen.
const V2_SENATE_TYPES = new Set(["s", "sjres", "sconres", "sres"]);
function v2PartyColor(party: string | null | undefined): string {
  if (!party) return "var(--text-muted)";
  const u = party.trim().toUpperCase();
  if (u === "R") return "var(--party-republican)";
  if (u === "D") return "var(--party-democrat)";
  return "var(--party-independent)";
}
function v2Initials(name: string): string {
  const np = name
    .replace(/^(Rep\.|Sen\.|Del\.|Res\.)\s*/i, "")
    .replace(/\s*\[.*\]$/, "")
    .trim();
  const p = np.split(/[\s,]+/).filter(Boolean);
  return ((p[0]?.[0] ?? "") + (p[1]?.[0] ?? "")).toUpperCase() || "?";
}

function SponsorPhoto({
  url,
  name,
  color,
}: {
  url: string | null;
  name: string;
  color: string;
}) {
  const [errored, setErrored] = useState(false);
  if (!url || errored) {
    return (
      <span
        className="v2f-sc-photo v2f-sc-photo--fb"
        style={{ color }}
        aria-hidden
      >
        {v2Initials(name)}
      </span>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      className="v2f-sc-photo"
      src={url}
      alt=""
      loading="lazy"
      onError={() => setErrored(true)}
    />
  );
}

function SponsorCell({ bill }: { bill: FeedBill }) {
  const raw = bill.sponsor_name ?? "";
  if (!raw) return null;
  const isSenate = V2_SENATE_TYPES.has(bill.bill_type);
  const color = v2PartyColor(bill.sponsor_party);
  const district = bill.sponsor_district ?? null;
  const haveName = bill.sponsor_first_name && bill.sponsor_last_name;
  const name = haveName
    ? `${isSenate ? "Sen." : "Rep."} ${bill.sponsor_first_name} ${bill.sponsor_last_name}`
    : raw;
  // inline party tag " · D-AZ"
  const partyState =
    bill.sponsor_party && bill.sponsor_state
      ? `${bill.sponsor_party}-${bill.sponsor_state}`
      : (bill.sponsor_party ?? bill.sponsor_state ?? "");
  // card bracket [D-AZ] / [R-CA-5] / [R-WY-AL]
  const dSeg = district != null ? `-${district}` : isSenate ? "" : "-AL";
  const bracket =
    bill.sponsor_party || bill.sponsor_state
      ? `[${bill.sponsor_party ?? "?"}-${bill.sponsor_state ?? "?"}${dSeg}]`
      : null;
  const meta = bill.sponsor_state
    ? `${stateName(bill.sponsor_state)} · ${isSenate ? "Senate" : "House"}`
    : isSenate
      ? "Senate"
      : "House";

  return (
    <span className="v2f-sponsor">
      {bill.sponsor_bioguide_id ? (
        <a
          className="v2f-sponsor-name"
          href={`/members/${bill.sponsor_bioguide_id}`}
          onClick={(e) => e.stopPropagation()}
        >
          {name}
        </a>
      ) : (
        <span className="v2f-sponsor-name v2f-sponsor-name--plain">{name}</span>
      )}
      {partyState ? (
        <span className="v2f-sponsor-tag"> · {partyState}</span>
      ) : null}
      <span className="v2f-sc-card" role="tooltip">
        <SponsorPhoto
          url={bill.sponsor_depiction_url ?? null}
          name={raw}
          color={color}
        />
        <span className="v2f-sc-info">
          <span className="v2f-sc-name">{name}</span>
          {bracket ? (
            <span className="v2f-sc-party" style={{ color }}>
              {bracket}
            </span>
          ) : null}
          <span className="v2f-sc-meta">{meta}</span>
        </span>
      </span>
    </span>
  );
}

function Expand({ bill, panel }: { bill: FeedBill; panel: PanelData | null }) {
  const committee0 = panel?.committees[0] ?? null;
  const committeeText = committee0?.name ?? (panel ? "—" : "loading…");
  const news = panel?.news ?? [];
  const meetings = panel?.meetings ?? [];
  const cgUrl = congressGovUrl(bill.congress, bill.bill_type, bill.bill_number);

  // HO 297: the topic tags moved to the collapsed rowhead (TopicChips); the old
  // .v2f-topics block here is removed so there's no stray duplicate.
  return (
    <div className="v2f-exp">
      <div className="v2f-grid">
        <div>
          <StageBar bill={bill} />
          {bill.summary ? <div className="v2f-summary">{bill.summary}</div> : null}
          {/* RELATED (HO 299): NEWS always (empty state when none), HEARINGS only
              when the bill has meetings, ODDS omitted (no bill↔market data). */}
          <div className="v2f-related">
            <div className="v2f-rel-block">
              <div className="v2f-rel-h">RELATED NEWS</div>
              {news.length > 0 ? (
                news.map((n) => (
                  <a
                    key={n.id}
                    className="v2f-rel-news"
                    href={n.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <span className="v2f-rel-news-title">{n.title}</span>
                    <span className="v2f-rel-news-meta">
                      {" · "}
                      {n.source.toUpperCase()} · {formatRelativeAge(n.publishedAt)}
                    </span>
                  </a>
                ))
              ) : panel !== null ? (
                // Only show the empty state once loaded — avoids a flash on
                // bills that DO have news. News is sparse on the live slices, so
                // most rows land here, per the mock.
                <div className="v2f-rel-empty">NO RELATED NEWS</div>
              ) : null}
            </div>

            {meetings.length > 0 ? (
              <div className="v2f-rel-block">
                <div className="v2f-rel-h">HEARINGS</div>
                {meetings.map((m) => (
                  <a
                    key={m.eventId}
                    className="v2f-rel-hearing"
                    href={
                      m.committeeSystemCode
                        ? `/committee/${m.committeeSystemCode}`
                        : "/hearings"
                    }
                    onClick={(e) => e.stopPropagation()}
                  >
                    <span className="v2f-rel-hwhen">
                      {formatDateShort(m.meetingDate)}
                    </span>
                    <span className="v2f-rel-hcom">
                      {m.committeeName ?? "Committee"}
                    </span>
                    <span className="v2f-rel-harrow">hearing →</span>
                  </a>
                ))}
              </div>
            ) : null}
          </div>
        </div>

        <div className="v2f-side">
          {bill.sponsor_name ? (
            <>
              <div className="v2f-sk">SPONSOR</div>
              <div className="v2f-sv">
                <SponsorCell bill={bill} />
              </div>
            </>
          ) : null}
          {bill.cosponsor_count != null ? (
            <>
              <div className="v2f-sk">COSPONSORS</div>
              <div className="v2f-sv">
                {bill.cosponsor_count.toLocaleString()} cosponsor
                {bill.cosponsor_count === 1 ? "" : "s"}
              </div>
            </>
          ) : null}
          <div className="v2f-sk">COMMITTEE</div>
          <div className="v2f-sv">
            {committee0 ? (
              <>
                <a
                  className="v2f-cmte-link"
                  href={`/committee/${committee0.systemCode}`}
                  onClick={(e) => e.stopPropagation()}
                >
                  {committee0.name}
                </a>
                {committee0.activityType ? (
                  <span className="v2f-cmte-meta">
                    {" · "}
                    {committee0.activityType}
                    {committee0.activityDate
                      ? ` · ${formatRelativeAge(committee0.activityDate)}`
                      : ""}
                  </span>
                ) : null}
              </>
            ) : (
              committeeText
            )}
          </div>
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
            <a
              className="v2f-btn-primary"
              href={`/bill/${bill.id}`}
              onClick={(e) => e.stopPropagation()}
            >
              FULL BILL PAGE →
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
        if (!cancelled)
          setCache((c) => ({
            ...c,
            [openId]: { committees: [], news: [], meetings: [] },
          }));
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
