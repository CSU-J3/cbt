"use client";

// HO 432 — the per-card NEW(S) indicator on a v2 COMPETITIVE race card, the news
// sibling of RaceMovedIndicator. Registers itself with the context so the
// RACES-tab NEW badge count is the sum of these.
//
// HO 684 — TWO CHANGES, mirroring the MOVED sibling.
//
// (1) THE PREDICATE SPLIT. Registration keys on `lastViewMs` (badges clear on
// open, unchanged); rendering keys on `sinceMs`, frozen at the value lastViewMs
// held before the open restamped it. Before the split, one boolean drove both,
// so the click that cleared the badge also unmounted every chip it was counting
// — the panel opened with no markers on it.
//
// (2) THE CHIP CARRIES THE HEADLINE. `NEWS` alone said a thing existed without
// saying what it was; it now reads `NEWS · <headline>`. GLANCE TEXT, NOT A LINK
// — the whole card is a <Link> (the HO 393 constraint), so the article link
// stays on the /race/[id] hub. Publisher is omitted for space.
//
// Unlike a rating move (a date-only string the MOVED indicator pins to midnight
// UTC), observedAt is a full ISO timestamp, so it is Date.parse'd directly —
// matching RaceNewsRow's own parse.
import { useContext, useEffect } from "react";
import { RacesUpdatesContext } from "@/components/RacesUpdatesContext";

export type RaceNewsHead = {
  observedAt: string;
  title: string;
};

export function RaceNewIndicator({
  raceId,
  news,
}: {
  raceId: string;
  news: RaceNewsHead | null | undefined;
}) {
  const { lastViewMs, sinceMs, registerNews, unregisterNews } =
    useContext(RacesUpdatesContext);

  const newsMs = news ? Date.parse(news.observedAt) : NaN;
  const fresh = !Number.isNaN(newsMs);

  // ACKNOWLEDGE — drives the tab badge. Unchanged from HO 432.
  const registered = fresh && lastViewMs != null && newsMs > lastViewMs;
  // DISPLAY — drives this chip.
  const shown = fresh && sinceMs != null && newsMs > sinceMs;

  useEffect(() => {
    if (!registered) return;
    registerNews(raceId);
    return () => unregisterNews(raceId);
  }, [registered, raceId, registerNews, unregisterNews]);

  if (!shown || !news) return null;

  return (
    <span className="rc-new">
      <span className="rc-chip-label">NEWS</span>
      <span className="rc-chip-sep" aria-hidden="true">
        ·
      </span>
      {/* Clamped to 2 lines rather than single-line-ellipsised (ruled HO 684):
          at the tightest box the grid bottoms out at, the live-max 95-ch
          headline resolves fully in two lines and the ellipsis only fires past
          ~120 ch (corpus max 123). A one-line ellipsis would truncate the
          typical headline, not the exceptional one. */}
      <span className="rc-chip-body">{news.title}</span>
    </span>
  );
}
