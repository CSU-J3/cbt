import Link from "next/link";
import { ChamberToggle } from "@/components/ChamberToggle";
import { HeaderBar } from "@/components/HeaderBar";
import { SponsorExpandedPanel } from "@/components/SponsorExpandedPanel";
import { SponsorProductivityScatter } from "@/components/SponsorProductivityScatter";
import { SponsorSortToggle } from "@/components/SponsorSortToggle";
import {
  type Chamber,
  getSponsorRecentBills,
  getSponsorsRanked,
  getSponsorStats,
  getSponsorTopTopics,
  normalizePartyVariant,
  sanitizeChamber,
  sanitizeIncludeCeremonial,
  sanitizeSponsorSort,
} from "@/lib/queries";

type SearchParams = {
  chamber?: string;
  expanded?: string;
  sort?: string;
  ceremonial?: string;
};

function partyColorFor(party: string | null): string {
  const key = normalizePartyVariant(party);
  if (key === "R") return "var(--party-republican)";
  if (key === "D") return "var(--party-democrat)";
  if (key === "I") return "var(--party-independent)";
  return "var(--text-dim)";
}

function sponsorKey(s: { sponsor_bioguide_id: string | null; sponsor_name: string }): string {
  return s.sponsor_bioguide_id ?? s.sponsor_name;
}

export default async function SponsorsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const chamber = sanitizeChamber(params.chamber);
  const sort = sanitizeSponsorSort(params.sort);
  const includeCeremonial = sanitizeIncludeCeremonial(params.ceremonial);
  const expandedParam =
    typeof params.expanded === "string" ? params.expanded : undefined;
  const headerFilters = { topics: [], chamber, includeCeremonial };
  const rows = await getSponsorsRanked(
    { chamber, includeCeremonial },
    sort,
    100,
  );
  const maxVolume = rows.reduce((m, r) => Math.max(m, r.total), 0);

  const expandedSponsor = expandedParam
    ? rows.find((s) => sponsorKey(s) === expandedParam)
    : undefined;

  const expansion = expandedSponsor
    ? await (async () => {
        const key = sponsorKey(expandedSponsor);
        const [stats, topics, recentBills] = await Promise.all([
          getSponsorStats(key, includeCeremonial),
          getSponsorTopTopics(key, 3, includeCeremonial),
          getSponsorRecentBills(key, includeCeremonial),
        ]);
        return { key, stats, topics, recentBills };
      })()
    : null;

  const carry = new URLSearchParams();
  if (chamber) carry.set("chamber", chamber);
  if (sort !== "volume") carry.set("sort", sort);
  if (includeCeremonial) carry.set("ceremonial", "1");

  const chamberLabel: Record<Chamber, string> = {
    house: "house",
    senate: "senate",
  };
  const sortLabel = sort === "passrate" ? "pass rate" : "bills introduced";
  const subtitle = chamber
    ? `Top 100 ${chamberLabel[chamber]} sponsors by ${sortLabel} (119th Congress)`
    : `Top 100 by ${sortLabel} (119th Congress)`;

  function rowHref(key: string, isExpanded: boolean): string {
    const sp = new URLSearchParams(carry);
    if (!isExpanded) sp.set("expanded", key);
    const qs = sp.toString();
    return qs ? `/sponsors?${qs}` : "/sponsors";
  }

  return (
    <div className="flex min-h-screen flex-col">
      <HeaderBar
        feedFilters={headerFilters}
        basePath="/sponsors"
        countMode="sponsors"
      />

      <main className="w-full flex-1 px-4 py-4">
        <div className="mb-3 flex flex-wrap items-baseline gap-3">
          <h1
            className="text-[14px] uppercase tracking-[0.5px]"
            style={{ color: "var(--accent-amber)" }}
          >
            Sponsors
          </h1>
          <span
            className="text-[12px] uppercase tracking-[0.5px]"
            style={{ color: "var(--text-muted)" }}
          >
            {subtitle}
          </span>
          <span className="ml-auto flex flex-wrap items-center gap-3">
            <ChamberToggle
              current={chamber}
              carry={carry}
              basePath="/sponsors"
            />
            <SponsorSortToggle
              current={sort}
              carry={carry}
              basePath="/sponsors"
            />
          </span>
        </div>

        {sort === "passrate" ? (
          <p
            className="mb-3 text-[12px] leading-snug"
            style={{ color: "var(--text-muted)" }}
          >
            <em>
              Pass rate = bills currently at <code>enacted</code> stage. Most
              bills die in committee without a formal vote. Numbers stabilize
              after the Congress ends.
            </em>
          </p>
        ) : null}

        <section
          className="mb-4 border p-3"
          style={{ borderColor: "var(--border-strong)" }}
        >
          <p
            className="mb-2 text-[12px] uppercase tracking-[0.5px]"
            style={{ color: "var(--text-muted)" }}
          >
            Sponsor productivity (bills · pass rate)
          </p>
          <SponsorProductivityScatter />
        </section>

        <div
          className="border"
          style={{ borderColor: "var(--border-strong)" }}
        >
          {rows.length === 0 ? (
            <div
              className="px-6 py-12 text-center text-[13px] uppercase tracking-[0.5px]"
              style={{ color: "var(--text-dim)" }}
            >
              No sponsors found
            </div>
          ) : (
            <ol>
              {rows.map((s, i) => {
                const volPct = maxVolume > 0 ? (s.total / maxVolume) * 100 : 0;
                const ratePct = Math.round(s.passrate * 100);
                const partyColor = partyColorFor(s.sponsor_party);
                const enactedColor = "var(--stage-enacted)";
                const key = sponsorKey(s);
                const isExpanded = expansion?.key === key;
                return (
                  <li key={key}>
                    <Link
                      href={rowHref(key, isExpanded)}
                      replace
                      scroll={false}
                      prefetch={false}
                      className={`sponsor-bar-row ${isExpanded ? "is-expanded" : ""}`}
                    >
                      <span
                        aria-hidden
                        style={{
                          color: isExpanded
                            ? "var(--accent-amber)"
                            : "var(--text-dim)",
                        }}
                      >
                        {isExpanded ? "▾" : "▸"}
                      </span>
                      <span
                        className="text-right text-[12px] tabular-nums"
                        style={{ color: "var(--text-dim)" }}
                      >
                        {i + 1}
                      </span>
                      <span
                        title={s.sponsor_name}
                        className="truncate text-[14px]"
                        style={{ color: "var(--text-primary)" }}
                      >
                        {s.sponsor_name}
                      </span>
                      <span className="sponsor-bars">
                        <span className="sponsor-bar-line">
                          <span className="sponsor-bar-track">
                            <span
                              className="sponsor-bar-fill"
                              style={{
                                width: `${volPct}%`,
                                backgroundColor: partyColor,
                              }}
                              aria-hidden
                            />
                          </span>
                          <span
                            className="text-right text-[12px] tabular-nums"
                            style={{ color: "var(--text-secondary)" }}
                          >
                            {s.total.toLocaleString()}
                          </span>
                        </span>
                        <span className="sponsor-bar-line">
                          <span className="sponsor-bar-track">
                            <span
                              className="sponsor-bar-fill"
                              style={{
                                width: `${ratePct}%`,
                                backgroundColor: enactedColor,
                              }}
                              aria-hidden
                            />
                          </span>
                          <span
                            className="text-right text-[12px] tabular-nums"
                            style={{ color: "var(--text-secondary)" }}
                          >
                            {ratePct}%
                          </span>
                        </span>
                      </span>
                      <span
                        className="text-right text-[12px] tabular-nums"
                        style={{ color: "var(--text-muted)" }}
                      >
                        <span style={{ color: "var(--stage-enacted)" }}>
                          {s.enacted}✓
                        </span>{" "}
                        / {s.total}
                      </span>
                    </Link>
                    {isExpanded && expansion ? (
                      <SponsorExpandedPanel
                        sponsorKey={key}
                        sponsorName={s.sponsor_name}
                        sponsorParty={s.sponsor_party}
                        sponsorState={s.sponsor_state}
                        bioguideId={s.sponsor_bioguide_id}
                        stats={expansion.stats}
                        topics={expansion.topics}
                        recentBills={expansion.recentBills}
                        includeCeremonial={includeCeremonial}
                      />
                    ) : null}
                  </li>
                );
              })}
            </ol>
          )}
        </div>
      </main>
    </div>
  );
}
