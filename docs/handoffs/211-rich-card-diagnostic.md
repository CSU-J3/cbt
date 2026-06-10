# HO 211 — Rich race card: Phase-1 data diagnostic (probe only, HALT after)

## Why

The HO 210 map card was shipped BASIC with null-safe insertion points. The enriched fields — Kalshi odds, per-candidate cash-on-hand, 2024 final margin, rater spread, rating-history sparkline, news-to-seat headlines, plus a per-state weekly report — were deferred because half their inputs are missing or net-new. This HO **does not build any of them.** It runs the data diagnostic so we know which fields are real-today, which need a backfill, and which are blocked, before a single line of card-enrichment gets scoped.

This is a **probe-only HO. No schema writes, no ingestion, no UI, no new pipelines.** Report each point as yes/no + where the data lives (table/column/join) + coverage. Then **HALT for sign-off.** The buildable fields get scoped into a follow-up handoff; the net-new pipelines (Kalshi especially) become their own probe-first arcs — do not start any of them here.

Why probe-first and not just build: two of these are exactly the dead-endpoint shape that reverted HO 65 (OpenSecrets) and HO 70 (FMP). Kalshi is net-new pipeline work; the sparkline needs history we may not be logging. Scoping a build against unverified data is the failure mode this diagnostic exists to prevent.

## Already resolved — do NOT re-probe

**#7 (competitive threshold) is answered from the HO 210 work.** The `/races` list and the map both use `getRacesIndex` (INNER JOIN on `race_ratings` existence, 137 races / 44 states), NOT `ABS(rating_score)<=1` (that's `getMostCompetitiveRaces`, the dashboard block, 61 races). Map count == list length by construction. This is documented in SKILL (the "two competitive predicates" callout). Skip it — it's done.

## The 7 remaining points — probe each, report yes/no + location + coverage

1. **RATING HISTORY OVER TIME.** Is each race's Cook/Sabato/Inside rating snapshotted on a timeline, or do we only store the *current* value? Read the `race_ratings` schema and check for any date/snapshot/history column or a separate history table. (Needed for the per-race trend sparkline. If current-only, the sparkline can't ship until we *start* logging history going forward — report that plainly, because it changes the sparkline from "buildable" to "buildable after we add logging + wait.")

2. **NEWS → RACE/SEAT MAPPING.** News is matched to bills + members today. Can a headline key to a race/seat via the incumbent-member match (e.g. Valadao → CA-22)? Report the actual table/join — does it exist already, or need adding? Also: can it key to *named challengers* once primaries resolve, or only incumbents? (Blocks the per-seat news rows, the ●N news flag, and the state BREAKING strip.)

3. **KALSHI.** Confirm there is NO prediction-market pipeline today (we have FEC, Cook/Sabato, news-signal, stock trades — Kalshi is not among them). Then **probe whether a free Kalshi source even exists**: is there a public/free Kalshi API or data endpoint for congressional/election markets, and what's the auth/cost? Report the exact finding — this is net-new ingestion like HO 70/83, and if there's no free source it's a non-starter, same lesson as the OpenSecrets/FMP reverts. **Probe only — do not build any ingestion.** This becomes its own arc if green.

4. **CASH-ON-HAND per candidate.** Is candidate-level cash present in the FEC donors data (HO 83)? Both incumbent AND challenger, or incumbent only? Report the table/column and the coverage (what fraction of the 137 races have it for at least the incumbent).

5. **2024 FINAL MARGIN per seat.** Is the 2024 result margin stored anywhere (races / race_candidates / race_ratings / a results table), or does it need a backfill? If a backfill, name the likely source (the same Ballotpedia/results path the primaries arc used, or elsewhere). (Blocks the expanded-row margin bar.)

6. **CHALLENGER NAMES + PHOTOS.** Incumbent photos come from bioguide (confirmed 137/137 in HO 210). Do we have challenger *identities* pre-primary, and any photo source for non-member challengers? Report current `race_candidates` coverage (HO 210 found only ~4 of 137 races have candidate rows — confirm and report the real number). Confirm the photo field is null-safe so a missing challenger photo renders a placeholder, not a break.

7. **PRIMARY DATES incl. off-cycle.** Does every state have a primary date stored, including off-cycle ones running into 2027? (HO 210 found 0 NULL dates across 904 primaries — confirm this still holds and that the LATER band's `SCHEDULED · [date]` never renders blank for a late/off-cycle state.)

## Report (the HALT)

End with a table: each point → **buildable now** / **buildable after a backfill** (name the source) / **buildable only after we start logging** (rating history) / **blocked, net-new pipeline** (Kalshi if no free source) / **blocked, no source**. Plus the real coverage numbers (challenger rows, cash, news-join states) so the follow-up handoff scopes against truth, not hope.

**HALT here.** No schema, no ingestion, no card enrichment, no Kalshi pipeline. Wait for sign-off. The buildable fields get a scoped build handoff; the net-new ones each get their own probe-first arc.

## Out of scope (everything — this is a diagnostic)

- All card enrichment (the rich fields are the *next* handoff, after this report).
- Any new pipeline or ingestion (Kalshi, cash backfill, margin backfill, rating-history logging).
- The per-state weekly report (it reuses the reports pipeline; scope it in the build phase against whatever data #1–#7 confirm).
- The HO 210 map/card (shipped, untouched).
- SKILL.md (nothing ships, nothing to reconcile).

read docs/handoffs/211-rich-card-diagnostic.md and follow
