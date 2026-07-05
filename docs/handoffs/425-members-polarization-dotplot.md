# HO 425 — /members polarization dotplot strip (ideology, ship 2 of 3)

> Self-claim the next free number: `ls docs/handoffs/ | sort -V | tail`. Body assumes 425 (424 = the dashboard band, in flight; 423 = the ideology-surfaces design handoff). If HEAD moved, renumber.
>
> **Lands after HO 424.** The band introduces the strict-D/R median method; this strip reuses it so the two surfaces show the same numbers (see Median consistency). If 424 hasn't merged when you start, still pin the identical method below.
>
> **Code only. Docs deferred** to a follow sweep (the SKILL strip + query entry, roadmap note, backlog tombstone; the stale SVG-inventory line was already flagged in 424's deferred docs). Don't touch `docs/` or `SKILL.md`. Spec-driven: propose the plan, wait for review, show the diff, no auto-commit. `git add` by explicit pathspec, ancestry re-checked before push.

Implements the approved design (mockup: `ideology-cut1-members-insitu.html`): a compact ~180px DW-NOMINATE `dim1` dotplot at the top of `/members`, showing the population shape and the party gap before you scroll into the browser. Runs on the 119th `member_ideology` already synced, so **no data gate**. Confirmed design calls: **180px height**, reads the **live chamber toggle only**, **strict D/R medians**.

## Median consistency (the pin — same method as the band, not the mockup's)

The mockup folds independents into the D median (`p !== 'R'`). **Don't.** After the Kiley round the rule across every ideology surface is: medians over `party IN ('D','R')` strictly; independents (`party = 'I'`) plot as dots but sit in neither median. Registration is not caucus.

- If HO 424 left a shared `median()` helper, reuse it. If not, use the identical method inline: sort ascending, odd length → middle element, even → mean of the two middle. Same method in both places means the strip's ticks and the band's rails agree by construction, whether or not the code is shared.

## Query

`getIdeologyStrip()` in `lib/queries.ts` — the scored population for the cloud. Join `member_ideology` to `members`, return every row with `nominate_dim1 IS NOT NULL`: `{ bioguideId, name, party, chamber, dim1 }`. ~552 rows, no index (small-table judgment, as HO 421/424). Caching mirrors the band / `getMemberIdeology` manual-sync pattern (daily TTL, tag `member-ideology`; nothing flushes it on a cron).

Return the full both-chamber population once; the component filters to the live chamber scope and derives the two medians client-side from exactly the dots it draws (guarantees cloud-and-tick consistency). If `/members`' chamber toggle is a server param and scoping server-side fits the existing pattern better, do that instead — either way, only the chamber toggle drives the strip.

## Component — hand-rolled SVG dotplot (`BillsTimeSeries` family)

Coordinate space is `dim1` × stack height, so this is SVG, not the divs+CSS rail. Geometry from the mockup:

- viewBox `0 0 1140 132`. `L=18, R=18, T=6, B=24`. `xs(v) = L + ((v+1)/2)*iW` on a fixed −1..+1 domain. **No 2% inset here** — the inset is the band/hub rail rule; the cloud runs full width.
- **Wilkinson dotplot:** `binw = 0.02`; stack per bin; `step = min(4, (iH-4)/maxStack)`; `rDot = max(1.4, min(1.9, step*0.48))`. Dots party-colored (`--party-*`), `fill-opacity 0.82`, sorted R→I→D within a bin.
- **Median ticks:** D and R (strict, per the pin), drawn `base+2 → T+4` with the party letter label. An `↑ empty center` annotation at the gap midpoint.
- **x-axis:** ticks at −1/−0.5/0/0.5/1, `LIBERAL` / `CONSERVATIVE` end labels, emphasized 0 line, baseline rule.
- **Interaction:** hover a dot → tip with the member's **name** + `dim1` + `→ hub` hint (the mockup omits the name; include it on real data). Click → `/members/[bioguideId]`.

## Placement

Strip at the **top of `/members`**, above the filter bar and the two-pane browser. ~180px total: header (~26px) + SVG (132px) + footer (~14px). Amber left accent (`box-shadow: inset 2px 0 0 --accent-amber`). Drop the mockup's `PROPOSED` badge.

- **Header:** `POLARIZATION` (amber) + descriptor `every scored member on dim1 · party medians ticked` + a `how it's scored →` affordance on the right. Wire that to an existing methodology/about anchor if one exists; otherwise a tooltip naming DW-NOMINATE `dim1` from Voteview roll-call analysis. Don't invent a page.
- **Footer:** `N scored · D med −0.37 · R med +0.49 · gap 0.86 · HOUSE/SENATE toggle below rescopes this` — the scoped counts, medians, and gap, plus the hint that the chamber toggle drives it.
- The chamber toggle (ALL/HOUSE/SENATE) rescopes the strip. **Party / state / sort / search do not** — a party filter would collapse the two-hump comparison the strip exists to show.

## SVG-primitive note (don't extract yet)

This is the third live hand-rolled SVG chart (with `BillsTimeSeries` and `CommitteeActivityChart`). Per the design cross-cutting call, the shared scatter scaffold gets extracted at the **fourth** chart (the over-time surface, ship 3). **Ship this strip standalone; do not extract the primitive here.**

## Deferred (don't do here)

- Docs to a follow sweep (SKILL strip + `getIdeologyStrip` entry, roadmap note, backlog tombstone).
- Ship 3 (the over-time chart) is a separate handoff and is data-gated: it needs per-Congress D/R chamber medians from `HSall_members.csv` synced first, a data-layer handoff that doesn't exist yet.

## Commit discipline

Propose the plan (the median-method source + the chamber-scoping approach). One code commit: `getIdeologyStrip` + the strip component + its SVG/CSS + the `/members` wiring. Explicit pathspec, ancestry re-checked before push. Eyeball at 180px: the two humps, the strict-D/R ticks, the gap annotation, hover name+hub, click-through, and the chamber toggle rescoping (and confirm party/sort don't). Show the diff, no auto-commit.

## Report back

The rendered strip at 180px (both humps, ticks, hover, click-through, toggle behavior), whether you reused a shared `median()` or pinned it inline, the diff, and confirmation `docs/` and SKILL are untouched.
