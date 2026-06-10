"use client";

// HO 226: client wrapper around CartogramShell for /primaries — mirror of HO 225's
// RacesMap. Holds the district-modal open-state + the month scrubber, passes the
// additive onStatePick (opens the modal instead of pinning the inline card) and
// the additive dimmedStates (states outside the selected month dim on the map).
import { useMemo, useState } from "react";
import { CartogramShell } from "@/components/CartogramShell";
import { PrimaryDistrictModal, PrimaryScrubber } from "@/components/PrimaryDistrictModal";
import type { CartogramCell } from "@/lib/cartogram-data";
import type { UsMapGeometry } from "@/lib/us-map-geo";

export function PrimariesMap({
  cells,
  summary,
  geometry,
  listSlot,
}: {
  cells: CartogramCell[];
  summary: string;
  geometry: UsMapGeometry;
  listSlot: React.ReactNode;
}) {
  const [openAbbr, setOpenAbbr] = useState<string | null>(null);
  const [month, setMonth] = useState<number | null>(null); // null = ALL

  // Representative month per state = month of the MAX primary_date among its
  // contests (the same date buildPrimariesCartogram uses for the recency band).
  const stateMonth = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of cells) {
      let max = "";
      for (const con of c.contests) {
        const d = con.primary?.primary_date;
        if (d && d > max) max = d;
      }
      if (max) m.set(c.state, Number(max.slice(5, 7)));
    }
    return m;
  }, [cells]);

  const dimmed = useMemo(() => {
    if (month == null) return undefined;
    const s = new Set<string>();
    for (const c of cells) if (c.active && stateMonth.get(c.state) !== month) s.add(c.state);
    return s;
  }, [month, cells, stateMonth]);

  const openCell = openAbbr ? cells.find((c) => c.state === openAbbr) ?? null : null;

  return (
    <>
      <PrimaryScrubber month={month} onMonth={setMonth} />
      <CartogramShell
        variant="primaries"
        cells={cells}
        summary={summary}
        geometry={geometry}
        listSlot={listSlot}
        onStatePick={setOpenAbbr}
        dimmedStates={dimmed}
      />
      {openCell ? (
        <PrimaryDistrictModal
          abbr={openCell.state}
          contests={openCell.contests}
          month={month}
          onMonth={setMonth}
          onClose={() => setOpenAbbr(null)}
        />
      ) : null}
    </>
  );
}
