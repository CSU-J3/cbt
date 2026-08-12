// HO 645 — the card's BACK: the 330px panel the rack hangs off when a card is
// open. Ruled form is docs/design/mock-645-absence-cards-v6.html.
//
// It is a SERVER component and it is NOT SponsorExpandedPanel. The band used to
// reuse that panel verbatim (HO 630/631) and it never fit this shape — it is a
// ~1000px three-column card that had to be container-queried down to one column,
// capped twice, and then scrolled inside a fold-bounded pop. The back is instead
// what a trading card's back actually is: a short ruled stat block, in the
// band's own vocabulary. SponsorExpandedPanel is UNTOUCHED (/members is its other
// consumer and any change there reaches both — HO 507's rule).
//
// WHAT IS NOT HERE, and why it is absent rather than invented (HO 645 §3). The
// mock draws six rows; two of them have no source in this payload and the mock is
// illustrative, which never sets an expectation for a build (HO 631's own lesson):
//   - LAST VOTE CAST's bill reference ("JUN 11 · S 2201"). queryAbsenceWatch
//     returns the DATE of the last cast roll call, not the roll call's subject —
//     the walk reads member_votes.position, and the bill would need the votes row
//     it broke on carried out of Phase B. So the row renders its date alone.
//   - SENIORITY ("41 yrs · rank 1"). Needs a terms_json parse plus a rank
//     computed across the chamber. Not a detail of this build; it is its own
//     scoped item with its own cost.
// A third is narrower than the mock rather than missing: the sub-line reads
// chamber · state, because AbsentMember carries no district (the mock's "FL-24").
// And the 119TH row renders the percentage alone — m.card.stats is a BILL
// aggregate (total/enacted/stage counts), so it carries no vote denominator for
// the mock's "1,061/1,262".
//
// The figure it does carry is MISSED, not the mock's participation: the band's
// claim is absence and AbsentMember.missedPct is a missed rate, so the label says
// so. Printing a missed rate under a "119TH VOTES" heading that the mock uses for
// votes CAST would be the same number reading as its own complement.
import {
  ABSENCE_BACK_BILLS_CAP,
  ABSENCE_WALK_BOUND,
  type AbsentMember,
} from "@/lib/queries";
import { formatBillId } from "@/lib/format";
import { partyColor } from "@/lib/race-colors";

// Both lists are ruled to one line each in the mock. Capped rather than wrapped:
// the panel is 330px and an uncapped roster is exactly what made the HO 631 pop
// need a scrollbar. The tail is one click away on the member page — the card
// name links there.
//
// CMTE_CAP stays LOCAL and unexported, deliberately: the assembly site must not
// slice committees, because this file's "+N" counts off the full array (see the
// projection in queryAbsenceWatch). The bills cap is the shared one — that list
// IS sliced upstream now, so a second literal here could go quietly false.
const CMTE_CAP = 3;

// Display-only, and only on this 330px panel: the stored name is the full one
// ("Rules and Administration Committee") and every other surface keeps it. Three
// of those on one line wrapped to three lines here and spent them re-printing a
// word that the row's own label already says. Trailing "Committee" only — a
// SUBcommittee keeps its suffix, because there the word is the distinction.
function compactCommittee(name: string): string {
  return name.replace(/\s+Committee$/, "");
}

export function AbsenceCardBack({
  member,
  sinceLabel,
}: {
  member: AbsentMember;
  /** Server-formatted by the band; the island holds no clock (HO 574/589). */
  sinceLabel: string;
}) {
  const team = `${(member.party ?? "?").toUpperCase()}-${member.state}`;
  const cmtes = member.card?.committees ?? [];
  const bills = member.card?.recentBills ?? [];
  const billTotal = member.card?.stats.total ?? 0;
  const cmteMore = Math.max(0, cmtes.length - CMTE_CAP);
  // The "+N" counts against the member's FULL sponsored total, not against the
  // prefetched list's length — queryAbsenceWatch slices recentBills to
  // ABSENCE_BACK_BILLS_CAP before it caches (HO 647; it was 10 under HO 631), so
  // `bills.length` is a render cap and would understate.
  const billMore = Math.max(
    0,
    billTotal - Math.min(ABSENCE_BACK_BILLS_CAP, bills.length),
  );

  return (
    <>
      <div className="abw-bk-head">
        <h4 className="abw-bk-name">{member.name}</h4>
        <span className="abw-bk-team" style={{ color: partyColor(member.party) }}>
          {team}
        </span>
      </div>
      <p className="abw-bk-sub">
        {member.chamber.toUpperCase()} · {member.state}
      </p>
      <dl className="abw-bk-rows">
        <div>
          <dt>CONSECUTIVE MISSED</dt>
          <dd>
            <b>
              {member.streak}
              {member.atBound ? "+" : ""}
            </b>{" "}
            roll calls
          </dd>
        </div>
        <div>
          <dt>LAST VOTE CAST</dt>
          <dd>
            {member.atBound ? "BEFORE " : ""}
            {sinceLabel}
          </dd>
        </div>
        <div>
          <dt>119TH MISSED</dt>
          <dd>
            <b>{member.missedPct.toFixed(1)}%</b> of votes
          </dd>
        </div>
      </dl>
      {/* Both blocks self-omit rather than rendering an empty label — C4 at row
          scale, and the same honest-absence rule the rest of the app uses. They
          are also the only two things on this panel that depend on the card
          prefetch, so a per-member assembly failure (AbsentMember.card === null)
          costs these two lines and nothing else: the claim rows above it are all
          base-query data and still render. */}
      {cmtes.length > 0 ? (
        <dl className="abw-bk-block">
          <dt>COMMITTEES</dt>
          <dd>
            {cmtes
              .slice(0, CMTE_CAP)
              .map((c) => compactCommittee(c.name))
              .join(" · ")}
            {cmteMore > 0 ? ` · +${cmteMore}` : ""}
          </dd>
        </dl>
      ) : null}
      {bills.length > 0 ? (
        <dl className="abw-bk-block">
          <dt>SPONSORED, 119TH</dt>
          <dd>
            {/* Redundant against this payload — queryAbsenceWatch already caps
                the list at the same constant — and kept so the render's cap
                does not depend on its producer. NOT justified by a stale-cache
                window: HO 647 measured that an edit inside the cached callback
                ROTATES its key, so the fat pre-647 entry is orphaned rather
                than served to this component (oddities). */}
            {bills
              .slice(0, ABSENCE_BACK_BILLS_CAP)
              .map((b) => formatBillId(b.bill_type, b.bill_number))
              .join(" · ")}
            {billMore > 0 ? ` · +${billMore}` : ""}
          </dd>
        </dl>
      ) : null}
      <p className="abw-bk-foot">
        STREAK COUNTED BACK TO A {ABSENCE_WALK_BOUND}-ROLL BOUND
      </p>
    </>
  );
}
