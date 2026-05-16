import Link from "next/link";
import { BillRow } from "@/components/BillRow";
import { HeaderBar } from "@/components/HeaderBar";
import { MemberAffiliations } from "@/components/MemberAffiliations";
import { MemberHeader } from "@/components/MemberHeader";
import { MemberStats } from "@/components/MemberStats";
import { StageLegend } from "@/components/StageLegend";
import { getMember, getMemberBills, getMemberStats } from "@/lib/queries";

// Reads the DB by params; opt out of static prerender. unstable_cache still
// applies at the query layer.
export const dynamic = "force-dynamic";

const BILL_LIMIT = 10;

export default async function MemberPage({
  params,
}: {
  params: Promise<{ bioguideId: string }>;
}) {
  const { bioguideId } = await params;

  const [member, stats, bills] = await Promise.all([
    getMember(bioguideId),
    getMemberStats(bioguideId),
    getMemberBills(bioguideId, BILL_LIMIT),
  ]);

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
            <MemberHeader member={member} />

            <div
              className="my-5 border-t border-b"
              style={{ borderColor: "var(--border-soft)" }}
            >
              <MemberStats stats={stats} />
            </div>

            <div className="mb-6">
              <MemberAffiliations />
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
