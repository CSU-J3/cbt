# Home dashboard cleanup

Three-column grid below the header (1.2fr bubbles / 1fr activity / 1fr breaking). Drawer pattern dropped, bubble and funnel clicks rebase the dashboard in place. Title 32px, legend boxed in top-right, hover tooltips on every abbreviation.

## Blocks (top → bottom, left → right)

Header area, two children. Left side: title `Congress Terminal:\>` at 32px monospace, `:\>` glyph in `--accent-amber`; lead beside it in sans-serif 13px wrapping in remaining width; subhead below in 11px `--text-dim`. Right side: legend box, ~240px wide, bordered and padded to match the panel chrome, four rows (STAGES / TOPICS / PARTIES / ACCENT), each row = 52px label column + indicators that wrap inside the box, no overflow past the box edge.

Top nav (5 items): DASHBOARD active, FEED, MEMBERS, PATTERNS, WATCHLIST. 14px text, 10px vertical padding, 16px icons, active state = `--accent-amber-bright` text + 2px amber bottom border. GroupTabs row hidden on DASHBOARD (it's a top-level page, not a group).

ActiveFilterStrip (existing component): shows below nav when any filter is active. Hidden otherwise.

Three-column grid:

- Col 1: two stacked panels. STAGE DISTRIBUTION on top (220px fixed height) = bottleneck funnel, sqrt-scaled centered horizontal bars in pipeline order (INTRO → COMMITTEE → FLOOR → OTHER → PRESIDENT → ENACTED), stage label left, count right. PRESIDENT row renders at min-width (~4-6px) even at count 0. TOPIC DISTRIBUTION below (flex-1, min-height 320px) = existing d3-pack bubble cluster.
- Col 2: ACTIVITY / TOP STALLS tabs. Existing row pattern. `+ N MORE →` expander.
- Col 3: BREAKING · LAST 72H. Existing row pattern. Vertical column shows ~8 rows comfortably at laptop height.

## Interactions

- Stage funnel row click sets `?stage=<id>`. Topic bubble click sets `?topic=<id>`. Re-click clears that dimension.
- Selections compound (`?stage=committee&topic=gov` = intersection).
- ActiveFilterStrip surfaces active filters with `× CLEAR` and the existing `VIEW IN /FEED →` link.
- ACTIVITY rebases (count + rows) to the filtered slice.
- BREAKING rebases (count + rows) to the filtered slice. New behavior, currently BREAKING ignores filters.
- STAGE funnel: selected row bar gets `--accent-amber-bright` border, siblings drop to ~40% opacity. When TOPIC is selected, funnel counts rebase to that topic's slice.
- TOPIC bubbles: selected bubble gets `--accent-amber-bright` border, siblings drop to ~40% opacity. When STAGE is selected, bubble sizes rebase to that stage's slice.
- Lead is corpus-wide always, never rebases (per HO 57).
- No drawer. The existing drawer component and its query retire. `/feed` already handles "all matching bills" via the `VIEW IN /FEED →` escape.

## Hover tooltips

Custom CSS pattern: dark bg, 1px amber border, monospace 11px, positioned below the element where space allows, above where it doesn't. Native `title` attribute is the fallback if the styled version proves fragile.

Where to add:

- Legend indicators: full names for stages, topic groups, parties, AMBER.
- Topic bubbles: full topic name + exact count + percentage. e.g. `Government Operations · 4,928 bills · 31.0%`. Critical for small bubbles where labels and counts don't render inline (BDGT, ELEC, OTHR).
- Stage funnel rows: full stage name + count + percentage + click affordance. e.g. `Committee · 14,476 bills · 91.0% of corpus · click to filter`.
- Activity row bill ID (left rail): full bill title.
- Activity row stage pills (`INTRO · 2W`): expanded as `2 weeks in Introduced`.
- Activity row topic chips: full topic name.
- Breaking row bill ID: full bill title.
- Breaking row suffix `[+N]`: `N additional related articles`.
- Panel headers:
  - ACTIVITY → `Bills with stage transitions in last 7 days`
  - TOP STALLS → `Bills stuck longest at current stage`
  - BREAKING · LAST 72H → `Recent news linked to tracked bills`
  - STAGE DISTRIBUTION → `All bills by current legislative stage`
  - TOPIC DISTRIBUTION → `All bills by topic tag`

Skipped as self-evident or low value: top nav items, title, subhead, party brackets `[D-MN]` and state codes, star icons.

## Constraints

- Viewport target: 1440×900 minimum (typical laptop). Header + nav + grid fit above the fold without page scroll.
- Static. No motion, no transitions, no scroll animations.
- All existing CBT design tokens, no new color tokens.
- Legend box content wraps inside its border, no overflow at viewports ≥ 1280px wide. At narrower widths the legend flex-wraps below the header.

## Open question (follow-on, not this handoff)

Cumulative funnel metric, an alternative data source for the stage chart that would produce a true monotonic narrowing shape rather than a bottleneck. This handoff uses the current-state snapshot data (where bills sit right now).
