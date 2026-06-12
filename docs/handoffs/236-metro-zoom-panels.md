# HO 236 — metro-zoom panels for the district modals (spec-3 Phase 2)

Confirm the next free number before saving: `ls docs/handoffs/ | sort | tail`. Body assumes 236.

## What this is

The deferred Phase 2 of the district-geometry arc: dense-state inset panels, so districts that render too small to click at the state-overview fit get an atlas-style metro panel at their own `fitSize`. CA's LA basin is the canonical case. Phase 1 (HOs 224–226) deliberately built for this — `getStateDistrictGeometry` accepts an optional district-ID subset so a metro panel is **config + a subset re-fit, no new code path** (the HO 224 intent quote, and the reason TopoJSON won Decision 1).

Neither spec doc in the repo carries spec-3's Phase-2 visual text, so this spec governs the layout (same precedent as HOs 233/234).

Two commits, with a measurement gate before any config exists. Read each live file before editing.

## Resolved premises (don't re-derive)

- **Geometry is render-time projected** (TopoJSON + per-state `geoAlbers().fitExtent`, HO 224 Decision 1) — subsets re-fit cleanly. If the live helper signature drifted from "optional district-ID subset," report it before working around it.
- **Both modals consume geometry through `GET /api/races/district-geo/[state]`**, which is `unstable_cache`-wrapped (revalidate 30d, tag `district-geo`) and returns server-resolved `seatId` per polygon. The modals never import server-only join helpers — any new geometry must arrive through this route the same way.
- **Cache trap, carry this loudly:** the route's cached payloads are 30-day. Extending the payload shape means (a) the client must be **null-safe on the new field** (stale cached responses simply render no panels), and (b) the deploy step includes **`POST /api/revalidate?tag=district-geo`** so fresh payloads actually ship. Without the flush, panels silently don't appear for up to a month.
- **Clickability today:** the races modal makes only competitive districts clickable; the primaries modal's click target is any district with a primary. The geometric problem is shared, so the **config is surface-agnostic** — one metro definition serves both modals.
- **`DISPLAY_STALE_STATES` is orthogonal** — stale-boundary states keep drawing 119th polygons in panels exactly as the overview does. Don't touch that plumbing.

## Commit 1 — measure, configure, extend the geometry layer

**Diagnostic first** (`scripts/diagnostic/`, tracked): for every state with rated House seats, project the overview at the modal band's actual render size and compute each **competitive** district's bbox in pixels. Flag any below a click-target floor (start at ~22px min-dimension; tune against the CA render by eyeball and record the chosen floor in the script). Report: state → flagged districts → rough clusters by bbox proximity.

**Gate:** if the diagnostic flags **zero** districts, HALT and report — the overview renders bigger than the design assumed and the feature has no need. Don't ship decoration.

**Config** (`lib/metro-panels.ts` or wherever `district-geo`'s constants live): `{ state, label, districtIds[] }[]`, seeded from the diagnostic's flags grouped into named clusters (`LA BASIN`, `BAY AREA`, `NYC METRO`, ...). Include every flagged competitive district in some panel; a panel may include non-flagged neighbors when that makes the cluster geographically coherent. **Cap: 2 panels per state.** If a state's flags don't cluster into ≤2 sane panels, report it rather than forcing it.

**API extension:** the `[state]` route additionally returns `metros: [{ label, polygons }]` for configured states — same shape as the overview polygons (path string + `seatId`), each metro re-fit via the existing subset parameter at the panel's own extent. Same cache wrapper, same tag, per-state key unchanged.

**Verify:** diagnostic report in hand; for one configured state, the route's fresh payload carries metro polygons whose `seatId`s match the overview's; flagged districts' panel-render bbox now clears the floor.

**Commit:** `feat: metro panel config + geometry subset payloads (HO 236, spec-3 Phase 2)`

## Commit 2 — render the panels in both modals

**Placement:** in the maps band, panels render **below the state overview** in a horizontal row — each a labeled inset box (~140–160px tall), label top-left in the existing dim-caption style, amber-idiom border consistent with the modal shell. If the pixel reality of a tall state argues for beside-instead-of-below, use judgment at the pixel; the requirement is that the band stays one coherent unit and the modal doesn't outgrow the viewport.

**Behavior — identical semantics, same keying:** fills from `race-colors` by rating with non-competitive receding (races modal) / the primaries modal's existing fill rules; hover and click do exactly what they do on the overview, keyed by `seatId`. **Selection syncs everywhere:** picking a district — on the overview, in a panel, or via a pick chip — amber-outlines it in every place it's drawn. No panel-only interaction rules.

**Both surfaces:** wire the races modal (HO 225) and the primaries modal (HO 226). If their maps bands turn out to be one shared component, this is one wiring; if duplicated, wire both and note the duplication for a future extraction — don't do the extraction here.

**States without config** render exactly as today: no panel row, no reserved space.

**Verify:**
- Fresh `.next`; flush `district-geo` locally; open CA in the races modal — overview plus labeled panel(s), flagged districts now comfortably clickable in the inset, selection synced overview ↔ panel ↔ chips.
- Same state in the primaries modal — panels present, primary-card click works from a panel polygon.
- A no-config state (MT-class) — band unchanged, byte-identical to before.
- Stale-cache degrade: simulate a payload without `metros` — modal renders the overview cleanly, no error.
- `npm run build` clean.

**Commit:** `feat: metro inset panels in district modals (HO 236, spec-3 Phase 2)`

## Deploy step

After push + Vercel deploy: `POST /api/revalidate?tag=district-geo` against prod, then eyeball CA on the live site. Say in the ship report that the flush ran.

## Constraints

- No new code path for projection — the subset parameter is the whole mechanism. No new color tokens; existing rating palette and dim-caption styles only.
- No CartogramShell changes, no national-map changes, no news block, no mobile work (<700 stays deferred as in HOs 225/226).
- Config stays data (state, label, district IDs) — no per-metro rendering logic.
- Named `git add` per commit, eyeball before each.
