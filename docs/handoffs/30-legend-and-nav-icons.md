# Move stage legend up + add icons to nav links

Two unrelated polish items.

---

## 1. Move the stage legend out of the footer

### Problem

The stage key (`▸ INTRO · ▸ COMMITTEE · ▸▸ FLOOR · ▸▸▸ OTHER CHAMBER · ▸▸▸▸ PRESIDENT · ✓ ENACTED`) currently lives in the footer. By the time a user scrolls past 100 rows of bills to reach it, they've already given up trying to figure out what `▸▸` means.

### Fix

Move the legend immediately **above the feed's column header row**
(`BILL · TITLE / SPONSOR · STAGE · ACTION · TOPICS`). That's where
users look when they're decoding a row.

Render it as a single thin muted line in the same monospace,
right-aligned with the STAGE column or full-width, whichever sits
better visually. Use `--text-muted` for the labels and the existing
stage colors for the indicators (`--stage-introduced`,
`--stage-committee`, etc.) so each `▸` glyph reads as the same color
it appears in the feed below.

Delete the legend from `FooterLegend.tsx` (or wherever it currently
renders). The footer can shrink or, if it's now empty, be removed
entirely. Don't leave a vestigial footer with just a copyright line —
this is a personal dashboard, no copyright needed.

If the footer has other content (the README implied it might), keep
that and only remove the legend portion.

### Verify

- Legend sits above the column headers, visible without scrolling.
- Each `▸` group is colored to match the stage colors used in the feed rows.
- Mobile width — legend wraps cleanly or scrolls horizontally without breaking layout.
- Pages 2+ also show the legend (it's part of the feed chrome, not page-1-only).

---

## 2. Add icons to SPONSORS and DESK nav links

### Problem

`SPONSORS` and `DESK` are bare text. `⏳ STALE` and `★ WATCHLIST` have
icons. Visually inconsistent.

### Fix

In `HeaderBar.tsx` (or wherever the nav links live), add a leading
glyph to each:

- `👥 SPONSORS` — busts-in-silhouette, plural matches the link.
- `✒ DESK` — fountain pen nib, evokes the President signing at his
  desk and ties to the route's purpose (`/president`).

Keep the same spacing and rendering rules already used for the
existing two. If the existing icons render with a small right-margin
or specific font-size override, mirror that for the new ones.

If `👥` renders as full-color emoji and clashes with the rest of the
header (which uses monochrome glyphs), fall back to `⚇` or a simple
person-like Unicode char. Same fallback for `✒` if it renders too
small — `🖋` is a heavier alternative.

### Verify

- All four nav links have leading icons, evenly spaced.
- Hover / active states still work on each.
- Mobile width — icons don't push the nav off-screen or wrap awkwardly.
- Icons render across Chrome, Safari, Firefox at roughly the same visual weight as `⏳` and `★`.
