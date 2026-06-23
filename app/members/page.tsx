import Link from "next/link";
import { CeremonialToggle } from "@/components/CeremonialToggle";
import { CommitteeRailRow } from "@/components/CommitteeRailRow";
import { GroupTabs } from "@/components/GroupTabs";
import { HeaderBar } from "@/components/HeaderBar";
import { MemberTopicBar } from "@/components/MemberTopicBar";
import { PalestineBadge } from "@/components/PalestineBadge";
import { PartyFilter } from "@/components/PartyFilter";
import { RosterShowAll } from "@/components/RosterShowAll";
import { SearchBox } from "@/components/SearchBox";
import { SegmentedToggle } from "@/components/SegmentedToggle";
import { SponsorExpandedPanel } from "@/components/SponsorExpandedPanel";
import { StateFilter } from "@/components/StateFilter";
import { cleanMeetingTitle, etDayLabel, etTimeLabel } from "@/lib/hearings";
import {
  buildTopicSegments,
  OTHER_TOPIC,
  type TopicSegment,
} from "@/lib/member-topic-mix";
import { isPalestineGrade } from "@/lib/palestine-config";
import {
  type Chamber,
  type CommitteeRosterMember,
  getCommitteeBySystemCode,
  getCommitteeRoster,
  getCommitteesIndex,
  getMemberAffiliations,
  getMemberCommittees,
  getMembersRanked,
  getMembersRankedCount,
  getMembersTopicMix,
  getMemberStates,
  getUpcomingMeetings,
  getSponsorRecentBills,
  getSponsorStats,
  getSponsorTopTopics,
  type MemberRanking,
  normalizePartyVariant,
  sanitizeChamber,
  sanitizeIncludeCeremonial,
  sanitizeMemberParty,
  sanitizeMemberState,
  sanitizeSponsorSort,
} from "@/lib/queries";
import { topicColor, topicFullLabel, topicLabel } from "@/lib/topic-colors";

type SearchParams = {
  chamber?: string;
  party?: string;
  state?: string;
  q?: string;
  sort?: string;
  expanded?: string;
  ceremonial?: string;
  committee?: string;
};

// Full ranked list (no pagination) so the bar scales to the global filtered max
// (HO 328 spec). The list scrolls on overflow. 600 covers all 536 current members.
const LIST_LIMIT = 600;
const ROSTER_CAP = 10;

function partyColorFor(party: string | null): string {
  const key = normalizePartyVariant(party);
  if (key === "R") return "var(--party-republican)";
  if (key === "D") return "var(--party-democrat)";
  if (key === "I") return "var(--party-independent)";
  return "var(--text-dim)";
}

function chamberTag(chamber: "house" | "senate" | "joint"): string {
  if (chamber === "house") return "HSE";
  if (chamber === "senate") return "SEN";
  return "JNT";
}

function roleBadge(
  role: string | null,
): { label: string; cls: string } | null {
  const r = role?.toLowerCase() ?? "";
  if (r.includes("ranking")) return { label: "RANKING", cls: "mc-rtag-rank" };
  if (r.includes("chair")) return { label: "CHAIR", cls: "mc-rtag-chair" };
  return null;
}

// A rendered member row — full-list rows have no committee role; scoped roster
// rows carry chair/ranking. `segments` is the member's topic-mix bar.
type Row = MemberRanking & {
  role?: string | null;
  segments: TopicSegment[];
};

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
  const committeeCode =
    typeof params.committee === "string" && params.committee.trim().length > 0
      ? params.committee.trim().toLowerCase()
      : undefined;
  const expandedParam =
    typeof params.expanded === "string" ? params.expanded : undefined;

  const stateOptions = await getMemberStates();
  const stateSet = new Set(stateOptions);
  const state = sanitizeMemberState(params.state, stateSet);

  const filters = { chamber, party, state, q, includeCeremonial };

  // Shared across both panes / both modes.
  const [railCommittees, upcoming, topicMixRows, total] = await Promise.all([
    getCommitteesIndex({ chamber }),
    getUpcomingForRail(chamber),
    getMembersTopicMix(includeCeremonial),
    getMembersRankedCount(filters),
  ]);

  // Group the flat topic-mix rows into per-member counts → bar segments.
  const mixByMember = new Map<string, { topic: string; count: number }[]>();
  for (const r of topicMixRows) {
    const arr = mixByMember.get(r.bioguideId) ?? [];
    arr.push({ topic: r.topic, count: r.count });
    mixByMember.set(r.bioguideId, arr);
  }
  const segmentsFor = (bioguideId: string): TopicSegment[] =>
    buildTopicSegments(mixByMember.get(bioguideId) ?? []);

  // Resolve the scoped committee (if any).
  const committee = committeeCode
    ? await getCommitteeBySystemCode(committeeCode)
    : null;
  const scoped = committee !== null;

  // Build the member rows: full ranked list, or the scoped committee roster.
  let rows: Row[];
  let rosterTotal = 0;
  if (scoped && committee) {
    const roster: CommitteeRosterMember[] = await getCommitteeRoster(
      committee.systemCode,
      sort,
      includeCeremonial,
    );
    rosterTotal = roster.length;
    rows = roster.map((m) => ({
      ...m,
      role: m.role,
      segments: segmentsFor(m.bioguide_id),
    }));
  } else {
    const ranked = await getMembersRanked(filters, sort, 1, LIST_LIMIT);
    rows = ranked.map((m) => ({ ...m, segments: segmentsFor(m.bioguide_id) }));
  }

  const pageMax = rows.reduce((m, r) => Math.max(m, r.total), 0);

  // Expanded member + its panel data (must be in the rendered set).
  const expandedMember = expandedParam
    ? rows.find((r) => r.bioguide_id === expandedParam)
    : undefined;
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

  // Member → rail marking: the systemCodes the expanded member sits on, marked
  // in the rail; the `· ● on N` header count = those that appear in the rail.
  const memberCommitteeCodes = new Set(
    expansion?.committees.map((c) => c.systemCode) ?? [],
  );
  const onCount = railCommittees.filter((c) =>
    memberCommitteeCodes.has(c.systemCode),
  ).length;

  // Topic key strip = the union of real topics across the rendered bars (+ OTHR
  // when any row rolled up), most-common first — the legend for what's on screen.
  const keyCounts = new Map<string, number>();
  let hasOther = false;
  for (const r of rows) {
    for (const s of r.segments) {
      if (s.topic === OTHER_TOPIC) hasOther = true;
      else keyCounts.set(s.topic, (keyCounts.get(s.topic) ?? 0) + s.count);
    }
  }
  const keyTopics = [...keyCounts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([t]) => t);

  const railMax = railCommittees.reduce(
    (m, c) => Math.max(m, c.recentBillCount),
    0,
  );

  // `carry` plumbs active state through child links. committee is included for
  // row-expand + sort (which preserve scope); chamber drops it (a committee may
  // not exist in the other chamber). `filterCarry` (no committee) is handed to
  // PartyFilter/StateFilter so changing party/state returns to the full list.
  const carry = new URLSearchParams();
  if (chamber) carry.set("chamber", chamber);
  if (party) carry.set("party", party);
  if (state) carry.set("state", state);
  if (q) carry.set("q", q);
  if (sort !== "volume") carry.set("sort", sort);
  if (includeCeremonial) carry.set("ceremonial", "1");
  if (committeeCode) carry.set("committee", committeeCode);

  const filterCarry = new URLSearchParams(carry);
  filterCarry.delete("committee");

  function rowHref(bioguideId: string, isExpanded: boolean): string {
    const sp = new URLSearchParams(carry);
    if (isExpanded) sp.delete("expanded");
    else sp.set("expanded", bioguideId);
    const qs = sp.toString();
    return qs ? `/members?${qs}` : "/members";
  }

  const buildChamberHref = (value: "" | Chamber) => {
    const sp = new URLSearchParams(carry);
    sp.delete("expanded");
    sp.delete("committee");
    if (value) sp.set("chamber", value);
    else sp.delete("chamber");
    const qs = sp.toString();
    return qs ? `/members?${qs}` : "/members";
  };

  const buildSortHref = (value: "volume" | "passrate") => {
    const sp = new URLSearchParams(carry);
    sp.delete("expanded");
    if (value === "volume") sp.delete("sort");
    else sp.set("sort", value);
    const qs = sp.toString();
    return qs ? `/members?${qs}` : "/members";
  };

  const clearScopeHref = (() => {
    const sp = new URLSearchParams(carry);
    sp.delete("committee");
    sp.delete("expanded");
    const qs = sp.toString();
    return qs ? `/members?${qs}` : "/members";
  })();

  const headerFilters = { topics: [], chamber, includeCeremonial };

  // Row renderer (closes over rowHref/expansion/scoped/pageMax). Scoped rosters
  // cap at ROSTER_CAP with the rest behind a SHOW ALL disclosure.
  const expandedKey = expansion?.key ?? null;
  function renderRow(m: Row) {
    const isExpanded = expandedKey === m.bioguide_id;
    const partyColor = partyColorFor(m.party);
    const rateLabel =
      m.passrate === null ? "—" : `${Math.round(m.passrate * 100)}%`;
    const ratePct = m.passrate === null ? 0 : Math.round(m.passrate * 100);
    const badge = scoped ? roleBadge(m.role ?? null) : null;
    return (
      <li key={m.bioguide_id}>
        <Link
          href={rowHref(m.bioguide_id, isExpanded)}
          replace
          scroll={false}
          prefetch={false}
          className={`mc-row${isExpanded ? " is-expanded" : ""}`}
        >
          <span className="mc-mem">
            <span
              aria-hidden
              className="mc-caret"
              style={{
                color: isExpanded ? "var(--accent-amber)" : "var(--text-dim)",
              }}
            >
              {isExpanded ? "▾" : "▸"}
            </span>
            <span
              className="mc-mname truncate"
              title={m.name}
              style={{ color: "var(--text-primary)" }}
            >
              {m.name}
            </span>
            <span
              className="mc-brk shrink-0 tabular-nums"
              style={{ color: partyColor }}
            >
              [{m.party ?? "?"}-{m.state ?? "?"}]
            </span>
            {badge ? (
              <span className={`mc-rtag ${badge.cls} shrink-0`}>
                {badge.label}
              </span>
            ) : null}
            {m.palestineGrade && isPalestineGrade(m.palestineGrade) ? (
              <span className="shrink-0">
                <PalestineBadge
                  grade={m.palestineGrade}
                  rank={m.palestineRank}
                />
              </span>
            ) : null}
          </span>

          <MemberTopicBar bills={m.total} pageMax={pageMax} segments={m.segments} />

          <span
            className="mc-r-num tabular-nums"
            style={{
              color: ratePct > 0 ? "var(--stage-enacted)" : "var(--text-dim)",
            }}
          >
            {rateLabel}
          </span>
          <span
            className="mc-r-num tabular-nums"
            style={{
              color: m.enacted > 0 ? "var(--text-secondary)" : "var(--text-dim)",
            }}
          >
            {m.enacted} ✓
          </span>
          <span
            className="mc-r-num tabular-nums"
            style={{ color: "var(--text-primary)", fontWeight: 600 }}
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
            chamber={m.chamber}
            stats={expansion.stats}
            topics={expansion.topics}
            recentBills={expansion.recentBills}
            committees={expansion.committees}
            affiliations={expansion.affiliations}
            palestineGrade={m.palestineGrade}
            palestineRank={m.palestineRank}
            palestineScore={m.palestineScore}
            includeCeremonial={includeCeremonial}
            committeeCap={Number.POSITIVE_INFINITY}
          />
        ) : null}
      </li>
    );
  }

  const head = scoped ? rows.slice(0, ROSTER_CAP) : rows;
  const tail = scoped ? rows.slice(ROSTER_CAP) : [];
  const tailHasExpanded =
    expandedKey !== null && tail.some((r) => r.bioguide_id === expandedKey);

  return (
    <div className="flex min-h-screen flex-col">
      <HeaderBar feedFilters={headerFilters} basePath="/members" pageOwnsControls />

      <main className="w-full flex-1 px-4 py-4">
        <GroupTabs group="members" active="members" />

        {/* ---- Filter bar (full-width strip; connects to the pane) ---- */}
        <div className="mc-fbar">
          <span className="mc-fbar-title">MEMBERS</span>
          <span className="mc-fbar-count">
            {total.toLocaleString()} of the 119th
          </span>
          <span className="mc-fbar-spacer" />
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
          <PartyFilter current={party} carry={filterCarry} basePath="/members" />
          <StateFilter
            current={state}
            carry={filterCarry}
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
          <CeremonialToggle checked={includeCeremonial} />
          <div className="mc-fbar-search">
            <SearchBox basePath="/members" placeholder="search members..." />
          </div>
        </div>

        {/* ---- Two-pane browser ---- */}
        <div className="mc-pane">
          {/* LEFT RAIL — committee index */}
          <div className="mc-rail">
            <div className="mc-rail-h">
              <span>
                COMMITTEES · {railCommittees.length}
                {expansion && onCount > 0 ? (
                  <span className="mc-rail-on"> · ● on {onCount}</span>
                ) : null}
              </span>
              {upcoming.length > 0 ? (
                <span className="mc-rail-upcoming">◷ {upcoming.length} THIS WEEK</span>
              ) : (
                <span>MEMBERS</span>
              )}
            </div>

            {upcoming.length > 0 ? (
              <div className="mc-upgrp">
                <div className="mc-upgrp-h">UPCOMING HEARINGS</div>
                {upcoming.map((u) => (
                  <Link
                    key={u.systemCode}
                    href={`/committee/${u.systemCode}`}
                    className="mc-uprow"
                  >
                    <div className="mc-uprow-top">
                      <span className="mc-uprow-glyph" aria-hidden>
                        ◷
                      </span>
                      <span className="mc-uprow-ch">{u.chamberTag}</span>
                      <span className="mc-uprow-name">{u.committeeName}</span>
                    </div>
                    <div className="mc-uprow-sub">
                      {u.title}
                      <span className="mc-uprow-when"> · {u.when}</span>
                    </div>
                  </Link>
                ))}
              </div>
            ) : null}

            {railCommittees.map((c) => (
              <CommitteeRailRow
                key={c.systemCode}
                systemCode={c.systemCode}
                name={c.name}
                chamberTag={chamberTag(c.chamber)}
                memberCount={c.memberCount}
                activityPct={railMax > 0 ? (c.recentBillCount / railMax) * 100 : 0}
                selected={committee?.systemCode === c.systemCode}
                onMarker={memberCommitteeCodes.has(c.systemCode)}
              />
            ))}
          </div>

          {/* RIGHT PANE — member content */}
          <div className="mc-content">
            {/* Topic key strip */}
            <div className="mc-keystrip">
              <span className="mc-keystrip-label">TOPICS</span>
              {keyTopics.map((t) => (
                <span key={t} className="mc-key" title={topicFullLabel(t)}>
                  <span
                    className="mc-key-sw"
                    style={{ backgroundColor: topicColor(t) }}
                    aria-hidden
                  />
                  <span style={{ color: topicColor(t) }}>{topicLabel(t)}</span>
                </span>
              ))}
              {hasOther ? (
                <span className="mc-key" title="Other topics">
                  <span
                    className="mc-key-sw"
                    style={{ backgroundColor: "var(--text-dim)" }}
                    aria-hidden
                  />
                  <span style={{ color: "var(--text-dim)" }}>OTHR</span>
                </span>
              ) : null}
            </div>

            {/* Context header (scoped only) */}
            {scoped && committee ? (
              <div className="mc-ctx">
                <span className="mc-ctx-ch">{chamberTag(committee.chamber)}</span>
                <span className="mc-ctx-name">{committee.name}</span>
                <span className="mc-ctx-count">· {rosterTotal} members</span>
                <span className="mc-ctx-spacer" />
                <Link href={`/committee/${committee.systemCode}`} className="mc-ctx-lnk">
                  committee detail →
                </Link>
                <Link href={clearScopeHref} className="mc-ctx-clr">
                  × all members
                </Link>
              </div>
            ) : null}

            {/* Column header */}
            <div className="mc-row mc-row-hdr">
              <span>MEMBER</span>
              <span>BILLS · TOPIC MIX</span>
              <span className="mc-r-num">RATE</span>
              <span className="mc-r-num">ENACT</span>
              <span className="mc-r-num">BILLS</span>
            </div>

            {rows.length === 0 ? (
              <div className="mc-empty">No members match</div>
            ) : (
              <ol>
                {head.map(renderRow)}
                {tail.length > 0 ? (
                  <RosterShowAll
                    total={rows.length}
                    more={tail.length}
                    defaultOpen={tailHasExpanded}
                  >
                    {tail.map(renderRow)}
                  </RosterShowAll>
                ) : null}
              </ol>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}

// --- UPCOMING HEARINGS rail group (HO 328, premise-3 fallback) -------------
// Schedule-derived, NOT live: real scheduled starts (~2 weeks ahead) grouped by
// committee, soonest per committee, this week. No fabricated "in session now".
async function getUpcomingForRail(chamber: Chamber | undefined): Promise<
  {
    systemCode: string;
    committeeName: string;
    chamberTag: string;
    title: string;
    when: string;
  }[]
> {
  const [meetings, committeesAll] = await Promise.all([
    getUpcomingMeetings({ days: 7, chamber }),
    getCommitteesIndex(),
  ]);
  const nameByCode = new Map(committeesAll.map((c) => [c.systemCode, c.name]));
  const seen = new Set<string>();
  const out: {
    systemCode: string;
    committeeName: string;
    chamberTag: string;
    title: string;
    when: string;
  }[] = [];
  for (const m of meetings) {
    const code = m.committeeSystemCode;
    if (!code || seen.has(code)) continue;
    const name = nameByCode.get(code);
    if (!name) continue; // unresolvable committee — skip rather than show a blank
    seen.add(code);
    out.push({
      systemCode: code,
      committeeName: name,
      chamberTag: m.chamber === "house" ? "HSE" : "SEN",
      title: cleanMeetingTitle(m.title),
      when: `${etDayLabel(m.meetingDate)} ${etTimeLabel(m.meetingDate)}`.trim(),
    });
    if (out.length >= 6) break;
  }
  return out;
}
