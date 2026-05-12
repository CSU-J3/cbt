# Move the party color key out of the footer

## Problem

Handoff 30 moved the stage indicator legend up, but the party color
key (`■ R · ■ D · ■ I`) is a separate component still living at the
bottom of the page. Same problem, same fix.

## Fix

Move the party key to sit alongside the stage legend above the feed.
Combine them into a single line if it fits:

```
LEGEND  ▸ INTRO · ▸ COMMITTEE · ▸▸ FLOOR · ▸▸▸ OTHER CHAMBER · ▸▸▸▸ PRESIDENT · ✓ ENACTED   ·   ■ R · ■ D · ■ I
```

If that's too wide on desktop, stack them as two muted lines in the
same block above the column header row. On mobile, two lines is fine.

The party swatches must use the same CSS vars as the badges in the
feed (`--party-republican`, `--party-democrat`, `--party-independent`)
so the legend is the visual key for what users see in the rows.

Delete the party key from wherever it lives at the bottom (likely the
same `FooterLegend.tsx` or a sibling). If the footer is now empty,
remove it.

## Verify

- Both legends sit above the feed, visible without scrolling.
- Footer is gone or contains only non-legend content.
- Party swatches in the legend match the colors of `[R-IN]`, `[D-CA]`, `[I-VT]` badges in the rows below.
- Pages 2+ also show the legends.
- Mobile width — legends stack cleanly, no horizontal overflow.
