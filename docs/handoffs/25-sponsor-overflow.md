# Fix sponsor [Party-State] overflow on the bill feed

## Problem

On `/`, long bill titles push the sponsor's `[R-IN]` party-state badge off
the right edge of the title cell. Rows like `S 4476` (AI workforce
disclosure bill) and `SRES 707` (China-in-Latin-America resolution) are
unreadable past the title — the sponsor info, which is the most useful
contextual signal in the feed, is the thing being clipped.

Reference for the desired pattern: https://ccbt-eta.vercel.app/. That
sister site puts the bill title on line 1 and the sponsor on line 2, so
the party/district badge is always visible regardless of title length.

## What to change

`components/BillRow.tsx` (or wherever the title/sponsor cell is rendered)
currently joins title and sponsor with `·` into a single truncating
string. Restructure that cell into a two-line stack inside the existing
`1fr` column:

- Line 1: bill title only. Truncate with ellipsis on overflow.
- Line 2: sponsor name + `[R-IN]` badge. Sponsor name truncates if it's
  unusually long; the bracketed party-state never shrinks and never gets
  hidden.

Color the bracketed badge using the party CSS variables already defined
in the design system:

```tsx
const partyColor =
  party === 'R' ? 'var(--party-republican)'
  : party === 'D' ? 'var(--party-democrat)'
  : 'var(--party-independent)';
```

Sketch of the cell markup:

```tsx
<div className="min-w-0 flex flex-col leading-tight">
  <span className="truncate text-[var(--text-primary)]">
    {title}
  </span>
  <span className="truncate text-xs text-[var(--text-muted)]">
    {sponsorName}
    {sponsorParty && sponsorState && (
      <span
        className="ml-1.5 shrink-0"
        style={{ color: partyColor }}
      >
        [{sponsorParty}-{sponsorState}]
      </span>
    )}
  </span>
</div>
```

The outer `min-w-0` is required for `truncate` to work inside a grid
`1fr` column — without it the cell will refuse to shrink and the whole
row will overflow horizontally instead.

If the same title/sponsor concatenation exists in `BillRow`'s expanded
state, the inline-expanded view, or the `/bill/[id]` header, leave those
alone for now — this change is only the collapsed feed row.

## Spot-checks before pushing

- `HR 8648` (short title) — sponsor on its own line, no awkward double-wrap, row height looks intentional.
- `S 4476` (very long title) — title truncates with `…`, `Warner [D-VA]` fully visible underneath in muted gray + blue.
- `SRES 707` (very long resolution title) — same: title truncates, `Shaheen [D-NH]` visible.
- A row sponsored by an independent (e.g. King, Sanders if any of their bills are in the feed) — `[I-VT]` / `[I-ME]` renders in the independent purple `--party-independent`.
- Mobile / narrow viewport — title and sponsor lines truncate independently; the row doesn't break layout or push the stage / date / topics columns off-screen.
- Inline-expanded state — verify the row still expands cleanly and the new two-line cell doesn't introduce a vertical jump on click.

## Out of scope

- Don't touch `/bill/[id]`.
- Don't change the grid column widths (`24px 70px 1fr 90px 80px 110px`).
- Don't adjust row vertical padding beyond the minimum needed to fit two lines comfortably; the feed should stay dense.
- Don't rename CSS variables or introduce new ones — `--party-republican`, `--party-democrat`, `--party-independent` already exist.
