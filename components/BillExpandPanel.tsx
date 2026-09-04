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
  etDateLabelFull,
  etDayLabel,
  etTimeLabel,
  etTimeLabelFull,
  hearingBadge,
  watchState,
} from "@/lib/hearings";
import { stateName } from "@/lib/states";
import type { FeedBill } from "@/lib/queries";
import type { PanelData, PanelMeeting } from "@/components/bill-panel-types";
import type {
  CosponsorFace,
  CosponsorRoster,
  PartyKey,
  PromotedRelatedBill,
  RelatedBillView,
  RelatedBillsShape,
} from "@/lib/bill-rosters-view";

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
export function BillStageBar({
  bill,
  nowMs,
}: {
  bill: FeedBill;
  nowMs: number;
}) {
  const cur = bill.stage ? ALLOWED_STAGES.indexOf(bill.stage as Stage) : -1;
  if (cur < 0) return null;

  const isEnacted = bill.stage === "enacted";
  const stale =
    !isEnacted &&
    daysSince(bill.latest_action_date, nowMs) >= STAGE_BAR_STALE_DAYS;
  const curState = isEnacted ? "done" : stale ? "parked" : "moving";

  const introDate = bill.introduced_date
    ? formatDateLong(bill.introduced_date)
    : "";
  const curRaw = bill.stage_observed_at ?? bill.latest_action_date;
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

// HO 675 — `className` added so the 32x38 cosponsor face reuses this ONE
// onError->initials fallback rather than declaring a second copy of it eight
// lines away. The default reproduces the pre-675 class strings byte for byte
// ("bxp-sponsor-photo" and "bxp-sponsor-photo bxp-sponsor-photo--fb"), so the
// sponsor block's markup is unchanged and its before/after capture is a byte
// diff that a reordered attribute would have failed for no reason.
//
// This is NOT the SponsorPhoto unification filed at HO 673 — that one is about
// two DIFFERENT image sources (constructed bioguide URL vs stored
// depiction_url) living in two files. This is one file, one source, one
// fallback, now with two sizes.
function SponsorPhoto({
  url,
  name,
  color,
  className = "bxp-sponsor-photo",
}: {
  url: string | null;
  name: string;
  color: string;
  className?: string;
}) {
  const [errored, setErrored] = useState(false);
  if (!url || errored) {
    return (
      <span
        className={`${className} ${className}--fb`}
        style={{ color }}
        aria-hidden
      >
        {initials(name)}
      </span>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      className={className}
      src={url}
      alt=""
      loading="lazy"
      onError={() => setErrored(true)}
    />
  );
}

// Meta SPONSOR row: the sponsor portrait ALWAYS ON at 80x94 beside a stacked
// name / party-bracket / state-chamber column (HO 673, docs/design/
// mock-673-sponsor-cosponsor.html). The HO 300 hover card (.v2f-sc-card) that
// used to reveal the portrait on hover is RETIRED — it is gone from the markup
// and from globals.css, not merely hidden.
//
// The retirement is safe because this block RE-HOMES the card's one
// non-duplicated field. The card showed name, bracket and `cardMeta`; the first
// two already rendered beside it, but `cardMeta` (full state NAME + chamber
// word, "Nevada / House") had no visible counterpart -- the bracket carries the
// abbreviation only ("[D-NV-4]"). It now renders as .bxp-sponsor-meta. Retiring
// the card on the reasoning that it duplicated everything would have dropped
// that field silently.
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
      <SponsorPhoto
        url={bill.sponsor_depiction_url ?? null}
        name={raw}
        color={color}
      />
      <span className="bxp-sponsor-info">
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
            {bracket}
          </span>
        ) : null}
        <span className="bxp-sponsor-meta">{cardMeta}</span>
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
// HO 371 selection, EXTRACTED at HO 675 — expression unchanged, now with two
// callers instead of one. In momentum mode (/stale, silentDays set) the "life"
// being surfaced is a PAST hearing — these bills are 60+ days stale, so
// HO 324's current-or-upcoming filter (3h window) would drop every one and the
// block would read NO RELATED HEARINGS even when the collapsed HEARD badge is
// lit. So pick the most-recent hearing regardless of past/future, matching the
// badge + the "then silent" story. Non-momentum surfaces keep HO 324's
// soonest-current-or-upcoming selection unchanged.
//
// The second caller is the RELATED BILLS block, which must not reprint a bill
// the HEARING block is already showing off this meeting's agenda (HO 675, the
// mock's dedup requirement — 76 bills corpus-wide). That dedup has to run
// against the meeting actually CHOSEN, and the choice depends on `silentDays`,
// which is why it could not be done in the route. Two copies of this expression
// would let the two blocks disagree about which meeting is on screen, which is
// the exact defect the dedup exists to prevent.
export function selectHearingMeeting(
  meetings: PanelMeeting[],
  silentDays: number | null,
  now: number,
): PanelMeeting | null {
  const dated = meetings
    .map((mt) => ({ mt, t: Date.parse(mt.meetingDate) }))
    .filter((x) => Number.isFinite(x.t));
  return silentDays != null
    ? (dated.sort((a, b) => b.t - a.t)[0]?.mt ?? null)
    : (dated
        .filter((x) => x.t + LIVE_WINDOW_MS >= now)
        .sort((a, b) => a.t - b.t)[0]?.mt ?? null);
}

function HearingBlock({
  meetings,
  currentBillId,
  loaded,
  silentDays,
}: {
  meetings: PanelMeeting[];
  currentBillId: string;
  loaded: boolean;
  // HO 371: when set (/stale), append the "then silent" line under a populated
  // hearing — Nd since last action. null on every other surface.
  silentDays: number | null;
}) {
  const now = Date.now();
  const m = selectHearingMeeting(meetings, silentDays, now);

  return (
    <div className="bxp-relblock">
      <div className="bxp-relhdr">Hearing</div>
      {m ? (
        <PopulatedHearing
          meeting={m}
          currentBillId={currentBillId}
          now={now}
          silentDays={silentDays}
        />
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
  silentDays,
}: {
  meeting: PanelMeeting;
  currentBillId: string;
  now: number;
  silentDays: number | null;
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
  // HO 372: momentum mode (silentDays set, /stale) surfaces a PAST hearing, so
  // show the full "MAR 25, 2025" date (year disambiguates) + clean "10:00 AM"
  // time. The HO 324 upcoming path keeps the weekday/compact form.
  const momentum = silentDays != null;
  const meta = [
    hearingBadge(m.meetingType),
    m.meetingStatus.toUpperCase(),
    momentum ? etDateLabelFull(m.meetingDate) : etDayLabel(m.meetingDate),
    `${momentum ? etTimeLabelFull(m.meetingDate) : etTimeLabel(m.meetingDate)} ET`,
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
      {silentDays != null ? (
        <div className="bxp-hsilent">NO ACTION IN {silentDays}d</div>
      ) : null}
    </>
  );
}

// ---- cosponsor faces (HO 675) -----------------------------------------------

// docs/design/mock-673-sponsor-cosponsor.html, format C: the total line, then
// one group per party PRESENT — header with the party's own count, then up to
// six 32x38 faces apportioned across the groups, then a "+N" chip for the
// remainder. Names on hover.
//
// The apportionment itself is NOT here: it runs in the panel route so the
// payload carries the six drawn faces rather than the roster behind them
// (119-hr-842 has 338). See lib/bill-rosters-view.ts, which also carries the
// worked cases and why a proportional split was ruled against.
//
// THE HOVER TIP IS CSS-ONLY — :hover / :focus-visible flipping `display`,
// exactly as the mock does it. No state, no handler, no portal, and therefore
// no new client boundary: this file is already "use client" (line 1), so island
// membership is unchanged and no changelog entry is owed (HO 665).
const PARTY_NAME: Record<PartyKey, string> = {
  D: "Democrat",
  R: "Republican",
  I: "Independent",
};

function CosponsorFaces({ roster }: { roster: CosponsorRoster | null }) {
  // Nothing pre-load, and nothing for a bill whose roster is empty — the same
  // C4 rule the related blocks follow: nothing is reserved when there is
  // nothing to put in it.
  if (!roster || roster.groups.length === 0) return null;
  return (
    <>
      {roster.groups.map((g) => {
        const faces = roster.faces.filter((f) => f.party === g.party);
        const remainder = g.count - faces.length;
        return (
          <div className="bxp-cospgrp" key={g.party}>
            <div className="bxp-cospghdr" style={{ color: partyColor(g.party) }}>
              {PARTY_NAME[g.party].toUpperCase()}
              <span className="bxp-cospgn">
                {" · "}
                {g.count.toLocaleString()}
              </span>
            </div>
            <div className="bxp-cosgrid">
              {faces.map((f) => (
                <CosponsorFaceLink key={f.bioguideId} face={f} />
              ))}
              {remainder > 0 ? (
                // PLAIN TEXT, not a link. The mock renders this as an
                // <a href="#">, but there is no cosponsor-roster surface to
                // send anyone to; shipping a mock's placeholder href is how a
                // link that goes nowhere gets built. Filed in docs/backlog.md
                // with the destination that would be needed.
                <span className="bxp-cosmore" aria-hidden>
                  +{remainder.toLocaleString()}
                </span>
              ) : null}
            </div>
          </div>
        );
      })}
    </>
  );
}

function CosponsorFaceLink({ face }: { face: CosponsorFace }) {
  const color = partyColor(face.party);
  return (
    // An <a> with a REAL destination, unlike the two "+N" affordances: the
    // member hub exists, and the mock's element is an anchor too. Native focus
    // means the tip's :focus-visible reveal works without a tabIndex.
    <a
      className="bxp-face"
      href={`/members/${face.bioguideId}`}
      style={{ "--pc": color } as CSSProperties}
      onClick={(e) => e.stopPropagation()}
    >
      <SponsorPhoto
        url={face.depictionUrl}
        name={face.name}
        color={color}
        className="bxp-face-photo"
      />
      <span className="bxp-tip">
        <span className="bxp-tipname">{face.name}</span>
        <span className="bxp-tipmeta">
          <span className="bxp-tipbracket" style={{ color }}>
            {face.bracket}
          </span>
          {" · "}
          {face.meta}
        </span>
      </span>
    </a>
  );
}

// ---- related bills (HO 675) -------------------------------------------------

// docs/design/mock-673-related-bills.html, R2. Fourth block in the left column,
// after RELATED NEWS and before ODDS.
//
// The list is capped at five. 98.24% of bills with related rows carry five or
// fewer once the promoted twin is removed, which matters because the "+N more"
// overflow — like the cosponsor "+N" chip — is PLAIN TEXT with no destination,
// so the cap is chosen to make it almost never appear rather than to make the
// block a convenient length.
const RELATED_LIST_CAP = 5;

// "Senate companion · identical" / "House companion · identical, became law".
// The chamber is the TARGET's, because that is what makes it a companion rather
// than a duplicate filing. The became-law clause is ruling 2's: those 24 rows
// arrive as `Identical Bill (Became Law)` and say the twin is now law while
// this bill is not, which is the most interesting thing the block can report.
function promotedLabel(p: PromotedRelatedBill): string {
  return (
    `${p.chamber === "senate" ? "Senate" : "House"} companion · identical` +
    (p.becameLaw ? ", became law" : "")
  );
}

function RelatedBillsBlock({
  shape,
  agendaIds,
  loaded,
}: {
  shape: RelatedBillsShape | null;
  // Bills the HEARING block is already printing off its CHOSEN meeting's
  // agenda. The mock's dedup requirement: a bill must not appear twice in one
  // panel column. Measured at 76 bills corpus-wide.
  agendaIds: Set<string>;
  loaded: boolean;
}) {
  const promoted = shape?.promoted ?? [];
  // The promoted block is NEVER deduped against the agenda, and that is a
  // ruling rather than an omission. A companion is the fact that this bill has
  // a parallel track in the other chamber; suppressing it because the twin also
  // happens to sit on today's markup agenda would erase the one thing the block
  // exists to report. The dedup applies to the list below, which is where the
  // double-reporting the mock objects to actually happens.
  const rest = (shape?.rest ?? []).filter((r) => !agendaIds.has(r.id));
  const shown = rest.slice(0, RELATED_LIST_CAP);
  const overflow = rest.length - shown.length;
  const uniformLabel =
    promoted.length > 0 &&
    promoted.every((p) => promotedLabel(p) === promotedLabel(promoted[0]!));

  return (
    <div className="bxp-relblock">
      <div className="bxp-relhdr">Related Bills</div>
      {promoted.length > 0 ? (
        // ONE bordered block holding one to n rows, per ruling 3 — "the
        // promoted element is a bordered block of one to n, not *the*
        // companion", because 25 bills have more than one cross-chamber twin
        // and a singular referent does not exist for them.
        //
        // The label prints ONCE when every promoted target carries the same
        // one, and per-row when they do not. Measured at HO 675 STEP 3: 0 of
        // those 25 bills currently carry mixed labels, against a control of 24
        // bills that do have a became-law twin — so the shared-label path is
        // the only one that renders today. The per-row branch exists anyway
        // because "the twin became law and this bill did not" is the most
        // interesting fact in the set, and collapsing it to one label the day a
        // mixed pair appears would delete it silently.
        <div className="bxp-comp">
          {uniformLabel ? (
            <div className="bxp-complbl">{promotedLabel(promoted[0]!)}</div>
          ) : null}
          {promoted.map((p) => (
            <div className="bxp-compitem" key={p.id}>
              {uniformLabel ? null : (
                <div className="bxp-complbl">{promotedLabel(p)}</div>
              )}
              <RelatedBillLine
                bill={p}
                className="bxp-comprow"
                showRelationship={false}
              />
              {p.resolved && (p.introducedDate || p.stage) ? (
                <div className="bxp-compmeta">
                  {p.introducedDate
                    ? `INTRODUCED ${formatDateLong(p.introducedDate)}`
                    : null}
                  {p.introducedDate && p.stage ? " · " : null}
                  {p.stage
                    ? (STAGE_BAR_LABEL[p.stage] ?? p.stage.toUpperCase())
                    : null}
                </div>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
      {/* The "Also related" label appears only when there is a promoted block
          to distinguish the list FROM. With no companion the list IS the whole
          block and needs no sub-heading — the mock's section 02 left pane. */}
      {promoted.length > 0 && shown.length > 0 ? (
        <div className="bxp-restlbl">Also related · {rest.length}</div>
      ) : null}
      {shown.map((r) => (
        <RelatedBillLine
          key={r.id}
          bill={r}
          className="bxp-rb"
          showRelationship
        />
      ))}
      {overflow > 0 ? (
        <div className="bxp-rbmore">+{overflow.toLocaleString()} more</div>
      ) : null}
      {promoted.length === 0 && rest.length === 0 && loaded ? (
        <div className="bxp-relempty">NO RELATED BILLS</div>
      ) : null}
    </div>
  );
}

function RelatedBillLine({
  bill,
  className,
  showRelationship,
}: {
  bill: RelatedBillView;
  className: string;
  showRelationship: boolean;
}) {
  const body = (
    <>
      <span className="bxp-rbid">{bill.label}</span>
      <span className="bxp-rbt">{bill.title ?? ""}</span>
      {showRelationship ? (
        <span className="bxp-rbrel">{bill.relationship}</span>
      ) : null}
    </>
  );
  // NOT A LINK when the target is absent from `bills` — app/bill/[id]/page.tsx
  // calls notFound(), so the link would 404. 82 relationship rows corpus-wide
  // point at a bill the sync has not reached and 16 of them sit on rows this
  // block PROMOTES, so this renders in practice rather than in theory. The id
  // still prints: "there is a Senate twin, S 4885" is the fact, and dropping
  // the row to avoid a dead link would hide it.
  if (!bill.resolved) {
    return (
      <span className={`${className} ${className}--unresolved`}>{body}</span>
    );
  }
  return (
    <a
      className={className}
      href={`/bill/${bill.id}`}
      onClick={(e) => e.stopPropagation()}
    >
      {body}
    </a>
  );
}

// ---- the shared panel -------------------------------------------------------

// HO 371: cosponsor support bar — 5 segments span 1–50 (segment width 10), the
// >50 tail caps at full. Mirrors the collapsed figure's magnitude read.
function cosponsorSegments(count: number): number {
  return Math.min(5, Math.ceil(count / 10));
}

export function BillExpandPanel({
  bill,
  nowMs,
  panel,
  showMomentum = false,
}: {
  bill: FeedBill;
  // HO 490: page-computed clock for the panel's relative ages (news, committee
  // activity, latest action, stale-days). See lib/format.ts.
  nowMs: number;
  panel: PanelData | null;
  // HO 371: /stale-only momentum overlay (see BillRowList). Adds the cosponsor
  // support bar to the COSPONSORS row and the "then silent" line under a
  // populated hearing; gated so it never leaks to the dashboard / /bills panels.
  showMomentum?: boolean;
}) {
  const committee0 = panel?.committees[0] ?? null;
  const news = panel?.news ?? [];
  const meetings = panel?.meetings ?? [];
  const cgUrl = congressGovUrl(bill.congress, bill.bill_type, bill.bill_number);
  // The "then silent" payload — days since last action, shown only under a
  // populated hearing on /stale.
  const silentDays =
    showMomentum && bill.latest_action_date
      ? daysSince(bill.latest_action_date, nowMs)
      : null;
  // HO 675 — the bills the HEARING block is about to print off its chosen
  // meeting's agenda, so the RELATED BILLS list below does not print them a
  // second time in the same column. Computed from the SAME selector the
  // HEARING block calls (`selectHearingMeeting`), because a second copy of that
  // expression could pick a different meeting and the dedup would then filter
  // against a hearing that is not on screen.
  //
  // The current bill is excluded here for the same reason PopulatedHearing
  // excludes it from the agenda line: it is never its own related bill, and
  // leaving it in would make this set look like it had matched something.
  const hearingAgendaIds = new Set(
    (selectHearingMeeting(meetings, silentDays, nowMs)?.agenda ?? [])
      .map((a) => a.id)
      .filter((id) => id !== bill.id),
  );

  return (
    <div className="bxp">
      <BillStageBar bill={bill} nowMs={nowMs} />

      {/* HO 627 §2 — THE DRILL, moved one level in rather than removed.
          Commit 0 made a plain click on the row's id expand instead of navigate,
          so the panel is now the only place the bill page is reachable from the
          feed — and the pre-627 drill (the `Full Bill Page →` button that used to
          sit in .bxp-btns) was at the BOTTOM of the meta column. That is fine on
          /bills, where the panel is ~1140px and two-column, but the dashboard
          column is 480-780px, so the @container (max-width: 520px) rule stacks
          the panel and pushes those buttons below the whole summary / hearing /
          news / odds run — a long scroll from the row you just clicked.
          So the drill leads the panel instead, packed LEFT (C1 — not a
          far-right anchor), and the duplicate primary button was removed rather
          than leaving the same link twice in one panel. Congress.gov keeps its
          place in .bxp-btns. Shared component: this lands on /bills, /stale,
          /changes, /president, /watchlist and the member hub too — deliberately,
          so the drill sits in one place on every surface. */}
      <div className="bxp-head">
        <a
          className="bxp-head-drill"
          href={`/bill/${bill.id}`}
          onClick={(e) => e.stopPropagation()}
        >
          → Full page
        </a>
      </div>

      <div className="bxp-body">
        {/* LEFT — summary + HEARING / RELATED NEWS / ODDS (mock order) */}
        <div className="bxp-left">
          {bill.summary ? <p className="bxp-summary">{bill.summary}</p> : null}

          {/* HEARING — always-on, rich (HO 324). Leads the related block. */}
          <HearingBlock
            meetings={meetings}
            currentBillId={bill.id}
            loaded={panel !== null}
            silentDays={silentDays}
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
                    {n.source.toUpperCase()} · {formatRelativeAge(n.publishedAt, nowMs)}
                  </span>
                </a>
              ))
            ) : panel !== null ? (
              <div className="bxp-relempty">NO RELATED NEWS</div>
            ) : null}
          </div>

          {/* RELATED BILLS — HO 675. Fourth block, after RELATED NEWS and
              before ODDS, per docs/design/mock-673-related-bills.html section
              04. Deduped against the agenda the HEARING block above chose. */}
          <RelatedBillsBlock
            shape={panel?.relatedBills ?? null}
            agendaIds={hearingAgendaIds}
            loaded={panel !== null}
          />

          {/* ODDS — always; empty state (no bill↔market join today). */}
          <div className="bxp-relblock odds-only" data-market="1">
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
              {showMomentum ? (
                <div className="bxp-mval bxp-cosrow">
                  <span className="bxp-cosval tabular-nums">
                    {bill.cosponsor_count.toLocaleString()}
                  </span>
                  <span className="bxp-cosbar" aria-hidden>
                    {Array.from({ length: 5 }, (_, i) => (
                      <span
                        key={i}
                        className={`bxp-cosseg${
                          i < cosponsorSegments(bill.cosponsor_count!)
                            ? " bxp-cosseg--on"
                            : ""
                        }`}
                      />
                    ))}
                  </span>
                </div>
              ) : (
                <div className="bxp-mval tabular-nums">
                  {bill.cosponsor_count.toLocaleString()} cosponsor
                  {bill.cosponsor_count === 1 ? "" : "s"}
                </div>
              )}
              {/* HO 675 — the party-split faces, BELOW whichever total line
                  the surface shows. /stale keeps its HO 371 support bar and
                  gains the faces; every other surface keeps its plain count.
                  One behaviour on all seven routes (the HO 673 ruling).

                  The total above stays sourced from `bills.cosponsor_count`
                  while these group headers come from the roster, and on 1,919
                  of 13,926 bills (13.78%) the two disagree — median +1, max
                  +50. That is HO 674's filed drift becoming visible, NOT a
                  defect introduced here, and repairing the column is
                  explicitly out of this HO's scope. Ruled visible. */}
              <CosponsorFaces roster={panel?.cosponsors ?? null} />
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
                        ? ` · ${formatRelativeAge(committee0.activityDate, nowMs)}`
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
                    {formatRelativeAge(bill.latest_action_date, nowMs)}
                  </span>
                ) : null}
              </div>
            </div>
          ) : null}

          {/* HO 627 §2: the `Full Bill Page →` primary button moved to the panel
              header (.bxp-head) — see the note there. Congress.gov stays. */}
          {/* HO 632 C3 — the last boxed button in this panel becomes a plain
              amber link. The leading → is the quiet idiom's affordance (mock-632),
              and the ↗ stays because it means something different: one marks the
              link, the other marks that it leaves the site. */}
          <div className="bxp-btns">
            <a
              className="bxp-golink"
              href={cgUrl}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
            >
              → Congress.gov ↗
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
