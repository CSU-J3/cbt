// HO 537 — the shared Senate amendment-vote key parser, extracted to a LEAF module
// so BOTH the request-time parse (getBillAmendmentVotes, lib/queries.ts) AND the
// sync-time materializer (lib/amendment-votes-senate.ts) compute the IDENTICAL
// link. Two mechanisms deriving the same value is the drift risk the
// NEWS_ARTICLE_KEY_SQL (HO 515) and MISSED_CARVE_EXPR (HO 535) extractions exist to
// prevent. It has to be a leaf (the lib/median.ts shape, HO 430): a scripts/ entry
// point imports the materializer, and lib/queries.ts drags next/cache — a node
// script can't pull that in.
//
// SCOPE — this matches ONLY up-or-down votes on the amendment itself
// ("On the Amendment S.Amdt. N ..."). Procedural votes that TOUCH an amendment —
// Motion to Table, Cloture Motion, "Motion to Waive All Applicable Budgetary
// Discipline Re: ... Amdt. No. N", Decision of the Chair — are DELIBERATELY
// EXCLUDED. Their yea/nay is on the MOTION, not the amendment, so the tally
// polarity is inverted or orthogonal to the amendment's fate: a "Motion to Table
// Agreed to" is a KILL, a "Motion to Table Failed" leaves the amendment ALIVE, and
// deriveDisposition + the amendment-framed VoteLine render both wrong. M8/HO 537
// measured it: of 161 senate votes mentioning "Amdt", 97 are up-or-down (this
// matcher), 64 are procedural (14 in S.Amdt-N form, 50 budget waivers) — and
// resolving an S.Amdt number is NECESSARY, not SUFFICIENT, to be the amendment's
// vote. Do NOT widen this without a motion-aware model (invert tallies, distinguish
// cloture from adoption, suppress when an anchored vote already exists) — that's a
// banked surface, not a matcher tweak.

// The first S.Amdt number in the question is the VOTED amendment, even when it
// amends another amendment ("S.Amdt. 14 to S.Amdt. 8 to S. 5" → 14). Anchored to
// the start so only the up-or-down form matches.
export const SENATE_AMDT_Q = /^On the Amendment S\.Amdt\. (\d+)\b/;

// The SQL LIKE pre-filter for the same up-or-down form (coarse filter before the
// regex). Exported so the query + the materializer share ONE predicate string —
// they can't drift if they import the same const.
export const SENATE_AMDT_QUESTION_LIKE = "On the Amendment S.Amdt.%";

export function parseSenateAmendmentNumber(question: string): number | null {
  const m = question.match(SENATE_AMDT_Q);
  if (!m) return null;
  const n = parseInt(m[1] ?? "", 10);
  return Number.isFinite(n) ? n : null;
}

// HO 551 — the HOUSE counterpart, added after HO 550's M5 found the walk had NO
// question filter (it linked EVERY recordedVote off a HAMDT's /actions) and was
// rendering procedural House roll calls as the amendment's own outcome. The House
// vote_id is CONSTRUCTED from the recordedVotes payload (which carries no question),
// NOT parsed from it — so amendment-votes-walk.ts JOINs `votes` at link time and
// applies this predicate, the mirror of the Senate materializer's SENATE_AMDT_Q gate.
//
// SCOPE — matches ONLY the up-or-down House amendment vote: "On Agreeing to the
// Amendment" (± ", as Modified" / ", as Amended" — the prefix covers them). A
// procedural roll call Congress.gov attaches to a HAMDT's /actions — "On Ordering
// the Previous Question" (ends debate; decides WHETHER the House votes, not what) —
// is EXCLUDED. STEP 0 (HO 551) enumerated ALL 92 House-linked questions: 90 decisive
// ("On Agreeing to the Amendment" ×89 + ", as Modified" ×1), 2 procedural ("On
// Ordering the Previous Question", on 119-hamdt-40 / vote house-119-1-187 and
// 119-hamdt-175 / vote house-119-2-122). Vocabulary is CLOSED; both offenders ALSO
// carry their real "On Agreeing to the Amendment" vote, so dropping the procedural
// link leaves the decisive one intact. Do NOT widen this to a motion form without a
// motion-aware model (the banked HO 537 M8 surface) — a procedural tally rendered as
// the amendment's outcome is the exact wrong-data bug this predicate prevents.
export const HOUSE_AMDT_QUESTION_LIKE = "On Agreeing to the Amendment%";
export const HOUSE_AMDT_Q = /^On Agreeing to the Amendment\b/;
