// HO 244 (commit 2) — the weekly band: one full-width line directly under the
// races panel (with a divider rule above it), showing this-week activity counts
// plus a READ FULL → into the latest weekly report. It REPLACES the HO 153
// ReportSnapshot teaser AND folds in the HO 232 standalone EnactedBanner (the
// `● {n} enacted · <ids>` segment here), so both of those are removed from the
// dashboard.
//
// Counts are the trailing-7-day windows the dashboard already uses (enacted via
// queryEnactedThisWeek, stage transitions via getStageChanges, new bills via
// getNewBillsThisWeekCount) — all non-ceremonial. The WEEK OF date is the
// current week's Monday (the metrics' week); READ FULL → points at the most
// recent PUBLISHED report (the prior completed week — that's how weekly reports
// land), so the date label and the link week can differ by design.
//
// "IN GOV-OPS" from the spec is intentionally DROPPED: it has no clean honest
// definition that fits the trailing-7-day activity theme (it reads as a
// snapshot, not a delta), so per HO 244's "pragmatic or drop" it's omitted
// rather than fabricated. Event callouts (top stage-movers) are likewise
// omitted — they ride stage_transitions, still thin (planted write-only HO 232).
import Link from "next/link";
import {
  type WeeklyBandBreakdown,
  WeeklyBandMetricCard,
} from "@/components/WeeklyBandMetricCard";
import {
  getDashboardReportSnapshot,
  getEnactedThisWeek,
  getMostRecentEnacted,
  getNewBillsThisWeekCount,
  getStageChangesCount,
  getWeeklyBandFiller,
  getWeeklyBandHearingBreakdown,
  getWeeklyBandHearings,
  getWeeklyBandHistory,
  getWeeklyBandNewBillsBreakdown,
  getWeeklyBandPriorWeek,
  getWeeklyBandTransitionLadder,
} from "@/lib/queries";

const ENACTED_ID_CAP = 3;

// HO 365: MON DD formatter (uppercased by the band's text-transform) for the
// "WEEK OF JUN 22" header and the "JUN 15 REPORT →" link. UTC, to match the
// YYYY-MM-DD week-start strings.
const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];
function monDd(iso: string): string {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

// HO 283: the week-over-week delta that rides after each metric's value+label.
// ▲ up (--market-up green) / ▼ down (--market-down red) — the tape's directional
// tokens, so the color convention matches — and a dim ±0 when unchanged. The
// magnitude is abs(diff); the arrow carries direction. No popover here (that's
// 284); the hover detail comes later.
function WeekDelta({ now, prior }: { now: number; prior: number }) {
  const diff = now - prior;
  const dir = diff > 0 ? "up" : diff < 0 ? "down" : "flat";
  return (
    <span
      className={`weekly-band-delta weekly-band-delta--${dir}`}
      aria-label={`${
        dir === "up" ? "up" : dir === "down" ? "down" : "no change"
      } ${Math.abs(diff).toLocaleString()} vs last week`}
    >
      {dir === "flat"
        ? "±0"
        : `${dir === "up" ? "▲" : "▼"}${Math.abs(diff).toLocaleString()}`}
    </span>
  );
}

// Monday of `weeksAgo` weeks back, UTC, as YYYY-MM-DD (matches the reports'
// weekStart format). Day-granular glance labels, not query boundaries:
// weekStartISO(0) is the band's "Week of" header; weekStartISO(1) is the prior
// week's start shown in each popover's "last week (DATE)". (The counts behind
// the deltas are trailing-7-day windows, not Mon–Sun — the same label-vs-window
// convention the band has carried since HO 244.)
function weekStartISO(weeksAgo = 0): string {
  const now = new Date();
  const sinceMonday = (now.getUTCDay() + 6) % 7; // 0=Mon … 6=Sun
  const monday = new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate() - sinceMonday - 7 * weeksAgo,
    ),
  );
  return monday.toISOString().slice(0, 10);
}

export async function WeeklyBand() {
  const [
    enacted,
    transitions,
    newBills,
    hearings,
    filler,
    prior,
    snap,
    history,
    ladder,
    newBillsBd,
    hearingBd,
    lastEnacted,
  ] = await Promise.all([
    getEnactedThisWeek(),
    getStageChangesCount({}, 7),
    getNewBillsThisWeekCount(),
    getWeeklyBandHearings(),
    getWeeklyBandFiller(),
    getWeeklyBandPriorWeek(),
    getDashboardReportSnapshot(),
    getWeeklyBandHistory(),
    getWeeklyBandTransitionLadder(),
    getWeeklyBandNewBillsBreakdown(),
    getWeeklyBandHearingBreakdown(),
    getMostRecentEnacted(),
  ]);

  const enactedShown = enacted.slice(0, ENACTED_ID_CAP);
  const enactedMore = enacted.length - enactedShown.length;

  // HO 365: each metric's card delta/subline uses the SAME prior trailing-7d
  // value as the strip's inline WeekDelta (so card delta == strip delta); the
  // subline date is the prior window's edge, today−7d (MON DD via the card).
  const priorDateISO = new Date(Date.now() - 7 * 86_400_000)
    .toISOString()
    .slice(0, 10);

  // HO 365: 8-point spark per metric = the ≤7 finalized history weeks
  // (oldest→newest) + the running-week live headline as the lit final bar (so
  // the lit bar == the header value).
  const enactedSpark = [...history.map((h) => h.enacted), enacted.length];
  const newBillsSpark = [...history.map((h) => h.newBills), newBills];
  const transitionsSpark = [
    ...history.map((h) => h.transitions),
    transitions.total,
  ];
  const hearingsSpark = [...history.map((h) => h.hearings), hearings.thisWeek];

  const enactedBreakdown: WeeklyBandBreakdown = {
    kind: "enacted",
    bills: enacted,
    lastEnacted,
  };
  const newBillsBreakdown: WeeklyBandBreakdown = {
    kind: "newbills",
    house: newBillsBd.house,
    senate: newBillsBd.senate,
    topTopics: newBillsBd.topTopics,
  };
  const transitionsBreakdown: WeeklyBandBreakdown = {
    kind: "transitions",
    ladder,
  };
  const hearingsBreakdown: WeeklyBandBreakdown = {
    kind: "hearings",
    byType: hearingBd.byType,
    byChamber: hearingBd.byChamber,
  };

  // HO 351 — filler share of THIS WEEK's total introductions (ceremonial
  // INCLUDED — that's the right denominator for a share; NOT the NEW BILLS
  // count). The segment carries both the % and the n/total so the /total
  // doesn't read as inconsistent with the NEW BILLS figure beside it.
  const fillerPct =
    filler.total > 0 ? Math.round((filler.filler / filler.total) * 100) : 0;

  return (
    <section className="weekly-band" aria-label="This week">
      <span className="weekly-band-weekof">
        Week of <span className="tabular-nums">{monDd(weekStartISO())}</span>
      </span>

      <span className="weekly-band-sep" aria-hidden>
        ·
      </span>

      {/* Enacted segment — folds in the former EnactedBanner. The N=0 state is
          visible by design (`● 0 enacted`), never hidden. The popover wraps the
          metric core; the bill-id links trail outside it, still clickable. */}
      <span className="weekly-band-seg weekly-band-enacted">
        <WeeklyBandMetricCard
          label="ENACTED"
          value={enacted.length}
          prior={prior.enacted}
          priorDate={priorDateISO}
          spark={enactedSpark}
          breakdown={enactedBreakdown}
        >
          <span className="weekly-band-dot" aria-hidden>
            ●
          </span>{" "}
          <span className="weekly-band-num">
            {enacted.length.toLocaleString()}
          </span>{" "}
          enacted <WeekDelta now={enacted.length} prior={prior.enacted} />
        </WeeklyBandMetricCard>
        {enactedShown.length > 0 ? (
          <span className="weekly-band-ids">
            <span aria-hidden>·</span>
            {enactedShown.map((b) => (
              <Link
                key={b.id}
                href={`/bill/${b.id}`}
                className="weekly-band-id"
              >
                {b.billType.toUpperCase()} {b.billNumber}
              </Link>
            ))}
            {enactedMore > 0 ? (
              <Link
                href="/bills?stage=enacted"
                className="weekly-band-id weekly-band-id--more"
              >
                +{enactedMore.toLocaleString()}
              </Link>
            ) : null}
          </span>
        ) : null}
      </span>

      <span className="weekly-band-sep" aria-hidden>
        ·
      </span>

      <span className="weekly-band-seg">
        <WeeklyBandMetricCard
          label="NEW BILLS"
          value={newBills}
          prior={prior.newBills}
          priorDate={priorDateISO}
          spark={newBillsSpark}
          breakdown={newBillsBreakdown}
        >
          <span className="weekly-band-num">{newBills.toLocaleString()}</span>{" "}
          new bills <WeekDelta now={newBills} prior={prior.newBills} />
        </WeeklyBandMetricCard>
      </span>

      <span className="weekly-band-sep" aria-hidden>
        ·
      </span>

      <span className="weekly-band-seg">
        <WeeklyBandMetricCard
          label="STAGE TRANSITIONS"
          value={transitions.total}
          prior={prior.transitions}
          priorDate={priorDateISO}
          spark={transitionsSpark}
          breakdown={transitionsBreakdown}
        >
          <span className="weekly-band-num">
            {transitions.total.toLocaleString()}
          </span>{" "}
          stage transitions{" "}
          <WeekDelta now={transitions.total} prior={prior.transitions} />
        </WeeklyBandMetricCard>
      </span>

      <span className="weekly-band-sep" aria-hidden>
        ·
      </span>

      {/* HO 286: HEARINGS — fourth metric, committee-meeting count over the
          trailing-7-day window (held meetings only), same shape as the others.
          Sourced from getWeeklyBandHearings (committee_meetings); tag "meetings",
          so the committees cron flushes it independent of the bills tag. */}
      <span className="weekly-band-seg">
        <WeeklyBandMetricCard
          label="HEARINGS"
          value={hearings.thisWeek}
          prior={hearings.priorWeek}
          priorDate={priorDateISO}
          spark={hearingsSpark}
          breakdown={hearingsBreakdown}
        >
          <span className="weekly-band-num">
            {hearings.thisWeek.toLocaleString()}
          </span>{" "}
          hearings{" "}
          <WeekDelta now={hearings.thisWeek} prior={hearings.priorWeek} />
        </WeeklyBandMetricCard>
      </span>

      <span className="weekly-band-sep" aria-hidden>
        ·
      </span>

      {/* HO 351 — filler-share bar. HO 365 folded it INTO the metric run (after
          HEARINGS, joined by a middot — no longer right-pinned); the mini bar
          stays (the one composition stat). It gets no hover card. */}
      <span
        className="weekly-band-filler"
        title={`Filler this week: ${filler.filler.toLocaleString()} of ${filler.total.toLocaleString()} introductions (ceremonial or one of the four ceremonial patterns)`}
      >
        <span className="weekly-band-filler-track" aria-hidden>
          <span
            className="weekly-band-filler-fill"
            style={{ width: `${fillerPct}%` }}
          />
        </span>
        <span className="weekly-band-filler-label">
          filler <span className="weekly-band-num">{fillerPct}%</span> ·{" "}
          {filler.filler.toLocaleString()}/{filler.total.toLocaleString()}
        </span>
      </span>

      {snap ? (
        <Link
          href={`/reports/${snap.latest.slug}`}
          className="weekly-band-readfull"
        >
          {monDd(snap.latest.weekStart)} report →
        </Link>
      ) : null}
    </section>
  );
}
