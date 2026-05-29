// HO 153 — dashboard snapshot strip that fills the HO 150-reserved
// .home-snapshot-slot. Slim full-width pointer to the latest weekly
// report (NOT a re-synthesis of the week — the masthead prompt + lead
// already carry that). Returns null on zero reports so the slot stays
// empty without a placeholder.
import Link from "next/link";
import { getDashboardReportSnapshot } from "@/lib/queries";

export async function ReportSnapshot() {
  const snap = await getDashboardReportSnapshot();
  if (!snap) return null;
  const { latest, previousDates } = snap;
  return (
    <section className="home-snapshot" aria-label="Weekly report">
      <div className="home-snapshot-main">
        <div className="home-snapshot-left">
          <span className="home-snapshot-label">Weekly Report</span>
          <Link
            href={`/reports/${latest.slug}`}
            className="home-snapshot-date tabular-nums"
          >
            {latest.weekStart}
          </Link>
        </div>
        {latest.lead ? (
          <p className="home-snapshot-lead">{latest.lead}</p>
        ) : (
          <p className="home-snapshot-lead home-snapshot-lead--empty">
            (no lead text)
          </p>
        )}
        <Link
          href={`/reports/${latest.slug}`}
          className="home-snapshot-read"
        >
          read full →
        </Link>
      </div>
      {previousDates.length > 0 ? (
        <div className="home-snapshot-prev">
          <span className="home-snapshot-prev-label">Previous</span>
          {previousDates.map((p) => (
            <span key={p.slug} className="home-snapshot-prev-item">
              <span aria-hidden className="home-snapshot-prev-sep">
                ·
              </span>
              <Link
                href={`/reports/${p.slug}`}
                className="home-snapshot-prev-date tabular-nums"
              >
                {p.weekStart}
              </Link>
            </span>
          ))}
          <span aria-hidden className="home-snapshot-prev-sep">
            ·
          </span>
          <Link href="/reports" className="home-snapshot-prev-all">
            all →
          </Link>
        </div>
      ) : null}
    </section>
  );
}
