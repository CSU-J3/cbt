"use client";

// HO 272 — the per-card MOVED indicator on a v2 COMPETITIVE race card. Renders
// `MOVED · <new lean>` (amber-bright) when the race's latest rating move is newer
// than the user's last RACES open, and registers itself with the context so the
// RACES-tab MOVES badge count is the sum of these. Renders nothing (and
// registers nothing) when the race hasn't moved since last view, before
// hydration (lastViewMs null), or with no provider (e.g. `/`).
import { useContext, useEffect } from "react";
import { RacesUpdatesContext } from "@/components/RacesUpdatesContext";

export function RaceMovedIndicator({
  raceId,
  lastMoveAt,
  lean,
}: {
  raceId: string;
  lastMoveAt: string | null | undefined;
  lean: string | null;
}) {
  const { lastViewMs, registerMoved, unregisterMoved } =
    useContext(RacesUpdatesContext);

  const moveMs = lastMoveAt ? Date.parse(`${lastMoveAt}T00:00:00Z`) : NaN;
  const moved =
    lastViewMs != null && !Number.isNaN(moveMs) && moveMs > lastViewMs;

  useEffect(() => {
    if (!moved) return;
    registerMoved(raceId);
    return () => unregisterMoved(raceId);
  }, [moved, raceId, registerMoved, unregisterMoved]);

  if (!moved) return null;
  return (
    <span className="rc-moved">
      MOVED{lean ? ` · ${lean}` : ""}
    </span>
  );
}
