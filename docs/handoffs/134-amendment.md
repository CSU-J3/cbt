# HO 134 — Amendment (post-Phase-2 review)

Sign-off arrived after Phase 2 work landed. Two adjustments before Phase 3.

## Phase 2 — addendum

The ColorKeyStrip currently renders STAGES only. Expand it to the full content of `ColorKey.tsx`:

- STAGES (already present)
- TOPICS
- PARTIES
- BILL TYPES
- ACCENT

Sections render as a single horizontal strip below the nav row on `/` (HomeHeader only — not HeaderBar). Section labels (`STAGES →`, `TOPICS →`, etc.) prefix each cluster. Pull from the same Swatch constants already in `ColorKey.tsx` — export them or extract to `lib/color-key.ts` as Phase 1 proposed, so the strip and the existing tab-removed component share one source.

Visual weight: still subordinate to the nav. The strip may wrap to two lines at 1920×1080 — that's fine if it stays readable. If it crowds out the dashboard body, the strip can compress to single line at 1920+ and let smaller viewports wrap.

Verify the strip reads cleanly at 1920×1080 and 2560×1440 before moving on.

## Phase 3 — revised nav mapping

Top-level nav collapses 12 → **4** items (not 5 — REPORTS folds into FEED):

```
FEED       (tabs: bills, news, reports, changes, president)
MEMBERS    (tabs: members, races, primaries)
PATTERNS   (tabs: patterns, trends, stale)
WATCHLIST  (standalone, no tab strip)
```

GroupTabs wiring matrix:

| Route        | Group       | Active slug |
|--------------|-------------|-------------|
| `/feed`      | feed        | bills       |
| `/news`      | feed        | news        |
| `/reports`   | feed        | reports     |
| `/changes`   | feed        | changes     |
| `/president` | feed        | president   |
| `/members`   | members     | members     |
| `/races`     | members     | races       |
| `/primaries` | members     | primaries   |
| `/patterns`  | patterns    | patterns    |
| `/trends`    | patterns    | trends      |
| `/stale`     | patterns    | stale       |
| `/watchlist` | (none)      | —           |
| `/`          | (none)      | —           |

Note: the FEED group's `bills` tab points to `/feed` (the existing bill list). The "bills" label is just for the tab — the URL stays `/feed`.

Top-nav active state mapping:

- `/feed`, `/news`, `/reports`, `/changes`, `/president` → activate **FEED**
- `/members`, `/races`, `/primaries` → activate **MEMBERS**
- `/patterns`, `/trends`, `/stale` → activate **PATTERNS**
- `/watchlist` → activate **WATCHLIST**
- `/` → no nav item active (matches today's behavior)

## Phase 3 implementation

1. Trim `NAV_ITEMS` in `HeaderBar.tsx` to 4 entries (FEED, MEMBERS, PATTERNS, WATCHLIST). Use the icon vocabulary from the existing items — FEED keeps ▤, MEMBERS keeps 👥, PATTERNS keeps ⊞, WATCHLIST keeps ★.

2. Build `components/GroupTabs.tsx` following the `SearchTabs.tsx` pattern (routable `<a>` tabs with `aria-current="page"` on the active one). Props: `group: "feed" | "members" | "patterns"`, `active: string` (slug).

3. Wire `<GroupTabs />` into the 11 group-member pages per the matrix above. Place the tab strip directly below the HeaderBar, above each page's main content.

4. Add the path → group derivation logic in `HeaderBar.tsx` so the 4-item top nav highlights the right group. Same logic into `HomeHeader.tsx` if it needs to know (probably not — `/` is no-group).

## Phase 4 — verification

- All 12 original URLs still resolve, content unchanged
- Top nav highlights the right group on every page
- GroupTabs highlights the right tab on every page
- Hard refresh on any URL lands with the right tab active (state path-driven)
- ColorKeyStrip on `/` shows all 5 sections, reads cleanly at both viewports
- No console errors

## What's NOT in this handoff

Mini-dashboards for `/feed`, `/members`, `/patterns` are deferred to HO 135, 136, 137 — one per group. Until those land, the group landings render their current content (bill list, sponsor list, patterns hub) under the new tab strip. The tab nav working over existing pages unblocks the dashboard work.
