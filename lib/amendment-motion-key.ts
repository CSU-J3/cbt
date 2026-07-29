// HO 557 — the Senate MOTION-model leaf, the sibling of lib/amendment-vote-key.ts.
// A LEAF for the same reason that one is (the lib/median.ts shape, HO 430): a
// scripts/ entry point and diagnostics import it, and it must not drag next/cache.
//
// SCOPE — the mirror image of amendment-vote-key.ts's scope note, which names this
// exact model. That leaf matches ONLY the up-or-down vote on the amendment
// ("On the Amendment S.Amdt. N …"). THIS leaf matches the residual: the Senate roll
// calls that TOUCH an amendment via a MOTION about it — Motion to Table, Cloture
// Motion, Decision of the Chair, and "Motion to Waive … Budgetary Discipline Re: …
// Amdt. No. N". Their yea/nay is on the MOTION, not the amendment, so the polarity is
// inverted (tabling) or orthogonal (cloture/chair) and the amendment-framed VoteLine
// renders them wrong — which is exactly why they were EXCLUDED there and modeled here.
//
// Measured (HO 550 M1 / HO 554), vocabulary CLOSED, tail 0:
//   table 9 · cloture 4 · chair 1 · waiver 50 = 64 residual roll calls.
// The number token differs by class: table/cloture/chair carry `S.Amdt. N`; the waiver
// form carries `Amdt. No. N` — but the SAME Senate S.Amdt namespace (HO 550 confirmed
// by a 42/43 sponsor-surname match, not a parallel numbering). This is the non-obvious
// part: a waiver's `Amdt. No. 2446` resolves to `{congress}-samdt-2446`, same as the rest.

import { SENATE_AMDT_QUESTION_LIKE } from "./amendment-vote-key";

export type MotionClass = "table" | "cloture" | "chair" | "waiver";

// The residual pre-filter PAIR, exported as one object so a consumer can't apply one
// half without the other: mentions an amendment (`like`) AND is NOT the up-or-down form
// (`notLike`, imported from the vote-key leaf so the two leaves can't drift). A SQL
// consumer does `question LIKE like AND question NOT LIKE notLike`.
export const SENATE_MOTION_RESIDUAL = {
  like: "%Amdt%",
  notLike: SENATE_AMDT_QUESTION_LIKE,
} as const;

// The four anchored forms. Returns null for the tail (measured 0) — a tail row must be
// droppable by TYPE, not renderable as a class the model can't reason about. If the
// vocabulary ever grows, an unmatched row silently drops rather than rendering wrong.
export function classifyMotion(question: string): MotionClass | null {
  if (/^On the Motion to Table S\.Amdt\./.test(question)) return "table";
  if (/^On the Cloture Motion S\.Amdt\./.test(question)) return "cloture";
  if (/^On the Decision of the Chair S\.Amdt\./.test(question)) return "chair";
  if (/^On the Motion \(Motion to\s+Waive.*Amdt\. No\.\s*\d+/i.test(question)) return "waiver";
  return null;
}

// The waiver form keys on `Amdt. No. N`; the other three on `S.Amdt. N`. Both resolve
// into the SAME Senate S.Amdt namespace (see the header — the 42/43 sponsor match).
export function parseMotionAmendmentNumber(cls: MotionClass, question: string): number | null {
  const re = cls === "waiver" ? /Amdt\. No\.\s*(\d+)/i : /S\.Amdt\. (\d+)/;
  const m = question.match(re);
  const n = m ? parseInt(m[1] ?? "", 10) : NaN;
  return Number.isFinite(n) ? n : null;
}

// The MOTION's own outcome from votes.result (what the render prints as the verb).
export function motionOutcome(result: string | null): "agreed" | "failed" | "other" {
  if (!result) return "other";
  const r = result.toLowerCase();
  if (/not agreed|rejected|failed|defeated/.test(r)) return "failed";
  if (/agreed to|passed|sustained|adopted/.test(r)) return "agreed";
  return "other";
}

// The AMENDMENT's implied fate — KILL-DIRECTION ONLY (HO 557 §1 ruling). This asymmetry
// is the whole point of the module: a tabling motion and a budget waiver are KILL
// mechanisms. A tabling motion SUCCEEDING, or a budget waiver FAILING, ends the amendment
// right there. The opposite outcome only means "not killed by THIS motion" — the amendment
// is still pending, NOT adopted — so it's "undecided", never a positive fate.
//
// The §1 gate found this the hard way: 119-samdt-3946/3947 both had their tabling motion
// FAIL (so they survived that motion) but each later "fell when SA N fell" — so a
// "survived" clause would have contradicted a correct red HO 555 dot. cloture and chair
// are ORTHOGONAL — they decide procedure, not the amendment's fate, and must never produce
// one. No "unknown" member: an unclassifiable motion result and "the motion didn't decide"
// are the same thing at the render, and both are "undecided".
export function motionFate(
  cls: MotionClass,
  outcome: "agreed" | "failed" | "other",
): "killed" | "undecided" | "orthogonal" {
  if (cls === "table") return outcome === "agreed" ? "killed" : "undecided"; // tabling agreed = the kill
  if (cls === "waiver") return outcome === "failed" ? "killed" : "undecided"; // waiver failed = falls on the point of order
  return "orthogonal"; // cloture / chair — procedure, not fate
}
