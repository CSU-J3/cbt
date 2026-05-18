import Link from "next/link";
import type { ReportListItem } from "@/lib/queries";

// /reports index row (handoff 75). Grid columns: date | title | arrow.
// The handoff's stats column collapses here because the `reports` schema
// stores only slug/title/week_start/week_end/content_md/created_at — no
// numeric stats fields. Don't parse them out of the LLM-written prose.
export function ReportRow({ report }: { report: ReportListItem }) {
  return (
    <Link
      href={`/reports/${report.slug}`}
      className="report-row"
      style={{ color: "var(--text-primary)" }}
    >
      <span
        className="tabular-nums"
        style={{ color: "var(--text-muted)" }}
      >
        {report.weekStart}
      </span>
      <span className="min-w-0 truncate uppercase tracking-[0.5px]">
        {report.title}
      </span>
      <span
        className="text-right text-[12px] uppercase tracking-[0.5px]"
        style={{ color: "var(--accent-amber)" }}
      >
        View →
      </span>
    </Link>
  );
}
