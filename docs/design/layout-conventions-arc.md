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
| **P2** | **The audit.** Read-only Playwright, M1–M4 + M5, run against the scaled site. HALT. | 606 |
| **P3** | `/` rework to the target mock — the reference implementation of C1–C8 | next |
| **P4** | Feed routes: `/bills` `/news` `/amendments` `/nominations` `/hearings` `/members` `/lobbying` `/trades` | next |
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

**ONE file** under `scripts/diagnostic/`, named for the HO that builds it — `layout-audit-606.ts`. (Backlog:130 used to name `layout-audit-591.ts`; that was wrong and the HO 605 sweep corrected it. The roadmap pointer still wins at build time: if numbering has moved again, name the file for the HO that actually builds it and say so.) Playwright driven programmatically — `import { chromium } from "@playwright/test"`, already a devDependency, **do not add `playwright`**. Not a `.spec.ts`, not in `e2e/`, never in CI. Read-only.

This is the first *browser* probe in `scripts/diagnostic/` — every existing one is a raw `@libsql/client` SQL probe. `absence-watch-588.ts` is the header-comment model.

**Lift the skeleton from HO 604.** The computed-`fontSize` walk that 604's gates require — browser launch, `ct_seen` cookie, route list, viewport loop, per-element computed-style walk — is this script's bones with a different measurement function. 604 leaves it on disk uncommitted for exactly this.

### Target and burn

`npm run build && npm run start` on port 3000. **Not `next dev`** — the dev overlay and HMR alter the geometry being measured. **Not prod** — BotID withholds the markets tape from headless Chrome (`e2e/smoke.spec.ts:17-20`), and the tape is a C1 row. Reads hit prod Turso, so:

- Each route **twice at 2560×1440**, measure on hit 2 (the cache-hit path).
- **31 routes** — `smoke.spec.ts`'s `ROUTES` minus five of six `?stage=` variants (same shell, different feed; keep `?stage=committee`, a known `pageErr` site whose filter strip adds a row) and minus `/dashboard-v2` and `/committees` (redirects into targets already listed).
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

`app/dashboard-v2/page.tsx` is a **9-line `permanentRedirect("/")`** (HO 311), kept so bookmarks survive the swap. Not dead; deleting it 404s them. `app/dashboard-classic/page.tsx` (149 lines) is deliberately unlinked, absent from `NAV_ITEMS` (`HeaderBar.tsx:36-48`), and carries branches in **five components** — `DashboardTopicTreemap:62`, `RaceNewIndicator:9`, `BillRowList:14`, `StageFunnel:57`, `ActiveFilterStrip:6` — plus two `lib/queries.ts` comments (`:719`, `:779`) and a smoke-crawl entry. Not a two-file `rm`. The script prints this as a fixed note; the only live question is whether that branch set is complete, answered by `grep -rn "dashboard-classic" app/ components/ lib/`.

### Output and verdict

- **Per-route defect table** — route × (M1a, M1b, M2, M3 mean, M4 pixels) — sorted by M1a+M1b descending. This table is the phase plan.
- **Baseline totals** for M1 and M4 site-wide.
- **M5 narrow-width baseline.**
- Any route that **can't be measured** — named, not silently skipped.

**GO** if M1 returns a populated, plausible list. Near-zero site-wide means the detector is broken — the dashboard demonstrably has these gaps, and a detector that structurally can't fire looks identical to a clean result. **Prove it fires first**: point it at `/`, confirm it finds the known breaking-headline and miss-strip gaps by name, before trusting any other route's zero.

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
