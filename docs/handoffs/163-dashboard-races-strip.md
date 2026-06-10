# HO 163 — Dashboard races strip

## Why

The dashboard has reclaimed vertical space (after the HO 162 header redesign) and the framing question "WTF is going on in Congress?" isn't fully answered by bills + news + topics alone — the electoral landscape is missing. We want a compact races strip surfacing the most relevant races, clickable through to `/race/[id]`.

Critically: **most of this may already be built.** SKILL.md flags two existing pieces:
- `getMostCompetitiveRaces(cycle, limit)` — cached, tag `race-ratings`, ranks by `MIN(ABS(rating_score))` across sources, competitive cut `ABS(rating_score) <= 1`. SKILL line 602: "it's wired up but not yet rendered — feeds the future 'most competitive races' dashboard cut." This block is exactly that.
- `CompetitiveRacesBlock` (HO 72) — SKILL line 1006 references a "home-dashboard `CompetitiveRacesBlock`" using the `RatingChip` mapping.

So this is likely a placement + restyle job, not a build-from-scratch. Phase 1 establishes what already exists.

## Design intent (confirmed, subject to data reality)

- **4 cards across, horizontal strip**, density matching the markets tape / dashboard panels.
- **Card content:** rating + seat + a margin/strength signal. **Note:** the schema has NO numeric margin or poll field — race data is `rating_score` (the Sabato/Cook seven) + candidate rosters. So the "margin/poll number" intent resolves to the **rating as the strength signal**, ideally showing multi-source disagreement where it exists (Cook · Sabato · IE), which SKILL repeatedly calls the analytical signal. Card = seat (e.g. `OH SEN 2026`) + rating chip(s) + incumbent or top candidate.
- **Which races:** the design choice was "soonest up by election date," but in a single 2026 cycle most races share a general-election date, so that sort is nearly flat. **Recommend competitive-first** (what `getMostCompetitiveRaces` already does). Phase 1 should report the actual date spread so this can be confirmed — if soonest-up is genuinely differentiating, use it; if flat, use competitive-first.
- **Placement:** below the weekly-report snapshot band, above the `.home-grid` (the Stage Distribution / Activity two-column row). Full-width horizontal strip.
- Click a card → `/race/[id]`.

## Phase 1 — Diagnostic (HALT after)

Don't build yet. Establish ground truth, then halt.

1. **Does `CompetitiveRacesBlock` exist, and what does it render?** Find the component. Report: its current props, what each card/row shows, whether it's currently mounted anywhere, and whether it's a horizontal strip or a vertical list. If it exists and already renders cards, this handoff becomes "place + restyle to 4-across," not "build."

2. **`getMostCompetitiveRaces` output shape.** Run it (or read its definition) and report: what columns come back per race, how many competitive races exist in the current cycle (is there even enough for 4 cards?), and whether multi-source ratings are available per race or just one.

3. **Margin/poll confirmation.** Confirm there is no numeric margin/poll/spread field in `races` / `race_ratings` / `race_candidates`. (I'm 95% sure from the schema there isn't — confirm so the card design doesn't promise data that doesn't exist.)

4. **Election-date spread.** For the competitive races, report the distribution of election dates / `next_election_year`. This decides competitive-first vs. soonest-up sorting. If they're all 2026-11-03, soonest-up is meaningless and we go competitive-first.

5. **Card data availability.** For a representative competitive race, confirm what's actually populated: rating (how many sources?), incumbent name, top candidate(s). So the card design uses fields that exist rather than rendering blanks.

**HALT. Report findings + a recommended card spec based on what's actually available, and wait for sign-off before Phase 2.**

## Phase 2 — Implementation (only after sign-off)

Based on Phase 1:

- If `CompetitiveRacesBlock` exists and is close: restyle to a 4-across horizontal strip, place it below the weekly-report band above `.home-grid`, wire it to `getMostCompetitiveRaces(2026, 4)` (or whatever cycle/limit Phase 1 confirms).
- If it doesn't exist or isn't reusable: build a new strip component to the card spec Phase 1 produced.
- Card: seat label + rating chip(s) using the existing `RatingChip` mapping (multi-source `·`-separated where available, per the `/race/[id]` convention) + incumbent/top-candidate name. No margin/poll number (doesn't exist).
- Each card links to `/race/[id]`. Match dashboard panel density and the Bloomberg aesthetic — don't introduce new color tokens.
- Empty/thin state: if fewer than 4 competitive races exist, render what's there; if zero, the strip renders nothing (no placeholder chrome) — consistent with the dashboard's no-placeholder convention.
- Reuse `RatingChip` and the existing cache tag (`race-ratings`). Don't add a new query if `getMostCompetitiveRaces` covers it.

## Verification

- Show the diff.
- Confirm the strip renders 4 cards (or the real count) with real rating data, placed correctly below the weekly-report band.
- Confirm clicks route to `/race/[id]`.
- Type check passes.

## Out of scope

- No new race data sources (no polling, no margin — deferred sub-pages per SKILL).
- No changes to `/races` or `/race/[id]`.
- No changes to the header (HO 162) or the `.home-grid` below.
