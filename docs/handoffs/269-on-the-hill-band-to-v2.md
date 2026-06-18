# 269 — Move the On the Hill band to /dashboard-v2 (266 correction)

> Correction to HO 266. The On the Hill band shipped on `/` (`app/page.tsx`). It belongs on `/dashboard-v2` — the dashboard being built toward the `/` swap. A feature on `/` gets wiped at the v2 cutover. This moves it to v2 and removes it from `/`. The prior 266 placement is wrong; this supersedes it.

## Why this is a move, not a new build

HO 266 placed `OnTheHillBand` on `/`. The 266 gate framed the dashboard-v2 work as a collision risk, which pointed the build at the stable `/` slot — the wrong target. v2 is the future dashboard; new dashboard features go there so they survive the swap. The component (`components/OnTheHillBand.tsx`) is correct and reusable as-is — this is a placement + nav-parity correction, not a rebuild.

## Pre-flight (confirm live before moving)

1. **v2 route, file, and slot.** Confirm where `/dashboard-v2` lives (`app/dashboard-v2/page.tsx` or wherever) and its layout structure — the v2 arc (253–260) built a different shell (stacked header, dual tape, battlefield, signals strip, V2 movers feed). Identify the reading-order slot equivalent to the band's `/` position: legislative-activity context, after the electoral/markets surfaces, leading or within the body. **If v2's structure has no clean equivalent slot, HALT and flag for a placement call — don't guess.**
2. **v2 header/nav.** Does `/dashboard-v2` use the same `HeaderBar` / `GroupTabs` nav as `/` (so 264's HEARINGS entry is already present), or its own stacked header (so HEARINGS is missing from v2)? Report which.

## The change

1. Render `OnTheHillBand` in the v2 page at the confirmed slot, matching v2's layout idiom. The component is self-contained; it should drop in like it did on `/`.
2. Remove `OnTheHillBand` from `app/page.tsx` (the `/` dashboard). *Default is remove, since `/` is being replaced and dual-maintenance is waste. If Corey says keep it on `/` until the v2 swap, leave it; otherwise remove.*
3. If pre-flight #2 found v2 has its own header without the HEARINGS entry, add HEARINGS to v2's nav — same consolidated rubric, middle group between BILLS and MEMBERS, matching 264. If v2 shares the HeaderBar, nothing to do here.

## Constraints

- Existing tokens, no new tokens. The band's treatments are unchanged from 266.
- Match v2's layout idiom for the slot; v2's structure differs from `/`.
- Static. The `hill-day-<key>` deep-link anchors already live on the `/hearings` list from 266, so the band's day links keep working unchanged.

## Acceptance

1. Pre-flight posted: v2 route/file/slot confirmed, and which header v2 uses. Any no-clean-slot finding flagged before moving.
2. `OnTheHillBand` renders on `/dashboard-v2` in the equivalent slot, coherent with v2's layout.
3. The band is gone from `/` (or kept, if Corey chose that).
4. HEARINGS nav entry present on `/dashboard-v2` — already via a shared HeaderBar, or added to v2's own header.
5. Existing tokens, no new tokens; band treatments unchanged.
6. Ship per HO 252: push, then `npm run verify:deploy` until the deployed SHA matches HEAD.
7. Single commit: `fix: move on-the-hill band to dashboard-v2 (HO 269)`.
