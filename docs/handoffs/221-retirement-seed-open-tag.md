# HO 221 — Retirement seed + OPEN-seat tag on the /races list

## Why

CHECK 1 (the pre-HO diagnostic) confirmed the OPEN tag is render-ready but has nothing to render on: `races.incumbent_bioguide_id IS NULL` means "vacancy / unmapped seat" (0 cases today), NOT "incumbent not running." A retiring member keeps their bioguide until they leave office, so the existing column can't express a retirement-open seat. This handoff adds the missing signal — a hand-curated retirement flag seeded from the current confirmed 2026 retirement list — and renders the OPEN tag off it.

This is the honest, cheap path chosen over news-mining (too unreliable to render) and roster-inference (ambiguous until primaries resolve). Retirements are public, finite (~40-50 House/cycle), slow-moving, and fit the existing `races-seed.json` hand-curated discipline.

## Verify live state first (the project-copy lag rule — it's caught a premise every session)

Confirm from LIVE source, not this doc or the /mnt/project copy:
1. **`races` schema** — confirm there's no existing retirement/incumbent-running column (SKILL shows `incumbent_bioguide_id`, `rating`, `margin_2024`, etc. — no retirement field; confirm). The flag is a new column.
2. **`races-seed.json` structure + `seed:races`** — the real JSON shape and how `seed:races` applies it (SKILL: idempotent UPDATE on the race row + ON CONFLICT on candidates). The new flag rides this same apply path. Confirm the per-race object shape so the flag slots in cleanly.
3. **`getRacesIndex` row shape** — confirm where to project the new flag onto `RaceIndexRow` (it already carries `incumbentBioguideId`, `margin2024`, `kalshiOdds`, `incumbentCashOnHand` — the flag joins the same projection).
4. **`RaceMapCard`** (the `/races` list row) — the collapsed-row structure where the OPEN tag renders, and confirm the design's intended treatment (amber `OPEN` tag + `○` party glyph, suppress the cash line on open rows — there's no incumbent cash to show).

## Phase 1 — Pull the live retirement list (the data-liveness HALT)

**This is the step that earns a HALT** — the retirement list is a live-world fact that must be current, not sourced from training data (which is a Jan-2026 snapshot and will be stale/incomplete for a Nov-2026 cycle). Code must pull it fresh.

1. **Web-search the current confirmed 2026 congressional retirements** against Ballotpedia's retirement tracker (the canonical source — "List of U.S. Congress incumbents who are not running for re-election in 2026" or equivalent). Capture: member name, state, district (or Senate), party, and whether it's a flat retirement vs. running-for-other-office (both vacate the seat → both are OPEN for our purposes, but note which is which).
2. **Cross-join against the 137 rated seats in `getRacesIndex`** — of the confirmed retirements, how many fall on a *rated* seat (the only ones where the OPEN tag would show on the /races competitive list)? A retirement in a safe, unrated seat won't surface here. Report the rated-seat retirement count — that's the real number of OPEN tags this ships.
3. **Resolve each to a `race_id`** (`{ST}-{DD}-2026` House / `S-{ST}-2026` Senate) so the seed entries are keyed correctly. Flag any that don't map cleanly.
4. Report: the full confirmed-retirement list, the rated-seat subset with race_ids, and the proposed seed-flag shape (see below). **HALT for sign-off** — confirm the list is current and the rated subset before writing the schema migration or the seed data.

Why HALT here and not just proceed: if the web-pulled list is thin, stale, or Ballotpedia's tracker has moved, that's a data problem to surface before building — same discipline as a dead-API probe. Plan mode can't verify a list is current; a web pull at scope time can.

## Design — the retirement flag (resolved shape, confirm column name in Phase 1)

**Schema:** a new column on `races` — proposed `incumbent_running INTEGER` (1 = running, 0 = retiring/seeking-other-office, NULL = unknown/not-yet-curated). Defaulting to NULL (not 1) is the honest default — we only assert "not running" where we've confirmed it; everything uncurated stays unknown and renders as a normal incumbent (no OPEN tag). A `0` is the positive retirement signal.
- Alternative if cleaner: a nullable `retirement_note TEXT` carrying a short reason ("retiring" / "running for governor") doubles as the flag (non-null = open) AND feeds a future "(retiring)" tooltip. Phase 1 recommends one; default to the boolean unless the note's reuse value is obvious.

**Seed:** retirement entries go in `races-seed.json` per the confirmed list, keyed by race_id, riding the existing `seed:races` UPDATE path. No new script — extend the seed data + the apply logic to set the new column.

**Render (the OPEN tag):** on the `/races` collapsed row, when the flag says retiring (`incumbent_running = 0` or `retirement_note` non-null):
- `OPEN` tag in `--accent-amber` (amber = the app-wide attention accent, correct here; NOT purple/cyan — those are map-magnitude/primaries-scoped).
- A `○` glyph in place of the party dot (open seat = no party-incumbent to color).
- **Suppress the incumbent cash line** on that row — there's no incumbent cash story for an open seat (the incumbent's leaving). Null-safe: the cash line already omits cleanly when absent.
- The incumbent's name can still show dimmed with a "(retiring)" cue, OR the row leads with OPEN — Phase 1 confirms which reads better against the live row layout. Don't fabricate a successor name.

## Phase 2 — build (after the Phase 1 list is signed off)

### Schema
- Add the chosen column to `races` (migration in `migrate.ts`, following the `margin_2024` precedent — a nullable column added to the existing table).

### Seed
- Add the confirmed rated-seat retirement entries to `races-seed.json` (keyed by race_id).
- Extend `seed:races` to apply the new column from the seed object (the same idempotent UPDATE). Unknown race_ids warn-and-skip like the existing seed behavior.
- Run the seed; report how many rows got the flag set (should match the Phase 1 rated-seat count).

### Query
- Project the flag onto `RaceIndexRow` in `getRacesIndex` (the same projection that carries `margin2024` / `kalshiOdds`). Null-safe.

### Render
- `RaceMapCard`: the OPEN tag + `○` glyph + cash-suppression per the design, gated on the flag. Match the `.racecard-*` idiom.

### Verification
1. The rated seats with a confirmed retirement render the OPEN tag + `○`; the cash line is suppressed on those rows.
2. A normal defended-incumbent seat is unchanged (no OPEN tag, cash line present as before).
3. An uncurated seat (flag NULL) renders as a normal incumbent — NULL is not OPEN (the honest default).
4. The count of OPEN tags on the page matches the Phase 1 rated-seat retirement count.
5. Re-running `seed:races` is idempotent (no duplicate flags, no clobbered ratings/rosters — the existing seed-safety holds).
6. **Stylesheet loads** (HO 212 — verify the CSS asset is 200 or `rm -rf .next` + fresh start; a bare page-200 doesn't prove the tag is styled). One fresh `npm run dev`, no stale servers.
7. Cache: flush `POST /api/revalidate?tag=races` after the seed (the `unstable_cache` `.next/cache` gotcha — a DB write isn't visible on the list until the races tag revalidates; verify with the POST, not a bare restart).
8. Type-check clean, no console errors.

## Out of scope
- The four ship-now signals (readout counts, ◆ divergence, House margin-delta, cash figure) — those are a SEPARATE build, not gated on this. (This handoff is just the OPEN tag + its data.)
- News-as-retirement-detection — parked in backlog; the seed is hand-curated, not news-derived.
- A successor/open-seat candidate roster — `race_candidates` already handles challengers; this is just the OPEN *flag*, not who's running for the open seat.
- Auto-refreshing the retirement list — it's hand-curated, refreshed quarterly with the rest of `races-seed.json`. No cron.
- Retirements on unrated seats — they won't surface on the /races competitive list (not in `getRacesIndex`); only rated-seat retirements get a tag. (A retirement on a safe seat is real but off-surface here.)
- The relative cash-thin amber signal — parked in backlog (no natural absolute threshold; revisit as percentile/rank).

## Acceptance
1. Phase 1 posted: the live web-pulled confirmed 2026 retirement list, the rated-seat subset with race_ids, the proposed column shape. Sign-off on the list being current + the subset before Phase 2.
2. New retirement flag column on `races`; the rated-seat retirements seeded via `races-seed.json` + `seed:races`.
3. OPEN tag + `○` glyph renders on flagged rows; cash line suppressed; NULL renders as normal incumbent.
4. OPEN-tag count on the page matches the Phase 1 rated-seat count.
5. SKILL: `races` schema gains the new column; the `seed:races` note mentions the retirement flag; the `/races` card note documents the OPEN-tag render rule + the "NULL = unknown, not open" semantic + the cash-suppression-on-open behavior. Note the retirement list is hand-curated/quarterly, sourced from Ballotpedia.
6. Type-check clean, working tree clean, pushed.
7. Commit: `feat(races): retirement seed + OPEN-seat tag (HO 221)`

## Don't
- Don't derive OPEN from `incumbent_bioguide_id IS NULL` — that's vacancy/unmapped (0 cases), NOT retirement. The whole point of this handoff is that the existing column can't express it; use the new flag.
- Don't source the retirement list from training-data memory — web-pull it current in Phase 1 (a Jan-2026 snapshot is stale for the cycle). HALT to confirm it's current.
- Don't default the flag to "running" (1) — default NULL (unknown). Only assert not-running where confirmed; uncurated seats render normal.
- Don't fabricate a successor name or a party for an open seat — `○` glyph, OPEN tag, no invented candidate.
- Don't reach for purple/cyan on the tag — amber (attention) is correct; the other two are map-magnitude/primaries-scoped.
- Don't build the four ship-now signals here — separate handoff.
- Don't trust this doc's column/seed-shape claims over the live read — Phase 1 reconciles.
