// /electoral — the consolidated Electoral surface (HO 333, moved from /races).
// One surface: the competitive US map on top, a primary-calendar timeline band
// below it, wired so the timeline drives an amber highlight on the map. The
// HO 219 hero band + the competitive map (CartogramShell, purple competitive
// fill, leader-lines, DISPLAY_STALE_STATES) are reused unchanged; the map keeps
// its HO 225 state-click district drill. The Races · Primaries sub-nav (HO 173)
// is retired — one surface, no GroupTabs. /races + /primaries 308-redirect here.
import { ElectoralBoard } from "@/components/ElectoralBoard";
import { HeaderBar } from "@/components/HeaderBar";
import { RaceListView } from "@/components/RaceListView";
import { RacesHeroBand } from "@/components/RacesHeroBand";
import { buildRacesCartogram } from "@/lib/cartogram-data";
import { getUsMapGeometry } from "@/lib/us-map-geo";
import {
  getChamberControl,
  getPrimaryCalendar,
  getRaceCandidatesForCycle,
  getRacesIndex,
} from "@/lib/queries";

export const dynamic = "force-dynamic";

export default async function ElectoralPage() {
  const [races, raceCandidates, chamberControl, calendar] = await Promise.all([
    getRacesIndex(2026),
    getRaceCandidatesForCycle(2026),
    getChamberControl(),
    getPrimaryCalendar(2026),
  ]);
  const senate = races.filter((r) => r.chamber === "senate");
  const house = races.filter((r) => r.chamber === "house");

  // HO 210: cartogram cells reuse the EXACT getRacesIndex rows, so a state's
  // tile count === the number of rows the LIST shows for that state.
  const cartogram = buildRacesCartogram(races, raceCandidates);
  const geometry = getUsMapGeometry();
  const todayISO = new Date().toISOString().slice(0, 10);

  return (
    <div className="flex min-h-screen flex-col">
      <HeaderBar basePath="/electoral" />
      <main className="w-full flex-1 px-4 py-4">
        <div className="mb-3 flex flex-wrap items-baseline gap-3">
          <h1
            className="text-[14px] uppercase tracking-[0.5px]"
            style={{ color: "var(--accent-amber)" }}
          >
            2026 electoral
          </h1>
        </div>

        <p
          className="mb-4 text-[12px] leading-snug"
          style={{ color: "var(--text-muted)" }}
        >
          Competitive 2026 races (rated by Cook, Sabato, or Inside Elections as
          anything other than Solid/Safe) on the map; the primary calendar below.
          Click a timeline date to highlight which states vote then — stack
          several to build a window. Click a state to drill into its districts;
          one MAP/LIST toggle away is the consensus-led, toss-ups-first list.
        </p>

        <RacesHeroBand
          control={chamberControl}
          ratedCount={races.length}
          senateCount={senate.length}
          houseCount={house.length}
        />

        <ElectoralBoard
          cells={cartogram.cells}
          summary={cartogram.summary}
          geometry={geometry}
          calendar={calendar}
          todayISO={todayISO}
          listSlot={<RaceListView senate={senate} house={house} />}
        />
      </main>
    </div>
  );
}
