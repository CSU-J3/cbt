# HO 223 — district-map geometry: SOURCE PROBE (spec-3 Phase 0)

Confirm the next free number before saving: `ls docs/handoffs/ | sort | tail`. Body assumes 223.

## Why this is a probe, not the build

Spec-3 names `benbalter/congressional-districts` as the geometry source. **That repo is stale — its district data is from the 113th Congress (~2014), two redistricting cycles out of date.** Building on it would render wrong boundaries. Beyond that, there are two real complications the spec didn't account for, and both have to be resolved with live evidence before a single asset is committed:

1. **The 119th Congress (seated 2025–26) already differs from the 118th in 5 states** — AL, GA, LA, NC, NY — from court-ordered redraws used in the Nov 2024 election.
2. **The 120th Congress (the 2026 midterms — the cycle `/races` ratings are actually about) has *further* mid-decade redraws** in TX, CA, MO, NC, OH, UT, several still in active litigation as of early 2026.

So "current congressional districts" is genuinely ambiguous right now, and picking the wrong boundary set means a clicked district resolves to the wrong race in exactly the states most worth looking at. **This is the OpenSecrets/FMP lesson applied before the fact: verify the specific current-ness of a third-party data source against the real endpoint before scoping a build on it.** No assets, no projection code, no commits in this HO — this probe answers two questions and stops.

## The two questions

**Q1 — which boundary cycle does `/races` mean?** The seat records in `getRacesIndex` are the authority. Whatever cycle the 2026 race ratings were seeded against is the cycle the district map MUST match, or clicks misresolve. The planning chat cannot answer this from a stale project copy — you read it live.

**Q2 — which free, current, public-domain/permissive source carries that cycle's boundaries at usable resolution?** Candidates to probe (do NOT assume; fetch and diff):
- `unitedstates/districts` (CC0) — serves at `https://theunitedstates.io/districts/cds/{year}/{ST}-{D}/shape.geojson`. **Year-pinned** — confirm which year folder exists and what cycle it actually contains; do not assume it's current.
- Census TIGER / cartographic boundary files — the `cd119` 119th-Congress set is authoritative for the seated Congress (data.gov / census.gov). Heavier (shapefile → needs conversion), authoritative.
- `benbalter` — fetch ONE state purely as a **negative control** to confirm it's stale, then discard it. The spec's `raw.githubusercontent.com/.../master/` path is also wrong (repo serves from `gh-pages` / `ben.balter.com`); don't carry that path forward.

## Probe procedure (live, HALT-gated)

**Phase A — read the seat keys.** Pull the full seat-ID list from `getRacesIndex` (the 137-seat set). For each House seat, note `{ST}-{DD}`. Report: how many House seats, which states, and — critically — **do any of the seat IDs fall in states that redrew between the 118th/119th (AL/GA/LA/NC/NY) or for the 120th (TX/CA/MO/NC/OH/UT)?** List the specific competitive seats in redrawn states (these are the seats where source choice actually matters). Determine from the seat data / any cycle field whether the ratings are 119th-keyed or 120th-keyed. **State the answer to Q1 with the evidence.**

**Phase B — probe each candidate source on the redrawn states.** For 2–3 of the redrawn states that contain competitive seats (pick from Phase A — likely NC, GA, TX, CA), fetch the candidate sources and check:
- Does the source return geometry for every district the state currently has (count match vs `getRacesIndex`)?
- Spot-check one redrawn district's boundary against a known reference (e.g. does NC-01 / GA's Atlanta-area redraw look like the post-2024 map, not the pre-2024 one)? A coarse check is fine — you're distinguishing "right cycle" from "wrong cycle," not validating cartographic precision.
- benbalter as negative control: confirm it returns the stale (wrong-count or wrong-boundary) shape so the rejection is documented, not assumed.

**Phase C — district-ID → seat-ID resolution.** Whatever source wins, confirm its district identifiers map cleanly to `getRacesIndex` seat IDs (the `{ST}-{DD}` join the modals depend on). At-large states (MT, WY, etc.) code district as `0` or `00` or `AL` depending on source — confirm which, and that it resolves. DC / territories — confirm they're handled or explicitly out.

**Phase D — asset-size sanity.** For the winning source, estimate the full 50-state simplified-GeoJSON payload at ~0.004–0.005 tolerance (the spec's CA figure was small; verify the national total is acceptable as a committed static asset, not a multi-MB bundle bloat). Report an estimate, not a final build.

## HALT — report before any build

End with:
1. **Q1 answered:** 119th or 120th, with the seat-data evidence. If the ratings are 120th-keyed and the 120th maps are partly unsettled in court (TX/CA/etc.), flag which competitive seats sit on contested boundaries — that's a known-gap the build will have to degrade around (fall back to state outline + pick chips for a seat whose geometry isn't settled, rather than drawing a wrong boundary).
2. **Q2 answered:** the recommended source, with the diff evidence showing it carries the right cycle. If no free source cleanly carries the needed cycle, say so — the fallback is overview-only state outlines + pick chips (the modal still works without district polygons; spec-3 Phase 1 already treats sparse states this way), which is a legitimate ship, not a failure.
3. The district-ID → seat-ID mapping confirmed (or the specific mismatches).
4. The asset-size estimate.

**Do not fetch the full 50-state set, do not commit assets, do not write projection code in this HO.** This decides the source and the cycle; the geometry build is the next handoff, scoped against what you find. Leave any probe script under `scripts/diagnostic/` per the `kalshi-218` / `divergence-count` convention.

## Network note

If fetches to `theunitedstates.io`, `census.gov`, or `ben.balter.com` are blocked by the sandbox network allowlist, report the block (don't silently fall back) — the probe may need to run from your local environment rather than the sandbox, and the allowlist can be updated in network settings.

---

read docs/handoffs/223-district-geometry-source-probe.md and follow
