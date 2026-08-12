// HO 631 — the COMPACT density's caps for SponsorExpandedPanel, in a LEAF module.
//
// SOLE CONSUMER SINCE HO 647: components/SponsorExpandedPanel.tsx, which slices
// to these and computes each column's "+N more" against them. The leaf exists
// because that component is "use client" — putting the numbers in the component
// would make any server-side reader import a module whose transitive graph
// reaches a client component; putting them in `lib/queries` would give the
// component a runtime dependency on the query layer. A leaf with no imports is
// the house answer to exactly this, the same reason `lib/amendment-vote-key.ts`
// exists. That constraint is unchanged and this file stays.
//
// THE ABSENCE BAND NO LONGER READS THIS FILE. Until HO 647 the band's assembly
// site imported COMPACT_BILLS_CAP and this header carried a coupling clause —
// that getAbsenceWatch slices `recentBills` before caching, and that the
// assembly-site slice and the render cap must be the SAME number. Both clauses
// are now false: the band projects its own narrow payload and caps it with
// ABSENCE_BACK_BILLS_CAP (lib/queries.ts), which is 3, not 10. The band's own
// committees-are-not-sliced asymmetry moved with it, to the projection that has
// to honour it. Do not re-add a band clause here; a shared constant with two
// different right answers is what got split.
export const COMPACT_BILLS_CAP = 10;
export const COMPACT_COMMITTEE_CAP = 10;
