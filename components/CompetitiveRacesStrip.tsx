import { RaceCard } from "@/components/RaceCard";
import type {
  CompetitiveRace,
  PacIeRow,
  PartyKey,
  Race,
  RaceCandidate,
  RaceIndexRow,
  RaceMove,
  RaceNewsItem,
} from "@/lib/queries";
import {
  activeChallengers,
  ambiguousSurnames,
  deriveMatchup,
  partyAdjective,
} from "@/lib/race-matchup";

// HO 260 — the dashboard competitive-races grid: the rich `.race-card` per
// featured seat, rendered from the getRacesIndex row aligned to `races`. Pure
// server render — all data is pre-fetched by CompetitiveRacesBlock and passed
// in, so there is no client island and no fetch here.
//
// HO 658: this component had a second, `default` variant — HO 178's 2×2
// hover-popover cards, which HO 166/170's click-drawer became. It went
// unreachable when /dashboard-classic was deleted (HO 608-610) and is now
// deleted with the popover, the position keys, and RaceHubBody's `preview` mode.

export type RaceHubData = {
  race: Race;
  candidates: RaceCandidate[];
  // HO 432: news around the seat's incumbent (getRaceNews, capped at 3 in the
  // dashboard prefetch). Powers the NEW badge off news[0].observedAt. `[]` for
  // an open seat.
  news: RaceNewsItem[];
};

// HO 233: the outer panel chrome + header live outside this component. They went
// to RacesPanelTabs then, and RacesPanelTabs was DELETED at HO 657 when the
// panel merged to one body — the chrome now sits on the server-rendered
// <section className="dashboard-pane home-races-pane"> in CompetitiveRacesBlock.
// This component renders ONLY the grid.
export function CompetitiveRacesStrip({
  races,
  hubs,
  rich,
  // HO 272, RESHAPED HO 684: { raceId → RaceMove } for the featured seats; only
  // races that have moved appear. Threaded into each RaceCard for its MOVED
  // indicator, which now renders the move itself (source, from → to) rather than
  // the seat's current consensus.
  moves,
  // HO 393: { raceId → UDP IE direction rows } for the card's PAC SPENDING
  // glance line.
  pacByRace,
}: {
  races: CompetitiveRace[];
  hubs: (RaceHubData | null)[];
  rich?: (RaceIndexRow | null)[];
  moves?: Record<string, RaceMove>;
  pacByRace?: Record<string, PacIeRow[]>;
}) {
  // HO 305: page-level passes for the matchup block. (1) Ambiguous surnames —
  // a surname shared by ≥2 distinct people across the cards (Susan Collins
  // ME + Mike Collins GA) renders with a first initial. (2) Presumptive parties
  // — a contested-leader card (ME → Platner†) drives one footnote below the
  // grid. Both need cross-card knowledge a single card can't see.
  const displayedNames: string[] = [];
  const presumptive: PartyKey[] = [];
  races.forEach((race, i) => {
    const row = rich?.[i];
    if (!row) return;
    const cands = hubs[i]?.candidates ?? [];
    if (row.incumbentName) displayedNames.push(row.incumbentName);
    for (const c of activeChallengers(cands, row.incumbentBioguideId))
      displayedNames.push(c.name);
    const p = deriveMatchup(row, cands).presumptiveParty;
    if (p && !presumptive.includes(p)) presumptive.push(p);
  });
  const ambiguous = ambiguousSurnames(displayedNames);

  return (
    <>
      <div className="race-grid">
        {races.map((race, i) => {
          const row = rich?.[i] ?? null;
          // Every competitive seat is in getRacesIndex (the 61-seat ABS<=1 set ⊂
          // the 137-seat rated set), so `row` resolves; the guard is belt-and-
          // suspenders for an unrated edge.
          return row ? (
            <RaceCard
              key={race.raceId}
              row={row}
              // HO 274: pass the seat's roster so candidate-named markets
              // resolve to party lean; HO 305 also derives the matchup shape +
              // names the market favorites from it.
              candidates={hubs[i]?.candidates ?? []}
              ambiguous={ambiguous}
              move={moves?.[race.raceId]}
              // HO 432: the freshest incumbent news falls out of the prefetched
              // hub — no recency query, mirroring how `move` rides `moves`.
              // HO 684 passes the news HEAD OBJECT rather than just its
              // timestamp; `title` was always on it, so the headline the chip now
              // renders costs no additional read.
              news={hubs[i]?.news?.[0]}
              pac={pacByRace?.[race.raceId]}
            />
          ) : null;
        })}
      </div>
      {presumptive.length > 0 ? (
        // HO 692 site 8 — the dagger footnote annotates a MARKET claim (the
        // `leader` shape's "presumptive"), so it goes with the markets. Absent on
        // prod since HO 691 gave decided seats the `general` shape, but the branch
        // is live and fires the moment a contested seat is featured.
        <p className="race-grid-foot odds-only">
          † presumptive —{" "}
          {presumptive.map(partyAdjective).join(" and ")} primar
          {presumptive.length > 1 ? "ies" : "y"} unresolved
        </p>
      ) : null}
    </>
  );
}
