# HO 229 — dashboard design pass: classify the 10 items against live state (HALT, no code)

Confirm the next free number before saving: `ls docs/handoffs/ | sort | tail`. Body assumes 229.

## What this is

A design doc approved 10 dashboard/nav/primaries changes (pasted in full below). Before any of them gets scoped as a build, classify each against the **live repo** and the **cleaned backlog** (HO bed693b). This is the project's standing discipline: the doc cites the world as the designer saw it, which lags live — and three of the ten ride on data-shape premises that are asserted, not verified. This handoff is **diagnostic only, no code, HALT at the end.** I turn the verdict into build handoffs.

The two things this pass produces:
1. **Per-item build state** — BUILT / PARTIAL / NOT-BUILT, with the specific component/file that decides it.
2. **Per-item backlog cross-ref** — NEW (no entry) / DUP (already an entry, possibly already done) / REFINES (modifies an existing entry), against the cleaned backlog.

Plus the three premise checks below, which gate whether items 5, 6, 8 are UI passes or pipeline builds.

## The three premise checks — these decide scope, run them for real

**P1 — stage-transition data (gates items 5 MOVERS + 6 ENACTED).** The doc asserts "MOVERS + ENACTED run on existing stage-transition data. No new pipeline." Verify that:
- A bill's stage history is actually recorded somewhere queryable — is there a `stage_history` / `bill_stage_transitions` table, a dated stage column with history, or is `stage` a single current-value field with no from→to record? Grep the schema + the sync path that writes stage.
- Specifically: can you derive, for the current week, **(from-stage, to-stage, hop-count)** per bill that moved? MOVERS needs from→to + N hops; ENACTED needs "reached enacted this week." If only the *current* stage is stored with no transition log, both are a **pipeline build** (capture transitions going forward), not a UI pass — flag that loudly, it changes the whole scope.
- If transitions ARE derivable, say from what (e.g. `latest_action_date` + stage deltas across cron runs, or an actions table). Name the exact source.

**P2 — enacted-this-week (the easy half of P1, confirm separately).** Even if full transition history is thin, "enacted this week" may be trivially queryable: bills where `stage = enacted` AND the enacting action date falls in the current week. Confirm whether that specific slice is available independent of P1's general transition log — item 6 might be buildable even if item 5 isn't.

**P3 — primary calendar queryability (gates item 8 PRIMARIES tab).** The doc flags this itself. Item 8's timeline strip needs, within a 6-month horizon: **primary dates + per-date contest counts**. Confirm:
- The `primaries` table (HO 91 calendar, HO 226 data) carries dates that can be filtered to next-6-months and grouped to a per-date count.
- HO 226 already built a primaries calendar/modal — does its data layer expose what the strip needs (a date→contest-count rollup), or is that a new query? Name the query helper if one exists.

## Per-item grep targets

For each, the file/component that decides BUILT/PARTIAL/NOT-BUILT. Don't fix anything — read and classify.

1. **Market ticker collapse + closed-state.** Tape is currently 2 rows (HO 149/172/202). Find `MarketsTape`/`MarketsTapeClient` + the ticker CSS in `globals.css`. Classify: single-line collapse (the 2-row→1-row change) and the closed-state red. Critically — does a **market-hours "closed"** concept exist anywhere, distinct from the **cron-stale** state? The doc's `--ticker-closed` (~#9b3d3d) is a NEW token and must not collide with the existing STALE marker. Report whether any market-hours-open/closed signal exists or whether that's net-new too.
2. **Stage Distribution left-anchor + sqrt.** Find the stage-distribution component (dashboard chart, not the `/trends` funnel). Report current anchor (center vs left) and scale (linear vs sqrt). Likely PARTIAL — exists, needs anchor + scale change.
3. **Topic Distribution treemap.** This REPLACES the HO 128/132 d3-pack bubble cluster. Find the current bubble/cluster component. Classify the bubble cluster (BUILT) and the treemap (NOT-BUILT). Confirm `lib/topic-colors.ts` exists and exposes the per-group hex the treemap reuses (no new tokens).
4. **Race card confined popover.** HO 166 (race-card-drawer) + HO 170 (race-drawer-confine-trim) already touched this. Read the current dashboard COMPETITIVE-RACES popover/hover behavior — is it already panel-confined, or does it spill? This may be largely BUILT or PARTIAL; report the gap between current behavior and the spec (clamp inside panel, flip-left in right column, sibling dim to 0.4).
5. **MOVERS tab.** Find the middle-column tab strip (currently ACTIVITY · TOP STALLS — confirm those two are the live set). The tab UI is the easy part; **P1 is the real gate.** Classify the tab-shell work separately from the data availability.
6. **ENACTED THIS WEEK banner.** New banner under the weekly report. Find the weekly-report snapshot placement (HO 159). Classify the banner (NOT-BUILT) but gate the data on **P2**.
7. **Masthead cursor + spacing.** HO 162 (dashboard header) + HO 131. Find the masthead component + the blinking cursor. Current: cursor on title. Spec: cursor trails the lead-in prose end. PARTIAL — masthead + cursor exist, placement + spacing change.
8. **PRIMARIES tab on the races strip.** New tab beside COMPETITIVE on the dashboard races panel. The tab + 2×2 cards likely reuse HO 226 calendar data; **P3 is the gate** for the timeline strip specifically. Classify tab-shell vs timeline-strip-data separately.
9. **Nav text-only path style.** HO 140 (DASHBOARD item) + HO 30 (nav icons). Find the nav component. Current: has icons. Spec: drop icons, `\`-prefix each item, bracket the active item, 3-group dividers. REFINES the nav — report what's there now (icon set, active-state style, any existing dividers).
10. **BILLS|NEWS → BILLS rename.** HO 114/151 named the BILLS|NEWS tab/page. Grep every reference to the `BILLS|NEWS` label (nav item, page heading, route, any component name). Classify as a rename of existing surfaces — report the full list of touch points so the eventual rename is complete, not partial.

## Report format — the grouped verdict (then HALT)

Append to chat a single grouped block. For each of the 10 items, one line:

```
N. <item name> — <BUILT|PARTIAL|NOT-BUILT> · <NEW|DUP|REFINES backlog> · deciding file: <path>
   [gap note if PARTIAL; replaced-component if a REPLACE; backlog entry # if DUP/REFINES]
```

Then the three premise verdicts, each a clear yes/no with the source named:

```
P1 stage-transition (items 5,6): <derivable from X | NOT stored, pipeline build required>
P2 enacted-this-week (item 6): <queryable via X | not available>
P3 primary calendar (item 8): <date→count rollup via X | new query needed>
```

Then a one-line **grouping suggestion** from your read: which items are trivial (batch into one handoff — likely the renames/token/style: 1-closed-token, 9, 10), which are real builds needing their own (likely 3-treemap, 5-MOVERS if P1 is thin, 8-PRIMARIES), and which are already done or nearly so (likely 4 if HO 170 covered it).

**HALT.** No code, no commits, no file changes. This is a read-and-classify pass — I write the build handoffs from the verdict. If any item's live state contradicts the design doc (already built, depends on absent data, conflicts with a shipped pattern), call it out — that's the whole point of the pass.

## Constraints

Read-only — no edits, no commits, nothing touched. Grep live, don't trust the design doc's premises (it lags). The three data checks (P1/P2/P3) get run for real, not assumed — they decide whether three of the items are UI or pipeline. Cross-ref the *cleaned* backlog (bed693b), not memory.

---

read docs/handoffs/229-dashboard-design-classify.md and follow
