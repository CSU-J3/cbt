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
// Two variants, and since HO 691 they DIVERGE ON TARGET STATUS deliberately —
// this is the whole shape of Corey's ruling (2026-09-03): "the races on the
// dashboard needs to say what is currently happening. that can be filed in
// races". The glance card is a statement about the race NOW; the races surface
// is where the race's history lives.
//   full   — header "AIPAC SUPER PAC · via FEC" + FEC-deep-linked direction
//            items + "since {month}". Renders EVERY target: current ones first,
//            then lost/withdrawn ones in the past tense and dimmed. The deep
//            link stays on the past-tense item, because the dollars are real and
//            the reader can still go see them. Used in the /electoral list & map
//            expands and the /race/[id] hub (a nested <a> is valid there).
//   glance — a single non-linked line "AIPAC super PAC · opposing X", for the
//            dashboard RaceCard (a whole-card <Link>, so no nested anchors).
//            Renders CURRENT targets only, and when none remain the line is
//            ABSENT — the seat has no current UDP direction, and absence is the
//            signal (the USCPR-badge convention this component already follows).
//            Never "backed", never dimmed, never history.
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

const CURRENT = new Set(["active", "unknown"]);
const isCurrent = (row: PacIeRow) => CURRENT.has(row.targetStatus);

// Dedup by direction+surname+STATUS (a target can carry two candidate_ids across
// FEC filings — e.g. redistricted seats, and NJ-11 carries two for Malinowski —
// which would otherwise render the same "opposing X" twice). HO 691 added the
// status leg: without it a target that somehow both lost and won would collapse
// two different facts into whichever row came first, which is precisely the
// collision the dedup must not silently make.
//
// Order: current items first (backing before opposing within each), then the
// past-tense ones. `earliest` is tracked per group so the "since {month}" cue
// can be computed over whatever the caller actually renders.
type Item = { row: PacIeRow; surname: string };
function prepare(rows: PacIeRow[]): { current: Item[]; past: Item[] } {
  const seen = new Set<string>();
  const items: Item[] = [];
  for (const row of rows) {
    const surname = pacSurname(row.candidateName);
    const key = `${row.supportOppose}:${surname}:${row.targetStatus}`;
    if (seen.has(key)) continue;
    seen.add(key);
    items.push({ row, surname });
  }
  const bySupportFirst = (a: Item, b: Item) =>
    a.row.supportOppose === b.row.supportOppose
      ? 0
      : a.row.supportOppose === "S"
        ? -1
        : 1;
  return {
    current: items.filter((i) => isCurrent(i.row)).sort(bySupportFirst),
    past: items.filter((i) => !isCurrent(i.row)).sort(bySupportFirst),
  };
}

function earliestOf(items: Item[]): string | null {
  let earliest: string | null = null;
  for (const { row } of items)
    if (row.earliestDate && (!earliest || row.earliestDate < earliest))
      earliest = row.earliestDate;
  return earliest;
}

// Past tense, and it names WHY the target is out rather than just dimming it —
// "backed Stevens · lost primary" is a complete sentence about the race; a
// dimmed "backing Stevens" would still be the present-tense claim, quieter.
const PAST_VERB = { S: "backed", O: "opposed" } as const;
const OUTCOME = { lost: "lost primary", withdrew: "withdrew" } as const;
function outcomeLabel(status: PacIeRow["targetStatus"]): string {
  return status === "withdrew" ? OUTCOME.withdrew : OUTCOME.lost;
}

export function PacSpendingLine({
  rows,
  variant = "full",
}: {
  rows: PacIeRow[] | undefined;
  variant?: "full" | "glance";
}) {
  if (!rows || rows.length === 0) return null;
  const { current, past } = prepare(rows);

  if (variant === "glance") {
    // Compact, non-linked snapshot for the dashboard card:
    //   "AIPAC super PAC · opposing El-Sayed"
    // CURRENT TARGETS ONLY. When every direction on the seat points at somebody
    // who is out of the race, the whole line goes — the card would otherwise
    // assert a live PAC position on a contest that is already decided.
    if (current.length === 0) return null;
    const dirs = current
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

  const items = [...current, ...past];
  // "since {month}" describes the spending the reader is looking at. Over the
  // CURRENT items when there are any — a 2025 date belonging to a decided
  // primary would date the line to a contest it is no longer about — and over
  // everything when the seat has only history left, where the full span is the
  // honest answer.
  const since = pacSinceMonth(earliestOf(current.length > 0 ? current : items));
  return (
    <div className="rc-pac">
      <span className="rc-pac-k" title={PAC_IE_ATTRIBUTION}>
        {PAC_IE_HEADER_LABEL}
      </span>
      <div className="rc-pac-line">
        {items.map(({ row, surname }, i) => {
          const done = !isCurrent(row);
          const verb = done
            ? PAST_VERB[row.supportOppose]
            : row.supportOppose === "S"
              ? "backing"
              : "opposing";
          return (
            <span key={`${row.candidateId}:${row.supportOppose}:${row.targetStatus}`}>
              {i > 0 ? <span className="rc-pac-sep"> </span> : null}
              <a
                // The FEC deep link STAYS on the past-tense item. The dollars
                // were really spent and the reader can still go look at them —
                // dimming is about tense, not about hiding the filing.
                className={done ? "rc-pac-link rc-pac-link--past" : "rc-pac-link"}
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
              {done ? (
                <span className="rc-pac-outcome">
                  {" "}
                  · {outcomeLabel(row.targetStatus)}
                </span>
              ) : null}
            </span>
          );
        })}
        {since ? <span className="rc-pac-since"> · since {since}</span> : null}
      </div>
    </div>
  );
}
