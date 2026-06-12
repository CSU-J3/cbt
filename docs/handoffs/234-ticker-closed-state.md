# HO 234 — ticker single-line collapse + closed-state (design item 1)

Confirm the next free number before saving: `ls docs/handoffs/ | sort | tail`. Body assumes 234.

## What this is

The last dashboard design-pass item. Two halves: collapse the dashboard's market tape to **one scrolling line**, and add a **closed-state** — the whole strip washes to a new muted red (`--ticker-closed`, ~#9b3d3d) when US markets are closed. Per HO 229's verdict, no market-hours open/closed concept exists anywhere in the codebase, so the signal is net-new logic. This is the only new color token in the entire 10-item set.

Repo-229 carries no design appendix (confirmed in HO 233), so this spec governs. Two commits. Read each live file before editing.

## Resolved premises (don't re-derive)

- **The closed-state must not collide with STALE.** They mean different things: STALE = the data pipeline failed or lagged (a problem); CLOSED = markets aren't trading (normal, expected). Read the live stale treatment in the tape before styling, and keep the two visually and logically distinct. **Precedence: STALE wins** — if the cron is broken at 11am on a Tuesday, the strip shows the stale state, not a healthy closed wash.
- **The symbol set is post-227/228:** indices via FMP `/stable/quote` plus FRED series, all ticking. Read the live `MARKET_SYMBOLS` for the actual set — don't assume the HO 168-era 17.
- **Dual-tape history:** HO 168 split the dashboard into two counter-scrolling tapes (equities one way, commodities/macro the other) with the z-31/z-30 `markets-tape-block` stacking and a `showMeta` split; other pages kept one combined tape in `HeaderBar`. The symbol set has shrunk since. **Gate before commit 1:** read the live dashboard mount — if the collapse already happened in the 227/228 re-source, commit 1 is a no-op; say so and move to commit 2.

## Commit 1 — collapse the dashboard tape to one line

**End state:** the dashboard renders ONE tape line, identical in component and behavior to the tape every other page gets — the full combined symbol set, single `AS OF` meta, the HO 179 copies-fill density logic doing its job. This also closes the design audit's rubric question (tape as uniform global chrome) in the direction it leaned.

**Retire where dashboard-only:** the dual-mount, the counter-scroll `reverse` usage, the `markets-tape-block` z-31/z-30 wrapper, the `showMeta` split. Leave the `group` field in the data layer alone — retiring rendering, not schema. Hover popovers must still paint above the nav after the z-simplification; verify, don't assume.

**Verify:** one line on the dashboard, marquee fills the viewport width, single AS OF stamp, popover stacking intact, every other page's tape byte-identical to before.

**Commit:** `refactor: collapse dashboard tape to single line (HO 234, design item 1)`

## Commit 2 — closed-state token + market-hours signal

**Token:** `--ticker-closed: #9b3d3d` (or within a hair of it) in `globals.css` alongside the other tape tokens. The only new token in this arc.

**Signal — net-new, client-side:** the tape is already a client marquee, so compute open/closed in the client from the current time, no cron or server involvement, flipping live at the boundaries:

- Open = NYSE regular session: **9:30–16:00 ET, Mon–Fri**, excluding NYSE holidays.
- ET math via `Intl.DateTimeFormat` with `America/New_York` — no timezone library.
- Holidays: a hardcoded const of the official **2026 NYSE holiday dates** (New Year's, MLK, Washington's Birthday, Good Friday, Memorial Day, Juneteenth, Independence Day, Labor Day, Thanksgiving, Christmas — pull the exact observed dates, ~10 entries). Early-close half-days are out of scope for v1; note that in the code comment.
- Re-evaluate on an interval (a minute-level tick is plenty) so the strip flips at open/close without a reload.

**Applied state — the whole strip, per the design:** when closed, the tape's prices, changes, and arrows wash to `--ticker-closed`, and the AS OF meta appends `· CLOSED`. Symbols/labels can stay their normal muted treatment if washing literally everything reads as broken — use judgment at the pixel, the intent is "visibly dormant, obviously not an error." Last-session values keep displaying; only the color state changes. When STALE is active, the stale treatment renders instead, full stop.

**Scope of the wash:** the signal lives in the tape component, so it applies wherever the tape mounts — that's correct, the strip is global chrome and a closed market is closed on every page.

**Verify:**
- Token present; closed wash eyeballed by stubbing the hours function (then reverting the stub) — check a weekday-open time, a weekday-closed time, a weekend, and one holiday date.
- Boundary sanity: 9:29 ET reads closed, 9:31 ET reads open.
- STALE precedence eyeballed via the same stub-and-revert method used for the ENACTED banner's populated state.
- The live state at eyeball time matches the actual clock (it's a real-time signal — the honest check is that it agrees with reality when you look).
- `npm run build` clean.

**Commit:** `feat: ticker closed-state with market-hours signal (HO 234, design item 1)`

## Constraints

- One new token, nothing else added to the palette. No data-layer, cron, or symbol-set changes. No timezone library.
- Don't restyle the tape beyond the closed wash and the collapse; the HO 176/177/179 spacing, hover, and density work stays as-is.
- Named `git add` per commit, eyeball before each. Stale `.next` rule applies as always.
