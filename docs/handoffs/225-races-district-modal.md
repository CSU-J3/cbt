# HO 225 — /races district modal + incumbent-anchored card

Confirm the next free number before saving: `ls docs/handoffs/ | sort | tail`. Body assumes 225. (Note: the design chat's spec labels run one cycle behind the live repo — spec-1 shipped as HO 222, the geometry as HO 223 probe + HO 224 build. This is genuinely the next free number.)

## What this is

The click-into-a-state interaction for `/races` MAP view: click a state on the live national map → a centered modal opens → a maps band (state district overview) + pick chips select a district → a detail card shows that race. First consumer of `lib/district-geo.ts` (HO 224).

**Card structure is RESOLVED** — incumbent-anchored, challenger-conditional (the addendum supersedes spec-2's "head-to-head matchup" section). The two-column VS layout is NOT built; see Card section below.

**Scope fence:**
- Phase 1 of the geometry = **overview maps only.** Metro-zoom panels (spec-3 Phase 2) are a **separate later HO** — do not build them. `district-geo` currently provides overview geometry; dense states (CA) are cramped-but-functional, which is the accepted Phase-1 state.
- **No news block** — race→news linkage doesn't exist (`news_mentions` is bill-keyed; the wall HO 222 hit). The card composes without it. Deferred, not cut; spec-2/addendum keep the news design on record.
- CartogramShell (the live national map) is **not modified structurally** — the modal-open is an additive handler. See Phase 1.
- Primaries modal (spec-4) is HO 226, not this one. Don't build the recency map, scrubber, or primary card here.

---

## Phase 1 — read before wiring, then verify the data (HALT-gated)

### 1A — CartogramShell wiring read (do this first, before any change)

CartogramShell is the live national map. This HO does **not** modify its geometry, projection, coloring, or existing interactions. The modal-open is **additive**: a handler attached to the already-rendered state nodes, not a rebuild or fork. Read what's currently wired and branch:

- **If it already has a state click handler:** read what it does. No-op/stub → point it at modal-open. Already does something on the MAP surface (filter/navigate) → the MAP-view modal is the intended behavior; adapt that handler's action, don't add a second competing click. Hover popover untouched either way.
- **If it has a hover popover but no click handler:** the clean case. Add the click listener to the existing state nodes; leave hover exactly as-is.
- **If it has neither:** add the click handler. If the hover preview is also absent on this surface, it's part of the design (content shape per spec-4) and gets added too.

**Hard constraint:** do not rebuild CartogramShell, fork it, or alter its projection/coloring to attach the handler. The click binds to the states it already renders. **If attaching cleanly isn't possible without structural change, STOP and flag it** rather than refactoring the live map.

Report which case you found and the wiring plan before proceeding.

### 1B — data the card reads (confirm present, each degrades safely)

The card is incumbent-anchored. Confirm per-seat fields on the shape the modal consumes (likely `getRacesIndex` / `CartogramContest` — confirm which the modal can reach for a clicked district):

- **Incumbent profile:** name, party, the `member_fundraising.cash_on_hand` join (~128/137), first-elected / tenure, 2024 result, committee — confirm what's actually projected vs what needs a join the modal can cheaply make. Per the addendum, the incumbent stats row wants `CASH ON HAND` + `FIRST ELECTED`; confirm both resolve.
- **Header-strip signals:** consensus rating chip, 3-rater spread (Cook/Sabato/IE), Kalshi line, 2024 margin (House-only — `— senate` for Senate). All shipped on the HO 222 helpers / race surface; confirm the modal can feed them the same primitives.
- **Challenger record (Case 2):** `race_candidates` is populated for **4 seats** (S-GA, S-ME, NJ-07, PA-10 — HO 171/174) and empty for 133. Confirm the modal can read `getRaceCandidates(raceId)` for a clicked district, and that it returns name + party + status (no cash/bio — bioguide-keyed, absent for non-members). This drives the Case 1 ↔ Case 2 branch.
- **Open-seat flag (Case 3):** HO 221 `incumbentRunning === 0` (≈34 seats). Confirm it's reachable on the clicked-district shape (same flag the LIST/card already use — don't derive a second).
- **District → seat resolution:** confirm `districtSeatId(st, cd119)` (HO 224) resolves a clicked district to the race record the card needs, and the inverse (`seatIdToDistrict`) drives the pick-chip → map highlight. Competitive seats are the only clickable districts — confirm the "competitive" predicate the map uses to decide clickability (the rated set in `getRacesIndex` for that state).

**HALT after Phase 1** with: the CartogramShell case + wiring plan, the per-field confirmation (incumbent profile, header signals, challenger read, open-seat flag), and the district↔seat resolution confirmed against one real state (e.g. click CA-22 → resolves to the Valadao race record). Flag anything absent so the card degrades rather than fakes.

---

## Phase 2 — build

### Modal shell

Reuse the **dashboard-drawer convention** (amber-bordered floating panel over dimmed content) — do NOT build a new overlay primitive; reuse the shipped drawer component/styling. Centered modal, close on ×, click-away, Esc. The modal is **map-as-control**: maps select, card shows detail. No scrolling seat-list inside.

### Layout (top to bottom)

1. **Header** — `CALIFORNIA · 7 COMPETITIVE OF 52` (state name + count of rated seats in that state), subhead `2026 GENERAL · CLICK A DISTRICT ON THE MAP`, × at right. Title ~17px bold.

2. **Maps band** (fixed height ~310–330px, full modal width) — **overview only this HO:**
   - **State overview** (~300–320px) — the state's districts via `getStateDistrictGeometry(abbr)` (HO 224, per-state `geoAlbers().fitExtent`, its own fit — not a national-composite slice). Competitive districts colored by consensus rating (HO 222 `lib/race-colors.ts` palette); non-competitive recede `#1c2433` with dim labels.
   - Competitive districts are the only clickable ones; hover highlights amber, the picked district gets an amber outline.
   - **No metro-zoom panels** (deferred). For a dense state, the overview is cramped — that's the accepted Phase-1 state; the pick row gives a non-map path to every seat.

3. **Pick row** — quick-pick chips for the competitive seats (`CA-22 CA-13 …`), mirroring the map (clicking a chip = clicking that district, via `seatIdToDistrict`). Right end: `↓ EXPORT REPORT` and `RACE HUB →`, dimmed until a district is selected.

4. **Detail panel** — empty-state prompt (`CLICK A COMPETITIVE DISTRICT`) until a district is picked, then the card.

### Detail card — incumbent-anchored, three cases (RESOLVED per addendum)

One component, three fills, picking its render from what's present. Reuse the `RaceMapCard` incumbent idiom and the HO 222 helpers (`lib/race-colors.ts`, `race-cells.tsx`). The card **never reserves space it can't fill** — no VS divider, no empty second column.

**Shared shell (all cases):**
- **Header strip** — seat ID + consensus rating chip (left); right-aligned meta strip `2024 MARGIN · KALSHI MARKET · RATERS C·S·I` (3-segment spread bar). House-only margin (`— senate` for Senate). Consensus is the chip, not repeated. Open seats add an `OPEN SEAT` pill in the idblock.

**Case 1 — incumbent, no challenger (≈133, the default):**
- Rich single-candidate profile: portrait (~84px, silhouette fallback), `[party] · INCUMBENT` role line (party-colored), name (~22px), meta line (tenure · seat-since · committee), bio line (2024 result · descriptor), stats row (`CASH ON HAND`, `FIRST ELECTED`).
- Opponent placeholder — one quiet `--text-dim` line under a divider: `▸ No declared challenger on file. Opponent appears here once the field is set.` No VS, no empty column.

**Case 2 — incumbent + named challenger (the 4 seeded seats, growing):**
- Same incumbent anchor on top, then the challenger as **one row** under a divider: party dot · `CHALLENGER` label · name · `[party]` tag · status line (e.g. `primary winner · no fundraising record on file`).
- Sized to the data that exists (name + party + status). Does NOT expand into a full column with empty cash/bio cells. This is the growth path — a seat moves Case 1 → Case 2 automatically when a `race_candidates` opponent record lands (HO 174 refreshes).

**Case 3 — open seat, no incumbent (≈34, `incumbentRunning === 0`):**
- `OPEN SEAT · NO INCUMBENT` heading, a plain-language line that the rating reflects the seat's partisan lean rather than a matchup, a small meta row (`2024 RESULT`, `FIELD resolves after [month] primary`).
- Mostly an empty-field state by design — honest about field-TBD, not faking candidates. If a future seed adds open-seat candidates, they render with the Case 2 challenger-row idiom (no INCUMBENT tag).

| Data state | Render |
|---|---|
| Incumbent, no opponent (≈133) | Rich incumbent profile + "no challenger on file" line |
| Incumbent + named challenger (4, growing) | Incumbent profile + single challenger row |
| Open seat, empty field (≈34) | Open-seat state (lean explainer + 2024 result + field timing) |

### Export report

`↓ EXPORT REPORT` → a per-race markdown file generated **client-side** from data already on the card: rating (consensus + all three raters), signals (margin, Kalshi, incumbent cash, challenger name/party/status if present). Filename `CA-22-race-report.md`. **No news section** (deferred — don't serialize a block that doesn't exist). No new pipeline — serialize card data.

### Legend sizing (national map surface)

The competitive-races key under the national map: larger swatches (~15px), ~12px labels in `--text-muted` (not tiny `--text-dim` fine print), comfortable spacing. (spec-4 will match this for the Primaries legend — don't build that here, just keep the Races legend consistent for when 226 lands.)

---

## Constraints

- Reuse: dashboard-drawer shell, HO 224 `district-geo`, HO 222 `race-colors`/`race-cells`, `RaceMapCard` incumbent idiom. No new overlay primitive, no new color tokens.
- No motion except the existing approved cursor.
- Desktop-first; mobile <700 deferred explicitly (a click-through district modal at narrow width is its own problem — don't build it, don't break the existing MAP view below the breakpoint).
- CartogramShell not modified structurally (Phase 1A).
- No news block, no metro panels, no primaries surface.

## Verification

- Fresh `.next` (the stale-CSS gotcha): `rm -rf .next` + one `npm run dev`. Confirm stylesheet 200, not a 404 on the layout asset.
- Click a state on `/races` MAP → modal opens over dimmed page, drawer styling, closes on ×/click-away/Esc. Hover popover (if it existed pre-change) still works — confirm it wasn't replaced.
- Maps band renders the state's overview from `district-geo` (per-state Albers, not distorted); competitive districts colored, non-competitive recede; click a district → amber outline + card fills.
- All three card cases render correctly: click a Case-1 seat (any of the ≈133 — e.g. a CA competitive district) → rich incumbent + "no challenger" line. Click one of the 4 seeded seats (S-GA / NJ-07 / PA-10 — confirm they're clickable in their state's modal) → incumbent + challenger row. Click an open seat (MT/KY retirement from HO 221) → open-seat state.
- Pick chip ↔ map highlight bidirectional. Export produces a valid `.md` with no news section.
- `tsc` clean.

Commit as HO 225 once verified. Leave any scratch under `scripts/diagnostic/`. SKILL.md gains the `/races` modal entry **here** (this is the surface that wires `district-geo`, per the HO 224 deferral) — document: the modal shell reuse, the `district-geo` consumption, the three-case card, the CartogramShell additive-handler pattern, and the deferred news + deferred metro panels.

---

read docs/handoffs/225-races-district-modal.md and follow
