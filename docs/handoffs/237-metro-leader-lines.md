# HO 237 — leader lines + source-region outlines for the metro insets

Confirm the next free number before saving: `ls docs/handoffs/ | sort | tail`. Body assumes 237. **Stacks on the unpushed HO 236 commits** — build here, then one push/deploy/flush closes both.

## What this is

The metro insets (HO 236) currently float below the overview with only a text label tying them to their source region. This adds the atlas zoom idiom: a **source rectangle** on the overview outlining each metro's region, and a **two-line frustum** from that rect's bottom corners to the inset's top corners, so the eye reads "this box magnifies that area." One commit, both modals.

## Resolved premises

- **Source-region geometry comes from the server.** Extend the route's `metros[]` payload with `overviewBox: {x,y,w,h}` — the union bbox of the metro's districts **in the overview's viewBox coordinates**, slight padding. The server already has the overview-projected polygons; this is a bounds union, not a new projection. Same cache wrapper/tag/key; field optional, same null-safe degrade and flush discipline as HO 236 (a stale payload without `overviewBox` renders panels exactly as today — no rects, no lines, no error).
- **The overview SVG and the inset boxes are separate elements**, so the frustum lines need an absolutely-positioned SVG overlay spanning the maps band (`pointer-events: none` — lines must never intercept a click). Anchor math: source-rect corners map from viewBox coords to band pixels via the overview SVG's rendered box (account for `preserveAspectRatio` letterboxing); inset top corners come from the inset elements' rects. Recompute on band resize (ResizeObserver is fine; the modal is near-fixed width so churn is low).
- **The source rect itself lives inside the overview SVG** (viewBox coords — no overlay math needed for that part).

## Build

**Ordering first:** sort the inset row left→right by each metro's `overviewBox` x-center. With insets ordered to match their regions' horizontal positions, frustum lines cannot cross. (The current CA render has Southern/Central inverted relative to the map — this fixes it.)

**Source rect:** per configured metro, a 1px no-fill rectangle in the overview at `overviewBox`, stroked the inset-border amber at reduced opacity (~0.5–0.6) so the correspondence is color-matched but the rect doesn't compete with district fills.

**Frustum:** two 1px lines per inset, source rect bottom-left → inset top-left and bottom-right → inset top-right, same amber at lower opacity (~0.35). If a particular state's geometry makes the corner pairing awkward, judgment at the pixel — the requirement is an unambiguous, non-crossing visual tie, not literal corners.

**Both modals**, same as HO 236's wiring (the band is duplicated across them; wire both, don't extract here).

## Verify

- Fresh `.next`; CA in the races modal: rects ring the correct clusters, frusta connect rect→inset without crossing, inset order now matches geography left→right.
- Click-through unaffected: overview districts, panel districts, and chips all still select with the overlay present.
- Resize the window: lines track the band.
- A no-config state: byte-identical, no overlay artifacts.
- Primaries modal: same treatment renders.
- Stale-payload simulation (no `overviewBox`): panels render as HO 236 shipped them, no rects/lines, no console errors.
- `npm run build` clean.

**Commit:** `feat: metro inset leader lines + source-region outlines (HO 237)`

## Close-out sequence (covers 236 + 237 together)

1. Push all three commits to main.
2. Corey confirms the Vercel deploy is green.
3. Run `POST /api/revalidate?tag=district-geo` against prod once — it covers both payload extensions.
4. Corey eyeballs CA live (rects, lines, order, clicks). That eyeball closes HO 236 and 237.

## Constraints

- No new tokens (amber at opacity is a treatment, not a token). No config-schema changes beyond what the server derives itself. No CartogramShell or national-map changes. Overlay is render-only — zero interaction surface.
- Named `git add`, eyeball before commit, stale-`.next` rule as always.
