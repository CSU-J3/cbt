import { CompetitiveRacesStrip } from "@/components/CompetitiveRacesStrip";
import type { RaceHubData } from "@/components/CompetitiveRacesStrip";
import {
  type CompetitiveRace,
  getMember,
  getMostCompetitiveRaces,
  getRace,
  getRaceCandidates,
  getRunoffsForRace,
} from "@/lib/queries";

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
// HO 178: stays a server component, now a 2×2 grid with a hover popover instead
// of HO 166's click-drawer. The hover detail must be instant, so this fetches
// each race's hub payload (the same shape /api/race/[id]/hub returned) HERE and
// passes it as props — no client fetch, no loading flash. The CompetitiveRaces-
// Strip is now a pure server render with CSS-hover popovers.
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

  // Fetch each race's hub (race row + incumbent + candidates + runoffs) so the
  // hover popover renders from props. Mirrors /api/race/[id]/hub exactly; all
  // queries are cached (tag `races`), so the dashboard's `races` revalidation
  // flushes these too. A race id that doesn't resolve yields a null hub (the
  // card still renders from its CompetitiveRace data; the popover is omitted).
  const hubs: (RaceHubData | null)[] = await Promise.all(
    races.map(async (r) => {
      const race = await getRace(r.raceId);
      if (!race) return null;
      const [candidates, incumbent, runoffs] = await Promise.all([
        getRaceCandidates(race.id),
        race.incumbent_bioguide_id
          ? getMember(race.incumbent_bioguide_id)
          : Promise.resolve(null),
        getRunoffsForRace(race.id),
      ]);
      return { race, incumbent, candidates, runoffs };
    }),
  );

  return <CompetitiveRacesStrip races={races} hubs={hubs} cycle={cycle} />;
}
