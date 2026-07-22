import Link from "next/link";
import type { FilingSummary } from "@/lib/queries";

// HO 437 / 486 — one LD-2 filing as a compact row, shared by the /lobbying
// per-issue drill (scoped RECENT) and the corpus-wide feed. Server component.
// HO 486 laid it out on the two-pane grid that aligns with the column header:
//
//   [caret] · {age} · {registrant} → {client} · [issue chips] · [bill chips]
//
// The caret slot is empty here (flat row); commit B fills it and wraps the row
// in an ?expanded= toggle. Registrant/client are plain text (no entity pages for
// lobbying orgs in v1). Bill chips deep-link to /bill/[id]; the whole bill cell
// is empty when a filing resolves no tracked bill (the honest-gap discipline).

function relAge(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const days = Math.floor((Date.now() - then) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "1d ago";
  if (days < 30) return `${days}d ago`;
  const mo = Math.floor(days / 30);
  if (mo < 12) return `${mo}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}

const MAX_ISSUE_CHIPS = 3;

export function FilingRow({ filing }: { filing: FilingSummary }) {
  const shownIssues = filing.issueCodes.slice(0, MAX_ISSUE_CHIPS);
  const extraIssues = filing.issueCodes.length - shownIssues.length;
  const dollars =
    filing.income != null
      ? `income $${filing.income.toLocaleString()}`
      : filing.expenses != null
        ? `expenses $${filing.expenses.toLocaleString()}`
        : undefined;

  return (
    <div className="mc-row lob-frow" title={dollars}>
      <span className="lob-frow-caret" aria-hidden />
      <span className="lob-age">{relAge(filing.dtPosted)}</span>
      <span className="lob-rc" title={`${filing.registrantName ?? "—"} → ${filing.clientName ?? "—"}`}>
        <span style={{ color: "var(--text-primary)" }}>
          {filing.registrantName ?? "—"}
        </span>
        <span style={{ color: "var(--text-dim)" }}> → </span>
        <span>{filing.clientName ?? "—"}</span>
      </span>

      <span className="lob-issues">
        {shownIssues.map((code) => (
          <span key={code} className="micro-tag">
            {code}
          </span>
        ))}
        {extraIssues > 0 ? (
          <span className="text-[10px]" style={{ color: "var(--text-dim)" }}>
            +{extraIssues}
          </span>
        ) : null}
      </span>

      <span className="lob-bills">
        {filing.billIds.map((id) => (
          <Link
            key={id}
            href={`/bill/${id}`}
            className="rounded-[2px] px-1 text-[10px] uppercase tracking-[0.5px] tabular-nums transition hover:bg-[var(--bg-row-hover)]"
            style={{
              border: "1px solid var(--accent-amber)",
              color: "var(--accent-amber)",
            }}
          >
            {id}
          </Link>
        ))}
      </span>
    </div>
  );
}
