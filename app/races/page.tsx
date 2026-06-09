// /races index. Map-first (HO 210): the geoAlbersUsa choropleth is the default
// view; the LIST view is one MAP/LIST toggle away. HO 222 redesigned the LIST
// from a 5-column rating matrix into a consensus-led, toss-ups-first row list
// (components/RaceListView) — severity rail, consensus chip, 3-segment rater
// spread, Kalshi-vs-rater divergence flag, 2024 House margin, incumbent cash.
// The MAP, the HO 219 hero band, and CartogramShell are untouched.
import { CartogramShell } from "@/components/CartogramShell";
import { GroupTabs } from "@/components/GroupTabs";
import { HeaderBar } from "@/components/HeaderBar";
import { RaceListView } from "@/components/RaceListView";
import { RacesHeroBand } from "@/components/RacesHeroBand";
import { buildRacesCartogram } from "@/lib/cartogram-data";
import { getUsMapGeometry } from "@/lib/us-map-geo";
import {
  getChamberControl,
  getRaceCandidatesForCycle,
  getRacesIndex,
} from "@/lib/queries";

export const dynamic = "force-dynamic";

export default async function RacesPage() {
  const [races, raceCandidates, chamberControl] = await Promise.all([
    getRacesIndex(2026),
    getRaceCandidatesForCycle(2026),
    getChamberControl(),
  ]);
  const senate = races.filter((r) => r.chamber === "senate");
  const house = races.filter((r) => r.chamber === "house");

  // HO 210: cartogram cells reuse the EXACT getRacesIndex rows, so a state's
  // tile count === the number of rows the LIST shows for that state.
  const cartogram = buildRacesCartogram(races, raceCandidates);
  const geometry = getUsMapGeometry();

  return (
    <div className="flex min-h-screen flex-col">
      <HeaderBar basePath="/races" />
      <main className="w-full flex-1 px-4 py-4">
        <GroupTabs group="races" active="races" />
        <div className="mb-3 flex flex-wrap items-baseline gap-3">
          <h1
            className="text-[14px] uppercase tracking-[0.5px]"
            style={{ color: "var(--accent-amber)" }}
          >
            2026 races
          </h1>
        </div>

        <p
          className="mb-4 text-[12px] leading-snug"
          style={{ color: "var(--text-muted)" }}
        >
          Seats rated by Cook, Sabato, or Inside Elections as anything other than
          Solid/Safe. Map shows how many competitive races each state holds; one
          MAP/LIST toggle away is the consensus-led, toss-ups-first list. Click a
          tile to pin its contests; click an incumbent for their member page.
        </p>

        <RacesHeroBand
          control={chamberControl}
          ratedCount={races.length}
          senateCount={senate.length}
          houseCount={house.length}
        />

        <CartogramShell
          variant="races"
          cells={cartogram.cells}
          summary={cartogram.summary}
          geometry={geometry}
          listSlot={<RaceListView senate={senate} house={house} />}
        />
      </main>
    </div>
  );
}
