# HO 333 — Electoral consolidation: races map + primary-calendar timeline (one surface)

**Self-claim the number.** Run `ls docs/handoffs/ | sort | tail` first. Body assumes 333; if taken, rename this file to the next free number and proceed — the number is cosmetic.

## What this is

Collapse the two-tab electoral split (RACES · PRIMARIES) into a single **Electoral** surface: the competitive US map on top (unchanged), a **new primary-calendar timeline band** below it, wired so the timeline drives an amber highlight on the map. Approved design in the CBT Design chat. Visual target committed at `docs/design/electoral-races-timeline-highlight.html` — that file is the pixel spec; read it before building. **If it's not at that path, HALT and ask** (Corey drops the mock there as part of this handoff; the convention is the repo copy is canonical, not a chat artifact).

Most of this surface already exists. The genuinely new code is the timeline band, the timeline→map highlight wiring, and the routing collapse. Don't rebuild what's built (see "Reuse, do not rebuild" below).

One commit. Read each live file before editing.

## Resolved decisions (don't re-litigate)

These three were open in the design; they're now decided. Build to them.

1. **Highlighted-state click is READ-ONLY.** Clicking an amber (highlighted) map state does nothing — no modal, no nav. A state holds multiple competitive races, so there's no unambiguous single-race target, and the drill path (`/race/[id]`, the HO 225 district modal) already lives elsewhere. The map is a readout; the timeline is the only interactive control on this surface.
2. **Primary timeline sums Senate + House per date — COMBINED, not split.** Bar height = total contests that date (the existing rollup shape). The hero band already separates House/Senate *control*. A stacked Sen/House split is a future enhancement, out of scope here.
3. **Carry `DISPLAY_STALE_STATES` over as-is.** TX CA MO OH UT NC keep drawing 119th polygons under the existing flag. The map on this surface *is* the existing competitive map, which already honors the flag — don't strip or re-derive it.

## Routing decision (build to this)

Corey's call: the surface is named **Electoral** and the route matches the name — `/races` reads worse than `/electoral` for what this now is.

- **Canonical route moves to `/electoral`.** Move `app/races/page.tsx` → `app/electoral/page.tsx` (the index surface only — the per-race hub at `app/race/[id]/page.tsx` is a different directory and stays put).
- **`/races` → 308 redirect to `/electoral`.** **`/primaries` → 308 redirect to `/electoral`.** Both legacy routes land on the canonical surface. Match HO 328's redirect idiom (the `/committees → /members` mechanism); verify it live.
- **`/race/[id]` stays as-is.** It's the per-race deep page; renaming an individual race to "electoral" is semantically wrong and adds churn for nothing. Only the index moves.
- **Display label "Electoral."** HeaderBar breadcrumb reads `Congress Terminal:\119TH\Electoral>` per the mock; the top-nav item label reads "Electoral." Relabel the item if live says "Races."
- **`pathToNavKey`:** `/electoral`, `/races`, `/primaries`, and `/race/[id]` all light the Electoral top-nav item. Update the mapping so the two redirect sources (and the hub) resolve to the same key as `/electoral`.
- **Retire the Races · Primaries sub-nav group.** One surface, no sub-tabs. The electoral `GroupTabs` group (HO 173) collapses — remove the `<GroupTabs>` render from the surface (and from `/race/[id]` if it shows the electoral strip; confirm). Members group is untouched.

## Verify live first (project-copy lag rule — Code's grep beats this doc)

Confirm from LIVE source, report drift, **HALT only on item 3**:

1. **`app/races/page.tsx` stack** (read at its current `app/races/` path; the build moves it to `app/electoral/page.tsx`). Expected per HO 219: `HeaderBar → GroupTabs → <h1> → <p>description → RacesHeroBand → CartogramShell`. Confirm. The new timeline band inserts **after `CartogramShell`** (below the legend). The `<GroupTabs>` line is being removed (routing decision above).
2. **`CartogramShell` shape (the competitive map, HO 210).** Confirm it's the d3 client map (`geoAlbersUsa` + `us-atlas@3` states-10m, purple ramp from `getRacesIndex(2026)` grouped by state, NE leader-lines, `DISPLAY_STALE_STATES`). Report: is it a client component, and does it already expose any prop for external fill control, or is its paint fully self-contained? The highlight layer (below) needs to drive its fill from a parent — report how invasive that is. **Do not change its existing purple/competitive behavior** — the highlight is an additive layer on top.
3. **Primary-calendar data must carry PAST dates, not just upcoming.** The timeline shows cyan VOTED bars (past) and amber UPCOMING bars (future) across the whole 2026 primary window. HO 233's dashboard rollup is forward-only (`today .. +6mo`). Query the `primaries` table (HO 91 calendar / HO 206/226 data) and confirm it holds **already-passed** primary dates for cycle 2026 with their contest counts and the states voting each date. **HALT if the table is forward-only or lacks past dates** — the VOTED half of the timeline can't render without them, and that's a data-layer gap to scope separately. If past dates are present, proceed.
4. **Per-date `states[]` is available.** Clicking Aug 4 must highlight exactly the states voting that date (AZ KS MI MO WA in the mock). Confirm the table can produce, per primary date, the set of state postal codes voting. HO 233's card select already pulls "state(s)" per date — confirm the same source yields a clean state-code list.
5. **`getRacesIndex(2026)` per-state competitive counts** (the map fill source) and **`getChamberControl()`** (the hero band source) both still resolve. These are reused untouched; just confirm they're live.

## Reuse, do not rebuild

These are shipped. Import/mount them as-is; the only one that changes is the map (additive highlight prop).

- **`RacesHeroBand`** (HO 219) — three-cell Kalshi hero (HOUSE CONTROL · SENATE CONTROL · SEATS IN PLAY). Renders unchanged at the top. The mock's hero numbers (D 79% / 139 seats) are illustrative; the real band reads live `CONTROLH/S-2026` + `getRacesIndex` (137 rated / 29 SEN · 108 HOUSE). **No longer tab-gated** — it always shows now (one surface, no PRIMARIES tab to hide it on). Remove the tab-gating conditional around it.
- **`CartogramShell`** (the competitive map, HO 210) — purple-ramp US map. Reused, with one additive change: accept highlight + preview props (below). Its purple fill, leader-lines, `DISPLAY_STALE_STATES`, name-join, and hover tooltip stay exactly as-is.
- **The primaries `state`/date data** (HO 91/206/226) — source for the timeline. Reuse the table the HO 233 rollup already reads; add a full-cycle helper (below), don't fork the data.

## Build — the new pieces

### 1. Data — full-cycle primary-calendar helper

Add a helper (`lib/queries.ts`, beside the primaries helpers) returning **the whole 2026 primary window, past and future**, one row per primary date:

```
getPrimaryCalendar(cycle = 2026) -> Array<{
  date: string,            // ISO
  states: string[],        // postal codes voting that date
  contestCount: number,    // SUM across those states/contests that date
}>  // sorted ascending by date
```

- Source: the `primaries` table the HO 233 rollup reads. **Not** forward-filtered — include passed dates (cyan VOTED) and upcoming (amber). Group by primary date; aggregate the state list and the contest count per date.
- `unstable_cache`, tagged with **whatever tag the primaries surfaces already revalidate under** — verify live, don't guess. Reuse the existing tag so the existing cron flush covers it.
- VOTED vs UPCOMING is a render-time comparison of `date` against today — the helper returns raw dates, the component colors them. Don't bake "voted" into the query.

### 2. Client board wrapper — owns the highlight state

The map and the timeline share interaction state (the locked highlight set + the hover preview). Add ONE client component (e.g. `components/ElectoralBoard.tsx`) that owns:

```
locked: Set<string>     // selected primary dates (ISO)
hovered: string | null  // date currently hovered in the timeline
```

It renders the map + legend + timeline band + readout as children and threads state down. Derive `highlightedStates: Set<string>` by flattening `locked` through the calendar rows; derive `previewStates: string[]` from `hovered`. Mirrors the mock's `locked` Set / `lockedStates()` / `paint()` / `preview()` exactly — just lifted into React state instead of module globals.

The moved server page `app/electoral/page.tsx` fetches `getPrimaryCalendar()` + the map's existing data and passes them as props into `ElectoralBoard`. Keep the wrapper presentational-with-state — no fetching inside the client island.

### 3. Extend the competitive map for the highlight layer (additive)

`CartogramShell` (or a thin wrapper around it) accepts two new optional props:

- `highlightedStates?: Set<string>` — states to paint amber (`--accent-amber-bright`, `#fbbf24`), amber stroke, **label flips to `--bg-base`** for contrast.
- `previewStates?: string[] | null` — transient amber *outline* (stroke only, raised) for the timeline-hover preview, painted on top of the current fill.

Repaint in a `useEffect` keyed on those props. Non-highlighted states keep their purple competitive fill — **no dimming** of the rest. Repaint is instant: **no CSS transitions, no motion.** Map viewBox and height (~418px cap) are fixed and **must not change on interaction**. If extending `CartogramShell` directly is too invasive (item 2 of the live read), wrap it and drive the amber overlay in the wrapper — but the purple base must stay byte-identical to today.

### 4. Timeline band component

New component (e.g. `components/PrimaryTimeline.tsx`), d3, matching the mock's `drawTimeline`:

- x-axis: time scale Mar 1 → Sep 30 2026, month gridlines + labels.
- One bar per primary date, `height = contestCount` (linear scale), bar width ~9px.
- Fill: **cyan (`#0e7490`, voted) if date ≤ today, amber (`#b45309`, upcoming) otherwise.** (These are the existing PRIMARIES cyan/amber recency language from HO 210 — confirm the exact token/hex live and stay inside it; don't introduce new ones.)
- Dashed **TODAY** line (`--accent-amber-bright`) at today's x, labeled.
- Count label above bars with `contestCount ≥ 60` (mock threshold).
- Selected bars (date in `locked`) get an amber outline.
- Header row: `PRIMARY CALENDAR · 2026` + a legend (`N contests · M voted`, VOTED/UPCOMING swatches).

Emits up to the wrapper: `onHover(date | null)`, `onToggle(date)`, `onClear()`.

### 5. Interactions (precise — from the mock)

- **Hover a bar** → `onHover(date)` → map paints that date's states as a transient amber outline (`previewStates`). Tooltip on the bar: `MON D · N states · M contests` (HO 147 tooltip primitive).
- **Click a bar** → toggle its date in `locked`. Its states join the amber **fill** set (accumulate across multiple dates — the mock stacks Aug 4 + Aug 11). The bar gets an amber outline.
- **Click a selected bar again** → drop just that date from `locked`.
- **CLEAR ALL** → empty `locked`.
- **Hover a map state** → existing competitive-count tooltip (unchanged).
- Highlights **accumulate**; non-selected states keep purple, no dimming.

### 6. Readout line (under the timeline)

A sibling reading the same state, per the mock:

- `locked` empty → dim hint: `▸ click primary dates to stack which states vote then · click again to drop one`.
- `locked` non-empty → `▸ {MON D · MON D · …} — {N} states · {M} contests   [CLEAR ALL]`, dates ascending, amber. `CLEAR ALL` is the only clickable affordance here.

### 7. Legend row

Keep the purple ramp (1 / 2 / 3 / 4+ / NONE) and **add the amber `VOTES SELECTED DATE` swatch** (`--accent-amber-bright`) per the mock's legend.

### 8. Routing + chrome

- Move the index to `app/electoral/page.tsx`. `/races` → 308 redirect to `/electoral`; `/primaries` → 308 redirect to `/electoral` (match HO 328's redirect idiom). `/race/[id]` stays put.
- Remove the electoral `<GroupTabs>` render from the surface (and `/race/[id]` if present — confirm). Collapse the electoral group in the GROUP_TABS structure (HO 173) since it now has one member. Members group untouched.
- `pathToNavKey`: `/electoral`, `/races`, `/primaries`, `/race/[id]` all light the Electoral item.
- HeaderBar breadcrumb/title → "Electoral"; top-nav item label → "Electoral" (relabel if live says "Races").
- Retire the month scrubber (the timeline is the time control now) and anything PRIMARIES-tab-scoped that's now dead.

## Constraints

- **Static except hover/click highlight repaints. No transitions, no motion anywhere.**
- **Map size fixed across the page** — no resize/reflow on interaction; height capped ~418px, no scroll.
- Desktop-primary. Below the header, map + timeline target ~one screen.
- **Existing tokens only.** No new `:root` vars. Amber highlight = `--accent-amber-bright`; cyan/amber timeline = the existing PRIMARIES hexes (verify live).
- Namespace new CSS classes to avoid collisions (`.electoral-*` / `.primary-timeline-*`).
- **Named `git add`, never `-A`.** Eyeball before commit. If the dev server renders unstyled, it's the stale `.next` hash (HO 212) — `rm -rf .next` + one fresh `npm run dev` before debugging.

## Verify

1. `/electoral` renders: hero band (always, no tab gate) → competitive map (purple, unchanged, leader-lines, stale states) → legend (with amber swatch) → timeline band → readout. No sub-nav strip.
2. Timeline bars: cyan for dates ≤ today, amber for future, dashed TODAY line correct, count labels on bars ≥60. Bar counts hand-checked against a direct `GROUP BY primary_date` on Turso for the window.
3. Hover a bar → exactly that date's states outline amber on the map, transiently; leaving clears the preview. Tooltip correct.
4. Click Aug 4 → AZ KS MI MO WA fill amber, their labels flip to bg-base, the bar outlines. Click Aug 11 too → CT MN VT WI join (highlights stack). Click Aug 4 again → only Aug 4's states drop. CLEAR ALL → all clear.
5. Readout reflects selected dates + running state count + contest total; CLEAR ALL works.
6. Non-selected states keep purple fill (no dimming). Map size never changes on any interaction. No transitions.
7. Map purple/competitive behavior, leader-lines, `DISPLAY_STALE_STATES`, and the competitive-count tooltip are byte-identical to before.
8. Surface lives at `/electoral`. `/races` and `/primaries` both 308-redirect to it. Top-nav item lights from `/electoral`, `/races`, `/primaries`, and `/race/[id]`. Breadcrumb reads "Electoral."
9. **Stylesheet loads** (CSS asset 200, not just page-200) — the highlight + timeline are CSS-heavy; a bare 200 doesn't prove it's styled.
10. `npm run build` clean, type-check clean, no console errors.

## Doc sweep (fold into this commit)

- **SKILL.md `/races` section** (currently "map-first, list one toggle away, RACES · PRIMARIES tabs"): rewrite for the consolidated Electoral surface — single surface at `/electoral` (moved from `/races`) labeled "Electoral," the primary-calendar timeline band below the map, the timeline→map amber-highlight interaction (accumulate/drop/CLEAR ALL, read-only states), `/races` + `/primaries` redirect in, the electoral `GroupTabs` group retired, `DISPLAY_STALE_STATES` carried, Sen+House combined in the timeline. Keep the predicate-trap reminder (`getRacesIndex` 137, not `getMostCompetitiveRaces` 61) and the do-not-unify palette note (purple = competitive magnitude, cyan/amber = primary recency, amber-bright = selected-date highlight).
- **GROUP_TABS note** (HO 173 documented the electoral group): mark it collapsed to a single surface.
- **`docs/roadmap.md` STATUS block** — this is a Races-theme item; update the Races line/percentage to reflect the consolidation shipping. Read the block from the repo, edit in place.
- **`docs/backlog.md` OPEN LOOPS** — reconcile: this surface change neighbors the metro-zoom dense-state work (HO 236); note any open-loop delta (e.g. whether dense-state click-target on the competitive map is affected). Add the post-ship owed eyeball if any.

## Out of scope

- Per-seat / chamber-control Kalshi data and the hero band internals (shipped HO 218/219 — reused untouched, only the tab-gate removed).
- The competitive map's purple fill, leader-lines, name-join, stale-states, tooltip (settled HO 210 — unchanged).
- Senate-vs-House timeline split (decided: combined).
- Click-to-modal on highlighted states (decided: read-only).
- The HO 225 district modal / HO 226 primaries modal — stay on their own routes, not mounted here.
- Any new forecast/rating source — market-implied (Kalshi) only, as already shipped.
- Renaming the per-race hub `/race/[id]` — only the index route moves; the hub stays.

## Acceptance

1. Live-state read posted (page stack, `CartogramShell` extensibility, **past-dates HALT check**, per-date states, reused helpers resolve).
2. Single Electoral surface at `/electoral`: hero → map → legend(+amber swatch) → timeline → readout, no sub-nav.
3. `getPrimaryCalendar` full-cycle helper, cached on the existing primaries tag, counts match a direct Turso rollup.
4. Timeline→map highlight wired per the interaction spec — hover preview, click-accumulate, click-drop, CLEAR ALL; read-only states; no motion; fixed map size.
5. `/races` + `/primaries` 308→`/electoral`; electoral GroupTabs retired; breadcrumb/nav "Electoral."
6. Map's existing behavior byte-identical; `DISPLAY_STALE_STATES` carried.
7. Doc sweep done (SKILL `/races`, GROUP_TABS, roadmap STATUS, backlog open loops).
8. Stylesheet verified, build + type-check clean, working tree clean, pushed.
9. Commit: `feat(electoral): consolidate races map + primary timeline into one surface (HO 333)`

## Don't

- Don't change the competitive map's purple/competitive fill, leader-lines, name-join, stale-states, or tooltip — highlight is an additive amber layer only.
- Don't use `getMostCompetitiveRaces` (61) for any count — it's `getRacesIndex` (137). Never swap them (the HO 210 break).
- Don't forward-filter the primary calendar — past VOTED dates are required for the cyan half of the timeline.
- Don't add transitions, motion, or any map resize on interaction.
- Don't add new `:root` tokens — amber-bright for highlight, existing PRIMARIES cyan/amber for the bars.
- Don't make highlighted states clickable to a modal — read-only.
- Don't move or rename `/race/[id]` — only the index route moves to `/electoral`; the hub stays put.
- Don't trust this doc's file-stack/table-shape claims over the live read — verify, report drift, HALT on the past-dates check.
