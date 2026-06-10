# HO 219 — /races chamber-control hero band (Kalshi)

## Why

The HO 218 per-seat Kalshi line shipped onto the race cards. This is the chamber-level companion: a hero band at the top of `/races` showing Kalshi's market-implied probability that each party controls the House and Senate after 2026, plus the existing competitive-seat count. Design spec resolved in the CBT Design chat (Variant A — single stat row). This handoff is the build.

## Verify live state first (the project-copy lag rule)

Before building, confirm from LIVE source — not this doc or the /mnt/project SKILL copy:
1. **`app/races/page.tsx`** — the real current stack. Design spec assumes `HeaderBar → GroupTabs → <h1> → <p>description → CartogramShell` with NO existing hero band (HO 217 probe found none). Confirm that's still true; report any drift. The band inserts **between the `<p>` description and `CartogramShell`**.
2. **The RACES vs PRIMARIES tab mechanism** — how `GroupTabs` signals which tab is active to the page (URL param? the spec needs the band to render on RACES only, hidden on PRIMARIES). Find how the page already knows which tab it's on and gate the band on that same signal.
3. **`lib/kalshi.ts`** (HO 218) — the feed scanner + parser. Confirm it scans the open-events feed (it does per HO 218), so chamber-control markets are already in the fetched set or one filter-rule away. Confirm the `kalshi_odds` table shape and whether it can hold a chamber-control row or needs a sibling.

## Resolved inputs — do NOT re-derive

**Chamber-control markets (HO 217 probe, live-verified):**
- `CONTROLH-2026` — US House control. Two outcome markets (D + R).
- `CONTROLS-2026` — US Senate control. Two outcome markets (D + R).
- Each outcome's `last_price_dollars` (string, e.g. `"0.7800"`) × 100 = implied %. Same field HO 218 stores. Favored party = the higher of the two.
- These are TWO fixed event tickers — no scanning-for-seats needed, no mapping. Trivial reads. (Probe pulled: House D 78 / R 23, Senate R 58 / D 42 — but the API is authoritative; render whatever's live at fetch.)

**Count cell — RESOLVED to "137 rated", no denominator:**
- `getRacesIndex(2026)` returns the rated/competitive subset only (137 races: 29 Senate, 108 House) via INNER JOIN on `race_ratings` existence. It has NO total-seats-up figure.
- **Ship "137 rated" + the "29 SEN · 108 HOUSE" split. Do NOT add a "/ 469 up" denominator** — there's no source for total-seats-up in the index, and the design spec explicitly says don't backfill one for this cell.
- **⚠️ PREDICATE TRAP (SKILL §739/§1039, broke HO 210 once):** the band's count MUST come from `getRacesIndex` (137, INNER JOIN existence). It must NOT come from `getMostCompetitiveRaces` (61, `ABS(rating_score)<=1`) — that's a DIFFERENT query answering a different question. Name both so Code can't swap them: the band wants the **137-race `getRacesIndex` count**, not the 61-race competitive cut. The `/races` page likely already has this number in hand (it renders the list from `getRacesIndex`) — reuse it, don't re-query a different predicate.

## Design spec — Variant A, single stat row (signed off)

A `band` (`1px solid --border-strong`, `--bg-panel`, `4px` radius), **single row of three equal cells**, monospace, `1px --border-soft` dividers between cells. Sits between the description and the map.

**Cell 1 — HOUSE CONTROL:**
- Cap line: dim `KALSHI` tag (`--text-dim`) · `HOUSE CONTROL` (`--text-dim`, uppercase, letter-spaced) · amber `LIVE` pill (bordered `1px solid --accent-amber`, 9px, `--accent-amber`).
- Value: `→ {FAV} {NN}%` where `{FAV}` letter + pct are in the favored party's color; trailing `{LOSER} {NN}%` in `--text-dim`. E.g. `→ D 78%  R 22%`.

**Cell 2 — SENATE CONTROL:**
- Same as cell 1 **but NO `LIVE` pill** (the pill rides cell 1 only — one liveness signal for the whole band).
- Value: `→ {FAV} {NN}%` + dim loser.

**Cell 3 — SEATS IN PLAY:**
- Cap: `SEATS IN PLAY` (`--text-dim`).
- Big number: `137` (`--text-primary`, ~22px) + dim `rated` sub.
- Split line: `29 SEN · 108 HOUSE` (`--text-muted`).

**Favored-party logic (data-driven, NOT hardcoded):** the higher of the two `last_price_dollars` wins; its party letter+pct take that party's color (`--party-democrat` / `--party-republican` / `--party-independent`), the loser trails in `--text-dim`. If markets flip, the colors and ordering flip automatically. Handle a hypothetical exact tie gracefully (50/50 → pick either as "fav" or render both neutral; don't crash).

**Palette discipline (load-bearing):** party colors for party data, `--accent-amber` for the `LIVE` pill + (optionally) the `KALSHI` tag, neutral text scale otherwise. Do NOT use the RACES purple-magnitude ramp or PRIMARIES cyan here — those are map-tab-scoped, a hero stat is neither.

**Attribution:** dim `KALSHI` prefix on each control cap (matches the HO 218 per-seat card convention). Single amber `LIVE` pill, House cell only.

**Interactions:** NONE. Static readout. No click, no hover, no expand. Refreshes on the existing Kalshi cron.

**Mobile (<700px):** the three cells stack full-width — the inter-cell `border-right` becomes a `border-bottom` on wrap, last cell borderless. Wrap-static, no scroll region. (The design HTML's `@media(max-width:700px)` block is the reference.)

**Tab gating:** renders on the **RACES tab only**. Hidden on PRIMARIES (no chamber-control analog). Gate on whatever signal `GroupTabs`/the page already uses for active tab (confirmed in the live-state read).

The CBT Design chat produced a reference mockup (`races-hero-band.html`) — match its Variant A structure and the token usage. (It's a design artifact, not in the repo; use it as the visual target, build the real component fresh in the codebase idiom.)

## Phase 1 — Data path confirm (short; HALT if anything's off)

1. Live-state read items above (page stack, tab signal, `kalshi.ts` + `kalshi_odds` shape).
2. **Pull `CONTROLH-2026` + `CONTROLS-2026` live** through the existing `lib/kalshi.ts` path — confirm both event tickers resolve, both have two outcome markets, and `last_price_dollars` is populated on each. Report the current four numbers.
3. Decide storage: can `kalshi_odds` hold two chamber-control rows keyed by something like `race_id = 'CONTROL-HOUSE-2026'` / `'CONTROL-SENATE-2026'` (or a `kind` column), or is a tiny sibling table / `dashboard_state` entry cleaner? Recommend the lowest-friction option that rides the existing `/api/cron/kalshi` write. (Two rows in the existing table is likely simplest — confirm the schema allows it without a NOT NULL it can't satisfy, e.g. a required `district`.)
4. Confirm the count number's provenance on the page — that `getRacesIndex`'s 137 (and the 29/108 split) is already available to `app/races/page.tsx` or is one cheap call, and is NOT the 61-race `getMostCompetitiveRaces` value.

**HALT** if: either control ticker doesn't resolve, the `kalshi_odds` table can't cleanly hold chamber rows (report the blocker + the sibling-table plan), or the count predicate is ambiguous. Otherwise proceed — this is a small build, a heavy checkpoint isn't needed, but the storage decision is worth a one-line confirm before you write the migration.

## Phase 2 — Build

### Data
- Extend the HO 218 Kalshi cron path (`/api/cron/kalshi` + `lib/kalshi.ts`) to also capture `CONTROLH-2026` / `CONTROLS-2026`: for each, read both outcome markets, store the favored party + both pcts (or store both raw and compute favored at read — your call, but store enough to render the loser too). Rides the SAME GitHub-Actions 2h tick — near-zero added cost (two extra event reads on a feed it already scans).
- Storage per Phase 1's decision. Idempotent upsert. The existing `revalidateTag("races")` already flushes — confirm the band reads from a `races`-tagged query so it picks up the refresh.
- A query helper (`lib/queries.ts`) — `getChamberControl()` or similar — returning `{ house: {favParty, favPct, otherParty, otherPct}, senate: {...} }`, null-safe if a control row is missing (band cell degrades to absent/`—`, doesn't crash). `unstable_cache`, tag `races`.

### Component
- A new server component (e.g. `components/RacesHeroBand.tsx`) rendering the three-cell band per the spec. Takes the chamber-control data + the count/split as props (the page fetches both and passes them in — keep it a pure presentational component, like the card components).
- Mount in `app/races/page.tsx` between the description and `CartogramShell`, gated to the RACES tab.
- CSS in `globals.css` following the design HTML's class structure (`.races-hero-band` namespace to avoid colliding with anything). Reuse existing tokens only — no new `:root` vars.

### Verification
1. `/races` RACES tab renders the band between description and map; the four control numbers match a live `CONTROLH-2026`/`CONTROLS-2026` pull at the time.
2. Favored-party coloring is correct (House fav party colored, loser dim; same Senate) and is data-driven (temporarily swap test values or reason through that a flip would re-color — don't hardcode D-favored/R-favored).
3. Count cell shows `137 rated` + `29 SEN · 108 HOUSE`, sourced from `getRacesIndex` (NOT 61).
4. PRIMARIES tab: band is HIDDEN.
5. A missing control row (simulate by reasoning or a temp null) degrades the cell cleanly, doesn't crash the page.
6. Mobile <700px: three cells stack full-width, no horizontal scroll.
7. **Stylesheet loads** (HO 212 — verify the CSS asset is 200, or `rm -rf .next` + fresh start; a bare page-200 doesn't prove the band is styled). Start ONE fresh `npm run dev` (no stale servers — they were killed end of the HO 218 session).
8. Cron: the 2h tick writes the two control rows and the band reflects them after a `tag=races` revalidate.
9. Type-check clean, no console errors.

## Out of scope
- The per-seat card odds (shipped HO 218 — unchanged).
- The map / cartogram (settled).
- Any non-Kalshi forecast or rating-model number — market-implied only.
- A timestamp/clock on the band — the static `LIVE` pill is the signed-off liveness signal (lower clutter at this scale); do NOT add an `HH:MM` stamp.
- A `/ 469 up` denominator on the count cell — `137 rated` only, per the resolved count decision.
- The rating-history sparkline (separate race-card arc).
- Showing the band on PRIMARIES.

## Acceptance
1. Phase 1 data-path confirm posted (control tickers resolve + four live numbers, storage decision, count provenance = `getRacesIndex`).
2. Band live on `/races` RACES tab, three cells per Variant A, between description and map.
3. Chamber-control numbers ride the existing Kalshi 2h GitHub-Actions cron; null-safe per cell.
4. Count cell = `getRacesIndex` 137/29/108, NOT the 61-race predicate.
5. Hidden on PRIMARIES; mobile stacks; stylesheet verified.
6. SKILL: §pinned-card / `/races` section gains the hero band (chamber-control via `CONTROLH/S-2026` on the HO 218 cron, the `getChamberControl` helper, the count = `getRacesIndex` note with the predicate-trap reminder, RACES-tab-only, the static-LIVE-pill / no-denominator decisions). This also CLOSES the chamber-control rich-card thread — note it.
7. Type-check clean, working tree clean, pushed.
8. Commit: `feat(races): chamber-control hero band (HO 219)`

## Don't
- Don't use `getMostCompetitiveRaces` (61) for the count — it's `getRacesIndex` (137). Name both, never swap (the HO 210 break).
- Don't add a timestamp or a total-seats-up denominator — both were explicitly decided against.
- Don't make the band interactive — static readout.
- Don't hardcode which party is favored — data-driven from `last_price_dollars`.
- Don't trust this doc's page-stack/table-shape claims over the live read — Phase 1 verifies, reports drift.
- Don't add new `:root` color tokens — existing palette only.
- Don't render the band on PRIMARIES.
