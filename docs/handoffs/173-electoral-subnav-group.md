# HO 173 — Split electoral surfaces into their own sub-nav group

## Why

Races was promoted to its own top-nav item, but `/races` still renders `<GroupTabs group="members" active="races" />`, so the sub-nav strip on `/races` shows the **Members** group (Members · Committees · Races · Primaries) — a mixed signal: top-nav says Races is separate, sub-nav says it's part of Members.

Fix: split the electoral surfaces into their own group. Races and Primaries move out of the Members group into a new electoral group. Result:
- **Members group** (sub-nav): Members · Committees
- **Races group** (sub-nav): Races · Primaries

Races and Primaries are paired (primaries determine who's in the races), so they move together. The Members group shrinks to the legislative-people surfaces.

## Phase 1 — Diagnostic (HALT after)

Don't change anything yet. Map the current GROUP_TABS structure and its dependencies.

1. **Find the GROUP_TABS definition.** Locate where the sub-nav groups are defined (the `group="members"` structure `GroupTabs` consumes). Report: the full current group definitions, what surfaces each group contains, the keys/labels/hrefs, and how `active="..."` is determined per page.

2. **Find every `<GroupTabs group=... />` consumer.** Grep for `GroupTabs` usage across `app/`. Report which pages render which group with which `active` value — specifically `/members`, `/committees`, `/races`, `/race/[id]`, `/primaries` (and any primary detail route). This is the set that needs updating when Primaries + Races leave the Members group.

3. **`pathToNavKey` interaction.** The top-nav `pathToNavKey` already maps `/races` + `/race/[id]` → Races key (HO done). Confirm where `/primaries` currently maps for top-nav highlighting — does it light Members today (since it's in the Members group)? After this change, should `/primaries` light the Races top-nav item? Report the current mapping and propose the new one (lean: `/primaries` → Races key, since Primaries now lives in the electoral group).

4. **Sub-nav rendering assumptions.** Report whether `GroupTabs` or the group definitions hardcode anything about Primaries/Races being in the Members group (ordering, conditional rendering, an `active` enum). Flag anything that breaks when they move.

5. **Naming.** Propose the new group's internal key/label. Options: `group="races"` or `group="electoral"`. The sub-nav strip needs a coherent shape — Races · Primaries. Report what reads cleanly (the sub-nav doesn't necessarily need a visible group *title*, just the two tabs).

**HALT. Report the current GROUP_TABS structure, all consumers, the pathToNavKey plan for /primaries, and the proposed new group definition. Wait for sign-off before Phase 2.**

## Phase 2 — Implementation (only after sign-off)

Based on Phase 1:

- **Define the new electoral group** (Races · Primaries) in the GROUP_TABS structure.
- **Shrink the Members group** to Members · Committees.
- **Update every `GroupTabs` consumer:**
  - `/races` and `/race/[id]` → render the new electoral group, `active="races"`.
  - `/primaries` (+ any primary detail) → render the new electoral group, `active="primaries"`.
  - `/members` and `/committees` → still render the Members group (now just Members · Committees), unchanged `active`.
- **Update `pathToNavKey`** so `/primaries` lights the Races top-nav item (per Phase 1) — `/races`, `/race/[id]`, `/primaries` all → Races key. Members key lights only on `/members` and `/committees`.
- No change to the top-nav items themselves (Races is already its own item; this is sub-nav + highlighting only).

## Verification

- Show the diff.
- Confirm `/races` and `/primaries` show the new electoral sub-nav (Races · Primaries), not the Members strip.
- Confirm `/members` and `/committees` show the shrunk Members sub-nav (Members · Committees), no Races/Primaries.
- Confirm top-nav highlighting: `/races`, `/race/[id]`, `/primaries` light Races; `/members`, `/committees` light Members (negative control — none of these light the wrong item).
- Confirm the active sub-tab is correct on each page (e.g. `/primaries` shows Primaries active within the electoral strip).
- Type check passes.

## Out of scope

- No top-nav item changes (Races item already exists).
- No page content changes — only the sub-nav group each page renders and the highlight mapping.
- No new routes — `/races` and `/primaries` already exist; this regroups their sub-nav.

## Note for the SKILL sweep

This changes the GROUP_TABS structure the SKILL just documented (HO 165/the recent reconciliation noted "Races still lives in the members GROUP_TABS sub-nav"). After this ships, that line is stale — update SKILL.md as part of this handoff's commit (or flag for the next doc touch): the electoral group now exists, Members group is Members · Committees, /primaries lights Races.
