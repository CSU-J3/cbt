# 310 — v2 battlefield: cluster popover overshoots the top nav

Confirm the next free number before saving (`ls docs/handoffs/ | sort -V | tail`). Body assumes 310; rename if taken.

## The bug

On `/dashboard-v2`, RACES tab → COMPETITIVE. Hovering the toss-up cluster tick on the lean axis (the `17 RACES / TOSS UP` marker) opens the `TOSS UP · 17 SEATS` popover listing all 17 toss-up seats. The popover is tall, opens upward, and the lean axis sits near the top of the page (just under the nav and the two tab rows), so it overshoots and paints **over** the top nav, covering DASHBOARD…REPORTS. The lean-band count ticks (LEAN D / LEAN R, each also a count + seat-list popover from HO 254) use the same mechanism and will do the same on a tall cluster.

## Resolved premise — HO 254, don't re-derive

HO 254 built the battlefield with "field bands below the line ... with a count and a hover popover listing that band's seats" and "instant hover/highlight states (band popovers)". The popovers were in scope from the start; their height and screen-confinement never were. A small cluster fit above the trigger by luck. The 17-seat toss-up cluster (and the 17-seat LEAN R band) don't, and opening upward from a near-top trigger crosses the nav. Seat counts only grow as ratings drift, so this isn't a one-week fluke.

This is the same hover-box discipline already documented for the B2 tape and applied in HO 308: portal, confine to the viewport, cap the height with internal scroll, anchor near the trigger and grow toward the available space. This popover predates that work and doesn't follow it.

## Confirm live first

Grep before touching; the `/mnt/project` copy and these docs lag the repo.

1. Where the band/cluster popover renders — the battlefield axis component from HO 254 (inside `CompetitiveRacesBlock` / the v2 races box). Read how it's positioned: portaled to body with a fixed offset, or absolutely positioned inside the axis with `bottom:100%` plus a z-index. Either way it's escaping upward; confirm which so the fix targets the right place.
2. Whether a shared confined-hover helper exists from the B2 tape work (the portaled, viewport-confined, pointer-safe hover box, HOs 292–294 / 303). Note its open direction: the B2 box grows **upward** (`translateY(-100%)`) because the tape sits near the bottom of its container. This axis sits near the top, so the fix must reuse the helper's portal + confinement + pointer-safety, **not** its upward growth.
3. The current open direction and z handling, and whether the pointer can cross from the tick into the popover without dismissing it (it must, to read or scroll a long list).

## Fix

Apply the hover-box convention to this popover. Two parts.

1. **Cap the height.** Give the popover a viewport-relative max-height with `overflow-y:auto`, so cluster size can't make it unbounded. 17 seats today, more as ratings drift; a long list scrolls inside the box.
2. **Confine it to the viewport, opening downward here.** The popover must never cross above the top nav or off the top edge; the nav is a hard ceiling. The lean axis sits high (under the nav and the HEARINGS/RACES and COMPETITIVE/PRIMARIES rows), so the upward default is wrong for this surface. Open the popover **downward** from the trigger instead. The room below the axis is the card row, and a transient hover overlay sitting on top of the cards is fine (it dismisses on mouse-out and the cards aren't doing anything it blocks). With the height cap, a downward popover stays inside the viewport. If you route through the shared B2 helper, take its portal, confinement, and pointer-safety, but set the open direction downward (or auto-flip toward the side with room); do not inherit the upward growth, since that growth from a high trigger is exactly what causes this bug.

Keep the pointer-cross-without-dismiss behavior so a 17-row list is actually readable.

## Scope guard

- `/dashboard-v2` RACES battlefield only. Don't touch the consensus-lean computation, the marker collision dodge, the individual labeled toss-up markers (GA-SEN, FL-23, and the rest are fine), the rich race cards, the tapes, or `/`.
- The LEAN D / LEAN R band ticks use the same popover mechanism — one fix covers all the count popovers on the axis, not just the toss-up cluster.

## Constraints

- Mono house style, existing tokens, no new vars. Static, instant show/hide, no transitions.
- Stale `.next` rule on this UI ship: verify `layout.css` loads (no 404); `rm -rf .next` + restart if the dev server's been up a while.
- Named `git add` per commit, eyeball the diff. `npm run build` clean.
- Ship per the live-verify rule: `git push`, then `npm run verify:deploy` until the served SHA matches HEAD.

## Ship report

Confirm on `/dashboard-v2` RACES → COMPETITIVE: hovering the toss-up cluster (and the LEAN D / LEAN R band ticks) opens a popover that stays inside the viewport, never paints over the top nav, and scrolls internally when the list is long; the pointer can cross into it without dismissing; the individual labeled markers and the cards are unchanged; build clean; `verify:deploy` SHA matches HEAD; `/` untouched. State whether you routed through the shared B2 hover helper or fixed the popover's own positioning, and the open direction plus max-height you landed on.
