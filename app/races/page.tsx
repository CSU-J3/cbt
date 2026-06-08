// /races index (handoff 84). Lists every race with ratings, broken into
// Senate + House sections. Senate section comes first because it's the
// smaller, denser pane; House follows, sorted by competitiveness within
// each.
//
// The rating color logic intentionally mirrors components/RatingChip.tsx
// and components/MemberHeader.tsx (handoff 73's three-file note in
// SKILL.md). Toss Up reads in amber; partisan ratings carry the party
// color regardless of strength (the strength is in the text).
import Link from "next/link";
import { CartogramShell } from "@/components/CartogramShell";
import { GroupTabs } from "@/components/GroupTabs";
import { HeaderBar } from "@/components/HeaderBar";
import { RacesHeroBand } from "@/components/RacesHeroBand";
import { buildRacesCartogram } from "@/lib/cartogram-data";
import { daysUntil, formatDateShort } from "@/lib/format";
import { getUsMapGeometry } from "@/lib/us-map-geo";
import {
  getChamberControl,
  getPastPrimaries,
  getRaceCandidatesForCycle,
  getRacesIndex,
  getUpcomingPrimaries,
  type RaceIndexRow,
} from "@/lib/queries";

export const dynamic = "force-dynamic";

function ratingColor(rating: string | null): string {
  if (!rating) return "var(--text-dim)";
  if (rating === "Toss Up") return "var(--accent-amber-bright)";
  if (rating.endsWith(" D")) return "var(--party-democrat)";
  if (rating.endsWith(" R")) return "var(--party-republican)";
  return "var(--text-muted)";
}

function seatLabel(race: RaceIndexRow): string {
  if (race.chamber === "senate") return `${race.state} SEN`;
  return `${race.state}-${String(race.district ?? 0).padStart(2, "0")}`;
}

function partyChip(party: string | null): { label: string; color: string } | null {
  if (party === "R") return { label: "R", color: "var(--party-republican)" };
  if (party === "D") return { label: "D", color: "var(--party-democrat)" };
  if (party === "I") return { label: "I", color: "var(--party-independent)" };
  return null;
}

function RaceRow({
  race,
  primaryDate,
}: {
  race: RaceIndexRow;
  primaryDate: string | null;
}) {
  const incumbent = race.incumbentName ? (
    <>
      {race.incumbentBioguideId ? (
        <Link
          href={`/members/${race.incumbentBioguideId}`}
          className="transition hover:text-[var(--accent-amber-bright)]"
          style={{ color: "var(--text-primary)" }}
        >
          {race.incumbentName}
        </Link>
      ) : (
        <span style={{ color: "var(--text-primary)" }}>{race.incumbentName}</span>
      )}
    </>
  ) : (
    <span style={{ color: "var(--text-dim)" }}>OPEN SEAT</span>
  );
  const p = partyChip(race.incumbentParty);
  const pDays = primaryDate ? daysUntil(primaryDate) : null;
  const primaryColor =
    pDays === null
      ? "var(--text-dim)"
      : pDays >= 0 && pDays <= 30
        ? "var(--party-republican)"
        : "var(--text-muted)";
  return (
    <Link
      href={`/race/${race.raceId}`}
      className="race-row"
      style={{ textDecoration: "none" }}
    >
      <span
        className="text-[13px] tabular-nums"
        style={{ color: "var(--text-secondary)" }}
      >
        {seatLabel(race)}
      </span>
      <span className="flex items-baseline gap-2 text-[13px]">
        {p ? (
          <span
            className="text-[11px] uppercase tracking-[0.5px]"
            style={{ color: p.color }}
          >
            [{p.label}]
          </span>
        ) : null}
        {incumbent}
      </span>
      <span
        className="text-[12px] uppercase tracking-[0.5px]"
        style={{ color: ratingColor(race.cookRating) }}
      >
        {race.cookRating ?? "—"}
      </span>
      <span
        className="text-[12px] uppercase tracking-[0.5px]"
        style={{ color: ratingColor(race.sabatoRating) }}
      >
        {race.sabatoRating ?? "—"}
      </span>
      <span
        className="text-[12px] uppercase tracking-[0.5px]"
        style={{ color: ratingColor(race.ieRating) }}
      >
        {race.ieRating ?? "—"}
      </span>
      <span
        className="text-[12px] uppercase tracking-[0.5px]"
        style={{ color: ratingColor(race.consensusRating) }}
      >
        {race.consensusRating ?? "—"}
      </span>
      <span
        className="text-[12px] tabular-nums"
        style={{ color: primaryColor }}
      >
        {primaryDate ? formatDateShort(primaryDate) : "—"}
      </span>
    </Link>
  );
}

function RaceSection({
  title,
  races,
  primaries,
}: {
  title: string;
  races: RaceIndexRow[];
  primaries: Map<string, string>;
}) {
  return (
    <section className="mb-6">
      <div
        className="px-4 py-2 border-b"
        style={{
          backgroundColor: "var(--bg-panel)",
          borderColor: "var(--border-strong)",
        }}
      >
        <span
          className="text-[12px] uppercase tracking-[0.5px]"
          style={{ color: "var(--text-secondary)" }}
        >
          {title} · {races.length} competitive
        </span>
      </div>
      {races.length === 0 ? (
        <div
          className="px-4 py-6 text-center text-[13px]"
          style={{ color: "var(--text-dim)" }}
        >
          No competitive races tracked.
        </div>
      ) : (
        <>
          <div className="race-header-row">
            <span>Seat</span>
            <span>Incumbent</span>
            <span>Cook</span>
            <span>Sabato</span>
            <span>Inside Elec</span>
            <span>Consensus</span>
            <span>Primary</span>
          </div>
          <div>
            {races.map((r) => (
              <RaceRow
                key={r.raceId}
                race={r}
                primaryDate={
                  primaries.get(`${r.state}-${r.incumbentParty}`) ?? null
                }
              />
            ))}
          </div>
        </>
      )}
    </section>
  );
}

export default async function RacesPage() {
  const [races, upcoming, past, raceCandidates, chamberControl] =
    await Promise.all([
      getRacesIndex(2026),
      getUpcomingPrimaries(300),
      getPastPrimaries(300),
      getRaceCandidatesForCycle(2026),
      getChamberControl(),
    ]);
  const senate = races.filter((r) => r.chamber === "senate");
  const house = races.filter((r) => r.chamber === "house");
  // State primary date keyed by "{STATE}-{party}" — every race in a state
  // shares that state's primary date (it sits on the senate-prefixed
  // calendar row regardless of the race's chamber).
  const primaries = new Map<string, string>();
  for (const p of [...upcoming, ...past]) {
    if (p.primary_date) primaries.set(`${p.state}-${p.party}`, p.primary_date);
  }

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
          MAP/LIST toggle away is the full spectrum-bar list. Click a tile to pin
          its contests; click an incumbent for their member page.
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
          listSlot={
            <>
              <RaceSection title="Senate" races={senate} primaries={primaries} />
              <RaceSection title="House" races={house} primaries={primaries} />
            </>
          }
        />
      </main>
    </div>
  );
}
