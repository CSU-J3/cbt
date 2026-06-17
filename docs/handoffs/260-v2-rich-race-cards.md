# HO 260 — Dashboard v2: rich race cards (the COMPETITIVE card grid) — this is (c)

Confirm the next free number before saving: `ls docs/handoffs/ | sort | tail`. Body assumes 260. Builds on HO 253 (shell), 254 (battlefield + the `data-seat` markers), 256 (Polymarket seat odds). Last major v2 surface.

## What this is

Replace the placeholder cards in v2's COMPETITIVE grid (the existing `CompetitiveRacesStrip`) with the mock's rich race card: incumbent + tenure + INCUMBENT tag, the D↔R spread bar (rater dots + band + two market diamonds + divergence chip), the rater pills, and the WAR CHEST | KALSHI | POLYMARKET stat row, with the chamber split and the card↔battlefield-marker cross-highlight. v2-specific; don't touch `/`.

## Source of truth

Visual: `docs/design/dashboard-2col.html`, the `.race-card` markup plus the `.rc-*` / `.sb-*` CSS. Match it. Structure: `.rc-top` (`.rc-seat` + House-only `.rc-margin`), `.rc-inc` (`.dot8` party dot + `.nm` name + `.tag` INCUMBENT), `.rc-sub` (party · since YEAR), `.sb-wrap` (spread bar), `.rc-raters` (pills + optional `.rc-diverge`), `.rc-stats` (stat cells). `.race-card.hot` = featured (amber border); `.race-card.hl` = cross-highlight (amber-bright border + 1px ring).

The mock's exact spread-bar positions and chip cases are hand-placed illustrations. Compute positions from data per the mapping below and match the visual treatment, don't copy the literal percentages.

## Resolved premises (don't re-derive)

- **Incumbent signal: the `races.incumbent_bioguide_id → members` join** (name, party, tenure), the getRacesIndex pattern — NOT the `seat_incumbent_bioguide` subquery (House-only / Senate-ambiguous; corrected in HO 254). This join also gives the departing party on open seats.
- **Open seats: the HO 221 open/retirement flag.** Open → drop the INCUMBENT tag; held → show it. Name/party/tenure still come from the join (the departing or sitting member).
- **Chamber split** (mock + data inventory): Senate cards have NO 2024 margin (none exists for Senate) and YES a Polymarket cell. House cards have a 2024 margin (`races.margin_2024`, HO 214, House-only on 2026 rated seats) and NO Polymarket cell at all.
- **Per-cell sparsity:** ratings dense (3 raters); war chest = incumbent cash-on-hand only, sometimes unfiled (degrade), no challenger side; Kalshi sparse on both chambers; Polymarket Senate 34/35 (only AL absent, and AL is Solid R so never a competitive card).

## Spread bar (the data wiring the mock can't encode)

Axis: 0% = solid D (left), 50% = toss-up (center), 100% = solid R (right), matching the `.sb-track` blue→slate→red gradient.

- Lean→position uses the HO 254 scale (Solid/Safe ±3, Likely ±2, Lean ±1, Tilt ±0.5, Toss-up 0): `pos% = (value + 3) / 6 * 100`.
- **Rater dots** (`.sb-rater`): one per rater present, at its mapped position (reuse the 254 per-source vocab mapping).
- **Band** (`.sb-band`): spans the min→max rater position (the spread of the raters).
- **Market diamonds:** `.sb-mkt kals` (◇ hollow, muted) and `.sb-mkt poly` (◆ solid, amber). Position = the market's P(R wins) on the axis, derived from `favorite_party` + `implied_pct` (favorite D → P(R) = 100 − implied; favorite R → P(R) = implied), placed at `pos% = P(R)`. Render a diamond only where that market has a value for the seat. House cards carry the Kalshi diamond only.
- **Divergence chip** (`.rc-diverge`, conditional):
  - Both markets present and far apart (|kals_pos − poly_pos| ≥ ~10 pts) → `◇◆ MARKETS SPLIT`.
  - Else a market's favorite party is on the opposite side of center from the rater consensus → `{◇|◆} {SOURCE} BREAKS {D|R}` (side = that market's favorite; glyph = which market).
  - Else no chip.
  - Thresholds tunable to match the mock's intent (fire on real disagreement, not noise).

## Stat row (`.rc-stats`)

- Senate: WAR CHEST, KALSHI, POLYMARKET (3 cells). House: WAR CHEST, KALSHI (2 cells, no Polymarket).
- Values party-colored (`.v.d` / `.v.r`, e.g. "D 56%"); `.v.dim` for N/A.
- WAR CHEST: incumbent cash-on-hand ("$4.2M"); dim when unfiled. No challenger figure.
- KALSHI / POLYMARKET: `{favorite} {implied}%` or dim "N/A" when absent. (Senate Polymarket N/A would only hit AL, which never appears; N/A on a competitive card means a data gap, not steady state.)

## Cross-highlight (card ↔ battlefield marker)

- Each card carries `data-seat` matching its battlefield marker's `data-seat` (254 already put `data-seat` on the markers).
- Match the mock's JS: card mouseenter/leave toggles `.hl` on both the card and its marker; marker dot/label hover toggles `.hl` on both. Add the marker `.hl` highlight style if 254 didn't.

## 2024 margin (House only)

`.rc-margin` in `.rc-top`: "2024 {D|R}+{margin}" from `races.margin_2024`, party-colored, House cards only. Omit on Senate cards and on any House card without a backfilled margin (RCV / unresolved).

## Open-seat treatment (NOT in the mock — flag for Design)

Open seat (HO 221 flag): `.rc-inc` shows the departing-party dot, the departing member's name, and no INCUMBENT tag; consider a small "OPEN" marker where the tag would sit. This is a sensible default since the mock's four cards are all incumbents; refine if Design specs an open-seat layout.

## Constraints

- v2-specific; `/`'s race cards untouched (variant/parametrize the way the feed did in HO 257). Restyle the existing `CompetitiveRacesStrip` cards in v2's COMPETITIVE tab; don't change which races the grid shows.
- The mock is the visual source of truth; this doc owns the spread-bar mapping, the divergence logic, the chamber-split data rules, and the N/A/degrade behavior.
- Reuse the corrected incumbent join + existing race / ratings / `kalshi_odds` / `polymarket_odds` / fundraising queries; additive only. Don't touch the battlefield query or `/`.
- Mono labels; the candidate name is sans (`.nm`). Named `git add` per commit, eyeball the diff. Stale `.next` rule: verify `layout.css` loads (no 404); `rm -rf .next` + restart if the dev server's been up a while. `npm run build` clean.
- Ship per the live-verify rule: `git push`, then `npm run verify:deploy` until the served SHA matches HEAD.

## Ship report

Confirm the v2 COMPETITIVE cards match the mock: incumbent / tenure / INCUMBENT tag (open seats drop it), the spread bar with rater dots + band + the two market diamonds (◇ Kalshi / ◆ Polymarket) positioned by the mapping, the divergence chip firing on split/break and absent on agreement, the rater pills, and the stat row (Senate 3 cells incl. Polymarket; House 2 cells + 2024 margin). Confirm cross-highlight both ways (hovering a card lights its battlefield marker and vice versa). Name a Senate card, a House card, and one showing a divergence chip that you verified. Confirm `/`'s cards are unchanged. Build clean; verify:deploy SHA matches.
