"use client";

// HO 393 — the PAC SPENDING direction line on a competitive race card. Renders
// only when the seat has pac_ie_spending rows (USCPR-badge convention: no empty
// slot). We ship DIRECTION — who the PAC is backing/opposing — with each
// name/arrow a deep-link to the live FEC independent-expenditures browser, so
// the reader sees the real dollars at the source without the app asserting a
// total it can't stand behind (Schedule E has no clean dollar source; see
// docs/oddities.md).
//
// Spender identity names AIPAC (Corey's HO 393 decision) — the header on the
// full line, the prefix on the dashboard glance line — with the full "which
// committee" attribution in the tooltip. There is one spender, so the direction
// items carry no per-line spender prefix.
//
// Two variants:
//   full   — header "AIPAC SUPER PAC · via FEC" + FEC-deep-linked direction
//            items + "since {month}". Used in the /electoral list & map expands
//            and the /race/[id] hub (containers where a nested <a> is valid).
//   glance — a single non-linked line "AIPAC super PAC · backing X, opposing Y",
//            for the dashboard RaceCard (a whole-card <Link>, so no nested
//            anchors — the clickable version lives one click away on the hub).
//
// Client island because the full variant's FEC links stop row-toggle
// propagation (they live inside the expand of a role=button accordion row).

import type { PacIeRow } from "@/lib/queries";
import {
  PAC_IE_ATTRIBUTION,
  PAC_IE_CYCLE,
  PAC_IE_GLANCE_LABEL,
  PAC_IE_HEADER_LABEL,
  fecIeUrl,
  pacSinceMonth,
  pacSurname,
} from "@/lib/pac-ie";

// Dedup by direction+surname (a target can carry two candidate_ids across FEC
// filings — e.g. redistricted seats — which would otherwise render the same
// "opposing X" twice), backing (S) before opposing (O), tracking the earliest
// date for the "since {month}" cue.
function prepare(rows: PacIeRow[]): {
  items: { row: PacIeRow; surname: string }[];
  earliest: string | null;
} {
  const seen = new Set<string>();
  const items: { row: PacIeRow; surname: string }[] = [];
  let earliest: string | null = null;
  for (const row of rows) {
    const surname = pacSurname(row.candidateName);
    const key = `${row.supportOppose}:${surname}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (row.earliestDate && (!earliest || row.earliestDate < earliest)) {
      earliest = row.earliestDate;
    }
    items.push({ row, surname });
  }
  items.sort((a, b) =>
    a.row.supportOppose === b.row.supportOppose
      ? 0
      : a.row.supportOppose === "S"
        ? -1
        : 1,
  );
  return { items, earliest };
}

export function PacSpendingLine({
  rows,
  variant = "full",
}: {
  rows: PacIeRow[] | undefined;
  variant?: "full" | "glance";
}) {
  if (!rows || rows.length === 0) return null;
  const { items, earliest } = prepare(rows);

  if (variant === "glance") {
    // Compact, non-linked snapshot for the dashboard card:
    //   "AIPAC super PAC · backing Stevens" / "… · backing Gallrein, opposing Massie"
    const dirs = items
      .map(({ row, surname }) =>
        `${row.supportOppose === "S" ? "backing" : "opposing"} ${surname}`,
      )
      .join(", ");
    return (
      <div className="rc-pac rc-pac--glance" title={PAC_IE_ATTRIBUTION}>
        <span className="rc-pac-spender">{PAC_IE_GLANCE_LABEL}</span>
        <span className="rc-pac-glance-dirs"> · {dirs}</span>
      </div>
    );
  }

  const since = pacSinceMonth(earliest);
  return (
    <div className="rc-pac">
      <span className="rc-pac-k" title={PAC_IE_ATTRIBUTION}>
        {PAC_IE_HEADER_LABEL}
      </span>
      <div className="rc-pac-line">
        {items.map(({ row, surname }, i) => {
          const verb = row.supportOppose === "S" ? "backing" : "opposing";
          return (
            <span key={`${row.candidateId}:${row.supportOppose}`}>
              {i > 0 ? <span className="rc-pac-sep"> </span> : null}
              <a
                className="rc-pac-link"
                href={fecIeUrl(
                  row.committeeId,
                  row.candidateId,
                  row.supportOppose,
                  PAC_IE_CYCLE,
                )}
                target="_blank"
                rel="noreferrer"
                onClick={(e) => e.stopPropagation()}
                title={`Independent expenditures ${verb} ${surname} — live on FEC.gov`}
              >
                <span className="rc-pac-verb">{verb}</span> {surname}
                <span className="rc-pac-arrow"> ↗</span>
              </a>
            </span>
          );
        })}
        {since ? <span className="rc-pac-since"> · since {since}</span> : null}
      </div>
    </div>
  );
}
