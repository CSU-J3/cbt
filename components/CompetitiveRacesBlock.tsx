import { Battlefield } from "@/components/Battlefield";
import { CompetitiveRacesStrip } from "@/components/CompetitiveRacesStrip";
import type { RaceHubData } from "@/components/CompetitiveRacesStrip";
import { RaceCrossHighlight } from "@/components/RaceCrossHighlight";
import { NextPrimariesLine } from "@/components/NextPrimariesLine";
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

// HO 163: dashboard races strip. A Senate-led chamber mix — the top N Senate then
// the top N House by competitiveness — rather than pure competitive-first, which
// would surface only House toss-ups and underweight the Senate-control narrative
// a glance most wants. getMostCompetitiveRaces has no chamber arg, so pull a
// competitiveness-ordered pool and partition here; the top Senate seats sit
// ~rank 20 behind the House toss-ups, so POOL clears that comfortably.
//
// HO 642: 2+2 -> 3+3, i.e. 4 cards -> 6. The cards land in `.race-grid`, which is
// `repeat(auto-fit, minmax(min(400px,100%), 1fr))` — so the column count is
// whatever the container buys. Measured on the shipped dashboard at three widths:
// .dash-left 756px -> 1 column (1440), 1020px -> 2 (1920), 1372px -> 3 (2560).
// FOUR cards divide by 1 and 2 but not 3, so at 2560 they wrap 3+1 and the fourth
// sits alone with two thirds of a row empty — the hole this HO was pointed at.
// SIX divides by 1, 2 AND 3, so it fills both rows at every column count this
// panel actually resolves to. The fix is the CARD COUNT, not the grid: widening
// to a flat 2×2 would trade the hole for four ~680px cards, which is C8's failure
// mode (wide screens buy columns, not wider rows). Six cards keep their designed
// ~440px and the panel carries more seats.
//
// HO 178: stays a server component, now a 2×2 grid with a hover popover instead
// of HO 166's click-drawer. The hover detail must be instant, so this fetches
// each race's hub payload (the same shape /api/race/[id]/hub returned) HERE and
// passes it as props — no client fetch, no loading flash. The CompetitiveRaces-
// Strip is now a pure server render with CSS-hover popovers.
const POOL = 30;
const PER_CHAMBER = 3;

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
  nowMs,
}: {
  cycle?: number;
  showBattlefield?: boolean;
  variant?: "default" | "v2";
  // HO 490: page-computed clock for the race popover's news relative ages (#418).
  nowMs: number;
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
    // The 6-month primaries rollup (HO 233), re-pointed at the NEXT PRIMARIES
    // line by HO 657 — the sub-tab it was built for is gone. The QUERY is
    // deliberately unchanged: the line consumes the same `cards`/`strip` payload
    // the retired 2×2 grid did, so no SQL moved for a display merge.
    getDashboardPrimaries(),
  ]);

  const strip = (
    <CompetitiveRacesStrip
      races={races}
      hubs={hubs}
      variant={variant}
      rich={richRows}
      moves={moves}
      pacByRace={pacByRace}
      nowMs={nowMs}
    />
  );

  // HO 260: v2 wraps the battlefield + rich cards in RaceCrossHighlight so a
  // card hover lights its battlefield marker and vice versa (matched on the
  // shared `data-seat` = raceId). `/` keeps its plain strip (no battlefield, no
  // cross-highlight).
  // HO 657 — the panel MERGED: no sub-tabs, one body. The shell is server-
  // rendered now (RacesPanelTabs was a client island only because it held the
  // toggle, and the toggle is gone), but it carries `dashboard-pane
  // home-races-pane` on the SAME <section> tag it always did. That is
  // load-bearing twice over: `.home-races-pane` is the HO 230 popover
  // containment box (position:relative + overflow:hidden), and
  // `.dv2-racesbox .home-races-pane` is live styling on this route (border/bg
  // stripped so the pane blends into the box body). Preserved by construction —
  // same tag, same classes — rather than re-derived.
  //
  // Containment note, measured at HO 657 rather than assumed: the hover popover
  // renders only on the `default` variant, and `/dashboard-classic` no longer
  // exists, so this box currently confines nothing on any live route. The
  // classes stay anyway — they cost nothing and the property survives if the
  // default variant is ever reachable again. See the backlog entry for the
  // unreachable-variant sweep.
  //
  // `.races-panel-body` is kept, but its rationale is thinner than it looks: the
  // 240px min-height was SUB-tab parity, and measured at HO 657 it is INERT
  // (body 879px). It does NOT steady the HEARINGS↔RACES flip either — that goes
  // 980px to 102px and always did. Kept as a harmless floor for a shrunken
  // competitive body, not as the thing holding the column still.
  return (
    <section className="dashboard-pane home-races-pane">
      <NextPrimariesLine data={primariesData} allHref="/electoral" />
      <div className="races-panel-body">
        {showBattlefield ? (
          <RaceCrossHighlight>
            <Battlefield
              cycle={cycle}
              featuredIds={races.map((r) => r.raceId)}
            />
            {strip}
          </RaceCrossHighlight>
        ) : (
          strip
        )}
      </div>
    </section>
  );
}
