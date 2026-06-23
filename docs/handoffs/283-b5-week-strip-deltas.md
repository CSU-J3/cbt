# HO 283 — B5 week strip: WoW deltas + read-full fix

From the approved B5 spec. Two changes to the existing week strip (the `WEEK OF ...` line between the box and the two-column body): add week-over-week deltas to the current metrics, and fix the READ FULL target. The HEARINGS metric and the hover popovers come in 284; this handoff is the deltas and the link.

Locate the week-strip component and its metric query (grep). It currently computes this week's ENACTED, NEW BILLS, and TRANSITIONS.

## 1. Prior-week aggregates + deltas

For each current metric (ENACTED, NEW BILLS, TRANSITIONS), compute the prior week's value alongside this week's, using last week's date bounds, so each can show its week-over-week change. Add the prior-week aggregate next to the existing this-week one.

Render the delta after each metric's value + label: a small arrow plus the change vs last week. ▲ in --up green for an increase, ▼ in --down red for a decrease, dim ±0 for no change. Reuse the tape's up/down tokens so the directional color matches.

Keep the strip one thin line.

## 2. Read-full target fix (audit #8)

The READ FULL → link currently points at a stale report. Fix it to the current week's report. Keep it --accent-amber, brightening on hover.

## Constraints

- Strip stays a single row; no popovers in this handoff (that's 284).
- No new metric here; HEARINGS is added in 284.
- Don't disturb the existing inline content on a metric (e.g. the enacted bill reference); just add the delta.

## Ship

Commit the deltas and the link fix separately (named `git add`). `git push`, `npm run verify:deploy`, served SHA === HEAD. Live-verify: each metric shows a correct ▲/▼/±0 delta vs last week, the colors match the tape convention, and READ FULL lands on the current week's report. If a metric's prior week happens to equal this week, confirm the ±0 dim state renders.
