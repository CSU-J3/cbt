import Link from "next/link";
import { Tooltip } from "@/components/Tooltip";
import type { DashboardPrimariesData } from "@/lib/queries";

// HO 233 — PRIMARIES tab body on the dashboard races panel: a 6-month timeline
// strip (today marker at the left edge, sparse month labels, one tick per
// primary date scaled by contest count, HO 147 tooltip per tick), a 2×2 of the
// soonest upcoming dates, and an expander into /primaries. Pre-results surface —
// no ShareBar, no advancer ★ (upcoming contests have no vote_pct yet). Existing
// tokens only; amber = the soonest (card) dates, dim = later, matching the HO
// 210 primaries recency language without VOTED-cyan (nothing's voted here).

const MIN_TICK_PX = 6;
const MAX_TICK_PX = 26;
const MAX_CARD_STATES = 4;

function dayDelta(fromIso: string, toIso: string): number {
  return (Date.parse(`${toIso}T00:00:00Z`) - Date.parse(`${fromIso}T00:00:00Z`)) / 86_400_000;
}

// "JUN 23" — compact mono date for the strip tooltip + card headline.
function fmtDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  const month = d.toLocaleString("en-US", { month: "short", timeZone: "UTC" });
  return `${month.toUpperCase()} ${d.getUTCDate()}`;
}

// First-of-month markers strictly inside the window (the month boundaries the
// spec wants labeled), positioned by their fractional offset across the window.
function monthMarkers(
  start: string,
  end: string,
): { label: string; xPct: number }[] {
  const total = Math.max(1, dayDelta(start, end));
  const s = new Date(`${start}T00:00:00Z`);
  const e = new Date(`${end}T00:00:00Z`);
  const out: { label: string; xPct: number }[] = [];
  let d = new Date(Date.UTC(s.getUTCFullYear(), s.getUTCMonth() + 1, 1));
  while (d <= e) {
    const iso = d.toISOString().slice(0, 10);
    out.push({
      label: d
        .toLocaleString("en-US", { month: "short", timeZone: "UTC" })
        .toUpperCase(),
      xPct: (dayDelta(start, iso) / total) * 100,
    });
    d = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1));
  }
  return out;
}

export function DashboardPrimaries({ data }: { data: DashboardPrimariesData }) {
  const { strip, cards, windowStart, windowEnd } = data;

  if (cards.length === 0) {
    return (
      <div className="dash-prim-empty">
        No upcoming primaries in the next 6 months.
      </div>
    );
  }

  const total = Math.max(1, dayDelta(windowStart, windowEnd));
  const maxCount = Math.max(1, ...strip.map((p) => p.count));
  const months = monthMarkers(windowStart, windowEnd);

  return (
    <div className="dash-prim">
      <div
        className="dash-prim-strip"
        aria-label="Upcoming primary calendar, next 6 months"
      >
        <span className="dash-prim-axis" aria-hidden />
        <span className="dash-prim-nowline" aria-hidden />
        <span className="dash-prim-today">TODAY</span>
        {months.map((m) => (
          <span
            key={m.label}
            className="dash-prim-month"
            style={{ left: `${m.xPct}%` }}
            aria-hidden
          >
            {m.label}
          </span>
        ))}
        {strip.map((p) => {
          const x = (dayDelta(windowStart, p.date) / total) * 100;
          const h =
            MIN_TICK_PX + (p.count / maxCount) * (MAX_TICK_PX - MIN_TICK_PX);
          return (
            <span
              key={p.date}
              className="dash-prim-tickwrap"
              style={{ left: `${x}%` }}
            >
              <Tooltip
                variant="term"
                content={{
                  kind: "text",
                  label: fmtDate(p.date),
                  body: `${p.count} contest${p.count === 1 ? "" : "s"}`,
                }}
                ariaLabel={`${fmtDate(p.date)}: ${p.count} contests`}
              >
                <span
                  className={`dash-prim-tick${p.soon ? " dash-prim-tick--soon" : ""}`}
                  style={{ height: `${h}px` }}
                />
              </Tooltip>
            </span>
          );
        })}
      </div>

      <div className="dash-prim-grid">
        {cards.map((c) => {
          const states =
            c.states.length > MAX_CARD_STATES
              ? `${c.states.slice(0, MAX_CARD_STATES).join(" · ")} +${c.states.length - MAX_CARD_STATES}`
              : c.states.join(" · ");
          return (
            <Link key={c.date} href="/primaries" className="dash-prim-card">
              <span className="dash-prim-card-date">{fmtDate(c.date)}</span>
              <span className="dash-prim-card-meta">
                {states} · {c.count} contest{c.count === 1 ? "" : "s"}
              </span>
              <span className="dash-prim-card-seats">
                {c.seats.map((seat, i) => (
                  <span
                    key={seat.label}
                    style={{
                      color: seat.rated
                        ? "var(--accent-amber)"
                        : "var(--text-muted)",
                    }}
                  >
                    {i > 0 ? " · " : ""}
                    {seat.label}
                  </span>
                ))}
                {c.moreSeats > 0 ? (
                  <span style={{ color: "var(--text-dim)" }}>
                    {" "}
                    · +{c.moreSeats}
                  </span>
                ) : null}
              </span>
            </Link>
          );
        })}
      </div>

      <Link href="/primaries" className="home-expander">
        [ All primaries → ]
      </Link>
    </div>
  );
}
