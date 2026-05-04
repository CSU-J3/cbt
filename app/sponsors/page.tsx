import Link from "next/link";
import { FooterLegend } from "@/components/FooterLegend";
import { HeaderBar } from "@/components/HeaderBar";
import { PartyFilter } from "@/components/PartyFilter";
import { SponsorRow } from "@/components/SponsorRow";
import { StateFilter } from "@/components/StateFilter";
import {
  getSponsorCount,
  getSponsorRecentBills,
  getSponsors,
  getSponsorStates,
  type PartyKey,
  type SponsorFilters,
} from "@/lib/queries";

type SearchParams = {
  party?: string;
  state?: string;
  q?: string;
  expanded?: string;
};

function sanitizeParty(input: string | undefined): PartyKey | undefined {
  if (input === "R" || input === "D" || input === "I") return input;
  return undefined;
}

export default async function SponsorsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const party = sanitizeParty(params.party);
  const stateRaw =
    typeof params.state === "string" ? params.state.trim().toUpperCase() : "";
  const q = typeof params.q === "string" ? params.q.trim() : "";
  const expandedParam =
    typeof params.expanded === "string" ? params.expanded : undefined;

  const states = await getSponsorStates();
  const stateAllowed = stateRaw && states.includes(stateRaw) ? stateRaw : "";

  const filters: SponsorFilters = {
    party,
    state: stateAllowed || undefined,
    q: q || undefined,
  };
  const headerFilters = { topics: [], stage: undefined, q: q || undefined };
  const hasFilters = !!party || !!stateAllowed;

  const [sponsors, counts] = await Promise.all([
    getSponsors(filters),
    getSponsorCount(filters),
  ]);

  const expandedName =
    expandedParam && sponsors.some((s) => s.sponsor_name === expandedParam)
      ? expandedParam
      : undefined;
  const recentBills = expandedName
    ? await getSponsorRecentBills(expandedName, 5)
    : [];

  const clearSearchParams = new URLSearchParams();
  if (party) clearSearchParams.set("party", party);
  if (stateAllowed) clearSearchParams.set("state", stateAllowed);
  const clearSearchHref = clearSearchParams.toString()
    ? `/sponsors?${clearSearchParams.toString()}`
    : "/sponsors";

  return (
    <div className="flex min-h-screen flex-col">
      <HeaderBar
        feedFilters={headerFilters}
        basePath="/sponsors"
        countMode="sponsors"
        sponsorCounts={counts}
      />

      <main className="w-full flex-1 px-4 py-4">
        <p
          className="mb-3 text-[12px] uppercase tracking-[0.5px]"
          style={{ color: "var(--text-muted)" }}
        >
          who&apos;s introducing what, sorted by bill count
        </p>

        <section
          className="filter-chips mb-3 flex flex-wrap items-center gap-3 border-b pb-3"
          style={{ borderColor: "var(--border-strong)" }}
        >
          <span
            className="text-[12px] uppercase tracking-[0.5px]"
            style={{ color: "var(--text-dim)" }}
          >
            Party
          </span>
          <PartyFilter
            current={party}
            state={stateAllowed || undefined}
            q={q || undefined}
            basePath="/sponsors"
          />
          <span
            className="ml-2 text-[12px] uppercase tracking-[0.5px]"
            style={{ color: "var(--text-dim)" }}
          >
            State
          </span>
          <StateFilter
            current={stateAllowed || undefined}
            party={party}
            q={q || undefined}
            basePath="/sponsors"
            states={states}
          />
          {hasFilters ? (
            <Link
              href={q ? `/sponsors?q=${encodeURIComponent(q)}` : "/sponsors"}
              className="ml-auto text-[12px] uppercase tracking-[0.5px] transition hover:text-[var(--text-secondary)]"
              style={{ color: "var(--text-dim)" }}
            >
              Clear filters ✕
            </Link>
          ) : null}
        </section>

        <div
          className="border"
          style={{ borderColor: "var(--border-strong)" }}
        >
          <div className="sponsor-header-row">
            <span aria-hidden></span>
            <span>Sponsor</span>
            <span>Pty</span>
            <span>St</span>
            <span className="text-right">Bills</span>
            <span>Latest</span>
          </div>

          {sponsors.length === 0 ? (
            q ? (
              <div
                className="px-6 py-12 text-center"
                style={{ color: "var(--text-secondary)" }}
              >
                <p className="text-[14px] uppercase tracking-[0.5px]">
                  No sponsors match &quot;{q}&quot;
                </p>
                <p
                  className="mt-2 text-[13px]"
                  style={{ color: "var(--text-dim)" }}
                >
                  Try a broader term, check spelling, or clear the search.
                </p>
                <Link
                  href={clearSearchHref}
                  className="mt-4 inline-block border px-3 py-1 text-[12px] uppercase tracking-[0.5px] transition hover:text-[var(--bg-base)] hover:bg-[var(--accent-amber)]"
                  style={{
                    color: "var(--accent-amber)",
                    borderColor: "var(--accent-amber)",
                  }}
                >
                  [Clear search]
                </Link>
              </div>
            ) : (
              <div
                className="px-6 py-8 text-center text-[13px] uppercase tracking-[0.5px]"
                style={{ color: "var(--text-dim)" }}
              >
                No sponsors match these filters
              </div>
            )
          ) : (
            <ul>
              {sponsors.map((s) => (
                <SponsorRow
                  key={`${s.sponsor_name}|${s.sponsor_party}|${s.sponsor_state}`}
                  sponsor={s}
                  filters={{
                    party,
                    state: stateAllowed || undefined,
                    q: q || undefined,
                  }}
                  expanded={expandedName === s.sponsor_name}
                  recentBills={
                    expandedName === s.sponsor_name ? recentBills : []
                  }
                />
              ))}
            </ul>
          )}
        </div>
      </main>

      <FooterLegend />
    </div>
  );
}
