import Link from "next/link";
import { HeaderBar } from "@/components/HeaderBar";
import { formatWeekTitle } from "@/lib/report-generation";
import { getReportsList } from "@/lib/queries";

// Reads the DB; opt out of static prerender. unstable_cache still applies.
export const dynamic = "force-dynamic";

// Label for the empty-state line: the next Monday strictly after today.
function nextMondayLabel(): string {
  const d = new Date();
  const daysUntilMonday = (8 - d.getUTCDay()) % 7 || 7;
  d.setUTCDate(d.getUTCDate() + daysUntilMonday);
  return formatWeekTitle(d.toISOString().slice(0, 10));
}

export default async function ReportsPage() {
  const reports = await getReportsList();

  return (
    <div className="flex min-h-screen flex-col">
      <HeaderBar />

      <main className="w-full flex-1 px-4 py-4">
        <h1
          className="mb-3 text-[14px] uppercase tracking-[0.5px]"
          style={{ color: "var(--accent-amber)" }}
        >
          Weekly Reports
        </h1>

        {reports.length === 0 ? (
          <div
            className="px-6 py-16 text-center text-[13px]"
            style={{ color: "var(--text-muted)" }}
          >
            Reports begin Monday {nextMondayLabel()}.
          </div>
        ) : (
          <div
            className="border"
            style={{ borderColor: "var(--border-strong)" }}
          >
            <ul>
              {reports.map((r) => (
                <li key={r.slug}>
                  <Link
                    href={`/reports/${r.slug}`}
                    className="flex items-center gap-4 px-4 py-3 transition hover:bg-[var(--bg-row-hover)]"
                    style={{
                      borderBottom: "0.5px solid var(--border-soft)",
                      color: "var(--text-primary)",
                    }}
                  >
                    <span className="text-[14px] uppercase tracking-[0.5px]">
                      {r.title}
                    </span>
                    <span
                      className="ml-auto text-[12px] uppercase tracking-[0.5px]"
                      style={{ color: "var(--accent-amber)" }}
                    >
                      View →
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )}
      </main>
    </div>
  );
}
