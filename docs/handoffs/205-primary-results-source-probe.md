# HO 205 — Primary results ingestion: source probe (Phase 1 diagnostic, HALT after)

## Why

`primary_candidates.vote_pct` has been 100% NULL since HO 91 — results ingestion was deferred at HO 91 Step 3 because no free programmatic results source was identified. That NULL column is the single shared blocker for **two** parked consumers:

- The primaries candidate-field **share bar** (specced + explicitly deferred at HO 203 — "no bar renders against empty data")
- The **rich primaries map** (the design-chat brief flagged competitiveness/results coloring as sharing this exact dependency)

Both want the same data: per-candidate result share, per primary. Light up the column, both unblock.

This is **Phase 1 only — a diagnostic probe, no schema writes, no ingestion, no UI.** The reason is the HO 65/70 lesson: we have reverted twice for scoping ingestion against a source that turned out dead or wrong. Results ingestion has *never had a verified source*. So before any write path gets built, Code probes the candidate sources against live pages and reports what's actually fetchable and parseable. **Phase 1 ends with a HALT for sign-off.** Phase 2 (the actual ingestion handoff) gets written only after the probe tells us which source is real.

Time pressure: the **GA Senate/House runoff is June 16** and the **LA Senate runoff was June 27** — live result tables exist *right now* for the May 19 / May 16 primaries that already ran (AL, GA, ID, KY, OR, PA, LA). That's the test corpus. We don't need to wait for new elections to validate a parser; ~7 states already voted.

## Pre-flight (do this first, report before probing)

Read the real artifacts so the probe is grounded, not assumed:

1. `scripts/sync-primaries.ts` — the existing scraper. Confirm: the `.cache/` HTML mechanism, the per-state Ballotpedia URL pattern actually in use, the candidate-row parse selectors, and how `primary_candidates` rows are currently written (so a results UPDATE path would match real keys).
2. `lib/primary-calendar-scrape.ts` — confirm the fetch/User-Agent/parse idiom to reuse.
3. The `primary_candidates` schema as it exists in `scripts/migrate.ts` (not as HO 91 specced it — read the live migration). Confirm `vote_pct REAL` is present, the `status` enum values, and the `(primary_id, name)` shape a results join would key on.
4. Run a quick count: how many `primary_candidates` rows exist, how many distinct `primary_id`s, and how many of those primaries have a `primary_date` already in the past (= results should exist). Report the real numbers.

## The probe — three candidate sources, cheapest first

For **one already-voted contest** as the test case — use a multi-candidate one with a real outcome, e.g. **GA Senate primary (2026-05-19)** or whichever past primary has the fullest roster in our table — probe each source and report fetchability + parseability. Use the `.cache/` pattern so repeated probes don't re-hit the network.

**Source A — Ballotpedia result tables (probe FIRST, lowest marginal effort).**
The scraper already parses Ballotpedia candidate lists. Per-race pages add a **results table** with vote counts and percentages once a primary has occurred. Fetch the same per-race URL the scraper already uses for the test contest and report:
- Is there a results/returns table in the static HTML (vs. JS-injected)?
- What columns does it carry — candidate name, raw votes, percentage, winner checkmark?
- Does candidate-name rendering match what's stored in `primary_candidates.name` closely enough to join on, or is a fuzzy/normalized match needed (report the actual name strings side by side)?
- Coverage: spot-check 2–3 *other* already-voted states. Do all carry result tables, or only some?

**Source B — AP / Politico / NYT static results endpoints (probe only if A is thin).**
Some outlets expose static JSON behind their results pages. Probe whether any returns parseable JSON without auth for the test contest. Report the exact URL and shape if found; report the block (auth wall, JS-only, 403) if not. **Do not** scrape anything behind a login or paywall.

**Source C — Wikipedia per-race result tables (fallback).**
Wikipedia's "2026 United States Senate election in {State}" pages carry primary result tables (the search already confirmed these pages exist). Probe the same test contest: static table? parseable? name-match quality vs. our rows?

## Report (the HALT)

End Phase 1 with:

1. **Pre-flight findings** — the four artifact confirmations + the real row/primary/past-date counts. Flag any divergence from this handoff's premises (e.g. if `vote_pct` isn't actually in the live schema, or the scraper's URL pattern differs from HO 91's).
2. **Per-source verdict** — for A/B/C: fetchable (Y/N), static-parseable (Y/N), what it carries, name-match quality against our stored candidates, and coverage across the ~7 already-voted states.
3. **Recommendation** — which single source Phase 2 should build against, the name-join strategy (exact vs. normalized vs. fuzzy), and the honest coverage ceiling (what fraction of our primaries will ever get `vote_pct` from this source — partial coverage is fine, the share bar already has a no-data fallback per HO 203, but we should know the number going in).
4. **Anything that kills the plan** — if no source is cleanly parseable for free, say so plainly. That's a valid Phase 1 outcome and better than a Phase 2 revert.

### Also answer these (folded in from the design-chat map brief — same data dependency)

The rich Primaries map (states colored by competitiveness/results) rides on this exact column, so resolve both in one pass:

5. **Dates reliability (the calendar half).** Independent of results: are `primary_date` values reliable and near-complete across states/contests in the `primaries` table? The map's calendar coloring needs dates regardless of results — confirm that half is solid, and report any NULL/TBD dates (the FEC/House calendars still list several territories + a couple states as TBD).
6. **Coverage fraction for coloring — and the backfill-able count (give a hard number).** If results ingest cleanly, would `vote_pct` exist for ALL primaries or only a subset (only contested, only past-date, only certain states)? Competitiveness coloring needs near-complete coverage or it renders patchy. Report it as a concrete count, not just a fraction: **of the past-date primaries in our table, how many have a parseable result table at the recommended source right now?** That number is the immediate backfill (N of M). The future-date remainder fills in via the forward sync as each state votes. State both: "backfill-able today = N primaries; remaining M−N fill progressively June–September."
7. **The timing reality (state this plainly).** Today is 2026-06-05. Only ~7 states have voted (the 5/16–5/19 cluster: AL, GA, ID, KY, OR, PA, LA); the rest run June–September. So even with a perfect source, a results-colored map is ~14% filled today and completes over ~3 months. Confirm the count of past-date vs future-date primaries in our table. **Pre-results competitiveness would have to come from polling, which is NULL with no source** — so report whether ANY competitiveness signal exists for not-yet-voted primaries, or whether the rich map is necessarily a fall-season payoff that fills in progressively.
8. **Verdict for design:** is the "rich" (competitiveness-colored) map buildable now, or only the "calendar-geography" map (which states / when) until the season plays out and results accumulate? This is the answer the design chat is waiting on.

**HALT here. No migration, no `vote_pct` writes, no `sync-primaries.ts` results path, no UI. Wait for sign-off before Phase 2 is written.**

## Out of scope (Phase 2+, do not touch)

- Writing the results sync / `vote_pct` UPDATE path. **When Phase 2 is written it covers both halves in one handoff (they share the parser): (a) a one-time backfill over the past-date `primary_id`s that have a parseable result table — the N from report item 6 — and (b) the forward sync that writes `vote_pct` for each contest as it votes, so the May→September remainder fills in progressively.** Don't split backfill and forward-sync into separate handoffs.
- The share-bar UI (HO 203's deferred surface) — unblocks *after* the column is populated, separate handoff.
- The primaries map — design-chat spec, separate arc. **Its Phase-1 data questions are folded into the report section above (5–8), so it does not need a separate probe** — one pass answers both the share bar and the map.
- Cosponsor list and full-action-history pipelines — separate endpoints, separate handoffs.
- SKILL.md — nothing ships here, so nothing to reconcile yet.

read docs/handoffs/205-primary-results-source-probe.md and follow
