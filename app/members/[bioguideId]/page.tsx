import Link from "next/link";
import { BillRowList } from "@/components/BillRowList";
import { HeaderBar } from "@/components/HeaderBar";
import { MemberAffiliations } from "@/components/MemberAffiliations";
import { MemberFundraisingLine } from "@/components/MemberFundraisingLine";
import { MemberHeader } from "@/components/MemberHeader";
import { MemberStats } from "@/components/MemberStats";
import { MemberVoteRow } from "@/components/MemberVoteRow";
import { MemberVoteStats } from "@/components/MemberVoteStats";
import { RaceNewsRow } from "@/components/RaceNewsRow";
import { StageLegend } from "@/components/StageLegend";
import { TradeRow } from "@/components/TradeRow";
import { daysUntil, formatDateShort } from "@/lib/format";
import {
  getMember,
  getMemberAffiliations,
  getMemberBills,
  getMemberCommittees,
  getMemberFundraising,
  getMemberNews,
  getMemberStats,
  getMemberTradeCount,
  getMemberTrades,
  getMemberVotes,
  getMemberVoteStats,
  type MemberCommitteeRow,
  getPalestineScorecard,
  getPrimaryForRace,
  getRaceRatings,
  getWatchedBillIds,
} from "@/lib/queries";
import { raceIdFromMember } from "@/lib/race-id";

// Reads the DB by params; opt out of static prerender. unstable_cache still
// applies at the query layer.
export const dynamic = "force-dynamic";

const BILL_LIMIT = 10;
const TRADE_LIMIT = 10;
const VOTE_LIMIT = 20;

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
            className="mr-1.5 text-[12px]"
            style={{ color: "var(--text-dim)" }}
            aria-hidden
          >
            ↳
          </span>
        ) : null}
        <Link
          href={`/committee/${row.systemCode}`}
          className="text-[14px] transition hover:text-[var(--accent-amber-bright)]"
          style={{ color: "var(--text-primary)" }}
          title={row.role ?? undefined}
        >
          {row.name}
        </Link>
        <span
          className="ml-2 text-[11px] uppercase tracking-[0.5px]"
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
          className="inline-block px-2 py-[1px] text-[11px] uppercase tracking-[0.5px]"
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

  const [
    member,
    stats,
    bills,
    affiliations,
    trades,
    tradeCount,
    voteStats,
    recentVotes,
    fundraising,
    scorecard,
    committeeAssignments,
    watchedIds,
    news,
  ] = await Promise.all([
    getMember(bioguideId),
    getMemberStats(bioguideId),
    getMemberBills(bioguideId, BILL_LIMIT),
    getMemberAffiliations(bioguideId),
    getMemberTrades(bioguideId, TRADE_LIMIT),
    getMemberTradeCount(bioguideId),
    getMemberVoteStats(bioguideId),
    getMemberVotes(bioguideId, { page: 1, pageSize: VOTE_LIMIT }),
    getMemberFundraising(bioguideId),
    getPalestineScorecard(bioguideId),
    getMemberCommittees(bioguideId),
    getWatchedBillIds(),
    // HO 414: observation news keyed on the member's own bioguide. The route
    // param is always a string (no open-seat/null-key case), so this always
    // runs; an unknown bioguide just returns [] → the empty state.
    getMemberNews(bioguideId, 8),
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

  // The member's 2026 state primary (handoff 91). Only D/R members resolve a
  // row — independents don't run in a party primary. The chip shows for House
  // and Senate members alike: every state's primary date sits on the
  // senate-prefixed calendar row.
  const memberPrimary =
    member && member.state && (member.party === "D" || member.party === "R")
      ? await getPrimaryForRace(member.state, null, member.party)
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
          className="mb-4 inline-block text-[12px] uppercase tracking-[0.5px] transition hover:text-[var(--text-secondary)]"
          style={{ color: "var(--text-dim)" }}
        >
          ← Back to members
        </Link>

        {member ? (
          <>
            <MemberHeader
              member={member}
              affiliations={affiliations}
              rating={headerRating}
              scorecard={scorecard}
            />

            {memberPrimary?.primary_date ? (
              <div
                className="mt-2 text-[12px] uppercase tracking-[0.5px]"
                style={{ color: "var(--accent-amber)" }}
              >
                Primary {memberPrimary.party === "D" ? "Dem" : "Rep"}:{" "}
                {formatDateShort(memberPrimary.primary_date)}
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

            <div
              className="my-5 border-t border-b"
              style={{ borderColor: "var(--border-soft)" }}
            >
              <MemberStats stats={stats} />
            </div>

            <div className="mb-6">
              <MemberAffiliations affiliations={affiliations} />
              {fundraising ? (
                <div className="mt-3">
                  <MemberFundraisingLine fundraising={fundraising} />
                </div>
              ) : null}
            </div>

            <section
              className="border"
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
                  Sponsored bills (top {Math.min(bills.length, BILL_LIMIT)})
                </h2>
                {stats.billsSponsored > bills.length ? (
                  <Link
                    href={`/bills?sponsor=${encodeURIComponent(member.bioguideId)}`}
                    className="text-[12px] uppercase tracking-[0.5px] transition hover:text-[var(--accent-amber-bright)]"
                    style={{ color: "var(--accent-amber)" }}
                  >
                    View all {stats.billsSponsored.toLocaleString()} bills →
                  </Link>
                ) : null}
              </div>

              <StageLegend />

              {bills.length === 0 ? (
                <div
                  className="px-6 py-8 text-center text-[13px] uppercase tracking-[0.5px]"
                  style={{ color: "var(--text-dim)" }}
                >
                  No bills sponsored
                </div>
              ) : (
                <BillRowList bills={bills} watchedIds={watchedIds} />
              )}
            </section>

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
                  Committees ({committeeAssignments.length})
                </h2>
              </div>
              {committeeAssignments.length === 0 ? (
                <p
                  className="px-4 py-4 text-[12px]"
                  style={{ color: "var(--text-dim)" }}
                >
                  No committee assignments on file.
                </p>
              ) : (
                <ul>
                  {committeeAssignments.map((row) => (
                    <CommitteeAssignmentRow
                      key={row.systemCode}
                      row={row}
                    />
                  ))}
                </ul>
              )}
            </section>

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
                  Voting record
                </h2>
              </div>

              <div className="px-4 py-3">
                <MemberVoteStats stats={voteStats} chamber={member.chamber} />
              </div>

              {recentVotes.votes.length > 0 ? (
                <div className="px-4 pb-3">
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
                <div
                  className="px-6 py-8 text-center text-[13px]"
                  style={{ color: "var(--text-muted)" }}
                >
                  {member.chamber === "senate"
                    ? "No Senate votes recorded for this member yet."
                    : "No House votes recorded for this member yet."}
                </div>
              )}
            </section>

            {scorecard ? (
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
                    Palestine scorecard
                  </h2>
                  <a
                    href="https://docs.google.com/spreadsheets/d/1VU1y_jSb2hanU2MrLsjRx8tujB-C--UAQ2EahaTXGUo"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[12px] uppercase tracking-[0.5px] transition hover:text-[var(--text-secondary)]"
                    style={{ color: "var(--text-dim)" }}
                  >
                    via USCPR ↗
                  </a>
                </div>

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
                        className="text-[12px]"
                        style={{ color: "var(--text-secondary)" }}
                      >
                        Score: {scorecard.total_score}
                      </span>
                      {scorecard.rank ? (
                        <span
                          className="text-[12px]"
                          style={{ color: "var(--text-dim)" }}
                        >
                          Rank #{scorecard.rank} of 47
                        </span>
                      ) : null}
                    </div>
                  </div>

                  <div className="flex flex-col gap-1">
                    {Object.entries(scorecard.votes).map(
                      ([label, outcome]) => (
                        <div
                          key={label}
                          className="flex items-start justify-between gap-3"
                        >
                          <span
                            className="flex-1 text-[12px]"
                            style={{ color: "var(--text-muted)" }}
                          >
                            {label}
                          </span>
                          <span
                            className="shrink-0 text-[12px]"
                            style={{ color: palestineVoteColor(outcome) }}
                          >
                            {outcome}
                          </span>
                        </div>
                      ),
                    )}
                  </div>
                </div>
              </section>
            ) : null}

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
                  Recent trades · {tradeCount.toLocaleString()} disclosed
                </h2>
                {tradeCount > trades.length ? (
                  <Link
                    href={`/trades?member=${encodeURIComponent(member.bioguideId)}`}
                    className="text-[12px] uppercase tracking-[0.5px] transition hover:text-[var(--accent-amber-bright)]"
                    style={{ color: "var(--accent-amber)" }}
                  >
                    View all {tradeCount.toLocaleString()} trades →
                  </Link>
                ) : null}
              </div>

              {trades.length === 0 ? (
                <div
                  className="px-6 py-8 text-center text-[13px] uppercase tracking-[0.5px]"
                  style={{ color: "var(--text-dim)" }}
                >
                  No disclosed trades on file
                </div>
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
              )}
            </section>

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
                  News · in the press
                </h2>
              </div>
              <div className="px-4 py-2">
                {news.length > 0 ? (
                  <div>
                    {news.map((n) => (
                      <RaceNewsRow key={n.obsId} item={n} />
                    ))}
                  </div>
                ) : (
                  <p
                    className="py-2 text-[13px]"
                    style={{ color: "var(--text-muted)" }}
                  >
                    No recent news linked to this member.
                  </p>
                )}
              </div>
            </section>
          </>
        ) : (
          <div
            className="px-6 py-16 text-center"
            style={{ color: "var(--text-muted)" }}
          >
            <p className="text-[14px] uppercase tracking-[0.5px]">
              Member not found
            </p>
            <p
              className="mt-2 text-[12px]"
              style={{ color: "var(--text-dim)" }}
            >
              bioguide_id: {bioguideId}
            </p>
            <Link
              href="/members"
              className="mt-4 inline-block text-[12px] uppercase tracking-[0.5px] transition hover:text-[var(--accent-amber-bright)]"
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
