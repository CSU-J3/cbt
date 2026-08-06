import Link from "next/link";
import { searchReports } from "@/lib/queries";

export async function SearchResultsReports({ q }: { q: string }) {
  const reports = await searchReports(q);

  return (
    <ul className="search-results-reports">
      {reports.map((r) => (
        <li key={r.slug}>
          <Link
            href={`/reports/${encodeURIComponent(r.slug)}`}
            className="report-search-row"
          >
            <span
              className="report-search-week text-[length:var(--fs-12)] tabular-nums"
              style={{ color: "var(--text-dim)" }}
            >
              {r.week_start}
            </span>
            <span className="report-search-body">
              <span
                className="block text-[length:var(--fs-14)] font-medium"
                style={{ color: "var(--text-primary)" }}
              >
                {r.title}
              </span>
              <span
                className="block truncate text-[length:var(--fs-12)]"
                style={{ color: "var(--text-muted)" }}
              >
                {r.snippet}
              </span>
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
