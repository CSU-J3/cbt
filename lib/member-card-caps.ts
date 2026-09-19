// HO 631 — the compact member card's caps, in a LEAF module because two layers
// need the same numbers and neither can safely import the other.
//
// The render needs them (SponsorExpandedPanel slices to them and computes each
// column's "+N more" against them) and the band's assembly site needs the bills
// one (getAbsenceWatch slices `recentBills` before the card is ever cached or
// serialized). Putting them in the component would make `lib/queries` import a
// module whose transitive graph reaches a "use client" component; putting them in
// `lib/queries` would give the component a runtime dependency on the query layer.
// A leaf with no imports is the house answer to exactly this — the same reason
// `lib/amendment-vote-key.ts` exists.
//
// THE COUPLING IS LOAD-BEARING, so it is stated where both sides can see it: the
// assembly-site slice and the render cap must be the SAME number. If the slice
// were smaller, the render would cap a list that had already been trimmed and the
// "+N more" would still be right (it counts off stats.total, not the array) — but
// the card would silently show fewer bills than it claims to cap at.
export const COMPACT_BILLS_CAP = 10;
export const COMPACT_COMMITTEE_CAP = 10;

// NOT sliced upstream, deliberately, and this is the asymmetry to preserve: the
// committees column computes its "+N more" from the PRE-CAP array length, because
// the roster is the whole set as fetched. Slice committees at the assembly site
// and that closer starts under-reporting — the exact defect commit 1 moved the
// bills gate off stats.total to avoid.
