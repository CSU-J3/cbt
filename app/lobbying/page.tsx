import { FilingRow } from "@/components/FilingRow";
import { HeaderBar } from "@/components/HeaderBar";
import { IssueBars } from "@/components/IssueBars";
import { IssueDrill } from "@/components/IssueDrill";
import { Pagination } from "@/components/Pagination";
import {
  getLobbyingRollup,
  getRecentFilings,
  sanitizeIssueCode,
} from "@/lib/queries";

// Reads the DB (rollup blob + live feed); opt out of static prerender.
export const dynamic = "force-dynamic";

const PAGE_SIZE = 25;

type SearchParams = { issue?: string; page?: string };

function parsePage(raw: string | undefined): number {
  const n = Number(raw);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 1;
}

export default async function LobbyingPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const page = parsePage(params.page);

  const [rollup, feed] = await Promise.all([
    getLobbyingRollup(),
    getRecentFilings({ page, pageSize: PAGE_SIZE }),
  ]);

  // The rollup blob is precomputed by the LDA cron / `npm run lda:rollup`. Before
  // the first rollup lands it's null — render an honest empty state.
  if (!rollup || rollup.issues.length === 0) {
    return (
      <div className="flex min-h-screen flex-col">
        <HeaderBar basePath="/lobbying" />
        <main className="w-full flex-1 px-4 py-4">
          <h1
            className="text-[14px] uppercase tracking-[0.5px]"
            style={{ color: "var(--accent-amber)" }}
          >
            Lobbying
          </h1>
          <p className="mt-6 text-[13px]" style={{ color: "var(--text-dim)" }}>
            Lobbying data is being prepared. Check back shortly.
          </p>
        </main>
      </div>
    );
  }

  const { stats, issues, drill } = rollup;
  const selected = sanitizeIssueCode(params.issue) ?? issues[0]?.code ?? null;
  const selectedDrill = selected ? (drill[selected] ?? null) : null;

  const totalPages = Math.max(1, Math.ceil(stats.filings / PAGE_SIZE));
  const billLinkedPct = stats.billLinkedPct.toFixed(1);

  return (
    <div className="flex min-h-screen flex-col">
      <HeaderBar basePath="/lobbying" />

      <main className="w-full flex-1 px-4 py-4">
        {/* Section 1 — readout + blurb */}
        <div className="mb-3 flex flex-wrap items-baseline gap-3">
          <h1
            className="text-[14px] uppercase tracking-[0.5px]"
            style={{ color: "var(--accent-amber)" }}
          >
            Lobbying
          </h1>
          <span
            className="text-[12px] uppercase tracking-[0.5px] tabular-nums"
            style={{ color: "var(--text-muted)" }}
          >
            {stats.filings.toLocaleString()} filings ·{" "}
            {stats.activities.toLocaleString()} activities ·{" "}
            {stats.registrants.toLocaleString()} registrants ·{" "}
            {stats.clients.toLocaleString()} clients · {billLinkedPct}% name a
            tracked bill
          </span>
        </div>
        <p
          className="mb-4 max-w-[70ch] text-[12px] leading-snug"
          style={{ color: "var(--text-muted)", fontFamily: "var(--sans)" }}
        >
          Who&rsquo;s paying to move what. LD-2 quarterly lobbying reports for the
          119th, bucketed by issue area. The bill link is an overlay: only about 1
          in 4 filings names a numbered bill, so the issue area is the spine.
        </p>

        {/* Section 2 — two-column: issue bars (left) · selected-issue drill (right) */}
        <div className="patterns-layout">
          <div className="patterns-left">
            <IssueBars issues={issues} selected={selected} />
          </div>
          <aside className="patterns-right">
            {selectedDrill ? (
              <IssueDrill drill={selectedDrill} />
            ) : (
              <div
                className="px-[14px] py-6 text-[12px]"
                style={{ color: "var(--text-dim)" }}
              >
                Select an issue to see who&rsquo;s lobbying it.
              </div>
            )}
          </aside>
        </div>

        {/* Section 3 — corpus-wide recent filings (the daily pulse) */}
        <section className="mt-6">
          <h2
            className="mb-2 text-[12px] uppercase tracking-[0.5px]"
            style={{ color: "var(--text-secondary)" }}
          >
            Recent filings · across all issues
          </h2>
          <div className="border" style={{ borderColor: "var(--border-strong)" }}>
            {feed.items.length > 0 ? (
              feed.items.map((f) => <FilingRow key={f.filingUuid} filing={f} />)
            ) : (
              <div
                className="px-4 py-12 text-center text-[13px] uppercase tracking-[0.5px]"
                style={{ color: "var(--text-dim)" }}
              >
                No filings on file
              </div>
            )}
          </div>
          {totalPages > 1 ? (
            <Pagination
              currentPage={feed.page}
              totalPages={totalPages}
              carry={new URLSearchParams()}
              basePath="/lobbying"
            />
          ) : null}
        </section>
      </main>
    </div>
  );
}
