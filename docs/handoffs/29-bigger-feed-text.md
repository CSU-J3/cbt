# Bump feed text size for readability

## Problem

Now that pagination exists, the feed doesn't have to cram everything
into one screenful. The current text is denser than it needs to be —
fine when the goal was "as many bills as possible in view," not so
fine for actually reading bill titles and sponsor info comfortably.

The terminal aesthetic stays — we're not turning it into a blog. Just
one Tailwind step up across the row.

## What to change

`components/BillRow.tsx`. Bump each text element one Tailwind size:

- Title (line 1): `text-sm` → `text-base`
- Sponsor + party badge (line 2): `text-xs` → `text-sm`
- Bill ID column: `text-sm` → `text-base` (or whatever it currently uses, +1 step)
- Stage column: same +1 step
- Action date column: same +1 step
- Topic tags: same +1 step

Keep `leading-tight` so the row doesn't bloat vertically more than
necessary. Stay on monospace where it's already used (bill ID, dates,
topic codes); don't switch fonts.

## Grid columns may need adjusting

Current grid: `24px 70px 1fr 90px 80px 110px`. The fixed columns were
sized for the smaller text. After the bump:

- Bill ID column at 70px may truncate on longer IDs like `HJRES 158`. Eyeball it; widen to ~80–85px if it clips.
- Stage column at 90px should still fit `OTHER CHAMBER` since it abbreviates with the `▸▸▸` indicator + short label. Verify.
- Action date at 80px — `04-30-26` should still fit in the bigger font. Verify.
- Topics column at 110px holds 2–3 short topic codes (`GOV · CRIM`). May start wrapping. Bump to ~130px if it does.

Don't widen anything that doesn't need it. Only adjust columns that
actually clip after the text bump.

## Header / filter bar

Don't bump the header bar (`HeaderBar`), filter chips, or stage
dropdown text. They're already sized appropriately and bumping them
would make the chrome feel disproportionate to the feed.

The column header row (`BILL · TITLE / SPONSOR · STAGE · ACTION · TOPICS`)
should match the feed row's bill-ID-column size for visual alignment,
so bump those labels too.

## Verify

- Side-by-side: feed before vs after — text is meaningfully larger but
  rows still feel terminal-dense, not airy.
- HR 8648 (short title), S 4476 (long title), HJRES 158 (long bill ID),
  rows with `OTHER CHAMBER` stage, rows with three topic tags — all
  render without clipping or unintentional wrapping.
- Inline-expanded state still looks coherent — the expanded panel was
  presumably sized in proportion; if it now feels cramped, leave it for
  a follow-up rather than fixing here.
- Mobile width — text bump shouldn't push columns off-screen. If it
  does, narrow the topic column or hide the action date column on
  small screens (Tailwind `sm:` breakpoint).

## Out of scope

- Don't touch `/bill/[id]`.
- Don't touch the watchlist page styling.
- Don't redesign the row layout beyond the size bumps and any column
  width adjustments forced by the bumps.
