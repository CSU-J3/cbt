// /electoral — the consolidated Electoral surface (HO 333, moved from /races).
// One surface: the competitive US map on top, a primary-calendar timeline band
// below it, wired so the timeline drives an amber highlight on the map. The
// HO 219 hero band + the competitive map (CartogramShell, purple competitive
// fill, leader-lines, DISPLAY_STALE_STATES) are reused unchanged; the map keeps
// its HO 225 state-click district drill. The Races · Primaries sub-nav (HO 173)
// is retired — one surface, no GroupTabs. /races + /primaries 308-redirect here.
//
// HO 710: ?cycle=2028 switches to the seat-outlook list. The DEFAULT IS THE
// ABSENCE OF THE PARAM (HO 690) — bare /electoral is 2026 and is byte-identical
// to its pre-710 self apart from the toggle node. The 2028 branch deliberately
// mounts NO hero band, board, calendar or list view: nothing is rated or
// scheduled for that cycle yet, and an empty map is noise rather than honesty.
import { ElectoralBoard } from "@/components/ElectoralBoard";
import { HeaderBar } from "@/components/HeaderBar";
import { RaceListView } from "@/components/RaceListView";
import { RacesHeroBand } from "@/components/RacesHeroBand";
import { SeatOutlookList } from "@/components/SeatOutlookList";
import { SegmentedToggle } from "@/components/SegmentedToggle";
import { buildRacesCartogram } from "@/lib/cartogram-data";
import { getUsMapGeometry } from "@/lib/us-map-geo";
import {
  ELECTORAL_CYCLES,
  getChamberControl,
  getPacIeSpending,
  getPrimaryCalendar,
  getRaceCandidatesForCycle,
  getRacesIndex,
  getSeatOutlook,
  sanitizeCycle,
} from "@/lib/queries";

export const dynamic = "force-dynamic";

// The toggle segments read ELECTORAL_CYCLES, the same constant sanitizeCycle
// validates against, so the toggle and the sanitizer cannot drift apart. A
// third cycle costs more than that constant: the page branches on
// `cycle === 2028` below, and the 2028 description hard-codes 34, Class 3, the
// 120th Congress and the 2026 deciding contest.
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

  const [races, raceCandidates, chamberControl, calendar, pacByRace] =
    await Promise.all([
      getRacesIndex(2026),
      getRaceCandidatesForCycle(2026),
      getChamberControl(),
      getPrimaryCalendar(2026),
      getPacIeSpending(2026),
    ]);
  const senate = races.filter((r) => r.chamber === "senate");
  const house = races.filter((r) => r.chamber === "house");

  // HO 210: cartogram cells reuse the EXACT getRacesIndex rows, so a state's
  // tile count === the number of rows the LIST shows for that state.
  // HO 393: pacByRace threads the UDP IE direction rows onto each contest.
  const cartogram = buildRacesCartogram(races, raceCandidates, pacByRace);
  const geometry = getUsMapGeometry();
  const todayISO = new Date().toISOString().slice(0, 10);

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

        <p
          className="mb-4 text-[length:var(--fs-12)] leading-snug"
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
          listSlot={
            <RaceListView senate={senate} house={house} pacByRace={pacByRace} />
          }
        />
      </main>
    </div>
  );
}

// The 2028 branch. Title row, a dated description, the list. No band, board,
// calendar or list view — see the note at the top of the file.
async function SeatOutlookPage({ cycle }: { cycle: number }) {
  const rows = await getSeatOutlook(cycle);

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

        <p
          className="mb-4 text-[length:var(--fs-12)] leading-snug"
          style={{ color: "var(--text-muted)" }}
        >
          Every seat up on November 7, {cycle}: the 34 Class 3 Senate seats now;
          all House seats once the 120th Congress is seated. OPEN — the
          incumbent has said they won&rsquo;t seek the seat. LIKELY — a public
          signal short of an announcement, dated and sourced. TBD — the {cycle}{" "}
          holder is decided by a 2026 contest. No ratings or markets exist for
          this cycle yet.
        </p>

        <SeatOutlookList rows={rows} cycle={cycle} />
      </main>
    </div>
  );
}
