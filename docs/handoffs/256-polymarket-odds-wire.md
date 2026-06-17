# HO 256 — Wire Polymarket per-seat odds (data layer, parallel to Kalshi)

Confirm the next free number before saving: `ls docs/handoffs/ | sort | tail`. Body assumes 256. Follows the HO 255 probe (GO verdict).

## What this is

Wire Polymarket's per-seat Senate race odds into the data layer, parallel to the existing Kalshi odds path, so the v2 card's POLYMARKET cell has real data. Data-only: no tape change, no card change, no display invention. The card render is (c); this handoff just populates the store it reads.

Scope is per-seat Senate odds only. Chamber control and the macro fed/shutdown markets are confirmed wireable by the probe but have no display home in v2 yet, so they're held out of this handoff (see "Held" below), not dropped.

## Resolved premises (from the HO 255 probe — recorded as the `reference_polymarket_source` memory; don't re-probe)

- **Gamma read API is reachable from Vercel egress** (confirmed from a deployed pdx1 route, the harsh US-datacenter case; the trade-site geoblock does not extend to the read subdomain, and the fredgraph trap did not fire). No auth. Rate limit fine at cron cadence.
- **Shape:** political markets are Gamma *events* with nested `markets[]`; the price lives in the nested market, not the event. `outcomes` / `outcomePrices` are JSON-encoded strings (`'["0.425","0.575"]'` → parse; 0.425 = 42.5% implied). Fields available: `conditionId`, `slug`, `volume`, `liquidity`, `volume24hr`, `endDate`, `closed`, `active`, `lastTradePrice`.
- **Per-seat Senate coverage is marquee-only, not all ~35 races.** Probe confirmed TX ($527K vol / $119K liq) and ME ($552K / $122K) strong, GA ($29K / $23K) thin-but-live. The full set is unknown — this handoff must SCAN open Senate markets and count exact coverage, not assume any particular set.
- **Per-House-seat general markets are absent** (only a primary, NY-08, surfaced). House per-seat is out of scope, mirroring Kalshi's House sparsity.
- **Search ranking is polluted by closed 2023/2024 markets** — filter `closed=false` and a sane `endDate` (≈ 2026-11) on every query.

## Build

**Fetch.** Add a Polymarket fetch in the markets pipeline, parallel to `fetchKalshi` (`lib/markets.ts`). Hit the Gamma API (`gamma-api.polymarket.com`); confirm current endpoints against docs.polymarket.com. Discover open Senate seat markets: query events filtered `closed=false` + `endDate` ≈ 2026-11, identify per-state Senate races, read the nested market's parsed `outcomePrices` for the implied %.

**Scan + map.** For each live Senate seat market found, map it to our `race_id` by state + chamber. This is the careful part: match Polymarket's seat naming to our seat IDs the way Kalshi seats map. Report the exact list of seats that got a market and their liquidity.

**Store.** New `polymarket_odds` table parallel to `kalshi_odds`: `race_id` (loose link), `implied_pct`, `favorite`, plus `volume` and `liquidity` so downstream can flag thin markets. Exclude true ghosts (sub-threshold liquidity, e.g. the $38 shutdown-style market the probe found); let thin-but-live ones (GA at $23K) through with their liquidity recorded so (c) can apply a low-confidence treatment if Design wants.

**Cron.** Fetch on the existing markets cron cadence, the same place Kalshi and FRED run.

## Held (confirmed wireable, not in this handoff — no v2 display home yet)

- **Chamber control** (Senate + House, D/R neg-risk binaries — probe verified Senate Dem 42.5% / Rep 55.5%, same structure as Kalshi `CONTROLS-2026`). Liquid ($2.76M Senate / $7.33M House). High-value 2026 signal, but v2 has no place showing it yet. Wire it the moment Design gives it a home (e.g. a battlefield header stat).
- **Macro fed + shutdown** (Polymarket's "Fed Decision" is the deepest market on the platform at $157M). These duplicate the Kalshi signals already on the SIGNALS strip, and showing two sources on one tape line is a Design call. Held until that's decided.

Both are flagged to Design from the planning chat.

## Constraints

- Data-layer only. No tape change (do not touch the SIGNALS allowlist), no card change, no new UI. `/` and existing query semantics untouched; everything additive and parallel to the Kalshi path.
- Don't re-probe reachability — the `reference_polymarket_source` memory has it.
- Parse `outcomePrices` (JSON-encoded strings), don't read them raw. Filter `closed=false` + sane `endDate` on every query.
- Named `git add` per commit, eyeball the diff. `npm run build` clean.
- Ship per the live-verify rule: `git push`, then `npm run verify:deploy` until the served SHA matches HEAD.

## Ship report

Lead with the exact list of Senate seats that got a Polymarket market and their liquidity (the coverage count the probe left open). Confirm `polymarket_odds` populates on the cron, parallel to `kalshi_odds`, with implied % + volume + liquidity per seat, ghosts excluded and thin-but-live included with liquidity recorded. Confirm no display changed (tape allowlist untouched, no card change). Build clean; verify:deploy SHA matches.
