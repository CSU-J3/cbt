# HO 224 — district-map geometry build (Phase 1: all-states overview)

Confirm the next free number before saving: `ls docs/handoffs/ | sort | tail`. Body assumes 224.

## What this is

Build the district-map geometry foundation that the Races modal (spec-2) and Primaries modal (spec-4) both consume. This is **map-rendering infrastructure, not a visual surface** — it produces committed geometry assets, a per-state projection/render helper, and the district-ID → seat-ID join. No modal is built here; this is the layer they sit on.

**Scope fence:** Phase 1 only — **all states, overview maps, no metro-zoom panels.** Every state gets one district-overview map. Dense states (CA, TX) are cramped-but-functional at overview zoom; the metro-zoom config (spec-3 Phase 2) is a **later, separate HO** and must not be built here. The national `/races` map stays the live CartogramShell — untouched. No modal shell, no head-to-head card, no primary card (those are spec-2 / spec-4, later HOs).

## Settled by the HO 223 probe — do not relitigate

- **Source: Census `cd119` cartographic boundary.** `theunitedstates.io` is dead (410 Gone), benbalter is stale (113th). Build from the Census GENZ2024 `cb_2024_us_cd119_*` **20m** shapefile (404 KB zipped) — NOT 500k (7 MB raw → bundle bloat).
- **Cycle: 119th, uniformly.** The `/races` seat IDs are 119th-keyed end to end (all 108 House `race.district` == incumbent `member.district`, zero mismatches — the join key IS the 119th district number). A CD119 polygon resolves to the correct race record for every seat.
- **Join: FIPS→abbr, then `CD119` matches `{DD}` directly.** CD119 features carry `STATE` (FIPS, e.g. 37), `CD119` (zero-padded 2-digit, e.g. `01`), `GEOID` (`3711`). Map FIPS 37→NC, then `CD119` is the `{DD}` in the `{ST}-{DD}` seat ID.
- **At-large `00` → render-only, no click target** (won't match any race ID). MT codes as 1/2, not at-large, so it's fine. Filter out DC/territory delegate "districts" — they're not in `getRacesIndex`.
- **Display-stale-but-click-correct states:** TX, CA, MO, OH, UT (and NC, which is in both redraw lists) will draw their **119th** boundary, not the actual Nov-2026 line, because the IDs are 119th. The click still resolves to the right race. Affected competitive seats (from the probe): TX-28/34/35, CA-13/22/45/48, MO-05, NC-01/09/11, OH-01/09. **Do not try to source 120th geometry for these** — a wrong-cycle polygon against 119th IDs is worse than a stale-but-consistent one. See the degrade option below.

## Phase 1 — decide the build approach, then verify the join (HALT-gated)

### Decision 1 — geometry asset format + render path (the real fork)

spec-3's literal ask is **pre-projected SVG path strings** (run each state through `d3.geoAlbers().fitSize()` at build time, commit the `<path d>` strings, render with no d3 in the client bundle, no runtime cartographic math). spec-3 also states a constraint: *"no map library at runtime."*

The competing approach is **committed TopoJSON + project at render** (commit simplified raw geometry once, project per-state with d3-geo in the component).

The tension: spec-3's Phase-2 *intent* — *"each metro is just config + the subset render; no new code path"* — is only clean under the TopoJSON approach, because a metro panel needs the same districts re-fit to a different `fitSize`, and a pre-projected overview path can't be re-fit (Phase 2 would need a second pre-projection pass = a new code path, contradicting the stated intent). So the spec's letter (pre-projected paths) fights the spec's own Phase-2 design.

**You decide, based on the live bundle — this is the thing to resolve in Phase 1:**
- **Does the existing national CartogramShell (or anything in the `/races` tree) already import `d3-geo` / `d3-geo-projection` / `topojson-client`?** If d3-geo is already in the bundle, the main cost of the TopoJSON approach (≈30 KB) is already paid, and TopoJSON wins cleanly (smaller asset, one source feeds both overview and Phase-2 metros). Grep `package.json` + the import tree.
- **Is "no map library at runtime" a hard line or a soft preference here?** d3-geo is a projection library, not a tile/map renderer (no Leaflet/Mapbox). It's plausibly within the spirit of the constraint. Read how CartogramShell renders today — if it already projects at runtime, the constraint is already soft and TopoJSON is consistent with the codebase. If CartogramShell uses pre-baked paths and zero runtime projection, the constraint is hard and pre-projected paths is the in-codebase-consistent choice.

**Recommendation (planning chat):** TopoJSON + render-time projection, *if* d3-geo is already present or the runtime-projection pattern already exists — because it makes spec-3's Phase 2 pure config. If the codebase is strictly pre-baked-paths with no runtime projection anywhere, honor that and ship pre-projected paths (accept that Phase 2 becomes a second asset pass). **Report which you chose and the bundle evidence behind it before building.**

### Decision 2 — verify the join end to end

- Pull the live `getRacesIndex` seat-ID set. Confirm the FIPS→abbr table covers every state present, and that `CD119` zero-padding matches the seat-ID `{DD}` format exactly (no off-by-one, no unpadded single digits).
- Confirm at-large handling: a state whose only "district" is `00` renders as a single state-outline overview with no click target mismatch.
- Confirm a redrawn-state seat resolves: e.g. clicking the NC-01 polygon (CD119 GEOID 3701) returns the NC-01 race record from `getRacesIndex`.

### Decision 3 — confirm the shapefile→asset toolchain runs in your environment

The Census source is a **shapefile** (`.shp` + `.dbf` + `.shx`), not GeoJSON. Converting it needs a tool (`mapshaper` CLI, or `shapefile`/`gdal` in Node/Python). Confirm what's available locally before committing to a pipeline. `mapshaper` is the simplest path (shapefile in → simplify → TopoJSON or GeoJSON out, one command). Report the tool and the command.

**HALT after Phase 1** with: the format decision + bundle evidence, the join confirmation (including one redrawn-state resolve), the toolchain confirmation, and a re-confirmed asset-size estimate from the *actual* 20m file (the probe estimated ~300–600 KB national; verify against the real simplified output).

## Phase 2 — build

1. **Fetch + convert.** Pull the Census 20m `cd119` shapefile. Simplify (~0.004–0.005 tolerance was good for CA in design; tune for the national set). Output per the Decision-1 format. Filter out DC/territory delegate districts. **Commit as a static asset** under the project's asset convention (confirm where committed static data lives — likely `public/` or a `lib/geo/` data module). Do NOT fetch at runtime; do NOT run cartographic math in the request path.

2. **Per-state projection/render helper.** A function that, given a state abbr (and optionally a district-ID subset, so Phase 2 metros are a no-op extension), returns the renderable geometry for that state fit to its own bounds via `d3.geoAlbers().fitSize()` / `fitExtent` — **NOT** a slice of the national `geoAlbersUsa()` composite (slicing a composite distorts). Each state map is its own Albers fit. Standard CONUS parallels; the fit handles centering/scale. At-large states return a single state-outline shape.

3. **Join layer.** A `districtToSeat(st, cd119)` → seat-ID resolver (and its inverse for the pick-chip path) wired to `getRacesIndex`, so a clicked district resolves to the right race record and a seat ID can highlight its polygon. Null-safe: an at-large `00` or a filtered delegate district returns no seat (render-only).

4. **Inline SVG render, no runtime map library** beyond whatever Decision 1 settled (d3-geo projection is acceptable iff that's what Decision 1 chose; no Leaflet/Mapbox/tile layer ever). District fills reuse the **rating palette from HO 222** (`lib/race-colors.ts` — competitive districts colored by consensus rating; non-competitive recede dark `#1c2433` with dim labels). No new color tokens.

5. **Degrade path for display-stale states.** Build a per-state flag (or a small set) marking the 120th-redraw states (TX/CA/MO/OH/UT/NC) so the consuming modal *can* choose to render state-outline + pick-chips instead of the stale 119th polygon. **Build the flag and the outline-fallback capability; do not decide per-state here** — whether a given state actually falls back is the modal's (spec-2/4) call. Default this HO to drawing the 119th polygon for all states (internally consistent); the fallback is opt-in plumbing for later.

## What this HO does NOT do

No modal shell. No head-to-head card, no primary card. No metro-zoom panels (spec-3 Phase 2 — later HO). No change to CartogramShell or the national `/races` map. No new pipeline/cron. This is geometry + projection helper + join, committed and unit-checkable, nothing rendered into a user surface yet.

## Verification

- The committed asset loads and its size matches the Phase-1 estimate (no multi-MB bloat).
- A standalone render check: project + draw 2–3 states (a sparse one like MT or AZ, a dense one like CA, a redrawn one like NC) to confirm the per-state Albers fit looks right (not distorted, not a composite slice) and districts are individually shaped. A scratch route or a test render is fine — this doesn't ship a surface.
- `districtToSeat` resolves correctly for: a normal seat, a redrawn seat (NC-01), an at-large state (null), a filtered delegate district (null).
- `tsc` clean. If you touched the bundle (new dep), confirm the build doesn't balloon.

Leave any scratch/probe scripts under `scripts/diagnostic/`. Commit the asset + helpers as HO 224 once verified — this is a buildable, committable foundation (unlike 223 which was probe-only).

---

read docs/handoffs/224-district-geometry-build.md and follow
