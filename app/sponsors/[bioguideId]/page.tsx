import Link from "next/link";
import { BillRow } from "@/components/BillRow";
import { HeaderBar } from "@/components/HeaderBar";
import { MemberAffiliations } from "@/components/MemberAffiliations";
import { MemberHeader } from "@/components/MemberHeader";
import { MemberStats } from "@/components/MemberStats";
import { MemberVoteRow } from "@/components/MemberVoteRow";
import { MemberVoteStats } from "@/components/MemberVoteStats";
import { StageLegend } from "@/components/StageLegend";
import { TradeRow } from "@/components/TradeRow";
import {
  getMember,
  getMemberAffiliations,
  getMemberBills,
  getMemberStats,
  getMemberTradeCount,
  getMemberTrades,
  getMemberVotes,
  getMemberVoteStats,
  getRaceRatings,
} from "@/lib/queries";
import { raceIdFromMember } from "@/lib/race-id";

// Reads the DB by params; opt out of static prerender. unstable_cache still
// applies at the query layer.
export const dynamic = "force-dynamic";

const BILL_LIMIT = 10;
const TRADE_LIMIT = 10;
const VOTE_LIMIT = 20;

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
  ] = await Promise.all([
    getMember(bioguideId),
    getMemberStats(bioguideId),
    getMemberBills(bioguideId, BILL_LIMIT),
    getMemberAffiliations(bioguideId),
    getMemberTrades(bioguideId, TRADE_LIMIT),
    getMemberTradeCount(bioguideId),
    getMemberVoteStats(bioguideId),
    getMemberVotes(bioguideId, { page: 1, pageSize: VOTE_LIMIT }),
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

  return (
    <div className="flex min-h-screen flex-col">
      <HeaderBar />

      <main className="w-full flex-1 px-4 py-4">
        <Link
          href="/sponsors"
          className="mb-4 inline-block text-[12px] uppercase tracking-[0.5px] transition hover:text-[var(--text-secondary)]"
          style={{ color: "var(--text-dim)" }}
        >
          ← Back to sponsors
        </Link>

        {member ? (
          <>
            <MemberHeader
              member={member}
              affiliations={affiliations}
              rating={headerRating}
            />

            <div
              className="my-5 border-t border-b"
              style={{ borderColor: "var(--border-soft)" }}
            >
              <MemberStats stats={stats} />
            </div>

            <div className="mb-6">
              <MemberAffiliations affiliations={affiliations} />
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
                    href={`/feed?sponsor=${encodeURIComponent(member.bioguideId)}`}
                    className="text-[12px] uppercase tracking-[0.5px] transition hover:text-[var(--accent-amber-bright)]"
                    style={{ color: "var(--accent-amber)" }}
                  >
                    View all {stats.billsSponsored.toLocaleString()} bills →
                  </Link>
                ) : null}
              </div>

              <StageLegend />

              <div className="feed-header-row">
                <span aria-hidden></span>
                <span>Bill</span>
                <span>Title / Sponsor</span>
                <span>Stage</span>
                <span className="col-date">Action</span>
                <span>Topics</span>
              </div>

              {bills.length === 0 ? (
                <div
                  className="px-6 py-8 text-center text-[13px] uppercase tracking-[0.5px]"
                  style={{ color: "var(--text-dim)" }}
                >
                  No bills sponsored
                </div>
              ) : (
                <ul>
                  {bills.map((b) => (
                    <BillRow
                      key={b.id}
                      bill={b}
                      filters={{ topics: [], stage: undefined }}
                      basePath="/feed"
                      expandedId={undefined}
                      onWatchlist={false}
                      introducedDate={b.introduced_date}
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
                    ? "Senate voting records sync ships next. Check back soon."
                    : "No House votes recorded for this member yet."}
                </div>
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
                  Recent trades · {tradeCount.toLocaleString()} disclosed
                </h2>
                {tradeCount > trades.length ? (
                  <span
                    className="text-[12px] uppercase tracking-[0.5px]"
                    style={{ color: "var(--text-dim)" }}
                  >
                    View all {tradeCount.toLocaleString()} trades →
                  </span>
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
              href="/sponsors"
              className="mt-4 inline-block text-[12px] uppercase tracking-[0.5px] transition hover:text-[var(--accent-amber-bright)]"
              style={{ color: "var(--accent-amber)" }}
            >
              ← Back to sponsors
            </Link>
          </div>
        )}
      </main>
    </div>
  );
}
