# HO 230 — dashboard chrome batch (design items 2, 4, 7, 9, 10)

Confirm the next free number before saving: `ls docs/handoffs/ | sort | tail`. Body assumes 230.

## What this is

Five presentational changes from the approved dashboard design pass. **HO 229 already did the Phase-1 live verify for the whole group** — the file:line pointers below are from that grep, minutes old, same session. So this is a **straight build, no HALT.** Read the live file before each edit (standard practice), implement, commit each item separately. Trust the pointers over the `/mnt/project` copy, which is MVP-era stale.

Four commits for five items (9 and 10 share one — see below). All presentational, no data layer, no new tokens.

## Resolved premises (from HO 229 — don't re-derive)

- **Item 2:** sqrt is ALREADY built (`StageFunnel.tsx:88`, `Math.sqrt(b.count)/sqrtMax`). The *only* change is the anchor. Don't touch the scale.
- **Item 10:** the BILLS rename is ~90% done — route `/bills` (HO 184), breadcrumb (HO 185), and the SegmentedToggle labels already read BILLS/NEWS. The single live string still reading "Bills|News" is the **nav label at `HeaderBar.tsx:43`**, which folds into item 9's nav rework. So item 10 = one label, handled inside item 9.
- **Item 4:** HO 170 confined this popover; **HO 178 regressed it** when it replaced the drawer with the current hover popover. The popover spills today (`left:50%; translateX(-50%)` centered-below, `.home-races-pane{overflow:visible}`). This *restores* confinement and completes the spec — it's a re-do, not a new feature.
- **Item 7:** the cursor-trailing mechanism already exists. Members passes `cursor={false}` to the masthead and re-emits the `.home-cursor-caret` at the end of its sync string (HO 195). Reuse that exact pattern to trail the lead-in prose.
- **No new color tokens in this batch.** Everything uses existing `--accent-amber` (brackets), amber-bright (label/underline), `--border-strong` (dividers), `.home-cursor-caret`, and the 0.4 hover-dim from HO 131. (The only new token in the whole 10-item set is `--ticker-closed`, which is a different handoff.)

## Item 2 — Stage Distribution left-anchor

**File:** `app/globals.css:785` (`.stage-funnel-track`).
**Change:** `justify-content: center` → `flex-start`. That's the whole change — sqrt is already there.
**Verify:** bars anchor from a shared left zero; COMMITTEE (~14,568) is the longest; minor stages (ENACTED ~91, OTHER ~54) stay visible at min-width; pipeline order INTRO→COMMITTEE→FLOOR→OTHER→PRESIDENT→ENACTED unchanged; row click still sets `?stage=<id>` (HO 134).
**Commit:** `fix: stage distribution left-anchor (HO 230, design item 2)`

## Items 9 + 10 — Nav text-only path style (one commit)

**File:** `components/HeaderBar.tsx:41-49` (`NAV_ITEMS` + `HeaderNav`).
**Current:** icons (⌂ ▤ 👥 🗳 ⊞ ⎘ ★); active = amber-bright text + 2px underline; no prefix, no brackets, no dividers.
**Target:**
- **Drop all icons.** Each item renders text-only with a dim `\` path prefix (matches the masthead PowerShell convention): `\DASHBOARD` `\BILLS` `\MEMBERS` `\RACES` `\PATTERNS` `\REPORTS` `\WATCHLIST`. The `\` is dim (`--text-dim` or the existing path-prefix color); the label is normal weight.
- **(Item 10)** the `HeaderBar.tsx:43` "Bills|News" label becomes `\BILLS` under this scheme — that completes the rename, since route/breadcrumb/toggle are already BILLS.
- **Active item:** amber brackets `[ LABEL ]` (`--accent-amber`) + amber-bright label text + amber-bright 2px underline.
- **Reserve bracket space on every item** (transparent brackets at rest) so switching the active item causes **no horizontal shift**.
- **3-group dividers** (1px `--border-strong` vertical rule, ~16px tall):
  `\DASHBOARD | \BILLS \MEMBERS \RACES \PATTERNS | \REPORTS \WATCHLIST`
- The active underline sits clearly **inside** the nav band — not merged with the dividers or any section border above/below it.
**Verify:** no icons; every item shows the dim `\`; active item bracketed amber with amber-bright underline; switching active items causes NO horizontal jump (reserved bracket space proves out); three groups split by short vertical rules; the old "Bills|News" now reads `\BILLS`.
**Commit:** `feat: nav text-only path style, bracket-active, group dividers (HO 230, design items 9+10)`

## Item 7 — Masthead cursor trails lead-in prose + spacing

**Files:** `components/BreadcrumbMasthead.tsx` + `components/HomeHeader.tsx` + `app/globals.css` (`.home-cursor-caret`).
**Current:** the blinking amber caret is glued to the path-end `>` via the masthead's `cursor` prop.
**Target:**
- The blinking amber `_` trails the **END of the lead-in prose** (after the final word, e.g. "…21 transitions._"). Remove it from the title/path-end.
- **Mechanism (reuse HO 195):** pass `cursor={false}` to the masthead on the home page; re-emit `.home-cursor-caret` at the end of the lead-in prose string in `HomeHeader` — exactly what Members does at the end of its sync string.
- **Fallback below 700px / when the lead is hidden:** the caret falls back to trailing the title ("…\Dashboard>_"). One home for the caret when there's no prose to anchor to — so if the lead is hidden, the caret rides the title again; if shown, it rides the prose end. Never two carets at once.
- **Spacing:** increase the gap between the title block and the lead-in prose column. Align the lead's **first line to the title's CAP HEIGHT**, not baseline. Title stays fixed-left, prose wraps in the remaining width — HO 131 layout otherwise unchanged.
- Blink stays the sole approved motion exception.
**Verify:** the caret blinks at the end of the lead-in prose on desktop, not on the title; below 700px (lead hidden) it falls back to the title end; only one caret visible at any width; the title↔prose gap is visibly larger; the prose first line aligns to the title's cap height.
**Commit:** `feat: masthead cursor trails lead-in prose + title/prose spacing (HO 230, design item 7)`

## Item 4 — Confine the competitive-races popover

**Files:** `app/globals.css:2224` (`.competitive-race-popover` / `.home-races-pane`) + `components/CompetitiveRacesStrip.tsx`.
**Current (regressed by HO 178):** popover is `left:50%; translateX(-50%)` centered-below; `.home-races-pane{overflow:visible}` → it spills past the panel.
**Target (restore + complete the spec):**
- **Clamp the popover inside the COMPETITIVE RACES panel bounds.** It must never visually exit the panel's edges.
- **Anchor to the hovered card. Flip the popover LEFT when the hovered card is in the right column** of the 2×2 grid, so it never spills past the panel's right edge. Read the card layout to determine which column a card is in (2×2 → right column is the odd-index cards, or however the grid is keyed).
- z-index above sibling cards; the popover footprint stays within the panel box.
- **Sibling cards dim to 0.4 opacity on hover** (the breaking-news hover pattern, HO 131) — hovered card stays full, siblings drop to 0.4.
- **No drawer, no reserved space, no layout shift** — overlay only, no dead band, the panel box does not grow.
- The `.home-races-pane{overflow:visible}` will likely need to change so the popover is contained — Code's call on the cleanest containment (clip the pane, or position the popover within pane bounds), but the result is firm: the popover never exits the panel.
- Don't touch the popover's *content* — only its positioning, containment, and the sibling-dim.
**Verify:** hover a LEFT-column card → popover anchors and stays inside the panel; hover a RIGHT-column card → popover flips left and doesn't spill past the right edge; sibling cards dim to 0.4 on hover; no layout shift, no reserved band, panel box doesn't grow; popover renders above siblings.
**Commit:** `fix: confine competitive-races popover to panel, flip-left, sibling dim (HO 230, design item 4)`

## Verification (all items)

- These are all visual — eyeball each on the live dashboard. `tsc` clean.
- **Three of these are CSS-sensitive** (item 2 is a pure CSS line, item 9's styling, item 4's containment). If a CSS change doesn't render, it's the stale-compiled-CSS trap (HO 212): `rm -rf .next` + fresh dev, confirm the stylesheet asset 200s. `tsc` + 200 ≠ styled.
- Below-700px check for item 7 (caret fallback to title) and that the nav still wraps cleanly (HO 161 wrap-static convention — don't break it).

## Constraints

No new tokens. Touch only the four items' surfaces — don't regress the `?stage=` click (item 2), the existing popover content (item 4), or the HO 131 masthead layout beyond the specced spacing (item 7). Read the live files (the `/mnt/project` copy lags). **No SKILL or backlog edits in this handoff** — the SKILL sweep batches after the design-pass group (230 onward) lands; these items go straight from design doc to built, the handoff log is the record.

---

read docs/handoffs/230-dashboard-chrome-batch.md and follow
