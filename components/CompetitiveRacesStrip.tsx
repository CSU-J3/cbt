import Link from "next/link";
import { RaceHubBody } from "@/components/RaceHubBody";
import { RatingChip } from "@/components/RatingChip";
import type {
  CompetitiveRace,
  Member,
  PartyKey,
  PrimaryWithCandidates,
  Race,
  RaceCandidate,
} from "@/lib/queries";

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

export function CompetitiveRacesStrip({
  races,
  hubs,
  cycle,
}: {
  races: CompetitiveRace[];
  hubs: (RaceHubData | null)[];
  cycle: number;
}) {
  return (
    <section className="dashboard-pane home-races-pane">
      <div className="mb-2 flex items-baseline justify-between">
        <p
          className="text-[12px] uppercase tracking-[0.5px]"
          style={{ color: "var(--accent-amber)" }}
        >
          Competitive races · {cycle}
        </p>
        <p
          className="text-[11px] uppercase tracking-[0.5px]"
          style={{ color: "var(--text-dim)" }}
        >
          {races.length} shown
        </p>
      </div>

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
                  />
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </section>
  );
}
