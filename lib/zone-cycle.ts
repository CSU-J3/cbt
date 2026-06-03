// HO 183 — cycle a FIXED past timestamp through US time zones for a
// Bloomberg-terminal world-clock feel. Two dashboard stamps consume this:
// the masthead `LAST SYNC` (HomeHeader → CyclingTimestamp) and the markets
// tape `AS OF` (MarketsTapeClient). Both re-render the SAME underlying moment
// in a rotating zone — this is NOT a live ticking clock.
//
// THIRD NAMED MOTION EXCEPTION. The dashboard's motion rule is "static, no
// animation" with three deliberate, named exceptions:
//   1. the cursor blink (HO 131/157),
//   2. the markets tape marquee (HO 149/168/178),
//   3. this timezone-stamp cycling (HO 183).
// Like the other two it MUST respect prefers-reduced-motion: reduced-motion
// users get a STATIC single zone (MT, the user's local zone) with no cycling.
//
// Sync without a shared ticker: both stamps derive the active zone index from
// the wall clock (Date.now()), so two independent intervals always agree on
// which zone is showing — no shared context/subscriber plumbing, no drift
// between mount times. They show the same zone at the same instant for free.
import { useEffect, useState } from "react";

export type ZoneSpec = { tz: string; label: string };

// Order of the rotation: ET → CT → MT → PT → UTC. `tz` is a real IANA id so
// Intl.DateTimeFormat converts DST-correctly; `label` is the stable generic
// abbreviation (ET/CT/MT/PT/UTC) rather than DST-flapping EDT/EST — the
// seasonal letter-swap would read like a bug on a rotating display.
export const ZONES: readonly ZoneSpec[] = [
  { tz: "America/New_York", label: "ET" },
  { tz: "America/Chicago", label: "CT" },
  { tz: "America/Denver", label: "MT" },
  { tz: "America/Los_Angeles", label: "PT" },
  { tz: "UTC", label: "UTC" },
] as const;

// 4s per zone → a full 5-zone loop every 20s. Slow enough to read the label,
// fast enough that your own zone comes around without a long wait.
export const ZONE_MS = 4000;

// MT is the reduced-motion / pre-mount static zone (the user's local zone).
// MT_ZONE is the concrete fallback so indexing ZONES (possibly-undefined under
// noUncheckedIndexedAccess) always resolves to a real ZoneSpec.
const MT_ZONE: ZoneSpec = { tz: "America/Denver", label: "MT" };
const MT_INDEX = ZONES.findIndex((z) => z.label === "MT");

// One formatter per zone, built lazily and cached. Explicit `timeZone` makes
// the output independent of the host's local zone, so SSR and the client
// produce identical text for the same zone (no hydration mismatch).
const formatterCache = new Map<string, Intl.DateTimeFormat>();
function formatterFor(tz: string): Intl.DateTimeFormat {
  let f = formatterCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });
    formatterCache.set(tz, f);
  }
  return f;
}

// Re-render a fixed ISO instant in the given zone → "4:23 PM ET". Pure; safe
// on server or client. Returns "—" for null/unparseable input, matching the
// prior formatLastUpdated / formatHHMM fallbacks.
export function formatInZone(
  iso: string | null | undefined,
  zone: ZoneSpec,
): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return `${formatterFor(zone.tz).format(d)} ${zone.label}`;
}

// Clock-derived active index: which 4s slot of the rotation we're in right
// now. Floor-of-now / ZONE_MS modulo the zone count — deterministic from the
// shared wall clock, which is what keeps the two stamps in lockstep.
function zoneIndexNow(): number {
  return Math.floor(Date.now() / ZONE_MS) % ZONES.length;
}

// Returns the zone to display right now, cycling on a timer. Starts on MT for
// both SSR and the first client paint (no hydration mismatch — MT matches the
// old static render), then jumps to the live clock-derived zone on mount and
// rotates from there. Reduced-motion pins it to MT and never starts the timer.
export function useZoneCycle(): ZoneSpec {
  const [index, setIndex] = useState(MT_INDEX);
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    const onChange = () => setReduced(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    if (reduced) {
      setIndex(MT_INDEX);
      return;
    }
    // Snap to the live zone immediately so we don't sit on MT for up to 4s
    // after mount, then poll once a second and only re-render on a slot change
    // (the functional update bails out when the index is unchanged).
    setIndex(zoneIndexNow());
    const id = window.setInterval(() => {
      const next = zoneIndexNow();
      setIndex((prev) => (prev === next ? prev : next));
    }, 1000);
    return () => window.clearInterval(id);
  }, [reduced]);

  return ZONES[reduced ? MT_INDEX : index] ?? MT_ZONE;
}
