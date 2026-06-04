import Link from "next/link";
import { CeremonialToggle } from "@/components/CeremonialToggle";
import { GroupTabs } from "@/components/GroupTabs";
import { HeaderBar } from "@/components/HeaderBar";
import { MemberProductivityScatter } from "@/components/MemberProductivityScatter";
import { Pagination } from "@/components/Pagination";
import { PalestineBadge } from "@/components/PalestineBadge";
import { PartyFilter } from "@/components/PartyFilter";
import { SearchBox } from "@/components/SearchBox";
import { SegmentedToggle } from "@/components/SegmentedToggle";
import { SponsorExpandedPanel } from "@/components/SponsorExpandedPanel";
import { StateFilter } from "@/components/StateFilter";
import { isPalestineGrade } from "@/lib/palestine-config";
import {
  type Chamber,
  getMemberAffiliations,
  getMemberCommittees,
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
  // HO 196: page-level so the column-header row picks the middle (bar) label.
  const isVolumeView = sort === "volume";

  const expandedParam =
    typeof params.expanded === "string" ? params.expanded : undefined;
  const expandedMember = expandedParam
    ? rows.find((r) => r.bioguide_id === expandedParam)
    : undefined;

  // HO 152: extended panel data fetch picks up committees + caucus
  // affiliations so the expanded row carries the two new sections, in
  // addition to the existing stats/topics/bills.
  const expansion = expandedMember
    ? await (async () => {
        const key = expandedMember.bioguide_id;
        const [stats, topics, recentBills, committees, affiliations] =
          await Promise.all([
            getSponsorStats(key, includeCeremonial),
            getSponsorTopTopics(key, 3, includeCeremonial),
            getSponsorRecentBills(key, includeCeremonial),
            getMemberCommittees(key),
            getMemberAffiliations(key),
          ]);
        return { key, stats, topics, recentBills, committees, affiliations };
      })()
    : null;

  // `carry` plumbs every active filter through child components so a filter
  // change or pagination preserves the others. Cleared per-control: each
  // filter drops `page` + `expanded` on change.
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

  // HO 152 — inline SegmentedToggle href builders. Both toggles drop
  // `page` and `expanded` on change (same convention the old hand-rolled
  // toggles used) so a filter change always resets to page 1 with no row
  // open. The chamber toggle drives both the row list AND the two
  // scatters' visibility (an "all" view shows both halves; HOUSE / SENATE
  // hides the other).
  const buildChamberHref = (value: "" | Chamber) => {
    const sp = new URLSearchParams(carry);
    sp.delete("page");
    sp.delete("expanded");
    if (value) sp.set("chamber", value);
    else sp.delete("chamber");
    const qs = sp.toString();
    return qs ? `/members?${qs}` : "/members";
  };

  const buildSortHref = (value: "volume" | "passrate") => {
    const sp = new URLSearchParams(carry);
    sp.delete("page");
    sp.delete("expanded");
    if (value === "volume") sp.delete("sort");
    else sp.set("sort", value);
    const qs = sp.toString();
    return qs ? `/members?${qs}` : "/members";
  };

  const headerFilters = { topics: [], chamber, includeCeremonial };
  const showHouse = chamber !== "senate";
  const showSenate = chamber !== "house";

  return (
    <div className="flex min-h-screen flex-col">
      {/* HO 195: pageOwnsControls drops the redundant legacy "search bills…"
          band (the page has its own "search members…" below); feedFilters stays
          so the inline sync line still renders. cursorAtEnd + liftSyncContrast
          are the Members-only masthead divergences. */}
      <HeaderBar
        feedFilters={headerFilters}
        basePath="/members"
        countMode="sponsors"
        pageOwnsControls
        cursorAtEnd
        liftSyncContrast
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
            <SegmentedToggle<"" | Chamber>
              current={(chamber ?? "") as "" | Chamber}
              ariaLabel="Chamber"
              segments={[
                { value: "", label: "ALL" },
                { value: "house", label: "HOUSE" },
                { value: "senate", label: "SENATE" },
              ]}
              buildHref={buildChamberHref}
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
            <SegmentedToggle<"volume" | "passrate">
              current={sort}
              ariaLabel="Rank by"
              segments={[
                { value: "volume", label: "VOLUME" },
                { value: "passrate", label: "PASS RATE" },
              ]}
              buildHref={buildSortHref}
            />
            {/* HO 195: ceremonial relocated out of the legacy HeaderBar band to
                here (right edge, after the sort toggle). Real effect on this
                page — billsAggCte excludes ceremonial from the sponsor counts +
                ranking unless on. */}
            <CeremonialToggle checked={includeCeremonial} />
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
          <div
            className={`grid gap-4 ${
              showHouse && showSenate ? "md:grid-cols-2" : "grid-cols-1"
            }`}
          >
            {showHouse ? (
              <MemberProductivityScatter chamber="house" />
            ) : null}
            {showSenate ? (
              <MemberProductivityScatter chamber="senate" />
            ) : null}
          </div>
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
            <>
              {/* HO 196: column headers — middle (bar) label swaps with the
                  active sort. Same grid as .sponsor-bar-row so labels align. */}
              <div className="sponsor-bar-header">
                <span aria-hidden />
                <span className="h-right">#</span>
                <span>MEMBER</span>
                <span>{isVolumeView ? "BILLS" : "PASS RATE"}</span>
                <span className="h-right">RATE</span>
                <span className="h-right">ENACT</span>
                <span className="h-right">BILLS</span>
              </div>
              <ol>
              {rows.map((m, i) => {
                const volPct = maxVolume > 0 ? (m.total / maxVolume) * 100 : 0;
                const rateLabel =
                  m.passrate === null ? "—" : `${Math.round(m.passrate * 100)}%`;
                const ratePct =
                  m.passrate === null ? 0 : Math.round(m.passrate * 100);
                const partyColor = partyColorFor(m.party);
                const enactedColor = "var(--stage-enacted)";
                const isExpanded = expansion?.key === m.bioguide_id;
                const rankNumber = (page - 1) * PAGE_SIZE + i + 1;
                // HO 196: ONE bar, meaning follows the active sort. VOLUME →
                // party-colored, length = count/max-in-view; PASS RATE → green,
                // length = enacted %. Track is always full-width so fills
                // compare row-to-row; barPct=0 leaves the track empty.
                const isVolume = sort === "volume";
                const barColor = isVolume ? partyColor : enactedColor;
                const barPct = isVolume ? volPct : ratePct;
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
                      {/* MEMBER: name + party-colored [PARTY-STATE] bracket */}
                      <span className="flex min-w-0 items-center gap-2">
                        <span
                          title={m.name}
                          className="truncate text-[14px]"
                          style={{ color: "var(--text-primary)" }}
                        >
                          {m.name}
                        </span>
                        <span
                          className="shrink-0 text-[12px] tabular-nums"
                          style={{ color: partyColor }}
                        >
                          [{m.party ?? "?"}-{m.state ?? "?"}]
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

                      {/* BAR: single, meaning follows the active sort */}
                      <span className="sponsor-bar-track">
                        {barPct > 0 ? (
                          <span
                            className="sponsor-bar-fill"
                            style={{
                              width: `${barPct}%`,
                              backgroundColor: barColor,
                            }}
                            aria-hidden
                          />
                        ) : null}
                      </span>

                      {/* RATE: green when >0, dim at 0 / no-data */}
                      <span
                        className="text-right text-[12px] tabular-nums"
                        style={{
                          color:
                            ratePct > 0
                              ? "var(--stage-enacted)"
                              : "var(--text-dim)",
                        }}
                      >
                        {rateLabel}
                      </span>

                      {/* ENACTED: N ✓ — secondary, dim at 0 */}
                      <span
                        className="text-right text-[12px] tabular-nums"
                        style={{
                          color:
                            m.enacted > 0
                              ? "var(--text-secondary)"
                              : "var(--text-dim)",
                        }}
                      >
                        {m.enacted} ✓
                      </span>

                      {/* BILLS: dim, emphasized to --text-primary when sorted by volume */}
                      <span
                        className="text-right text-[12px] tabular-nums"
                        style={{
                          color: isVolume
                            ? "var(--text-primary)"
                            : "var(--text-dim)",
                        }}
                      >
                        {m.total.toLocaleString()}
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
                        committees={expansion.committees}
                        affiliations={expansion.affiliations}
                        includeCeremonial={includeCeremonial}
                      />
                    ) : null}
                  </li>
                );
              })}
              </ol>
            </>
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
