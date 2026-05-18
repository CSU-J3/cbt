import Link from "next/link";
import { RatingChip } from "./RatingChip";
import {
  type CompetitiveRace,
  type PartyKey,
  getMostCompetitiveRaces,
} from "@/lib/queries";

// Human-readable label from a deterministic race id (lib/race-id.ts):
//   S-OH-2026 → "OH SENATE"
//   CA-22-2026 → "CA-22 HOUSE"
//   G-OH-2026 → "OH GOVERNOR"  (future)
function formatRaceLabel(raceId: string): string {
  if (raceId.startsWith("S-")) {
    const state = raceId.split("-")[1];
    return state ? `${state} SENATE` : raceId;
  }
  if (raceId.startsWith("G-")) {
    const state = raceId.split("-")[1];
    return state ? `${state} GOVERNOR` : raceId;
  }
  // House: <STATE>-<DD>-<YYYY>
  const m = raceId.match(/^([A-Z]{2})-(\d{2})-\d{4}$/);
  if (m) return `${m[1]}-${m[2]} HOUSE`;
  return raceId;
}

function chamberChip(race: CompetitiveRace): string {
  if (race.chamber === "senate") return "SEN";
  if (race.chamber === "house") return "HSE";
  // Fall back on the id prefix when the race row isn't joined yet.
  if (race.raceId.startsWith("S-")) return "SEN";
  if (race.raceId.startsWith("G-")) return "GOV";
  return "";
}

function partyColor(party: PartyKey | null): string {
  if (party === "R") return "var(--party-republican)";
  if (party === "D") return "var(--party-democrat)";
  if (party === "I") return "var(--party-independent)";
  return "var(--text-dim)";
}

export async function CompetitiveRacesBlock({
  cycle = 2026,
  limit = 8,
}: {
  cycle?: number;
  limit?: number;
}) {
  const races = await getMostCompetitiveRaces(cycle, limit);
  if (races.length === 0) return null;

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

      <div>
        {races.map((race) => {
          const label = formatRaceLabel(race.raceId);
          const chip = chamberChip(race);
          return (
            <Link
              key={race.raceId}
              href={`/race/${race.raceId}`}
              className="competitive-race-row"
              style={{ color: "var(--text-primary)" }}
            >
              <span className="race-label">{label}</span>
              <span
                className="min-w-0 truncate"
                style={{ color: "var(--text-secondary)" }}
              >
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
                ) : null}
              </span>
              <span className="chamber-chip">{chip}</span>
              <span className="flex flex-wrap items-center gap-2">
                {race.ratings.map((r, i) => (
                  <span
                    key={r.id}
                    className="inline-flex items-center gap-2"
                  >
                    {i > 0 ? (
                      <span aria-hidden style={{ color: "var(--text-dim)" }}>
                        ·
                      </span>
                    ) : null}
                    <RatingChip rating={r} size="sm" />
                  </span>
                ))}
              </span>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
