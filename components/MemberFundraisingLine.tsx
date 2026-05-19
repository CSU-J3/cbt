// One-liner fundraising chip on the member hub (handoff 83). FEC numbers
// are stored in cents on member_fundraising; we keep them in cent space
// until render and let lib/format::formatDollarsCompact divide.
//
// Visible only when the member has a fundraising row for any cycle. If
// FEC never resolved (or the member doesn't file in the active cycle),
// the row is absent and this component returns null — no "no data" copy,
// no broken UI, just an empty space the affiliations row absorbs.
import { formatDollarsCompact } from "@/lib/format";
import type { MemberFundraising } from "@/lib/queries";

export function MemberFundraisingLine({
  fundraising,
}: {
  fundraising: MemberFundraising | null;
}) {
  if (!fundraising) return null;
  const raised = fundraising.totalRaised ?? 0;
  const coh = fundraising.cashOnHand ?? 0;
  return (
    <div
      className="text-[12px] uppercase tracking-[0.5px] tabular-nums"
      style={{ color: "var(--text-dim)" }}
    >
      <span style={{ color: "var(--text-muted)" }}>
        {fundraising.cycle} fundraising
      </span>
      {" · "}
      <span style={{ color: "var(--text-secondary)" }}>
        {formatDollarsCompact(raised)} raised
      </span>
      {" · "}
      <span style={{ color: "var(--text-secondary)" }}>
        {formatDollarsCompact(coh)} cash on hand
      </span>
      {fundraising.coverageEndDate ? (
        <span> · as of {fundraising.coverageEndDate}</span>
      ) : null}
      {fundraising.sourceUrl ? (
        <>
          {" · "}
          <a
            href={fundraising.sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="transition hover:text-[var(--accent-amber-bright)]"
            style={{ color: "var(--accent-amber)" }}
          >
            FEC ↗
          </a>
        </>
      ) : null}
    </div>
  );
}
