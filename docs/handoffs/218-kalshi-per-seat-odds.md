# HO 218 — Per-seat Kalshi odds on the race card (build, House + Senate)

## Why

The HO 217 probe came back GREEN on per-seat markets. This builds the Kalshi line into the `RaceMapCard` expanded row at the null-safe insertion point that already exists (HO 217 confirmed it live at `components/RaceMapCard.tsx:231-234`, right after `<MarginBar>`, before `Race hub →`). Bigger of the two Kalshi arcs, lower risk: clean mapping, high coverage, the UI slot is already reserved. Chamber-control (the hero band) is a SEPARATE arc gated on a design decision — NOT this handoff.

## Resolved from the HO 217 probe — do NOT re-derive

- **Source:** `https://external-api.kalshi.com/trade-api/v2`, public, **no auth, no paid tier**. (`api.elections.kalshi.com` mirrors it.)
- **Per-seat market keys:**
  - House: `KXHOUSERACE-{ST}{DD}-26` → clean parse to our `raceId` `{ST}-{int(DD)}-2026`. No lookup table.
  - Senate: `SENATE{ST}-26` → `S-{ST}-2026`, with a **~4-entry special-case map**: `SENATEFLS-26`/`SENATEOHS-26` (FL/OH specials carry an `S`), and the LA variant (`SENATELA-26` / `KXSENATELA-26NOV`). Confirm the exact LA ticker in Phase 1 before hardcoding.
- **Fetch discipline (the probe's hard-won caveats — bake in, don't rediscover):**
  - Fetch by **event-ticker or scan the open-events feed** (~14 paginated calls), filter client-side. Do NOT use the `series_ticker` filter (returns 0 even for live series). Do NOT fan out 137 throttled per-seat calls.
  - **Throttle for HTTP 429** (hits after ~10 rapid calls).
  - Filter to the **`-26`/`-2026`** namespace; ignore the legacy/2028/no-year graveyard series.
  - Filter out non-general markets in the senate namespace (e.g. `KXAKSENADVANCE-26AUG18` is a jungle-primary market, not the general — the probe flagged this exact shape).
- **Field to store:** `last_price_dollars` (a string like `"0.5800"` = 58% implied prob — the int `last_price` is null, don't read it). Plus `open_interest_fp` (liquidity), `close_time`, `event_ticker`, and the favorite's label from `yes_sub_title`/`no_sub_title`.
- **Cron:** prices move intraday; the daily Vercel cron is wrong. Ride the existing **GitHub Actions cron** (HO 142 markets path).

## Card content (signed off)

**Probability + named favorite.** The line shows Kalshi's favored outcome as a probability tied to the named candidate — e.g. `KALSHI · Spanberger 72%` — not a bare party number. Reasoning: the card already shows incumbent + challenger names, so a name reads naturally and cross-checks the mapping.

**The `yes_sub_title` gotcha — null-safe, mandatory:** the outcome label is *sometimes* a candidate name ("Abigail Spanberger"), *sometimes* a bare party string ("Republican Party"). The line must render cleanly either way:
- Name present → `KALSHI · {Name} {NN}%`
- Party-only label → degrade to `KALSHI · {Party} {NN}%` (party-colored, no fabricated name)
- No market / null price → render NOTHING (same null-safe absence as HO 212 cash / HO 214 Senate margin — a missing Kalshi line is correct, not a gap)

Never invent a name the API didn't give. Never show a stale price past `close_time` (if the market's closed/resolved, treat as no live odds).

## Phase 1 — Mapping cross-join + shape confirm (HALT after)

The probe pulled the market families and the parse rule but did NOT cross-join against the live 137-seat list (out of probe scope). Phase 1 closes that:

1. **Verify the live card insertion point** is still at `RaceMapCard.tsx:231-234` and `CartogramContest` (`lib/cartogram-data.ts:30-44`) still carries the rich fields a `kalshiOdds?` slots beside — report any drift (the project-copy SKILL has lagged live state; trust the live read).
2. **Pull the live open-events feed**, parse House + Senate `-26` markets, and **cross-join against the actual seats in `getRacesIndex`**. Report:
   - Of the 137 rated seats, how many map to a live Kalshi market (the real number).
   - Any rated seat that does NOT map (the null-safe placeholder rows).
   - Any Kalshi ticker that fails the parse (so the special-case map is complete — confirm the LA ticker, surface any other oddball).
3. **Confirm the `yes_sub_title` distribution** in the matched set: how many markets give a candidate name vs. a bare party string? (Sizes the degrade-path — if it's 50/50, the party fallback is load-bearing, not an edge case.)
4. **Dump one matched market's raw response** to confirm the field names haven't moved since the probe (`last_price_dollars`, `open_interest_fp`, `yes_sub_title`, `close_time`, `status`).

**HALT.** Report the coverage number, the unmapped seats, the parse-failure list, the name-vs-party split, and the confirmed field shape. Sign-off before Phase 2.

## Phase 2 — Build (after sign-off)

### Ingestion
- A fetcher (mirror the HO 142 markets pattern) that scans the open-events feed, filters to `-26` House/Senate general markets, parses ticker → `raceId`, and writes per-seat odds.
- Storage: extend the races data path so `getRacesIndex` / `CartogramContest` can return a `kalshiOdds` object per seat: `{ impliedPct, favoriteLabel, favoriteIsParty: boolean, party, openInterest, closeTime }`. Schema shape per Phase 1's confirmed fields. Null when no market.
- Wired into the **GitHub Actions cron**, not the Vercel daily. Idempotent. Flush with `POST /api/revalidate?tag=races`.

### Card render
- `RaceMapCard` (+ `PrimaryMapCard` if it shares the slot): render the Kalshi line at the existing insertion point per the **Card content** rules above. Match the `.racecard-*` idiom (the cash/margin mini-metrics set the pattern — same type scale, same right-alignment discipline).
- **Palette:** party-colored where a party is implied (the existing `--party-*` tokens); this is NOT a RACES-magnitude (purple) or PRIMARIES (cyan) signal, so don't reach for those. A neutral `KALSHI` tag prefix in `--text-dim`.

### Verification
1. A seat with a known live market (use one from Phase 1's matched set) renders `KALSHI · {favorite} {NN}%` with the right number.
2. A seat with a party-only `yes_sub_title` renders the party degrade path, no fabricated name.
3. A rated seat with NO market renders nothing (no empty line, no `—`).
4. The number matches the live API `last_price_dollars × 100` at fetch time.
5. House clean-parse seats AND Senate special-case seats (FL/OH specials, LA) all resolve.
6. **Stylesheet loads** (HO 212 lesson — verify the CSS asset isn't 404ing on a long-running dev server, or `rm -rf .next` + restart; a bare 200 doesn't prove styled render).
7. Cron path: confirm the GitHub Action writes and the card picks it up after a revalidate.
8. Type-check clean, no console errors.

## Out of scope
- **Chamber-control hero band** — separate arc (HO 219), gated on a `/races` hero-band design decision. The probe found NO hero band exists today, so that's net-new layout, not a slot-fill. Not here.
- Challenger/candidate Kalshi sub-markets beyond the single favored-outcome line.
- Historical odds / a Kalshi trend sparkline (that's the rating-history-sparkline arc's shape, separate).
- Per-seat fan-out fetching (the 429 makes it fragile — feed-scan only).
- Any change to the cash (HO 212), challenger (HO 213), or margin (HO 214) lines — Kalshi slots beside them.

## Acceptance
1. Phase 1 cross-join posted: real coverage of 137, unmapped seats, parse-failure list, name-vs-party split, confirmed field shape.
2. Sign-off before Phase 2.
3. Per-seat Kalshi line live on `RaceMapCard`, named-favorite with party degrade, null-safe absence.
4. Rides the GitHub Actions cron, intraday-fresh, `tag=races` revalidate.
5. SKILL §pinned-card: add the Kalshi line (source, the ticker parse + senate special-cases, the name/party render rule, null-safe absence, GitHub-Actions cron path, coverage number from Phase 1). Note chamber-control remains a separate arc.
6. Type-check clean, working tree clean, pushed.
7. Commit: `feat(races): per-seat Kalshi odds on race card (HO 218)`

## Don't
- Don't build the chamber-control hero band or any new `/races` layout band — that's HO 219, design-gated.
- Don't trust this doc's or the project-copy SKILL's card-wiring claims over the live read — Phase 1 verifies, reports drift.
- Don't read third-party Kalshi tutorials for endpoint/field facts — the probe verified these against Kalshi's own docs + live pulls; if something's unclear, re-pull live, don't guess.
- Don't fabricate a candidate name when `yes_sub_title` is a bare party — degrade to party.
- Don't show odds past `close_time` (resolved/closed market = no live odds).
- Don't use the `series_ticker` filter or per-seat fan-out — feed-scan, throttled.
