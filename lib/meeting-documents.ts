// HO 717: the recorded-vote pointer — one predicate, nothing parsed.
//
// Import-safe on purpose (no next/cache, no db): the sync (lib/meetings-sync.ts,
// run by tsx scripts) and the readers (lib/queries.ts) both read this one file, so
// the predicate has exactly one copy. A third rule is a SKILL edit here, not a
// second copy anywhere.

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
