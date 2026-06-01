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

function partyColor(party: PartyKey | null): string {
  if (party === "R") return "var(--party-republican)";
  if (party === "D") return "var(--party-democrat)";
  if (party === "I") return "var(--party-independent)";
  return "var(--text-dim)";
}

// HO 163: a race is Senate if its joined chamber says so, or — for rating
// rows whose `races` row is missing (loose link, chamber null) — if the
// deterministic id carries the S- prefix.
function isSenate(race: CompetitiveRace): boolean {
  return (
    race.chamber === "senate" ||
    (race.chamber === null && race.raceId.startsWith("S-"))
  );
}

// HO 163: dashboard races strip. A Senate-led chamber mix — top 2 Senate then
// top 2 House by competitiveness — rather than pure competitive-first, which
// would surface 4 House toss-ups and underweight the Senate-control narrative
// a glance most wants. getMostCompetitiveRaces has no chamber arg, so pull a
// competitiveness-ordered pool and partition here; the top Senate seats sit
// ~rank 20 behind the House toss-ups, so POOL clears that comfortably.
const POOL = 30;
const PER_CHAMBER = 2;

export async function CompetitiveRacesBlock({
  cycle = 2026,
}: {
  cycle?: number;
}) {
  const pool = await getMostCompetitiveRaces(cycle, POOL);
  const senate = pool.filter(isSenate).slice(0, PER_CHAMBER);
  const house = pool.filter((r) => !isSenate(r)).slice(0, PER_CHAMBER);
  const races = [...senate, ...house]; // Senate-led order
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

      <div className="competitive-races-grid">
        {races.map((race) => (
          <Link
            key={race.raceId}
            href={`/race/${race.raceId}`}
            className="competitive-race-card"
            style={{ color: "var(--text-primary)" }}
          >
            <span className="race-card-seat">{formatRaceLabel(race.raceId)}</span>
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
          </Link>
        ))}
      </div>
    </section>
  );
}
