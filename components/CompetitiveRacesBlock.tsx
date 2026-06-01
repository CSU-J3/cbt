import { CompetitiveRacesStrip } from "@/components/CompetitiveRacesStrip";
import { type CompetitiveRace, getMostCompetitiveRaces } from "@/lib/queries";

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
//
// HO 166: this stays a server component (data fetch + partition); the cards
// and their expand drawers are owned by the CompetitiveRacesStrip client
// island (Path B — mirrors TopStalls/TopStallsList).
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

  return <CompetitiveRacesStrip races={races} cycle={cycle} />;
}
