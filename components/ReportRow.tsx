import Link from "next/link";
import type { ReportListItemWithLead } from "@/lib/queries";

// /reports index row (handoff 75, redesigned HO 153). Two-line shape per
// spec 6: date (amber mono ~110px) + `Weekly Report` title + `read →`
// chip on the top line; a 1-line derived lead excerpt indented under the
// title on the second line. The lead is empty when extraction yields
// nothing (rare — would mean a report with no prose between the H1 and
// the first `##`), in which case the row collapses back to the single-
// line shape.
export function ReportRow({
  report,
}: {
  report: ReportListItemWithLead;
}) {
  return (
    <Link
      href={`/reports/${report.slug}`}
      className="report-row"
      style={{ color: "var(--text-primary)" }}
    >
      <span className="report-row-date tabular-nums">
        {report.weekStart}
      </span>
      <span className="report-row-body">
        <span className="report-row-title uppercase tracking-[0.5px]">
          {report.title}
        </span>
        {report.lead ? (
          <span className="report-row-lead">{report.lead}</span>
        ) : null}
      </span>
      <span className="report-row-arrow uppercase tracking-[0.5px]">
        read →
      </span>
    </Link>
  );
}
