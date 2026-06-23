# HO 298 — B6 stage bar

Second B6 slice. Replace the expanded row's current stage Pipe with the mock's stage bar: dated nodes, colored connectors, and a current-node treatment that pings, parks, or completes depending on the bill's state. Spec is b6-stage-bar.html plus the parked state in b6-tabs-span.html.

The probe found a 6-node Pipe already (done/current/todo, current glows). This upgrades it.

## The bar

Six nodes in order: INTRO, COMMITTEE, FLOOR, OTHER CHAMBER, PRESIDENT, ENACTED. Stage colors from the existing stage palette (--stage-introduced #94a3b8, committee #06b6d4, floor #fbbf24, other-chamber #f59e0b, president #fb923c, enacted #10b981).

- Reached nodes: filled dot in the stage color, no border. Label --text-muted below.
- Future nodes: hollow dot (transparent, 1.5px --text-dim border). Label --text-dim.
- Connectors between nodes: 2px; filled with the next node's stage color if that next node is reached, else --border-strong.
- Dates: show a date under INTRO (the introduced date) and under the current node (the date it reached that stage, or the latest-action date if that's what's available). Other nodes get no date, matching the mock.

## Current-node state — three cases

- Enacted (terminal): the ENACTED node is solid green with a glow, no ping. Finished, not moving.
- Stalled: if the bill meets the stale criteria (the getStaleBills threshold, 60+d since last action), the current node is "parked" — solid stage color with a static glow, no ping.
- Moving: otherwise the current node pings — solid stage color, glow, plus the expanding ping ring (the keyframe scaling ~1 → 2.6, opacity .5 → 0, ~2.4s). Label and date in the stage color.

The ping is a flagged motion exception, same justification as the blinking terminal cursor; it's only on genuinely-moving bills, which is why stalled bills park and enacted bills sit solid.

## Notes

- Determine moving/stalled/enacted from the bill's data (enacted flag, days-since-last-action against the stale threshold), not the tab, so it's correct on any tab.
- The b6-stage-bar.html and b6-tabs-span.html mocks aren't in the repo; this spec is the build target. Worth committing the B6 mocks to docs/design so the remaining slices reference them.

## Ship

Commit (named `git add`). `git push`, `npm run verify:deploy`, served SHA === HEAD. Live-verify on /dashboard-v2: expand a MOVERS bill (current node pings in its stage color, intro + current dates show), a TOP STALLS bill (current node parked, static, no ping), and an enacted bill if one's in view (solid green, no ping). Connectors colored through the reached stages.
