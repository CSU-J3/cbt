import Link from "next/link";
import { HeaderBar } from "@/components/HeaderBar";
import { ReportMarkdown } from "@/components/ReportMarkdown";
import { getReport } from "@/lib/queries";

// Reads the DB; opt out of static prerender. unstable_cache still applies.
export const dynamic = "force-dynamic";

export default async function ReportDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const report = await getReport(slug);

  return (
    <div className="flex min-h-screen flex-col">
      <HeaderBar
        basePath={`/reports/${slug}`}
        detail={report?.title ?? undefined}
      />

      <main className="w-full flex-1 px-4 py-4">
        {report ? (
          <>
            <div className="mb-4 flex items-center gap-4">
              <Link
                href="/reports"
                className="text-[12px] uppercase tracking-[0.5px] transition hover:text-[var(--text-secondary)]"
                style={{ color: "var(--text-dim)" }}
              >
                ← Back to reports
              </Link>
              <a
                href={`/reports/${report.slug}/download`}
                className="ml-auto text-[12px] uppercase tracking-[0.5px] transition hover:text-[var(--accent-amber-bright)]"
                style={{ color: "var(--accent-amber)" }}
              >
                Download .md ↓
              </a>
            </div>

            <div className="max-w-[800px]">
              <ReportMarkdown content={report.contentMd} />
            </div>
          </>
        ) : (
          <div
            className="px-6 py-16 text-center"
            style={{ color: "var(--text-muted)" }}
          >
            <p className="text-[14px] uppercase tracking-[0.5px]">
              Report not found
            </p>
            <Link
              href="/reports"
              className="mt-4 inline-block text-[12px] uppercase tracking-[0.5px] transition hover:text-[var(--accent-amber-bright)]"
              style={{ color: "var(--accent-amber)" }}
            >
              ← Back to reports
            </Link>
          </div>
        )}
      </main>
    </div>
  );
}
