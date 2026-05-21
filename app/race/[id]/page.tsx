import Link from "next/link";
import { HeaderBar } from "@/components/HeaderBar";
import { RaceCandidates } from "@/components/RaceCandidates";
import { RaceHeader } from "@/components/RaceHeader";
import { RaceIncumbentCard } from "@/components/RaceIncumbentCard";
import { RaceRunoffs } from "@/components/RaceRunoffs";
import { formatDateLong } from "@/lib/format";
import {
  getMember,
  getRace,
  getRaceCandidates,
  getRaceRatings,
  getRunoffsForRace,
} from "@/lib/queries";

// Reads the DB by params; opt out of static prerender (same as the
// member-hub route). Query-layer caching via unstable_cache + the "races"
// tag still applies, so dynamic doesn't mean uncached.
export const dynamic = "force-dynamic";

type RatingMeta = { label: string; color: string };

function ratingMeta(rating: string | null): RatingMeta | null {
  if (!rating) return null;
  switch (rating) {
    case "safe_r":
      return { label: "Safe R", color: "var(--party-republican)" };
    case "likely_r":
      return { label: "Likely R", color: "var(--party-republican)" };
    case "lean_r":
      return { label: "Lean R", color: "var(--party-republican)" };
    case "tossup":
      return { label: "Tossup", color: "var(--accent-amber)" };
    case "lean_d":
      return { label: "Lean D", color: "var(--party-democrat)" };
    case "likely_d":
      return { label: "Likely D", color: "var(--party-democrat)" };
    case "safe_d":
      return { label: "Safe D", color: "var(--party-democrat)" };
    default:
      return null;
  }
}

export default async function RacePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const race = await getRace(id);

  if (!race) {
    return (
      <div className="flex min-h-screen flex-col">
        <HeaderBar />
        <main className="w-full flex-1 px-4 py-4">
          <div
            className="px-6 py-16 text-center"
            style={{ color: "var(--text-muted)" }}
          >
            <p className="text-[14px] uppercase tracking-[0.5px]">
              Race not found
            </p>
            <p
              className="mt-2 text-[12px]"
              style={{ color: "var(--text-dim)" }}
            >
              race id: {id}
            </p>
            <Link
              href="/feed"
              className="mt-4 inline-block text-[12px] uppercase tracking-[0.5px] transition hover:text-[var(--accent-amber-bright)]"
              style={{ color: "var(--accent-amber)" }}
            >
              ← Back to feed
            </Link>
          </div>
        </main>
      </div>
    );
  }

  const [candidates, incumbent, ratings, runoffs] = await Promise.all([
    getRaceCandidates(race.id),
    race.incumbent_bioguide_id
      ? getMember(race.incumbent_bioguide_id)
      : Promise.resolve(null),
    getRaceRatings(race.id),
    getRunoffsForRace(race.id),
  ]);

  const rating = ratingMeta(race.rating);
  // A race that went to runoff is never a "stub" — runoffs.length guards the
  // "Incumbent running for re-election" placeholder, which would contradict
  // the runoff section (HO 107).
  const isStub =
    !race.rating && candidates.length === 0 && runoffs.length === 0;

  return (
    <div className="flex min-h-screen flex-col">
      <HeaderBar />

      <main className="w-full flex-1 px-4 py-4">
        <Link
          href={
            incumbent
              ? `/members/${incumbent.bioguideId}`
              : "/feed"
          }
          className="mb-4 inline-block text-[12px] uppercase tracking-[0.5px] transition hover:text-[var(--text-secondary)]"
          style={{ color: "var(--text-dim)" }}
        >
          ← Back
        </Link>

        <RaceHeader race={race} ratings={ratings} />

        {rating ? (
          <div
            className="my-5 grid grid-cols-[120px_1fr] gap-y-2 border-t border-b py-4 text-[12px] uppercase tracking-[0.5px]"
            style={{ borderColor: "var(--border-soft)" }}
          >
            <span style={{ color: "var(--text-dim)" }}>Rating</span>
            <span>
              <span
                className="inline-block border px-2 py-[1px] text-[12px]"
                style={{ color: rating.color, borderColor: rating.color }}
              >
                {rating.label}
              </span>
            </span>
            <span style={{ color: "var(--text-dim)" }}>Source</span>
            <span style={{ color: "var(--text-secondary)" }}>
              {race.rating_source ?? "—"}
              {race.rating_updated_at ? (
                <span style={{ color: "var(--text-dim)" }}>
                  {" · updated "}
                  {formatDateLong(race.rating_updated_at)}
                </span>
              ) : null}
            </span>
          </div>
        ) : null}

        <section
          className="mt-6 border"
          style={{ borderColor: "var(--border-strong)" }}
        >
          <div
            className="px-4 py-3"
            style={{
              backgroundColor: "var(--bg-panel)",
              borderBottom: "0.5px solid var(--border-strong)",
            }}
          >
            <h2
              className="text-[12px] uppercase tracking-[0.5px]"
              style={{ color: "var(--text-secondary)" }}
            >
              Incumbent
            </h2>
          </div>
          <div className="px-4">
            <RaceIncumbentCard member={incumbent} race={race} />
          </div>
        </section>

        <RaceRunoffs runoffs={runoffs} />

        {isStub ? (
          <p
            className="mt-6 text-[12px] uppercase tracking-[0.5px]"
            style={{ color: "var(--text-muted)" }}
          >
            {incumbent
              ? "Incumbent running for re-election. No competitive rating yet."
              : "Open seat. Candidate filings forthcoming."}
          </p>
        ) : (
          <section
            className="mt-6 border"
            style={{ borderColor: "var(--border-strong)" }}
          >
            <div
              className="flex items-baseline justify-between px-4 py-3"
              style={{
                backgroundColor: "var(--bg-panel)",
                borderBottom: "0.5px solid var(--border-strong)",
              }}
            >
              <h2
                className="text-[12px] uppercase tracking-[0.5px]"
                style={{ color: "var(--text-secondary)" }}
              >
                Candidates ({candidates.length})
              </h2>
            </div>
            <div className="px-4 pb-2">
              <RaceCandidates candidates={candidates} />
            </div>
          </section>
        )}

        {race.source_url ? (
          <div
            className="mt-6 text-[12px]"
            style={{ color: "var(--text-dim)" }}
          >
            <span className="uppercase tracking-[0.5px]">Source: </span>
            <a
              href={race.source_url}
              target="_blank"
              rel="noreferrer"
              className="transition hover:text-[var(--accent-amber-bright)]"
              style={{ color: "var(--accent-amber)" }}
            >
              {race.source_url}
            </a>
            <span> · last verified {formatDateLong(race.last_verified)}</span>
          </div>
        ) : (
          <div
            className="mt-6 text-[12px]"
            style={{ color: "var(--text-dim)" }}
          >
            Last verified {formatDateLong(race.last_verified)}
          </div>
        )}
      </main>
    </div>
  );
}
