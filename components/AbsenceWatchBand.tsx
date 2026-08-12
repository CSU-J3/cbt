// HO 622 — the Absence Watch band, in the HO 608 slot between nav and hearings
// (docs/design/dashboard-layout-target.html, the band directly after the nav).
//
// Server component. HO 630 gave it one client island — AbsenceWatchCards — because
// a plain click EXPANDS the member's card in place instead of leaving the
// dashboard (the HO 627 ruling: the drill moves one level in, not away).
//
// HO 645 — THE BAND RENDERS CARDS, NOT ROWS
// (docs/design/mock-645-absence-cards-v6.html). Each member is a 126px trading
// card and the expand is a 330px BACK hanging off the rack's bottom edge. Three
// things this replaces, so none of them reads as still true below:
//   - the packed-left row anatomy (dated claim + two evidence clauses) is now the
//     card front's plate + two stat cells, with the long form on the back;
//   - the single-column ruling is moot — cards WRAP, which is what a rack is, and
//     the two-column question the row anatomy raised does not arise;
//   - SponsorExpandedPanel is no longer reused here at all. AbsenceCardBack is the
//     band's own back, and SponsorExpandedPanel is UNTOUCHED for /members, its
//     other consumer (HO 507's shared-component rule).
//
// The server/client split survives all of it, and is load-bearing in the same two
// directions. The band keeps every time derivation (formatSince below), so the
// island holds no clock at all — the HO 574/589 constraint by construction, not by
// discipline. And the band renders each AbsenceCardBack here, on the server,
// passing it into the island as a ReactNode: a client island cannot import a
// server component. That is the ActivityTabs idiom, and it is what keeps
// lib/queries — and with it next/cache — out of the client bundle.
//
// THE DEVIATION FROM THE MOCK THAT SURVIVES THE REWORK: the mock drew a DIFFERENT
// RULE — "MISSED >= 20 · LAST 21 DAYS" — and HO 621 ruled that out (a rate/window
// count makes a present-tense claim off a career statistic; 6 false positives to 1
// false negative in the live corpus). So the trigger is still the streak, the
// dated claim still leads, and the cumulative rate is still demoted to evidence.
// The mock's SHELL is what carries over. Two further mock rows have no source at
// all and are absent rather than invented — see AbsenceCardBack's header.
//
// HO 645 COMMIT B — TWO TIERS, AND THEY MUST NOT READ AS ONE LIST. MIA (streak
// >= 30) keeps --vote-nay; AT RISK ([8, 30)) takes --accent-amber and a
// --text-secondary surname. Amber is attention, red is alarm, and the whole
// reason the band splits its header into two counted segments is that a single
// heading over five cards claims five people are missing when two are.
//
// Conventions: C1 packed left, trailing gap right, no far-right anchor. C4 the
// whole band is conditional — zero qualifying members renders `null`, no wrapper
// and no header for nothing, because on this surface empty is the GOOD-NEWS state
// — and each header segment is independently conditional for the same reason.
// C3 one bright element per card (the surname; dimmed a step on the amber tier);
// the party bracket carries party and nothing else (the HO 610 token rule), and
// neither tier colour is a party token precisely BECAUSE a red frame that meant
// Republican would collapse alarm into party. Every size in 9-14px is an --fs
// token.
import { AbsenceCardBack } from "@/components/AbsenceCardBack";
import { AbsenceWatchCards } from "@/components/AbsenceWatchCards";
import {
  ABSENCE_STREAK_MIN,
  ABSENCE_WARN_MIN,
  type AbsentMember,
} from "@/lib/queries";

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
  // C4 — the conditional, and after HO 645 it is a PER-SEGMENT one. Both counts
  // zero renders null for the whole band (no wrapper, no header for nothing —
  // empty is the good-news state on this surface); either count zero drops that
  // segment and, with it, the separator. A band reading "AT RISK (0)" reserves a
  // box to report an absence of news.
  const mia = members.filter((m) => m.tier === "mia");
  const warn = members.filter((m) => m.tier === "warn");
  if (members.length === 0) return null;

  // HO 632 — display copy only. The FEATURE is still "Absence Watch" in the
  // roadmap, the backlog and this file's name; MIA is what the band calls itself
  // on screen. The two strings differ ON PURPOSE: the visible title is terse
  // chrome (C3 — one bright element, and the ▲ already carries the alarm), while
  // the accessible name keeps the context a sighted reader gets free from the
  // band's position and neighbours. "MIA" alone would announce an initialism with
  // none of that, which is a downgrade for the reader who can least afford one.
  return (
    <section className="abw" aria-label="MIA: absence watch">
      <div className="abw-head">
        {/* The `·` is a SEPARATOR, not the at-risk segment's own marker: it
            renders only between two present segments, so an at-risk-only band
            reads "AT RISK (3)" rather than opening on a dangling middot. That
            also gives the two tiers the glyph split the handoff asks for — the
            alarm triangle belongs to MIA and nothing else on this band carries
            it. */}
        {mia.length > 0 ? (
          <>
            <span className="abw-title">▲ MIA</span>
            <span className="abw-count">({mia.length})</span>
          </>
        ) : null}
        {mia.length > 0 && warn.length > 0 ? (
          <span className="abw-sep" aria-hidden>
            ·
          </span>
        ) : null}
        {warn.length > 0 ? (
          <>
            <span className="abw-title abw-title--warn">AT RISK</span>
            <span className="abw-count">({warn.length})</span>
          </>
        ) : null}
      </div>
      <AbsenceWatchCards
        rows={members.map((m) => {
          // Formatted HERE so the island carries no clock — see the header note.
          // Computed once and handed to BOTH the front's LAST cell and the back's
          // LAST VOTE CAST row, so the two can never disagree.
          const sinceLabel = formatSince(m.lastCastDate, nowMs);
          return {
            bioguideId: m.bioguideId,
            name: m.name,
            party: m.party,
            state: m.state,
            chamber: m.chamber,
            tier: m.tier,
            sinceLabel,
            atBound: m.atBound,
            streak: m.streak,
            missedPct: m.missedPct,
            // HO 645 — the back ALWAYS renders, which retires HO 630's
            // identity-only degrade rather than dropping it by accident. That
            // degrade existed because SponsorExpandedPanel is card-data all the
            // way down, so `m.card === null` left nothing to expand into and a
            // card advertising an affordance it cannot honor is the HO 627
            // defect. The new back is mostly BASE-QUERY data — the streak, the
            // last cast date, the missed rate — and only its two closing blocks
            // read `m.card`, which self-omit. So the affordance is now honorable
            // on a failed prefetch and the condition that produced the degrade
            // no longer holds.
            back: <AbsenceCardBack member={m} sinceLabel={sinceLabel} />,
          };
        })}
      />
      {/* Designed into the mock, and load-bearing three times over. The delegate
          carve is a population-correctness rule (HO 527), so Radewagen at 82.4%
          missed is absent from this band BY RULE — without the disclosure that
          absence is mysterious rather than legible. And both thresholds are now
          stated, interpolated from the constants that enforce them, because with
          two tiers on screen "AT RISK" means nothing until the reader knows what
          it is at risk OF. */}
      <p className="abw-foot">
        NON-VOTING DELEGATES EXCLUDED · MIA = {ABSENCE_STREAK_MIN}+ CONSECUTIVE
        MISSED · AT RISK = {ABSENCE_WARN_MIN}+ · REFRESHES AFTER SYNC-VOTES
      </p>
    </section>
  );
}
