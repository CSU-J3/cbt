// HO 712 — the pre-write floor for `sync:members`, extracted so it can be
// falsified from a fixture instead of by starving prod.
//
// WHY IT EXISTS. `sync:members` stopped hardcoding the Congress at HO 712, so
// on 2027-01-03 it asks Congress.gov for a roster that may not be populated
// yet. Two of its three write shapes were unguarded:
//   - the `?currentMember=true` roster decides `is_current` for EVERY member
//     it writes; an empty or partial answer marks the whole chamber departed.
//   - the full roster drives `UPDATE members SET is_current = 0 WHERE
//     bioguide_id NOT IN (roster)`; a partial answer inactivates everyone
//     outside it.
// Only the full roster reading exactly zero was checked before (HO 712 STEP 0).
//
// THE BASELINE IS `is_current = 1`, NOT `COUNT(*)`, AND THAT IS THE WHOLE
// DESIGN. `members` accumulates across Congresses — departed members are kept
// as rows (HO 94) — so `COUNT(*)` grows every cycle while a roster stays ~540.
// A ratio against a growing denominator eventually fails on a perfectly good
// roster: at ~1,100 stored rows a real 540-member roster reads 0.49x and the
// guard would abort forever. The count of members the table believes are
// SERVING is roster-shaped and stays flat across Congresses, so it is the
// quantity the floor is actually about. (method.md § Gates — a criterion can
// be perfectly falsifiable and still name the wrong quantity.)
//
// Shape borrowed from lib/participation-refresh.ts:129-137 — zero-row skip
// plus a retain ratio, each failure naming its counts. THE RATIO IS NOT
// BORROWED, and the fixture is why: at that file's 0.5 a half-size FULL roster
// still passes here, because the full roster (555) runs above the serving
// baseline (539), so half of it reads 0.51x. The quantity is different — a
// participation aggregate can legitimately move, a chamber roster is a
// near-constant ~540 whose entire full-vs-current gap is 16 members (3%) — so
// the floor sits where a real answer never lands and a truncated one always
// does. At 0.75 the abort line is 404 of 539; the 119th's own numbers read
// 1.03x and 1.00x.

export const ROSTER_MIN_RETAIN_RATIO = 0.75;

export type RosterFloorInput = {
  /** Human name of the roster, quoted back in the abort message. */
  label: string;
  /** What the API returned. */
  size: number;
  /** What the table holds (`members` WHERE is_current = 1). */
  baseline: number;
  ratio?: number;
};

/**
 * Returns the abort message for a roster that fails the floor, or null when it
 * passes. A zero baseline (first run against an empty table) skips the ratio
 * test but never the zero test — a first run must be able to succeed, and an
 * empty API answer must never be able to.
 */
export function rosterFloorFailure(input: RosterFloorInput): string | null {
  const ratio = input.ratio ?? ROSTER_MIN_RETAIN_RATIO;
  if (input.size === 0) {
    return (
      `${input.label} returned 0 members against ${input.baseline} serving ` +
      "in the table — aborting before any write"
    );
  }
  if (input.baseline > 0 && input.size < input.baseline * ratio) {
    const read = (input.size / input.baseline).toFixed(2);
    return (
      `${input.label} returned ${input.size} against ${input.baseline} ` +
      `serving in the table (${read}x, floor ${ratio}x) — aborting before ` +
      "any write"
    );
  }
  return null;
}

/**
 * Throws on the first roster that fails. Callers pass every roster they are
 * about to write from, so a run either writes from all of them or from none —
 * gating them independently would allow a pass that wrote rows from a good
 * full roster while taking every `is_current` flag from a bad current one,
 * which is the exact corruption the floor exists to prevent.
 */
export function assertRosterFloors(inputs: RosterFloorInput[]): void {
  for (const input of inputs) {
    const failure = rosterFloorFailure(input);
    if (failure) throw new Error(failure);
  }
}
