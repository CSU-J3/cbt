# HO 172 — Markets tape: smooth scroll + hover-pause + intraday-updating numbers

## Why

Three issues with the HO 168 tape:
1. **Scroll hitch** — the marquee jumps at the loop seam instead of crawling continuously. The double-track `-50%` wrap should be seamless; it isn't.
2. **Pause** — replace the click pause toggle with **hover-to-pause** (tape stops while the cursor is over it, resumes on leave).
3. **Live numbers** — the tape shows a once-daily snapshot. Make the numbers actually move during market hours via a more-frequent fetch + client polling.

The live-numbers piece is the real scope and has hard constraints (write budget, market hours, change-pct semantics) — Phase 1 must resolve them before anything ships. The scroll + hover fixes are small and can ship independently if the live-numbers work needs more iteration.

## Constraints (non-negotiable — these shape Phase 2)

- **Data reality:** Stooq is ~15-min delayed; FRED (VIX `VIXCLS`, TNX `DGS10`) is **end-of-day only**. So "live" means intraday-delayed for the 6 Stooq symbols (SPX, WTI, ITA, XLK, XLV, GOLD) and **unchanged** for the 2 FRED symbols (TNX, VIX) — they update once a day regardless. Don't poll FRED intraday; it won't change.
- **Cron cadence:** Vercel Hobby caps cron at once/day — that's why markets runs on **GitHub Actions**. GitHub Actions *can* run every 15–30 min, so the frequent fetch lives there, not Vercel.
- **Market hours only:** fetch every ~15–30 min during US market hours (~9:30am–4:00pm ET, Mon–Fri). Don't run overnight/weekends — Stooq has no new data and it wastes writes.
- **Write budget + retention:** more-frequent writes grow `market_ticks` ~25×. Needs a retention/prune plan so the table doesn't balloon.
- **Change-pct semantics:** `change_pct` must stay **% change on the day vs. prior session close**, NOT vs. the prior 15-min tick. This is the subtle bug — if rows land every 15 min, the naive "prior row" diff computes change-since-15-min-ago, which is wrong for a ticker.

## Phase 1 — Diagnostic (HALT after)

Don't change anything yet. Resolve the scroll bug, the hover mechanism, and (the hard part) the live-numbers architecture.

### Scroll hitch
1. Read `MarketsTapeClient.tsx` + the marquee CSS. The hitch is one of: (a) the two track-halves aren't exactly equal width so `-50%` doesn't land on the duplicate boundary (sub-pixel rounding, or a trailing gap/margin on one half); (b) the `ResizeObserver` re-measures and restarts the animation spuriously, reading as a jump; (c) a flex `gap`/margin *between* the two halves that isn't inside the `-50%` math. Diagnose which. Report the exact cause and the fix (e.g. ensure both halves are identical content with no inter-half gap, the wrap translates exactly one half-width, and ResizeObserver only re-measures on real width change — debounced, not on every paint).

### Hover-pause
2. The tape has a click pause toggle (`cbt-tape-paused`, `[data-paused]` → `animation-play-state`). Report how to switch to **hover-to-pause**: `onMouseEnter`/`onMouseLeave` (or CSS `:hover` → `animation-play-state: paused`) on the tape track. Remove the click toggle + its persisted `cbt-tape-paused` state. Confirm reduced-motion still wins (a reduced-motion user has no animation to pause — that path stays). CSS `:hover` is simplest if it doesn't fight the existing JS-measured duration; report whether CSS-only hover works or it needs the mouse handlers.

### Live numbers (the hard part)
3. **GitHub Actions schedule.** Read the current markets workflow (`.github/workflows/...`). Report its current schedule (daily) and how to add a market-hours intraday schedule — `cron` in GH Actions is UTC, so ~9:30am–4pm ET = ~13:30–21:00 UTC (account for DST: ET is UTC−4 in summer / −5 in winter — report how to handle, e.g. run 13:00–21:00 UTC to cover both, or two schedules). Mon–Fri only. Propose every 15 or 30 min.
4. **Split FRED vs Stooq fetching?** Since FRED is end-of-day, propose whether the intraday run fetches only the 6 Stooq symbols (and the daily run still does all 8 incl. FRED), or the intraday run does all 8 harmlessly (FRED just returns the same value). Lean: intraday = Stooq only (skip FRED writes that won't change), daily = all 8. Report the cleanest split.
5. **Change-pct fix.** Report how `change_pct` is computed today (prior `market_date` row). Propose the fix so it's **% vs prior session close**: e.g. store/identify a daily "session close" baseline per symbol and compute intraday change against that, not against the prior intraday tick. This is critical — get the semantics right or the % is meaningless.
6. **Retention/prune.** Propose a prune: keep intraday rows for the current session (or last N days) and collapse older ones to one daily close per symbol, OR a simple "delete intraday rows older than X days" run. Report the table-growth math and the cleanest prune (could be a step in the daily cron).
7. **Client polling.** Report how the tape gets fresh numbers: the tape is currently server-rendered with `getLatestMarketTicks` + `revalidateTag("markets")`. Propose the poll — a client `setInterval` hitting a lightweight `/api/markets/latest` (or re-fetching the cached query) every ~60s, re-rendering the tape values in place WITHOUT restarting the scroll animation (critical: updating numbers must not reset the marquee position/cause a jump). Report how to update the data without remounting the animated track.

**HALT. Report: the scroll-hitch cause + fix, the hover-pause approach, the GH Actions schedule (with DST handling), the FRED/Stooq split, the change-pct fix, the prune plan, and the client-poll approach that doesn't restart the scroll. Wait for sign-off before Phase 2.**

## Phase 2 — Implementation (only after sign-off)

Built to the Phase 1 plan. Key acceptance points:
- Marquee crawls continuously, no seam jump.
- Hover pauses, leave resumes; click toggle removed; reduced-motion unaffected.
- GH Actions runs intraday during market hours (Mon–Fri, DST-handled), Stooq symbols; daily run still does all 8 + prune.
- `change_pct` = % vs prior session close (not prior intraday tick).
- Tape polls for fresh numbers (~60s) and updates values **in place** without restarting the scroll.
- `market_ticks` prune keeps the table bounded.

## Verification
- Show the diff.
- Confirm the scroll loops with no hitch (describe the seam fix; this is visual — Corey will eyeball the live crawl).
- Confirm hover pauses/resumes.
- Run the intraday workflow once (or simulate) — confirm Stooq rows land with correct day-change %, FRED untouched intraday.
- Confirm the poll updates numbers without a scroll jump.
- Confirm the prune bounds the table.
- Type check passes.

## Out of scope
- No new/paid real-time data source — Stooq (15-min delayed) + FRED (EOD) only. "Live" = intraday-delayed, not true real-time. If Corey ever wants true real-time, that's a paid-API conversation, not this.
- No change to the 8-symbol set or the tape's visual design beyond the scroll fix.
