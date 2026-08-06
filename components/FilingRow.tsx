"use client";

// HO 437 / 486 — one LD-2 filing as a compact row, shared by THREE surfaces:
// the /lobbying two-pane feed + scoped drill (expandable), the /bill/[id]
// LOBBYING section (BillLobbying), and the orphaned IssueDrill. The grid lives
// on the row itself (.lob-filing-row) so every consumer aligns with no ancestor
// dependency — HO 486 commit A wrongly put it on .lob-content, which broke the
// /bill rows (they fell back to the members .mc-row grid).
//
//   [caret] · {age} · {registrant} → {client} · [issue chips] · [bill chips]
//
// Expand is OPT-IN (`expandable`). On /lobbying the row is a div role=button that
// navigates to a page-computed toggleHref (?expanded=<uuid>, carrying ?issue= /
// ?page=); the server reads getFilingActivities and renders <FilingExpandPanel>
// as the next sibling. It's a div (NOT a <Link>) because it wraps the bill-chip
// <Link>s and nested <a> is invalid HTML — the CommitteeRailRow / HO 466 idiom:
// the chips stopPropagation so they deep-link without toggling the row. Where
// nothing reads ?expanded= (BillLobbying / IssueDrill) the row is inert: no
// caret glyph, no handlers, no role — but it keeps the empty caret cell so the
// grid is identical across surfaces.
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { FilingSummary } from "@/lib/queries";

// HO 590: `nowMs` is the server's Date.now() at SSR, prop-drilled in (see the
// FilingRow prop). It replaces a render-time Date.now() that ran a client value at
// hydration different from the server's SSR value — when the two crossed a day
// boundary the "Nd ago" text drifted, an args[]=text hydration mismatch (the sibling
// text-variant of the tape's structural #418, 589/590 M2). Same fix shape as the tape.
function relAge(iso: string, nowMs: number): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const days = Math.floor((nowMs - then) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "1d ago";
  if (days < 30) return `${days}d ago`;
  const mo = Math.floor(days / 30);
  if (mo < 12) return `${mo}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}

const MAX_ISSUE_CHIPS = 3;

export function FilingRow({
  filing,
  nowMs,
  expandable = false,
  isExpanded = false,
  toggleHref,
}: {
  filing: FilingSummary;
  // HO 590: server Date.now() at SSR, so the "Nd ago" age is identical on the server
  // render and hydration. Required (no default) — a caller that forgets it is a tsc
  // error, keeping the hydration-safe invariant enforced at the type level.
  nowMs: number;
  expandable?: boolean;
  isExpanded?: boolean;
  toggleHref?: string;
}) {
  const router = useRouter();

  // HO 570 C3 — dedupe both chip arrays. The two feeder paths disagree on
  // dedup: the live hydrateFilings uses SELECT DISTINCT, but the precomputed
  // drill blob (readLdaTables) does not, so a filing carrying the same issue
  // code across activities (or the same bill_id under two activity ordinals)
  // arrives with duplicates -> duplicate React keys. A repeated code/bill is a
  // redundant chip, not information, so dedup at the source rather than
  // index-suffixing the key.
  const issueCodes = [...new Set(filing.issueCodes)];
  const billIds = [...new Set(filing.billIds)];

  const shownIssues = issueCodes.slice(0, MAX_ISSUE_CHIPS);
  const extraIssues = issueCodes.length - shownIssues.length;

  const cells = (
    <>
      <span
        className="lob-filing-caret"
        aria-hidden
        style={
          expandable
            ? { color: isExpanded ? "var(--accent-amber)" : "var(--text-dim)" }
            : undefined
        }
      >
        {expandable ? (isExpanded ? "▾" : "▸") : null}
      </span>
      <span className="lob-age">{relAge(filing.dtPosted, nowMs)}</span>
      <span
        className="lob-rc"
        title={`${filing.registrantName ?? "—"} → ${filing.clientName ?? "—"}`}
      >
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
          <span className="text-[length:var(--fs-10)]" style={{ color: "var(--text-dim)" }}>
            +{extraIssues}
          </span>
        ) : null}
      </span>

      <span className="lob-bills">
        {billIds.map((id) => (
          <Link
            key={id}
            href={`/bill/${id}`}
            onClick={expandable ? (e) => e.stopPropagation() : undefined}
            className="rounded-[2px] px-1 text-[length:var(--fs-10)] uppercase tracking-[0.5px] tabular-nums transition hover:bg-[var(--bg-row-hover)]"
            style={{
              border: "1px solid var(--accent-amber)",
              color: "var(--accent-amber)",
            }}
          >
            {id}
          </Link>
        ))}
      </span>
    </>
  );

  // Inert surfaces (BillLobbying / IssueDrill): no panel reads ?expanded= there,
  // so the row carries no interactivity — just the grid.
  if (!expandable) {
    return <div className="mc-row lob-filing-row">{cells}</div>;
  }

  function toggle() {
    if (toggleHref) router.replace(toggleHref, { scroll: false });
  }
  return (
    <div
      role="button"
      tabIndex={0}
      aria-expanded={isExpanded}
      onClick={toggle}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          toggle();
        }
      }}
      className={`mc-row lob-filing-row${isExpanded ? " is-expanded" : ""}`}
    >
      {cells}
    </div>
  );
}
