# HO 241 — dashboard redesign: masthead, two-column reflow, distributions merge

Confirm the next free number before saving: `ls docs/handoffs/ | sort | tail`. Body assumes 241.

## What this is

The structural core of the approved FULL redesign spec (`dashboard-2col.html` et al). The current dashboard is the prior layout: races in the right column, stage and topic as separate boxes, a prose masthead, the weekly band in the header beside a standalone ENACTED banner. The target moves races to full-width, merges the two distribution charts into one tabbed panel, turns the masthead into a stat readout, and relocates the weekly band below races with the enacted banner folded in.

This handoff does only the parts that are pure UI/layout — no new data sources. Two data-dependent pieces are split out (see below) because each needs a data layer plus an egress probe, and scoping them before the data is confirmed banks premises Code would get wrong.

Three commits, each commits clean. Read each live file before editing. The `/mnt/project` copy this was scoped against lags the repo — grep the live dashboard mount for the actual box structure, don't trust a planning-doc picture of it.

## What is DEFERRED — do not build these here

- **Weekly-band enrichment.** Per-count deltas (▲/▼ vs last week), the count→sparkline hover popovers, the event→stage-move hover popovers, the 6-week series. Needs a per-metric weekly historical series that may not exist yet. Own handoff after this lands and you report what weekly history is queryable.
- **Tape → static + econ/prediction symbol swap** (`S&P / NASDAQ / 10Y / CPI / UNEMP / SHUTDOWN ODDS / FED CUT / WTI`). CPI/UNEMP need FRED series added; SHUTDOWN ODDS/FED CUT need Kalshi market wiring — each probed from Vercel egress before any code, per the FRED-blocked / FMP-v4-deprecated / Stooq-dead lessons. The tape stays the current single scrolling line with its HO 234 closed-state + STALE precedence untouched in this handoff. The static layout assumes the trimmed set, so static-without-the-swap would only get restyled twice; both happen together in the tape handoff.

## Resolved premises (don't re-derive)

- **Breaking is already a box** (box 7), not a marquee. No marquee work — that decision shipped.
- **Stage stays bars, topic stays treemap.** Both charts already exist (boxes 8 + 10). Commit 3 wraps them in a tab container; it does NOT rebuild either chart. (Stage stays bars because committee is ~91% of bills and president is 0 — a treemap is one blob plus unreadable slivers, already demonstrated and rejected.)
- **Brand name is "Congressional Terminal"** (resolved this session; was "Congress Terminal").
- **COMMITTEE reads RED in the masthead readout but stays CYAN as a bar** in the distributions panel. Accepted mismatch — do not reconcile.
- Tape is a single scrolling line with HO 234 closed-state. Leave it alone (deferred tape handoff owns it).

## Phase-1 live verifications (do these before building; report each in the ship report)

1. **Dashboard mount + current box layout.** Which file/component renders `/`, how the columns and boxes 4–10 are arranged today. Reflow off the live structure.
2. **Masthead count predicate — known-incoherent, must be pinned here.** Observed across surfaces: 16,193 "BILLS TRACKED" (dashboard) vs 15,179 / 15,398 "BILLS" (inner pages); the spec example says 16,290; the stage bars sum to ~16,044. The readout cannot ship on a total that disagrees with itself. Read the count predicate on BOTH the dashboard and an inner page. If they differ, align to one predicate (cheap path) or, if aligning is non-trivial, state the exact two predicates and cross-reference the queued masthead-coherence diagnostic — but do not introduce a fourth conflicting number. The readout's four segment counts (committee / floor / other / enacted) come from the same bill set as its total.
3. **NEW THIS WEEK feed tab.** The spec feed is MOVERS / TOP STALLS / NEW THIS WEEK; the current feed shows only MOVERS + TOP STALLS. Confirm whether the third tab exists. If it doesn't, this handoff does NOT build it — note it for follow-up. The reflow doesn't depend on it.
4. **Weekly-band current-week counts** (NEW BILLS / STAGE TRANSITIONS / IN GOV-OPS / ENACTED, this week). If cheaply queryable, build the static metrics line (commit 2). If not, relocate the existing weekly-report teaser into the slot as a stopgap and flag the metrics line for the weekly handoff. Event callouts (top stage-movers of the week, e.g. `S 162 -> FLOOR`) depend on `stage_transitions` accrual — if it's still thin, omit them (degrade), don't fabricate.

## Commit 1 — masthead finalize

End state, line 1: brand `Congressional Terminal:\119TH\Dashboard>` in mono 20px, `word-spacing: -6px` to tighten the "Congressional Terminal" gap, the `:\` `\` `>` glyphs in amber (accent-amber/-bright). Baseline-aligned after the brand, the stat readout at 14px:

`{total} bills tracked · {committee} in committee · {floor} on the floor · {other} other chamber · {enacted} enacted`

Number color tokens (fixed): total = party-dem (blue), committee = party-rep (red), floor = accent-amber-bright, other chamber = stage-other (`#f59e0b`), enacted = stage-enacted (green). Blinking amber cursor at line end, desktop only. The numbers come from the predicate pinned in Phase-1 check 2.

Line 2, under the brand (NOT pinned far-right anymore): `LAST SYNC {h:mm} ET` in 11px text-dim. While here, don't introduce a third stamp variant — the ledger already flags "LAST SYNC 4:03 AM CT" (dashboard) vs "UPDATED 3:03 AM MT" (inner). Match the dashboard's existing label/timezone or align both if it's a one-liner; otherwise leave inner pages alone and note the divergence.

Remove the prose lead-in (the "Congress saw 64 stage transitions…" paragraph) — the stat readout replaces it. **Before deleting:** confirm that three-sentence weekly summary still renders somewhere (the weekly report behind READ FULL). If the masthead is the only place it renders, don't orphan it — say so and stop, we'll re-home it first.

Nav: text-only, `\` path prefixes, bracket active state `[ \DASHBOARD ]` amber-bright, three divider groups — `[\DASHBOARD] | \BILLS \MEMBERS \RACES \PATTERNS | \REPORTS \WATCHLIST` — 14px.

Type scale across the header: title 20 / readout + nav 14 / tape + sync 11.

**Commit:** `feat: masthead stat readout + brand rename + nav groups (HO 241)`

## Commit 2 — layout reflow

- **Header** full width: masthead → tape → nav. Tape unchanged.
- **Races** (box 6) → full width, directly under the header. Currently right-column-top; move to full-width-top. Both tabs (COMPETITIVE / PRIMARIES) move with it; no internal card changes.
- **Weekly band** → full width, directly under races, **divider rule above it**. One line. Fold the ENACTED banner (box 5) into it as the `● {n} ENACTED · S {n}` segment and **remove the standalone box-5 banner**. Static metrics line this handoff (no deltas):
  `WEEK OF {date} | ● {n} ENACTED · S {n} | {n} NEW BILLS | {n} STAGE TRANSITIONS | {n} IN GOV-OPS | {event callouts} | READ FULL ->`
  Event callouts conditional on `stage_transitions` accrual (omit if thin). Per Phase-1 check 4, if current-week counts aren't cheaply queryable, stopgap = relocate the existing report teaser + the enacted segment into this slot and flag the metrics line for the weekly handoff.
- **Two-column body** below the weekly band: LEFT ~56% holds the breaking box (7) then the merged distributions panel (from commit 3); RIGHT ~44% holds the feed (9). Columns are natural height — the feed previews ~4-5 rows then `[ + N MORE -> ]` so the two columns finish near the same line without stretching the charts.

**Commit:** `feat: full-width races + weekly band relocate + two-column reflow (HO 241)`

## Commit 3 — distributions merge

Merge box 8 (stage) and box 10 (topic) into ONE tabbed panel in the left column. Tabs: `STAGE DISTRIBUTION | TOPIC DISTRIBUTION`, active state = amber underline.

- STAGE pane = the existing horizontal sqrt-scale bars (INTRO, COMMITTEE, FLOOR, OTHER, PRESIDENT, ENACTED), stage-colored, label + value, **no legend row** (bars self-label). COMMITTEE stays cyan here.
- TOPIC pane = the existing squarified treemap (`d3.treemapSquarify`), topic-colored cells (reuse `topic-colors.ts`), cell shows topic + count when it fits.
- Panel is a **fixed compact height (~230px content)** so the bars stay dense and the tab swap doesn't jump. The treemap redraws to the panel's actual width × height on tab activation.

This is a container + height lock + tab wiring reusing both existing chart components. Not a rebuild of either chart.

**Commit:** `feat: merge stage + topic into tabbed distributions panel (HO 241)`

## Constraints

- **No new tokens.** The only new token in this arc (`--ticker-closed`) already landed in HO 234. amber = accent-amber/-bright; party = dem/rep; stage/topic palette unchanged.
- Mono for labels / IDs / counts / glyphs; UPPERCASE section labels.
- Static except instant hover/highlight states. No new motion. The tape's existing scroll is untouched (deferred tape handoff).
- Named `git add` per commit, eyeball the diff before each.
- Stale `.next` rule: on these UI ships, verify the stylesheet asset loads (no 404 on `layout.css`); `rm -rf .next` + restart if the dev server's been up a while. `npm run build` clean at the end.

## Ship report

Report the four Phase-1 verifications first: dashboard mount structure; the count-predicate decision (which predicate, and whether inner-page counts now agree or are flagged); NEW THIS WEEK tab existence; weekly-metrics availability (metrics line built vs stopgap teaser, and why). Then confirm: masthead renders the stat readout with an internally-coherent total; races is full-width; weekly band is below races with the enacted segment folded and box 5 removed; distributions merged into the tabbed panel at fixed height with no swap jump; the two columns finish near the same line. Stylesheet loads; build clean.
