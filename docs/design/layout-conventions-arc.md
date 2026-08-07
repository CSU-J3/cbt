# Layout conventions arc — C1–C8, the plan of record

**Supersedes `591-layout-conventions-arc.md` in full.** That document is referred to as "the HO 591 arc" in `docs/backlog.md:130`; the name survives as a cross-reference, the plan in it does not. Eleven of its factual claims and its phase order were falsified between drafting and execution. Nothing was ever built against it.

**Numbering.** HEAD `e8279c1`. `docs/roadmap.md` pointer: *"Also notes now run through HO 602."* Latest commits are HO 603 (Parts A–C + residual). **The arc starts at HO 604.** The old "591" anchor is twelve HOs stale — 591–603 landed in between. Roadmap remains authoritative; if its pointer has moved again, renumber from it and say so.

**Not in this arc:** Absence Watch. Its own probe (`scripts/diagnostic/absence-watch-588.ts`, `7ce1f0e`), its own R2/R3 fork recorded UNRESOLVED at backlog A1, its own thread. The mock shows it in place so the shell is designed around it. Do not build it here. It inherits these conventions when it lands.

---

## 0. What this arc is

The dashboard was audited at 2560px and had four defect classes. They are not dashboard defects — they're convention defects, and every other tab has them. Fix the conventions once, prove them on `/`, propagate.

**The convention set is the deliverable. The routes are where it gets applied.**

- **C1 — no far-right anchors in a row.** A row must not pin an element to its right edge while its content packs left. That gap is the stretching: a breaking headline whose timestamp sits 370px away, a miss-strip whose badge sits 470px away. Rows are flex, packed left; leftover width collects at the end where nothing reads it. Highest-yield rule in the set — every other convention is cheaper to apply once this lands.
- **C2 — type scales with the viewport.** Six root tokens, 12px → 13 @1600 → 14 @2000 → 15 @2400. **`rem`, not `em`** — em compounds through nesting and this stylesheet nests deeply. Row padding and fixed-size glyph strips step at the same breakpoints (deferred; see §2).
- **C3 — color carries meaning, not decoration.** One bright element per row: its title. Borders and color reserved for state and interaction. The movers feed carried five bordered or colored elements per row — boxed number, bright title, underlined party-colored sponsor, two or three outlined topic chips — roughly 120 competing objects down one column. Only **stage** is colored, because stage is what a reader scans for. This refines the HO 465–469 chip family rather than replacing it: chips stay for filters and interactive affordances, and become plain dim text everywhere they were labels.
- **C4 — empty states collapse.** A panel with nothing in it renders nothing, or one dim line — never a reserved box. The hearings week grid spent 475px on five equal columns, three reading NO MEETINGS, and got *worse* in recess.
- **C5 — no number appears twice on one screen.** The masthead read five counts and the stage funnel 240px below redrew the same five as bars.
- **C6 — density floor.** 12px base, rows ≥22px, full-width hover targets. A floor, not a target — past it, tightening costs legibility rather than saving space.
- **C7 — panels size to content.** `align-items: start`. No stretching a column to match its sibling's height. The funnel panel ran ~90px past its last bar purely to line up bottoms.
- **C8 — wide screens buy columns, not wider rows.** Past roughly 900px a row of text gains nothing from more width; it just pushes its right-hand element further away, which is C1 again. A max-width cap throws the monitor away. Add panes.

**Three of the eight have no instrument, by design.** C5 and C6 are **review rules** — enforced by a reader, not a script. C8 is **C1 seen from the other end**: a too-wide row presents as a C1 gap, and the second pane is how you make M1 reach zero without a max-width cap. So the audit prices four conventions, not eight, and the phases are done on M1/M2/M3/M4 reaching zero while C5 and C6 ride the eyeball pass. Stated here so it isn't discovered at the doc sweep.

**Reference implementations,** both committed to `docs/design/` (**not** repo root — that was wrong, and `mock-588-absence-watch.html` does not exist anywhere in the repo):

- `dashboard-layout-target.html` — the target for `/`.
- `layout-conventions-c1-c8.html` — the defect/fixed dictionary, for routes that look nothing like the dashboard.

The HO 590 mock is recorded at backlog:130 as **absent from disk, not merely untracked**. These two are one session from the same fate until HO 604 C0 lands them.

---

## 1. Phase order — inverted from the original, and why

The original put the audit at P0 and the type scale at P1. Reverse them.

The stated reason was that measurements taken at 12px go void once a 15px scale ships. That's overstated: whether a row pins an element right is *structural*, so the identity of offending rows survives a type change. The real reason is the **delta**. Baseline at 12px, remediate at 15px, and the improvement is the type change and the layout change tangled together — tangled in the flattering direction, since larger text closes gaps on its own. The arc is scored on M1 reaching zero, so the baseline has to be taken at the size the remediation happens at.

The original's own argument survives intact: it says do C2 before the *route work*. That still holds. It just also means before the audit.

| Phase | Scope | HO |
|---|---|---|
| **P1** | **C2 — the type scale.** Six tokens, 11 substitutions, identity commit then ladder commit. Plus C0: land both mocks. | **604** |
| **P2** | **The audit.** Read-only Playwright, M1–M4 + M5, run against the scaled site. HALT. | **606** — done, `e794194` + `94f6543` |
| **P3** | `/` rework to the target mock — the reference implementation of C1–C8 (+ `dashboard-classic` removal, per the corrected M6) | **608–610** — done |
| **P4** | Feed routes: `/bills` `/news` `/amendments` `/nominations` `/hearings` `/members` `/lobbying` `/trades` | **611–615** — closed, **two routes short of its own scope list**: `/amendments` and `/nominations` were never worked and never declined (§8) |
| **P5** | Detail routes: `/bill/[id]` `/members/[id]` `/vote/[id]` `/race/[id]` `/committee/[id]` | next |
| **P6** | Analysis routes: `/patterns` `/reports` `/trends` `/electoral` `/primaries` `/races` `/stale` `/changes` | next |
| **P7** | Doc sweep — conventions into SKILL.md as a design-system section, roadmap block, backlog:130 correction | **605** ran early (P1 only); re-runs after the route work |

Nav compaction and the WATCHLIST regroup move from the old P1 into **P3**. They're dashboard chrome, not a global concern, and bundling them with a site-wide type change gave one commit two revert reasons.

**There is no automated safety net.** The smoke crawl catches errors and console noise, not layout regressions — a route can go visually wrong and stay green. Every phase carries a per-route eyeball pass at 1440 and 2560. The audit exists to make that list short and specific instead of "look at everything."

---

## 2. P1 — C2, and what re-measuring it changed

Full spec in `docs/handoffs/604-type-scale.md`. The findings that reshaped it:

**The blast radius was understated ~1.8×.** 828 type sites, not the ~450 the original implied:

| surface | sites |
|---|---|
| `app/globals.css` | 416 |
| `app/welcome/landing.module.css` | 22 |
| `text-[Npx]` in `.tsx` | 355 |
| inline `fontSize` props | 35 |

HO 603 re-measured to 784 using `grep -roh "font-size:" app/*.css` — **that glob misses `app/welcome/landing.module.css`**, which is a directory down and writes `font-size:11px` without a space, so a regex tuned to globals.css skips all 22 and reports clean. Same shape as the HO 549/553 rule: a pattern that structurally can't match reads identical to nothing to match.

**Six values cover 714 of 828 sites.** 12px ×274, 11px ×189, 13px ×100, 10px ×62, 14px ×58, 9px ×30 across all surfaces. So C2 is **eleven find-and-replace operations**, not 828 edits. That is the entire reason it ships in a session rather than a sweep.

**Only 4 of 438 CSS `font-size` declarations sit inside a `@media` block.** The mobile overrides don't fight the scale. This was flagged as potentially blocking; measured, it isn't.

**§4 of the original is resolved: the scale goes global, not scoped.** The old fallback — scope C2 to a dashboard container if narrow widths look marginal — is unnecessary, because the substitution is value-preserving. `--fs-11: 11px` renders byte-identical to `font-size: 11px`, so the identity commit provably changes nothing at any width and the ladder is a separate, independently revertable commit. Scoping would also have produced a *partially* scaled dashboard, since it shares components with every other route.

**Deferred and named, not dropped:** C2's clause about row padding and glyph strips stepping at the same breakpoints, and the 114 one-off sizes (8 / 8.5 / 9.5 / 10.5 / 11.5 / 12.5 / 15 / 16 / 17 / 18 / 19 / 20 / 22 / 23 / 24 / 26 / 38) that stay fixed while the six scale. At 2400 a 20px heading sits over 15px body instead of 12px, so the hierarchy compresses at wide widths. Bounded, real, and a backlog item — not a bug to be filed later as a surprise.

---

## 3. P2 — the audit

> **ERA POINTER (HO 615). Everything in this section describes the audit as SPECIFIED, and its measurement definitions are v1's.** The instrument has been corrected twice since: **v2** at HO 610 (§3's own subsection at the end) and **v3** at HO 615 (**§7**). Read §7 for what the instrument actually measures today, §8 for where its falsification anchor lives, and the comparability rule in §7 before putting any two numbers from this arc in the same table. This section is kept unedited on purpose — it is the record of what was asked for, and rewriting it would erase the distance between the plan and the three things measurement changed about it.

**ONE file** under `scripts/diagnostic/`, named for the HO that builds it — `layout-audit-606.ts`. (Backlog:130 used to name `layout-audit-591.ts`; that was wrong and the HO 605 sweep corrected it. The roadmap pointer still wins at build time: if numbering has moved again, name the file for the HO that actually builds it and say so.) Playwright driven programmatically — `import { chromium } from "@playwright/test"`, already a devDependency, **do not add `playwright`**. Not a `.spec.ts`, not in `e2e/`, never in CI. Read-only.

This is the first *browser* probe in `scripts/diagnostic/` — every existing one is a raw `@libsql/client` SQL probe. `absence-watch-588.ts` is the header-comment model.

**Lift the skeleton from HO 604.** The computed-`fontSize` walk that 604's gates require — browser launch, `ct_seen` cookie, route list, viewport loop, per-element computed-style walk — is this script's bones with a different measurement function. 604 leaves it on disk uncommitted for exactly this.

### Target and burn

`npm run build && npm run start` on port 3000. **Not `next dev`** — the dev overlay and HMR alter the geometry being measured. **Not prod** — BotID withholds the markets tape from headless Chrome (`e2e/smoke.spec.ts:17-20`), and the tape is a C1 row. Reads hit prod Turso, so:

- Each route **twice at 2560×1440**, measure on hit 2 (the cache-hit path).
- **31 routes** — `smoke.spec.ts`'s `ROUTES` minus five of six `?stage=` variants (same shell, different feed; keep `?stage=committee`, a known `pageErr` site whose filter strip adds a row) and minus `/dashboard-v2` and `/committees` (redirects into targets already listed). **The arithmetic is 37 − 5 − 2 = 30, not 31 (HO 606).** **And three more aliases must be excluded on re-run, for the identical reason `/committees` and `/dashboard-v2` already are:** `/races` and `/primaries` **308 → `/electoral`**, `/members/pass-rate` **307 → `/members?sort=passrate`**. HO 606 crawled all three and measured the same page twice more, inflating the site-wide M1 total from **1,329 to 1,902**. **27 distinct pages is the real denominator.** The script's route list still contains them (`layout-audit-606.ts` ~L95–98); removing them is a code change deferred to the next audit run, not to a doc sweep.
- **6-route subset** (`/`, `/bills`, `/members`, `/bill/[id]`, `/reports`, `/hearings`) additionally at **1024 · 900 · 720**, one hit each — cache already warm, viewport doesn't key it.
- Reuse `smoke.spec.ts` seeds verbatim, env-overridable the same way.
- **`/` is gated** — `app/page.tsx:74` redirects anonymous visitors without `ct_seen` to `/welcome`. Set the cookie context-wide or the audit reports a clean dashboard it never visited.
- Print route count and total page loads (~80). On the record, not estimated.

### M1 — the C1 detector

Generic, no per-route selectors. **Two modes**, because the original's single spec missed half the known offenders:

- **M1a — repeated rows.** ≥3 element children, ≥**3** siblings sharing tag + class signature. (Original said ≥4; a three-row breaking strip is a known offender and would have been invisible.)
- **M1b — singleton wide rows.** ≥600px wide, ≥2 children on one line, no sibling requirement. The masthead is an offender with no siblings.

Per candidate row: **band children by vertical position** (round y-centre to ~4px) and compute gaps only within a band — a row with four children on line 1 and one on line 2 has no meaningful consecutive-by-x ordering. **Include text nodes** via `document.createRange()` / `getClientRects()`, or a bare `·` separator between two spans manufactures a false gap. Skip `<svg>` subtrees, `position: fixed`, and zero-area elements.

Report the **largest interior gap** and, separately, the **trailing gap** (parent's right inner edge − last child's right). **The trailing gap is measured and is not a defect** — it's the target state. Reporting both means the fix reads as interior→0 *and* trailing→large, so "M1 = 0" can't be reached by deleting rows.

Per route: worst 10 rows as `{ selectorPath, interiorGapPx, trailingGapPx, gapAsPctOfRowWidth, rowWidth }`, count over 120px, and the **full gap distribution** so the threshold is defensible rather than assumed.

### M2 — C7, stretched panels

The original's predicate fires on every grid child, because `align-items: stretch` is the default, and `scrollHeight` equals `clientHeight` on a stretched panel so it can't detect anything anyway.

Correct predicate: grid/flex children **that read as a panel** — non-zero border-width, or a background differing from the parent — measured as `panelRect.bottom − max(visible child rect.bottom)`. Report over 40px. An invisible stretched wrapper costs nothing and is not a finding.

### M3 — C3, row noise

Per repeated-row group, count descendants whose **own** computed style differs from their parent's — color, non-zero border-width, or a non-inherited background. Own-vs-parent, so a pass-through wrapper and its child don't both score. Mean per row, worst route. Target is 1 bright + 1 stage-colored; 4+ puts the route on the P4/P5 list.

### M4 — C4, reserved empty space

Visible, panel-like or grid/flex-child elements over 40px tall whose text is empty or a no-content string. Seed with `NO MEETINGS` / `—` / `NO DATA` / `NONE`, then **emit every ≥40px element with ≤12 characters of text as a candidate**, so the vocabulary closes on measurement instead of a guess. Count and total reserved pixels per route.

### M5 — narrow-width baseline

6-route subset at **1024 · 900 · 720**. Any element where `scrollWidth > clientWidth`; any flex container wrapping to more lines than at 2560.

**900px is a breakpoint, not a neutral width** — `.dv2-grid` collapses to one column at `max-width: 900` (`globals.css:646`). The full ladder is 640 / 700 / 720 / 760 / 900 / 1023 / 1100 / 1200. Measuring only at 900 measures the transition and misses the two-column state that's actually marginal.

M5's decision role is smaller now than the original assigned it — C2's identity commit already proves narrow widths unchanged. It remains the baseline the later phases are scored against.

### M6 — dead routes: answered, no browser needed

`app/dashboard-v2/page.tsx` is a **9-line `permanentRedirect("/")`** (HO 311), kept so bookmarks survive the swap. Not dead; deleting it 404s them. **That half was verified by the HO 606 run and stands.**

**The `dashboard-classic` half was FALSIFIED by that same run, and this paragraph used to assert the opposite.** It claimed the route "carries branches in **five components**" and was therefore "not a two-file `rm`". The grep the paragraph itself prescribed says otherwise: all five component references — `DashboardTopicTreemap:62`, `RaceNewIndicator:9`, `BillRowList:14`, `StageFunnel:57`, `ActiveFilterStrip:6` — **and both `lib/queries.ts` sites (`:719`, `:779`) are COMMENTS, not code branches.** The only executable coupling is `FILTER_BASE = "/dashboard-classic"` inside the route file itself; every component reaches the route through a **`basePath` prop that defaults to `/`**, so nothing branches on the string. The grep also surfaces two references this paragraph never listed — `DashboardV2Header.tsx:76` and `globals.css:6507`, both comments — which is its own small lesson about a hand-enumerated set. The smoke-crawl entry is real and remains.

`app/dashboard-classic/page.tsx` (149 lines) is still deliberately unlinked and absent from `NAV_ITEMS` (`HeaderBar.tsx:36-48`). **But deletion is cheap — a route file, a smoke-crawl entry, and a comment sweep — so it RIDES P3** rather than needing an arc of its own. The script prints this as a fixed note; completeness stays answerable by `git grep -n "dashboard-classic" -- app/ components/ lib/`.

### Output and verdict

- **Per-route defect table** — route × (M1a, M1b, M2, M3 mean, M4 pixels) — sorted by M1a+M1b descending. This table is the phase plan.
- **Baseline totals** for M1 and M4 site-wide.
- **M5 narrow-width baseline.**
- Any route that **can't be measured** — named, not silently skipped.

**GO** if M1 returns a populated, plausible list. Near-zero site-wide means the detector is broken — the dashboard demonstrably has these gaps, and a detector that structurally can't fire looks identical to a clean result. **Prove it fires first**: point it at `/`, confirm it finds the known breaking-headline and miss-strip gaps by name, before trusting any other route's zero.

### Instrument v2 (HO 610) — what changed, and what it invalidates

**Every number produced before `e6bbc08` is v1. They do not compare to v2 numbers, and any table that mixes them must label which is which.** The P3 slice scores in the HO 610 roadmap block are v1 throughout (so the slices compare to each other and to 606); the P4 baseline is v2.

Four changes, all measurement-definition or output. **No threshold moved** — the 120px gap threshold, the 600px M1b width floor, M2's 40px slack, M4's 40px/12-char emitter are all untouched, which is the line between correcting an instrument and tuning one.

1. **Banding: vertical-interval overlap, not centre-Y buckets.** Items sharing ≥50% of the smaller one's height are one band. v1's `round(centreY / 4px)` split any baseline-aligned row whose items differed in font size — which, under a six-token type ladder, is every row. See the oddity; it read a packed row at 873px and a genuinely broken masthead at 75px.
2. **M1b container cut.** A candidate with a child taller than **60px** is a layout container, not a row. Row children are text-scale; the class this removes (`.home-shell`, `.dash-page`, `.dash-left`) had children 300–1000px tall and its "interior gap" was the two-region gutter C8 asks for.
3. **Counted viz exemption (M1x).** Rows under `[data-viz-row]` leave M1 and are reported per-route and site-wide on their own line. Today the only marked element is `StageFunnel`'s `ul` (presentation-inert attribute). A bar row is label · bar · value-on-a-shared-axis, so the space between a short bar and its number is the encoding, not a stretch. **Counted rather than skipped, because an uncounted exemption grows silently** — the next person to reach for `data-viz-row` has to move a visible number.
4. **SHA-stamped, never-overwritten artifacts.** `audit-<shortsha>-<width>.json`. v1 wrote a fixed filename and the HO 610 re-run **destroyed the 606 baseline it existed to be compared against**; it had to be rebuilt by checking out the prior commit and crawling again.

**The verdict condition in §3 above is v1's and has expired.** "Prove it fires first: point it at `/`, confirm it finds the known breaking-headline and miss-strip gaps by name" was correct while `/` was broken; P3 fixed those rows, so an instrument that still finds them is reporting its own defect. v2's legs are:

- **A — known-GOOD.** The rows P3 packed must read SMALL (bound derived from the fixed 5.8em id column: basis − narrowest id + gap ≈ 50px, not a number tuned until it passed).
- **B — exemption visible.** M1x > 0 and zero funnel rows scored.
- **C — known-BAD control.** `/members` must still hold its rows over threshold. **A and B both assert v2 reports LESS than v1; on their own they are satisfied by an instrument that reports nothing.** C is the only leg that separates a correction from a silencing, and any future instrument change needs its own C.

---

## 4. The standing rule this arc keeps re-learning

Twice now a gate in this arc has been written that could not detect what it was for.

The original's M1 threshold (≥4 siblings) structurally excluded the breaking strip it was written to catch. HO 604's first-draft identity gate — a computed-`fontSize` diff across a value-preserving substitution — would have read *zero differences* if the substitution had never run at all. Both looked like rigour.

**Before writing any gate in P3–P7: state what the instrument reads if the work never happened. If that's the same as success, it isn't an instrument.**

The corollary, from 604: **separate coverage from breakage.** Coverage is "did every site get touched" and needs a count taken *before* the change to prove the detector fires. Breakage is "did anything render wrong" and is a diff. Conflating them yields a gate that passes on an empty change.

---

## 5. Hard guards, every phase

1. **One concern per commit.** Code and docs never mix. Structural change and type change never mix. Chrome and route work never mix.
2. Explicit pathspec staging. `npm run typecheck` before every push. Ancestry eyeball (`git log --oneline @{u}..HEAD`) immediately before. Fast-forward only.
3. The audit is **read-only** and **local production build only**. No prod runs; it's a measuring instrument, not a monitor.
4. **No fixes inside the audit.** M2 finding a stretched panel does not license fixing it there.
5. **Absence Watch is out of scope in every phase.** If M1's `/` table lists rows belonging to it, note and move on.
6. **HALT and report at each phase boundary.** No phase writes the next phase's code.
7. Docs are P7. `backlog.md:130` needs correcting once anything is built — the entry currently reads `NOTHING WAS BUILT`, which is true today and won't be after 604.

---

## 6. The remediation kit — what P3/P4 actually learned, as method

Eight moves. Each was earned by a route that resisted the previous one, and they
are listed in the order a new route should apply them.

1. **Decompose before designing.** A route's M1 count is not a work item; it is a
   sum over families. `/lobbying`'s 67 split into four families of which exactly
   one was that commit's (13 filing rows + 1 header · 1 filter bar · 25
   leaderboard rows · 23 crosswalk rows). Designing against the 67 would have
   produced a fix for something that was 20% of it.
2. **Derive, don't tune.** A cap is arithmetic or it is a curve. A number chosen
   because it made the count fall is a number nobody can re-derive later, and the
   next corpus makes it wrong silently.
3. **Check the SPREAD against the threshold before deriving.** When the label-ink
   spread exceeds the 120px gap threshold — 199px on `/members`, 322px on
   `/lobbying`, 343px on `/trades` — **no cap satisfies both "no truncation" and
   "under threshold"**, because comparable columns need a shared x and a shared x
   under a variable label means per-row slack. At that point you are choosing a
   trade, not finding a cap.
4. **Then take the knee, and file the next increment rather than taking it.**
   `/members` 240px = 16 names clipped to buy 11 rows; `/trades` 280px, just above
   p75, = 2 of 50 live. Both recorded what the following step would have cost
   (16 more truncations for 11 rows; 7 more for 5) and declined it in writing.
5. **Derive against the SHORT end.** `cap = threshold + min-ink − column-gap`
   (HO 614: `120 + 239 − 14 = 345`, taken at 340, zero truncation). A cap sized
   off the widest label donates its whole width to the narrowest — see the
   oddity, where a widest-name cap moved `/members` 548 → 527.
6. **The wrap-cap.** A cell that can wrap can be capped for free. `/lobbying`'s rc
   cell is two names joined by an arrow, so its cap cost zero truncation where a
   member name or a ticker description could not. Ask whether the content wraps
   before pricing a truncation.
7. **Wrap, don't pin.** The standing narrow-width guard. A fix that trades a
   narrow-width wrap for a right-pin re-creates the C1 defect the phase removes.
8. **Anchor hygiene, two halves.** *Dependency-grep the anchor* — prove the
   falsification route shares no component with the work, by dependency and not
   by route name (HO 614 §2). *Re-anchor rides the expiring commit* — when a
   commit is about to invalidate an anchor, move the anchor in that commit
   (HO 612 `63c7cd2`), not in the next handoff that trips over it.

**And one rule that is not a move but a stop condition:** a fix that does not move
the number has not been under-applied — the cause is elsewhere. See the oddity on
pins that live outside the component they pin.

---

## 7. Instrument v3 (HO 615) — definitions, and the comparability rule

**THE COMPARABILITY RULE, first, because it is the one that gets broken:
v1 / v2 / v3 are three rulers. A number from one does not compare to a number from
another, and any table mixing them must label which is which.** A route whose
count fell because the instrument stopped lying about it is an **instrument note**;
a route whose count fell because its layout changed is a **remediation claim**.
When both happen in one arc — as at HO 615 — measure the same DOM under both
rulers and report the split. HO 615's was **−132 total, of which 27 was product
work**; presenting the 132 as remediation would have overstated it by 5×.

### The era table

| | v1 (HO 606) | v2 (HO 610, `e6bbc08`) | v3 (HO 615, `f40768f`) |
|---|---|---|---|
| **M1 items** | one per client rect | one per client rect | **one per child node, extent = union bbox of its rects** |
| **M1 banding** | `round(centreY / 4px)` | vertical-interval overlap ≥50% | overlap bands, **membership by ink span**, plus the **continuation-band cut** |
| **Can it read a mixed-size baseline?** | **No** — splits any row whose children differ in font size, which under a six-token type ladder is every row | Yes | Yes |
| **Can it read a wrapped cell?** | No | **No** — measures a short last line against a neighbour with the long first line invisibly between them | Yes |
| **M1b container cut** | none | child taller than 60px ⇒ container, not a row | unchanged |
| **Viz exemption** | none | `[data-viz-row]` counted as M1x | unchanged (registry in backlog) |
| **M5 extra-wrap** | centre buckets | centre buckets | **overlap clustering; duplicate paths keep the MAX, not last-wins** |
| **M5 overflow** | one number | one number | **M5x design-clip vs bucket (b) real** |
| **Leg C anchor** | `/` (breaking rows) | product route, walked as a fallback list | **a committed fixture** (§8) |
| **Artifacts** | fixed filename, overwritten | SHA-stamped, never overwritten | unchanged |

### What v3 changed, and why each was a definition rather than a threshold

**No threshold moved.** 120px gap · 600px M1b width floor · 40px M2 slack ·
40px/12-char M4 emitter are all untouched, which is the line between correcting an
instrument and tuning one.

1. **Ink-span items (M1).** An element is present in **every band its union bbox
   overlaps**, so a gap can never be measured across it. v2's per-rect items let a
   wrapped cell's short last line be measured against the next cell. See the
   oddity: C1 remediation *manufactures* that geometry, so the error term grew
   with the fixes it was scoring.
2. **The continuation-band cut (M1).** A band whose member set is a **subset** of
   another band's is not a line. It holds no item not already measured somewhere
   richer, so it can only report a gap across items the fuller band contains.
   Membership, never position or count — a genuine two-line row keeps distinct
   items on line 2 and is still measured. **This one was not in the plan; the
   measurement forced it** (a `/trades` row's second band held exactly
   `{date, amount}` and reported the 625px between them).
3. **Overlap clustering for M5 extra-wrap.** `round(centreY / 4px)` split a single
   baseline-aligned row whose children differed in font size, and **whether it did
   so depended on the row's absolute y** — the fixture samples all four 1px
   residues of the bucket cycle, and copy 1 splits while copies 0/2/3 do not.
4. **M5x, the design-clip column.** An element whose OWN computed style declares
   `text-overflow: ellipsis` or a line clamp was authored to truncate; it reports
   `scrollWidth > clientWidth` forever and no narrow-width work will change it.
   Counting it beside real overflow gave bucket (b) a large permanent
   non-actionable population — `/members`' 721/217/1301, which turned out to be
   **100% design-clip**. Known limitation, filed in the backlog: a
   scroll-by-design third category (marquees, `<pre>`) is still landing in (b).

### What v3 still cannot read

- **A per-line far-right anchor that another line's content spans horizontally.**
  The continuation-band cut is by membership, so this is rare rather than
  impossible; it is the accepted cost of removing the wrap artifact.
- **Anything off-screen.** No measurement in this audit sees "the reader cannot
  reach it" — see §8's note on the HO 615 rail, where every number was green on a
  layout that had put a filter 19,643px down the page.
- **Conditional chrome.** An element that renders only in a state the crawl does
  not enter is unmeasured. `/?stage=committee` is in the route list for exactly
  that reason.
- **M1x as a row count.** M1x counts *candidates*, not visual rows —
  `/lobbying`'s 125 is 50 rows and 75 wrappers and tracks.

---

## 8. The fixture — why leg C left the product

**`scripts/diagnostic/fixtures/layout-legc.html`,** committed, loaded over
`file://`, versioned with the instrument, reachable by no route and by no
remediation.

**Why it had to leave.** Leg C's job is to prove the detector still fires. Pinned
to a product route, its shelf life is exactly as long as that route's defect — and
a remediation phase is in the business of ending them. It expired **three times in
four handoffs**: HO 612 re-anchored `/members` → `/changes` in its own commit
because 612 was about to take `/members` to ~20 by design; HO 613 was saved only
because the leg walks a fallback list and fell through to `/stale` when `/changes`
collapsed to 1; HO 614 had to dependency-grep its own components against `/stale`
before its first commit, because the list had no depth left. **A silenced
instrument and a successful remediation read identically on an expiring anchor**,
which is the same-as-success shape §4 keeps naming.

**The both-direction contract.** Legs A and B of the falsification both assert
that the new instrument reports **less** than the old one, and on their own they
are satisfied by an instrument that reports nothing at all. Leg C is the only leg
that separates a correction from a silencing, so it asserts both directions in one
place:

- **POSITIVES — must fire.** A ≥600px row with a ≥300px far-right interior gap
  (M1) · a bordered panel with >40px trailing slack (M2) · a ≥40px reserved empty
  box (M4) · a genuinely overflowing cell (M5 bucket (b)).
- **NEGATIVES — must stay silent**, each a preserved false positive of an earlier
  instrument version, marked `data-legc-clean`: a single-line row mixing `--fs-9`
  / `--fs-11` / `--fs-14` on one baseline, **at four 1px offsets so the v2
  position-dependent split is reproducible rather than lucky** · a row with one
  wrapped cell between single-line neighbours · an ellipsized cell that must land
  in M5x and not (b) · a bordered grid child sized to its own content, which M2
  must **not** report.
- **CALIBRATION — must count exactly.** A three-row `label · bar · value` block
  under `[data-viz-row]` reads **M1x = 3**, never 0 and never folded into M1. Its
  container sits under the 600px M1b floor and has no siblings on purpose, so it
  is not itself a candidate and cannot inflate the count. This is what lets leg B
  survive the day the live funnel changes shape.

**Rules for changing it.** Every case has exactly one assertion in
`assertLegC()`; a case with no assertion is decoration. Adding a positive means
adding its assertion. **A failing negative is an instrument defect or a fixture
defect, and the order of investigation is fixture-first** — HO 615's own NEG-2
failed because the fixture had right-aligned its trailing cell, putting a real
135px anchor inside the row meant to isolate the phantom. The instrument was
right. **Never edit the fixture to make a leg pass**; edit it only when a case is
carrying a property it does not mean to test.

**What it does not cover.** Everything in §7's "cannot read" list. The fixture
proves the detectors fire and that four specific false positives stay dead; it
does not and cannot prove the measurement is the right measurement. That is what
the eyeball pass is for, and HO 615's rail reversal is the standing example of the
eyeball finding what four green numbers could not.
