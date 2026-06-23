# HO 317 — Unified bill expanded panel (dashboard hover + /bills click)

Confirm the next free number before saving: `ls docs/handoffs/ | sort -V | tail`. Body assumes 317; renumber if taken.

Design Part 2 lands the expanded panel and unifies the row across both surfaces. The collapsed row is done (sponsor line, sans title, shared `TopicChips`). This builds the expanded panel and the interaction split.

**The goal mirrors the chip:** ONE shared expanded-panel component, rendered identically on both surfaces, differing only in how it's triggered. Today the dashboard has a rich expand (from the v2 movers + stage-bar + sponsor-card work) and /bills has a minimal `ExpandedPanel` (introduced + last-action + summary + buttons). Unify them into one. Do **not** leave two divergent expands — that's the exact trap 316 just dug us out of for the topic chip.

**Visual source of truth: `expanded-panel-unified.html`.** This doc owns the data wiring, the degradation rules, the shared-component structure, and the interaction model. Where they differ on visuals, the mock wins.

## Verify first — premises + data availability (report gaps, don't invent)

Confirm the current shape of both expand implementations so you unify rather than fork. Then confirm each data source below. **For any field whose source you can't confirm: omit it — don't ship a zero or broken row — and list it as a gap in the report.** Don't parse fragile action text to fake a field.

- **/bills title font:** confirm `BillRow`'s collapsed title is already sans (from the Mock A pass). If it's still mono, fold the one-line swap in here.
- **Stage bar:** a stage bar already shipped on the dashboard expand. Confirm its node logic against this spec's current-node states (below) and reconcile, then lift it into the shared panel so /bills gets the same one.
- **COSPONSORS count:** SKILL says cosponsors were skipped. Verify a count is actually stored. If absent → omit the COSPONSORS row, flag it.
- **bill→meetings reverse lookup** (HEARING slot): `meeting_bills` exists from the hearings work. Confirm a bill→upcoming/live-meeting query exists or is a clean add. If it needs non-trivial new query work or the meeting-selection logic is ambiguous → **omit the HEARING slot and flag it for a dedicated follow-up.** Don't let the riskiest slot block the panel.
- **Sponsor district** (the `[D-NV-4]` bracket): schema has state, not district. If district isn't stored → render `[D-NV]`, no district segment.
- **bill→committee referral** (the COMMITTEE meta link + "Referred To · Nd"): confirm the linkage comes from the committee data layer, not only `latest_action` text. If only action-text → render the committee name unlinked, or omit the link.
- **Proven available** (existing pages render them — don't re-verify): summary, `news_mentions`, sponsor name, committee name, introduced date, latest action, stage.

## The shared expanded panel (build once, both surfaces render it)

Background `--bg-row-hover`. When open, the whole panel sits inside a 1px `--accent-amber` border, 3px radius, slightly inset from the feed edges (the dark gutter — mock uses `margin:5px 7px` on the open row). Full-width stage bar on top, then a two-column body. Applies on both surfaces (dashboard in its hover state, /bills in its expanded state).

**Stage bar** — dot-and-line, six nodes: INTRO · COMMITTEE · FLOOR · OTHER CHAMBER · PRESIDENT · ENACTED. Reached node = filled stage color; future = hollow ring; connector colored once the next node is reached. Dates under INTRO and the current node, current date in stage color. Current-node state comes from the **bill**, not the tab:
- enacted → solid green, no pulse
- stalled (≥60d with no action, the `getStaleBills` criteria — derive from the bill's own `latest_action_date` + non-terminal stage, no new query) → parked static glow, no pulse
- otherwise → moving → pulsing glow ring. This is the one shipped motion exception; lift the mock's `nodepulse` keyframes and the `prefers-reduced-motion` override that kills it.

**Left column** — summary (sans), then three slots in this order:
1. **HEARING** — conditional, leads when present, omits entirely when none (or when deferred per the verify step). Inline, no sub-hover: pip + committee link (→ `/committee/[code]`); then `TYPE · STATUS · DATE · TIME ET · ROOM`; then `WATCH livestream ↗` + the hearing's `AGENDA` bill chips. Pip dim = scheduled, green = LIVE.
2. **RELATED NEWS** — always shown. Empty state `NO RELATED NEWS`. From the bill-keyed `news_mentions`.
3. **ODDS** — always shown. Empty state `NO PREDICTIONS MADE`. There's no bill↔market join today, so this reads empty on nearly every bill; the populated form waits on that data. Render the empty state, don't build the join.

**Right column** — boxed meta card (`--bg-panel` bg, `--border-strong` border), hairline divider between every row:
- **SPONSOR** — natural `Rep./Sen. First Last` + a single party-state-district bracket, e.g. `Rep. Steven Horsford [D-NV-4]`, party-colored. Title from the chamber, name de-inverted from stored `Last, First`. No Last-First, no redundant trailing party-state. District only if stored.
- **COSPONSORS** — count. (Omit the row if not stored.)
- **COMMITTEE** — name as amber link (→ `/committee/[code]`) + dim `· Referred To · Nd`.
- **INTRODUCED** — date.
- **LATEST ACTION** — text + dim `· Nd`. This standardizes /bills' current "LAST ACTION" label to "LATEST ACTION."

Buttons: **FULL BILL PAGE** (primary, amber border) + **CONGRESS.GOV ↗** (secondary, dim border).

## Interaction model (the only behavior that differs by surface)

- **Dashboard: hover-to-expand.** CSS `:hover` reveals the panel; no URL state. Single-open is automatic (one row hovered at a time). This **replaces** the current click-expand on the dashboard. The panel must mount nested inside the hoverable row so moving the cursor into the panel keeps it open and its links reachable.
- **/bills: click-to-expand.** The existing `?expanded=` single-open with URL state, unchanged trigger. Keep the panel mounted as the existing sibling to the row (don't nest interactive content inside the row's `Link`).
- So the panel **contents** are one shared component; the **mounting + trigger** differ per surface. That's expected — don't force one mounting pattern on both.
- Both: sponsor, committee, topic-chip, watch/agenda links, and buttons are click-through and never toggle the row. Caret turns amber on expand.
- **Dashboard box height on hover:** the expanded panel is tall and the box holds a fixed collapsed-row count. Decide whether the box grows on hover or the panel is height-bounded; the mock grows inline. Pick one and flag it. (The collapsed-state fewer-rows-before-`[+ N MORE]` is already shipped — this is the separate hover-height question.)

## Constraints

- ONE shared expanded panel and ONE shared stage bar. No divergent per-surface copies.
- Static except the current-node pulse (off under `prefers-reduced-motion`).
- No new CSS variables; reuse tokens + `@/lib/topic-colors` (`--sans` exists).
- Graceful degradation: omit any data-less field or slot, never ship a broken/zero row, report every gap.
- Named `git add` per commit, eyeball each diff. Stale `.next`: stylesheet loads (no 404 on `layout.css`), `rm -rf .next` + restart if the dev server's been up a while. `npm run build` clean.
- Ship: `git push`, then `npm run verify:deploy` until served SHA === HEAD.

## Ship report

- Confirm ONE shared expanded panel — show both surfaces importing it from the same module, like the chip.
- Dashboard expands on hover, /bills on click; single-open both ways; links click-through; caret goes amber on expand.
- Stage bar: state which current-node state you exercised — name a moving bill that pulses, a stalled bill that parked-glows, an enacted bill that's solid-green no-pulse. Confirm `prefers-reduced-motion` kills the pulse.
- HEARING slot outcome: built (name a bill where it rendered) or deferred (and why).
- Every data gap you hit: cosponsors, district, committee link — what was missing and what you omitted.
- The dashboard box-height choice on hover.
- Confirm /bills collapsed title is sans. Build clean; verify:deploy SHA matches.
