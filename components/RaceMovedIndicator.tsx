"use client";

// HO 272 — the per-card MOVED indicator on a v2 COMPETITIVE race card. Registers
// itself with the context so the RACES-tab MOVES badge count is the sum of these.
//
// HO 684 — TWO CHANGES, and they are independent of each other.
//
// (1) THE PREDICATE SPLIT. Registration and rendering used to share one boolean
// off one timestamp, so `openTab("races")` restamped it synchronously in the
// click handler and every chip evaluated false, unmounted and unregistered
// before the panel was ever painted: the badge said MOVES 3 and the panel opened
// with zero markers on it. Registration still keys on `lastViewMs` (badges clear
// on open, unchanged); rendering keys on `sinceMs`, frozen at the pre-restamp
// value, so the chip is visible for the whole visit.
//
// (2) THE CHIP SAYS WHAT MOVED. It used to render `row.consensusRating` — the
// seat's CURRENT CONSENSUS, which is not the move. When one source moved and the
// consensus did not, the chip echoed an unchanged value and called it a move.
// It now renders the actual move off `getRecentRaceMoves`: `MOVED · SABATO Toss
// Up → Tilt R`. The `lean` prop is gone with the value it carried.
//
// Renders nothing (and registers nothing) with no move, before hydration (both
// stamps null), or with no provider at all.
import { useContext, useEffect } from "react";
import { RacesUpdatesContext } from "@/components/RacesUpdatesContext";
import type { RaceMove } from "@/lib/queries";

// rating_history stores the source key in snake_case (`cook` / `sabato` /
// `inside_elections` — read off the table at HO 684, NOT the display casing the
// handoff assumed). The card's own rater pills already spell the short forms at
// RaceCard.tsx, and lib/enums.ts + RatingChip.tsx each carry a longer variant, so
// this is a fourth site for one mapping. Kept local rather than extracted because
// this HO is the badge referent, not a label-map refactor; the duplication is
// FILED in docs/backlog.md instead of flagged only in a comment.
const SOURCE_SHORT: Record<string, string> = {
  cook: "COOK",
  sabato: "SABATO",
  inside_elections: "IE",
};

export function RaceMovedIndicator({
  raceId,
  move,
}: {
  raceId: string;
  move: RaceMove | null | undefined;
}) {
  const { lastViewMs, sinceMs, registerMoved, unregisterMoved } =
    useContext(RacesUpdatesContext);

  const moveMs = move ? Date.parse(`${move.date}T00:00:00Z`) : NaN;
  const fresh = !Number.isNaN(moveMs);

  // ACKNOWLEDGE — drives the tab badge. Unchanged from HO 272.
  const registered = fresh && lastViewMs != null && moveMs > lastViewMs;
  // DISPLAY — drives this chip. The whole HO 684 fix is that these are two
  // expressions against two stamps rather than one against one.
  const shown = fresh && sinceMs != null && moveMs > sinceMs;

  useEffect(() => {
    if (!registered) return;
    registerMoved(raceId);
    return () => unregisterMoved(raceId);
  }, [registered, raceId, registerMoved, unregisterMoved]);

  if (!shown || !move) return null;

  const source = SOURCE_SHORT[move.source] ?? move.source.toUpperCase();
  // `from` is the baseline rating for a pair's first real move, so it should
  // never be null — measured 0 of 64 races at HO 684. THIS BRANCH THEREFORE
  // SHIPS UNEXERCISED: it is unproven, not protection. If it ever renders, the
  // baseline-exclusion assumption in getRecentRaceMoves has been violated.
  const body = move.from
    ? `${source} ${move.from} → ${move.to}`
    : `${source} → ${move.to}`;

  return (
    <span className="rc-moved">
      <span className="rc-chip-label">MOVED</span>
      <span className="rc-chip-sep" aria-hidden="true">
        ·
      </span>
      <span className="rc-chip-body">{body}</span>
    </span>
  );
}
