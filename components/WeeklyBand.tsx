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
  getDashboardReportSnapshot,
  getEnactedThisWeek,
  getNewBillsThisWeekCount,
  getStageChangesCount,
  getWeeklyBandPriorWeek,
} from "@/lib/queries";

const ENACTED_ID_CAP = 3;

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

// Monday of the current week, UTC, as YYYY-MM-DD (matches the reports' weekStart
// format). Day-granular; a glance label, not a boundary used for any query.
function currentWeekStartISO(): string {
  const now = new Date();
  const sinceMonday = (now.getUTCDay() + 6) % 7; // 0=Mon … 6=Sun
  const monday = new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate() - sinceMonday,
    ),
  );
  return monday.toISOString().slice(0, 10);
}

export async function WeeklyBand() {
  const [enacted, transitions, newBills, prior, snap] = await Promise.all([
    getEnactedThisWeek(),
    getStageChangesCount({}, 7),
    getNewBillsThisWeekCount(),
    getWeeklyBandPriorWeek(),
    getDashboardReportSnapshot(),
  ]);

  const enactedShown = enacted.slice(0, ENACTED_ID_CAP);
  const enactedMore = enacted.length - enactedShown.length;

  return (
    <section className="weekly-band" aria-label="This week">
      <span className="weekly-band-weekof">
        Week of <span className="tabular-nums">{currentWeekStartISO()}</span>
      </span>

      <span className="weekly-band-sep" aria-hidden>
        |
      </span>

      {/* Enacted segment — folds in the former EnactedBanner. The N=0 state is
          visible by design (`● 0 enacted`), never hidden. */}
      <span className="weekly-band-seg weekly-band-enacted">
        <span className="weekly-band-dot" aria-hidden>
          ●
        </span>{" "}
        <span className="weekly-band-num">
          {enacted.length.toLocaleString()}
        </span>{" "}
        enacted <WeekDelta now={enacted.length} prior={prior.enacted} />
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
        |
      </span>

      <span className="weekly-band-seg">
        <span className="weekly-band-num">{newBills.toLocaleString()}</span> new
        bills <WeekDelta now={newBills} prior={prior.newBills} />
      </span>

      <span className="weekly-band-sep" aria-hidden>
        |
      </span>

      <span className="weekly-band-seg">
        <span className="weekly-band-num">
          {transitions.total.toLocaleString()}
        </span>{" "}
        stage transitions{" "}
        <WeekDelta now={transitions.total} prior={prior.transitions} />
      </span>

      {snap ? (
        <Link
          href={`/reports/${snap.latest.slug}`}
          className="weekly-band-readfull"
        >
          read full →
        </Link>
      ) : null}
    </section>
  );
}
