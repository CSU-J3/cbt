// HO 359 — /president is a real in-surface page (the president's-desk sub-tab),
// no longer the HO 151 redirect to /bills?stage=president. Clicking PRESIDENT in
// the feed sub-nav (Changes · President · Reports) used to dump the user onto the
// full /bills feed — sub-nav unmarked, breadcrumb under Bills, all the feed
// filter chrome — i.e. a strand. This carries the SAME masthead + sub-nav as
// /changes (its sibling) so the tab keeps you in-surface with the active tab
// marked. No new design: HeaderBar + GroupTabs + StageLegend + BillRowList.
//
// The data stays president-stage bills, oldest-at-desk first (closest to the
// 10-day veto clock) with the desk-time days-since column — the exact semantics
// the /bills?stage=president alias still applies for direct visits/power filtering.
import { BillRowList } from "@/components/BillRowList";
import { GroupTabs } from "@/components/GroupTabs";
import { HeaderBar } from "@/components/HeaderBar";
import { Pagination } from "@/components/Pagination";
import { StageLegend } from "@/components/StageLegend";
import {
  FEED_PAGE_SIZE,
  getFeedBills,
  getWatchedBillIds,
} from "@/lib/queries";

// Reads the DB + the session; opt out of static prerender (matches /reports).
export const dynamic = "force-dynamic";

export default async function PresidentPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const params = await searchParams;
  // HO 490: one page-computed clock threaded to the feed's client rows so
  // relative-age buckets match across SSR/hydration (#418). See lib/format.ts.
  const nowMs = Date.now();
  const rawPage = Number.parseInt(params.page ?? "1", 10);
  const requestedPage = Number.isFinite(rawPage) && rawPage >= 1 ? rawPage : 1;

  const feedFilters = {
    stage: "president",
    direction: "asc" as const,
  };

  const [{ bills, page: currentPage, totalPages }, watchedIds] =
    await Promise.all([
      getFeedBills(feedFilters, {
        page: requestedPage,
        pageSize: FEED_PAGE_SIZE,
      }),
      getWatchedBillIds(),
    ]);

  const carry = new URLSearchParams();

  return (
    <div className="flex min-h-screen flex-col">
      <HeaderBar basePath="/president" />

      <main className="w-full flex-1 px-4 py-4">
        <GroupTabs group="feed" active="president" />
        <p
          className="mb-3 text-[12px] uppercase tracking-[0.5px]"
          style={{ color: "var(--text-muted)" }}
        >
          on the president&apos;s desk · oldest first · racing the 10-day clock
        </p>

        <div className="border" style={{ borderColor: "var(--border-strong)" }}>
          <StageLegend />

          {bills.length === 0 ? (
            <div
              className="px-6 py-8 text-center text-[13px]"
              style={{ color: "var(--text-muted)" }}
            >
              No bills on the president&apos;s desk.
            </div>
          ) : (
            <BillRowList
              bills={bills}
              watchedIds={watchedIds}
              nowMs={nowMs}
              daysSinceMode="desk-time"
            />
          )}
        </div>

        {bills.length > 0 ? (
          <Pagination
            currentPage={currentPage}
            totalPages={totalPages}
            carry={carry}
            basePath="/president"
          />
        ) : null}
      </main>
    </div>
  );
}
