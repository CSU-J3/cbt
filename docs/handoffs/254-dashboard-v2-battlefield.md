# HO 254 — Dashboard v2: competitive battlefield (D↔R axis replaces the timeline)

Confirm the next free number before saving: `ls docs/handoffs/ | sort | tail`. Body assumes 254. Builds on HO 253 (the v2 shell at `/dashboard-v2`).

## Source of truth

Visuals: `docs/design/dashboard-2col.html`, the BATTLEFIELD section. Commit the mock from the Design session if it's absent (HO 253 shipped without it and fell back to prose). Where the mock and this doc differ on layout, color, spacing, or marker styling, **the mock wins**. This doc owns the data computation, the thresholds, and the degrade rules — things the mock can't encode.

Match the mock's structure and styling, **not its exact seat set**: the live battlefield reflects current ratings, which drift from whatever snapshot the mock was rendered on. If the mock is still absent at build time, fall back to the structure described here plus `globals.css` tokens and `lib/race-colors.ts`, same as HO 253.

## What this is

Replace the competitive timeline in `CompetitiveRacesBlock` with a D↔R battlefield: one horizontal lean axis (D left, R right), toss-up seats as individual markers above the line, and the rest of the rated competitive field collapsed into lean bands below it. This is net-new — there's no existing component to recover from.

Scope is the battlefield axis only. The race **card list stays as-is** (the rich-card upgrade and the card↔marker cross-highlight are the next handoff). Markers expose their seat ID so that next handoff can wire the link.

Locate the existing competitive timeline inside `CompetitiveRacesBlock` first (the primary-date timeline Design is replacing) and swap the battlefield in its place, leaving the card list intact. If there's no distinct timeline component, mount the battlefield at the top of the COMPETITIVE tab above the cards.

## Resolved premises (don't re-derive — confirmed by the HO 253 diagnostic)

- **Ratings: three raters per seat, stored verbatim, not averaged.** `race_ratings`, composite id `race_id-source`, source ∈ {cook, sabato, inside_elections}. The existing query picks the most-competitive rating; it does **not** average. This handoff adds a new averaging query and does not touch the pick-most-competitive path (`getMostCompetitiveRaces`).
- **Coverage is the rated competitive set, not all 468 seats, and not only toss-ups.** Cook alone rates 35 Senate + 62 House across Toss-up / Lean / Likely / Solid; the other two are similar. Seats rated by only one source can't be averaged and will land on a bucket center — the collision dodge handles those.
- **Incumbent signal is the `seat_incumbent_bioguide` subquery** (state + district, `is_current`), not the raw `incumbent` flag. Use it for marker color. Open seats carry the HO 221 open tag.
- **No market data on the axis.** The axis is pure rating consensus. Kalshi odds, war chest, and 2024 margin are sparse and belong to the card (next handoff), not here.

## New query — consensus lean

Add an additive query (e.g. `getBattlefieldSeats()` in `lib/queries.ts`). For every seat with at least one rating, compute a consensus lean:

1. **Map each rater's bucket to a signed numeric, D negative / R positive.** Target scale: Solid or Safe = ±3, Likely = ±2, Lean or Leans = ±1, Tilt = ±0.5, Toss-up = 0. **Read the actual distinct bucket strings per source and map them — do not hardcode strings.** The vocabularies differ: Cook and Sabato have no Tilt tier, Inside Elections does (Tilt sits between Toss-up and Lean). Run `SELECT DISTINCT rating, source FROM race_ratings`, map each value to the scale, and report the mapping in the ship report.
2. **Average the mapped values across the sources present** for that seat → consensus ∈ [−3, +3]. One source present = that source's value (no averaging).
3. Return per seat: seat id, chamber, consensus value, incumbent party (from the `seat_incumbent_bioguide` subquery; open seats → the party that held the seat going in, or neutral if unknown), and the seat label.

## Battlefield axis

- **Gradient spread bar, full width:** D (left) → R (right), labeled zones LEAN D / TOSS UP / LEAN R per the mock. Axis x for a seat = linear map of consensus [−3, +3] onto the bar width.
- **Markers above the line** for toss-up seats (|consensus| ≤ 0.5, tunable to the mock's marker count): circle = Senate, square = House, fill = incumbent party, label = seat (e.g. `PA-SEN`, `NC-13`), no date. Positioned at the seat's axis x.
  - **Collision dodge:** markers whose x fall within ~16px of each other stack vertically (incrementing y-offset) so labels don't overlap. Averaging reduces collisions, but single-rated seats still land on bucket centers.
- **Field bands below the line** for the rest of the rated competitive field (0.5 < |consensus| ≤ 2, i.e. through Likely; Solid seats excluded — tunable to the mock): seats collapse into lean bands, one tick per band at the band's center x, with a count and a hover popover listing that band's seats. Band granularity follows the mock (the three labeled zones at minimum; more if the mock breaks out Likely bands separately).
- **Election Day chip,** top-right of the head: `NOV 3 · {N} DAYS · {N} SEATS`. Election Day 2026 is Tuesday Nov 3; N DAYS computed live from today; N SEATS = the count of seats on the battlefield.

## Deferred to the next handoff (don't build here)

- Rich race cards (2024 margin, war chest, incumbent tenure, rater pills, the per-card spread bar with market diamond + divergence chip, the WAR CHEST | KALSHI | POLYMARKET row).
- Card ↔ marker cross-highlight. Markers carry seat IDs here so the next handoff wires the bidirectional link; don't wire it to the placeholder cards.

## Constraints

- Desktop. Static except instant hover/highlight states (marker hover, band popovers). No new motion, no new tokens; reuse `lib/race-colors.ts` for party/lean colors.
- Additive only: the new query does not touch `getMostCompetitiveRaces` or any existing rating read. `/` (`app/page.tsx`) untouched.
- Mono for seat labels / counts / glyphs; UPPERCASE zone labels.
- Named `git add` per commit, eyeball the diff. Stale `.next` rule on this UI ship: verify `layout.css` loads (no 404); `rm -rf .next` + restart if the dev server's been up a while. `npm run build` clean.
- Ship per the live-verify rule: `git push`, then `npm run verify:deploy` until the served SHA equals HEAD before reporting shipped.

## Ship report

Lead with the distinct rating vocabularies found per source and how each mapped to the scale (the part most likely to be wrong). Then confirm: the battlefield replaced the timeline inside `CompetitiveRacesBlock` (or mounted above the cards if no timeline existed); the card list is untouched; markers place by consensus with Senate circles / House squares / incumbent-party fill, and same-x markers dodge cleanly; field bands show below the line with counts and hover popovers; the Election Day chip computes N DAYS and N SEATS. State how many seats landed as markers vs bands vs excluded. Stylesheet loads; build clean; verify:deploy SHA matches.
