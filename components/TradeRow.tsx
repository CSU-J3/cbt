import { formatDateShort } from "@/lib/format";
import type { StockTrade } from "@/lib/queries";

// FMP's transaction_type strings are filing-flavored. Bucket into three
// visual buckets here rather than scattering the regex across the row.
function txnClass(raw: string | null): "buy" | "sell" | "other" {
  if (!raw) return "other";
  const lower = raw.toLowerCase();
  if (lower.includes("purchase") || lower.includes("buy")) return "buy";
  if (lower.includes("sale") || lower.includes("sell")) return "sell";
  return "other";
}

// `owner` is shown only when it isn't the member themselves. SELF goes
// implicit so the row stays quiet on the common case.
function ownerLabel(raw: string | null): string | null {
  if (!raw) return null;
  const lower = raw.toLowerCase();
  if (lower === "self" || lower === "owner") return null;
  return raw.toUpperCase();
}

export function TradeRow({ trade }: { trade: StockTrade }) {
  const klass = txnClass(trade.transactionType);
  const txnClassName =
    klass === "buy" ? "txn-buy" : klass === "sell" ? "txn-sell" : "txn-other";
  const owner = ownerLabel(trade.owner);
  const chamberChip = trade.chamber === "senate" ? "SEN" : "HOU";

  return (
    <div className="trade-row">
      <span
        className="tabular-nums"
        style={{ color: "var(--text-secondary)" }}
      >
        {formatDateShort(trade.disclosureDate)}
      </span>
      <span
        className="chamber-chip text-[11px] uppercase tracking-[0.5px]"
        style={{ color: "var(--text-muted)" }}
      >
        {chamberChip}
      </span>
      <span className="ticker" style={{ color: "var(--text-primary)" }}>
        {trade.ticker && trade.ticker.toUpperCase() !== "N/A"
          ? trade.ticker.toUpperCase()
          : "—"}
      </span>
      <span
        className="asset-description truncate"
        style={{ color: "var(--text-secondary)" }}
      >
        {trade.assetDescription ?? "—"}
        {owner ? <span className="owner-chip">[{owner}]</span> : null}
      </span>
      <span
        className={`${txnClassName} uppercase tracking-[0.5px]`}
      >
        {trade.transactionType ?? "—"}
      </span>
      <span className="amount">{trade.amount ?? "—"}</span>
    </div>
  );
}
