"use client";

// HO 166 — client wrapper for the dashboard competitive-races strip. The
// server CompetitiveRacesBlock fetches + partitions the races; this island
// holds single-open state, renders the cards as click-to-toggle buttons, and
// lazy-loads the race hub (/api/race/[id]/hub) into a drawer on first open.
// Path B, mirroring TopStallsList — the data fetch stays server-side.
//
// HO 170 — the drawer is now confined to the clicked card's grid column: each
// card + its drawer live in a `.competitive-race-cell` grid item, the grid
// uses `align-items: start`, so the expanded column grows while neighbors stay
// put. The drawer renders RaceHubBody in `preview` mode (rating + candidates +
// full-race link; no incumbent photo card or verified footer).
import { useEffect, useState } from "react";
import { RaceHubBody } from "@/components/RaceHubBody";
import { RatingChip } from "@/components/RatingChip";
import { useSingleOpenPanel } from "@/components/useSingleOpenPanel";
import type {
  CompetitiveRace,
  Member,
  PartyKey,
  PrimaryWithCandidates,
  Race,
  RaceCandidate,
} from "@/lib/queries";

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

// Lazy-loads the hub on first open; mirrors BillExpandedPanel's fetch shape.
// Ratings come from the card (already loaded), the rest from the endpoint.
// Renders RaceHubBody in preview mode (HO 170).
function RaceDrawer({
  race,
  cached,
  onLoaded,
}: {
  race: CompetitiveRace;
  cached: RaceHubData | null;
  onLoaded: (data: RaceHubData) => void;
}) {
  const [data, setData] = useState<RaceHubData | null>(cached);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (data) return;
    let cancelled = false;
    fetch(`/api/race/${encodeURIComponent(race.raceId)}/hub`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<RaceHubData>;
      })
      .then((json) => {
        if (cancelled) return;
        setData(json);
        onLoaded(json);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [race.raceId, data, onLoaded]);

  if (error) {
    return (
      <div className="competitive-race-drawer">
        <p className="text-[13px]" style={{ color: "var(--text-dim)" }}>
          Could not load race ({error}).
        </p>
      </div>
    );
  }
  if (!data) {
    return (
      <div className="competitive-race-drawer">
        <p className="text-[13px]" style={{ color: "var(--text-dim)" }}>
          Loading race…
        </p>
      </div>
    );
  }

  return (
    <div className="competitive-race-drawer">
      <RaceHubBody
        preview
        race={data.race}
        candidates={data.candidates}
        incumbent={data.incumbent}
        ratings={race.ratings}
        runoffs={data.runoffs}
      />
      <div className="mt-4">
        <a href={`/race/${race.raceId}`} className="bill-expanded-action-chip">
          full race page →
        </a>
      </div>
    </div>
  );
}

export function CompetitiveRacesStrip({
  races,
  cycle,
}: {
  races: CompetitiveRace[];
  cycle: number;
}) {
  const { expandedId, toggle, panelCache, handleLoaded } =
    useSingleOpenPanel<RaceHubData>();

  return (
    <section className="dashboard-pane mt-3">
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
        {races.map((race) => {
          const isOpen = expandedId === race.raceId;
          return (
            <div key={race.raceId} className="competitive-race-cell">
              <div
                className={`competitive-race-card competitive-race-card--expandable${
                  isOpen ? " is-open" : ""
                }`}
                role="button"
                tabIndex={0}
                aria-expanded={isOpen}
                onClick={() => toggle(race.raceId)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    toggle(race.raceId);
                  }
                }}
                style={{ color: "var(--text-primary)" }}
              >
                <span className="race-card-seat-row">
                  <span className="race-card-seat">
                    {formatRaceLabel(race.raceId)}
                  </span>
                  <span
                    className={`row-chevron${isOpen ? " is-open" : ""}`}
                    aria-hidden
                  >
                    ▸
                  </span>
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
                <span className="race-card-ratings">
                  {race.ratings.map((r, i) => (
                    <span key={r.id} className="inline-flex items-center gap-2">
                      {i > 0 ? (
                        <span aria-hidden style={{ color: "var(--text-dim)" }}>
                          ·
                        </span>
                      ) : null}
                      <RatingChip rating={r} size="sm" />
                    </span>
                  ))}
                </span>
              </div>

              {isOpen ? (
                <RaceDrawer
                  race={race}
                  cached={panelCache.get(race.raceId) ?? null}
                  onLoaded={(data) => handleLoaded(race.raceId, data)}
                />
              ) : null}
            </div>
          );
        })}
      </div>
    </section>
  );
}
