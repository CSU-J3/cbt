# HO 343 — Doc sweep for HO 333 (Electoral): reconcile docs to what shipped

Confirm next free number: `ls docs/handoffs/ | sort -V | tail`. Body assumes 343; rename if taken (collisions are live across the other build chats).

Docs only, no code. HO 333 shipped `/electoral` (60a48c9): `/races` + `/primaries` collapsed into one surface, competitive map on top, new primary-calendar timeline band below, timeline-driven amber highlight. Three live drifts and one deviated decision from that build need to land in the docs so the next handoff doesn't inherit a stale premise. HO 333's own doc-sweep section may have done part of this — **read the current state of each file before editing, add what's missing, don't duplicate.**

## SKILL.md — rewrite the `/races` section as `/electoral`

If it still describes the two-tab `/races` surface (map-first + RACES · PRIMARIES tabs), replace it with the shipped surface:

- Single surface at `/electoral` (moved from `/races`). Competitive map on top, primary-calendar timeline band below.
- The timeline drives the amber highlight: click a date to paint its voting states amber on the map, selections accumulate, re-click a bar to drop it, CLEAR ALL empties, hover previews a date's states as an outline. The timeline bars are the only input to the highlight set.
- **State-click → HO 225 district modal is KEPT.** Clicking a state on the map drills into its districts — a separate gesture from the timeline highlight. This deviates from HO 333's written "read-only map" call. Record why: read-only would have stranded HO 225 (race district modal), HO 226 (primaries district modal + scrubber), HO 236/237 (metro-zoom panels + leader lines), and the primaries recency-band map as unreachable dead code once `/races` + `/primaries` redirect into `/electoral`. Option 2 (keep the modal) won. The per-race hub `/race/[id]` stays reachable via the list view.
- `/races` + `/primaries` → 308 `permanentRedirect()` → `/electoral`. Electoral `GroupTabs` group retired (one surface, no sub-tabs). Breadcrumb reads `…\119TH\Electoral>`.
- `DISPLAY_STALE_STATES` carried (TX CA MO OH UT NC draw 119th polygons). The timeline sums Senate + House per date (combined, not split).
- Keep the predicate-trap reminder: the map fill is `getRacesIndex(2026)` per-state counts (137), not `getMostCompetitiveRaces` (61). Never swap them.
- Keep the palette note: purple ramp = competitive magnitude, cyan/amber = primary recency (voted/upcoming), amber-bright = selected-date highlight. Three deliberate color systems; do not unify them.

## SKILL.md — primaries helpers are uncached

By the primaries query helpers, note: there is no primaries cache tag. All primaries helpers are uncached plain `db.execute` (`getDashboardPrimaries`, and now `getPrimaryCalendar`). HO 333's handoff wrongly assumed an existing primaries tag to revalidate against. A future handoff touching primaries data should not invent a tag or wrap these in `unstable_cache` without deliberately adding the tag plus a cron flush.

## docs/oddities.md — two redirect idioms coexist

The repo now uses two redirect helpers, and they aren't interchangeable:

- 307 `redirect()` — HO 328 `/committees` → `/members`. For conditional or temporary redirects.
- 308 `permanentRedirect()` — HO 311 `/dashboard-v2` → `/`, and HO 333 `/races` + `/primaries` → `/electoral`. For permanent route moves.

Rule: a permanent route move uses 308 `permanentRedirect()`. HO 333's handoff said "308" but pointed at HO 328's 307 idiom as the model — that's the contradiction Code resolved correctly. Note it so the next merge doesn't copy the wrong helper.

## docs/roadmap.md — STATUS block

Update the Races theme line to reflect the `/electoral` consolidation shipping (two-tab split retired, timeline band in). Read the block from the repo and edit in place; don't carry the percentage from memory.

## docs/backlog.md — reconcile open loops

- Close the `/races`→Electoral doc-drift loop.
- Record the shipped decision: state-click district modal kept on `/electoral` (option 2), rationale = avoid stranding HO 225/226/236/237 + the primaries recency map.
- The owed eyeball (real-browser state-click opens the district modal on prod `/electoral`): mark closed if the HO 333 push step confirmed it; otherwise leave it as the one open verification loop.
- Tombstone 343.

## Ship

- Named `git add` — only the files you actually touched (SKILL.md, docs/oddities.md, docs/roadmap.md, docs/backlog.md).
- No runtime change, but run `tsc` + build to keep main green. `git push`; `npm run verify:deploy` until served SHA === HEAD.
