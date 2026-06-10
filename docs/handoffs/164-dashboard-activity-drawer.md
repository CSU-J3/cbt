# HO 164 — Dashboard Activity rows → full expand drawer

## Why

On the dashboard, the ACTIVITY panel (and its TOP STALLS sibling tab) lists bills as static rows — clicking does nothing. The feed-shaped pages give every bill row a click-to-expand accordion (HO 148) that opens the full `BillExpandedPanel` (summary + meta grid + committees + related news + action chips). The dashboard Activity rows should get the same drawer, so a bill is explorable in place without leaving the dashboard.

This is **not** a trivial wire-up. Per SKILL.md line 898, the dashboard Activity panel is `ActivityTabs` (a `"use client"` island with local tab state), and `BillRowList` — the accordion wrapper used on feed-shaped pages — is explicitly "used on the feed-shaped pages but **not the dashboard body itself**." So the Activity rows are a separate render, not `BillRow` accordions. Wiring the drawer means giving `ActivityTabs` the accordion model.

## Expand idiom (decided)

Use the **feed's client-state single-open accordion idiom** (the `BillRowList` / `BillRow` / `BillExpandedPanel` model), not the `/members` URL-driven `?expanded=` idiom. Reason: `ActivityTabs` is already a client island with local state, so client-state single-open is the natural fit and matches the feed behavior the user asked to replicate. (SKILL line 875 documents these two idioms; the HO 154 normalization that would unify them is out of scope here — we're matching the feed, which is the client-state one.)

The expanded panel must be the **full `BillExpandedPanel`** — identical to the feed: summary + meta grid (SPONSOR, STAGE, INTRODUCED, LAST ACTION) rendered instantly from the loaded `FeedBill`, then on first open a fetch to `GET /api/bill/[id]/panel` for committees + related news, with the result cached up to the parent (the same caching contract `BillRowList` uses). Action chips at the bottom (`full bill page →`, `congress.gov ↗`).

## Phase 1 — Diagnostic (HALT after)

Don't build yet. Establish how `ActivityTabs` renders rows and how to give it the accordion, then halt.

1. **Read `ActivityTabs.tsx`.** Report: how it renders each bill row today (what component/markup), what data shape each row has (is it a full `FeedBill`, or a thinner projection?), and whether TOP STALLS rows share the same row render as ACTIVITY.

2. **Read `BillRowList.tsx` + `BillRow.tsx` + `BillExpandedPanel.tsx`.** Report the accordion contract: how single-open state is held, how `BillRow` signals expansion to `BillRowList`, what props `BillExpandedPanel` needs, and the panel-fetch caching mechanism (how the `/api/bill/[id]/panel` result is cached so re-opening doesn't refetch).

3. **Data sufficiency.** `BillExpandedPanel` renders instantly from a loaded `FeedBill` (summary, meta). Confirm the Activity rows already carry a full `FeedBill` per row, or report what's missing — if Activity rows use a thinner projection, Phase 2 needs the Activity query to return the fields `BillExpandedPanel` reads (summary, sponsor, stage, introduced/action dates) or the panel will render blanks.

4. **Reuse vs. adapt.** State whether `ActivityTabs` can wrap its rows in the existing `BillRowList` accordion directly, or whether the accordion state needs to be lifted into `ActivityTabs` itself (because of the tab switching — opening a row in ACTIVITY then switching to TOP STALLS should probably collapse, or each tab holds its own open-state; flag this interaction).

5. **Tab-switch interaction.** Flag how expand-state should behave across the ACTIVITY ↔ TOP STALLS tab switch: does an open row in one tab stay open when you come back, or reset? Propose the simplest correct behavior.

**HALT. Report findings + the proposed wiring approach, and wait for sign-off before Phase 2.**

## Phase 2 — Implementation (only after sign-off)

Based on Phase 1:

- Give the Activity rows (both ACTIVITY and TOP STALLS) the click-to-expand accordion opening the full `BillExpandedPanel`, single-open within a tab.
- Reuse `BillExpandedPanel` as-is — do not fork it. If the Activity query returns a thinner row projection, extend it to carry the fields the panel reads instantly (don't make the panel fetch what a `FeedBill` already provides).
- Reuse the `/api/bill/[id]/panel` fetch + caching contract from `BillRowList`; don't write a parallel fetch.
- Match the feed's collapsed-row affordance (chevron, click anywhere on the row to toggle) within the dashboard's row density. The dashboard Activity rows are tighter than feed rows — keep the panel readable but don't blow up the row height when collapsed.
- Resolve tab-switch expand-state per the Phase 1 proposal.
- Don't touch the feed pages, `/members`, or the accordion components' existing behavior — additive only.

## Verification

- Show the diff.
- Confirm clicking an ACTIVITY row opens the full panel (summary + meta + committees + news after fetch + action chips), single-open.
- Confirm TOP STALLS rows expand the same way.
- Confirm the tab switch behaves per the agreed rule.
- Confirm the feed pages still work unchanged (no regression to `BillRowList`).
- Type check passes.

## Out of scope

- No change to the feed accordion or `/members` expand.
- No HO 154 expand-idiom normalization (the two idioms stay separate).
- No header (HO 162) or races-strip (HO 163) changes.
