# HO 181 — SKILL.md reconciliation sweep (HO 174 → 179.1)

## Why

SKILL.md is current through ~HO 173. Since then, eight handoffs shipped and merged to main without a doc update. Reconcile SKILL.md to match the live code. Same approach as the HO 165 and HO 166–172 sweeps: **factual updates only, preserve voice and structure, re-grep the client-island count, show the diff, commit separately as a `docs:` commit.** Don't rewrite untouched sections.

## What shipped since the last SKILL update (the drift to reconcile)

**HO 174 — race roster refresh + GA runoff**
- Strip rosters refreshed post-primary: PA-10 Stelson `won_primary`; GA Collins/Dooley `running` (advanced), Carter `withdrew`; NJ-07 field corrected to Bennett/Roth/Shah/Varela (O'Rourke removed).
- GA modeled as a **June 16 runoff** — `data/runoff-seeds/ga-senate-2026.json`, `senate-GA-2026-R-runoff`, surfaces via `getRunoffsForRace` → `RaceRunoffs` on `/race/[id]` and the dashboard race popover.
- `scripts/seed-runoffs.ts` **refactored to glob `data/runoff-seeds/*.json`** (was a single hardcoded LA file) — future runoffs are drop-a-file.
- Note: `race_candidates` has no eliminated/lost status — `withdrew` is the canonical "out" value.

**HO 175 — tape geometry fix + hover-expand + size bump**
- The 60s scroll jump was geometry, not React: `translateX(-50%)` against a `width:max-content` track whose width changed when polled values changed item widths. Fixed by pinning per-symbol slot widths so track width is value-invariant.
- Hover-expand popover (full name + group + change + as-of), CSS-absolute, composes with hover-pause.
- Size bump: tape height 32→38px, font 12→14px.

**HO 176 — tape spacing + hover legibility**
- Per-symbol `PRICE_SLOT_CH` map (replaced the global 8ch pin) — right-aligned + tabular-nums, tight + jump-proof.
- Item padding 22→18px.
- Hover popover readability: `--bg-row-hover` bg, name 14px/`--text-primary`, meta 12px/`--text-muted`.

**HO 177 — tape expanded to 14 symbols + full-name hover**
- 6 new symbols: NDQ (`^ndq`), DOW (`^dji`), XLF/XLE/XLI (`*.us`), BTC (`btcusd`). Tape was SPX/WTI/TNX/ITA/XLK/XLV/GOLD/VIX (8) → 14.
- `fullName` field added to all symbols (`MARKET_SYMBOLS` → `MarketTick` → popover).
- Per-symbol pins for the new ones (NDQ/DOW 9ch, BTC 10ch, etc.).

**HO 178 — dashboard reflow (the big one)**
- **Masthead:** lead prose now to the RIGHT of the 36px title (was stacked below), full-wrap no-clamp; subhead under title; blinking cursor at prose end (≥700) / title end (<700); prose removed <700. Retired the line-clamp queries + `LegendBadge`/the `?` (HO 179.1 detail below).
- **Dual counter-scrolling tapes:** the single tape split into TWO on the dashboard — equities (9: SPX, NDQ, DOW, ITA, XLK, XLV, XLF, XLE, XLI) one direction, commodities/macro (8: WTI, GOLD, silver, natgas, DXY, TNX, VIX, BTC) the opposite. A `group` field on `MARKET_SYMBOLS` partitions them; `reverse` prop flips one. Other pages (HeaderBar) keep ONE combined tape (all symbols).
  - New symbols this HO: silver (`xagusd`), natgas (`ng.f`), DXY re-added (`dx.f`). **Copper was dropped** (no clean free USD/lb source). So the full symbol set is now **17** (not 18 — copper out).
- **56/44 two-column body** (reverses HO 150's 1fr 1fr): LEFT = Breaking + Stage + Topic; RIGHT = Races (2×2) + Activity. `ReportSnapshot` stays a full-width band above the grid.
- **Races strip → 2×2 hover:** the HO 163 4-across strip + HO 166/170 click-to-expand confined drawer is replaced by a 2×2 card grid with a **hover popover** (RaceHubBody preview, server-prefetched). Card click → `/race/[id]`. Retired: `useSingleOpenPanel` for races, the confined-cell/`align-items:start` drawer machinery, the `/api/race/[id]/hub` client fetch for this surface (endpoint left in place, now unused by the dashboard).
- **Breaking compact rows + cross-column hover-overrun:** BREAKING is now compact (ID · truncated headline · age) with a hover-expand overlay that overruns rightward into the races column and dims it to 0.4 via CSS `:has()`. (Long-headline overrun still wants a live confirm — note as such if unverified.)

**HO 179 + 179.1 — reflow chrome fixes**
- One cursor (compound-selector fix: exactly one cursor per breakpoint).
- Tape `AS OF` meta: solid `--bg-panel` bg + left fade strip (no symbol bleed). And **only ONE tape renders the meta** (bottom/commodities; `showMeta={false}` on top) — single stamp for the dashboard's two tapes.
- **Dense tapes:** each marquee half repeats the set `copies = max(2, ceil(container/setWidth))` (measured client-side) so it always fills the viewport; AND null-change symbols (first-tick, no prior session) **omit** the arrow+change slots entirely (valued symbols keep reserved slots → still jump-proof; null→first-value is a one-time settle).
- **Popover stacking fix:** the trap was the track's animated `transform` creating a stacking context. Fix: `.markets-tape { z-index: 30 }` (above nav on all pages) + dashboard tapes wrapped in `.markets-tape-block` with top z-31 / bottom z-30, so either tape's downward popover paints above the other + the nav. (No portal.)
- **`LegendBadge` (the `?`) removed** from the masthead; orphaned function deleted from `ColorKeyStrip.tsx` (StageKey/TopicKey kept).

## Phase 1 — light diagnostic (then proceed; this is a doc task)

1. Read the current SKILL.md sections that touch: the markets tape (symbol list, count, the single-tape description, the hover, the jump/geometry notes), the dashboard layout/IA (the HO 150 equal-grid, HO 162 masthead, HO 163 races strip, HO 166/170 drawer), the races/runoff model, and the client-island ("use client") count.
2. Grep `"use client"` for the current island count (the reflow split/retired some islands — CompetitiveRacesStrip went from a client drawer-island to server-prefetched cards; MarketsTapeClient still client; report the new count).
3. Report which SKILL sections are stale and your planned edits, grounded in the live files (don't trust this handoff's summary over the actual code — `view` the real files: `lib/markets.ts`, `MarketsTapeClient.tsx`, `app/page.tsx`, the masthead component, `lib/queries.ts`, `scripts/seed-runoffs.ts`, `app/globals.css` for the tape/grid). Brief HALT to confirm the edit plan, then proceed to Phase 2 (it's a doc sweep — no need for a heavy gate, but list what you'll change before changing it).

## Phase 2 — reconcile

- Update the stale sections to match live code: tape (17 symbols, dual counter-scrolling on dashboard / single elsewhere, the group/reverse/showMeta props, per-symbol pins, the geometry jump-proofing, copies-fill, null-slot omission, the hover popover + fullName, the z-index/stacking-block); masthead (prose-right, cursor behavior, no LegendBadge); body (56/44, block distribution, ReportSnapshot band); races (2×2 hover popover, retired drawer machinery, runoff seed glob + GA runoff); the `withdrew`-as-out-status note.
- Preserve voice and structure. Factual edits only. Don't rewrite sections that didn't change.
- Update the client-island count.
- Add a brief note for the still-open items (breaking long-headline overrun unconfirmed; 6 new symbols show — change until next session; `/api/race/[id]/hub` now unused by the dashboard).

## Verification
- Show the SKILL.md diff (word-level if large).
- Confirm the symbol count (17), the dual-tape model, the 56/44 layout, the races 2×2 hover, and the runoff model all read correctly.
- Commit separately: `docs: reconcile SKILL.md for HO 174–179.1`.
- This is docs-only — no code changes, no type check needed (but confirm no code was touched).

## Out of scope
- No code changes — documentation only.
- HO 180 (per-topic bubble colors) is a SEPARATE upcoming handoff — don't fold it in. Run this sweep; HO 180 (bubble colors) grounds against a current SKILL.
