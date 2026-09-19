// HO 622 — the Absence Watch band, in the HO 608 slot between nav and hearings
// (docs/design/dashboard-layout-target.html, the band directly after the nav).
//
// Server component. HO 630 gave it one client island — AbsenceWatchRows — because
// a plain click now EXPANDS the member's card in place instead of leaving the
// dashboard (the HO 627 ruling: the drill moves one level in, not away).
//
// The split is deliberate and load-bearing in two directions. The band keeps every
// time derivation (formatSince below), so the island holds no clock at all — the
// HO 574/589 constraint by construction, not by discipline. And the band renders
// each SponsorExpandedPanel here, on the server, passing it into the island as a
// ReactNode: SponsorExpandedPanel is a server component reused VERBATIM (no
// absence-specific variant), and a client island cannot import one. That is the
// ActivityTabs idiom, and it is what keeps lib/queries — and with it next/cache —
// out of the client bundle.
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
import { AbsenceWatchRows } from "@/components/AbsenceWatchRows";
import { SponsorExpandedPanel } from "@/components/SponsorExpandedPanel";
import type { AbsentMember, Chamber } from "@/lib/queries";

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
      <AbsenceWatchRows
        rows={members.map((m) => ({
          bioguideId: m.bioguideId,
          name: m.name,
          party: m.party,
          state: m.state,
          // Formatted HERE so the island carries no clock — see the header note.
          sinceLabel: formatSince(m.lastCastDate, nowMs),
          atBound: m.atBound,
          streak: m.streak,
          missedPct: m.missedPct,
          // `card === null` is HO 630's identity-only degrade (a per-member
          // assembly failure): the row still renders, without an expand
          // affordance. It is NOT the same as "no data" — the band still names
          // the member, which is the claim this surface exists to make.
          card: m.card ? (
            <>
              {/* HO 630 — the head-drill, MEASURED into existence rather than
                  added on principle. The handoff made it conditional on where
                  SponsorExpandedPanel's own buttons land at band widths; the card
                  puts its first `View detail →` 447px down at 2560 and 402px at
                  1440, i.e. ~85% of the way down a 482-536px card, and the commit
                  3 stack pushes it further still. So the drill leads, packed left,
                  exactly as HO 627 did it for the bill panel — same reason (the
                  container-query stack buried the old bottom button) and the same
                  idiom, so the drill sits in one place on both expand surfaces.
                  It is a sibling of the row, not a child, so a plain click here
                  navigates and never reaches the toggle. */}
              <a className="abw-drill" href={`/members/${m.bioguideId}`}>
                → Full page
              </a>
              <SponsorExpandedPanel
                sponsorKey={m.bioguideId}
                sponsorName={m.name}
                sponsorParty={m.party}
                sponsorState={m.state}
                bioguideId={m.bioguideId}
                chamber={m.chamber as Chamber}
                stats={m.card.stats}
                topics={m.card.topics}
                recentBills={m.card.recentBills}
                committees={m.card.committees}
                affiliations={m.card.affiliations}
                palestineGrade={m.palestineGrade}
                palestineRank={m.palestineRank}
                palestineScore={m.palestineScore}
                includeCeremonial={false}
                // HO 631 — the compact density. This REPLACES HO 630's
                // committeeCap={Infinity}: uncapping made sense when the card
                // expanded the band and the reader could scroll the page to reach
                // the tail, but the card is an overlay now, and an uncapped roster
                // is exactly what makes it tall enough to need one. Compact caps
                // both columns at 10 and closes each with a drill to the member
                // page, so the tail is one click away rather than 14 rows down.
                density="compact"
              />
            </>
          ) : null,
        }))}
      />
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
