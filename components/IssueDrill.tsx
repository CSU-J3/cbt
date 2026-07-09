import type { IssueDrill as IssueDrillData } from "@/lib/queries";
import { FilingRow } from "@/components/FilingRow";
import { LobbyingMiniBars } from "@/components/LobbyingMiniBars";

// HO 437 — the /lobbying RIGHT column: the drill for the selected issue code,
// served from the precomputed rollup blob (rollup.drill[code]). Headline counts +
// TOP CLIENTS (who hired the lobbying) + TOP FIRMS (the lobbying shops) as
// party-neutral mini ranked bars, then the code's most-recent filings. Built to
// the /patterns drilldown idiom; server component, inline-styled.

export function IssueDrill({ drill }: { drill: IssueDrillData }) {
  return (
    <div>
      <header
        className="flex flex-col gap-1 px-[14px] py-[9px]"
        style={{
          backgroundColor: "var(--bg-panel)",
          borderBottom: "0.5px solid var(--border-strong)",
        }}
      >
        <div className="flex items-baseline gap-2">
          <span
            className="text-[12px] uppercase tracking-[0.5px]"
            style={{ color: "var(--accent-amber)" }}
          >
            {drill.code}
          </span>
          <span className="text-[13px] font-medium" style={{ color: "var(--text-primary)" }}>
            {drill.display}
          </span>
        </div>
        <span className="text-[12px] tabular-nums" style={{ color: "var(--text-muted)" }}>
          {drill.filings.toLocaleString()} filings ·{" "}
          {drill.activities.toLocaleString()} activities ·{" "}
          {drill.distinctClients.toLocaleString()} clients ·{" "}
          {drill.billLinked.toLocaleString()} bill-linked
        </span>
      </header>

      <LobbyingMiniBars label="Top clients" rows={drill.topClients} />
      <LobbyingMiniBars label="Top firms" rows={drill.topFirms} />

      <div style={{ borderTop: "0.5px solid var(--border-soft)" }}>
        <div
          className="px-[14px] py-2 text-[11px] uppercase tracking-[0.5px]"
          style={{ color: "var(--text-muted)" }}
        >
          Recent filings
        </div>
        {drill.recent.length > 0 ? (
          drill.recent.map((f) => <FilingRow key={f.filingUuid} filing={f} />)
        ) : (
          <div className="px-[14px] py-6 text-[12px]" style={{ color: "var(--text-dim)" }}>
            No recent filings for this issue.
          </div>
        )}
      </div>
    </div>
  );
}
