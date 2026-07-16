import { Battlefield } from "@/components/Battlefield";
import { CompetitiveRacesStrip } from "@/components/CompetitiveRacesStrip";
import type { RaceHubData } from "@/components/CompetitiveRacesStrip";
import { DashboardPrimaries } from "@/components/DashboardPrimaries";
import { RaceCrossHighlight } from "@/components/RaceCrossHighlight";
import { RacesPanelTabs } from "@/components/RacesPanelTabs";
import {
  type CompetitiveRace,
  getDashboardPrimaries,
  getMember,
  getMostCompetitiveRaces,
  getPacIeSpending,
  getRace,
  getRaceCandidates,
  getRaceNews,
  getRacesIndex,
  getRecentRaceMoves,
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
  // HO 254: Dashboard v2 opts the D↔R battlefield axis in at the top of the
  // COMPETITIVE tab. Default off so `/` (app/page.tsx) renders unchanged AND
  // the extra getBattlefieldSeats query never runs for it. The card grid is
  // untouched either way.
  showBattlefield = false,
  // HO 260: v2 renders the rich race cards (the mock's `.race-card`) instead of
  // the 2×2 hover-popover cards. Default keeps `/` on the popover cards.
  variant = "default",
}: {
  cycle?: number;
  showBattlefield?: boolean;
  variant?: "default" | "v2";
}) {
  const pool = await getMostCompetitiveRaces(cycle, POOL);
  const senate = pool.filter(isSenate).slice(0, PER_CHAMBER);
  const house = pool.filter((r) => !isSenate(r)).slice(0, PER_CHAMBER);
  const races = [...senate, ...house]; // Senate-led order
  if (races.length === 0) return null;

  // HO 260: for the v2 rich cards, pull the full rated-seat index (cached, tag
  // `races`) and align each of the 4 cards to its rich row (incumbent join +
  // cash + margin + 3 ratings + Kalshi + Polymarket). The 4 competitive seats
  // are a subset of the 137 rated, so every lookup resolves.
  const richRows =
    variant === "v2"
      ? await (async () => {
          const index = await getRacesIndex(cycle);
          const byId = new Map(index.map((r) => [r.raceId, r]));
          return races.map((r) => byId.get(r.raceId) ?? null);
        })()
      : undefined;

  // HO 272: latest rating-move date per featured seat, for the v2 cards' MOVED
  // indicators (and, summed, the RACES-tab MOVES badge). v2-only.
  const moves =
    variant === "v2"
      ? await getRecentRaceMoves(races.map((r) => r.raceId))
      : undefined;

  // HO 393: UDP IE direction rows per race, for the v2 rich card's non-linked
  // PAC SPENDING glance line (the clickable version lives on the /race hub +
  // /electoral expands). v2-only.
  const pacByRace = variant === "v2" ? await getPacIeSpending(cycle) : undefined;

  // Fetch each race's hub (race row + incumbent + candidates + runoffs) so the
  // hover popover renders from props. Mirrors /api/race/[id]/hub exactly; all
  // queries are cached (tag `races`), so the dashboard's `races` revalidation
  // flushes these too. A race id that doesn't resolve yields a null hub (the
  // card still renders from its CompetitiveRace data; the popover is omitted).
  const [hubs, primariesData] = await Promise.all([
    Promise.all(
      races.map(async (r) => {
        const race = await getRace(r.raceId);
        if (!race) return null;
        // HO 432: fetch the seat's incumbent news alongside the hub. N=3 (not the
        // hub page's 8): the dashboard only ever needs news[0] (the NEW badge) +
        // the ≤3 popover rows, so a 3-row payload keeps the RSC props lean rather
        // than serializing 5 rows the dashboard never shows. This is a distinct
        // unstable_cache entry from the /race hub's getRaceNews(inc, 8), but both
        // ride the `race-news` tag so the news cron flushes them together. Open
        // seat → no incumbent join key → [] (guarded like getMember).
        const [candidates, incumbent, runoffs, news] = await Promise.all([
          getRaceCandidates(race.id),
          race.incumbent_bioguide_id
            ? getMember(race.incumbent_bioguide_id)
            : Promise.resolve(null),
          getRunoffsForRace(race.id),
          race.incumbent_bioguide_id
            ? getRaceNews(race.incumbent_bioguide_id, 3)
            : Promise.resolve([]),
        ]);
        return { race, incumbent, candidates, runoffs, news } as RaceHubData;
      }),
    ),
    // HO 233: the PRIMARIES tab's 6-month rollup. Fetched here alongside the
    // competitive hubs so the tab island gets both views as server-rendered
    // props.
    getDashboardPrimaries(),
  ]);

  const primariesCount = primariesData.strip.reduce((s, p) => s + p.count, 0);

  const strip = (
    <CompetitiveRacesStrip
      races={races}
      hubs={hubs}
      variant={variant}
      rich={richRows}
      moves={moves}
      pacByRace={pacByRace}
    />
  );

  // HO 260: v2 wraps the battlefield + rich cards in RaceCrossHighlight so a
  // card hover lights its battlefield marker and vice versa (matched on the
  // shared `data-seat` = raceId). `/` keeps its plain strip (no battlefield, no
  // cross-highlight).
  return (
    <RacesPanelTabs
      competitiveContent={
        showBattlefield ? (
          <RaceCrossHighlight>
            <Battlefield
              cycle={cycle}
              featuredIds={races.map((r) => r.raceId)}
            />
            {strip}
          </RaceCrossHighlight>
        ) : (
          strip
        )
      }
      primariesContent={<DashboardPrimaries data={primariesData} />}
      competitiveCount={races.length}
      primariesCount={primariesCount}
    />
  );
}
