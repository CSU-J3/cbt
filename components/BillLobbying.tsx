import Link from "next/link";
import type { BillDrill } from "@/lib/queries";
import { FilingRow } from "@/components/FilingRow";
import { LobbyingMiniBars } from "@/components/LobbyingMiniBars";

// HO 440 — the /bill/[id] LOBBYING section body. Mirrors the /lobbying per-issue
// drill (IssueDrill) scoped to one bill: a stat line, TOP CLIENTS / TOP FIRMS
// ranked bars (distinct filings), the bill's most-recent filings, and an out to
// the full /lobbying surface. Firms/clients are plain text (no lobbying-org hubs
// exist to link — same as /lobbying). Server component. Fed by getBillLobbying;
// the page omits the whole section when that returns null.
export function BillLobbying({ drill }: { drill: BillDrill }) {
  return (
    <div className="border" style={{ borderColor: "var(--border-strong)" }}>
      <div
        className="px-[14px] py-[9px] text-[12px] tabular-nums"
        style={{
          color: "var(--text-muted)",
          borderBottom: "0.5px solid var(--border-strong)",
        }}
      >
        {drill.distinctFilings.toLocaleString()} filings ·{" "}
        {drill.distinctClients.toLocaleString()} clients
      </div>

      <LobbyingMiniBars label="Top clients" rows={drill.topClients} />
      <LobbyingMiniBars label="Top firms" rows={drill.topFirms} />

      <div style={{ borderTop: "0.5px solid var(--border-soft)" }}>
        <div
          className="px-[14px] py-2 text-[11px] uppercase tracking-[0.5px]"
          style={{ color: "var(--text-muted)" }}
        >
          Recent filings
        </div>
        {drill.recent.map((f) => (
          <FilingRow key={f.filingUuid} filing={f} />
        ))}
      </div>

      <div className="hearings-embed-foot">
        <Link href="/lobbying" className="hearings-embed-link">
          see all lobbying →
        </Link>
      </div>
    </div>
  );
}
