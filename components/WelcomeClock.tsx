"use client";

import { useEffect, useState } from "react";

// HO 670 — the `/welcome` top-rail clock. The ONE client boundary the board
// rebuild adds; everything else on the page (the tapes' marquees, the panels'
// scroll + crossfade, the IN BETA pulse, the cursor blink) is CSS.
//
// THE ZONE IS PINNED TO MT AND DOES NOT CYCLE, and the distinction from the rest
// of the app is the whole point. `useZoneCycle` (HO 183) rotates ET→CT→MT→PT→UTC
// every 4s, which works for the markets tape's AS OF and the masthead LAST SYNC
// because the moment those stamp is FIXED — only the projection rotates, so the
// display reads as a world clock. Here the moment is `now`, ticking once a
// second, and rotating the zone under it would jump the hour every four seconds
// while the seconds ran continuously: unreadable, and indistinguishable from a
// bug to anyone who watches it. Ruled on review of HO 670; the hook is
// deliberately NOT imported here so a future edit has to make this choice again
// rather than inherit it.
//
// MT matches what the page's server-rendered AS OF / LAST SYNC stamps use, so
// every time on the page is in one zone.
//
// HYDRATION: the digits render NOTHING on the server and mount on the client
// (`now === null` until the first effect). A ticking clock cannot be
// server-rendered without a guaranteed SSR/hydrate mismatch — the HO 489/490
// class — and prop-drilling a server `now` would still be wrong one second later.
const ZONE_TZ = "America/Denver";
const ZONE_LABEL = "MT";

const DAYS = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
const MONTHS = [
  "JAN",
  "FEB",
  "MAR",
  "APR",
  "MAY",
  "JUN",
  "JUL",
  "AUG",
  "SEP",
  "OCT",
  "NOV",
  "DEC",
];

// Built once: Intl.DateTimeFormat construction is the expensive part and this
// runs every second. The explicit `timeZone` keeps the output independent of the
// host's local zone (the same reason zone-cycle.ts caches its own formatters).
let formatter: Intl.DateTimeFormat | undefined;
function formatterFor(): Intl.DateTimeFormat {
  formatter ??= new Intl.DateTimeFormat("en-US", {
    timeZone: ZONE_TZ,
    weekday: "short",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });
  return formatter;
}

function stamp(now: Date): { date: string; time: string } {
  const parts = formatterFor().formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  // Re-derive the weekday/month tokens from Intl's parts rather than
  // upper-casing its localized short names, so the rail reads MON/AUG in every
  // runtime regardless of how "Mon"/"Aug" are spelled by the ICU build.
  const wd = DAYS.indexOf(get("weekday").slice(0, 3).toUpperCase());
  const mo = MONTHS.indexOf(get("month").slice(0, 3).toUpperCase());
  const date =
    (wd >= 0 ? DAYS[wd] : get("weekday").toUpperCase()) +
    " " +
    get("day") +
    " " +
    (mo >= 0 ? MONTHS[mo] : get("month").toUpperCase()) +
    " " +
    get("year");
  const time = `${get("hour")}:${get("minute")}:${get("second")} ${get("dayPeriod")}`;
  return { date, time };
}

export function WelcomeClock({
  className,
  timeClassName,
  zoneClassName,
}: {
  className: string;
  timeClassName: string;
  zoneClassName: string;
}) {
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    setNow(new Date());
    const id = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(id);
  }, []);

  if (now === null) {
    // Reserve the rail slot so the top rule doesn't jump on mount.
    return <span className={className} suppressHydrationWarning />;
  }
  const { date, time } = stamp(now);
  return (
    <span className={className} suppressHydrationWarning>
      {date} ·<span className={timeClassName}> {time}</span>{" "}
      <span className={zoneClassName}>{ZONE_LABEL}</span>
    </span>
  );
}
