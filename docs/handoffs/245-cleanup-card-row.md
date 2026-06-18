# HO 245 — dead-code sweep + competitive cards to full-width row

Confirm the next free number before saving: `ls docs/handoffs/ | sort | tail`. Body assumes 245.

## What this is

Closes the two loops HO 244 opened. The reflow orphaned four components and left their CSS dead; the full-width move left the competitive race cards sparse at 2×2. Two commits — delete the dead code, then re-row the cards. Pure cleanup plus one grid change. No data, no new tokens, no component internals.

## Don't touch

- **`getDashboardLead()` and its cron.** Orphaned-but-live by design — it's the option-preserver for a glanceable weekly synthesis the design project hasn't ruled on. Leave the generator running; it's a negligible Gemini-Flash cost daily and keeps the data fresh for an instant re-render if we want it back. It's banked as an open decision, not a cleanup target.

## Commit 1 — delete the orphaned components + dead CSS

**Per component, grep for any remaining import/usage before deleting. If anything still imports it, stop and report — don't force the delete.**

- `EnactedBanner.tsx` — folded into the weekly band (HO 244). Confirm no other surface mounts it.
- `ReportSnapshot.tsx` — the inline snapshot, replaced by the weekly band. **Critical check:** confirm the READ FULL destination (the report page route under `/reports`) is its own component/route and does NOT import `ReportSnapshot.tsx`. If READ FULL renders through `ReportSnapshot`, do NOT delete it — report back instead.
- `StageKey`, `ColorKeyStrip` — the distributions merge dropped the legend/key row (HO 244). Confirm unused.

Then remove their dead CSS — `.enacted-banner*`, `.home-snapshot*`, `.home-panel-stage` / `.home-panel-topic`, and the stage-key / color-key-strip rules. Grep each class across the tree before deleting; leave anything still referenced.

**Commit:** `refactor: remove components + CSS orphaned by the dashboard reflow (HO 245)`

## Commit 2 — competitive cards to a single full-width row

The 4 toss-up cards render 2×2. At full width each card spans roughly half the container and reads sparse — a card sized for the old 44% column floating in a ~950px box. Re-row so the cards sit near their designed width:

- 4-up across the full width on wide desktops; fall back to 2-up below a breakpoint so the cards never crush on a narrower laptop. Balanced rows in both states (4 or 2, not a 3+1 wrap). Card width target ~360–480px; exact breakpoint to your pixel judgment.
- The road-to-November timeline stays full-width above the cards, unaffected.
- Senate/House card internals unchanged — this is the grid only.

**Verify:** cards in a single row at wide desktop width with content no longer sparse; the 2-up fallback at the narrower breakpoint; timeline unaffected; no horizontal overflow. Mobile is a separate pass — note the breakpoint behavior, don't solve it here.

**Commit:** `feat: competitive race cards to full-width responsive row (HO 245)`

## Constraints

- No new tokens. No data-layer, cron, or card-internal changes beyond the grid.
- Named `git add` per commit, eyeball the diff before each.
- Stale `.next` rule; `npm run build` clean.

## Ship report

Per-component delete confirmation, and explicitly whether READ FULL's report route survived the `ReportSnapshot` deletion. Cards-in-a-row verified at wide desktop with the 2-up fallback breakpoint noted. Build clean.
