# 154 — App-wide cleanup audit (spec 8 / #10)

## What this is

Spec 8 from the design session: a consistency pass, not a new surface. This session built a stack of primitives — the masthead/`TerminalPrompt` prompt, the markets tape, the tooltip primitive, the click-to-expand row, the `SegmentedToggle`, the snapshot strip. Surfaces built before them diverge. This audit finds where, and aligns them.

**The fix is alignment to the established patterns, not redesign.** Anything that just shipped (Committees HO 143-145, and everything from HOs 147-153) is checked for header/token parity only — its design is left alone. The goal is one header system, one nav, one row pattern, one toggle, one tooltip approach across the app, with no surface still wearing pre-session chrome.

Because the scope is wide, this runs audit-first: Phase 1 produces a prioritized punch-list and stops. Phase 2 executes in grouped commits. Any punch-list item large enough to be its own effort gets split into a follow-up handoff rather than forced into this one.

## Phase 1 — Audit only (HALT for sign-off)

Run the nine-check rubric against every surface, fold in the known backlog below, and produce a per-surface punch-list. No fixes. End with the prioritized list and stop.

### The nine checks (per surface)

1. **Masthead parity** — page leads with a `PageName:\>` mono prompt (the HO 153 `TerminalPrompt`) + the `· LAST SYNC · N BILLS` subhead where relevant. One header style; flag any page still on a pre-session top bar (spec 8 noted the members page carried the old `CBT // 119TH CONGRESS` nine-item nav as of the 5/24 annotation — verify what's left).
2. **Nav parity** — the shared six-item `NAV_ITEMS` (HO 150) renders identically everywhere, same active treatment, including sub-route active states (Committees / Races / Primaries highlight Members; Trends highlights Patterns).
3. **Tape presence** — decide once whether the markets tape is global chrome or dashboard-only, then apply uniformly. Lean global. It's dashboard-only today (HO 149).
4. **Filter-bar pattern** — mono chips, `SegmentedToggle` for view-modes, `--accent-amber-bright` active, consistent search-box styling.
5. **Row pattern** — list rows with detail use the click-to-expand accordion (HO 148): same chevron, single-open, same panel shape.
6. **Tooltip coverage** — the HO 147 primitive on codes / abbreviations / section headers. This is where the tooltip placement audit runs (which native-`title` sites from HO 123 graduate to the primitive, which stay, which drop).
7. **Pagination** — consistent `‹ PREV · PAGE n / N · NEXT ›`, top-slice not full-dump, same placement.
8. **State coverage** — every async block defines empty / loading / error / stale (the tape's four-state model generalized).
9. **Token + density discipline** — colors only from the system; correct text hierarchy; party/stage/topic colors by meaning; Bloomberg density (dense rows, not airy cards); UPPERCASE mono section labels; no motion beyond the cursor blink and the tape marquee.

### Surface inventory

Run the rubric against each, output a per-surface punch-list of failures: Dashboard, Feed (Bills|News), Members (+ detail), Reports (+ detail), Patterns, Watchlist, Committees (+ detail), Races, Primaries, Trends, Search, individual bill detail page.

### Known backlog to fold in

These are already-identified divergences from this session's handoffs. Confirm each against the code, slot into the right surface's punch-list, and assign severity:

- **Expand-mechanism split (check 5).** `/feed` uses client-state single-open (HO 148); `/members` uses URL-driven `?expanded=` (HO 152) — the pattern bills deliberately moved away from. Reconcile to one. This is the likely candidate to split into its own follow-up handoff if it's large.
- **Toggle consolidation (check 4).** `ChamberToggle` still serves `/feed` and others; `/members` got an inline `SegmentedToggle` (HO 152); `SponsorSortToggle` was deleted. Migrate remaining `ChamberToggle` (and any other bespoke toggle like `SponsorSortToggle`'s siblings) to `SegmentedToggle`.
- **Tooltip migration (check 6).** HO 147 built the primitive + two live instances; the rest of the app is on native `title` (HO 123). Decide term-by-term what graduates.
- **Masthead parity (check 1).** `TerminalPrompt` now exists (HO 153) for reuse across pages still on old chrome.
- **Tape-everywhere (check 3).** Promote `MarketsTape` to global chrome if that's the call.
- **Dead code.** `getPresidentBills` / `getPresidentCount` (orphaned by the HO 151 president redirect); the vestigial `sp.delete("expanded")` in `ChamberToggle` (orphaned by HO 148's move off `?expanded=` for bills).

### Verify, don't assume

- **Races / Primaries** — confirm whether they're still standalone routes with their own (possibly pre-session) headers, or absorbed under Members. Their header/nav state drives checks 1 and 2.
- **Search tabs (HO 129)** — confirm the tab pattern matches the `SegmentedToggle` idiom (BILLS|NEWS) or needs reconciling to it.

### Output format

A per-surface punch-list. For each surface, list the rubric checks it fails with a one-line description and a severity (high = wrong/broken chrome a user sees; medium = inconsistency; low = dead code / internal tidiness). Then a recommended fix grouping for Phase 2 (see below) and a flag on any item big enough to warrant its own handoff.

### HALT. Wait for sign-off on the punch-list and the fix grouping.

## Phase 2 — Execute (after sign-off, in grouped commits)

Do **not** fix everything in one commit. Group by rubric area so each commit is reviewable and revertable. Suggested grouping, to be finalized from the punch-list:

- **Chrome parity** — masthead (`TerminalPrompt`) + nav (`NAV_ITEMS` + sub-route active states) across every page still diverging. One commit.
- **Toggle consolidation** — migrate remaining bespoke toggles to `SegmentedToggle`. One commit.
- **Tooltip migration** — graduate the agreed native-`title` sites to the primitive. One commit.
- **Tape presence** — global vs dashboard-only, applied uniformly. One commit (small).
- **State coverage** — fill missing empty/loading/error/stale states. One commit.
- **Dead-code + tidy** — remove orphaned queries and vestigial params. One commit.
- **Expand-mechanism unification** — likely its own handoff if the punch-list shows it's large; otherwise a commit here.

Each commit: alignment to the existing pattern, not redesign. `npm run typecheck` + `npm run build` clean per commit. `SKILL.md` updated as patterns get enforced app-wide (e.g. "all view-mode toggles use `SegmentedToggle`," "all list rows with detail use the HO 148 accordion").

## Out of scope

- Redesigning any surface. This is alignment only.
- Touching the design of anything shipped this session (HOs 143-153) beyond header/token parity.
- New features, new data, new charts.
- Mobile. The #15 mobile pass is the separate consolidated effort; this audit is desktop-chrome parity.
- New tokens or motion.

## Acceptance

1. Phase 1 punch-list posted: per-surface rubric failures with severity, the known backlog confirmed and slotted, Races/Primaries and Search-tabs verified, and a Phase 2 fix grouping. Signed off before any fix.
2. Phase 2 fixes land in grouped, reviewable commits, each aligning to an established pattern.
3. After Phase 2: one masthead style, one nav with correct active states everywhere, one row-expand pattern, one view-mode toggle component, one tooltip approach, consistent pagination, full async-state coverage, token/density discipline — no surface on pre-session chrome.
4. Dead code removed; vestigial params gone.
5. Tape presence decision applied uniformly.
6. Any item too large for a clean commit is split into its own handoff, noted in the punch-list.
7. `npm run typecheck` and `npm run build` clean per commit.
8. `SKILL.md` reflects the now-enforced app-wide patterns.

## Notes

- **Audit-first because the scope is wide.** Fixing as you find, across twelve surfaces and nine checks, produces an unreviewable mega-commit. The punch-list makes the work legible and lets the genuinely large items (expand-mechanism unification) get their own handoff instead of bloating this one.
- **Alignment, not redesign, is the whole discipline.** The session already decided what good looks like. This pass propagates those decisions; it doesn't reopen them. If a surface's pattern seems wrong, that's a new design question for the design project, not a thing to improvise here.
- **Severity ordering keeps the user-facing wins first.** A page still wearing the old nine-item nav (high) matters more than an orphaned query (low). Phase 2 should ship high-severity chrome parity before internal tidiness.
- **This closes the design batch.** Specs 1-10 plus the Reports decision are done once this lands. #11-#15 (including the #15 mobile pass) remain as the next planning conversation.
