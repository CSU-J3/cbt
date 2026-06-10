# HO 180 — Per-topic bubble colors + hover-for-full-name (drop the group legend)

## Why

The Topic Distribution bubble chart currently colors bubbles by **topic group** (~7 buckets: FIN/COMM, TECH, DEF/FOR, ENV/ENERGY, SOC/LABOR, JUSTICE, INFRA/GOV, OTHER), so many individual topics share a color (ENV + ENRG both green, etc.). Three changes:

1. **Per-topic colors** — each topic gets its own color, so every bubble is visually distinct (not grouped).
2. **Hover popover with the full category name** — TRNS → "Transportation", FRGN → "Foreign Affairs", etc. Same hover-popover pattern as the markets tape and race cards (consistent interaction language).
3. **Drop the 7-bucket group legend** — once colors are per-topic, the group legend is wrong, and the hover decodes the color, so the legend is redundant. Remove it.

The abbreviations (TRNS, FRGN, CONS, SS) are opaque; the hover-for-full-name is the real usability win, and it's what lets the legend go.

## Design reality (state up front)

There are ~20+ individual topics. **20+ distinct, legible colors on the dark background (#050709) is a genuine palette problem** — past ~12, colors get hard to tell apart, and they must not clash with the amber accent or the party colors. So:
- The palette needs a real categorical scale (not hand-picked hexes), and even then some colors will be near-collisions — that's acceptable **because the hover is the source of truth for "which topic is this."** Don't over-engineer an impossible "all 20 obviously distinct" palette; aim for reasonable variation + rely on hover for the name.

## Phase 1 — Diagnostic (HALT after)

1. **Current color + label model.** Read `lib/topic-colors.ts` (the topic group colors) + `lib/enums.ts` (labels) + the bubble chart client island (the d3-pack component, HO 132/132.1). Report:
   - How bubbles currently get their color (group → color map).
   - The full list of individual topics (the ~20+ codes: TRNS, FRGN, GOV, etc.) and where they're defined.
   - **Do full category names exist?** TRNS → "Transportation", CONS → ?, SS → ? — are the long-form names in `enums.ts` (or anywhere), or only abbreviations + group? If the full names don't exist, they need adding — report which are missing.

2. **Per-topic palette.** Propose the approach for ~20+ distinct colors on the dark bg:
   - A categorical scale (d3 `schemeCategory10` is only 10; `schemeObservable10`/`schemePaired` ~12; for 20+ you need to combine scales, use `d3.quantize(d3.interpolateRainbow, n)`, or a curated 20-color set). Report what gives the most legible 20+ on #050709 without clashing with amber/party colors.
   - **Static map preferred** — a fixed topic→color assignment so TRNS is always the same color (not index-based that shifts if topics reorder).
   - Where the map lives (`lib/topic-colors.ts` extended to per-topic).

3. **Hover popover.** The bubbles are SVG `<g>` (d3-pack), with soft-nav click-to-filter (HO 132). Report how to add a hover popover showing the full category name (+ maybe the count). Match the tape/race-card hover style (absolute-positioned, opaque `--bg-row-hover`, above other content). Confirm it composes with the existing click-to-filter (hover shows name, click still filters by `?topics=`). SVG hover positioning differs from HTML — report the approach (foreignObject, an HTML overlay positioned from the bubble x/y, or a title-like element).

4. **Legend removal.** Read where the 7-bucket topic legend renders (the `TOPICS ● FIN/COMM ● TECH …` row). Confirm nothing else depends on it, and report the clean removal. (The STAGES legend under the funnel — HO 167 — stays; this is only the TOPICS bubble legend.)

5. **Selected-state interaction.** HO 132: a selected bubble gets `--accent-amber-bright` stroke + full opacity, zero-count bubbles render dimmed. Confirm per-topic colors don't break the selected/dimmed states (the amber selection stroke still needs to read against any bubble color).

**HALT. Report: the color/label model + missing full names, the 20+ palette approach (static map, legible on dark, no amber clash), the SVG hover-popover approach, the legend removal, and the selected-state check. Wait for sign-off — the palette especially, I'll want to see it before it's applied.**

## Phase 2 — Implementation (after sign-off)
- Per-topic color map (static, in `lib/topic-colors.ts` or wherever Phase 1 says).
- Add any missing full category names.
- Hover popover (full name + count), tape/race-card style, composing with click-to-filter.
- Remove the 7-bucket TOPICS legend.
- Preserve: click-to-filter (`?topics=`), selected-state amber stroke, zero-count dimming, the d3-pack layout.

## Verification
- Each topic bubble is its own color (not grouped); the amber selection stroke still reads on every color.
- Hover any bubble → popover with the full category name (TRNS → "Transportation"), tape/race-card style.
- Click still filters by topic (`?topics=`).
- The TOPICS group legend is gone; the STAGES legend (HO 167) is untouched.
- Type check passes.

## Out of scope
- No change to the stage funnel or its legend.
- No change to bubble sizing/packing (HO 132) or click-to-filter behavior — only color + hover + legend.
- Run the HO 181 SKILL sweep first so this grounds against a current doc.
