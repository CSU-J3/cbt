// HO 717: the recorded-vote pointer — one predicate, one link target, nothing parsed.
//
// Import-safe on purpose (no next/cache, no db): the sync (lib/meetings-sync.ts,
// run by tsx scripts), the readers (lib/queries.ts) and the client rows
// (HearingRow, HearingDetailCard) all read this one file, so the predicate has
// exactly one copy. A third rule is a SKILL edit here, not a second copy anywhere.

/**
 * A committee_meeting_documents row is a recorded-vote document when it is typed
 * `Committee Recorded Vote`, or typed `Support Document` with "Roll Call" in its
 * name — the two rules HO 715 measured (Appropriations files every roll call as a
 * `Support Document` named "… – Roll Call Votes"). Unqualified column names, for a
 * WHERE over committee_meeting_documents. A NULL name fails LIKE and falls through,
 * which is correct: a nameless document cannot be a matched roll-call record.
 * What it counts is DOCUMENTS, not roll calls — a compiled file holds many votes,
 * and some vote-typed documents are voice-vote summaries.
 */
export const RECORDED_VOTE_DOC_SQL =
  "(document_type = 'Committee Recorded Vote' OR (document_type = 'Support Document' AND name LIKE '%Roll Call%'))";

/**
 * The link target: the House Committee Repository's listing of the meeting's
 * documents, built from the event id. Chosen over the congress.gov event page at
 * the HO 717 STEP 0 ruling: the repository answers 200 and lists every file by type
 * with its Added time, and is the same index Congress.gov mirrors (HO 715 row 2,
 * identical by filename on 60 of 60); the congress.gov page is absent from videos[]
 * on 9 of 33 events and answered 403 behind a Cloudflare challenge on all 24 that
 * carry it. House only: the repository is the House's, and v1 renders no Senate
 * affordance. A listed file is not a guaranteed file — the listing can name a PDF
 * its host serves as an HTTP-200 "Not Found" page (HO 715, event 119200).
 */
export function repositoryEventUrl(eventId: string): string {
  return `https://docs.house.gov/Committee/Calendar/ByEvent.aspx?EventID=${encodeURIComponent(eventId)}`;
}

/** Tooltip copy: what the number is, where the link goes, and what is not claimed. */
export function recordedVotesTitle(n: number): string {
  return `${n} recorded-vote document${n === 1 ? "" : "s"} — opens the House Committee Repository's listing; the committee's own record, not parsed here`;
}
