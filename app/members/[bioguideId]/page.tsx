import Link from "next/link";
import { BillRowList } from "@/components/BillRowList";
import { HeaderBar } from "@/components/HeaderBar";
import { MemberFundraisingLine } from "@/components/MemberFundraisingLine";
import { MemberHeader } from "@/components/MemberHeader";
import { MemberIdeology } from "@/components/MemberIdeology";
import { MemberAmendmentRow } from "@/components/MemberAmendmentRow";
import { MemberVoteRow } from "@/components/MemberVoteRow";
import { MemberVoteStats } from "@/components/MemberVoteStats";
import { RaceNewsRow } from "@/components/RaceNewsRow";
import { RecordTabs, type RecordTab } from "@/components/RecordTabs";
import { StageLegend } from "@/components/StageLegend";
import { TradeRow } from "@/components/TradeRow";
import { currentCongressLabel, ordinal } from "@/lib/congress";
import { daysUntil, formatDateShort } from "@/lib/format";
import {
  getMember,
  getMemberAffiliations,
  getMemberAmendments,
  getMemberBills,
  getMemberCareerVotes,
  getMemberCommittees,
  getMemberFundraising,
  getMemberIdeology,
  getMemberNews,
  getMemberStats,
  getMemberTradeCount,
  getMemberTrades,
  getMemberVotes,
  getMemberVoteStats,
  getChamberParticipationContext,
  type MemberCommitteeRow,
  getPalestineScorecard,
  getPrimaryForRace,
  getRaceRatings,
  getWatchedBillIds,
} from "@/lib/queries";
import { raceIdFromMember } from "@/lib/race-id";
import { ratingColor } from "@/lib/race-colors";

// Reads the DB by params; opt out of static prerender. unstable_cache still
// applies at the query layer.
export const dynamic = "force-dynamic";

const BILL_LIMIT = 10;
const TRADE_LIMIT = 10;
const VOTE_LIMIT = 20;
const MEMBER_AMENDMENT_LIMIT = 60;

// Absorbed from the deleted MemberStats (HO 509): round to whole when the value
// is integer-ish, else one decimal; em-dash for a null.
function formatAvgCosponsors(n: number | null): string {
  if (n === null) return "—";
  const rounded = Math.round(n);
  return Math.abs(n - rounded) < 0.05 ? `${rounded}` : n.toFixed(1);
}

// HO 145: committee role → badge style. Chair / Co-Chair / Vice Chair land
// on the amber accent (the page's leadership color); Ranking Member uses a
// muted tag style to read as opposition leadership. Anything else (rank-
// and-file with NULL role, or unexpected free-text roles from the source
// YAML) returns null so no badge is rendered.
function roleBadge(
  role: string | null,
): { label: string; color: string } | null {
  if (!role) return null;
  const r = role.toLowerCase();
  if (r.includes("ranking")) {
    return { label: "RANKING", color: "var(--text-muted)" };
  }
  if (r.includes("chair")) {
    // Vice/Co/Acting all roll up into "CHAIR" badge — the role string itself
    // is shown in the row's title attribute for the exact wording.
    return { label: "CHAIR", color: "var(--accent-amber)" };
  }
  return null;
}

function CommitteeAssignmentRow({ row }: { row: MemberCommitteeRow }) {
  const badge = roleBadge(row.role);
  const isSub = row.parentSystemCode !== null;
  return (
    <li
      className="grid grid-cols-[1fr_auto] items-baseline gap-3 px-4 py-2 border-b"
      style={{ borderColor: "var(--border-soft)" }}
    >
      <span className="min-w-0">
        {isSub ? (
          <span
            className="mr-1.5 text-[length:var(--fs-12)]"
            style={{ color: "var(--text-dim)" }}
            aria-hidden
          >
            ↳
          </span>
        ) : null}
        <Link
          href={`/committee/${row.systemCode}`}
          className="text-[length:var(--fs-14)] transition hover:text-[var(--accent-amber-bright)]"
          style={{ color: "var(--text-primary)" }}
          title={row.role ?? undefined}
        >
          {row.name}
        </Link>
        <span
          className="ml-2 text-[length:var(--fs-11)] uppercase tracking-[0.5px]"
          style={{ color: "var(--text-muted)" }}
        >
          {row.chamber === "house"
            ? "HOUSE"
            : row.chamber === "senate"
              ? "SENATE"
              : "JOINT"}
          {row.committeeType ? ` · ${row.committeeType}` : ""}
          {isSub && row.parentName ? ` · ${row.parentName}` : ""}
        </span>
      </span>
      {badge ? (
        <span
          className="inline-block px-2 py-[1px] text-[length:var(--fs-11)] uppercase tracking-[0.5px]"
          style={{
            color: badge.color,
            border: `1px solid ${badge.color}`,
            borderRadius: "2px",
          }}
          title={row.role ?? undefined}
        >
          {badge.label}
        </span>
      ) : null}
    </li>
  );
}

// USCPR scorecard outcome → vote color (handoff 90). Word-boundary matching so
// "Not elected" / "Not sponsoring" — which contain the substring "no" — fall
// through to the neutral dim color rather than reading as a nay vote.
function palestineVoteColor(outcome: string): string {
  const o = outcome.toLowerCase();
  if (/\b(yes|yea)\b/.test(o)) return "var(--vote-yea)";
  if (/\b(no|nay)\b/.test(o)) return "var(--vote-nay)";
  return "var(--text-dim)";
}

export default async function MemberPage({
  params,
}: {
  params: Promise<{ bioguideId: string }>;
}) {
  const { bioguideId } = await params;
  // HO 490: one page-computed clock threaded to the sponsored-bills feed rows
  // and the race-news rows so relative-age buckets match across SSR/hydration
  // (#418). See lib/format.ts.
  const nowMs = Date.now();

  const [
    member,
    stats,
    bills,
    affiliations,
    trades,
    tradeCount,
    voteStats,
    participation,
    careerVotes,
    recentVotes,
    fundraising,
    scorecard,
    committeeAssignments,
    watchedIds,
    news,
    ideology,
    sponsoredAmendments,
  ] = await Promise.all([
    getMember(bioguideId),
    getMemberStats(bioguideId),
    getMemberBills(bioguideId, BILL_LIMIT),
    getMemberAffiliations(bioguideId),
    getMemberTrades(bioguideId, TRADE_LIMIT),
    getMemberTradeCount(bioguideId),
    getMemberVoteStats(bioguideId),
    // HO 523: 119th chamber missed-vote distribution (median) for the hero
    // "Missed X%" context — one cached all-member aggregate, args-free.
    getChamberParticipationContext(),
    // HO 525 (B2): lifetime missed-vote rate from member_career_votes; null when
    // the member has no rollup row (Graham / Voteview-missing) → no career stat.
    getMemberCareerVotes(bioguideId),
    getMemberVotes(bioguideId, { page: 1, pageSize: VOTE_LIMIT }),
    getMemberFundraising(bioguideId),
    getPalestineScorecard(bioguideId),
    getMemberCommittees(bioguideId),
    getWatchedBillIds(),
    // HO 414: observation news keyed on the member's own bioguide. The route
    // param is always a string (no open-seat/null-key case), so this always
    // runs; an unknown bioguide just returns [] → the empty state.
    getMemberNews(bioguideId, 8),
    // HO 421: DW-NOMINATE ideology; null when the member has no member_ideology
    // row → the component renders its empty state.
    getMemberIdeology(bioguideId),
    // HO 450: amendments this member sponsored (keyed on sponsor_bioguide_id);
    // null when they authored none → the tab shows (0) and its empty state.
    getMemberAmendments(bioguideId),
  ]);

  // Pull the rating for the member's upcoming race (handoff 71). The chip
  // on /race/[id] carries source attribution; here the chip is a glance
  // signal, so we just take the most recently-updated rating across sources.
  const raceId = member
    ? raceIdFromMember({
        chamber: member.chamber,
        state: member.state,
        district: member.district,
        nextElectionYear: member.nextElectionYear,
      })
    : null;
  const ratings = raceId ? await getRaceRatings(raceId) : [];
  const headerRating = ratings[0] ?? null;

  // The member's 2026 state primary (handoff 91). Only D/R members resolve a row —
  // independents don't run in a party primary (Kiley, party='I', gets no chip; correct
  // data per HO 420/422, tracked for the 587 sweep, not a bug). HO 586: a House member
  // now resolves their OWN house-{ST}-{DD} row via the district (district-first), so
  // the LA six read their Nov-3 jungle row not the May-16 senate proxy; Senate members
  // pass district=null and fall to the statewide senate proxy. `chamber` still carries
  // the ONE HO 576 decision (a Senate special is never a House member's proxy).
  const memberPrimary =
    member && member.state && (member.party === "D" || member.party === "R")
      ? await getPrimaryForRace(
          member.state,
          member.district,
          member.party,
          member.chamber === "senate" ? "senate" : "house",
        )
      : null;
  const primaryDays =
    memberPrimary?.primary_date != null
      ? daysUntil(memberPrimary.primary_date)
      : null;

  return (
    <div className="flex min-h-screen flex-col">
      <HeaderBar
        basePath={`/members/${bioguideId}`}
        detail={member?.lastName ?? undefined}
      />

      <main className="w-full flex-1 px-4 py-4">
        <Link
          href="/members"
          className="mb-4 inline-block text-[length:var(--fs-12)] uppercase tracking-[0.5px] transition hover:text-[var(--text-secondary)]"
          style={{ color: "var(--text-dim)" }}
        >
          ← Back to members
        </Link>

        {member ? (
          (() => {
            // ── band-1 stat run ── the three figures MemberStats used to show,
            // joined by votes-cast + missed pulled out of MemberVoteStats. The
            // two vote figures are suppressed entirely when there are no votes
            // (don't print "0 of 0").
            const enactedPct = (stats.enactedRate * 100).toFixed(1);
            const votesCast = voteStats.total - voteStats.notVoting;
            const missedPct =
              voteStats.total > 0
                ? Math.round((voteStats.notVoting / voteStats.total) * 100)
                : 0;

            // HO 523: chamber context for "Missed X%" — the 119th chamber median
            // beside the member's own rate. Median only in the hero: a bare
            // attendance rank misreads the ~6 non-voting delegates (structural
            // ineligibility, not absenteeism), and the median is robust to them.
            const chamberCtx =
              member.chamber === "senate"
                ? participation.senate
                : member.chamber === "house"
                  ? participation.house
                  : null;
            const chamberMedian = chamberCtx?.medianMissedPct ?? null;
            const chamberShort =
              member.chamber === "senate" ? "Sen" : "House";

            // ── band-3 SEAT ── only fields already on `member`; no "sworn"
            // clause because the record carries no swearing-in year.
            const chamberLabel =
              member.chamber === "house"
                ? "House"
                : member.chamber === "senate"
                  ? "Senate"
                  : "Congress";
            const districtSuffix =
              member.chamber === "house"
                ? member.district != null && member.district > 0
                  ? ` ${ordinal(member.district)}`
                  : member.district === 0
                    ? " At-Large"
                    : ""
                : "";
            const seatLoc = member.stateName ?? member.state;
            const seatMain = seatLoc
              ? `${chamberLabel} · ${seatLoc}${districtSuffix}`
              : chamberLabel;

            // ── band-3 cells ── empties are omitted so the grid becomes
            // 2-up / 1-up (no empty thirds).
            const band3: React.ReactNode[] = [
              <div key="seat">
                <div className="mhp-mlabel">Seat</div>
                <div className="mhp-mval">{seatMain}</div>
                <div className="mhp-msub">
                  {currentCongressLabel()} · {committeeAssignments.length}{" "}
                  committee assignment
                  {committeeAssignments.length === 1 ? "" : "s"}
                </div>
              </div>,
            ];
            if (member.nextElectionYear != null) {
              // Absorbs MemberHeader's former election-chip branch (HO 509
              // follow-up): a future year links to the seat's race when a
              // raceId resolves, a past year reads "Former member" (the old
              // cell rendered a stale "Next election 2024" here — a real bug),
              // and the primary sub-line stays on the future branch only.
              const isFutureElection =
                member.nextElectionYear >= new Date().getFullYear();
              const electionValue = (
                <>
                  {member.nextElectionYear}
                  {headerRating ? (
                    <>
                      {" · "}
                      <span style={{ color: ratingColor(headerRating.rating) }}>
                        {headerRating.rating}
                      </span>
                    </>
                  ) : null}
                </>
              );
              band3.push(
                <div key="election">
                  <div className="mhp-mlabel">Next election</div>
                  {isFutureElection ? (
                    <>
                      <div className="mhp-mval mono">
                        {raceId ? (
                          <Link
                            href={`/race/${raceId}`}
                            className="transition hover:text-[var(--accent-amber-bright)]"
                          >
                            {electionValue}
                          </Link>
                        ) : (
                          electionValue
                        )}
                      </div>
                      {memberPrimary?.primary_date ? (
                        <div
                          className="mhp-msub"
                          style={{ color: "var(--accent-amber)" }}
                        >
                          {/* HO 586: label from the RESOLVED row's party over a
                              three-value column — D→Dem, R→Rep, anything else
                              (open/jungle, I) → no party word ("Primary:"), the honest
                              all-party label. Fixing the branch, not special-casing 'open'. */}
                          Primary
                          {memberPrimary.party === "D"
                            ? " Dem"
                            : memberPrimary.party === "R"
                              ? " Rep"
                              : ""}
                          : {formatDateShort(memberPrimary.primary_date)}
                          {primaryDays !== null &&
                          primaryDays >= 0 &&
                          primaryDays <= 30 ? (
                            <span style={{ color: "var(--party-republican)" }}>
                              {" "}
                              ({primaryDays === 0 ? "today" : `${primaryDays}d`})
                            </span>
                          ) : null}
                        </div>
                      ) : null}
                    </>
                  ) : (
                    <div
                      className="mhp-mval"
                      style={{ color: "var(--text-muted)" }}
                    >
                      Former member
                    </div>
                  )}
                </div>,
              );
            }
            if (fundraising) {
              band3.push(
                <div key="fundraising">
                  <div className="mhp-mlabel">Fundraising</div>
                  <div className="mt-1">
                    <MemberFundraisingLine fundraising={fundraising} />
                  </div>
                </div>,
              );
            }

            // ── the record box tabs ── fixed order (authoring → voting →
            // assignment → coverage), most-used first; NOT count-ranked, so a
            // member page opens the same way every time.
            const tabs: RecordTab[] = [
              {
                key: "bills",
                label: "Bills",
                count: stats.billsSponsored,
                outLabel:
                  stats.billsSponsored > bills.length
                    ? `View all ${stats.billsSponsored.toLocaleString()} bills →`
                    : undefined,
                outHref:
                  stats.billsSponsored > bills.length
                    ? `/bills?sponsor=${encodeURIComponent(member.bioguideId)}`
                    : undefined,
                content: (
                  <>
                    <div className="rec-note">
                      <StageLegend bare />
                    </div>
                    {bills.length === 0 ? (
                      <div className="rec-empty">No bills sponsored</div>
                    ) : (
                      <BillRowList
                        bills={bills}
                        watchedIds={watchedIds}
                        nowMs={nowMs}
                      />
                    )}
                  </>
                ),
              },
              {
                key: "votes",
                label: "Votes",
                count: voteStats.total,
                content: (
                  <>
                    <div className="rec-note">
                      <MemberVoteStats
                        stats={voteStats}
                        chamber={member.chamber}
                      />
                    </div>
                    {recentVotes.votes.length > 0 ? (
                      <div className="px-4 py-3">
                        <div className="vote-header-row">
                          <span>Pos.</span>
                          <span>Date</span>
                          <span>Bill</span>
                          <span>Question · Result</span>
                          <span className="vote-roll">Roll</span>
                        </div>
                        <div>
                          {recentVotes.votes.map((v) => (
                            <MemberVoteRow key={v.id} vote={v} />
                          ))}
                        </div>
                      </div>
                    ) : (
                      <div className="rec-empty">
                        {member.chamber === "senate"
                          ? "No Senate votes recorded for this member yet."
                          : "No House votes recorded for this member yet."}
                      </div>
                    )}
                  </>
                ),
              },
              {
                key: "committees",
                label: "Committees",
                count: committeeAssignments.length,
                content:
                  committeeAssignments.length === 0 ? (
                    <div className="rec-empty">
                      No committee assignments on file.
                    </div>
                  ) : (
                    <ul>
                      {committeeAssignments.map((row) => (
                        <CommitteeAssignmentRow key={row.systemCode} row={row} />
                      ))}
                    </ul>
                  ),
              },
              {
                key: "amendments",
                label: "Amendments",
                count: sponsoredAmendments?.length ?? 0,
                content:
                  sponsoredAmendments && sponsoredAmendments.length > 0 ? (
                    <>
                      <div>
                        {sponsoredAmendments
                          .slice(0, MEMBER_AMENDMENT_LIMIT)
                          .map((a) => (
                            <MemberAmendmentRow key={a.id} amendment={a} />
                          ))}
                      </div>
                      {sponsoredAmendments.length > MEMBER_AMENDMENT_LIMIT ? (
                        <div
                          className="px-4 py-3 text-[length:var(--fs-11)] uppercase tracking-[0.5px]"
                          style={{ color: "var(--text-muted)" }}
                        >
                          {sponsoredAmendments.length - MEMBER_AMENDMENT_LIMIT}{" "}
                          more
                        </div>
                      ) : null}
                    </>
                  ) : (
                    <div className="rec-empty">No amendments sponsored</div>
                  ),
              },
              {
                key: "press",
                label: "Press",
                count: news.length,
                // HO 512: out-link to the /news member-scoped view. No count in
                // the label — count is the getMemberNews(…, 8) cap, not a total
                // (Bills/Trades print real totals; Press has none, and a count
                // query is out of scope). Absent when the member has no news.
                outLabel: news.length > 0 ? "View press coverage →" : undefined,
                outHref:
                  news.length > 0
                    ? `/news?member=${encodeURIComponent(member.bioguideId)}`
                    : undefined,
                content:
                  news.length > 0 ? (
                    <div>
                      {news.map((n) => (
                        <RaceNewsRow key={n.obsId} item={n} nowMs={nowMs} />
                      ))}
                    </div>
                  ) : (
                    <div className="rec-empty">
                      No recent news linked to this member.
                    </div>
                  ),
              },
              {
                key: "trades",
                label: "Trades",
                count: tradeCount,
                outLabel:
                  tradeCount > trades.length
                    ? `View all ${tradeCount.toLocaleString()} trades →`
                    : undefined,
                outHref:
                  tradeCount > trades.length
                    ? `/trades?member=${encodeURIComponent(member.bioguideId)}`
                    : undefined,
                content:
                  trades.length === 0 ? (
                    <div className="rec-empty">No disclosed trades on file</div>
                  ) : (
                    <>
                      <div className="trade-header-row px-4">
                        <span>Disclosed</span>
                        <span className="chamber-chip">Ch.</span>
                        <span>Ticker</span>
                        <span className="asset-description">Asset</span>
                        <span>Type</span>
                        <span className="amount">Amount</span>
                      </div>
                      <ul>
                        {trades.map((t) => (
                          <li key={t.id} className="px-4">
                            <TradeRow trade={t} />
                          </li>
                        ))}
                      </ul>
                    </>
                  ),
              },
            ];

            // Scorecard is the one CONDITIONAL tab — genuinely inapplicable
            // (Senate Democrats only), not merely zero. No count: it's
            // present-or-absent, not a tally.
            if (scorecard) {
              tabs.push({
                key: "scorecard",
                label: "Scorecard",
                outLabel: "via USCPR ↗",
                outHref:
                  "https://docs.google.com/spreadsheets/d/1VU1y_jSb2hanU2MrLsjRx8tujB-C--UAQ2EahaTXGUo",
                content: (
                  <div className="px-4 py-3">
                    <div className="mb-3 flex items-center gap-3">
                      <span
                        className="text-[24px] font-bold leading-none"
                        style={{ color: "var(--accent-amber-bright)" }}
                      >
                        {scorecard.grade}
                      </span>
                      <div className="flex flex-col">
                        <span
                          className="text-[length:var(--fs-12)]"
                          style={{ color: "var(--text-secondary)" }}
                        >
                          Score: {scorecard.total_score}
                        </span>
                        {scorecard.rank ? (
                          <span
                            className="text-[length:var(--fs-12)]"
                            style={{ color: "var(--text-dim)" }}
                          >
                            Rank #{scorecard.rank} of 47
                          </span>
                        ) : null}
                      </div>
                    </div>

                    <div className="flex flex-col gap-1">
                      {Object.entries(scorecard.votes).map(([label, outcome]) => (
                        <div
                          key={label}
                          className="flex items-start justify-between gap-3"
                        >
                          <span
                            className="flex-1 text-[length:var(--fs-12)]"
                            style={{ color: "var(--text-muted)" }}
                          >
                            {label}
                          </span>
                          <span
                            className="shrink-0 text-[length:var(--fs-12)]"
                            style={{ color: palestineVoteColor(outcome) }}
                          >
                            {outcome}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                ),
              });
            }

            return (
              <>
                {/* ═══ HERO — one bordered card, three bands ═══ */}
                <div className="mhp">
                  <div className="mhp-hb1">
                    <MemberHeader
                      member={member}
                      affiliations={affiliations}
                      scorecard={scorecard}
                    />
                    <div className="mhp-stats">
                      <span className="mhp-stat">
                        <span className="mhp-stat-l">Sponsored</span>
                        <span className="mhp-stat-v">
                          {stats.billsSponsored.toLocaleString()}
                        </span>
                      </span>
                      <span className="mhp-stat">
                        <span className="mhp-stat-l">Enacted</span>
                        <span className="mhp-stat-v">
                          {stats.billsEnacted}
                          {stats.billsSponsored > 0 ? (
                            <small>{enactedPct}%</small>
                          ) : null}
                        </span>
                      </span>
                      <span className="mhp-stat">
                        <span className="mhp-stat-l">Avg cosponsors</span>
                        <span className="mhp-stat-v">
                          {formatAvgCosponsors(stats.avgCosponsorCount)}
                        </span>
                      </span>
                      {voteStats.total > 0 ? (
                        <>
                          <span className="mhp-stat">
                            <span className="mhp-stat-l">Votes cast</span>
                            <span className="mhp-stat-v">
                              {votesCast.toLocaleString()}
                              <small>of {voteStats.total.toLocaleString()}</small>
                            </span>
                          </span>
                          <span className="mhp-stat">
                            <span className="mhp-stat-l">Missed · 119th</span>
                            <span className="mhp-stat-v">
                              {missedPct}
                              <small>%</small>
                              {chamberMedian != null ? (
                                <small>
                                  {" · "}
                                  {chamberShort} median{" "}
                                  {chamberMedian.toFixed(1)}%
                                </small>
                              ) : null}
                            </span>
                          </span>
                        </>
                      ) : null}
                      {/* HO 525 (B2): lifetime figure beside the 119th one.
                          Independent of the 119th guard — a member with a career
                          row but no 119th votes still shows it. Own displayed
                          rate, so no delegate carve-out (rank-only, per B1). */}
                      {careerVotes && careerVotes.missedPct != null ? (
                        <span className="mhp-stat">
                          <span className="mhp-stat-l">Missed · career</span>
                          <span className="mhp-stat-v">
                            {(careerVotes.missedPct * 100).toFixed(1)}
                            <small>%</small>
                            {careerVotes.congressesServed != null ? (
                              <small>
                                {" · "}
                                {careerVotes.congressesServed} Congress
                                {careerVotes.congressesServed === 1 ? "" : "es"}
                              </small>
                            ) : null}
                          </span>
                        </span>
                      ) : null}
                    </div>
                  </div>

                  {/* band 2: the ideology spine, promoted out of Voting record */}
                  <div className="mhp-hb2">
                    <MemberIdeology ideology={ideology} party={member.party} />
                  </div>

                  {/* band 3: the metabox unrolled sideways */}
                  <div className="mhp-hb3" data-cells={band3.length}>
                    {band3}
                  </div>
                </div>

                {/* ═══ THE RECORD BOX ═══ */}
                <RecordTabs
                  key={member.bioguideId}
                  ariaLabel="Member record"
                  tabs={tabs}
                />

                {/* ═══ FOOTER — one row ═══ */}
                <div className="mt-6 flex items-center gap-2">
                  <Link
                    href="/members"
                    className="inline-block border px-[10px] py-[5px] text-[length:var(--fs-12)] uppercase tracking-[0.5px] transition hover:text-[var(--text-secondary)]"
                    style={{
                      borderColor: "var(--border-strong)",
                      color: "var(--text-dim)",
                    }}
                  >
                    ← Back to members
                  </Link>
                  <span
                    className="ml-auto text-[length:var(--fs-11)] uppercase tracking-[0.5px]"
                    style={{ color: "var(--text-dim)" }}
                  >
                    Member data via Congress.gov · Ideology via Voteview ·
                    Fundraising via FEC
                  </span>
                </div>
              </>
            );
          })()
        ) : (
          <div
            className="px-6 py-16 text-center"
            style={{ color: "var(--text-muted)" }}
          >
            <p className="text-[length:var(--fs-14)] uppercase tracking-[0.5px]">
              Member not found
            </p>
            <p className="mt-2 text-[length:var(--fs-12)]" style={{ color: "var(--text-dim)" }}>
              bioguide_id: {bioguideId}
            </p>
            <Link
              href="/members"
              className="mt-4 inline-block text-[length:var(--fs-12)] uppercase tracking-[0.5px] transition hover:text-[var(--accent-amber-bright)]"
              style={{ color: "var(--accent-amber)" }}
            >
              ← Back to members
            </Link>
          </div>
        )}
      </main>
    </div>
  );
}
