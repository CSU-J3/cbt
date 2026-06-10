# HO 189 — Inner-page chrome v2 (4 bands, sync pulled inline)

## Why

Approved design refinement from the CBT Design chat. HO 187 shipped the 5-band inner-page chrome; this v2 takes it to **4 bands** by pulling the standalone sync strip inline into the title bar. Same surface (the `HeaderBar` inner pages + the feed-shaped pages); the dashboard stays untouched.

## The 4 bands (top to bottom)

**Band 1 — TITLE BAR** (one row, `--bg-panel`, border-bottom `--border-strong`)
- Left: the PowerShell path `Congress Terminal:\119TH\<Section>[\<Detail>]>_` (~16px, amber `\`/`>`, blinking cursor) **immediately followed inline by the sync text** `· N BILLS · UPDATED HH:MM MT` (`--text-dim`, 10px).
  - **Cursor placement is specific:** the `_` cursor stays glued to the `>` (i.e. `…\Bills>_`), and the sync text sits AFTER the cursor — `…\Bills>_ · N BILLS · UPDATED HH:MM MT`. Do NOT put the sync text between the path and the cursor.
- Right: the main nav (DASHBOARD · BILLS|NEWS · MEMBERS · RACES · PATTERNS · REPORTS · WATCHLIST), active item `--accent-amber-bright`.
- **The standalone sync strip (HO 187 band 2) is removed entirely** — its content moves inline here.

**Band 2 — CONTROL STRIP** (one row, border-bottom `--border-strong`) — unchanged from HO 187:
- BILLS|NEWS toggle · ALL STAGES dropdown · ALL/HOUSE/SENATE segments · compact search (⌕, flex:1, max 230px) · INCLUDE CEREMONIAL checkbox · SORT pinned right.

**Band 3 — TOPICS BAND** (one row, wraps, border-bottom `--border-strong`) — unchanged from HO 187:
- Left: sub-nav CHANGES · PRESIDENT · REPORTS, divider rule, then the 24 topic chips.

**Band 4 — LEGEND + PAGINATION** (thin, border-bottom `--border-strong`) — unchanged from HO 187:
- Left: stage legend (6 stages, colored) + the R/D/I party key.
- Right: pagination ‹ PREV  1 2 3 … N  NEXT ›  PAGE X OF Y.

Then: the bill list.

## Note on page size

The spec says "15 per page." **HO 187 set it to 25** (Corey's call, walking back the original 15 as too aggressive given the real start was 100). This handoff does NOT change the page size — leave it at 25 unless Corey says otherwise. (Flagging because the design spec re-states 15; treat 25 as current/correct.)

## Confirmed from the spec
- Sync strip removed; its content (`· N BILLS · UPDATED HH:MM MT`) goes inline in the title bar, after the cursor.
- Bands 2–4 unchanged from HO 187.
- Tape stays dashboard-only (no change).
- No new tokens; no motion except the cursor blink.
- Desktop-first; mobile <700 deferred to the mobile pass.

## Phase 1 — Diagnostic (HALT after)

1. **Map the current title bar + sync strip** as shipped in HO 187 (the `BreadcrumbMasthead` / title-bar render + the separate sync strip band). Report how the sync content is currently produced (the `N BILLS · UPDATED HH:MM MT` line) so it can move inline.

2. **Inline sync collision (the real risk — the spec's open question).** The title bar now packs: path (fixed-ish width, varies by depth) + inline sync text + nav (fixed). At narrow desktop widths, the sync text is the squeeze point between the fixed path and fixed nav. **Confirm the collapse order: sync text truncates/drops BEFORE the nav wraps or the path truncates.** The path is the identity (never truncate first); the nav is fixed-priority; the sync is the lowest-priority element and should be what gives first (ellipsis or hide) when space is tight. Measure at 1280/1440/1920 and report what happens to the sync text at each, plus the deep-path case (`…\Committees\Judiciary Committee>_` + sync + nav at 1280). Recommend the degrade rule (sync truncates → then hides → path/nav protected).

3. **Cursor-glue confirm.** The `_` must stay attached to the `>` with the sync text after it. Confirm the markup order renders `…\Bills>_ · N BILLS · UPDATED…` and the blinking cursor animation still works in that position (it's the CSS caret from HO 185).

4. **Title-size hierarchy (carry-over).** A recent tweak made the path larger than the nav (path = title, nav subordinate). Confirm that hierarchy holds when the sync text is added inline (the small 10px sync shouldn't disrupt the path-bigger-than-nav relationship).

**HALT. Report: the current title/sync structure, the inline-collision degrade rule (sync gives first, path/nav protected — measured at desktop widths incl. deep path), the cursor-glue confirm, and the title-size check. Wait for sign-off.**

## Phase 2 — Implementation (after sign-off)
- Move the sync content (`· N BILLS · UPDATED HH:MM MT`) inline into the title bar, after the cursor.
- Remove the standalone sync strip band.
- Apply the degrade rule so the sync text is the first to truncate/hide at narrow widths (path + nav protected).
- Bands 2–4 untouched. Page size stays 25.

## Verification
- Inner pages show 4 chrome bands (title+sync inline / control / topics / legend+pagination) — no standalone sync strip.
- Title bar reads `Congress Terminal:\119TH\<Section>>_ · N BILLS · UPDATED HH:MM MT` on the left, nav on the right, one row.
- Cursor `_` glued to `>`, sync after it, cursor still blinks.
- At 1280 (and deep paths), the sync text truncates/hides before nav wraps or path truncates — verify the degrade.
- Path remains visually larger than nav.
- Dashboard untouched.
- Type check passes.
- Code starts the dev server; Corey eyeballs at desktop + a narrow width.

## Out of scope
- Bands 2–4 (unchanged from HO 187).
- Page size (stays 25).
- The dashboard.
- Mobile <700 (deferred to the mobile pass — these bands will need wrap rules there).
- The bill-row layout redesign (separate, design-chat).
- SKILL.md — flag for the next sweep (this + 187 + 188).
