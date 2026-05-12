# /sponsors page cleanup

Three issues visible in the v1 render. All small.

## 1. Duplicate party-state badge

Every row shows the sponsor's `[D-MA]` twice — once embedded in the
name string (`Sen. Markey, Edward J. [D-MA]`) and once as a separate
chip in the column next to it. The DB's `sponsor_name` field already
contains the bracketed party-state, so adding the standalone chip
doubles it.

**Fix:** drop the standalone chip column. Keep the name string as-is.
The party color on the bar already encodes the party visually; the
bracket inside the name covers the redundancy needed for accessibility
/ search.

If the standalone chip was added so the bar row could stay
party-colored without parsing the name string, just thread the
`sponsor_party` field straight into the bar's color logic and don't
render the chip.

## 2. Bars don't fill the bar-track

The #1 sponsor (Markey, 15 bills) only fills ~70% of the available
horizontal space. That kills the visual comparison since every bar
gets squashed into the same fraction of the row.

The width calculation is using the wrong denominator — probably the
total row width, or a percentage that includes margin/padding from a
parent. The bar should be `(bill_count / max_count) * 100%` of the
**bar track's width**, where the bar track is the empty area between
the name column and the count column. The top sponsor's bar should hit
~100% of that track.

Audit:
- What CSS variable / value is the bar's `width` calculated against?
- Is the bar inside a flex / grid cell that's narrower than expected?
- Is there padding inside the bar track that's eating space?

Fix the math so #1 = full track, everyone else scales proportionally
to that.

## 3. Long sponsor names truncate

`Rep. Begich, Nicholas J. [R-AK-At Lar...]` clips with ellipsis. After
fixing #1, the name column has more breathing room, so this might
resolve on its own. If it doesn't:

- Widen the name column by ~20–30px, or
- Accept the truncation but ensure the full name shows in a `title`
  attribute on hover.

Either is fine. Don't introduce a tooltip library — native browser
title attribute, same pattern as the topic chip tooltips.

## Verify

- Each row has exactly one `[D-MA]`-style party-state indicator.
- Bar at rank 1 (currently Markey, 15 bills) fills the full bar track horizontally.
- Bar at rank 100 (currently 4 bills) scales to roughly 4/15 ≈ 27% of the track. Eyeball it.
- All sponsor names in the visible top 100 fit without truncation, or truncate with a hover title attribute.
- Mobile width — same fixes hold; bars don't overflow, names truncate gracefully.
