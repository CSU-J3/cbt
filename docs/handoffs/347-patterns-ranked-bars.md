# HO 347 — Patterns cluster as ranked bars (supersedes HO 128 PatternBubbleSVG)

> Claim the next free HO number; if 347 is taken, use the next available and
> rename. Run this after the Patterns meta-line handoff (shares the page header
> area). The Filler Watch strip handoff comes after this one.

Replace the packed-circle `PatternBubbleSVG` with a ranked horizontal bar list in
the left column, absorb the standalone `ALL PATTERNS` table into it, and let the
right column become the bills drill-in full-time. The bubble idiom was built for
hundreds of OTX clusters; five patterns read better as bars where length lands
without effort and the table redundancy disappears.

**Before removing anything:** grep that `PatternBubbleSVG` and the `ALL PATTERNS`
table have no other live importers. If anything else imports them, HALT and
report. Print-before-delete.

**Left column — bar list.** One row per pattern, sorted count desc:
Awareness designation 624 · Honoring resolution 349 · CRA disapproval 196 ·
Facility naming 128 · Sense of Congress 124.

- Row = name + slug, horizontal bar, count, % past committee (its own column).
- Bar length = bill count (linear).
- Bar color = % past committee on the existing STALLED→MOVING ramp
  (`--stage-grey #4b5563` → `--moving #10b981`), the same ramp the bubbles used.
  No new colors. Awareness and CRA read green (moving); Honoring, Facility, Sense
  read grey (stalled).
- **Per-pattern % past committee: compute live.** Reuse the HO 344 Filler Watch
  query, group by cluster, and ADD `cra-disapproval` (it's in the bars; it was
  excluded from Filler Watch). Past committee = `stage IN
  ('floor','other_chamber','president')`, enacted excluded — same definition as
  the diagnostic. Don't hardcode; these move every sync.
- Legend: `BAR LENGTH = BILL COUNT · COLOR = % PAST COMMITTEE`, STALLED↔MOVING
  ramp.

**Right column — bills.** `RECENT BILLS · [SLUG]` for the selected pattern.

**Below the bars — detail strip** for the selected pattern:
`PATTERN [name] · N bills · X% past committee · Y enacted`, then blurb, then
`TOP SPONSORS` bars, then `[ VIEW ALL N BILLS IN FEED → ]`.

- REMOVE the `% ceremonial` stat from this strip. It used the per-bill classifier
  flag and contradicts the form-based Filler Watch framing sitting above it. The
  strip reads volume, movement, outcome only.

**Interaction.** Click a bar → highlight it (amber left rail, name in
`--accent-amber-bright`), load that pattern's bills on the right, drop its detail
strip in below the bars. In-place panel, NOT a jump to the `?cluster=` feed.

**Resolved (was open in the spec):** on load, auto-select the top bar (Awareness)
so the right column is never blank. No empty-prompt state.

**Don't act on (deferred):** dropping the bar color if it reads doubled against
the number column. Keep color for now.

Constraints: static, no new tokens, mono.

Ship: `tsc`, confirm the Patterns page renders styled (stylesheet 200), named
`git add` only, push, `npm run verify:deploy` until SHA matches.
