"use client";

// HO 317 — the ONE shared expanded bill panel + ONE shared stage bar. Unifies
// the dashboard's rich v2 expand (V2FeedList's old private `Expand`) and /bills'
// minimal `BillExpandedPanel` into a single presentational component, rendered
// identically on both surfaces. The surfaces differ ONLY in how it's mounted +
// triggered (dashboard: nested-in-row, CSS hover; /bills: sibling, click) — the
// parents own that; this component owns the contents.
//
// Visual source of truth: docs/design/expanded-panel-unified.html. Stage bar
// lifted from the shipped HO 298 bar (current-node done/parked/moving states);
// the boxed meta column + HEARING/NEWS/ODDS left order + inline party bracket
// follow the mock.
//
// Purely presentational: takes the bill + the lazily-fetched panel data
// (committees/news/meetings) as props. Each parent fetches + caches and passes
// it in (the dashboard on hover, /bills on expand) so 35 mounted-but-hidden
// dashboard panels don't each fire a fetch.
import { type CSSProperties, useState } from "react";
import {
  congressGovUrl,
  daysSince,
  formatDateLong,
  formatRelativeAge,
} from "@/lib/format";
import { ALLOWED_STAGES, type Stage } from "@/lib/enums";
import {
  LIVE_WINDOW_MS,
  etDayLabel,
  etTimeLabel,
  hearingBadge,
  watchState,
} from "@/lib/hearings";
import { stateName } from "@/lib/states";
import type { FeedBill } from "@/lib/queries";
import type { PanelData, PanelMeeting } from "@/components/BillExpandedPanel";

// ---- shared stage bar (HO 298, lifted) --------------------------------------

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

// The one shared stage bar. Current-node state comes from the BILL, not the tab/
// surface: enacted → done (no pulse); past the stale threshold → parked (static
// glow, no pulse); else → moving (pulsing ring). Suppressed when stage is null
// or off-path (indexOf → −1) — an all-future strip would falsely read "reached
// nothing".
export function BillStageBar({ bill }: { bill: FeedBill }) {
  const cur = bill.stage ? ALLOWED_STAGES.indexOf(bill.stage as Stage) : -1;
  if (cur < 0) return null;

  const isEnacted = bill.stage === "enacted";
  const stale =
    !isEnacted && daysSince(bill.latest_action_date) >= STAGE_BAR_STALE_DAYS;
  const curState = isEnacted ? "done" : stale ? "parked" : "moving";

  const introDate = bill.introduced_date
    ? formatDateLong(bill.introduced_date)
    : "";
  const curRaw = bill.stage_changed_at ?? bill.latest_action_date;
  const curDate = curRaw ? formatDateLong(curRaw) : "";

  return (
    <div className="v2f-bar" aria-label="Bill stage">
      {ALLOWED_STAGES.map((st, i) => {
        const reached = i <= cur;
        const isCur = i === cur;
        const color = STAGE_BAR_COLOR[st]!;
        const connColor = reached ? color : "var(--border-strong)";
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
            style={{ "--bc": connColor, "--sc": color } as CSSProperties}
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
              <span className="v2f-bdate" style={isCur ? { color } : undefined}>
                {date}
              </span>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

// ---- sponsor name + hover card (HO 300, lifted) -----------------------------

const SENATE_TYPES = new Set(["s", "sjres", "sconres", "sres"]);
function partyColor(party: string | null | undefined): string {
  if (!party) return "var(--text-muted)";
  const u = party.trim().toUpperCase();
  if (u === "R") return "var(--party-republican)";
  if (u === "D") return "var(--party-democrat)";
  return "var(--party-independent)";
}
function initials(name: string): string {
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
      <span className="v2f-sc-photo v2f-sc-photo--fb" style={{ color }} aria-hidden>
        {initials(name)}
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

// Meta SPONSOR row: natural "Rep./Sen. First Last" + a single party-colored
// [party-state-district] bracket (mock), with the HO 300 hover card on the name.
function SponsorMeta({ bill }: { bill: FeedBill }) {
  const raw = bill.sponsor_name ?? "";
  if (!raw) return null;
  const isSenate = SENATE_TYPES.has(bill.bill_type);
  const color = partyColor(bill.sponsor_party);
  const district = bill.sponsor_district ?? null;
  const haveName = bill.sponsor_first_name && bill.sponsor_last_name;
  const name = haveName
    ? `${isSenate ? "Sen." : "Rep."} ${bill.sponsor_first_name} ${bill.sponsor_last_name}`
    : raw;
  // [D-NV-4] / [D-AZ] / [R-WY-AL]. House with no stored district → AL (at-large).
  const dSeg = district != null ? `-${district}` : isSenate ? "" : "-AL";
  const bracket =
    bill.sponsor_party || bill.sponsor_state
      ? `[${bill.sponsor_party ?? "?"}-${bill.sponsor_state ?? "?"}${dSeg}]`
      : null;
  const cardMeta = bill.sponsor_state
    ? `${stateName(bill.sponsor_state)} · ${isSenate ? "Senate" : "House"}`
    : isSenate
      ? "Senate"
      : "House";

  return (
    <span className="bxp-sponsor">
      {bill.sponsor_bioguide_id ? (
        <a
          className="bxp-sponsor-name"
          href={`/members/${bill.sponsor_bioguide_id}`}
          onClick={(e) => e.stopPropagation()}
        >
          {name}
        </a>
      ) : (
        <span className="bxp-sponsor-name bxp-sponsor-name--plain">{name}</span>
      )}
      {bracket ? (
        <span className="bxp-sponsor-bracket" style={{ color }}>
          {" "}
          {bracket}
        </span>
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
          <span className="v2f-sc-meta">{cardMeta}</span>
        </span>
      </span>
    </span>
  );
}

// ---- HEARING slot (HO 324) --------------------------------------------------

// Always-on, rich HEARING block. Selects the soonest current-or-upcoming meeting
// (not fully past — within the LIVE_WINDOW from the meeting start), so an
// in-progress hearing surfaces as LIVE; strictly-past-only bills fall to the
// empty state. LIVE is the hearings `watchState` time-window rule (no
// meetingStatus LIVE signal exists — it's planning-state). Reuses the hearings
// badge + ET time/day formatters; renders nothing pre-load (panel === null),
// then the empty state or the three populated lines.
function HearingBlock({
  meetings,
  currentBillId,
  loaded,
}: {
  meetings: PanelMeeting[];
  currentBillId: string;
  loaded: boolean;
}) {
  const now = Date.now();
  const m =
    meetings
      .map((mt) => ({ mt, t: Date.parse(mt.meetingDate) }))
      .filter((x) => Number.isFinite(x.t) && x.t + LIVE_WINDOW_MS >= now)
      .sort((a, b) => a.t - b.t)[0]?.mt ?? null;

  return (
    <div className="bxp-relblock">
      <div className="bxp-relhdr">Hearing</div>
      {m ? (
        <PopulatedHearing meeting={m} currentBillId={currentBillId} now={now} />
      ) : loaded ? (
        <div className="bxp-relempty">NO RELATED HEARINGS</div>
      ) : null}
    </div>
  );
}

function PopulatedHearing({
  meeting: m,
  currentBillId,
  now,
}: {
  meeting: PanelMeeting;
  currentBillId: string;
  now: number;
}) {
  const ws = watchState(
    {
      meetingDate: m.meetingDate,
      meetingStatus: m.meetingStatus,
      videoUrl: m.videoUrl,
    },
    now,
  );
  const isLive = ws === "live";
  const room = [m.room, m.building].filter(Boolean).join(" ");
  const meta = [
    hearingBadge(m.meetingType),
    m.meetingStatus.toUpperCase(),
    etDayLabel(m.meetingDate),
    `${etTimeLabel(m.meetingDate)} ET`,
    room,
  ]
    .filter(Boolean)
    .join(" · ");
  const agenda = m.agenda.filter((a) => a.id !== currentBillId);
  const showWatch = ws !== "none" && !!m.videoUrl;

  return (
    <>
      <div className="bxp-hrow">
        <span
          className={`bxp-hpip${isLive ? " bxp-hpip--live" : ""}`}
          aria-hidden
        />
        <a
          className="bxp-hcom"
          href={
            m.committeeSystemCode
              ? `/committee/${m.committeeSystemCode}`
              : "/hearings"
          }
          onClick={(e) => e.stopPropagation()}
        >
          {m.committeeName ?? "Committee"}
        </a>
        <span className="bxp-harrow">↗</span>
      </div>
      <div className="bxp-hmeta">{meta}</div>
      {showWatch || agenda.length > 0 ? (
        <div className="bxp-hlinks">
          {showWatch ? (
            <span>
              WATCH{" "}
              <a
                className="bxp-hlink-em"
                href={m.videoUrl!}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
              >
                livestream ↗
              </a>
            </span>
          ) : null}
          {showWatch && agenda.length > 0 ? (
            <span className="bxp-hsep"> · </span>
          ) : null}
          {agenda.length > 0 ? (
            <span>
              AGENDA{" "}
              {agenda.map((a, i) => (
                <span key={a.id}>
                  {i > 0 ? " · " : ""}
                  <a
                    className="bxp-hlink-em"
                    href={`/bill/${a.id}`}
                    onClick={(e) => e.stopPropagation()}
                  >
                    {a.label}
                  </a>
                </span>
              ))}
            </span>
          ) : null}
        </div>
      ) : null}
    </>
  );
}

// ---- the shared panel -------------------------------------------------------

export function BillExpandPanel({
  bill,
  panel,
}: {
  bill: FeedBill;
  panel: PanelData | null;
}) {
  const committee0 = panel?.committees[0] ?? null;
  const news = panel?.news ?? [];
  const meetings = panel?.meetings ?? [];
  const cgUrl = congressGovUrl(bill.congress, bill.bill_type, bill.bill_number);

  return (
    <div className="bxp">
      <BillStageBar bill={bill} />

      <div className="bxp-body">
        {/* LEFT — summary + HEARING / RELATED NEWS / ODDS (mock order) */}
        <div className="bxp-left">
          {bill.summary ? <p className="bxp-summary">{bill.summary}</p> : null}

          {/* HEARING — always-on, rich (HO 324). Leads the related block. */}
          <HearingBlock
            meetings={meetings}
            currentBillId={bill.id}
            loaded={panel !== null}
          />

          {/* RELATED NEWS — always; empty state once loaded. */}
          <div className="bxp-relblock">
            <div className="bxp-relhdr">Related News</div>
            {news.length > 0 ? (
              news.map((n) => (
                <a
                  key={n.id}
                  className="bxp-relnews"
                  href={n.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                >
                  <span className="bxp-relnews-title">{n.title}</span>
                  <span className="bxp-relnews-meta">
                    {" · "}
                    {n.source.toUpperCase()} · {formatRelativeAge(n.publishedAt)}
                  </span>
                </a>
              ))
            ) : panel !== null ? (
              <div className="bxp-relempty">NO RELATED NEWS</div>
            ) : null}
          </div>

          {/* ODDS — always; empty state (no bill↔market join today). */}
          <div className="bxp-relblock">
            <div className="bxp-relhdr">Odds</div>
            <div className="bxp-relempty">NO PREDICTIONS MADE</div>
          </div>
        </div>

        {/* RIGHT — boxed meta card with hairline dividers + buttons */}
        <div className="bxp-metabox">
          {bill.sponsor_name ? (
            <div className="bxp-mrow">
              <div className="bxp-mlabel">Sponsor</div>
              <div className="bxp-mval">
                <SponsorMeta bill={bill} />
              </div>
            </div>
          ) : null}

          {bill.cosponsor_count != null ? (
            <div className="bxp-mrow">
              <div className="bxp-mlabel">Cosponsors</div>
              <div className="bxp-mval tabular-nums">
                {bill.cosponsor_count.toLocaleString()} cosponsor
                {bill.cosponsor_count === 1 ? "" : "s"}
              </div>
            </div>
          ) : null}

          <div className="bxp-mrow">
            <div className="bxp-mlabel">Committee</div>
            <div className="bxp-mval">
              {committee0 ? (
                <>
                  <a
                    className="bxp-clnk"
                    href={`/committee/${committee0.systemCode}`}
                    onClick={(e) => e.stopPropagation()}
                  >
                    {committee0.name}
                  </a>
                  {committee0.activityType ? (
                    <span className="bxp-dim">
                      {" · "}
                      {committee0.activityType}
                      {committee0.activityDate
                        ? ` · ${formatRelativeAge(committee0.activityDate)}`
                        : ""}
                    </span>
                  ) : null}
                </>
              ) : (
                <span className="bxp-dim">{panel ? "—" : "loading…"}</span>
              )}
            </div>
          </div>

          {bill.introduced_date ? (
            <div className="bxp-mrow">
              <div className="bxp-mlabel">Introduced</div>
              <div className="bxp-mval tabular-nums">
                {formatDateLong(bill.introduced_date)}
              </div>
            </div>
          ) : null}

          {bill.latest_action_text || bill.latest_action_date ? (
            <div className="bxp-mrow">
              <div className="bxp-mlabel">Latest Action</div>
              <div className="bxp-mval">
                {bill.latest_action_text ?? "—"}
                {bill.latest_action_date ? (
                  <span className="bxp-dim">
                    {" · "}
                    {formatRelativeAge(bill.latest_action_date)}
                  </span>
                ) : null}
              </div>
            </div>
          ) : null}

          <div className="bxp-btns">
            <a
              className="bxp-btn bxp-btn--primary"
              href={`/bill/${bill.id}`}
              onClick={(e) => e.stopPropagation()}
            >
              Full Bill Page →
            </a>
            <a
              className="bxp-btn bxp-btn--secondary"
              href={cgUrl}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
            >
              Congress.gov ↗
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
