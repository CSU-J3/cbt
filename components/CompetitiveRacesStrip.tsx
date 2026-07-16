import Link from "next/link";
import { RaceCard } from "@/components/RaceCard";
import { RaceHubBody } from "@/components/RaceHubBody";
import { RatingChip } from "@/components/RatingChip";
import type {
  CompetitiveRace,
  Member,
  PacIeRow,
  PartyKey,
  PrimaryWithCandidates,
  Race,
  RaceCandidate,
  RaceIndexRow,
  RaceNewsItem,
} from "@/lib/queries";
import {
  activeChallengers,
  ambiguousSurnames,
  deriveMatchup,
  partyAdjective,
} from "@/lib/race-matchup";

// HO 178 — the dashboard competitive-races surface, reflowed into a 2×2 grid in
// the 44% right column with a TICKER-STYLE HOVER POPOVER (like the markets tape)
// instead of HO 166/170's click-to-expand confined drawer. The card is now a
// plain link → the race detail page; hovering reveals an absolute, opaque
// popover with the fuller hub detail (RaceHubBody preview). All hub data is
// pre-fetched server-side by CompetitiveRacesBlock and passed in, so this is a
// pure server render — no client island, no fetch, no single-open state
// (useSingleOpenPanel / RaceDrawer / the /api/race/[id]/hub client fetch are
// retired for this surface).

export type RaceHubData = {
  race: Race;
  incumbent: Member | null;
  candidates: RaceCandidate[];
  runoffs: PrimaryWithCandidates[];
  // HO 432: news around the seat's incumbent (getRaceNews, capped at 3 in the
  // dashboard prefetch). Powers both the v2 NEW badge (news[0].observedAt) and
  // the default-variant popover's IN THE PRESS block. `[]` for an open seat.
  news: RaceNewsItem[];
};

// Human-readable label from a deterministic race id (lib/race-id.ts):
//   S-OH-2026 → "OH SENATE" · CA-22-2026 → "CA-22 HOUSE" · G-OH-2026 → "OH GOVERNOR"
function formatRaceLabel(raceId: string): string {
  if (raceId.startsWith("S-")) {
    const state = raceId.split("-")[1];
    return state ? `${state} SENATE` : raceId;
  }
  if (raceId.startsWith("G-")) {
    const state = raceId.split("-")[1];
    return state ? `${state} GOVERNOR` : raceId;
  }
  const m = raceId.match(/^([A-Z]{2})-(\d{2})-\d{4}$/);
  if (m) return `${m[1]}-${m[2]} HOUSE`;
  return raceId;
}

function partyColor(party: PartyKey | null): string {
  if (party === "R") return "var(--party-republican)";
  if (party === "D") return "var(--party-democrat)";
  if (party === "I") return "var(--party-independent)";
  return "var(--text-dim)";
}

// HO 233: the outer panel chrome + header moved to RacesPanelTabs (the tab strip
// now owns the panel). This renders ONLY the 2×2 grid — cards, popovers, and the
// HO 230 confinement are byte-identical, just hosted by the tab body now.
export function CompetitiveRacesStrip({
  races,
  hubs,
  // HO 260: v2 renders the rich race cards (the mock's `.race-card`) from the
  // getRacesIndex rows aligned to `races`. `/` keeps the default variant — the
  // 2×2 hover-popover cards below — untouched.
  variant = "default",
  rich,
  // HO 272: { raceId → latest rating-move date } for the featured seats; only
  // races that have moved appear. Threaded into each v2 RaceCard for its MOVED
  // indicator. v2-only; `/` never passes it.
  moves,
  // HO 393: { raceId → UDP IE direction rows } for the v2 card's PAC SPENDING
  // glance line. v2-only.
  pacByRace,
}: {
  races: CompetitiveRace[];
  hubs: (RaceHubData | null)[];
  variant?: "default" | "v2";
  rich?: (RaceIndexRow | null)[];
  moves?: Record<string, string>;
  pacByRace?: Record<string, PacIeRow[]>;
}) {
  if (variant === "v2") {
    // HO 305: page-level passes for the matchup block. (1) Ambiguous surnames —
    // a surname shared by ≥2 distinct people across the four cards (Susan Collins
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
                lastMoveAt={moves?.[race.raceId]}
                // HO 432: freshest incumbent news date falls out of the prefetched
                // hub — no recency query, mirroring how lastMoveAt rides `moves`.
                lastNewsAt={hubs[i]?.news?.[0]?.observedAt}
                pac={pacByRace?.[race.raceId]}
              />
            ) : null;
          })}
        </div>
        {presumptive.length > 0 ? (
          <p className="race-grid-foot">
            † presumptive —{" "}
            {presumptive.map(partyAdjective).join(" and ")} primar
            {presumptive.length > 1 ? "ies" : "y"} unresolved
          </p>
        ) : null}
      </>
    );
  }
  return (
    <div className="competitive-races-grid">
      {races.map((race, i) => {
          const hub = hubs[i] ?? null;
          // HO 230 (item 4): position keys for the popover flip — right-column
          // cards open the popover leftward, bottom-row cards open it upward, so
          // it stays confined inside the panel (2×2 grid, row-major order).
          return (
            <div
              key={race.raceId}
              className="competitive-race-cell"
              data-col={i % 2 === 0 ? "left" : "right"}
              data-row={i < 2 ? "top" : "bottom"}
            >
              <Link
                href={`/race/${race.raceId}`}
                className="competitive-race-card"
                style={{ color: "var(--text-primary)" }}
              >
                <span className="race-card-seat">
                  {formatRaceLabel(race.raceId)}
                </span>
                <span className="race-card-incumbent">
                  {race.incumbentName ? (
                    <>
                      {race.incumbentParty ? (
                        <span
                          aria-hidden
                          style={{ color: partyColor(race.incumbentParty) }}
                        >
                          ●{" "}
                        </span>
                      ) : null}
                      {race.incumbentName}
                    </>
                  ) : (
                    <span style={{ color: "var(--text-dim)" }}>OPEN SEAT</span>
                  )}
                </span>
                {/* Topline rating — first (freshest) source only on the card;
                    the popover shows the full multi-source set. */}
                <span className="race-card-ratings">
                  {race.ratings[0] ? (
                    <RatingChip rating={race.ratings[0]} size="sm" />
                  ) : null}
                </span>
              </Link>

              {/* HO 178: hover popover — absolute, opaque, no reflow (CSS :hover
                  on the cell). Renders RaceHubBody preview from the pre-fetched
                  hub. Omitted when the hub didn't resolve. */}
              {hub ? (
                <div className="competitive-race-popover" role="tooltip">
                  <RaceHubBody
                    preview
                    race={hub.race}
                    candidates={hub.candidates}
                    incumbent={hub.incumbent}
                    ratings={race.ratings}
                    runoffs={hub.runoffs}
                    // HO 432: light the preview IN THE PRESS block (capped ≤3).
                    news={hub.news}
                  />
                </div>
              ) : null}
            </div>
          );
        })}
    </div>
  );
}
