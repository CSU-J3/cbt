// /electoral — the consolidated Electoral surface (HO 333, moved from /races).
// One surface: the competitive US map on top, a primary-calendar timeline band
// below it, wired so the timeline drives an amber highlight on the map. The
// HO 219 hero band + the competitive map (CartogramShell, purple competitive
// fill, leader-lines, DISPLAY_STALE_STATES) are reused unchanged; the map keeps
// its HO 225 state-click district drill. The Races · Primaries sub-nav (HO 173)
// is retired — one surface, no GroupTabs. /races + /primaries 308-redirect here.
//
// HO 710: ?cycle=2028 switches to the seat outlook (a report since HO 718). The DEFAULT IS THE
// ABSENCE OF THE PARAM (HO 690) — bare /electoral is 2026. The 2028 branch deliberately
// mounts NO hero band, board, calendar or list view: nothing is rated or
// scheduled for that cycle yet, and an empty map is noise rather than honesty.
//
// HO 767 (mock-767 v18, ruled "as set"): the 2026 branch in the general window.
// The title row; the primary calendar, folded; the band (Battlefield, LEAD B)
// and the two Kalshi control cells; the controls; the rows, LIST by default
// with the map one toggle away and unchanged. TOP none: the intro paragraph and
// the SEATS IN PLAY cell are gone. Every read takes the cycle. Once election day
// has passed (lib/clock.ts) the rows read HO 758's results.
import { Battlefield } from "@/components/Battlefield";
import { FEATURED_POOL, featuredRaces } from "@/components/CompetitiveRacesBlock";
import { ElectoralBoard } from "@/components/ElectoralBoard";
import { HeaderBar } from "@/components/HeaderBar";
import { RaceListView } from "@/components/RaceListView";
import { RacesHeroBand } from "@/components/RacesHeroBand";
import { SeatOutlookList } from "@/components/SeatOutlookList";
import { SegmentedToggle } from "@/components/SegmentedToggle";
import { buildRacesCartogram } from "@/lib/cartogram-data";
import { clockNowMs } from "@/lib/clock";
import { buildElectoralRows, withoutCalledOdds } from "@/lib/electoral-rows";
import { daysToElection } from "@/lib/format";
import { withIncumbentTags } from "@/lib/incumbent-tag";
import { getUsMapGeometry } from "@/lib/us-map-geo";
import {
  ELECTORAL_CYCLES,
  getBallotMemberFacts,
  getBallotNews,
  getChamberControl,
  getChamberParticipationContext,
  getGeneralBallots,
  getMostCompetitiveRaces,
  getPacIeSpending,
  getPalestinePools,
  getPrimaryCalendar,
  getRaceCandidatesForCycle,
  getRaceResults,
  getRecentRaceMoves,
  getCycleMarketCoverage,
  getIncumbentQualifiers,
  getRacesIndex,
  getSeatNews,
  getSeatOutlook,
  sanitizeCycle,
} from "@/lib/queries";

export const dynamic = "force-dynamic";

// The toggle segments read ELECTORAL_CYCLES, the same constant sanitizeCycle
// validates against, so the toggle and the sanitizer cannot drift apart. A
// third cycle costs more than that constant: the page branches on
// `cycle === 2028` below. Since HO 718 the report derives its class, election
// day, Congress and appointee specials from the cycle and the rows, so what the
// branch still hard-codes is that one comparison and the dateline's
// House-joins-when-the-next-Congress-begins clause, which assumes the cycle's
// House seats arrive with the Congress seated the January before it.
const CYCLE_SEGMENTS = ELECTORAL_CYCLES.map((c) => ({
  value: String(c),
  label: String(c),
}));

function CycleToggle({ cycle }: { cycle: number }) {
  return (
    <SegmentedToggle
      current={String(cycle)}
      segments={CYCLE_SEGMENTS}
      ariaLabel="Electoral cycle"
      buildHref={(value) =>
        value === "2026" ? "/electoral" : `/electoral?cycle=${value}`
      }
    />
  );
}

export default async function ElectoralPage({
  searchParams,
}: {
  searchParams: Promise<{ cycle?: string }>;
}) {
  const cycle = sanitizeCycle((await searchParams).cycle);

  if (cycle === 2028) return <SeatOutlookPage cycle={cycle} />;

  // HO 490: the page's one clock for the ages and the news and MOVED windows,
  // prop-drilled to the client rows, and since HO 768 to every client site that
  // asks whether a market has closed. HO 758: the day-after gate and the
  // calendar's today read lib/clock.ts, the one now a legs copy can move.
  const nowMs = Date.now();
  const clockMs = clockNowMs();
  const passed = daysToElection(cycle, clockMs) < 0;

  const [index, raceCandidates, chamberControl, calendar, pacByRace, incumbentTags, general, pools, participation, pool] =
    await Promise.all([
      getRacesIndex(cycle),
      getRaceCandidatesForCycle(cycle),
      getChamberControl(),
      getPrimaryCalendar(cycle),
      getPacIeSpending(cycle),
      getIncumbentQualifiers(cycle),
      getGeneralBallots(cycle),
      getPalestinePools(),
      getChamberParticipationContext(),
      getMostCompetitiveRaces(cycle, FEATURED_POOL),
    ]);
  // HO 759: each row carries its incumbent's tag, so the list, the map's hover,
  // the pinned card and the district card read the same one.
  const races = withIncumbentTags(index, incumbentTags);
  // The members on the ballots, for their news (R2); the facts read also takes
  // the seat holders off their ballots, whose grade and face print in the row.
  const onBallots = [...new Set(Object.values(general.races).flatMap((g) => g.memberIds))].sort();
  const [moves, members, news, results] = await Promise.all([
    getRecentRaceMoves(races.map((r) => r.raceId)),
    getBallotMemberFacts(general.memberIds),
    getBallotNews(onBallots),
    passed ? getRaceResults(cycle) : Promise.resolve(null),
  ]);
  const { rows, raceNews } = buildElectoralRows({ cycle, index: races, general, moves, pacByRace, news, results, nowMs, clockMs });

  // HO 210: cartogram cells reuse the EXACT getRacesIndex rows, so a state's
  // tile count === the number of rows the LIST shows for that state.
  // HO 393: pacByRace threads the UDP IE direction rows onto each contest.
  // HO 768: built once the rows exist, so a called seat's Kalshi market leaves
  // the MAP as it leaves the rows (R6).
  const cartogram = buildRacesCartogram(withoutCalledOdds(races, rows), raceCandidates, pacByRace);
  const geometry = getUsMapGeometry();
  const todayISO = new Date(clockMs).toISOString().slice(0, 10);

  return (
    <div className="flex min-h-screen flex-col">
      <HeaderBar basePath="/electoral" />
      <main className="w-full flex-1 px-4 py-4">
        <div className="mb-3 flex flex-wrap items-baseline gap-3">
          <h1
            className="text-[length:var(--fs-14)] uppercase tracking-[0.5px]"
            style={{ color: "var(--accent-amber)" }}
          >
            {cycle} electoral
          </h1>
          <CycleToggle cycle={cycle} />
        </div>

        <ElectoralBoard
          cycle={cycle}
          cells={cartogram.cells}
          summary={cartogram.summary}
          geometry={geometry}
          calendar={calendar}
          todayISO={todayISO}
          nowMs={nowMs}
          initialView="list"
          bandSlot={
            <>
              {/* The dashboard's band and its six featured dots, packed left
                  on this full-width page (C1). */}
              <div className="electoral-band">
                <Battlefield cycle={cycle} featuredIds={featuredRaces(pool).map((r) => r.raceId)} packed />
              </div>
              <RacesHeroBand control={chamberControl} />
            </>
          }
          listSlot={
            <RaceListView
              rows={rows}
              raceNews={raceNews}
              members={members}
              pools={pools}
              medians={{
                house: participation.house.medianMissedPct,
                senate: participation.senate.medianMissedPct,
              }}
              nowMs={nowMs}
              passed={passed}
            />
          }
        />
      </main>
    </div>
  );
}

// The 2028 branch. Title row, then the report (dateline, NEWS, ODDS, COUNT,
// roster). No band, board, calendar or list view — see the note at the top of
// the file.
async function SeatOutlookPage({ cycle }: { cycle: number }) {
  const rows = await getSeatOutlook(cycle);
  const [news, coverage] = await Promise.all([
    getSeatNews(rows.map((r) => r.bioguideId)),
    getCycleMarketCoverage(cycle),
  ]);

  return (
    <div className="flex min-h-screen flex-col">
      <HeaderBar basePath="/electoral" />
      <main className="w-full flex-1 px-4 py-4">
        <div className="mb-3 flex flex-wrap items-baseline gap-3">
          <h1
            className="text-[length:var(--fs-14)] uppercase tracking-[0.5px]"
            style={{ color: "var(--accent-amber)" }}
          >
            {cycle} electoral
          </h1>
          <CycleToggle cycle={cycle} />
        </div>

        <SeatOutlookList
          rows={rows}
          news={news}
          coverage={coverage}
          cycle={cycle}
        />
      </main>
    </div>
  );
}
