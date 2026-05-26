import Link from "next/link";
import { ChamberToggle } from "@/components/ChamberToggle";
import { GroupTabs } from "@/components/GroupTabs";
import { HeaderBar } from "@/components/HeaderBar";
import { Pagination } from "@/components/Pagination";
import { PalestineBadge } from "@/components/PalestineBadge";
import { PartyFilter } from "@/components/PartyFilter";
import { SearchBox } from "@/components/SearchBox";
import { SponsorExpandedPanel } from "@/components/SponsorExpandedPanel";
import { SponsorProductivityScatter } from "@/components/SponsorProductivityScatter";
import { SponsorSortToggle } from "@/components/SponsorSortToggle";
import { StateFilter } from "@/components/StateFilter";
import { isPalestineGrade } from "@/lib/palestine-config";
import {
  getMemberStates,
  getMembersRanked,
  getMembersRankedCount,
  getSponsorRecentBills,
  getSponsorStats,
  getSponsorTopTopics,
  normalizePartyVariant,
  sanitizeChamber,
  sanitizeIncludeCeremonial,
  sanitizeMemberParty,
  sanitizeMemberState,
  sanitizeSponsorSort,
} from "@/lib/queries";

type SearchParams = {
  chamber?: string;
  party?: string;
  state?: string;
  q?: string;
  sort?: string;
  page?: string;
  expanded?: string;
  ceremonial?: string;
};

const PAGE_SIZE = 50;

function partyColorFor(party: string | null): string {
  const key = normalizePartyVariant(party);
  if (key === "R") return "var(--party-republican)";
  if (key === "D") return "var(--party-democrat)";
  if (key === "I") return "var(--party-independent)";
  return "var(--text-dim)";
}

export default async function MembersPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const chamber = sanitizeChamber(params.chamber);
  const party = sanitizeMemberParty(params.party);
  const sort = sanitizeSponsorSort(params.sort);
  const includeCeremonial = sanitizeIncludeCeremonial(params.ceremonial);
  const q =
    typeof params.q === "string" && params.q.trim().length > 0
      ? params.q.trim()
      : undefined;

  // State dropdown is gated by which abbreviations actually exist in the
  // current roster (50 + DC + a couple of territories). Pulled once per
  // request; cached separately so the filter render stays cheap.
  const stateOptions = await getMemberStates();
  const stateSet = new Set(stateOptions);
  const state = sanitizeMemberState(params.state, stateSet);

  const pageParam = Number.parseInt(params.page ?? "1", 10);
  const page =
    Number.isFinite(pageParam) && pageParam >= 1 ? pageParam : 1;

  const filters = {
    chamber,
    party,
    state,
    q,
    includeCeremonial,
  };

  const [rows, total] = await Promise.all([
    getMembersRanked(filters, sort, page, PAGE_SIZE),
    getMembersRankedCount(filters),
  ]);
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const maxVolume = rows.reduce((m, r) => Math.max(m, r.total), 0);

  const expandedParam =
    typeof params.expanded === "string" ? params.expanded : undefined;
  const expandedMember = expandedParam
    ? rows.find((r) => r.bioguide_id === expandedParam)
    : undefined;

  // Expansion data still keys off the same sponsor helpers — they accept a
  // bioguide_id and resolve via OR. Members with zero sponsored bills come
  // back as zero stats / empty bills, which the panel already handles since
  // its callers (SponsorExpandedPanel) just render what they're given.
  const expansion = expandedMember
    ? await (async () => {
        const key = expandedMember.bioguide_id;
        const [stats, topics, recentBills] = await Promise.all([
          getSponsorStats(key, includeCeremonial),
          getSponsorTopTopics(key, 3, includeCeremonial),
          getSponsorRecentBills(key, includeCeremonial),
        ]);
        return { key, stats, topics, recentBills };
      })()
    : null;

  // `carry` plumbs every active filter through child components so a filter
  // change or pagination preserves the others. Cleared per-control: each
  // filter drops `page` + `expanded` on change (see PartyFilter etc.).
  const carry = new URLSearchParams();
  if (chamber) carry.set("chamber", chamber);
  if (party) carry.set("party", party);
  if (state) carry.set("state", state);
  if (q) carry.set("q", q);
  if (sort !== "volume") carry.set("sort", sort);
  if (includeCeremonial) carry.set("ceremonial", "1");
  if (page > 1) carry.set("page", String(page));

  const filterActive = Boolean(chamber || party || state || q);
  const subtitle = filterActive
    ? `${total.toLocaleString()} of 536 · 119th Congress`
    : `${total.toLocaleString()} members of the 119th Congress`;

  function rowHref(bioguideId: string, isExpanded: boolean): string {
    const sp = new URLSearchParams(carry);
    if (!isExpanded) sp.set("expanded", bioguideId);
    const qs = sp.toString();
    return qs ? `/members?${qs}` : "/members";
  }

  const headerFilters = { topics: [], chamber, includeCeremonial };

  return (
    <div className="flex min-h-screen flex-col">
      <HeaderBar
        feedFilters={headerFilters}
        basePath="/members"
        countMode="sponsors"
      />

      <main className="w-full flex-1 px-4 py-4">
        <GroupTabs group="members" active="members" />
        <div className="mb-3 flex flex-wrap items-baseline gap-3">
          <h1
            className="text-[14px] uppercase tracking-[0.5px]"
            style={{ color: "var(--accent-amber)" }}
          >
            Members
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
              basePath="/members"
            />
            <PartyFilter
              current={party}
              carry={carry}
              basePath="/members"
            />
            <StateFilter
              current={state}
              carry={carry}
              basePath="/members"
              states={stateOptions}
            />
            <SponsorSortToggle
              current={sort}
              carry={carry}
              basePath="/members"
            />
          </span>
        </div>

        <div className="mb-3 max-w-md">
          <SearchBox basePath="/members" placeholder="search members..." />
        </div>

        {sort === "passrate" ? (
          <p
            className="mb-3 text-[12px] leading-snug"
            style={{ color: "var(--text-muted)" }}
          >
            <em>
              Pass rate = bills currently at <code>enacted</code> stage. Most
              bills die in committee without a formal vote. Numbers stabilize
              after the Congress ends. Members with no sponsored bills render
              an em-dash rather than 0% so "no data" doesn't read as "0% pass
              rate."
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
            Member productivity (bills · pass rate)
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
              No members match
            </div>
          ) : (
            <ol>
              {rows.map((m, i) => {
                const volPct = maxVolume > 0 ? (m.total / maxVolume) * 100 : 0;
                // passrate is NULL for the zero-bills case; render em-dash
                // instead of "0%" so the reader doesn't misread "no data" as
                // a 0-of-N pass rate.
                const rateLabel =
                  m.passrate === null ? "—" : `${Math.round(m.passrate * 100)}%`;
                const ratePct =
                  m.passrate === null ? 0 : Math.round(m.passrate * 100);
                const partyColor = partyColorFor(m.party);
                const enactedColor = "var(--stage-enacted)";
                const isExpanded = expansion?.key === m.bioguide_id;
                const rankNumber = (page - 1) * PAGE_SIZE + i + 1;
                const isEmpty = m.total === 0;
                return (
                  <li key={m.bioguide_id}>
                    <Link
                      href={rowHref(m.bioguide_id, isExpanded)}
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
                        {rankNumber}
                      </span>
                      <span className="flex min-w-0 items-center gap-2">
                        <span
                          title={m.name}
                          className="truncate text-[14px]"
                          style={{ color: "var(--text-primary)" }}
                        >
                          {m.name}
                        </span>
                        {m.palestineGrade &&
                        isPalestineGrade(m.palestineGrade) ? (
                          <span className="shrink-0">
                            <PalestineBadge
                              grade={m.palestineGrade}
                              rank={m.palestineRank}
                            />
                          </span>
                        ) : null}
                      </span>
                      <span className="sponsor-bars">
                        <span className="sponsor-bar-line">
                          <span className="sponsor-bar-track">
                            {isEmpty ? null : (
                              <span
                                className="sponsor-bar-fill"
                                style={{
                                  width: `${volPct}%`,
                                  backgroundColor: partyColor,
                                }}
                                aria-hidden
                              />
                            )}
                          </span>
                          <span
                            className="text-right text-[12px] tabular-nums"
                            style={{ color: "var(--text-secondary)" }}
                          >
                            {m.total.toLocaleString()}
                          </span>
                        </span>
                        <span className="sponsor-bar-line">
                          <span className="sponsor-bar-track">
                            {isEmpty ? null : (
                              <span
                                className="sponsor-bar-fill"
                                style={{
                                  width: `${ratePct}%`,
                                  backgroundColor: enactedColor,
                                }}
                                aria-hidden
                              />
                            )}
                          </span>
                          <span
                            className="text-right text-[12px] tabular-nums"
                            style={{
                              color: isEmpty
                                ? "var(--text-dim)"
                                : "var(--text-secondary)",
                            }}
                          >
                            {rateLabel}
                          </span>
                        </span>
                      </span>
                      <span
                        className="text-right text-[12px] tabular-nums"
                        style={{ color: "var(--text-muted)" }}
                      >
                        <span style={{ color: "var(--stage-enacted)" }}>
                          {m.enacted}✓
                        </span>{" "}
                        / {m.total}
                      </span>
                    </Link>
                    {isExpanded && expansion ? (
                      <SponsorExpandedPanel
                        sponsorKey={m.bioguide_id}
                        sponsorName={m.name}
                        sponsorParty={m.party}
                        sponsorState={m.state}
                        bioguideId={m.bioguide_id}
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

          <Pagination
            currentPage={page}
            totalPages={totalPages}
            carry={carry}
            basePath="/members"
          />
        </div>
      </main>
    </div>
  );
}
