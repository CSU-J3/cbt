# HO 196 — Members page: list-row bar + column headers (2 of 4)

## Why

Second of four `/members` redesign handoffs (195 chrome shipped). This fixes the collapsed list rows: today they show **two bars on two scales with no headers**, and the green pass-rate bar is a meaningless stub for most members. Replace with **ONE bar whose meaning follows the active VOLUME/PASS RATE toggle**, and add column headers.

## The change

**Columns:** `# · MEMBER (name + party-colored bracket) · [BAR] · RATE · ENACTED · BILLS`

**The bar (never two — meaning = active sort):**
- **PASS RATE view (default):** a fixed-width track (~#1a1f2e) with a green fill (`--stage-enacted` #10b981) = % of the member's bills at enacted stage. **Track always full-width** so fills compare row-to-row. 0% = empty track.
- **VOLUME view:** a single party-colored bar, length = bill count scaled to the max in the current view. No green segment.
- Party color lives in the name bracket, NOT the bar — except the volume-view bar, which is inherently party-colored by length.

**Right-aligned figures (monospace):**
- **RATE:** `%` — green when >0, `--text-dim` when 0.
- **ENACTED:** `N ✓` — `--text-secondary`; `--text-dim` when 0.
- **BILLS:** count — `--text-dim`; emphasized `--text-primary` when sorted by volume.

**Column headers:** a thin row above the list, `--text-dim` 9px, border-bottom. The middle (bar) header label follows the toggle: **PASS RATE** or **BILLS**. Live currently has no headers — add them. ("ENACTED" may crowd — "ENACT" or "✓" acceptable; Code's call on fit.)

## Phase 1 — light diagnostic (then proceed)

1. **Current row structure.** Read the members list row component + `getMembersRanked` output. Report: what does each row render today (the two bars, the figures), and what fields are available per member (total bills, enacted count, pass rate, party). Confirm the pass-rate fill (enacted/total %) and the volume bar (count / max-in-view) are both derivable from data already on the row — no new query.
2. **Max-in-view for the volume bar.** The volume bar scales to "the max in the current view." Confirm how to get that max (the ranked list's top entry when sorted by volume, or a computed max across the rendered page). Report the cleanest source.
3. **Toggle wiring.** The VOLUME/PASS RATE toggle already drives `?sort=volume|passrate` (per SKILL, `getMembersRanked`'s ORDER BY swap). Confirm the row can read the active sort to pick which bar to render + which header label to show + which figure to emphasize.

This is mostly a render change to existing data — brief HALT to confirm the bar's derivable and the max-in-view source, then proceed.

## Phase 2 — Implement (after sign-off)
- One bar per row, swapping by active sort (pass-rate fill default / volume party-bar).
- Column headers row (`# · MEMBER · [PASS RATE|BILLS] · RATE · ENACTED · BILLS`), 9px dim, border-bottom, middle label follows the toggle.
- Right-aligned monospace figures with the specified color rules.
- Party color in the bracket (and the volume bar by length); pass-rate fill is green regardless of party.
- Remove the old second bar.

## Verification
- Default (pass rate): each row shows ONE full-width track with a green fill = enacted %; 0% = empty track; rows compare cleanly.
- Volume view: the bar becomes a single party-colored length-scaled bar; no green; BILLS figure emphasized.
- Headers present, middle label swaps PASS RATE ↔ BILLS with the toggle.
- Figures: RATE green/dim, ENACTED `N ✓`, BILLS dim/emphasized per rules.
- Never two bars at once.
- No new query (derived from existing row data).
- Type check passes.
- Code uses the running dev server (:3000, hot-reload); Corey eyeballs both toggle states.

## Out of scope
- Scatter (HO 197), expanded card (HO 198).
- The member ranking/sort logic itself (unchanged — just reading the active sort).
- Mobile <700 (deferred).
- SKILL.md — flag for the next sweep (batched: 194 + the Members arc 195–198).
