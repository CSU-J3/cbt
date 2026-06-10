"use client";

// HO 225: thin client wrapper around CartogramShell for /races — holds the
// district-modal open state and passes CartogramShell the additive `onStatePick`
// handler so a state click opens the modal instead of pinning the inline card.
// /primaries renders CartogramShell directly (no onStatePick) and is unchanged.
import { useState } from "react";
import { CartogramShell } from "@/components/CartogramShell";
import { RaceDistrictModal } from "@/components/RaceDistrictModal";
import type { CartogramCell } from "@/lib/cartogram-data";
import type { UsMapGeometry } from "@/lib/us-map-geo";

export function RacesMap({
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
  const openCell = openAbbr ? cells.find((c) => c.state === openAbbr) ?? null : null;

  return (
    <>
      <CartogramShell
        variant="races"
        cells={cells}
        summary={summary}
        geometry={geometry}
        listSlot={listSlot}
        onStatePick={setOpenAbbr}
      />
      {openCell ? (
        <RaceDistrictModal
          abbr={openCell.state}
          contests={openCell.contests}
          onClose={() => setOpenAbbr(null)}
        />
      ) : null}
    </>
  );
}
