import Link from "next/link";
import type { BillDrill } from "@/lib/queries";
import { FilingRow } from "@/components/FilingRow";
import { LobbyingMiniBars } from "@/components/LobbyingMiniBars";

// HO 440 — the /bill/[id] LOBBYING section body. Mirrors the /lobbying per-issue
// drill (IssueDrill) scoped to one bill: TOP CLIENTS / TOP FIRMS ranked bars
// (distinct filings), the bill's most-recent filings, and an out to the full
// /lobbying surface. Firms/clients are plain text (no lobbying-org hubs exist to
// link — same as /lobbying). Server component. Fed by getBillLobbying; the page
// omits the whole section when that returns null.
//
// HO 507: the top stat line ("N filings · M clients") moved UP into the
// section-shell header on /bill/[id] (it duplicated the shell's count), so this
// component no longer renders it — the `see all lobbying →` foot survives.
export function BillLobbying({ drill }: { drill: BillDrill }) {
  // HO 590: server clock, passed to each FilingRow so its "Nd ago" age is identical
  // on SSR and hydration (no render-time Date.now() drift).
  const nowMs = Date.now();
  return (
    <div className="border" style={{ borderColor: "var(--border-strong)" }}>
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
          <FilingRow key={f.filingUuid} filing={f} nowMs={nowMs} />
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
