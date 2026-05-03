import { WatchlistToggle } from "@/components/WatchlistToggle";
import { congressGovUrl, formatDateLong } from "@/lib/format";
import type { FeedBill } from "@/lib/queries";

const labelStyle: React.CSSProperties = {
  color: "var(--text-dim)",
  letterSpacing: "0.5px",
};

export function ExpandedPanel({
  bill,
  onWatchlist,
  introducedDate,
}: {
  bill: FeedBill;
  onWatchlist: boolean;
  introducedDate: string | null;
}) {
  const url = congressGovUrl(bill.congress, bill.bill_type, bill.bill_number);
  return (
    <div className="expanded-panel">
      <dl className="grid grid-cols-[110px_1fr] gap-y-1 text-[11px]">
        {introducedDate ? (
          <>
            <dt className="text-[10px] uppercase" style={labelStyle}>
              Introduced
            </dt>
            <dd style={{ color: "var(--text-secondary)" }}>
              {formatDateLong(introducedDate)}
            </dd>
          </>
        ) : null}
        {bill.latest_action_date || bill.latest_action_text ? (
          <>
            <dt className="text-[10px] uppercase" style={labelStyle}>
              Last action
            </dt>
            <dd style={{ color: "var(--text-secondary)" }}>
              {bill.latest_action_date
                ? formatDateLong(bill.latest_action_date)
                : null}
              {bill.latest_action_date && bill.latest_action_text ? (
                <span style={{ color: "var(--text-dim)" }}> · </span>
              ) : null}
              {bill.latest_action_text ? (
                <span style={{ color: "var(--text-muted)" }}>
                  {bill.latest_action_text}
                </span>
              ) : null}
            </dd>
          </>
        ) : null}
      </dl>

      {bill.summary ? (
        <div className="mt-3">
          <div
            className="text-[10px] uppercase tracking-[0.5px]"
            style={labelStyle}
          >
            Summary
          </div>
          <p
            className="mt-1 text-xs leading-[1.6]"
            style={{ color: "var(--text-secondary)" }}
          >
            {bill.summary}
          </p>
        </div>
      ) : null}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <WatchlistToggle billId={bill.id} initial={onWatchlist} />
        <a
          href={`/bill/${bill.id}`}
          className="border px-2.5 py-1 text-[10px] font-medium uppercase tracking-[0.5px] transition hover:border-[var(--text-secondary)] hover:text-[var(--text-secondary)]"
          style={{
            color: "var(--text-dim)",
            borderColor: "var(--border-strong)",
          }}
        >
          View detail ↗
        </a>
        <a
          href={url}
          target="_blank"
          rel="noreferrer"
          className="border px-2.5 py-1 text-[10px] font-medium uppercase tracking-[0.5px] transition hover:border-[var(--text-secondary)] hover:text-[var(--text-secondary)]"
          style={{
            color: "var(--text-dim)",
            borderColor: "var(--border-strong)",
          }}
        >
          Congress.gov ↗
        </a>
      </div>
    </div>
  );
}
