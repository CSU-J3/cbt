# HO 197 — Members page: productivity scatter legibility (3 of 4)

## Why

Third of four `/members` redesign handoffs (195 chrome, 196 list bar shipped). The dual HOUSE/SENATE productivity scatter (bills log-x vs pass-rate y) has real value — pass rate has genuine spread (Cole 36%, Scalise 33%, Begich 15%) so the y-axis is meaningful — but the labels are a mess: overlapping stacks like "NortonNadlerBiggs" (House) and "Hagerty/Capito" (Senate) pile on top of each other, and the huge 0%-pass mass smears into an unreadable line on y=0. **Fix legibility — don't replace the chart.**

## The changes

1. **Label threshold.** Render an in-chart label only for points **above ~10% pass rate OR above ~100 bills**. Everything else is hover-only (the dot stays, the label doesn't). This alone kills most of the clutter (the bulk of members are low-pass, low-volume).

2. **Collision dodge.** Even among labeled points, suppress a label if another already-labeled point is within ~N px (Code picks a sensible N for the label font size). This kills the residual stacks (the Norton/Nadler/Biggs and Hagerty/Capito/Britt pileups where several labeled points cluster). When suppressed, the dot remains and the name is hover-only.

3. **Zero-pass jitter.** The 0%-pass mass (most members) currently smears into a single line on y=0. Apply a slight vertical jitter (±~3px) to those points so the long tail reads as a **density band**, not a smear. **This is a FLAGGED exception to true-value rendering — presentational only.** The jitter offsets the rendered y; it must NOT change the data the dot represents.

4. **Keep unchanged:** the existing explainer caveat line (pass rate = enacted-stage bills; no-bills members render em-dash not 0%), the VOLUME/PASS RATE toggle, R/D/I party coloring, log-x axis, the 0–30% y-zoom + out-of-range `▲` marker.

## Phase 1 — Diagnostic (HALT after — one real correctness check)

1. **Read the current scatter component** (`MemberProductivityScatter`, per SKILL — hand-rolled SVG, log-x, y-zoom 0–30%, `▲` out-of-range marker, native `<title>` tooltips). Report how labels are currently placed (all points? top-N?) and how a dot maps to its member (the link/tooltip target).

2. **Jitter correctness (the flagged one).** The jitter is presentational — confirm that **hover and click target the TRUE data point, not the jittered position**. Report how the dot's interaction (the `<title>` tooltip + any link wrap) is bound: if the jitter only offsets the rendered `cy`, the hit-target moves with it (fine — you hover where you see it), but the *data* it represents (the member, the real pass rate in the tooltip) must be unchanged. Confirm the tooltip still shows the real values, and the jitter is a stable static offset (not animated, not re-randomized per render — seed it off the member id or index so it doesn't jump on re-render).

3. **Label-threshold + collision data.** Confirm the points carry what's needed to apply the threshold (pass rate, bill count) and to dodge collisions (their rendered x/y positions). Report whether the collision pass can run in the existing render (compute label positions, then suppress within N px) without a structural rewrite.

**HALT. Report the label-placement mechanics, the jitter-correctness confirm (true data point preserved, static seeded offset), and the collision approach. The jitter correctness is the one I want confirmed — presentational offset, real data intact. Then proceed.**

## Phase 2 — Implement (after sign-off)
- Label threshold (~10% pass OR ~100 bills); others hover-only.
- Collision dodge (suppress label within ~N px of another labeled point); dot + hover remain.
- Zero-pass jitter (±~3px, static/seeded, presentational); tooltip shows true values.
- Everything else (caveat, toggle, party colors, log-x, y-zoom, `▲`) unchanged.
- Both HOUSE and SENATE scatters.

## Verification
- The Norton/Nadler/Biggs and Hagerty/Capito/Britt label pileups are gone — only threshold-passing, non-colliding points are labeled; the rest are hover-only dots.
- The 0%-pass mass reads as a density band (jittered), not a smear on y=0.
- Hovering ANY dot (labeled or not, jittered or not) shows the correct member + real pass rate (jitter didn't break the mapping).
- Clicking a dot still goes to the right member.
- Labels that survive are readable (no overlaps).
- Toggle, party colors, log-x, y-zoom, `▲` marker, caveat line all unchanged.
- Type check passes.
- Code uses the running dev server (:3000, hot-reload); Corey eyeballs both charts.

## Out of scope
- Expanded card (HO 198).
- Replacing the scatter or changing its axes/metric.
- Mobile <700 (deferred).
- SKILL.md — flag for the batched sweep (194 + 195–198).
