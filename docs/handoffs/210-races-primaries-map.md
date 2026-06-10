# HO 210 — Races/Primaries US-map index (basic card)

Surface: `/races` (RACES + PRIMARIES tabs). A real US choropleth map becomes the index above the existing spectrum-bar list. Map-first: map is the default view; the existing list is one MAP/LIST toggle away.

**This HO ships on existing data only. No new pipelines.** The enriched race card (Kalshi, cash, trend sparkline, news-to-race, per-state weekly) is a SEPARATE later HO (`HO-2XX-rich-race-card.md`, gated on its own diagnostic). Build the card here with the basic fields and leave it null-safe so the enriched fields slot in later without a redesign.

---

## Pre-flight findings ALREADY RESOLVED (carry forward — do NOT re-run these)

A prior diagnostic answered three of the rich-card Phase-1 questions as they pertain to 210. They survived the cartogram→US-map form change unchanged (data questions, not rendering questions). Use these; do not re-litigate:

1. **Competitive threshold (rich-card diagnostic #7) — RESOLVED. Reuse `getRacesIndex`, do NOT reimplement.**
   The shipped `/races` list (`getRacesIndex`) does **not** filter on `ABS(rating_score)<=1`. It uses an **INNER JOIN on `race_ratings` existence** — "any race with ≥1 seeded rating for cycle 2026." Live: **137 races / 44 states**. `ABS<=1` would give only **61** (that cut is `getMostCompetitiveRaces`, the dashboard block — a *different* query; conflating them is the trap). **The RACES per-state count MUST be `getRacesIndex(2026)` grouped by state**, so map count == list length by construction. (Prose drift to ignore: 21 of 137 are all-Solid consensus, so "anything other than Solid/Safe" doesn't perfectly match the list's own behavior — row-counting `getRacesIndex` sidesteps it.) Per-state counts run 1–13 (FL 13, TX 11, CA/NC/NY 7, …, **27 states at 1** — note the brightened ramp below exists precisely so count-1 reads against the base).

2. **SOON next-N (rich-card diagnostic #8 adjacent) — RESOLVED.** today = 2026-06-06. State-uniform date via `MAX(primary_date) GROUP BY state` is clean (49/50 one distinct date; LA is two rounds, MAX → 06-27). SOON = next 4 distinct future dates (06-09, 06-16, 06-23, 06-27) → 9 states incl. ties: ME/ND/NV/SC, OK, MD/NY/UT, LA. **VOTED takes precedence over SOON** — LA already voted its May primary so renders VOTED; the visible SOON band is the 8 not-yet-voted. Self-decided default.

3. **Topology name-join — confirm at build (the one new map-form check).** `geoAlbersUsa` keys on the topology's `properties.name`. Confirm those state-name strings match the names in `getRacesIndex` state values and the primaries `state` column — report any mismatch (e.g. "District of Columbia" vs "DC") so no state goes silently uncolored. Same exact-join discipline as the vote_pct work.

Also confirmed: VOTED split keys on `vote_pct IS NOT NULL` (22/50 states voted today); rating source = `getRacesIndex` reused as-is; primary dates are 100% populated incl. off-cycle (diagnostic #8 = yes).

---

## MAP FORM — literal US map (NOT a cartogram)

This reverses an earlier in-session call. The tile-grid cartogram was rejected after review; the geographic version won on legibility. Record this so it isn't "optimized" back to squares:

> This is for people who want to find THEIR state and connect to the data through the real shape of the country. A cartogram is more efficient (no area-bias, uniform click targets) but the equal squares are lifeless and don't read as "my state." Geographic legibility wins. The area-bias tradeoff (big dark empty states pull the eye; CA/TX dominate) is accepted deliberately.

Any prior scope text saying "cartogram / tile-grid / 11-col square grid" is STALE — discard it. Reference mock: `races-map-usmap-v2.html`.

## Tech
- `d3.geoAlbersUsa()` + `us-atlas@3` states-10m topology (runtime dep).
- One shared map shell, two coloring functions (one per tab).

## Layout (top → bottom)
1. Tabs: RACES | PRIMARIES
2. Search row: name/state input (left) + count summary (right):
   - RACES: `137 RACES · 29 SEN · 108 HOUSE`
   - PRIMARIES: `904 PRIMARIES · 388 VOTED · 50 STATES`
3. Legend strip (swaps per tab)
4. US map (choropleth)
5. Pinned state report (inline below map) — BASIC card this HO
6. MAP / LIST toggle → existing spectrum-bar table (kept, NOT rebuilt)

## State labels (school-map convention)
- Every state shows its 2-letter abbr. Lit states bright (`#e5e7eb`), unlit dim (`#475569`) but still labeled so any state is findable/searchable.
- Small NE states (VT, NH, MA, RI, CT, NJ, DE, MD, DC) get a LEADER LINE (`stroke #475569` ~0.6px) out to a stacked right-edge label column.
- TUNE (build): order the right-edge label stack top→bottom by latitude (VT highest → DC lowest) so leader lines don't cross.
- DC has no visible polygon at this zoom — give it a small fixed marker near MD, or fold into a "MD + DC" treatment. Build's call.

## Coloring — per tab (key divergence, do NOT unify)
RACES — PURPLE RAMP by COUNT of competitive races (magnitude, not lean):
- `0` `#1a2030` (dim, `#2a3344` border) · `1` `#3b3585` · `2` `#5048b0` · `3` `#6a60d0` · `4+` `#8b82e8`
- (Ramp brightened so a single race reads against the base — see resolved finding #1: 27 states sit at count-1.)
- Count is hover-revealed (`PA 4` on hover); lean is NOT on the fill (rating-colored labels live in the rows).
- **"Competitive" count = `getRacesIndex(2026)` per-state row count** (resolved finding #1 — reuse the query, do not reimplement a threshold; map count == list length).

PRIMARIES — RECENCY BANDS (three distinct hues):
- VOTED `#06b6d4` · SOON `#fbbf24` (NEXT-N to vote, N≈4, rolling — NOT fixed-30-day; VOTED precedence per finding #2) · LATER `#2a3344` (+`#94a3b8` label)
- Every state interactive (all have a date). "Later" shows `SCHEDULED · [full date incl. year]`, off-cycle into 2027. Gray = scheduled-not-yet, never no-data.
- Report two modes: VOTED → HO 207 share bars; UNVOTED → scheduled list, no bars.

PALETTE NOTE: Purple = RACES magnitude (this surface only). Amber = urgency/active app-wide (cursor, floor stage, active filter, PRIMARIES soon) — deliberately NOT reused for RACES heat. Cyan = PRIMARIES voted. Tabs never share a meaningful color; legends self-contained; you never see both at once.

## Interactions
- HOVER state → peek card follows cursor (instant, no fade, flips left near right edge). Compact contest list, Senate-first.
- CLICK state → pin report inline below map; stays until another state or × close; **scroll into view on pin** (prevents "did my click register" on a tall map).
- SEARCH (enter) → resolve incumbent name / seat code (`PA-07`) / state code → pin that state.
- Inactive states: RACES 0-count = labeled + dim, non-interactive; PRIMARIES all interactive.
- (Small leader-line states: hovering the label/leader target counts as hovering the state.)

## Pinned state report — BASIC card (this HO)
- HERO band: competitive count · total seats. (News/Kalshi hero stats are rich-card HO.)
- RACE ROWS — click-to-expand accordion (HO 148), single-open, chevron affordance:
  - Collapsed: chevron · incumbent face (bioguide) · `[party] SEAT · name` · rating label.
  - Expanded: both candidates (incumbent photo + challenger placeholder), margin bar IF 2024 margin available, primary status. Fields not yet available simply don't render.
  - Click incumbent name → member page; click row context → race hub (preserve existing).
- PRIMARIES tab report modes: VOTED state → HO 207 share bars (reused as-is); UNVOTED → `SCHEDULED · [full date]` list, no bars.
- Build the row component null-safe: ●N news flag, Kalshi, cash, rater spread, trend sparkline, per-race news drop-down are all RICH-CARD HO additions — leave clean insertion points.

## Constraints
Desktop first, mobile deferred. Static, no motion (peek/pin/accordion instant). Reuse rating data + spectrum-bar table + HO 207 share bars as-is.

## Verification
- US map renders real state shapes via `geoAlbersUsa`; small NE states have leader-line labels (latitude-ordered, no crossings); DC handled. Spot-check the name-join (finding #3): no state silently uncolored.
- RACES coloring: pick 2–3 states, confirm fill bucket matches their `getRacesIndex` count AND that count **equals the LIST's length** for that state (the gate). Count-1 states are legible against the base.
- PRIMARIES coloring: VOTED/SOON/LATER render; today's SOON = the 8 visible not-yet-voted states (LA shows VOTED); LATER states show `SCHEDULED · [date]` incl. 2027 off-cycle, never blank.
- Hover peek floats + flips at right edge; click pins + scrolls into view; search resolves name / seat code / state code.
- Card is BASIC + null-safe: voted primary → 207 bars; unvoted → scheduled list; races state → accordion of seat/incumbent/party/rating, Senate-first. **No enriched fields present**, insertion points clean.
- MAP default on load; LIST toggle shows the unchanged spectrum table.
- `tsc` passes; eyeball both tabs.

## After ship
SKILL.md: `/races` is map-first (literal `geoAlbersUsa` US map default, list one toggle away); the two-coloring divergence with the **do-not-unify palette note**; the competitive-count predicate (`getRacesIndex` row count, named — and the note that `ABS<=1` is a *different* query, `getMostCompetitiveRaces`, so a future sweep doesn't swap them); the SOON next-N rolling-window with VOTED precedence; the basic null-safe card boundary (enriched card = separate pending HO).

## Out of scope
- The enriched card (Kalshi, cash, 2024 margin, rater spread, sparkline, news-to-seat, BREAKING strip, per-state weekly) — `HO-2XX-rich-race-card.md`, own diagnostic, Kalshi probe-first net-new.
- Tile-grid cartogram (rejected — literal map is the decision).
- Rebuilding the spectrum-bar list (kept as the LIST view).
- Competitiveness/polling coloring for unvoted primaries (no data).
- Governor / non-Senate-non-House contests.
- Mobile <700 (desktop first; deferred).
- Motion/transitions (static — peek/pin/accordion instant).
- Any HO 207 share-bar internal change (reused as-is).

## Reference mock
`races-map-usmap-v2.html` — the approved map form (leader lines, brighter purple, later-state dates).

read docs/handoffs/210-races-primaries-map.md and follow
