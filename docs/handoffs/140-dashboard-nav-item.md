# 140 — DASHBOARD nav item

## What this is

Adds an explicit `DASHBOARD` entry to the nav strip routing to `/`. Closes the asymmetry where 11 sub-views have explicit nav tabs but the home dashboard itself is reachable only by clicking the title block.

Small, single-component edit. No Phase 1 halt — single layer, no design-project overlap.

This pushes the report-perf followup (originally tagged HO 140 in 139's notes) to HO 141.

## Prior art

- **HO 131** — dashboard redesign foundation, where `NAV_ITEMS` was introduced
- **HO 133** — layout pivot v2, last time the nav strip was touched
- **HO 123** — tooltip vocabulary

## In scope

- Add `DASHBOARD` to the nav items array in `components/HomeHeader.tsx` (or wherever `NAV_ITEMS` lives — Code confirms)
- Slot leftmost, before `FEED`
- Active state when `pathname === '/'`
- Tooltip per HO 123 vocabulary: `"Dashboard summary"` (sentence case, no trailing period)
- Icon — pick from the existing nav icon vocabulary; recommend `⌂` (home glyph) if it doesn't clash with an existing tab. Code picks and confirms in the commit message
- SKILL.md update: nav strip section gets a brief mention of the home-routing tab

## Out of scope

- Removing the title block's existing click-to-home behavior. The new tab is additive — title block stays clickable for users who already know the affordance
- Reordering existing nav items
- Changing nav strip layout, gap, font, or chrome
- Adding a "Back" or breadcrumb pattern. This is one tab, not a navigation paradigm shift
- Mobile-specific nav changes — desktop nav strip applies, mobile follows when desktop settles
- Any change to the home dashboard layout, quadrants, or surfaces. That stays parked behind the design project's bubble interaction work

## Implementation sketch

`components/HomeHeader.tsx` (or wherever `NAV_ITEMS` is defined):

```ts
const NAV_ITEMS = [
  { label: 'DASHBOARD', href: '/', icon: '⌂', tooltip: 'Dashboard summary' },
  { label: 'FEED',      href: '/feed', icon: '...', tooltip: '...' },
  // ...existing entries unchanged
];
```

Active state — wherever the existing nav items compute active highlight from `usePathname()`, the new entry follows the same pattern. Exact match on `/` (not `startsWith`) so sub-routes don't keep the DASHBOARD tab highlighted.

## Verification

1. `/` renders the nav strip with `DASHBOARD` leftmost, highlighted as active
2. `/feed` renders the nav strip with `FEED` highlighted, `DASHBOARD` inactive
3. Click `DASHBOARD` from any sub-view → routes to `/` and the tab becomes active
4. Hover `DASHBOARD` → tooltip reads `"Dashboard summary"`
5. Title block still clicks back to home (existing behavior preserved)
6. Mobile breakpoint — `DASHBOARD` appears in whatever wrap pattern the existing nav strip already uses, no overflow
7. Type-check clean, no console errors

## Acceptance

1. All 7 verification items pass
2. SKILL.md updated where the nav strip is documented
3. Type-check clean, working tree clean, pushed
4. Commit: `feat(nav): explicit DASHBOARD home tab (HO 140)`

## Don't

- Don't reorder existing tabs to make room. `DASHBOARD` goes leftmost and the rest shift right by one slot
- Don't change the title block click behavior. Additive only
- Don't introduce a `HOME` label — `DASHBOARD` matches the `Congress Terminal:\>` framing better than the generic `HOME`
- Don't pick an icon that already appears in another nav item

read docs/handoffs/140-dashboard-nav-item.md and follow
