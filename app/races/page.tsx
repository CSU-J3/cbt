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
import { HeaderBar } from "@/components/HeaderBar";
import { getRacesIndex, type RaceIndexRow } from "@/lib/queries";

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

function RaceRow({ race }: { race: RaceIndexRow }) {
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
    </Link>
  );
}

function RaceSection({
  title,
  races,
}: {
  title: string;
  races: RaceIndexRow[];
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
          </div>
          <div>
            {races.map((r) => (
              <RaceRow key={r.raceId} race={r} />
            ))}
          </div>
        </>
      )}
    </section>
  );
}

export default async function RacesPage() {
  const races = await getRacesIndex(2026);
  const senate = races.filter((r) => r.chamber === "senate");
  const house = races.filter((r) => r.chamber === "house");

  return (
    <div className="flex min-h-screen flex-col">
      <HeaderBar />
      <main className="w-full flex-1 px-4 py-4">
        <div className="mb-3 flex flex-wrap items-baseline gap-3">
          <h1
            className="text-[14px] uppercase tracking-[0.5px]"
            style={{ color: "var(--accent-amber)" }}
          >
            2026 races
          </h1>
          <span
            className="text-[12px] uppercase tracking-[0.5px] tabular-nums"
            style={{ color: "var(--text-muted)" }}
          >
            {races.length} tracked · {senate.length} Senate · {house.length} House
          </span>
        </div>

        <p
          className="mb-4 text-[12px] leading-snug"
          style={{ color: "var(--text-muted)" }}
        >
          Seats rated by Cook, Sabato, or Inside Elections as anything other than
          Solid/Safe. Sorted by consensus competitiveness — toss-ups first. Click
          a row for the race hub; click an incumbent for their member page.
        </p>

        <RaceSection title="Senate" races={senate} />
        <RaceSection title="House" races={house} />
      </main>
    </div>
  );
}
