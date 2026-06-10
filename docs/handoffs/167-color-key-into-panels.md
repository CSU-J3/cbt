# HO 167 — Color key into chart panels (stages → funnel, topics → bubbles, kill footer + hover)

## Why

The HO 162 redesign moved the legend (`ColorKeyStrip`, STAGES + TOPICS) to a dashboard footer. That's a detached location — the key explains two different charts but sits apart from both. Better: put each key with the chart it explains. The STAGES key (stage glyphs + labels) goes into the **Stage Distribution** panel (the funnel it decodes); the TOPICS key (color → abbreviation → topic) goes into the **Topic Distribution** panel (the bubbles it decodes). The footer legend then has nothing left and is removed.

Also: the bubble chart had a planned hover-for-full-name tooltip — **don't add it / remove if present.** With the TOPICS key now sitting in the same panel as the bubbles, the abbreviations are decodable at a glance from the adjacent key; the hover was only going to matter when the key lived in a cramped top strip. (Confirm whether any bubble hover tooltip exists today — if `DashboardBubbleChart` has a native `<title>` or other hover affordance for topic names, leave native `<title>` alone if it's harmless, but don't build the styled HO 147 version.)

## Phase 1 — Diagnostic (HALT after)

**Important:** this handoff edits the elements HO 162 just moved (footer legend, `ColorKeyStrip`, `LegendBadge`). Ground against the **current post-162 / post-165-doc-update** state, not an older snapshot.

Don't build yet. Establish current structure, then halt.

1. **Read `ColorKeyStrip.tsx` and where it's mounted post-162.** Per the HO 162 ship: the legend lives in `.home-footer` / `.color-key-footer` after `</main>`, and a separate `LegendBadge` (text-only `?` popover) sits in the header. Confirm the actual current mount points and the component's internal structure — is the STAGES strip and the TOPICS strip cleanly separable, or are they one block?

2. **Locate the Stage Distribution and Topic Distribution panels.** Find the components/markup for each (the funnel — `StageFunnel`? — and the bubbles — `DashboardBubbleChart`). Report where a key would naturally attach within each panel (header? below the chart?) and whether the panels have room without breaking their layout.

3. **STAGES key shape.** Report what the STAGES key currently renders (the `▸ INTRO`, `▸ COMMITTEE`, `▸▸ FLOOR`, … glyphs + colored labels from `StageIndicator`). Confirm it can render inside the Stage Distribution panel without restyling the glyphs.

4. **TOPICS key shape.** Report the TOPICS key (the 7 color groups → abbreviations, from `lib/topic-colors`). Confirm it can render inside the Topic Distribution panel alongside the bubbles.

5. **Footer + LegendBadge fate.** Confirm that moving both keys out empties `.home-footer`. Report whether to remove the footer region entirely, and what happens to the header `LegendBadge` (the PARTIES / BILL TYPES / ACCENT `?` popover) — that content isn't a stage or topic key, so it has no chart panel to move into. **Propose where PARTIES / BILL TYPES / ACCENT should live** once the footer is gone (keep the `LegendBadge` `?` in the header? that's the natural home — it's the "everything else" reference). Flag this as a decision.

6. **Bubble hover.** Report whether `DashboardBubbleChart` has any existing hover tooltip for topic full-names. We're removing/not-adding the styled version; report what's there so Phase 2 doesn't leave a half-wired affordance.

**HALT. Report findings + the PARTIES/BILL-TYPES/ACCENT decision + the proposed attachment points, and wait for sign-off before Phase 2.**

## Phase 2 — Implementation (only after sign-off)

Based on Phase 1:

- **STAGES key → Stage Distribution panel.** Render the stage glyph+label legend inside (or directly under) the funnel panel. Reuse the existing `StageIndicator`-based rendering; don't restyle.
- **TOPICS key → Topic Distribution panel.** Render the topic color→abbreviation key inside (or directly under) the bubble panel. Reuse the `lib/topic-colors` mapping.
- **Remove the footer legend** (`.home-footer` / `.color-key-footer`) once both keys are relocated. If the footer region is now empty, remove it.
- **PARTIES / BILL TYPES / ACCENT:** per the Phase 1 decision — most likely keep the `LegendBadge` `?` popover in the header (it's the natural home for the "everything else" reference that has no chart). Don't lose this content.
- **Bubble hover:** don't add the styled HO 147 tooltip. Leave a harmless native `<title>` if one exists; remove any half-wired hover affordance.
- `ColorKeyStrip` may end up split or partly retired — keep whatever rendering logic is reused (the stage/topic strips), retire what isn't.

## Verification

- Show the diff.
- Confirm the STAGES key renders with the Stage Distribution funnel and the TOPICS key renders with the Topic Distribution bubbles.
- Confirm the footer legend is gone and the dashboard has no orphaned empty footer region.
- Confirm PARTIES / BILL TYPES / ACCENT is still reachable (header `?` or wherever Phase 1 decided).
- Confirm no broken layout in either panel after the keys are added.
- Type check passes.

## Out of scope

- No change to the funnel or bubble chart logic — only adding the keys to their panels.
- No race-drawer changes (HO 166).
- No new topic hover tooltip.
