# HO 258 — Dashboard v2: restore the marquee scroll (SIGNALS + MARKETS)

Confirm the next free number before saving: `ls docs/handoffs/ | sort | tail`. Body assumes 258. Builds on HO 253 (the v2 shell + two-tape).

## What this is

The v2 tape strips are static. They should scroll: the mock calls them marquees and Design's two-tape spec is "each its own marquee." v2 inherited the static tape because HO 251 removed the crawl and HO 253 reused that component. Restore the scroll for v2's two strips, each as its own marquee.

## Check why 251 removed it FIRST (this is the "again")

HO 251 removed the crawl deliberately, so don't just re-add an animation. Read `docs/handoffs/251-*.md` and `docs/oddities.md` first and find out WHY it was pulled: janky, broke on content-width changes, a perf cost, a seam/loop glitch, or a non-bug reason. The "again" in the report means this has cycled before, so restore the scroll in a way that addresses whatever 251 hit. If it was removed because it misbehaved, fixing that misbehavior is the actual job here, not just turning the animation back on.

## Restore

- Check the mock (`docs/design/dashboard-2col.html`) for a tape scroll animation. If it has one, match it; if the mock render is static, implement a standard robust marquee.
- Both strips scroll independently (MARKETS and SIGNALS each its own marquee), per Design's two-tape spec.
- Make it robust: transform-based animation (not layout-thrashing), a seamless loop (duplicate the content for the wrap if needed so there's no gap or jump), and pause-on-hover. Whatever 251 hit, don't reintroduce it.
- Keep the HO 234 closed-state / STALE / LIVE precedence and the right-pins intact while scrolling: MARKETS shows `AS OF h:mm · CLOSED` (ticker-closed red on CLOSED), SIGNALS shows the green LIVE dot and never CLOSED.

## v2-specific

If the tape component is shared with `/` (`app/page.tsx`), scope the scroll to v2 or parametrize it; don't regress `/`.

## Constraints

- Match the mock where it has the animation; this doc owns the "investigate 251 + make it robust" requirement.
- No new tokens. Desktop.
- Named `git add` per commit, eyeball the diff. Stale `.next` rule: verify `layout.css` loads (no 404); `rm -rf .next` + restart if the dev server's been up a while. `npm run build` clean.
- Ship per the live-verify rule: `git push`, then `npm run verify:deploy` until the served SHA matches HEAD.

## Ship report

Lead with WHY 251 removed the crawl (what you found in the handoff / oddities) and how this restore avoids reintroducing it. Confirm both strips scroll independently, the seam loops cleanly with no jump, the CLOSED / LIVE / STALE states and right-pins still render correctly while scrolling, and `/` is unchanged. Build clean; verify:deploy SHA matches.
