import type { TopFirm } from "@/lib/queries";

// HO 442 — the corpus-wide TOP FIRMS leaderboard section on /lobbying. Ranks the
// lobbying shops (registrants) by distinct filings, served O(1) from the
// lda_top_firms blob. Amber filings bar (same treatment as LobbyingMiniBars),
// distinct clients, their top issue area, and how many of their filings cite a
// tracked bill. Server component, inline-styled.
//
// Responsive: the six-column grid overflows under ~640px, so the two lower-
// priority columns (Top issue, Bill-linked) drop below Tailwind's `sm` — matching
// how the feed row degrades (display:none on secondary columns below the
// breakpoint). Grid tracks are Tailwind arbitrary values (not an inline
// grid-template) so a `sm:` variant can swap 4-col → 6-col; the surface keeps its
// no-globals.css-coupling convention.
const GRID =
  "grid items-center gap-2 grid-cols-[24px_minmax(0,1fr)_minmax(0,120px)_52px] " +
  "sm:grid-cols-[24px_minmax(0,1fr)_150px_64px_minmax(0,120px)_64px]";

export function FirmsLeaderboard({
  firms,
  totalRegistrants,
}: {
  firms: TopFirm[];
  totalRegistrants: number;
}) {
  if (firms.length === 0) return null;
  const max = Math.max(1, ...firms.map((f) => f.filings));
  return (
    <section className="mt-6">
      <div className="mb-2 flex flex-wrap items-baseline gap-2">
        <h2
          className="text-[length:var(--fs-12)] uppercase tracking-[0.5px]"
          style={{ color: "var(--text-secondary)" }}
        >
          Top firms · by filing volume
        </h2>
        <span
          className="text-[length:var(--fs-11)] uppercase tracking-[0.5px] tabular-nums"
          style={{ color: "var(--text-dim)" }}
        >
          top {firms.length} of {totalRegistrants.toLocaleString()} registrants
        </span>
      </div>
      {/* HO 615 — data-viz-row: this is a bar chart with a label column, not a
          table, so the space between a firm's name and the bar track is the
          SHARED AXIS every bar starts from, and the space between a short bar and
          its number is that bar's own value. Measured before marking (the curve
          is in the commit body): the void is 476-699px, it lies between the name
          and the bar column's fixed origin, and capping the name track clips 2
          labels at 260px while leaving all 25 rows over threshold — a cap cannot
          reach it, because the void is the 1fr track, not the name.
          The attribute goes on the TABLE and not on the row list because the
          column header's geometry is not independently choosable: it has to sit
          over the columns it labels. */}
      <div className="border" data-viz-row style={{ borderColor: "var(--border-strong)" }}>
        <div
          className={`${GRID} px-[14px] py-2 text-[length:var(--fs-10)] uppercase tracking-[0.5px]`}
          style={{
            color: "var(--text-dim)",
            borderBottom: "0.5px solid var(--border-strong)",
          }}
        >
          <span className="text-right">#</span>
          <span>Firm</span>
          <span>Filings</span>
          <span className="text-right">Clients</span>
          <span className="hidden sm:block">Top issue</span>
          <span className="hidden text-right sm:block">Bill-linked</span>
        </div>
        {/* HO 492: bounded scroll region so the leaderboard rows don't stack
            full-height; the column header above stays put. */}
        <div className="lob-sec-scroll">
          {firms.map((f, i) => (
          <div
            key={f.name}
            className={`${GRID} px-[14px] py-[7px]`}
            style={{
              borderTop: i === 0 ? undefined : "0.5px solid var(--border-soft)",
            }}
          >
            <span
              className="text-right text-[length:var(--fs-12)] tabular-nums"
              style={{ color: "var(--text-dim)" }}
            >
              {i + 1}
            </span>
            <span
              className="truncate text-[length:var(--fs-12)]"
              style={{ color: "var(--text-secondary)" }}
              title={f.name}
            >
              {f.name}
            </span>
            <span
              className="grid items-center gap-2"
              style={{ gridTemplateColumns: "minmax(0,1fr) 40px" }}
            >
              <span
                className="block h-[8px] overflow-hidden rounded-[2px]"
                style={{ backgroundColor: "var(--bg-row-hover)" }}
                aria-hidden
              >
                <span
                  className="block h-full rounded-[2px]"
                  style={{
                    width: `${(f.filings / max) * 100}%`,
                    backgroundColor: "var(--accent-amber)",
                    opacity: 0.55,
                  }}
                />
              </span>
              <span
                className="text-right text-[length:var(--fs-12)] tabular-nums"
                style={{ color: "var(--text-muted)" }}
              >
                {f.filings.toLocaleString()}
              </span>
            </span>
            <span
              className="text-right text-[length:var(--fs-12)] tabular-nums"
              style={{ color: "var(--text-muted)" }}
            >
              {f.clients.toLocaleString()}
            </span>
            <span
              className="hidden truncate text-[length:var(--fs-12)] sm:block"
              style={{ color: "var(--text-muted)" }}
              title={f.topIssueDisplay ?? ""}
            >
              {f.topIssueCode ? (
                <>
                  <span style={{ color: "var(--accent-amber)" }}>{f.topIssueCode}</span>{" "}
                  <span style={{ color: "var(--text-dim)" }}>{f.topIssueDisplay}</span>
                </>
              ) : (
                <span style={{ color: "var(--text-dim)" }}>—</span>
              )}
            </span>
            <span
              className="hidden text-right text-[length:var(--fs-12)] tabular-nums sm:block"
              style={{ color: "var(--text-muted)" }}
            >
              {f.billLinked.toLocaleString()}
            </span>
          </div>
          ))}
        </div>
      </div>
    </section>
  );
}
