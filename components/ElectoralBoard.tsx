"use client";

// HO 333 — the single Electoral surface. Owns the interaction state shared by
// the competitive map and the primary-calendar timeline:
//   locked   — the set of selected primary dates (drives the amber map highlight)
//   hovered  — the date currently hovered in the timeline (drives the preview)
//   openAbbr — the district-modal state (HO 225 drill, kept on this surface)
// The map stays the existing competitive purple map; the timeline ADDS the amber
// highlight layer on top. Clicking a STATE still opens the HO 225 district modal
// (state-click drill preserved); the timeline is what paints the amber.
//
// HO 767 (mock-767 v18, CALENDAR 2 · LEAD B): the calendar comes FIRST, under
// the title and over the band, folded to one line (its counts and the next
// date); opened, the bars run to mid-November and the year's dates are listed
// under them. It stays in this board because the board owns the state it
// shares with the map, so the band (Battlefield and the Kalshi cells) arrives
// as a slot rendered between the calendar and the controls.
import { useEffect, useId, useMemo, useState } from "react";
import { CartogramShell } from "@/components/CartogramShell";
import { ELECTORAL_LAYOUT_EVENT } from "@/components/ListQueryContext";
import { PrimaryTimeline } from "@/components/PrimaryTimeline";
import { RaceDistrictModal } from "@/components/RaceDistrictModal";
import type { CartogramCell } from "@/lib/cartogram-data";
import type { PrimaryCalendarDate } from "@/lib/queries";
import type { UsMapGeometry } from "@/lib/us-map-geo";

const MON = [
  "JAN", "FEB", "MAR", "APR", "MAY", "JUN",
  "JUL", "AUG", "SEP", "OCT", "NOV", "DEC",
];

function monDay(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  return `${MON[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

export function ElectoralBoard({
  cycle,
  cells,
  summary,
  geometry,
  listSlot,
  bandSlot,
  calendar,
  todayISO,
  nowMs,
  initialView = "map",
}: {
  cycle: number;
  cells: CartogramCell[];
  summary: string;
  geometry: UsMapGeometry;
  listSlot: React.ReactNode;
  bandSlot?: React.ReactNode;
  calendar: PrimaryCalendarDate[];
  todayISO: string;
  // HO 768: the page's clock, for the MAP's market close checks.
  nowMs: number;
  initialView?: "map" | "list";
}) {
  const [locked, setLocked] = useState<ReadonlySet<string>>(new Set());
  const [hovered, setHovered] = useState<string | null>(null);
  const [openAbbr, setOpenAbbr] = useState<string | null>(null);
  const [calOpen, setCalOpen] = useState(false);
  const bodyId = useId();

  useEffect(() => {
    window.dispatchEvent(new Event(ELECTORAL_LAYOUT_EVENT));
  }, [calOpen]);

  const dateToStates = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const c of calendar) m.set(c.date, c.states);
    return m;
  }, [calendar]);

  const dateToCount = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of calendar) m.set(c.date, c.contestCount);
    return m;
  }, [calendar]);

  // locked dates → the union of states voting on any of them (amber fill set).
  const highlightedStates = useMemo(() => {
    const s = new Set<string>();
    for (const date of locked)
      for (const st of dateToStates.get(date) ?? []) s.add(st);
    return s;
  }, [locked, dateToStates]);

  // hovered date → its states (transient outline preview).
  const previewStates = useMemo(
    () => (hovered ? dateToStates.get(hovered) ?? [] : []),
    [hovered, dateToStates],
  );

  function toggle(date: string) {
    setLocked((prev) => {
      const next = new Set(prev);
      if (next.has(date)) next.delete(date);
      else next.add(date);
      return next;
    });
  }

  const openCell = openAbbr
    ? cells.find((c) => c.state === openAbbr) ?? null
    : null;

  // Header legend totals. A date on or before today has voted, as the bars
  // color it; the next date is the first one after today.
  const totalContests = calendar.reduce((a, c) => a + c.contestCount, 0);
  const votedContests = calendar.reduce(
    (a, c) => a + (c.date <= todayISO ? c.contestCount : 0),
    0,
  );
  const next = calendar.find((c) => c.date > todayISO) ?? null;

  // Readout (under the timeline) reads the same locked state. HO 768: it names
  // the stacked states, A to Z, so a lock reads in LIST too, where the amber
  // map it paints is one toggle away.
  const lockedDates = [...locked].sort();
  const lockedContests = lockedDates.reduce(
    (a, d) => a + (dateToCount.get(d) ?? 0),
    0,
  );
  const lockedStates = [...highlightedStates].sort();

  return (
    <>
      {/* Primary-calendar band — folded to one line; opened, it drives the map
          highlight under the controls. */}
      <div className="electoral-tl-band electoral-tl-band--top" data-open={calOpen ? "" : undefined}>
        <button
          type="button"
          className="electoral-tl-head electoral-tl-fold"
          aria-expanded={calOpen}
          aria-controls={calOpen ? bodyId : undefined}
          onClick={() => setCalOpen((o) => !o)}
        >
          <span className="electoral-tl-title">PRIMARY CALENDAR · {cycle}</span>
          <span className="electoral-tl-count">
            {totalContests} contests · {votedContests} voted
          </span>
          {calOpen ? (
            <span className="electoral-tl-legend">
              <span
                className="electoral-tl-swatch"
                style={{ background: "#0e7490" }}
              />
              VOTED
              <span
                className="electoral-tl-swatch"
                style={{ background: "#b45309" }}
              />
              UPCOMING
            </span>
          ) : next ? (
            // No separator dot before NEXT: a wrapped phone line would open on it.
            <span className="electoral-tl-next">
              NEXT {monDay(next.date)} · {next.states.join(" ")} · {next.contestCount}
            </span>
          ) : null}
          <span className="electoral-tl-chev" aria-hidden>
            {calOpen ? "▾" : "▸"}
          </span>
        </button>

        {calOpen ? (
          <div id={bodyId}>
            <PrimaryTimeline
              cycle={cycle}
              calendar={calendar}
              todayISO={todayISO}
              locked={locked}
              onHover={setHovered}
              onToggle={toggle}
            />

            {/* The year's primaries: a date, its states, its contests, read down
                each column. CSS multi-column, so its rag is the column gutter
                (SKILL, the column-flow clause): marked for the layout audit. */}
            <div className="electoral-cal-list" data-col-flow>
              {calendar.map((c) => (
                <div
                  key={c.date}
                  className={c.date > todayISO ? "electoral-cal-row is-up" : "electoral-cal-row"}
                >
                  <span className="electoral-cal-d">{monDay(c.date)}</span>
                  <span className="electoral-cal-s">
                    {c.states.join(" ")}{" "}
                    <span className="electoral-cal-n">· {c.contestCount}</span>
                  </span>
                </div>
              ))}
            </div>

            <div className="electoral-readout">
              {lockedDates.length === 0 ? (
                <>
                  <span className="electoral-readout-mark">▸</span>
                  <span className="electoral-readout-hint">
                    click primary dates to stack which states vote then · click again
                    to drop one
                  </span>
                </>
              ) : (
                <>
                  <span className="electoral-readout-mark">▸</span>
                  <span className="electoral-readout-dates">
                    {lockedDates.map(monDay).join(" · ")}
                  </span>
                  <span className="electoral-readout-count">
                    — {lockedStates.join(" ")} · {lockedContests} contests
                  </span>
                  <button
                    type="button"
                    className="electoral-readout-clear"
                    onClick={() => setLocked(new Set())}
                  >
                    CLEAR ALL
                  </button>
                </>
              )}
            </div>
          </div>
        ) : null}
      </div>

      {bandSlot}

      <CartogramShell
        cells={cells}
        summary={summary}
        geometry={geometry}
        listSlot={listSlot}
        onStatePick={setOpenAbbr}
        highlightedStates={highlightedStates}
        previewStates={previewStates}
        initialView={initialView}
        nowMs={nowMs}
      />
      {openCell ? (
        <RaceDistrictModal
          abbr={openCell.state}
          contests={openCell.contests}
          onClose={() => setOpenAbbr(null)}
          nowMs={nowMs}
        />
      ) : null}
    </>
  );
}
