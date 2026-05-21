import Link from "next/link";
import { HeaderBar } from "@/components/HeaderBar";
import { LawsEnactedComparison } from "@/components/LawsEnactedComparison";
import { ReportRow } from "@/components/ReportRow";
import { formatWeekTitle } from "@/lib/report-generation";
import { getReportCount, getReports } from "@/lib/queries";

// Reads the DB; opt out of static prerender. unstable_cache still applies.
export const dynamic = "force-dynamic";

const PAGE_SIZE = 20;

// Empty-state hint: the next Monday strictly after today, formatted via
// the same helper the report header uses.
function nextMondayLabel(): string {
  const d = new Date();
  const daysUntilMonday = (8 - d.getUTCDay()) % 7 || 7;
  d.setUTCDate(d.getUTCDate() + daysUntilMonday);
  return formatWeekTitle(d.toISOString().slice(0, 10));
}

function parsePage(raw: string | undefined): number {
  const n = Number(raw);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 1;
}

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const sp = await searchParams;
  const page = parsePage(sp.page);
  const offset = (page - 1) * PAGE_SIZE;

  const [count, reports] = await Promise.all([
    getReportCount(),
    getReports(PAGE_SIZE, offset),
  ]);

  const totalPages = Math.max(1, Math.ceil(count / PAGE_SIZE));
  const showPagination = count > PAGE_SIZE;
  const prevHref = page > 1 ? `/reports?page=${page - 1}` : null;
  const nextHref = page < totalPages ? `/reports?page=${page + 1}` : null;

  return (
    <div className="flex min-h-screen flex-col">
      <HeaderBar
        basePath="/reports"
        pageTitle="Weekly Reports"
        pageCount={count}
        pageCountLabel={count === 1 ? "report" : "reports"}
      />

      <main className="w-full flex-1 px-4 py-4">
        <section
          className="mb-4 border"
          style={{ borderColor: "var(--border-strong)" }}
        >
          <div
            className="flex items-baseline justify-between px-4 py-2"
            style={{
              backgroundColor: "var(--bg-panel)",
              borderBottom: "0.5px solid var(--border-strong)",
            }}
          >
            <p
              className="text-[12px] uppercase tracking-[0.5px]"
              style={{ color: "var(--accent-amber)" }}
            >
              Productivity vs. the 118th
            </p>
            <p
              className="text-[11px] uppercase tracking-[0.5px]"
              style={{ color: "var(--text-dim)" }}
            >
              Laws enacted · cumulative
            </p>
          </div>
          <div className="px-4 py-4">
            <LawsEnactedComparison />
          </div>
        </section>

        {count === 0 ? (
          <div
            className="px-6 py-16 text-center text-[13px]"
            style={{ color: "var(--text-muted)" }}
          >
            Reports begin Monday {nextMondayLabel()}.
          </div>
        ) : (
          <>
            <div
              className="border"
              style={{ borderColor: "var(--border-strong)" }}
            >
              <div
                className="report-header-row"
                style={{
                  backgroundColor: "var(--bg-panel)",
                  borderBottom: "0.5px solid var(--border-strong)",
                  color: "var(--text-dim)",
                }}
              >
                <span>Week</span>
                <span>Report</span>
                <span aria-hidden></span>
              </div>
              {reports.map((r) => (
                <ReportRow key={r.slug} report={r} />
              ))}
            </div>

            {showPagination ? (
              <div
                className="mt-4 flex items-center justify-between text-[12px] uppercase tracking-[0.5px]"
                style={{ color: "var(--text-dim)" }}
              >
                {prevHref ? (
                  <Link
                    href={prevHref}
                    className="transition hover:text-[var(--accent-amber-bright)]"
                    style={{ color: "var(--accent-amber)" }}
                  >
                    ← Previous
                  </Link>
                ) : (
                  <span></span>
                )}
                <span>
                  Page {page} of {totalPages}
                </span>
                {nextHref ? (
                  <Link
                    href={nextHref}
                    className="transition hover:text-[var(--accent-amber-bright)]"
                    style={{ color: "var(--accent-amber)" }}
                  >
                    Next →
                  </Link>
                ) : (
                  <span></span>
                )}
              </div>
            ) : null}
          </>
        )}
      </main>
    </div>
  );
}
