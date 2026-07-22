import Link from "next/link";
import type { FilingActivity, FilingSummary } from "@/lib/queries";

// HO 486 — the /lobbying expand panel: the per-activity LD-2 detail for one
// filing, rendered under its expanded row (the ?expanded= server read). Server
// component; receives the pre-fetched activities + the row's FilingSummary.
//
// Sized to the HO 485 shape probe: descriptions run p99≈1.8k / max 24.4k chars,
// so each rides in a fixed scroll box (never rendered raw); a filing carries up
// to 449 resolved bills, so per-activity chips cap at BILL_CAP + "+N more". Max
// 31 activities/filing → no sub-pagination. Description is 0% empty (probe), so
// there's no empty-state branch.

const BILL_CAP = 8;

export function FilingExpandPanel({
  activities,
  filing,
}: {
  activities: FilingActivity[];
  filing: FilingSummary;
}) {
  const amount =
    filing.income != null
      ? `income $${filing.income.toLocaleString()}`
      : filing.expenses != null
        ? `expenses $${filing.expenses.toLocaleString()}`
        : null;

  return (
    <div className="lob-exp">
      {/* Filing-level header — reg→client + period + amount (promoted from the
          collapsed row's tooltip) */}
      <div className="lob-exp-head">
        <span className="lob-exp-rc">
          <span style={{ color: "var(--text-primary)" }}>
            {filing.registrantName ?? "—"}
          </span>
          <span style={{ color: "var(--text-dim)" }}> → </span>
          <span style={{ color: "var(--text-secondary)" }}>
            {filing.clientName ?? "—"}
          </span>
        </span>
        {filing.filingPeriod ? (
          <span className="lob-exp-meta">· {filing.filingPeriod}</span>
        ) : null}
        {amount ? <span className="lob-exp-meta">· {amount}</span> : null}
      </div>

      {/* Per-activity list — [code · display] + description + resolved bills */}
      <ul className="lob-exp-acts">
        {activities.map((a) => {
          const shownBills = a.bills.slice(0, BILL_CAP);
          const extraBills = a.bills.length - shownBills.length;
          return (
            <li key={a.ordinal} className="lob-exp-act">
              <div className="lob-exp-act-h">
                {a.code ? <span className="micro-tag">{a.code}</span> : null}
                {a.display ? (
                  <span className="lob-exp-act-disp">{a.display}</span>
                ) : null}
              </div>
              <div className="lob-exp-desc">{a.description}</div>
              {shownBills.length > 0 ? (
                <div className="lob-exp-bills">
                  {shownBills.map((id) => (
                    <Link key={id} href={`/bill/${id}`} className="lob-bill-chip">
                      {id}
                    </Link>
                  ))}
                  {extraBills > 0 ? (
                    <span className="lob-exp-more">+{extraBills} more</span>
                  ) : null}
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
