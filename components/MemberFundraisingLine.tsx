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

  // HO 390 — small/large-dollar split (FEC Schedule A by_size). Shown only
  // when both buckets are populated and non-zero; otherwise the block is
  // absent (the honest gap — members without a resolved by_size fetch render
  // just the line above, no fabricated split). Percentages sum to exactly 100
  // (large = 100 − small) so the two-segment bar never leaves a 1px gap.
  const small = fundraising.smallDollar;
  const large = fundraising.largeDollar;
  const splitTotal = (small ?? 0) + (large ?? 0);
  const hasSplit = small != null && large != null && splitTotal > 0;
  const smallPct = hasSplit ? Math.round(((small as number) / splitTotal) * 100) : 0;
  const largePct = 100 - smallPct;

  return (
    <div>
      <div
        className="text-[12px] uppercase tracking-[0.5px] tabular-nums"
        style={{ color: "var(--text-dim)" }}
      >
        <span style={{ color: "var(--text-muted)" }}>
          {fundraising.cycle} fundraising
        </span>
        {/* HO 416 — flag the race-switcher case: a House member whose resolved
            committee is their Senate campaign, so the figures read as Senate,
            not House, fundraising. */}
        {fundraising.isSenateCampaign ? (
          <span
            className="ml-1.5 rounded-[2px] px-1 py-px text-[10px] font-medium"
            style={{
              color: "var(--accent-amber-bright)",
              border: "1px solid var(--accent-amber)",
            }}
          >
            Senate {fundraising.cycle} campaign
          </span>
        ) : null}
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

      {hasSplit ? (
        <div className="mt-1.5">
          <div
            className="text-[11px] uppercase tracking-[0.5px] tabular-nums"
            style={{ color: "var(--text-dim)" }}
          >
            <span style={{ color: "var(--text-muted)" }}>Donor mix</span>
            {" · "}
            <span style={{ color: "var(--text-secondary)" }}>
              {smallPct}% small
            </span>
            <span> (&lt;$200)</span>
            {" · "}
            <span style={{ color: "var(--text-secondary)" }}>
              {largePct}% large
            </span>
            <span> ($200+)</span>
          </div>
          <div
            className="mt-1 flex h-[6px] w-full max-w-[280px] overflow-hidden rounded-[2px]"
            role="img"
            aria-label={`${smallPct}% small-dollar, ${largePct}% large-dollar`}
          >
            <span
              style={{
                width: `${smallPct}%`,
                backgroundColor: "var(--accent-amber-bright)",
                borderRight:
                  smallPct > 0 && largePct > 0
                    ? "1px solid var(--bg-base)"
                    : "none",
                boxSizing: "border-box",
              }}
            />
            <span
              style={{
                width: `${largePct}%`,
                backgroundColor: "var(--accent-amber)",
              }}
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}
