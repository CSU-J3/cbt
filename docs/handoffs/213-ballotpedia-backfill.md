# HO 213 — Rich card, part 2: challenger names + 2024 margin (Ballotpedia/DB backfill)

## Why

Fills out the HO 210 expanded race-card row, which is still mostly placeholder. HO 211 confirmed both fields are "buildable after a backfill," and they pair: a named challenger + a 2024 result bar is the expanded row actually filling out. Two fields, two different sources, two different risk levels — handled accordingly below.

These slot into insertion points that already exist in `RaceMapCard.tsx` (Pass 2 / HO 210). No card redesign.

## The split — read this, it sets the structure

The two fields are NOT the same kind of work:

- **Challenger names → pure DB-to-DB backfill, SAFE, no probe.** The source is already in our database: `primary_candidates` (HO 211 confirmed 2,644 rows / 825 primaries / 450 marked winner). The post-primary advancers harvest into `race_candidates` via an internal query — no scraping, no external dependency. This half can proceed straight through.

- **2024 final margin → unverified external scrape, PROBE FIRST.** HO 211 said margins "likely live on the same Ballotpedia per-seat pages" the primaries arc scraped — but that was an *inference*, not a confirmed parse. We have reverted twice (HO 65 OpenSecrets, HO 70 FMP) for scoping a scrape against a source we hadn't actually verified carries the data in a parseable shape. So this half does NOT build until Code confirms the 2024 general-result table is present and parseable on the real pages.

Structure the arc as: **Part A (challenger names) proceeds. Part B (margin) probes, reports, and HALTs for go/no-go before the scrape is built.** They share the card but not the risk, so don't gate A behind B's probe.

## Part A — challenger names (DB backfill, proceed)

**Source:** `primary_candidates`, the winners (`status = 'winner'` or whatever the HO 206/209 winner flag is — confirm the actual column/value). A primary winner is the general-election candidate for that seat.

**Backfill:**
- For each 2026 race in the `getRacesIndex` set, find the primary winner(s) for that seat from `primary_candidates` and write them into `race_candidates` as the challenger(s) — i.e. the non-incumbent advancer(s). Key the match on seat (state + district for House, state for Senate) + cycle.
- **The incumbent is not a challenger.** When a primary winner *is* the sitting incumbent (incumbents run in primaries too), don't write them as their own challenger — match against `race.incumbent_bioguide_id` and exclude. The challenger is the *other* party's winner (or a same-party primary challenger only if that's the actual race shape — but the common case is the opposing-party nominee).
- **Coverage will be partial and that's fine.** Only seats whose primaries have happened AND were rostered will have a winner to harvest. HO 211 found 450 winners across 825 primaries; map how many of the 137 `getRacesIndex` races that actually fills, and report the number. The rest keep the "challenger field not yet available" placeholder (HO 210 already renders this null-safe).
- **Null-safe:** no winner found → the existing placeholder stays. Don't invent a challenger.

**Card render (`RaceMapCard.tsx`):** the expanded row's challenger slot (already stubbed) renders the harvested name(s) + party where present, placeholder where not. No photo (HO 211: challenger photos are blocked, no source — placeholder only, do not attempt).

## Part B — 2024 margin (PROBE FIRST, then HALT)

**Probe (no schema, no scrape-build yet):** take 2–3 of the `getRacesIndex` seats (a House seat and a Senate seat, ideally ones the primaries scraper already has cached pages for) and confirm against the **real Ballotpedia per-seat page**:
- Is there a **2024 general-election result table** in the static HTML (the same kind of `results_table` the primaries arc parsed, but for the Nov 2024 general)?
- Does it carry the vote counts / percentages needed to compute a margin (winner % − runner-up %)?
- Is it cleanly distinguishable from the other result tables on the page (2024 *primary*, 2022 general, 2026 primary) — the same scoped-votebox discipline HO 206 needed, since these pages carry many tables and a page-wide grab pulls the wrong election?
- What's the coverage likelihood — do all seat pages carry a 2024 general table, or only some?

**Report + HALT.** State plainly: parseable Y/N, what it carries, the table-isolation approach, and the realistic coverage. If parseable → Part B build (schema column + scoped scrape + margin compute + the expanded-row result bar) gets scoped as the next step. **If NOT cleanly parseable for free → say so; margin is deferred, not forced.** That's a valid outcome — Part A still ships the challenger names regardless.

Do not write a `margin` column, a scrape, or the result-bar UI until the probe says green and you've signed off.

## Gates (HO 210 invariants — must not regress)

- The two coloring functions (`racesFill`/`primariesFill`) untouched — this is card payload + a possible new column, not a map change.
- count==list holds — neither field touches the tile count (still `getRacesIndex` per-state).

## Verification

**Part A:**
- `tsc` clean; `/races` 200; stylesheet loads (verify the asset, per the HO 212 lesson — don't trust a 200 on a long-running server).
- Pin a state with resolved primaries: expanded race rows show harvested challenger names + party where a winner exists; placeholder where not. Report the fill count (of 137).
- Confirm no incumbent is written as their own challenger (spot-check a seat where the incumbent won their primary).
- Null-safe: a no-winner seat keeps the placeholder, no invented challenger.
- Gates: coloring fns separate; count==list unchanged.

**Part B:** the probe report only (parseable Y/N + coverage + isolation approach). No build to verify yet.

## After ship (Part A)

- SKILL: challenger names harvested from `primary_candidates` winners into `race_candidates` (partial coverage = resolved primaries only; placeholder otherwise; no challenger photo source). Note 2024 margin status per the probe (deferred / scoped-next).

## Out of scope

- Challenger photos (blocked, no source — placeholder only).
- Challenger cash (structurally impossible — bioguide-keyed).
- Building the 2024-margin scrape/column/bar before the Part B probe greenlights it.
- Kalshi, news-to-seat, rating-history sparkline (separate arcs).
- The per-state weekly report.
- Map/coloring changes; the spectrum LIST view; the HO 207 ShareBar.

read docs/handoffs/213-ballotpedia-backfill.md and follow
