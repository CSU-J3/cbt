import Link from "next/link";
import type { FilingSummary } from "@/lib/queries";

// HO 437 — one LD-2 filing as a compact row, shared by the /lobbying per-issue
// drill (RECENT) and the corpus-wide feed (Section 3). Server component.
//
//   {age} · {registrant} → {client} · [issue chips] · [bill chips]
//
// Registrant/client are plain text (no entity pages for lobbying orgs in v1).
// Bill chips deep-link to /bill/[id]; the whole bill segment is OMITTED when a
// filing resolves no tracked bill (the honest-gap discipline — no "—").

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
    <div
      className="flex flex-wrap items-center gap-x-2 gap-y-1 px-4 py-2 text-[12px]"
      style={{ borderBottom: "0.5px solid var(--border-soft)" }}
      title={dollars}
    >
      <span
        className="w-[52px] shrink-0 uppercase tracking-[0.5px] tabular-nums"
        style={{ color: "var(--text-dim)" }}
      >
        {relAge(filing.dtPosted)}
      </span>
      <span className="min-w-0 flex-1" style={{ color: "var(--text-secondary)" }}>
        <span style={{ color: "var(--text-primary)" }}>
          {filing.registrantName ?? "—"}
        </span>
        <span style={{ color: "var(--text-dim)" }}> → </span>
        <span>{filing.clientName ?? "—"}</span>
      </span>

      {shownIssues.length > 0 ? (
        <span className="flex shrink-0 flex-wrap items-center gap-1">
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
      ) : null}

      {filing.billIds.length > 0 ? (
        <span className="flex shrink-0 flex-wrap items-center gap-1">
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
      ) : null}
    </div>
  );
}
