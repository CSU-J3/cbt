# HO 179.1 — Tape fixes, round 2 (on ho-178, before merge)

## Why

HO 179 fixed the cursor, the LegendBadge, and improved things, but the re-eyeball shows three tape issues remain **at all widths**:

1. **The hover popover STILL clips behind the bottom tape / nav.** Removing `z-index:5` from `.markets-tape` (HO 179 #4) was not sufficient — a top-tape (equities) popover still gets cut off (the "Technology · +1.04% · as of…" popover is clipped top-center). There's a *second* trap.
2. **The tapes are still too sparse** at all widths — the dynamic-copies fix (HO 179 #3) didn't fully resolve the gaps.
3. **Two "AS OF … UTC" stamps** — one per tape. They poll the same data at the same time, so this is redundant. **Only one is needed.**

These are the last blockers before the HO 178+179 reflow merges. Still on `ho-178-dashboard-reflow`.

## Phase 1 — Diagnostic (HALT after)

### 1. Popover STILL clipped (the priority — the obvious fix didn't work)
The z-index:5 removal didn't fix it, so the cause is something else. Investigate BOTH possibilities:
- **A clipping ancestor (most likely).** The tape has `overflow-x: clip` (added for the hover-expand in HO 176/177). Even with `overflow-y: visible`, a popover dropping DOWNWARD out of the tape can be clipped by `overflow-x: clip` on the tape OR by an `overflow` on a parent (`.home-header`, the tape-block wrapper, `.home-main`). `clip`/`hidden` cuts the popover regardless of z-index — this is different from a stacking problem. Walk the ancestor chain from the popover up to the root and report EVERY element with a non-visible `overflow` (x, y, or both) that could clip a downward-opening popover.
- **A remaining stacking context.** Re-check: after removing the tape's z-5, is there still an ancestor establishing a stacking context that traps the z-60 popover below a later-painting sibling (the bottom tape, the nav)? Check `.home-header`, the tape wrapper, transforms, filters, `will-change`, `position`+z-index combos.
- **Report the actual cause** (clip vs stack vs both) and the fix. If it's a clipping ancestor, the popover may need to render outside the clipped subtree — e.g. portal it to the header root, or restructure so the popover's container isn't inside an `overflow:clip` element. Report the cleanest fix that lets a downward popover from EITHER tape fully show over the bottom tape + nav.

### 2. Still sparse
HO 179 added dynamic copies `max(2, ceil(container/setWidth))`. It's still sparse, so either the copy count isn't actually filling the width, or there's dead space WITHIN the set. Re-measure live: report the actual single-set width, the computed copy count, the resulting half-width, and the container width. Determine why gaps remain:
- Is the copy count too low (measurement off, or `setWidth` measured before fonts/values settled)?
- Is there dead space inside each set (the empty change/arrow slots on the 6 first-tick null-change symbols — they reserve 7ch+arrow but render empty, creating visible gaps)? If the null-change empty slots are a real contributor, consider rendering nothing (zero width) for a null change instead of reserving the slot — BUT only if that stays jump-proof (a symbol going from null→a value next session would then change width once; acceptable as a one-time settle, or reserve the slot only when the symbol has ever had a value). Report the tradeoff.
- Report the real cause and the fix to make both tapes read dense at all widths.

### 3. Dedupe "AS OF"
Two tapes each render their own `AS OF … UTC` meta. They share the same poll/timestamp. Report the cleanest way to show ONE: either (a) render the meta on only one tape (the bottom one), or (b) hoist a single shared timestamp to the tape-block level, outside both tapes. Recommend (a) if simplest. Confirm removing one meta doesn't reintroduce the overlap fix from HO 179 on the remaining one.

**HALT. Report: the real popover-clip cause (clip ancestor vs stacking, with the overflow-chain walk) + fix, the sparse re-measurement + fix, and the AS OF dedupe approach. The popover one is the priority — the last fix missed it, so confirm the actual cause this time before patching. Wait for sign-off.**

## Phase 2 — Implementation (after sign-off)
- Fix the popover so a downward popover from either tape fully renders above both tapes + nav (per the real cause).
- Make both tapes dense at all widths.
- One AS OF stamp.
- Preserve: jump-proof geometry, hover-pause, the HO 179 cursor/meta/badge fixes, charts.

## Verification
- Hover a TOP-tape ticker at multiple widths → popover fully visible over the bottom tape + nav, not clipped. (This is the one that's failed twice — verify carefully.)
- Both tapes read dense at narrow AND wide widths; still jump-proof through 2+ poll cycles.
- Exactly one AS OF timestamp.
- Type check passes.
- Stay on ho-178; Corey re-eyeballs, then merge 178+179+179.1 as one unit.

## Out of scope
- No body/chart changes.
- The breaking cross-column overrun (still a deferred small follow-up if it doesn't fire — not a blocker).
