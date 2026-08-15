import { Battlefield } from "@/components/Battlefield";
import { CompetitiveRacesStrip } from "@/components/CompetitiveRacesStrip";
import type { RaceHubData } from "@/components/CompetitiveRacesStrip";
import { RaceCrossHighlight } from "@/components/RaceCrossHighlight";
import { NextPrimariesLine } from "@/components/NextPrimariesLine";
import {
  type CompetitiveRace,
  getDashboardPrimaries,
  getMostCompetitiveRaces,
  getPacIeSpending,
  getRace,
  getRaceCandidates,
  getRaceNews,
  getRacesIndex,
  getRecentRaceMoves,
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
// HO 178: stays a server component, and fetches each featured seat's hub payload
// HERE so the cards render from props — no client fetch, no loading flash.
// HO 658: the hub payload is down to what the cards actually read (the race row,
// the roster, the news head) — the popover that consumed the rest is deleted.
const POOL = 30;
const PER_CHAMBER = 3;

export async function CompetitiveRacesBlock({
  cycle = 2026,
  // HO 254: the D↔R battlefield axis at the top of the panel. Off by default so
  // the extra getBattlefieldSeats query never runs for a caller that doesn't
  // show it; `/` opts in.
  showBattlefield = false,
}: {
  cycle?: number;
  showBattlefield?: boolean;
}) {
  const pool = await getMostCompetitiveRaces(cycle, POOL);
  const senate = pool.filter(isSenate).slice(0, PER_CHAMBER);
  const house = pool.filter((r) => !isSenate(r)).slice(0, PER_CHAMBER);
  const races = [...senate, ...house]; // Senate-led order
  if (races.length === 0) return null;

  // HO 260: for the rich cards, pull the full rated-seat index (cached, tag
  // `races`) and align each of the 6 cards to its rich row (incumbent join +
  // cash + margin + 3 ratings + Kalshi + Polymarket). The competitive seats
  // are a subset of the 137 rated, so every lookup resolves.
  const richRows = await (async () => {
    const index = await getRacesIndex(cycle);
    const byId = new Map(index.map((r) => [r.raceId, r]));
    return races.map((r) => byId.get(r.raceId) ?? null);
  })();

  // HO 272: latest rating-move date per featured seat, for the cards' MOVED
  // indicators (and, summed, the RACES-tab MOVES badge).
  const moves = await getRecentRaceMoves(races.map((r) => r.raceId));

  // HO 393: UDP IE direction rows per race, for the rich card's non-linked
  // PAC SPENDING glance line (the clickable version lives on the /race hub +
  // /electoral expands).
  const pacByRace = await getPacIeSpending(cycle);

  // Fetch what each card reads off its seat: the race row, the candidate roster
  // (HO 274 party-lean resolution), and the news head (the NEW badge). All
  // queries are cached (tag `races`), so the dashboard's `races` revalidation
  // flushes these too. A race id that doesn't resolve yields a null hub — the
  // card falls back to its CompetitiveRace data.
  //
  // HO 658: the per-seat getMember + getRunoffsForRace prefetches are GONE with
  // the popover — they fed RaceHubBody's preview mode and nothing else, so this
  // loop was doing 12 reads per dashboard render (6 seats × 2) for a surface no
  // route rendered. It had already stopped mirroring /api/race/[id]/hub, which
  // was a zero-caller orphan in its own right and was DELETED at HO 665; the
  // full-hub shape lives on /race/[id], which fetches its own.
  const [hubs, primariesData] = await Promise.all([
    Promise.all(
      races.map(async (r) => {
        const race = await getRace(r.raceId);
        if (!race) return null;
        // HO 432: fetch the seat's incumbent news alongside the roster. N=3 (not
        // the hub page's 8) keeps the RSC props lean. This is a distinct
        // unstable_cache entry from the /race hub's getRaceNews(inc, 8), but both
        // ride the `race-news` tag so the news cron flushes them together. Open
        // seat → no incumbent join key → [].
        const [candidates, news] = await Promise.all([
          getRaceCandidates(race.id),
          race.incumbent_bioguide_id
            ? getRaceNews(race.incumbent_bioguide_id, 3)
            : Promise.resolve([]),
        ]);
        return { race, candidates, news } as RaceHubData;
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
      rich={richRows}
      moves={moves}
      pacByRace={pacByRace}
    />
  );

  // HO 260: the battlefield + cards are wrapped in RaceCrossHighlight so a card
  // hover lights its battlefield marker and vice versa (matched on the shared
  // `data-seat` = raceId).
  // HO 657 — the panel MERGED: no sub-tabs, one body. The shell is server-
  // rendered now (RacesPanelTabs was a client island only because it held the
  // toggle, and the toggle is gone), but it carries `dashboard-pane
  // home-races-pane` on the SAME <section> tag it always did.
  // `.dv2-racesbox .home-races-pane` is live styling on this route (border/bg
  // stripped so the pane blends into the box body).
  //
  // HO 658: the HO 230 popover containment (position:relative + overflow:hidden
  // on .home-races-pane, and the same on .dv2-racesbox-panels) is DELETED with
  // the popover it confined. Measured before removal, both with this pane active
  // and with HEARINGS active: nothing on either pane resolves its containing
  // block to those boxes, and dropping the declarations moved 0 nodes (the same
  // perturbation moved every visible node when aimed at padding). Whoever
  // rebuilds a popover rebuilds its box.
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
