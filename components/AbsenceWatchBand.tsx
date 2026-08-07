// HO 622 — the Absence Watch band, in the HO 608 slot between nav and hearings
// (docs/design/dashboard-layout-target.html, the band directly after the nav).
//
// Server component. Everything it renders is already in the props; there is no
// interaction beyond the row link, so no client island.
//
// TWO DEVIATIONS FROM THE MOCK, both deliberate, both recorded here so neither
// reads as drift:
//   1. The mock drew a DIFFERENT RULE — "MISSED >= 20 · LAST 21 DAYS", six
//      members, with a 30-cell miss sparkline and a CHRONIC % chip per row. HO 621
//      ruled that rule out (a rate/window count makes a present-tense claim off a
//      career statistic; 6 false positives to 1 false negative in the live corpus),
//      so the row anatomy here is the ruled one: the dated claim leads and the
//      cumulative rate demotes to an evidence clause. The mock's SHELL — panel,
//      head, packed-left rows, footer — is what carries over.
//   2. SINGLE COLUMN, not the mock's `.abw2` two-up at >= 1200px. That grid existed
//      to fit six rows; a streak rule returns 0-3, so two columns would leave one
//      empty most days — a reserved box under another name (C4). The row is also
//      much longer under the ruled anatomy than the mock's, so one column reads
//      better at width. If the corpus ever sustains six-plus names, the mock's grid
//      is the thing to restore.
//
// Conventions: C1 packed left, trailing gap right, no far-right anchor. C4 the
// whole band is conditional — zero qualifying members renders `null`, no wrapper
// and no header for nothing, because on this surface empty is the GOOD-NEWS state.
// C3 one bright element per row (the name); the party bracket carries party and
// nothing else (the HO 610 token rule); the evidence clauses are dim. Every size
// in 9-14px is an --fs token.
import Link from "next/link";
import type { AbsentMember } from "@/lib/queries";
import { partyColor } from "@/lib/race-colors";

const MONTHS = [
  "JAN",
  "FEB",
  "MAR",
  "APR",
  "MAY",
  "JUN",
  "JUL",
  "AUG",
  "SEP",
  "OCT",
  "NOV",
  "DEC",
];

// `key` is 'YYYY-MM-DD' as the chamber recorded it (see AbsentMember.lastCastDate
// — sliced, never parsed). The year is appended only when it differs from the
// current one: the 119th spans 2025-2027, and a bare "JUN 11" on a member who last
// voted in 2025 would understate the absence by a year. The current year is read
// off the page-computed clock (HO 490) in UTC; a UTC-vs-ET year boundary can at
// worst print a redundant year for a few hours on Dec 31, never a wrong one.
function formatSince(key: string, nowMs: number): string {
  const [y, m, d] = key.split("-");
  const mon = MONTHS[Number(m) - 1];
  if (!y || !mon || !d) return key;
  const label = `${mon} ${Number(d)}`;
  return Number(y) === new Date(nowMs).getUTCFullYear() ? label : `${label} ${y}`;
}

export function AbsenceWatchBand({
  members,
  nowMs,
}: {
  members: AbsentMember[];
  nowMs: number;
}) {
  // C4 — the conditional. No band, no header, no reserved space.
  if (members.length === 0) return null;

  return (
    <section className="abw" aria-label="Absence watch">
      <div className="abw-head">
        <span className="abw-title">▲ ABSENCE WATCH</span>
        <span className="abw-count">({members.length})</span>
      </div>
      <ul className="abw-rows">
        {members.map((m) => (
          <li key={m.bioguideId}>
            <Link className="abw-row" href={`/members/${m.bioguideId}`}>
              <span className="abw-name">{m.name}</span>
              <span className="abw-party" style={{ color: partyColor(m.party) }}>
                {(m.party ?? "?").toUpperCase()}-{m.state}
              </span>
              <span className="abw-claim">
                NO VOTE CAST SINCE{m.atBound ? " BEFORE" : ""}{" "}
                {formatSince(m.lastCastDate, nowMs)}
              </span>
              <span className="abw-ev">
                · {m.streak}
                {m.atBound ? "+" : ""} CONSECUTIVE ROLL CALLS
              </span>
              <span className="abw-ev">· {m.missedPct.toFixed(1)}% OF 119TH VOTES</span>
            </Link>
          </li>
        ))}
      </ul>
      {/* Designed into the mock, and load-bearing: the delegate carve is a
          population-correctness rule (HO 527), so Radewagen at 82.4% missed is
          absent from this band BY RULE. Without the disclosure that absence is
          mysterious rather than legible. */}
      <p className="abw-foot">
        NON-VOTING DELEGATES EXCLUDED · REFRESHES AFTER SYNC-VOTES
      </p>
    </section>
  );
}
