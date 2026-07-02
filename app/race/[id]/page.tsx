import Link from "next/link";
import { HeaderBar } from "@/components/HeaderBar";
import { raceLabelCompact } from "@/components/RaceHeader";
import { RaceHubBody } from "@/components/RaceHubBody";
import {
  getMember,
  getPacIeSpending,
  getRace,
  getRaceCandidates,
  getRaceNews,
  getRaceRatings,
  getRunoffsForRace,
} from "@/lib/queries";

// Reads the DB by params; opt out of static prerender (same as the
// member-hub route). Query-layer caching via unstable_cache + the "races"
// tag still applies, so dynamic doesn't mean uncached.
export const dynamic = "force-dynamic";

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
        <HeaderBar basePath={`/race/${id}`} />
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
              href="/bills"
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

  const [candidates, incumbent, ratings, runoffs, pacByRace, news] =
    await Promise.all([
      getRaceCandidates(race.id),
      race.incumbent_bioguide_id
        ? getMember(race.incumbent_bioguide_id)
        : Promise.resolve(null),
      getRaceRatings(race.id),
      getRunoffsForRace(race.id),
      getPacIeSpending(race.cycle),
      // Null guard: open seat → no join key, skip the query and let RaceHubBody
      // render the open-seat empty state (HO 398).
      race.incumbent_bioguide_id
        ? getRaceNews(race.incumbent_bioguide_id, 8)
        : Promise.resolve([]),
    ]);

  return (
    <div className="flex min-h-screen flex-col">
      <HeaderBar basePath={`/race/${id}`} detail={raceLabelCompact(race)} />

      <main className="w-full flex-1 px-4 py-4">
        <Link
          href={incumbent ? `/members/${incumbent.bioguideId}` : "/bills"}
          className="mb-4 inline-block text-[12px] uppercase tracking-[0.5px] transition hover:text-[var(--text-secondary)]"
          style={{ color: "var(--text-dim)" }}
        >
          ← Back
        </Link>

        <RaceHubBody
          race={race}
          candidates={candidates}
          incumbent={incumbent}
          ratings={ratings}
          runoffs={runoffs}
          pac={pacByRace[race.id]}
          news={news}
        />
      </main>
    </div>
  );
}
