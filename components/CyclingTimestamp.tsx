"use client";

// HO 183 — the masthead `LAST SYNC` time, cycling through US zones (ET → CT →
// MT → PT → UTC) via the shared useZoneCycle hook. The surrounding
// `· LAST SYNC … · N BILLS TRACKED` affixes (incl. the <700 .show-desktop
// abbreviation) stay server-rendered in HomeHeader — this island owns only the
// rotating time-and-zone token. SSR/first paint renders MT, identical to the
// old static formatLastUpdated output, so there's no hydration mismatch.
//
// HO 818 — THE STAMP HOLDS ITS WIDEST ZONE'S WIDTH. A zone's text can be a
// character or two longer than another's (`1:00 PM ET` beside `12:00 PM CT`;
// which zone is wide follows the sync's hour), so whatever followed the stamp
// on its line moved as the zones cycled, and at some widths the line wrapped and
// the masthead grew. The five zones' texts now sit hidden in one grid cell
// (`.zone-stamp`, app/globals.css), so the cell is as wide as the widest in any
// font, and the live one draws on top. The cycling still swaps one text node.
// HYDRATION IS UNCHANGED: the hidden texts come from `iso` alone, so the server
// and the first client paint render the same markup with MT showing, and the
// live zone still arrives in useZoneCycle's effect. `lib/zone-cycle.ts` doesn't
// change.
import { ZONES, formatInZone, useZoneCycle } from "@/lib/zone-cycle";

export function CyclingTimestamp({ iso }: { iso: string | null | undefined }) {
  const zone = useZoneCycle();
  return (
    <span className="zone-stamp">
      {ZONES.map((z) => (
        <span key={z.label} className="zone-stamp-size" aria-hidden="true">
          {formatInZone(iso, z)}
        </span>
      ))}
      <span className="zone-stamp-now">{formatInZone(iso, zone)}</span>
    </span>
  );
}
