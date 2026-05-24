# 133 — Dashboard layout pivot v2: header reflow, tabbed quadrant, capped+expander

## What this is

Iteration on HO 131. Annotated feedback after the v1 ship shifts the IA significantly enough that another Phase-1-disciplined handoff is warranted, not a copy-paste tweak. The earlier-queued HO 133 (activity row redesign with see-more) folds into this scope because the cap-with-expander pattern now applies to both BREAKING and ACTIVITY.

The seven asks from Corey's annotated screenshot:

1. **Constrain title block width.** LEAD prose currently stretches the full viewport at 2560×1440. Cap container at max-width ~700px.
2. **Color key relocates to the header band**, right side.
3. **Stage Distribution joins the header band too**, between or alongside the color key.
4. **Breaking + Top Stalls consolidate into a single tabbed quadrant** in the grid.
5. **Breaking and Activity gain a cap-with-expander control.** Currently overflow:hidden clips silently; replace with an explicit "show more" affordance.
6. **Color key chips get hover tooltips** explaining each color.
7. **BillRow rail color gets documentation** — a Bill Types section in the color key plus a tooltip on the rail itself.

HO 132 (Topic Distribution → bubble chart) stays separate. It can ship before or after HO 133 since the topic block's grid slot is independent of the header/tab restructure.

The layout shifts from "6 quadrants in 3×2" to roughly:

```
┌─────────────────────────────────────────────────────────────┐
│ Title block (≤700px)  │  STAGE DIST       │  COLOR KEY       │  Header band
│ Congress Terminal:\>  │  6 bars + footnote│  Stages · Topics │
│ LEAD (line-clamp)     │                   │  · Parties       │
│ · sync · count        │                   │  · Bill Types    │
│ ──nav strip──         │                   │  · Accent        │
├─────────────────────────────────────────────────────────────┤
│ Tabs: BREAKING | TOP STALLS  │  ACTIVITY                    │  Row 1 (2 cols)
│ Capped + [show 12 more] expander │  Capped + expander       │
├─────────────────────────────────────────────────────────────┤
│ TOPIC DISTRIBUTION (full width)                              │  Row 2 (1 col)
└─────────────────────────────────────────────────────────────┘
```

Multi-multi-layer. Phase 1 diagnostic mandatory.

## Prior art

- **HO 131** — dashboard redesign foundation (what's getting iterated)
- **HO 125 / 127 / 130** — BillRow current state (rail + watch star + media-attention cell)
- **HO 123** — tooltip sweep (vocabulary baseline)
- **HO 128** — pattern bubble cluster (the SVG idiom HO 132 will reuse)
- **HO 129** — search tabs (tab component reference pattern)
- **HO 53** — original dashboard shell

## In scope

- Phase 1 — audit current artifacts, propose new layout grid + tabs component + expander pattern + tooltip vocabulary + Bill Types color-key section
- Phase 2 — implement per signed-off picks
- Phase 3 — SKILL.md updates, verification at 2560×1440 + 1920×1080

## Out of scope

- Topic Distribution → bubble chart (HO 132, separate)
- BillRow internal changes (HO 125/127/130 just settled them)
- Other pages' layouts
- Mobile-first redesign — desktop ships first
- Animation polish on expander or tab transitions
- Filter/sort within the new Breaking/Top Stalls tab strip

## Phase 1 — Diagnostic (no commits)

Read artifacts. Measure. Propose. Post findings. No code beyond audit.

### Required reads

1. **`components/HomeHeader.tsx`** (current state post-HO-131) — title block structure, line-clamp behavior, nav placement
2. **`components/ColorKey.tsx`** — current 4 sections (Stages, Topics, Parties, Accent), chip rendering, where the tokens come from
3. **`components/StageFunnel.tsx`** (or whatever drives STAGE DISTRIBUTION) — current pane wrapper, internal padding, "+ N off-path" footnote
4. **`components/BreakingNewsBlock.tsx`** + **`components/TopStalls.tsx`** — row shapes, footer/CTA, count limits
5. **`components/ActivityTicker.tsx`** — current TICKER_LIMIT (15 from Phase 1 audit), row rendering, current footer
6. **`components/SearchTabs.tsx`** — tab component reference from HO 129 (reuse or fork)
7. **`components/StagePill.tsx`** — `title=` text per stage (source for color-key stage tooltips)
8. **`components/BillRow.tsx`** — find where the rail color is computed (bill_type → color mapping) for the new tooltip + Bill Types section
9. **`app/globals.css`** — current `.home-header*`, `.home-grid`, `--home-header-height: 180px` token

### Measurements to confirm

Header band currently ~180px (post-tweak). Adding two right-side blocks (STAGE DIST + COLOR KEY) might push to ~240–280px depending on layout. Run the math in Phase 1 and confirm the grid still fits 2560×1440 and 1920×1080 without scroll:

```
Header band:            __ px (proposed)
Grid Row 1 (tabs+activity): __ px
Grid Row 2 (topic):     __ px
Gaps + padding:         __ px
Total:                  __ px
Viewport at 1080p:      ~1000 px usable
Viewport at 1440p:      ~1360 px usable
```

If the math overshoots 1080p, flag in Phase 1 and propose compression (line-clamp tighter, fewer activity rows, shorter row height).

### Proposals to post

Each gets a recommendation. Sign-off picks per item.

1. **Header band 3-column layout.** Two flavors:
   - (a) `grid-template-columns: 700px 1fr 1fr` — title block fixed, stage + color split the remainder equally
   - (b) `grid-template-columns: minmax(0, 700px) auto auto` — title shrinks to fit content, stage + color size to their content
   - Recommend (a) — predictable widths, cleaner alignment with the grid below.
   - Stage dist sits in the middle column. Color key on the right.

2. **Color key sections.** Current four become five:
   - **STAGES** — unchanged (6 chips)
   - **TOPICS** — unchanged (8 color groups + catchall)
   - **PARTIES** — unchanged (3 chips)
   - **BILL TYPES** (new) — 8 chips for the rail colors: `S`, `HR`, `HRES`, `SRES`, `HCONRES`, `SCONRES`, `HJRES`, `SJRES`. Sourced from wherever `BillRow` computes the rail color.
   - **ACCENT** — unchanged
   - Confirm in Phase 1 which bill types actually appear in `bills` (some may be unused).

3. **Color key chip tooltips.** Add `title=` to every chip:
   - Stage chips: copy from `StagePill` `title` text (e.g. `▸ INTRO` → `"Introduced; filed but not yet referred to committee"`)
   - Topic group chips: list constituent topics (e.g. `FIN/COMM` → `"Financial services · taxes · budget · trade · consumer protection"`)
   - Party chips: full name (`DEM` → `"Democrat"`)
   - Bill type chips: full name (`S` → `"Senate bill"`, `HCONRES` → `"House concurrent resolution"`)
   - Accent: keep the existing inline explanation, no tooltip needed
   - Recommend matching HO 123's tooltip vocabulary: sentence case, no trailing period.

4. **Rail tooltip on BillRow.** Confirm whether HO 123 added `title=` to the rail element. If yes, no change. If no, add `title="<full bill type name>"` to the rail span — same vocabulary as the Bill Types color-key chips.

5. **Tabbed quadrant for Breaking + Top Stalls.** New component `components/BreakingStallsTabs.tsx`:
   - Two tab buttons: `BREAKING (3)` and `TOP STALLS (5)` (counts dynamic)
   - Default tab: BREAKING (matches current home priority)
   - Active tab: `--accent-amber` bottom border, same chrome as HO 129's `SearchTabs`
   - Click → swaps content, no URL change (this is a within-quadrant interaction, not a routable view)
   - Tab state via `useState`, not URL — different scope than HO 129's `?tab=` pattern
   - Reuse `SearchTabs.tsx` styling if possible; fork only if interaction model differs

6. **Cap-with-expander pattern.** Three sub-decisions:

   **6a. Cap count.** Recommend 5 rows visible per surface (BREAKING and ACTIVITY). Aligns with the screenshot's drawn cap line and matches TOP STALLS' existing 5.

   **6b. Expander behavior.** Three options:
   - (i) **Inline expand** — cell grows on click, rest of grid stays. May force a small page scroll if expanded content exceeds viewport. Simple to build but breaks the no-scroll commitment when active.
   - (ii) **Modal/drawer overlay** — full list opens in a centered modal or right-side drawer. Preserves no-scroll. More complex.
   - (iii) **Route to full page** — `[show 12 more →]` becomes a Link to `/news` (BREAKING) or `/changes` (ACTIVITY). Same as existing `[VIEW ALL]` footer pattern, just more visible.
   - Recommend (iii). Cheapest to build, consistent with existing patterns, and the no-scroll viewport stays intact. The full views already exist; the expander just makes them more discoverable.

   **6c. Expander chrome.** Footer-style row that reads `[ + 12 MORE → ]` or `[ SHOW 12 MORE → ]` in `--text-muted`, 12px uppercase tracked. Click → navigates per 6b.

7. **Grid restructure.** After removing STAGE DIST + COLOR KEY (to header) and consolidating BREAKING + TOP STALLS (to tabs), the grid has 3 items: tabbed quadrant, ACTIVITY, TOPIC DISTRIBUTION.
   - Row 1: `Tabs (1fr) | Activity (1fr)` — equal columns
   - Row 2: `Topic Distribution (full width)` — spans both columns
   - When HO 132 ships, the topic bubble lands in this row-2 cell naturally
   - Heights: Row 1 ~360–420px, Row 2 ~360–420px. Confirm against measurements.

### HALT

End Phase 1 with: schema confirmations, measurements showing the new total fits viewport, proposals 1–7 with picks (including sub-picks 6a/6b/6c), and a layout sketch confirming the new IA. Wait for sign-off on every numbered proposal before Phase 2.

## Phase 2 — Implementation (after sign-off)

Shape depends on Phase 1 picks. Sketch only.

### Header restructure

`components/HomeHeader.tsx` becomes a 3-column grid per pick 1:

```tsx
<header className="home-header">
  <div className="home-header-title">
    <h1 className="terminal-prompt">Congress Terminal<span>:\&gt;</span></h1>
    <p className="home-header-lead">{lead}</p>
    <p className="home-header-meta">· LAST SYNC {sync} MT · {count} BILLS TRACKED</p>
    <nav className="home-header-nav">{/* NAV_ITEMS.map */}</nav>
  </div>
  <div className="home-header-stage">{/* StageFunnel pulled out of grid */}</div>
  <div className="home-header-key">{/* ColorKey pulled out of grid */}</div>
</header>
```

CSS:
```css
.home-header { display: grid; grid-template-columns: 700px 1fr 1fr; gap: var(--space-lg); }
.home-header-title { max-width: 700px; }
```

### Color key expansion

`components/ColorKey.tsx` gains a `BILL TYPES` section between `PARTIES` and `ACCENT`. Each chip gets `title=` per pick 3.

### Rail tooltip

`components/BillRow.tsx` — locate the rail `<span>` (likely `.row-rail` or `.bill-type-rail`). Confirm whether `title=` exists. Add if missing.

### Tabbed quadrant

New `components/BreakingStallsTabs.tsx`. Client component with local `useState` for active tab:

```tsx
"use client";
const [tab, setTab] = useState<"breaking" | "stalls">("breaking");
// renders BreakingNewsBlock or TopStalls based on tab
```

Reuse styling from `SearchTabs.tsx` — fork only if the click handler needs to differ.

### Cap-with-expander

If pick 6b is (iii) — route-based:
- `BreakingNewsBlock` and `ActivityTicker` drop their current `[VIEW ALL → ]` footer
- Replace with `[ + N MORE → ]` chrome, more visible than the current footer
- The N value is `total - cap` from the existing count
- Link target: `/news` and `/changes` respectively

### Grid restructure

`app/page.tsx` and `app/globals.css`:

```css
.home-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  grid-template-rows: 1fr 1fr;
  gap: var(--space-md);
  height: calc(100vh - var(--home-header-height) - 24px);
}
.home-quadrant--topic { grid-column: 1 / -1; }  /* full-width row 2 */
```

Adjust `--home-header-height` per Phase 1 measurements (likely 240–280px now that stage + color join).

### Verification

1. `/` renders with new 3-column header (title left, stage middle, color key right)
2. Title block visibly bounded — LEAD prose wraps within ~700px even at 2560×1440
3. Color key shows all 5 sections, every chip has a working hover tooltip
4. BillRow rails have hover tooltips showing full bill type name
5. Grid row 1 shows tabbed quadrant (BREAKING active by default) + ACTIVITY
6. Clicking the TOP STALLS tab swaps content within the same cell, no URL change
7. BREAKING + ACTIVITY both show ~5 rows + `[ + N MORE → ]` expander chrome
8. Expander links navigate to `/news` and `/changes` respectively
9. Grid row 2 shows TOPIC DISTRIBUTION at full width
10. No-scroll at 2560×1440 and 1920×1080
11. Type-check clean, working tree ready to commit, no console errors

## Acceptance

1. Phase 1 diagnostic posted with measurements, current-state audit, all seven proposals (with 6a/6b/6c sub-picks)
2. Sign-off received on every numbered proposal
3. Phase 2 per signed-off spec
4. Home page renders the new IA, fits viewport without scroll at both target resolutions
5. Five color-key sections live, every chip has a tooltip
6. Rail tooltips present on every BillRow surface
7. Tab swap working, expander chrome routing correctly
8. SKILL.md updated: `/` Pages entry rewritten for the new IA, color key section gains Bill Types, expander pattern documented
9. Type-check clean, working tree clean, pushed
10. Commit: `feat(dashboard): layout pivot v2 — header reflow, tabbed quadrant, expander (HO 133)`

## Don't

- Don't ship without sign-off on every Phase 1 pick. The IA shifts substantially and one wrong pick cascades.
- Don't add URL state to the BREAKING/STALLS tabs — local `useState` only. Different from HO 129 where tabs are routable surfaces.
- Don't build the expander as a modal in v1. Route-based (pick 6b iii) is the recommended path.
- Don't redesign BillRow internals. Rails, watch star, media-attention cell stay as-is.
- Don't swap the topic block to a bubble chart here. That's HO 132's scope; the grid slot accommodates either.
- Don't change `lib/topic-colors.ts` or any color tokens. The palette stays.
- Don't break the no-scroll commitment. If Phase 1 measurements show the new layout overshoots 1080p, flag and propose compression rather than shipping a scroll.
- Don't ship if the Bill Types section ends up showing 8 chips in single line and breaks visually at narrower header widths. Stack across 2 lines if needed.

## Notes

- HO 131 just settled the previous IA 30 minutes before this pivot. Acknowledge that some Phase 2 work directly overturns HO 131 picks (3×2 grid → 2×2 + full-width row, color key as quadrant → header chip). That's the cost of iterating fast on a redesign; the cumulative direction is right.
- The cap-with-expander pattern is a small but valuable interaction primitive. If pick 6b lands on (iii), no new component is needed — just chrome on the existing footer. If pick 6b lands on (i) or (ii), the cost is materially higher.
- HO 132 (topic bubble) and HO 133 (this) are independent. Either can ship first. After both ship, the layout is complete.

read docs/handoffs/133-dashboard-layout-v2.md and follow
