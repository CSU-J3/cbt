# 149 — Markets tape

## What this is

Spec 2 (#6) from the design session: a thin full-width scrolling ticker strip on the dashboard, directly below the masthead and above the nav. Four symbols (SPX, TNX, WTI, DXY) scroll left in a seamless marquee with a pause/play toggle, an `AS OF` timestamp, and degraded stale / no-data states.

The data layer already shipped in HO 142 (`getLatestMarketTicks()` returning the four symbols). This is the component and its dashboard placement only. Whether the tape becomes global chrome (every page) or stays dashboard-only is the cleanup audit's call (HO 154 / spec 8, rubric check #3) — this handoff places it on the dashboard and builds it so propagation is a later one-liner.

## Motion exception, stated up front

The dashboard rule is "cursor blink is the only motion." This tape is the one deliberate exception, and it's gated: auto-pauses on `prefers-reduced-motion`, and a persisted pause toggle lets the user stop it. Spec 1 calls the cursor the "sole motion exception" while spec 2 adds the marquee — the reconciliation is that the tape's scroll is an opt-out-able second exception, not a free-for-all. No other motion enters the page.

## Pre-flight (inline, no halt)

Single-layer component handoff. Confirm three things and report in the commit; build in the same pass:

1. **`getLatestMarketTicks()` shape.** Confirm it returns the four symbols with, for each: a current value, a per-symbol timestamp (or one shared timestamp), and — critically — enough to compute direction. The up/down arrow + color needs either a stored change value or a prior tick to diff against. If the helper returns only the latest value with no prior/change, report that: the arrow degrades to neutral (no ▲/▼, value in `--text-secondary`) and we note it as a data-layer follow-up rather than faking direction.
2. **Direction color tokens.** Spec 2 specifies `#10b981` (up) / `#ef4444` (down). Check `app/globals.css` for existing usable green/red (a success/danger or positive/negative pair). If they exist, reuse them. If not, this handoff may add exactly two tokens — `--market-up` / `--market-down` with those hexes — since market direction is a genuinely new semantic the palette doesn't cover. This is the one allowed token addition; no inline hex in components.
3. **Masthead/nav structure.** Confirm where the dashboard masthead ends and the nav begins in `app/page.tsx` (and the nav component), so the tape slots cleanly between them as a full-width strip.

## Component: `components/MarketsTape.tsx`

A server parent fetches `getLatestMarketTicks()` and passes the data plus timestamps into a client marquee component (the marquee, pause toggle, localStorage, and reduced-motion handling are all client-side). Staleness is computed client-side against real `Date.now()` so it doesn't drift inside the page cache window.

### Container

- Full-width strip, `--bg-panel`, 1px `--border-strong`, ~32px tall.
- Symbols monospace 12px.
- Position: directly below the masthead, above the nav row.

### Live state — marquee

- Track rendered **twice**, animated `translateX: 0 → -50%`, ~22s linear infinite loop. The double-track is what makes the wrap seamless at only four symbols (no jump-cut when the last symbol exits).
- Left-moving.
- Each symbol: code in `--text-dim`, value in `--text-secondary`, then a direction arrow ▲/▼ in the up/down token color (per pre-flight).
- **Pause/play toggle** (⏸ / ▶): pinned right, next to the timestamp, rendered **outside** the scrolling track so it never scrolls off. Toggling pauses/resumes the marquee.
- **`AS OF HH:MM UTC`** timestamp: `--text-dim`, right-pinned, also outside the track.
- Auto-pause when `prefers-reduced-motion: reduce`; the pause/play button still works and overrides (user can force-play).
- Pause state persists across loads via `localStorage` (one boolean key, e.g. `cbt-tape-paused`).

### Stale state (last tick older than 26h)

26h means a daily cron tick was missed, or it's a weekend (markets closed, last tick is Friday's). Either way the data isn't fresh and the tape says so honestly:

- Scrolling stops.
- Pause/play button hidden (nothing to pause).
- Values render in `--text-dim`.
- Direction arrows dropped.
- Timestamp becomes `AS OF HH:MM UTC · STALE` in `--accent-amber`.

Weekend STALE is expected and correct — the dashboard never claims real-time, and the `AS OF` stamp shows the age. (If weekend STALE ever reads as broken, a trading-day-aware threshold is a small follow-up, not this handoff.)

### No-data state (fetch failed or empty)

- Strip holds full height (no layout collapse).
- Em-dash placeholders per symbol (`SPX —  TNX —  WTI —  DXY —`).
- `MARKET DATA UNAVAILABLE` right-aligned in `--text-dim`.
- No scroll, no pause button.

## Out of scope

- Global propagation to other pages. HO 154 cleanup audit decides tape-everywhere vs dashboard-only.
- Mobile touch behavior (swipe, tap-to-pause). Deferred to the #15 mobile pass per every design spec.
- Adding or changing market symbols. The four from HO 142 are the set.
- Real-time / intraday refresh. Vercel Hobby caps cron at daily; the tape shows the latest daily tick with an honest `AS OF` stamp. Out of scope to change the refresh cadence.
- Click-through on symbols (linking SPX to an energy-bill view, etc.). Interesting idea, separate handoff if it ever earns its place.
- Any data-layer change. If the pre-flight finds direction data missing, that's a noted follow-up, not in-scope work here.

## Acceptance

1. Tape renders on the dashboard as a full-width strip between masthead and nav, ~32px, `--bg-panel` + `--border-strong`.
2. Live state scrolls seamlessly (double-track, no jump at the wrap) with the four symbols, values, and direction arrows.
3. Pause/play toggle sits outside the track, pauses/resumes, and persists across reloads via localStorage.
4. `prefers-reduced-motion` auto-pauses; the button overrides.
5. Stale state (simulate a >26h timestamp) stops the scroll, dims values, drops arrows, hides the pause button, and shows `· STALE` in amber.
6. No-data state (simulate empty/failed fetch) holds height with em-dash placeholders and `MARKET DATA UNAVAILABLE`, no scroll.
7. Direction colors come from existing tokens or the two new `--market-up`/`--market-down` vars — no inline hex.
8. `npm run typecheck` and `npm run build` clean.
9. `SKILL.md` updated: the tape component, its dashboard placement, the motion-exception note, and the 26h stale threshold.
10. Single commit: `feat: markets tape (HO 149)`.

## Notes

- **Why client-side staleness.** Computing "is this older than 26h" on the server bakes the answer into the page cache, so a tape rendered fresh at cron time would still read "live" hours later when the cache hasn't rebuilt. Computing it client-side against `Date.now()` from the passed-in tick timestamp keeps the stale flag honest regardless of cache age.
- **Why the double-track marquee.** Four symbols don't fill the viewport width, so a single track leaves a gap and the wrap visibly jumps. Rendering the track twice and translating to -50% means the second copy is entering as the first exits — continuous loop. Standard CSS-marquee trick, no JS animation loop needed.
- **The 26h threshold is deliberately simple.** A trading-calendar-aware "stale" (suppress on weekends/holidays) is more correct but more code. For a daily-cron dashboard with an honest `AS OF` stamp, 26h catching a missed tick is enough. Revisit only if the weekend STALE reads wrong in practice.
- **Direction data is the one real risk.** If HO 142 stored only latest values with no change/prior, arrows can't be computed. The pre-flight surfaces this; the graceful degrade (neutral, no arrow) ships either way, and adding a prior-close column is a clean follow-up if direction matters.
