# HO 178 — Dashboard reflow: masthead + dual counter-scrolling tapes + 56/44 two-column body

## Why

A dashboard reflow approved in the design chat, amended with decisions from this session. It **reorganizes** existing blocks — it does NOT redesign the charts. But it reverses/reworks several shipped decisions, so Phase 1 must map what's reused vs. retired before touching anything.

**What this changes from current state (post-HO 173):**
- HO 150's two-EQUAL-column body (1fr 1fr) → **56/44 asymmetric**, with a different block distribution.
- HO 162's masthead (lead prose stacked BELOW the title) → **lead prose to the RIGHT of the title**, full-wrap.
- The single markets tape → **two counter-scrolling tapes** (equities one way, commodities/macro the other).
- HO 163's 4-across full-width races strip → **2×2 compact card grid in the right column**.
- HO 166/170's click-to-expand confined drawer on race cards → **ticker-style hover popover** (like the HO 176/177 tape hover).

**Decisions already locked (don't re-litigate in Phase 1):**
- Title stays **36px** (HO 162's size), NOT the spec's ~30px.
- Race cards: **hover popover** (ticker-style), not click-drawer. Click still → race detail page.
- Two tapes, **9/9 balanced**.
- Hover popovers (tape + race cards): **more opaque background** than the current tape popover (the current one is slightly transparent — nav bleeds through; bump opacity for clean separation).

## The spec

### Masthead row
- Title `Congress Terminal:\>` mono **36px** (keep HO 162), fixed width, left-aligned, `:\>` in `--accent-amber`.
- Subhead `· LAST SYNC h:MM AM/PM MT · N BILLS TRACKED` in `--text-dim` 11px, directly under the title (12-hour per HO 169).
- **Lead-in prose (weekly summary) to the RIGHT of the title**, fills remaining width, `--text-secondary` ~13–14px. **Full wrap, NO line-clamp, NO ellipsis** — grows taller as the window narrows. Masthead row height follows the prose when it exceeds the title block.
- Blinking `_` cursor (`--accent-amber-bright`) at the END of the prose — named motion exception.
- **Below 700px:** lead-in prose removed entirely; the blinking cursor rides at the end of the title (`Congress Terminal:\>_`).

### Two counter-scrolling markets tapes (between masthead and nav)
Split the current single 14-symbol tape into two thematic tapes, scrolling in OPPOSITE directions:
- **Equities tape** (9): SPX, NDQ, DOW, ITA, XLK, XLV, XLF, XLE, XLI — scrolls one direction.
- **Commodities/macro tape** (9): WTI, GOLD, silver, copper, natural gas, DXY, TNX, VIX, BTC — scrolls the opposite direction.
- **4 new symbols** (silver, copper, natural gas) + **DXY re-add** (dropped in HO 168) — verify each in Phase 1 (Stooq/FRED, exact symbol, magnitude → width pin + fullName). Likely: silver `xagusd`, copper `hgusd`, natgas (symbol uncertain — verify), DXY (was Stooq before).
- Each tape keeps the HO 175/176/177 machinery: per-symbol width pins, hover-expand popover (full name + group + change + as-of), hover-pause, measured 40px/sec, `<700` hide.
- Opposite direction = reverse the keyframe / `animation-direction: reverse` on one tape. The jump-proof geometry must hold on both.
- **Hover popover: more opaque background** (the tweak — bump the current popover's bg alpha so nothing bleeds through).

### Body — two columns, 56 / 44, gutter 16px
Reverses HO 150's equal-column grid.
- **LEFT (56%)**, stacked, 16px vertical gap:
  1. **BREAKING** — compact rows: ID col (~92px, `--accent-amber` mono, `[+N]` in `--text-dim`) · truncated headline (`--text-secondary`, ellipsis) · right-aligned age (`--text-dim`). `[ + N MORE → ]` footer. Hover-expand per prior spec (full headline floats left-anchored on near-opaque `--bg-row-hover`, overruns rightward into the races column, races column dims to 0.4, timestamp hidden while expanded).
  2. **STAGE DISTRIBUTION** — UNCHANGED. Existing centered-baseline horizontal bars + stage glyph legend + right-aligned counts.
  3. **TOPIC DISTRIBUTION** — UNCHANGED. Existing force-packed bubble cluster (all topics, GOV-centered) + topic legend. Renders as-is at left-column width; component self-scales. Does NOT reflow to a single row.
- **RIGHT (44%)**, stacked, 16px vertical gap:
  1. **COMPETITIVE RACES · 2026** — 2×2 grid of compact cards. Each: race label (`--text-muted` mono) · party-dot + candidate name · one topline rating row (source · rating). `4 SHOWN` top-right. **Hover → ticker-style popover** with fuller detail (candidates + ratings — reuse the RaceHubBody preview content). **Click → race detail page.**
  2. **ACTIVITY / TOP STALLS** — existing feed (ActivityTabs), runs long (6+ rows) to balance the taller left column. `[ + N MORE → ]` footer. Ragged bottom edge OK.

### Interactions
- Breaking hover-expand as specced.
- Race card hover → popover; click → race detail.
- Activity row → bill (existing).
- Existing chart interactions (bubble click-to-filter, etc.) unchanged.

### Constraints
- **Desktop only.** Mobile (<700) column stacking deferred to the 15x mobile pass — EXCEPT the masthead's `<700` cursor-rides-title behavior, which IS in scope.
- **Charts NOT redesigned** — stage bars + topic cluster render in current form.
- **No new tokens.**
- Static except the two named motion exceptions (cursor blink, the tapes).
- Column bottoms balance softly via activity length, not a hard clamp.

## Phase 1 — Diagnostic (HALT after)

This reflow reverses/reworks HO 150/162/163/166/170 — map it all before moving anything.

1. **Current dashboard structure.** Read `app/page.tsx` + the home CSS. Report the current full block order and the grid definitions (the `.home-grid` 1fr 1fr from HO 150, the `.home-header`/masthead from HO 162, the races strip mount from HO 163, the `.home-snapshot-slot` and BREAKING strip from HO 169). Map exactly what moves where in the 56/44 reflow.

2. **Masthead rework.** How is the lead prose currently rendered (HO 162 stacked-below, with the 2-line clamp / `extractReportLead` 180-char cap)? The new spec wants it to the RIGHT, full-wrap, NO clamp. Report what changes: the layout (title block + prose side by side), removing the clamp/char-cap, the row-height-follows-prose behavior, and the `<700` prose-removal + cursor-on-title. Confirm the blinking cursor moves from (wherever it is) to the prose end / title end.

3. **Dual-tape split.** The tape is currently one `MarketsTape`/`MarketsTapeClient` mounting all 14 (global chrome via HeaderBar per HO 154.2, plus the dashboard mount). Report how to render TWO tapes: does `MarketsTapeClient` take a symbol-subset prop + a direction prop? How does the global (non-dashboard) HeaderBar mount handle this — does it also get two tapes, or stay single? (Decide: the dashboard gets two; other pages probably keep one combined, or also two — report the cleanest.) Map the data path: `getLatestMarketTicks` returns all 14; the split is a render-time partition by symbol group. Report how to tag each symbol's group (equities vs commodities) — a field on `MARKET_SYMBOLS`?

4. **New symbol verification.** Fetch + confirm: silver (`xagusd`?), copper (`hgusd`?), natural gas (symbol?), DXY (re-add — the old symbol). Report working symbol + magnitude + width pin + fullName for each. Drop any that don't fetch free.

5. **Races strip → 2×2 + hover.** The current strip (HO 163) is 4-across full-width with HO 166/170 click-to-expand confined drawers (`CompetitiveRacesStrip`, `useSingleOpenPanel<RaceHubData>`, per-card cell + `align-items:start`, `RaceHubBody preview` from `/api/race/[id]/hub`). The new spec: 2×2 grid in the 44% column, **hover popover instead of click-drawer**. Report what's REUSED (the `/api/race/[id]/hub` fetch + `RaceHubBody preview` content likely become the hover popover's body) vs. RETIRED (the single-open click state, the confined-cell grid, `useSingleOpenPanel`?). Map the conversion. The hover popover should match the tape's ticker-style hover (absolute-positioned, opaque bg, no reflow).

6. **Breaking hover-expand overrun.** The spec wants BREAKING's hover-expand to overrun rightward INTO the races column and dim the races to 0.4. With BREAKING now in the LEFT column and races in the RIGHT, confirm this cross-column overrun is feasible (z-index, absolute positioning over the gutter) and report how.

7. **What gets removed.** The `.home-grid` equal-column rule, the full-width races strip mount, the HO 162 stacked-prose layout — report the deletions so nothing orphans.

**HALT. Report: the full current→new block map, the masthead rework, the dual-tape mechanism + new-symbol verification, the races 2×2+hover conversion (reused vs retired), the breaking-overrun feasibility, and the deletion list. Wait for sign-off before Phase 2 — this is large; I'll want to review the plan before it builds.**

## Phase 2 — Implementation (only after sign-off)

Built to the Phase 1 plan, in the spec above. Likely sub-stages (Code proposes the order):
- Masthead rework (prose-right, no-clamp, cursor, <700 behavior).
- Dual tapes (split + opposite scroll + new symbols + opaque hover).
- 56/44 body reflow (block redistribution).
- Races 2×2 + hover conversion.
- Breaking cross-column hover-overrun.

## Verification
- Show the diff (likely large).
- Masthead: prose right of title, full-wrap (grows on narrow), cursor blinks at prose end; <700 → prose gone, cursor on title.
- Two tapes scroll opposite directions, both jump-proof through 2+ poll cycles, hover popover opaque + readable, 9/9 render.
- New symbols tick (run cron once).
- 56/44 body: left Breaking+Stage+Topic, right Races(2×2 hover)+Activity. Race hover → popover, click → detail.
- Breaking hover overruns into races column, races dims.
- Charts render unchanged.
- Type check passes.
- Run on a branch; Corey eyeballs locally before merge (this is big — hold-for-eyeball).

## Out of scope
- Mobile column stacking (15x pass) — except masthead <700 cursor.
- Chart redesigns.
- Live-primary feature (parked).
- New tokens.
