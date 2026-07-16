"use client";

// HO 432 — the per-card NEW(S) indicator on a v2 COMPETITIVE race card, the
// news sibling of RaceMovedIndicator. Renders `NEWS` when the race's latest
// incumbent-linked observation (hubs[i].news[0].observedAt) is newer than the
// user's last RACES open, and registers itself with the context so the RACES-tab
// NEW badge count is the sum of these — exactly mirroring the MOVED path. Renders
// nothing (and registers nothing) when there's no fresh news, before hydration
// (lastViewMs null), or with no provider (e.g. `/dashboard-classic`).
//
// Unlike lastMoveAt (a date-only string the MOVED indicator pins to midnight UTC),
// observedAt is a full ISO timestamp, so it's Date.parse'd directly — matching
// RaceNewsRow's own parse.
import { useContext, useEffect } from "react";
import { RacesUpdatesContext } from "@/components/RacesUpdatesContext";

export function RaceNewIndicator({
  raceId,
  lastNewsAt,
}: {
  raceId: string;
  lastNewsAt: string | null | undefined;
}) {
  const { lastViewMs, registerNews, unregisterNews } =
    useContext(RacesUpdatesContext);

  const newsMs = lastNewsAt ? Date.parse(lastNewsAt) : NaN;
  const isNew =
    lastViewMs != null && !Number.isNaN(newsMs) && newsMs > lastViewMs;

  useEffect(() => {
    if (!isNew) return;
    registerNews(raceId);
    return () => unregisterNews(raceId);
  }, [isNew, raceId, registerNews, unregisterNews]);

  if (!isNew) return null;
  return <span className="rc-new">NEWS</span>;
}
