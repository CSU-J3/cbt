"use client";

// HO 333 — the single Electoral surface. Owns the interaction state shared by
// the competitive map and the primary-calendar timeline:
//   locked   — the set of selected primary dates (drives the amber map highlight)
//   hovered  — the date currently hovered in the timeline (drives the preview)
//   openAbbr — the district-modal state (HO 225 drill, kept on this surface)
// The map stays the existing competitive purple map; the timeline ADDS the amber
// highlight layer on top. Clicking a STATE still opens the HO 225 district modal
// (state-click drill preserved); the timeline is what paints the amber.
import { useMemo, useState } from "react";
import { CartogramShell } from "@/components/CartogramShell";
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
  cells,
  summary,
  geometry,
  listSlot,
  calendar,
  todayISO,
}: {
  cells: CartogramCell[];
  summary: string;
  geometry: UsMapGeometry;
  listSlot: React.ReactNode;
  calendar: PrimaryCalendarDate[];
  todayISO: string;
}) {
  const [locked, setLocked] = useState<ReadonlySet<string>>(new Set());
  const [hovered, setHovered] = useState<string | null>(null);
  const [openAbbr, setOpenAbbr] = useState<string | null>(null);

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

  // Header legend totals.
  const totalContests = calendar.reduce((a, c) => a + c.contestCount, 0);
  const votedContests = calendar.reduce(
    (a, c) => a + (c.date <= todayISO ? c.contestCount : 0),
    0,
  );

  // Readout (under the timeline) reads the same locked state.
  const lockedDates = [...locked].sort();
  const lockedContests = lockedDates.reduce(
    (a, d) => a + (dateToCount.get(d) ?? 0),
    0,
  );

  return (
    <>
      <CartogramShell
        variant="races"
        cells={cells}
        summary={summary}
        geometry={geometry}
        listSlot={listSlot}
        onStatePick={setOpenAbbr}
        highlightedStates={highlightedStates}
        previewStates={previewStates}
      />
      {openCell ? (
        <RaceDistrictModal
          abbr={openCell.state}
          contests={openCell.contests}
          onClose={() => setOpenAbbr(null)}
        />
      ) : null}

      {/* Primary-calendar timeline band — drives the map highlight above. */}
      <div className="electoral-tl-band">
        <div className="electoral-tl-head">
          <span className="electoral-tl-title">PRIMARY CALENDAR · 2026</span>
          <span className="electoral-tl-legend">
            {totalContests} contests · {votedContests} voted
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
        </div>

        <PrimaryTimeline
          calendar={calendar}
          todayISO={todayISO}
          locked={locked}
          onHover={setHovered}
          onToggle={toggle}
        />

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
                — {highlightedStates.size} states · {lockedContests} contests
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
    </>
  );
}
