# HO 134 — Dashboard IA Finalization (Header Tightening + Nav Collapse)

## Context

The Congress Terminal dashboard is settling. Two pieces close it out:

1. **Header chrome**: pull description inline with the prompt; promote COLOR KEY from a quadrant tab to a persistent strip beneath the nav.
2. **Nav consolidation**: 12 items → 5 by grouping related pages into tabbed shells. Main dashboard stays focused on the snapshot overview (BREAKING / TOP STALLS / STAGE DIST + ACTIVITY + TOPIC DISTRIBUTION); deeper pages are reached by clicking into a group and switching tabs.

### Target nav

- **FEED** (tabs: FEED / NEWS / CHANGES / PRESIDENT)
- **REPORTS**
- **MEMBERS** (tabs: MEMBERS / RACES / PRIMARIES)
- **PATTERNS** (tabs: PATTERNS / TRENDS / STALE)
- **WATCHLIST**

STAGE DIST stays in the BREAKING quadrant as a snapshot. No new pages, no route migrations — existing URLs (`/news`, `/races`, `/trends`, etc.) stay intact and the active tab is driven by the current path.

---

## Phase 1 — Diagnostic (HALT for sign-off before any edits)

Read the codebase and report findings in chat. Do not edit yet.

1. **Nav source**. Locate the nav component (likely `components/Header.tsx` or similar). List all 12 nav items, their hrefs, and how the active state is determined.

2. **Per absorbed page**, report:
   - Route path on disk
   - Whether it has its own `layout.tsx` at any level
   - Any shared chrome with siblings
   - Pages to inspect: `/news`, `/changes`, `/president`, `/races`, `/primaries`, `/trends`, `/stale`

3. **FEED group root**. Confirm whether FEED is `/` (the home dashboard) or a separate `/feed` route. If both exist, report which is canonical.

4. **BREAKING quadrant**. Locate the tab implementation (component path + line range). Confirm what the COLOR KEY tab renders, and that removing it leaves BREAKING / TOP STALLS / STAGE DIST clean. Note the default tab.

5. **COLOR KEY content source**. Locate where stage colors and symbols are defined (constants file, component, etc.). Confirm the persistent strip can pull from the same source without duplication.

6. **Header description**. Locate the "Congress currently tracks X non-ceremonial bills…" block. Report whether it's a single component, an inline render, or assembled from multiple pieces.

7. **Tab styling reference**. Report the styling pattern used by the BREAKING quadrant tabs (active treatment, hover, spacing, casing). This is the model the new GroupTabs component should follow.

8. **Proposal**. Confirm the URL strategy below works given findings — keep all existing routes, add a single `GroupTabs` component that each tabbed page imports and passes `group` + `active` props. No nested routes, no migrations. Flag any blocker.

End Phase 1 with findings + proposed fix sequence + explicit sign-off ask. HALT.

---

## Phase 2 — Header tightening (after sign-off)

1. **Inline the description**. Currently the `Congress Terminal:\>` prompt is on its own line and the "Congress currently tracks…" paragraph sits on the next line. Target: prompt and description flow on the same conceptual line, description starting immediately to the right of the prompt and wrapping as needed. The `· LAST SYNC … · BILLS TRACKED ·` line stays below.

2. **Persistent COLOR KEY strip**. Add a strip below the nav row, above the dashboard body. Content mirrors the current COLOR KEY tab — `COLOR KEY  STAGES → INTRO · COMMITTEE · FLOOR · OTHER CHAMBER ►►►► PRESIDENT ✓ ENACTED`. Use the same color and symbol source identified in Phase 1. Visual weight subordinate to the nav row.

3. **Remove COLOR KEY tab from BREAKING quadrant**. Tabs become BREAKING / TOP STALLS / STAGE DIST. Default tab remains BREAKING.

### Verify Phase 2

- Header reads clean at 1920×1080 and 2560×1440
- COLOR KEY strip doesn't compete visually with nav
- Removing the tab doesn't break the tab nav's default state
- No layout regression on the dashboard

Commit Phase 2 separately so it can be eyeballed before Phase 3 lands.

---

## Phase 3 — Nav collapse + tab shells (after Phase 2 verified)

1. **Reduce nav to 5 items**: FEED, REPORTS, MEMBERS, PATTERNS, WATCHLIST. Keep the icon vocabulary aligned with current nav for the surviving items.

2. **Build `GroupTabs` component** (`components/GroupTabs.tsx` or wherever existing tab components live):
   - Props: `group` ("feed" | "members" | "patterns"), `active` (string slug)
   - Renders a horizontal tab bar matching the BREAKING quadrant tab styling reported in Phase 1
   - Each tab is a `<Link>` to its sibling route
   - Active tab gets the accent / underline treatment

3. **Wire GroupTabs into each page**:
   - FEED root (`/` or `/feed`): `<GroupTabs group="feed" active="feed" />`
   - `/news`: `<GroupTabs group="feed" active="news" />`
   - `/changes`: `<GroupTabs group="feed" active="changes" />`
   - `/president`: `<GroupTabs group="feed" active="president" />`
   - `/members`: `<GroupTabs group="members" active="members" />`
   - `/races`: `<GroupTabs group="members" active="races" />`
   - `/primaries`: `<GroupTabs group="members" active="primaries" />`
   - `/patterns`: `<GroupTabs group="patterns" active="patterns" />`
   - `/trends`: `<GroupTabs group="patterns" active="trends" />`
   - `/stale`: `<GroupTabs group="patterns" active="stale" />`

4. **Top-level nav active state**. A top nav item is active if any of its group's URLs match the current path. Visiting `/races` activates MEMBERS in the top nav and RACES in the GroupTabs strip beneath.

---

## Phase 4 — Verification

- All 12 old URLs still resolve, content unchanged
- Top nav active state correct on every page
- GroupTabs active state correct on every page
- Hard refresh on any URL lands with the right tab active (state is path-driven, not client-only)
- No console errors anywhere
- No layout regression at 1920×1080 and 2560×1440

---

## Notes for Phase 1 reporting

Bring the findings back as a numbered list matching the questions above. Flag any case where the assumed structure doesn't match the actual code — that's the entire point of the diagnostic phase.
