# HO 187 — Inner-page chrome rethink (5-band consolidation)

## Why

Approved design from the CBT Design chat. The non-dashboard pages (Bills|News `/bills`, Members, Races, Patterns, Reports, Watchlist, detail pages) currently stack ~9-10 chrome bands before content — it reads as a wall. Consolidate to **5 bands**, remove the markets tapes from inner pages, fix the oversized search, and drop to 15 bills/page.

**Dashboard is untouched** — it stays the clean reference. This is inner-pages only (the `HeaderBar` surface).

## Key reversal to flag

This **reverses HO 185's "dual tapes everywhere"** decision: the markets tapes (`DualMarketsTape`) become **dashboard-only** again. Inner pages get no tape. In the handoff commit message, reference the commit that added them (HO 185 sub-stage 2, `6aa9007`) so the history is traceable. The `DualMarketsTape` component stays (the dashboard still uses it) — just remove its mount from `HeaderBar`.

## The 5 bands (top to bottom)

**Band 1 — TITLE BAR** (one row, `--bg-panel`, border-bottom `--border-strong`)
- Left: the PowerShell path `Congress Terminal:\119TH\<Section>[\<Detail>]>_` — ~16px, amber `\`/`>`, blinking cursor. **Unchanged from current** (the HO 185 `BreadcrumbMasthead`).
- Right: the main nav (`⌂ DASHBOARD · ▤ BILLS|NEWS · MEMBERS · RACES · PATTERNS · REPORTS · ★ WATCHLIST`), `--text-dim`, active item `--accent-amber-bright`.
- **Merges the old masthead + main-nav bands into one terminal title bar.** (Currently HO 185 put nav on its own row below the masthead — this pulls it up to the right of the path.)

**Band 2 — SYNC STRIP** (thin, ~5px pad, `--bg-panel`, `--text-dim` 10px, border-bottom `--border-soft`)
- `· UPDATED HH:MM MT · N BILLS` left-aligned. No pagination here (moved to band 5).

**Band 3 — CONTROL STRIP** (one row, border-bottom `--border-strong`)
- BILLS|NEWS segmented toggle (active segment `--bg-row-hover` bg + `--accent-amber-bright` text)
- ALL STAGES dropdown
- HOUSE / SENATE chamber segments (moved into this row — **see Open Question 2 on semantics**)
- Search: **compact terminal input**, ⌕ glyph, `flex:1`, `max-width:230px`, `min-width:110px`. NOT the oversized masthead box (reverts that).
- INCLUDE CEREMONIAL checkbox (relocated from the masthead — it's a filter)
- SORT dropdown, pinned right via `margin-left:auto`

**Band 4 — TOPICS BAND** (one row, wraps, border-bottom `--border-strong`)
- Left: the Bills|News sub-nav `CHANGES · PRESIDENT · REPORTS`, separated from the chips by a vertical `--border-strong` divider rule. Active sub-view `--text-secondary`, inactive `--text-dim`.
- Then: the 24 topic chips (colored border per topic-color group, fill when active), wrapping as today.

**Band 5 — LEGEND + PAGINATION** (thin, border-bottom `--border-strong`)
- Left: stage legend `▸ INTRO · ▸ COMMITTEE · ▸▸ FLOOR · ▸▸▸ OTHER CHAMBER · ▸▸▸▸ PRESIDENT · ✓ ENACTED`, each stage-colored, 10px.
- Right (`margin-left:auto`): pagination `‹ PREV  1 2 3 … N  NEXT ›  PAGE X OF Y` (moved off its own centered band).

Then: the bill list — **rows unchanged, out of scope.**

## Confirmed decisions
- **Tape:** removed from inner pages (dashboard-only). Reversal of HO 185 — flag in commit.
- **Search:** control strip, compact, between chamber segments and ceremonial toggle.
- **Sub-nav:** left edge of the topics band with a divider rule.
- **Stage legend:** kept visible as its own thin run (not hover-hidden).
- **Ceremonial toggle:** relocated from masthead into the control strip.
- **Bills per page: 15** (down from ~20).

## Phase 1 — Diagnostic (HALT after)

1. **Map the current inner-page chrome** in `HeaderBar` + the Bills page (`app/bills/page.tsx`) + the filter components (StageFilter, TopicFilter, SegmentedToggle, SearchBox, CeremonialToggle, the pagination control, the stage legend). Report the current band structure and which component renders each piece — so the consolidation moves known parts, not guesses.
2. **The nav-into-title-bar move.** HO 185 (`4135f36`) just moved HeaderBar's nav to its OWN row to stop the path wrapping. This handoff pulls it back UP, to the right of the path in one title bar. Confirm the path + nav fit on one row at desktop width without the wrapping problem that caused 4135f36 — report how (the path is now tight/short on most pages; nav right-aligned). If a deep detail path (`…\Members\Committees\Judiciary Committee>_`) + full nav would collide on one row, report the fallback (nav wraps under? path truncates? — recommend).
3. **Tape removal.** Confirm removing `DualMarketsTape` from `HeaderBar` leaves the dashboard's tapes intact (HomeHeader keeps its own mount) and doesn't orphan the cycling-AS-OF / zone-cycle logic (it's per-tape, so dashboard keeps it). Report.
4. **Bills per page 20 → 15.** Find where the page size is set (the query `LIMIT` / the pagination math). Confirm changing to 15 updates both the slice and the "PAGE X OF Y" total correctly. Report.
5. **OPEN QUESTION — search width vs. wrapping at ~1280px.** The control strip packs: toggle + ALL STAGES + HOUSE/SENATE + search (flex:1 ≤230px) + ceremonial + sort. **Measure against real desktop widths (1280, 1440, 1920)** — does anything wrap awkwardly mid-band at the narrow end before mobile? Report what fits and whether the control strip needs a wrap rule or tighter sizing at 1280. This is the one with real layout risk.
6. **OPEN QUESTION — chamber filter semantics.** Currently the live page uses ALL STAGES (a dropdown) separately from HOUSE/SENATE. Report: are HOUSE/SENATE currently a 3-way (ALL/HOUSE/SENATE) or two independent toggles? In the new control strip, should chamber be a clean 3-segment ALL/HOUSE/SENATE control, or stay as-is? Recommend based on the current semantics — don't change filter behavior, just place it.

**HALT. Report: the current chrome map, the nav-into-title-bar fit (+ deep-path fallback), the tape-removal confirm, the page-size change, the 1280px control-strip measurement, and the chamber semantics. This touches the shared HeaderBar (every inner page) — I'll review before Phase 2.**

## Phase 2 — Implementation (after sign-off; likely sub-staged)
1. Title bar: nav up beside the path (one row), drop the separate nav row from 4135f36.
2. Sync strip (thin, the UPDATED/N BILLS line, no pagination).
3. Control strip: toggle + stages + chamber + compact search + ceremonial + sort.
4. Topics band: sub-nav + divider + chips.
5. Legend + pagination row.
6. Remove DualMarketsTape from HeaderBar (dashboard keeps it).
7. Bills per page → 15.

## Verification
- Inner pages show exactly 5 chrome bands (title / sync / control / topics / legend+pagination), no markets tape.
- Dashboard untouched (still has its tapes, prose, 56/44 body).
- Search is compact in the control strip; ceremonial moved there; sort pinned right.
- Sub-nav (Changes·President·Reports) at the topics-band left with a divider; chips wrap as before.
- Stage legend + pagination share the bottom band.
- 15 bills/page; PAGE X OF Y recomputed.
- Nothing wraps awkwardly at 1280/1440/1920 (per the Phase-1 measurement).
- The breadcrumb path + toggle tracking + detail segments still work (HO 185 intact).
- Type check passes.
- Code starts the dev server; Corey eyeballs across /bills, /members, a detail page, and at a couple of widths.

## Out of scope
- Bill rows, charts, detail-page content.
- The dashboard (untouched).
- Mobile <700 (these bands will need wrap/collapse rules — **downstream dependency for the mobile pass**, note it, don't spec it here).
- SKILL.md — flag for the next sweep (this changes the inner-page chrome + reverts dual-tapes-everywhere).
