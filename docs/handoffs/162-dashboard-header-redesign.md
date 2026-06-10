# HO 162 — Dashboard header redesign (kill the void, grow the brand, legend to footer)

## Why

The dashboard masthead has a large dead whitespace band at wide viewports. Root cause: `.home-header-top` lays the `TerminalPrompt` + lead-in prose + `ColorKeyStrip` in one flex row, and the row's height is driven by the tall `ColorKeyStrip` (11 stage+topic rows). The lead text doesn't fill that height, so a ~280px void opens between the left masthead block and the top-right legend. At narrow widths the legend collapses and the void shrinks — that's why it "looks fine" sometimes and broken at full width. The brand prompt is also undersized (18px desktop) — it doesn't anchor the page.

Three fixes, one structural change:
1. Move the legend (`ColorKeyStrip`) out of the masthead and into a footer.
2. Grow the brand prompt to 36px+ on desktop so it anchors the page.
3. The masthead becomes single-column full-width, which kills the void by construction (nothing tall left to drive row height).

## Design decisions (approved — build to these)

- **Legend → footer.** `ColorKeyStrip` (the STAGES + TOPICS inline legend, currently boxed top-right at 172px) moves to a footer region on the dashboard. The masthead's right column disappears; prompt + lead + meta go full-width single-column.
- **Brand prompt → 36px+ on desktop.** `Congress Terminal:\>` becomes the clear page anchor. Keep `:\>` in `--accent-amber`. The lead-in prose stays as terminal "output" below/beside it per the existing model, but at the new brand scale the lead should sit on its own line(s) below the brand, not share a cramped baseline.
- **Keep a `?` badge up top.** The `?` badge popover currently lives inside `ColorKeyStrip` (HO 147). Since the always-visible legend now requires scrolling to the footer, keep a small `?` badge near the brand or nav that pops the full legend inline — so quick reference is available above the fold without scrolling.

## Phase 1 — Diagnostic (HALT after)

Don't edit yet. Confirm the real structure, then halt.

1. **Read `HomeHeader.tsx` and the relevant `globals.css` rules** (`.home-header-top`, `.home-header-prompt-row`, `.home-header-lead`, `.home-header-meta`, `.home-header-nav`, `ColorKeyStrip` styles). Report the actual current layout: what's flex vs grid, what drives the masthead height, where the void comes from in the real CSS (confirm or correct my diagnosis above).

2. **Confirm there's no existing footer component on the dashboard.** SKILL says feed-shaped routes render `StageLegend` inline and "there is no footer legend component." Confirm the dashboard has no footer slot today, so we know we're creating one, not reusing one.

3. **Locate the `?` badge** in `ColorKeyStrip` and confirm it can be rendered standalone (separated from the inline legend strip) so one instance can stay in the header while the full legend moves to the footer. Report whether the badge + popover are coupled to `ColorKeyStrip` or extractable.

4. **Check the mobile rules that touch these elements.** SKILL flags: the prompt currently *grows* to 24px at <700px (`.home-header-prompt-row .terminal-prompt`); the lead-in is hidden <1024px; the meta line abbreviates <700px. Report these so Phase 2's desktop brand bump (36px+) doesn't collide with the mobile grow rule. **We are not touching mobile behavior in this handoff** — but the desktop change must not break the existing <1024 / <700 rules. Flag any conflict.

**HALT. Report findings and wait for sign-off before Phase 2.**

## Phase 2 — Implementation (only after sign-off)

- **Masthead → single-column full-width.** Remove `ColorKeyStrip` from `.home-header-top`. Prompt, lead-in prose, and meta line stack full-width. The void should be gone because the row is no longer sized by the legend.
- **Brand prompt → 36px** on desktop (`≥1024`). Don't touch the `<700` grow-to-24px rule unless Phase 1 shows a conflict; if there's a conflict, report the proposed reconciliation rather than guessing. The brand is now the dashboard hero.
- **Lead-in** sits below the brand at the new scale (keep `--text-muted`, keep the blinking caret as the existing motion exception). Adjust line-clamp if needed so it reads cleanly under a 36px brand.
- **Footer legend.** Create a dashboard footer region holding the relocated `ColorKeyStrip` legend (STAGES + TOPICS). Full-width, muted, reference-density. It sits at the bottom of the scrollable page.
- **Header `?` badge.** Keep one `?` badge in the header (near brand or nav) that pops the full legend inline (PARTIES / BILL TYPES / ACCENT + STAGES + TOPICS), so above-the-fold quick reference survives the legend move.
- Don't touch the markets tape, nav, breaking strip, weekly-report snapshot, or the `.home-grid` below — this handoff is the masthead + footer only.

## Verification

- Show the diff.
- Screenshot (or describe) the masthead at wide viewport (≥1600px) confirming the void is gone.
- Confirm the brand renders at 36px desktop and the `<700` / `<1024` mobile rules still behave (prompt still grows on mobile if that rule is retained, lead still hidden <1024).
- Type check passes.

## Out of scope (don't do)

- No mobile redesign. Existing breakpoint behavior stays; just don't let the desktop brand bump break it.
- No races strip (separate handoff).
- No activity-drawer wiring (separate handoff).
- No nav label change (separate handoff).
