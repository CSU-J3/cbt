# HO 226 — /races PRIMARIES modal + results-era primary card

Confirm the next free number before saving: `ls docs/handoffs/ | sort | tail`. Body assumes 226.

## What this is

The PRIMARIES sibling of the Races district modal (HO 225). Click a state on the PRIMARIES map → a centered modal (same shell as HO 225) → state district-overview maps band + pick chips → a **two-party-column primary card** (D primary | R primary). Recolors the map for the primary calendar (recency bands) and adds a month scrubber. Reuses HO 224 `district-geo`, the HO 225 modal shell, and **the shipped HO 207 results share bar** (extracted into a shared component, not rebuilt).

**Card structure is RESOLVED** by the approved results-era design (supersedes spec-4's polling-era card premise). See Card section.

**Scope fence:**
- Overview maps only (metro-zoom = spec-3 Phase 2, separate later HO — same as HO 225).
- **No news block** anywhere (race→news linkage doesn't exist — the wall every surface hit; spec-4 marks it ⏸). The card aligns columns via a footer spacer, not the deferred news-pin.
- **This HO's map = calendar/recency version** (HO 205 verdict). Do NOT build results-coloring on the map (separate later layer; HO 206 notes it). Recency bands only.
- Do not modify CartogramShell structurally (additive handler — Phase 1A).
- Do not rebuild the HO 207 share bar — extract and reuse it.

## PREMISE CORRECTION — record this, it killed spec-4's card

spec-4 was drawn against the **dead HO 203 polling world** ("no-polling fallback is the default for nearly every contest", "58% polling lead" front-runner, a front-runner/full-field toggle). **That premise is gone.** The codebase lives in the **HO 206/207 results world**: `primary_candidates.vote_pct` is real **results** share (votes cast, not polls), ~47% coverage today, self-filling May→September. The fallback is now the **minority** case and means **"hasn't voted yet,"** not "no polling." There is **no polling anywhere** — any "NN% lead" front-runner copy is fiction. The HO 207 results bar is already shipped on the single-list surface; this card composes around it.

---

## Phase 1 — read before wiring (HALT-gated)

### 1A — PRIMARIES map wiring read (do first, before any change)

Same additive-handler discipline HO 225 resolved for the Races map. The PRIMARIES map currently has its own pin→inline behavior (`PrimaryMapCard` via `setPinned`, the mirror of the Races `RaceMapCard` path). HO 225 already added an optional `onStatePick` prop to CartogramShell and wrapped `/races` in `RacesMap`. Read how PRIMARIES renders the map today and branch:

- Confirm whether the PRIMARIES tab renders CartogramShell directly (HO 225 left it doing so, pin→inline unchanged) or through its own wrapper.
- Plan: a `PrimariesMap` client wrapper (mirror of HO 225's `RacesMap`) that holds modal state and passes `onStatePick={openModal}`, so the pin→inline `PrimaryMapCard` behavior is replaced by the modal on this surface — OR adapted, matching whatever 225 did for Races. **Reuse the `onStatePick` prop HO 225 already added; do not add a second mechanism.**
- **Hard constraint:** do not rebuild CartogramShell, fork it, or alter its projection to attach the handler. If it can't attach cleanly, STOP and flag.

### 1B — HO 207 share-bar extraction read (do before building the card)

The card reuses the shipped HO 207 results bar. Before building, locate it:

- Find where the HO 207 bar renders today (likely inline in the PRIMARIES single-list row component from HO 207/208). Confirm whether it's already a discrete component or inline markup.
- Plan the extraction: pull the bar (segment logic, advancer `★`, two-`★` runoffs, top-3 + "+N others" `--border-strong` rollup, party tint, voted/not-yet fallback) into a **shared component** both the single-list surface AND this modal card consume. This is the HO 222 anti-drift move (`race-colors`/`race-cells` unified the Races surfaces; this unifies the two primaries share-bar surfaces).
- **Confirm the extraction doesn't change the single-list render** — the shipped surface must look identical after the bar becomes shared. Verify the TX-Sen two-`★` runoff case still renders on the single list post-extraction.

### 1C — primaries data the card reads (confirm present, each degrades safely)

- **Per-district primary contests:** confirm the data gives, per state + district, the D primary and R primary (a district can have both — independent contests), each with its candidate field from `primary_candidates` (name, party, `isWinner`/advancer flag, `vote_pct`).
- **Contest state derivation:** how the card decides VOTED+DECIDED vs VOTED+RUNOFF vs NOT-YET-VOTED. Voted = `vote_pct` populated; runoff = ≥2 `isWinner` advancers; not-yet = `vote_pct` NULL + future date. Confirm `isWinner` count drives the one-`★` vs two-`★` branch and that a primary date is reachable for the scheduled stamp.
- **Per-state contest count + representative date** (for the map's `● N` badge and recency band): confirm the data gives a count of contests per state and a single representative date per state (earliest? most-contests date? — pick and report). Recency band (VOTED/SOON/LATER/NONE) derives from that date vs today.
- **District → seat resolution:** the HO 224 `district-geo` already carries server-resolved `seatId` per polygon (HO 225 proved this). Confirm a clicked primary district resolves to its contest(s). Note: primaries key on seat the same way — confirm a district with two primaries (D + R) resolves both.
- **Open primary vs open seat:** the primaries `'open'` party-enum is distinct from the HO 221 general-election open-seat flag (`incumbentRunning`). Keep them separate — do not cross-wire.
- **DC / territories / single-district states:** confirm they render in the recency map and a single-primary state shows one column cleanly.

**HALT after Phase 1** with: the map-wiring case + plan, the HO 207 bar location + extraction plan (and confirmation the single-list won't change), the contest-state derivation confirmed against real seats (one decided, the TX-Sen runoff, one not-yet-voted), and the per-state count/date resolution.

---

## Phase 2 — build

### PRIMARIES national map (recency recolor + scrubber)

Same live CartogramShell, recolored for the primary calendar by recency band — **map surface, not card:**
- **VOTED** `#0e7490` · **SOON** `#b45309` (rolling next-N window, not a fixed 30 days) · **LATER** `#1e2740` · **NONE** `#11161f` (not selectable).
- **`● N` badge** on multi-primary states (count of contests).
- **Month scrubber** above the map: discrete segments `MAR · JUN · AUG · SEP · ALL`. Click dims states outside that month / highlights that month's. Static segmented control, **no animated playhead, no motion.**
- **Grouped NE leader-line hover** — same as Races (hover lights polygon + line + label together; the group is clickable).
- **Keep the existing hover popover** (compact per-state contest peek) — click escalates to modal, hover unchanged. (Same complementary pattern HO 225 honored.)
- Recency bands only — **no results-coloring on the map this HO.**

### Modal

Same shell as HO 225 (centered, dimmed backdrop, amber border, ×/click-away/Esc — the minimal shell HO 225 built). A scrubber row in the modal header too. Maps band identical to HO 225 (state overview via `district-geo`; metro panels deferred). Click a district → the primary card fills the detail panel.

### Primary card — two party columns, three states each (RESOLVED design)

Two party columns side by side (D primary | R primary; one column if the district has a single primary). **No front-runner/full-field toggle. No portrait. No "front-runner" framing. No polling copy** — results only.

Each column is in ONE of three states:

1. **VOTED + DECIDED** — lead with the (extracted) HO 207 results bar; one `★` on the winner; footer `WON · advances to Nov`.
2. **VOTED + RUNOFF** — HO 207 bar; **two `★`s** (both advancers, e.g. Cornyn 42 / Paxton 40.5); footer `RUNOFF · top 2 advance [DATE]` in amber.
3. **NOT YET VOTED** — no bar, no leader. Scheduled stamp `SCHEDULED · votes [DATE incl. year]` + the who-filed roster (candidate + tag). Footer `no results yet · N filed`.

**Column-bottom alignment** (replaces the deferred news-pin): each column is a flex container with a **col-spacer** that pushes a thin status **footer** flush to the bottom regardless of roster length. The footer carries the outcome (WON / RUNOFF / no results yet) + candidate count. This aligns the two columns' bottoms. **No news block.**

**The `★` marker** = won/advanced (`isWinner` from the parse). Two `★`s is valid and expected for runoffs — do not assume a single winner.

**Share bar** = the extracted shared HO 207 component (segment logic, `★`, two-`★` runoffs, top-3 + "+N others" `--border-strong` rollup, party tint, voted/not-yet fallback). Reused, not rebuilt.

### Pick row + actions

Quick-pick chips mirroring the map (click a chip = click that district). `↓ EXPORT REPORT` (client-side markdown of the field(s), same approach as HO 225, **no news section**) and `RACE HUB →`, dimmed until a district is picked.

### Legend sizing

The primary calendar key under the map (VOTED / SOON / LATER + the `● N multiple primaries` note): larger swatches (~15px), ~12px labels in `--text-muted`, comfortable spacing — matching the HO 225 Races legend so the two map surfaces stay consistent.

---

## Constraints

- Reuse: HO 225 modal shell + `onStatePick` prop, HO 224 `district-geo`, **extracted HO 207 share bar**, the recency/party palette + opacity steps. No new color tokens, no new hues, no new overlay primitive.
- No motion (scrubber is discrete segments, hover is instant).
- Desktop-first; mobile <700 deferred explicitly — falls back to the existing primary single-list below the breakpoint (don't break it).
- News deferred across the board. Map is recency-only (no results-coloring). Metro panels deferred.

## Verification

- Fresh `.next` (`rm -rf .next` + one `npm run dev`); stylesheet 200, not a 404.
- **Single-list surface unchanged** post-extraction — eyeball the TX-Sen two-`★` runoff still renders on the single list (the shared-bar extraction must not regress the shipped surface).
- PRIMARIES map recolored by recency band; `● N` badge on a multi-primary state; scrubber dims/highlights by month; hover popover still works.
- Click a state → modal opens (HO 225 shell), maps band renders the state overview from `district-geo`, click a district → card fills.
- All three column states render: a VOTED+DECIDED contest (one `★`, "WON" footer), the **TX-Sen RUNOFF** (two `★`, amber "RUNOFF" footer), a NOT-YET-VOTED contest (no bar, scheduled stamp, "N filed" footer). A district with both a D and R primary shows two columns; a single-primary district shows one cleanly.
- Two-column bottoms align via the footer spacer with unequal roster lengths.
- Pick chip ↔ map highlight bidirectional. Export → valid `.md`, no news section. `tsc` clean.

Commit as HO 226 once verified. Leave scratch under `scripts/diagnostic/`. SKILL.md: PRIMARIES modal entry (shell reuse, `district-geo` consumption, three-state card, extracted shared share bar, recency map + scrubber, deferred news + metro). Note the HO 207 bar is now a shared component consumed by two surfaces.

---

read docs/handoffs/226-primaries-modal-card.md and follow
