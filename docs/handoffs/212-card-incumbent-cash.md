# HO 212 — Rich card, part 1: incumbent cash-on-hand (now-field, no new pipeline)

## Why

First enrichment of the HO 210 map card, scoped to the fields HO 211 confirmed buildable **now with zero new ingestion**. Of the three "buildable now" fields, two are already in the 210 card (incumbent name+photo, primary dates — 211 just confirmed them solid). So this handoff adds **one new field: incumbent cash-on-hand**, joined from existing FEC data into the existing card. Small, null-safe, no pipeline, no backfill.

Deferred to later arcs (do NOT touch here): 2024 margin + challenger names (Ballotpedia backfill arc), Kalshi (own arc, free source confirmed), news-to-seat (own arc, thin volume), rating-history sparkline (needs logging started first). Their insertion points already exist in the 210 card from Pass 2.

## The data (confirmed in HO 211)

- `member_fundraising.cash_on_hand`, bioguide-keyed, FEC-sourced (HO 83). 524 rows, all populated.
- Index coverage: **128/137 races (93%)** have incumbent cash. The 9 without must render clean (see null-safety).
- Challenger cash is **structurally impossible** (table is bioguide-keyed; challengers have no bioguide) — do NOT attempt it, do NOT add a placeholder implying it's coming. Incumbent cash only.

## Build

**Data plumbing (server, no new route):**
- Join `member_fundraising.cash_on_hand` onto the races card payload via the incumbent `bioguide_id` — the same 1:1 join shape `getRacesIndex` already uses for the depiction_url. Project it onto the card's contest/row type as `incumbentCashOnHand: number | null` (null when the member has no fundraising row).
- Confirm the join doesn't multiply rows (1:1 on bioguide, like the photo join).

**Card render (`RaceMapCard.tsx`):**
- Add incumbent cash to the card, at the **insertion point already stubbed for it** in Pass 2.
- **Placement: match the design mock** `style3-expandable-news.html` — it specced a "mini metrics" treatment. Read the mock and place cash where it sits there (collapsed-row mini-metric vs expanded-only). Don't invent placement; if the mock is ambiguous, default to the expanded row (the collapsed row is already face/seat/name/rating and is tight) and note the call.
- **Format** as compact currency: `$2.4M`, `$180K`, `$0` — not raw `2412334`. Reuse an existing formatter if one exists (check `lib/format`); add a small `formatCompactUSD` if not.
- This is incumbent-only — label/position it so it reads as the incumbent's figure, not a race total.

**Null-safety (the 9 uncovered races):**
- `incumbentCashOnHand === null` → render a muted `—` or omit the field cleanly. **Never** `$NaN`, `$undefined`, an empty bar, or a `$0` that's actually missing-data (0 and null are different — a real $0 is a filed-but-empty account; null is no filing on record; render null as `—`, render a true 0 as `$0`). Same render-the-gap-honestly discipline as the primaries vote_pct work.

## Gates (must not regress — HO 210 invariants)

- The two coloring functions (`racesFill`/`primariesFill`) stay untouched — this is a card payload change, not a map change.
- count==list holds — the cash join enriches the payload, never the tile count (still `getRacesIndex` per-state).

## Verification

- `tsc` clean; `/races` 200; dev log clean.
- Pin a high-profile multi-seat state (e.g. TX): incumbent cash renders on each race row, compact-formatted, matching the mock's placement.
- The 9 uncovered races render `—` (or clean omit), never `$NaN`/empty — spot-check one known-uncovered race.
- Confirm a real `$0` (if any) renders `$0`, distinct from a null `—`.
- Gates: coloring fns still separate; count==list spot-check unchanged.
- Eyeball: cash reads as the incumbent's figure, doesn't crowd the collapsed row past legibility.

## After ship

- SKILL: note incumbent cash is wired into the races card from `member_fundraising` (93% coverage, null→`—`, challenger cash structurally unavailable). Note the remaining rich-card fields are still parked on their respective arcs (margin/challenger backfill, Kalshi, news-to-seat, sparkline).

## Out of scope

- Challenger cash (structurally impossible — no bioguide).
- 2024 margin, challenger names (Ballotpedia backfill arc — separate).
- Kalshi, news-to-seat, rating-history sparkline (separate arcs).
- The per-state weekly report.
- Any map/coloring change; the spectrum LIST view; the HO 207 ShareBar.

read docs/handoffs/212-card-incumbent-cash.md and follow
