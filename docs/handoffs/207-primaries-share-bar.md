# HO 207 — Primaries tab: chrome consistency + candidate-field RESULTS share bar

## Why

Picks up the deferred HO 203 share bar, now unblocked by HO 206 (`primary_candidates.vote_pct` carries real result shares — 1,166 rows / 382 primaries populated). Two changes to `/races → PRIMARIES tab`: bring chrome in line with Races/Members, and replace the per-primary row with a candidate-field **share bar**.

**Key reframe from HO 203 — read this before building.** HO 203 specced the bar around *polling* share and assumed polls would be rare, making the no-data fallback the majority surface. That premise is dead. We ingested **results** share (actual `vote_pct` from votes cast), not polls. That changes three things:

1. **The fallback inverts and gets honest.** The bar's data condition is no longer "does polling exist" (mostly no) — it's "has this primary voted" (~91% of past-rostered = yes; future = not yet). Voted primaries get the real bar; un-voted future primaries get the fallback. The fallback now means "scheduled — hasn't voted," not "no polling," and it self-resolves as the season runs (today ~47% of all primaries colored, → ~full by September).
2. **The leader marker becomes a real advancer marker.** With results, ★ marks who **won / advanced**, not a poll-leader guess. Runoffs mean **two ★s** — TX-Sen R-primary advanced both Cornyn (42%) and Paxton (40.5%) to a runoff. Mark advancers (`isWinner` from the parse), not just the top segment. This is data HO 203 didn't anticipate.
3. **No Phase 1 needed.** HO 203's Phase 1 gated on the polling-coverage split — HO 206's ship report already answered it (coverage, availability, exact-join, sort all known). Two small unknowns get confirmed at build time inline (below), not a separate diagnostic. Build straight through.

## 1. Chrome consistency (same pattern as Races/Members, HO 195)

- **Cursor** trails the full inline string: `Congress Terminal:\119TH\Races\Primaries> · 15,519 BILLS · UPDATED 3:33 AM MT _` (breadcrumb shows the `\Primaries` segment). Same `cursorAtEnd` treatment Members/Races use.
- **Contrast lift:** sync run `--text-dim` → `--text-muted`; count number → `--text-secondary` (the `liftSyncContrast` treatment).
- **Drop the redundant top `search bills...` input** (clean collapse, no gap — the `pageOwnsControls` pattern).
- Amber `\`/`>` glyphs, `--text-primary` path (shared masthead).

**Build-time confirm (not a halt):** check whether the Primaries tab is already on `pageOwnsControls`/`cursorAtEnd`/`liftSyncContrast` or needs the same migration Members/Races got in HO 195. Apply whichever is needed; note which in the ship report.

## 2. Candidate-field results share bar (per primary row)

A primary is a within-party multi-candidate field. **Deliberately parallel structure to the Races spectrum** (same row rhythm + expand) but a different metric — a results-share bar, not a D↔R spectrum.

**Columns:** `SEAT · PARTY · FIELD (result share) · PRIMARY (date)`.

**Share bar (voted primaries — `vote_pct` populated):**
- Horizontal bar segmented by candidate result share; segments sum to ~100% (minor-candidate truncation from the top-3+"+N" rollup accounts for the small remainder — render the "+N" as a `--border-strong` segment).
- **Party-tinted:** the whole bar in `--party-democrat` OR `--party-republican` (a primary is one party).
- **Rank by brightness:** leader segment full-opacity; trailing candidates step down (~0.62, ~0.40) so rank reads by brightness.
- **Build-time confirm (not a halt):** against the real `--party-democrat`/`--party-republican` hexes, check the ~0.62/~0.40 trailing segments are legible (saturated party colors at low opacity can wash out). If they don't read, adjust the steps or swap to a different rank cue (e.g. a thin divider + brightness) and note the call in the ship report.
- **Advancer marker:** ★ on every candidate with `isWinner` true (this is the results reframe — runoffs advance two, so **two ★s is valid and expected**; do not assume a single winner). Place the ★ on the segment label.
- Segment labels inline ("Name NN") where width allows.
- **Long fields:** top-3 segments by share + a "+N" `--border-strong` segment for the rest.
- **Contest state reads from shape:** one wide segment = decisive; two near-equal = went to runoff / close.

**Fallback — un-voted primaries (`vote_pct` NULL, future date):** render a **plain candidate list** ("A · B · 2 others — not yet voted", `--text-dim`) — NOT a bar. **Never fake an even-split bar** — an even split falsely reads as "tied." Label it by the real reason now: not yet voted (date in the future), not "no polling." If the row carries the primary date, "— votes [DATE]" is a fine honest variant.

**Expand (reuse HO 148 click-to-expand):** full candidate field — every candidate's result share, incumbent flag, advancer ★, links to member pages where a candidate is a sitting member. Preserve existing row-click behavior. **No candidate photos** (separate future decision, out of scope).

**Sort:** keep whatever the tab currently sorts by. If competitiveness, closest-margin-first surfaces contested/runoff primaries (two near-equal segments) up top — confirm and keep.

## Verification

- Chrome matches Races/Members (cursor trailing the `\Primaries` string, contrast lifted, no `search bills...`, amber glyphs).
- A **voted** primary shows the party-tinted results bar (leader bright, trailing dimmer, top-3 + "+N", contest state legible from shape). Eyeball TX-Sen R (Cornyn + Paxton both ★, near-equal → reads as runoff-close) and a decisive one (one wide segment, single ★).
- **Two-★ runoff case renders correctly** — confirm an advanced-two primary shows both markers.
- An **un-voted** primary shows the plain "not yet voted" fallback list — never a fake even-split bar.
- Expand shows full field + shares + incumbent flag + ★ + member links (no photos).
- Sort unchanged; contested primaries surface appropriately if sort is competitiveness.
- `tsc` passes.
- Code uses the running dev server (:3000); Corey eyeballs a voted primary, an un-voted one, the TX-Sen two-★ runoff, and an expand.

## After ship

- SKILL.md: flip the share-bar note from "data unblocked, UI pending" to shipped; record the results-reframe (advancer ★ incl. two-★ runoffs, "not yet voted" fallback semantics). Flag for the next sweep if not done inline.

## Out of scope

- **Candidate photos in the expand** (separate, pending the photo diagnostic).
- The RACES tab (this is the sibling PRIMARIES tab).
- The primaries **map** (design-chat arc — ships the calendar version first, results-coloring layers on the same `vote_pct`; separate handoff).
- Mobile <700 (deferred).
- Polling-based competitiveness for un-voted primaries — no source, stays a fallback list until the contest votes.

read docs/handoffs/207-primaries-share-bar.md and follow
