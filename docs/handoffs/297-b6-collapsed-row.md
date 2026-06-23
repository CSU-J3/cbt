# HO 297 (reissued) — B6 collapsed row

SUPERSEDES the earlier 297 (the chip-migration handoff). The mover-feed mocks landed (b6-mover-expand, b6-tabs-span, b6-stage-bar), so the chip work is now part of the actual collapsed-row redesign, not a recolor-in-place. If you ran the earlier 297, this corrects it: the ID chip goes plain amber (not chamber-color), and the topic tag moves into the collapsed row after the title.

First B6 build slice: the collapsed row, shared across all three tabs. Spec is the rowhead in b6-mover-expand.html / b6-tabs-span.html.

## The collapsed rowhead

Left to right: ID chip, title, topic tag, spacer, metric, caret.

- ID chip: plain amber — amber text, amber border, 11px, weight 600, 2px radius (per the chip-family ID chip), padding 2px 7px. Drop the chamber-color border override; chamber already reads from the HR/S prefix, so the color was redundant, and the mock shows plain amber.
- Title: switch to a sans face. The mocks introduce `--sans: system-ui,-apple-system,"Segoe UI",Roboto,sans-serif` for prose. Add that token to the global CSS variables (this slice is its first use, title only). Title is 14px, --text-primary, single-line with ellipsis (overflow hidden, nowrap). When it truncates, hovering shows a popover with the full title (the `.title-pop`). Use the mock's markTrunc approach (toggle a class when scrollWidth > clientWidth) so the popover only arms on actually-truncated titles.
- Topic tag: moves here, after the title. The probe found it in the expanded view today; relocate it to the collapsed rowhead. Chip-family topic treatment: the real topic color from topic-colors.ts as text, that color at 45% alpha as border, 9.5px, weight 600, 2px radius, letter-spacing .05em. Hover shows a popover with "CODE · Full topic name" (the `.topic-pop`).
- Metric (right): unchanged in this slice. It's the existing per-tab right-side value (movers transition, stalls Nd-stuck, new INTRO·age). Leave it as is.
- Caret: ▾ collapsed.

## Notes

- This introduces the first sans typeface in CBT (titles only, in this slice). Mono stays for the chip, metric, and all chrome. It's per the mock; flagged because it's a departure from the mono-only convention.
- Single-open expand behavior is unchanged; this slice only restyles the collapsed rowhead and relocates the topic tag.
- The expanded view's old topic-tag location is now empty (the tag moved up); don't leave a stray duplicate there.

## Ship

Commit (named `git add`). `git push`, `npm run verify:deploy`, served SHA === HEAD. Live-verify on /dashboard-v2 across the three tabs: plain-amber ID chips, sans titles that ellipsize with a working full-title popover on a long one (the probe's HR 1377-style names), topic tags sitting after the title in their topic colors with the hover popover, metric and expand unchanged.
