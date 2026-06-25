# HO 351 — Filler Watch weekly bar (dashboard WeeklyBand)

> Claim the next free HO number; if 351 is taken, use the next available and
> rename. Independent of the Patterns and Stale work.

Append a one-segment filler-proportion bar to the `WeeklyBand` strip,
right-pinned before `READ FULL`.

**Placement confirmed by the HO 344 layout check:** `.weekly-band` is flex-wrap
with no fixed height, `READ FULL` is `margin-left: auto`. The bar slots in before
it without growing box height. The only risk is flex-wrap kicking the segment to
a second row at narrow widths, so keep it compact.

**Numbers — compute live each render** (the snapshot 6 of 68 ≈ 9% changes
weekly):

- Denominator = this week's TOTAL introductions, ceremonial included, using the
  `WeeklyBand`'s existing this-week date window. This is NOT the strip's
  `NEW BILLS` count (which excludes ceremonial and would be the wrong
  denominator).
- Numerator = filler this week, broad definition: `is_ceremonial = 1 OR cluster_id
  in the four ceremonial patterns`, deduped to distinct bills.
- Current snapshot to sanity-check: 6 of 68 ≈ 9%.

The segment carries its own fraction and percentage so the /68 denominator doesn't
read as inconsistent with the strip's displayed `NEW BILLS` (64). Label it as
filler share, e.g. `FILLER 9% · 6/68`.

**Context, don't second-guess:** the cumulative ceremonial read lives on the
Patterns tab; the dashboard carries ONLY this weekly bar. Don't add the cumulative
read here — two filler reads on one no-scroll screen was the redundancy to avoid.

Constraints: static, no new tokens, mono. One segment, compact.

Ship: `tsc`, confirm the dashboard renders styled (stylesheet 200), named
`git add` only, push, `npm run verify:deploy` until SHA matches.
