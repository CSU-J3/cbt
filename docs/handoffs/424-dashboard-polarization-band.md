# HO 424 — Dashboard polarization band (ideology, ship 1 of 3)

> Self-claim the next free number: `ls docs/handoffs/ | sort -V | tail`. Body assumes 424 (422 = the Kiley/ideology sweep, `ff33f87`; 423 = the ideology-surfaces design handoff). If HEAD moved, renumber.
>
> **Code only. Docs deferred** to a follow sweep (SKILL band + query entry, roadmap note, backlog tombstone, and the stale-SVG-inventory fix noted below). Don't touch `docs/` or `SKILL.md`. Spec-driven: propose the plan, wait for review, show the diff, no auto-commit. `git add` by explicit pathspec, ancestry re-checked before push.

Implements the approved design (answers HO 423): a full-width dashboard band showing chamber polarization on DW-NOMINATE `dim1`. First of three ideology surfaces; the dotplot and the over-time chart follow (both noted at the end, the latter data-gated). The band is the lightest of the three: it reuses the HO 421 positioned-marker-on-track idiom (divs + CSS, `--ideology-axis-*`), not hand-rolled SVG, and runs on the 119th data already synced.

## Verify first: the median source (don't assume query reuse)

The design spec says the band reuses "the four medians `getMemberIdeology` already computes." **Check that before building.** `getMemberIdeology` (HO 421) is member-scoped: it returns `demMedian` / `repMedian` for the *member's* chamber only, a pair, not all four. The band needs all four (House-D, House-R, Senate-D, Senate-R) independent of any member, plus the scored / unscored counts.

- If the check confirms `getMemberIdeology` exposes only the member's-chamber pair (likely), add a small dashboard query `getPolarizationBand()`: over `member_ideology` joined to `members`, compute the D and R `nominate_dim1` medians for each chamber app-side (the honest-center method from HO 421: sort plus middle, not a SQL `AVG`), plus `scored` and `unscored` (`nominate_dim1 IS NULL`) counts. Return `{ house: {dem, rep, gap}, senate: {dem, rep, gap}, scored, unscored }`. Two ~535-row scans, no index (the small-table judgment, as in HO 421).
- Caching: mirror `getMemberIdeology`'s manual-sync pattern (daily TTL, tag `member-ideology`); nothing flushes it on a cron.
- If the check somehow shows all four are already available cheaply, reuse and skip the new query. Report which path you took.

## The band (design spec)

Full-width band **below the battlefield block** on the v2 dashboard. Reuses `--ideology-axis-*` at chamber-aggregate scale (two median ticks per rail, no per-member marker), plus a new amber gap line. Shorter than the battlefield block above it. Static, desktop-first, existing tokens only.

- **Header** (`--bg-panel`): `POLARIZATION · 119TH` (amber) plus the descriptor `party median distance on dim1`. No control (it's aggregate).
- **Two rails, HOUSE over SENATE.** Per-rail grid `[64px label + D/R numeric] [1fr track] [96px GAP]`.
- **Track:** fixed −1..+1 domain, **2% inset** (the HO 421 rule: `pos = 2 + ((v+1)/2)*96`). Dim center tick at 0. A D median tick (`--party-democrat`) and an R median tick (`--party-republican`). An **amber dimension line** (`--accent-amber`) spanning the two median ticks, the gap made visible.
- **Per rail, right:** the gap magnitude in tabular mono, `--accent-amber-bright`, ~19px, the hero figure. **Left sub:** `D −0.38 · R +0.50` low-key numeric.
- **Shared axis** under both rails, labeled once: `LIBERAL −1` / `CONSERVATIVE +1`.
- **Footer:** `N scored · N unscored (too few votes) · Voteview 119th` plus a `member ideology →` link to `/members`.

New CSS follows the HO 421 `--ideology-axis-*` convention in `app/globals.css`. The aggregate rail and the amber gap line are the new pieces; tick positioning is the 421 rule.

## Two design leans to surface in your plan (Corey signs off in review)

Design leaned but left open:

- **Placement:** a full-width band directly under the battlefield (design's lean, build this) vs folded into the battlefield block as a second row under the seat axis. The `DistributionsTabs` third-tab option is ruled out (bill-corpus content, would underfill its ~230px height). Put the placement in your plan so Corey can flip it before you build.
- **Headline number:** two per-rail gaps only (design's lean, build this) vs an added single polarization figure above them.

Build the leans; call both out in the plan.

## Page wiring

Locate the battlefield block in the v2 dashboard composition; insert `<PolarizationBand … />` directly below it. Fetch `getPolarizationBand()` in the dashboard's existing server-fetch path.

## Deferred (don't do here)

- **Docs** to a follow sweep: the SKILL band + `getPolarizationBand` entry, the roadmap note, the backlog tombstone. The design chat also flagged **stale SVG-inventory drift**: SKILL ~line 1489 still lists `MemberProductivityScatter` in the hand-rolled-SVG idiom inventory, but HO 328 deleted that chart. Fold the correction into the same sweep, since the "extract a shared SVG scatter primitive at the fourth live SVG chart" trigger depends on an accurate count, and the dotplot (next surface) is one of those charts.
- **Surface 2 (dotplot)** and **Surface 3 (over-time, data-gated)** are separate handoffs.

## Commit discipline

Propose the plan (the median-source check plus the two leans surfaced). One code commit: the query + a `PolarizationBand` component + the `--ideology-axis-*` / band CSS + the dashboard wiring. Explicit pathspec, ancestry re-checked before push. Eyeball the rendered band (both rails, the gap line, the counts). Show the diff, no auto-commit.

## Report back

Which median path you took (reuse vs the new query), the rendered band, which placement and headline the plan used, the diff, and confirmation `docs/` and SKILL are untouched.
