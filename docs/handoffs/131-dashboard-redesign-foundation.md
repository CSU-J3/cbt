# 131 — Dashboard redesign: header, nav, no-scroll layout, tooltips, color key

## What this is

Fresh design direction following the AlienVault/LevelBlue brief closure (HOs 126/128/129/130). Nine asks from the redesign chat, sequenced across three handoffs. HO 131 is the foundation — IA + layout + chrome. HOs 132 and 133 follow once HO 131 lands.

The seven asks in HO 131:

- **#1** Snapshot of everything on the dashboard
- **#4** Fix spacing issues
- **#5** Title rebrand: `CBT // 119TH CONGRESS` → `Congress Terminal:\>` with LEAD inline, increase title size
- **#6** Move page buttons under title
- **#7** Hover tooltips on nav items
- **#8** Color key for everything
- **#9** No scrolling — fit everything in viewport

Deferred to follow-ups:

- **#2** Topic Distribution → bubble chart → HO 132 (reuses HO 128's `PatternBubbleSVG` architecture for 24 topics)
- **#3** Activity Last 7 Days → 4-5 rows + inline expand + see-more → HO 133 (BillRow interaction change)

Sequencing matters: asks 5/6/9 reshape the layout grid. Committing the bubble chart + activity changes before the grid is locked means rework. HO 131 settles the new IA; HO 132/133 fill in.

Multi-multi-layer. Phase 1 diagnostic mandatory and especially careful here — most of these asks are visual judgment calls that need Corey's eye on the proposals before Code commits.

## Prior art

- **HO 53** — original dashboard shell, three-pane grid
- **HO 81** — stage funnel viz idiom
- **HO 114** — breaking-news block on home (still lives there)
- **HO 124** — member coverage refactor
- **HO 125 / 126 / 127** — BillRow + home reorganization + quick-watch
- **HO 126** — most recent home layout change (4-quadrant block + BREAKING, LEAD, TOP STALLS surfaces)
- **HO 128** — pattern bubble cluster (the SVG idiom HO 132 will reuse)
- **HO 129** — search tabs (the chrome/tab idiom)
- **HO 130** — media attention column (most recent BillRow change)

## In scope

- Phase 1 — audit current home blocks + measured heights, propose new title chrome + nav strategy + no-scroll grid + tooltip pattern + color-key surface + spacing fixes
- Phase 2 — implement per signed-off picks
- Phase 3 — SKILL.md updates, verification

## Out of scope

- Topic Distribution bubble chart (HO 132)
- Activity Last 7 Days row redesign + inline expand (HO 133)
- BillRow internal structure (HO 125/127/130 just settled this)
- Search box / SearchBox component (HO 129 just settled this)
- Other pages' layouts (`/feed`, `/members`, `/news`, `/reports`, `/patterns`, `/races`, `/changes`, `/stale`, `/president`, `/watchlist`)
- Mobile-first redesign — desktop ships first, mobile follows once desktop settles
- Animation polish (cursor blink on the terminal prompt, transition effects)
- A different color palette — the existing `--bg-*` / `--text-*` / `--accent-*` / `--stage-*` / `--party-*` tokens stay
- Removing or hiding pages from nav — every existing nav target stays reachable

## Phase 1 — Diagnostic (no commits)

Read artifacts. Measure. Propose. Post findings + proposals. No code beyond the audit.

### Required reads

1. **`app/page.tsx`** — current home component tree, block ordering, layout grid wrapper
2. **`components/HeaderBar.tsx`** — current title chrome, count line, nav rendering (from HO 124 onward), where `SearchBox` lives
3. **`app/globals.css`** — current home grid + spacing tokens (gap, padding), the `.home-*` classes from HO 126, any `--space-*` variables
4. **`components/BreakingNewsBlock.tsx`**, **`components/ActivityTicker.tsx`**, **`components/StageDistribution.tsx`** (or whatever names), **`components/TopStalls.tsx`**, **`components/TopicDistribution.tsx`** — measure each block's rendered height in typical content
5. **`components/MediaAttentionCell.tsx`** + **`components/WatchStar.tsx`** — already have hover-tooltip patterns via `title=` (HO 123 / HO 127). The nav-tooltip approach should match.
6. **Existing `<title>` attributes across nav** — what's already covered, what isn't (HO 123 tooltip sweep covered a lot)

### Measurements to post

Open `cbt-chi-silk.vercel.app` in browser dev tools at the user's typical viewport (assume 1920×1080 desktop unless better data; ask if uncertain). Post the rendered pixel height of each home block in the current layout:

```
Header chrome (title + last sync + count line): __ px
Nav strip:                                       __ px
LEAD block (LAST UPDATED + 4-line prose):        __ px
BREAKING block (header + 3 rows):                __ px
STAGE DISTRIBUTION block (header + 6 bars):      __ px
ACTIVITY block (header + N rows currently):      __ px (and how many rows)
TOP STALLS block (header + 5 rows):              __ px
TOPIC DISTRIBUTION block (header + 24 bars):     __ px
Footer + legend:                                 __ px
Total:                                           __ px
Available viewport (1080 minus browser chrome ~80): ~1000px
```

Sum minus available = how much compression Phase 2 needs to achieve no-scroll.

### Proposals to post

Each gets recommendations. Sign-off picks per item.

1. **Title rebrand** (ask 5). `CBT // 119TH CONGRESS` becomes `Congress Terminal:\>`. The LEAD prose follows as the "response" to the prompt. Two layout variants:
   - (a) `Congress Terminal:\>` on its own line, LEAD prose immediately below, no separator chrome (no `LEAD · LAST UPDATED 03:48 MT` header)
   - (b) `Congress Terminal:\>` followed by the LEAD prose flowing inline if it fits, wrapping below otherwise
   - Recommend (a). Inline only works at narrow LEAD prose (1 line); current LEAD is 4 lines. Cleaner to keep the prompt as the header line and the prose as the answer.
   - Font size: current title is ~14px per SKILL.md. Bump to ~24–28px for the new prompt. Family stays `var(--font-mono)`.
   - Color: white-on-black (`--text-primary` for `Congress Terminal:` and `--accent-amber` for `:\>` accent, mirroring the terminal-prompt aesthetic).
   - Optional: keep the `· LAST SYNC HH:MM MT · 15,903 BILLS TRACKED` line below the title as muted subhead, or move it to footer. Recommend keeping below the title as a single dim 11px line.

2. **Nav placement** (ask 6). Move from top-right horizontal strip to a row beneath the title.
   - (a) Single horizontal row under the title, all 12 nav items, may wrap at narrow widths
   - (b) Two rows: primary (FEED · NEWS · REPORTS · MEMBERS · RACES · PRIMARIES · PATTERNS · TRENDS) + secondary (STALE · CHANGES · PRESIDENT · WATCHLIST)
   - Recommend (a). Wrapping is fine on narrow screens; two rows imply a hierarchy that doesn't really exist (CHANGES isn't less important than PRIMARIES).
   - Visual treatment: same 12px uppercase tracked text, glyph + label, separators between items. Active route gets `--accent-amber`.

3. **No-scroll layout** (asks 1, 9). The hardest constraint. Phase 1's measurements decide what fits. Three layouts to consider:
   - (a) **3×2 quadrant grid** below header: row 1 = `BREAKING | ACTIVITY | TOP STALLS`, row 2 = `STAGE | TOPIC BUBBLE | COLOR KEY`. All blocks compressed to ~400px height each. Total ~800px + header ~200px = ~1000px.
   - (b) **2×3 grid**: row 1 = `BREAKING | ACTIVITY`, row 2 = `STAGE | TOPIC BUBBLE`, row 3 = `TOP STALLS | COLOR KEY`. Taller blocks, scrolls slightly on 1080.
   - (c) **Asymmetric**: left column 60% (STAGE + TOPIC BUBBLE stacked), right column 40% (BREAKING + ACTIVITY + TOP STALLS stacked). Fits more vertically dense content.
   - Recommend (a) once block heights confirm it. (c) is the backup if heights don't compress enough.
   - Density notes: Phase 1 also flags any block that simply won't compress (TOPIC DISTRIBUTION at 24 horizontal bars is the worst offender — that's why HO 132 swaps it for a bubble chart).

4. **Tooltips on nav items** (ask 7). Add `title=` attributes to every nav link with a one-line description.
   - Sample copy: `FEED` → `Browse all bills`, `NEWS` → `Bills in the press, last 24h`, `PATTERNS` → `Bill shapes — facility-naming, awareness designations`, `STALE` → `Bills idle 60+ days`, etc.
   - Recommend matching HO 123's tooltip vocabulary — short, descriptive, sentence case, no trailing period.
   - Phase 1 lists every nav item and proposes one-liner copy. Sign-off catches any awkward phrasings.

5. **Color key** (ask 8). One surface that explains every color in use: stages (6), parties (3), topics (24 → 8 color groups + catchall per `lib/topic-colors.ts`), accent (amber). Three placement options:
   - (a) Right-rail panel — always visible, ~250px wide, expands the home grid implicitly
   - (b) Footer expansion — collapsed by default, click to expand, single-row inline when open
   - (c) **Dedicated home block** — one of the quadrants in the grid, always visible, ~400px square
   - Recommend (c). Color is a real signal on the dashboard; treating it as first-class content (rather than tucking it into a footer) earns its place. Lives in the bottom-right quadrant per pick 3(a).

6. **Spacing fixes** (ask 4). Phase 1 catalogs visible spacing problems: empty space below STAGE DISTRIBUTION when its bars are short, cramped ACTIVITY column when it shows 17 rows, gap inconsistency between blocks. Each gets a specific fix in Phase 2.
   - Common pattern: replace ad-hoc margins with consistent `--space-*` tokens (or Tailwind `gap-N` classes). Phase 1 proposes the spacing scale (e.g. 4 / 8 / 16 / 24 / 32 px) and which token applies where.

7. **Snapshot of everything on the dashboard** (ask 1). The default no-scroll view IS the snapshot. Phase 1 confirms the picked layout (pick 3) shows everything in one viewport.
   - Possible add-on: a subtle "JUMP TO" / quick-link strip below the nav (one line, 6–8 anchors to specific blocks). HO 126 had a `JUMP TO` and either kept or dropped it; Phase 1 confirms which.
   - Recommend dropping `JUMP TO` if it survived HO 126 — with the no-scroll layout, jumping is moot.

### HALT

End Phase 1 with: block-height measurements, current spacing audit (specific problems found), proposals 1–7 with picks, and a sketch of the chosen no-scroll grid (ASCII or component-tree form). Wait for sign-off on every numbered proposal before Phase 2.

## Phase 2 — Implementation (after sign-off)

Shape depends entirely on Phase 1 picks. Sketch only.

### Header rebrand

`components/HeaderBar.tsx` (or new `components/HomeHeader.tsx` if the home header diverges from other pages' headers):

```tsx
<header className="home-header">
  <h1 className="terminal-prompt">
    Congress Terminal<span className="prompt-accent">:\&gt;</span>
  </h1>
  <p className="sync-meta">· LAST SYNC {syncTime} MT · {billCount.toLocaleString()} BILLS TRACKED</p>
  <nav className="home-nav">{/* nav links per pick 2 */}</nav>
</header>
```

CSS:
```css
.terminal-prompt {
  font-family: var(--font-mono);
  font-size: 26px;   /* per pick 1 */
  color: var(--text-primary);
  letter-spacing: 1px;
  margin: 0;
}
.prompt-accent { color: var(--accent-amber); margin-left: 4px; }
.sync-meta { font-size: 11px; color: var(--text-muted); margin: 4px 0 0; letter-spacing: 0.5px; }
.home-nav { display: flex; flex-wrap: wrap; gap: 16px; margin-top: 12px; padding-top: 12px; border-top: 1px solid var(--border-soft); }
.home-nav a { font-size: 12px; letter-spacing: 0.5px; text-transform: uppercase; color: var(--text-muted); }
.home-nav a:hover, .home-nav a[aria-current="page"] { color: var(--accent-amber); }
```

If the rebrand is home-only and other pages keep the existing `CBT // 119TH CONGRESS` chrome, branch on route. If the rebrand applies everywhere, `HeaderBar` itself is the change.

### No-scroll grid

`app/page.tsx` body wraps in a grid per pick 3:

```css
.home-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  grid-template-rows: minmax(0, 1fr) minmax(0, 1fr);
  gap: 16px;
  padding: 0 24px 16px;
  height: calc(100vh - var(--header-height));
  overflow: hidden;
}
.home-quadrant {
  background: var(--bg-panel);
  border: 1px solid var(--border-strong);
  padding: 12px;
  overflow: hidden;
}
```

Each block component gets a height constraint via the grid cell. Internal overflow within a block (e.g. ACTIVITY's 4-5 rows) is the block's responsibility, not the grid's.

### Tooltips

Per pick 4, add `title=` to every nav anchor. One-liner each.

### Color key

New `components/ColorKey.tsx`. Renders three sections in a compact vertical stack:

```
STAGES
▸ INTRO · ▸▸ COMMITTEE · ▸▸▸ FLOOR · ▸▸▸▸ OTHER · ▸▸▸▸▸ PRESIDENT · ✓ ENACTED

TOPICS
■ FIN · ■ TECH · ■ DEF · ■ ENV · ■ SOC · ■ JUSTICE · ■ INFRA · □ OTHER

PARTIES
● DEM · ● REP · ● IND
```

Each color swatch uses its CSS var. The block is read-only signal; no click behavior.

### Spacing audit fixes

Phase 1 catalogs specific issues; Phase 2 applies the fixes. Likely a globals.css cleanup pass replacing ad-hoc margins with the scale Phase 1 proposes.

### Verification

1. `/` renders with the new `Congress Terminal:\>` header, larger font, nav under title
2. All 12 nav items have working tooltips
3. Home page fits 1920×1080 without scroll
4. Color key block renders all stages, topic groups, and parties
5. ACTIVITY block height capped (overflow hidden; rows beyond first 4–5 not visible — HO 133 will redesign this properly)
6. STAGE DISTRIBUTION + TOP STALLS visible without scroll
7. Spacing consistent across blocks per Phase 1 token scale
8. Type-check clean, working tree ready, no console errors

## Acceptance

1. Phase 1 diagnostic posted with measurements, audit, all seven proposals
2. Sign-off received on every numbered proposal
3. Phase 2 per signed-off spec
4. Home page fits viewport without scroll on the target resolution
5. Title reads `Congress Terminal:\>`, nav under title, tooltips live, color key block present
6. SKILL.md updated: `### Pages` `/` entry rewritten; `### Frontend design system` gets the new header chrome notes; spacing tokens documented if they're new
7. Type-check clean, working tree clean, pushed
8. Commit: `feat(dashboard): redesign foundation — header, nav, no-scroll layout, color key (HO 131)`

## Don't

- Don't touch other pages' layouts. `/feed`, `/news`, `/members`, etc. keep their existing chrome.
- Don't redesign BillRow internals. HO 125/127/130 just settled them.
- Don't replace TOPIC DISTRIBUTION here — that's HO 132. Leave the current bar chart in place (or hide if it can't compress, with a placeholder block noting "Topic bubble chart — HO 132").
- Don't redesign ACTIVITY rows here — that's HO 133. Cap height in Phase 2; row-level interactions come later.
- Don't introduce a new color palette. Existing tokens cover every signal.
- Don't add scroll-into-view animation or any motion. v1 is static.
- Don't make the title clickable as a "home" link — the brand mark in nav already does that.
- Don't ship Phase 2 if Phase 1 measurements show the no-scroll goal isn't reachable on the target viewport without breaking content visibility. Flag in chat instead — we may need to accept a small scroll, hide one block behind a toggle, or compress further than v1 allows.

## Notes

- The `:\>` glyph is DOS prompt aesthetic. Renders cleanly in monospace; no special font required.
- "No scroll" is a goal, not a constitutional rule. If Phase 1 measurements say it costs too much (e.g. ACTIVITY hidden to 2 rows, TOP STALLS hidden entirely), flag and accept a small scroll. Better to ship a 1200px home that scrolls 200px than a 1000px home that hides half the content.
- HO 132 and HO 133 land after HO 131 settles. Don't pre-scope them here; the new IA will inform their picks.
- Corey's reference for the redesign aesthetic is unclear from the screenshot alone. The current site is the baseline; the asks describe deltas, not a new visual vocabulary. The terminal-prompt header is the only fresh element. Stay close to the existing palette and chrome.

read docs/handoffs/131-dashboard-redesign-foundation.md and follow
