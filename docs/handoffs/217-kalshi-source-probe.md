> **PROBE COMPLETE — GO on both (split into two arcs).** Source GREEN: `external-api.kalshi.com/trade-api/v2`, public / no-auth / free (rate-limited; `series_ticker` filter unreliable — fetch by `event_ticker` or scan the open-events feed; ignore the legacy/2028 namespace, use `-26`/`-2026` events). Per-seat mapping clean: House `KXHOUSERACE-{ST}{DD}-26` → `{ST}-{DD}-2026` (353 districts, programmatic parse); Senate `SENATE{ST}-26` → `S-{ST}-2026` (35 races, + ~4 special-cases: `SENATEFLS-26`/`SENATEOHS-26` FL/OH specials, LA variant). Chamber-control live: `CONTROLS-2026` (Senate) + `CONTROLH-2026` (House), party-outcome markets, deep OI. Prices in `last_price_dollars` (×100 = implied %); intraday → ride the HO 142 GitHub Actions cron. `RaceMapCard` Kalshi insertion point real (line ~233, after `MarginBar`). **Drift:** the `/races` HERO band does NOT exist — `app/races/page.tsx` has no stat band, so the chamber-control stat needs a new band BUILT, not a slot filled. Split: (1) chamber-control + new hero band, (2) per-seat card odds. No code change.

# HO 217 — Kalshi probe (per-seat + chamber-control market odds) — PROBE ONLY

## Why probe-first, not build

The HO 211 diagnostic flagged Kalshi as "free source confirmed / own arc" — but that was a liveness glance, not verification that a SPECIFIC current endpoint returns congressional-market data on a usable tier. Kalshi is net-new ingestion, the exact dead-endpoint shape that reverted HO 65 (OpenSecrets API killed) and HO 70 (FMP deprecated `/api/v4/`). Scoping a build against an unverified endpoint is the failure mode this probe exists to prevent.

**No schema, no ingestion, no UI, no pipeline.** Report findings, HALT for sign-off. A green probe becomes the build arc; an auth-walled or thin result is a cheap non-starter.

## Verify current state first — do not trust this doc's framing of the card

Before probing Kalshi, confirm the current race-card insertion points from LIVE source, not from this handoff or the /mnt/project SKILL copy (which has lagged live state — three handoffs this session were built on stale text):
- `getRacesIndex` in `lib/queries.ts` — the live `RaceIndexRow` shape, and the seat key it's joined on (expected `state` + `chamber` + `district`, but confirm). The probe's mapping question depends on this exact key.
- `RaceMapCard` (+ `PrimaryMapCard`) — confirm the documented null-safe Kalshi insertion point actually exists where SKILL §pinned-card (line ~741) claims. Report if it's drifted.
- The HO 210 `/races` HERO band — confirm it reserves a slot for a Kalshi/market stat (SKILL claims "News/Kalshi hero stats are rich-card HO"). Report what's actually there.

This is a read, not a change. It tells the probe what the mapping has to hit.

## The three questions the probe must answer

### 1. Does a usable Kalshi source exist TODAY? (the HO 65/70 liveness check)
- Find Kalshi's CURRENT public API (read Kalshi's own current docs — `kalshi.com` / their developer docs — NOT third-party articles that may cite dead paths, the HO 70 lesson).
- Report: the exact base URL + the market-listing endpoint, the auth model (none / API key / signed-request / account required), and any cost or rate tier. Kalshi has changed auth before — confirm what's required to read election markets specifically, today.
- If reading congressional/election markets needs a funded account or paid tier with no free read path: that's the OpenSecrets/FMP shape. Report it as a likely non-starter and say so plainly — don't soften it.

### 2. Can Kalshi markets MAP to our seats? (the hard part — this is where it lives or dies)
This is the make-or-break, not the endpoint. Kalshi markets are keyed by their own ticker scheme, not `state`+`chamber`+`district`. Probe both market families:

**A. Per-seat markets** (enrich the race card):
- Does Kalshi run individual-seat markets for 2026 House/Senate races? Pull a sample of live market tickers + titles.
- Can a ticker be resolved to a seat in `getRacesIndex`? Show 3–5 real examples of the mapping (Kalshi ticker/title → our `state`/`chamber`/`district` key). Report whether it's a clean programmatic parse, a fuzzy title-match (the news-matcher problem again), or a hand-maintained lookup table.
- Estimate COVERAGE: of the 137 rated seats, how many have a corresponding Kalshi market? (A handful of marquee Senate races ≠ card-wide enrichment. Report the real number, not the ceiling.)

**B. Chamber-control markets** (the `/races` hero-band stat):
- Does Kalshi run "which party controls the House / Senate after 2026" markets? Pull the live tickers + current prices.
- These are a single number each (P(R House), P(D Senate), etc.) — confirm they exist and are readable, and what the current value is, so we know the hero stat is real before scoping it.

### 3. What does the data actually look like?
- For one per-seat market and one chamber-control market: dump the raw response shape (price field, what it represents — last trade / mid / implied prob, timestamp, volume). Report what we'd actually store and render.
- Refresh cadence fit: Kalshi prices move intraday; our cron is once-daily on Hobby (markets data already uses a GitHub Actions cron to bypass that — note whether Kalshi would ride that same path or need its own).

## Report format

Post in chat, then HALT:
1. Live-state read: `RaceIndexRow` shape + seat key, the card's real Kalshi insertion point, the hero-band slot (+ any drift from what this doc claims).
2. Q1 — endpoint, auth, cost. Green / auth-walled / dead.
3. Q2A — per-seat: sample tickers, 3–5 mapping examples, real coverage of 137 seats, mapping mechanism (clean parse / fuzzy / lookup table).
4. Q2B — chamber-control: tickers, current values, readable yes/no.
5. Q3 — raw response shape for one of each, what we'd store, cron-path fit.
6. **Verdict table:** per-seat odds and chamber-control each → buildable now / buildable with a lookup table (estimate the table size) / blocked (auth or cost) / blocked (no mapping). Plus a one-line GO/NO-GO recommendation per family.

## HALT
End here. No schema, no ingestion, no card edit, no hero-band edit. Wait for sign-off. If green, the build gets its own scoped handoff (likely split: chamber-control hero stat is the cheaper, smaller win; per-seat card enrichment depends on the coverage number).

## Don't
- Don't build any ingestion, schema, or UI.
- Don't trust this doc's or the /mnt/project SKILL copy's claims about the card/hero wiring — verify live, report drift.
- Don't read third-party "Kalshi API" tutorials for the endpoint/auth facts — Kalshi's own current docs only (HO 70 shipped against a third-party-cited dead path).
- Don't report the coverage ceiling ("Kalshi has election markets!") as if it were per-seat coverage. The number that matters is how many of OUR 137 seats map.
