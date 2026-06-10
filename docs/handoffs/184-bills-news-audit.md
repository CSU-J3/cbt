# HO 184 — Bills|News surface audit + /feed → /bills rename

## Why

The Bills|News surface (currently at `/feed`) has accumulated naming and structure inconsistencies. From an eyeball audit:

1. **Naming mismatch:** the route is `/feed`, the nav label is "BILLS|NEWS", the page H1 is "Feed:\>". Three names for one surface. Rename the route to match its identity.
2. **Possible double-nav:** the page shows a `BILLS | NEWS` mode toggle AND a sub-nav row (`BILLS · NEWS · REPORTS · CHANGES · PRESIDENT`). Audit whether these are redundant or distinct.
3. **General cleanup:** surface anything else off on this page set.

This is **audit-first** — Phase 1 maps the surface and the rename blast radius; Phase 2 only fixes what's signed off. The rename especially has wide reach (a live route with a deployed URL + bookmarks), so map before moving.

## Phase 1 — Audit (HALT after — this is diagnostic, report findings + a proposed fix list, don't change anything)

### A. The /feed → /bills rename — map the full blast radius
1. Confirm the current route file(s): `app/feed/page.tsx` (+ any `/feed/*` children?). Report the directory structure.
2. **Every reference to `/feed`** — grep the codebase. Report all: the nav `href` (HeaderBar `NAV_ITEMS`), `pathToNavKey` mapping, the GroupTabs `feed` group hrefs (the sub-nav `BILLS·NEWS·REPORTS·CHANGES·PRESIDENT` — note these may point at `/feed`, `/news`, `/reports`, `/changes`, `/president`), any `<Link href="/feed">`, `router.push("/feed")`, redirects, the `?mode=` or `?topics=` query usage, breadcrumbs, the dashboard's "VIEW IN /FEED" link (seen in a screenshot), etc.
3. **The mode model.** The page has a BILLS|NEWS toggle. Report: is it one `/feed` route with a `?mode=bills|news` (or a tab state), or are `/feed` and `/news` separate routes? (A screenshot shows both a `/news` in the sub-nav AND a NEWS toggle — clarify the actual routing.) This determines what "rename to /bills" even means — if News shares the route, `/bills` is odd; if they're separate, cleaner.
4. **Rename target + redirect.** Propose the new route name. Options: `/bills` (if News is a separate route), or keep one route but rename `/feed` → something that fits "Bills|News" (e.g. `/bills` with the news toggle, or `/feed` stays if the mismatch is only cosmetic in the heading). **Critically:** a live route rename needs a redirect from `/feed` (Next.js `redirects()` in `next.config` or a route handler) so the deployed URL + bookmarks don't 404. Report the redirect approach.
5. **The H1 heading** "Feed:\>" — propose what it should read to match (e.g. "Bills:\>" / "Bills|News:\>").

### B. The double-nav question
6. Map both navigation elements on this surface:
   - The **BILLS|NEWS toggle** (the segmented control switching the feed's content mode).
   - The **sub-nav GroupTabs row** (`BILLS · NEWS · REPORTS · CHANGES · PRESIDENT` — the `feed` group from HO/GroupTabs).
   Report what each does and whether they overlap. Specifically: does the toggle's BILLS/NEWS duplicate the sub-nav's BILLS/NEWS tabs? If a user can switch bills↔news two different ways, that's redundant. Report whether to (a) keep both (if they're genuinely different — e.g. toggle = in-page mode, sub-nav = sibling pages), (b) drop the toggle, or (c) drop the sub-nav BILLS/NEWS entries. **Recommend**, don't decide — Corey signs off.

### C. General cleanup
7. Note anything else off on the `/feed` (+ `/news`, `/reports`, `/changes`, `/president`) surface: dead UI, inconsistent labels, the empty-state copy ("NO BILLS MATCH THESE FILTERS" looked fine), the President-stage filter (a screenshot showed "0 of 15,584 bills" — expected empty state, confirm it's intentional), anything stale.

**HALT. Report: the full /feed reference map + rename target + redirect plan, the routing/mode model, the double-nav recommendation, and any cleanup findings. Wait for sign-off — I'll decide the rename target and the double-nav resolution before any Phase 2.**

## Phase 2 — Implementation (only after sign-off, scoped to what's approved)

Based on Phase 1 decisions:
- Rename the route (+ redirect from `/feed`), update every reference (nav href, pathToNavKey, GroupTabs, internal links, the dashboard VIEW IN link), update the H1.
- Resolve the double-nav per the signed-off choice.
- Any approved cleanup.

Likely split into sub-stages (rename first as one commit, double-nav as another) given the rename's reach.

## Verification
- The new route loads; `/feed` redirects to it (no 404); every internal link points to the new route; the correct nav item highlights (pathToNavKey).
- BILLS|NEWS toggle + sub-nav behave per the signed-off resolution.
- `?topics=` / `?mode=` query params still work on the renamed route (the dashboard's click-to-filter VIEW IN link, bubble filtering).
- Type check passes.
- Run on a branch; dev server up for Corey to eyeball.

## Out of scope
- No redesign of the bill feed rows / news rows themselves (just naming, routing, nav structure).
- No change to the data/queries behind the feed.
- The cycling-timestamp work (HO 183) is separate/shipped.

## Note
- SKILL.md will need a follow-up touch after this (the route name, the IA) — flag for the next doc sweep, don't necessarily fold in unless small.
