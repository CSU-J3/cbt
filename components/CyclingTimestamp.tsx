"use client";

// HO 183 — the masthead `LAST SYNC` time, cycling through US zones (ET → CT →
// MT → PT → UTC) via the shared useZoneCycle hook. The surrounding
// `· LAST SYNC … · N BILLS TRACKED` affixes (incl. the <700 .show-desktop
// abbreviation) stay server-rendered in HomeHeader — this island owns only the
// rotating time-and-zone token. SSR/first paint renders MT, identical to the
// old static formatLastUpdated output, so there's no hydration mismatch.
import { formatInZone, useZoneCycle } from "@/lib/zone-cycle";

export function CyclingTimestamp({ iso }: { iso: string | null | undefined }) {
  const zone = useZoneCycle();
  return <>{formatInZone(iso, zone)}</>;
}
