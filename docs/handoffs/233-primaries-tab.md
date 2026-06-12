# HO 233 — PRIMARIES tab on the dashboard races panel (design item 8)

Confirm the next free number before saving: `ls docs/handoffs/ | sort | tail`. Body assumes 233.

## What this is

Third of the four remaining dashboard design-pass items. Adds a **PRIMARIES tab beside COMPETITIVE** on the dashboard races panel: a 6-month timeline strip of upcoming primary dates weighted by contest count, a 2×2 of what's coming soonest, and an expander into the primaries surface. HO 229's P3 verdict: the calendar data is queryable today; the only new data work is a trivial `GROUP BY primary_date` rollup — no pipeline.

If the design-doc appendix survives at the bottom of `docs/handoffs/229-dashboard-design-classify.md`, its item 8 text wins over my paraphrase below; if it isn't there, this spec stands.

One commit. Read each live file before editing.

## Resolved premises (don't re-derive)

- **P3 (HO 229):** the `primaries` table (HO 91 calendar, HO 206/226 data) carries dates filterable to a forward window; the per-date contest count needs one new rollup helper. The card fields reuse what the HO 226 modal card already selects — match its select shape, don't invent a new one.
- **Upcoming contests have no results by definition.** `vote_pct` is results-era data; the 2×2 here is pre-results. No ShareBar, no advancer ★ on this surface.
- **The races panel is currently single-view COMPETITIVE** (2×2 cards + the HO 230-reconfined hover popover). The tab strip is new on this panel — reuse the middle column's tab idiom (`ActivityTabs` pattern: same markup shape, same active treatment), don't invent a second tab style.
- **No filter wiring.** The races panel is electoral and doesn't rebase with `?stage=`/`?topics=`; the PRIMARIES tab is the same.
- **Route target:** the design text says "expander into /races primaries," but the primaries surface has lived at `/primaries` since HO 208. Verify which is canonical live and link there.

## Data — one rollup helper

New helper in the dashboard data layer (match where the panel's existing queries live), two shapes from one source:

- **(a) strip:** `primary_date → contest count` over `today .. +6 months`, upcoming only.
- **(b) cards:** the soonest upcoming dates with per-date detail — state(s), contest count, and the marquee seats (rated seats first, then by candidate-field size), selecting the same fields the HO 226 card uses.

Cache via `unstable_cache` with whichever tag the primaries surfaces already revalidate under — verify the tag live, don't guess.

## UI — tab, strip, 2×2, expander

**Tab shell:** `COMPETITIVE · PRIMARIES` on the panel header. COMPETITIVE stays the default. Panel footprint stays stable across tabs — the PRIMARIES content should occupy the same height as the competitive 2×2 so the right column doesn't jump.

**Timeline strip:** thin horizontal band at the tab's top. Six-month window, today-marker at the left edge, a tick per primary date, tick weight or height scaled by contest count, sparse date labels (month boundaries plus the heavy ticks). Mono, existing tokens only — the primaries surfaces already have a cyan/amber recency language from HO 210; stay inside it. Tick hover → `date · N contests` via the HO 147 tooltip primitive.

**2×2 cards:** the four soonest upcoming primary **dates**, one card per date — date headline, state(s), contest count, and the top seats listed (rated first). The design's phrase is "soonest contests," but the calendar is slate-shaped: the four soonest individual contests are routinely one state's same-day slate, and four cards saying the same date carry no signal. Per-date cards contain the per-contest information and read correctly regardless of calendar shape. **If the repo-229 appendix explicitly drew per-contest cards, follow the appendix and say so in the ship report.** Card click → the primaries surface anchored to that date or state if an anchor exists; plain route link if not. No modal mount on the dashboard — the HO 226 modal stays on its own page.

**Expander:** footer link, `ALL PRIMARIES →`, into the canonical primaries route.

## Verify

- Tab toggles; COMPETITIVE behavior (cards, popover, confinement) byte-identical to before.
- Strip ticks hand-checked against a direct `GROUP BY primary_date` on Turso for the window — counts match.
- Cards show genuinely upcoming dates only (nothing past), seats listed match the live calendar.
- Expander lands on the right route. No layout jump between tabs. `npm run build` clean.

**Commit:** `feat: PRIMARIES tab on dashboard races panel (HO 233, design item 8)`

## Constraints

- Scope fence: the races panel, one rollup helper, one route link. Don't touch COMPETITIVE's popover or data, `/primaries` itself, or the HO 226 modal. No new tokens, no ShareBar, no filter wiring.
- Named `git add`, never `-A`. Eyeball before commit. If the dev server renders unstyled, it's the stale `.next` hash — wipe and restart before debugging.
