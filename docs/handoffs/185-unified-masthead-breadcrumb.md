# HO 185 — Unified PowerShell-path breadcrumb masthead + dual tapes on every page

## Why

The non-dashboard pages (via `HeaderBar`) still read **"CBT // 119TH CONGRESS"** (the old product name — it's "Congress Terminal" now) and mount a **single** markets tape, while the dashboard (`HomeHeader`) shows "Congress Terminal:\>" with the dual counter-scrolling tapes (HO 178) and the cycling AS OF (HO 183). Unify everything:

1. **Rename + new masthead format, everywhere:** a PowerShell-path breadcrumb that reflects the current location:
   `Congress Terminal:\ 119TH \ <Section> [\ <Detail>] >_`
   with a blinking cursor at the end. Examples:
   - Bills (bills mode): `Congress Terminal:\ 119TH \ Bills >_`
   - Bills (news mode): `Congress Terminal:\ 119TH \ News >_` (tracks the toggle)
   - Bill detail: `Congress Terminal:\ 119TH \ Bills \ HR 9081 >_`
   - Members: `Congress Terminal:\ 119TH \ Members >_`
   - Member detail: `Congress Terminal:\ 119TH \ Members \ <LastName> >_`
   - Races: `Congress Terminal:\ 119TH \ Races >_`; race detail: `\ Races \ GA Senate >_`
   - Committee detail: `\ Members \ Committees \ <CommitteeName> >_` (or `\ Committees \ <name>` — Phase 1 to map the committee's place in the IA)
   - Dashboard: `Congress Terminal:\ 119TH \ Dashboard >_` (dashboard adopts the path format too)
2. **Dual counter-scrolling tapes on EVERY page** (replace the single combined tape in HeaderBar with the same equities/commodities dual setup the dashboard uses). This also brings the cycling AS OF (HO 183) everywhere for free.
3. **Dashboard keeps its HO 178 lead-in prose** — the weekly-summary prose stays to the right of the path; the path replaces the title portion, prose unchanged.

## Confirmed decisions (don't re-litigate)

- **Detail-segment labels:** Bill → `HR 9081` (bill number); Member → **last name**; Race → race label (e.g. `GA Senate`); Committee → committee name. (Section pages have no detail segment.)
- **Bills|News path tracks the toggle:** `\ Bills >_` in bills mode, `\ News >_` in news mode.
- **Dashboard adopts the path** (`\ Dashboard >_`) AND keeps the lead-in prose to the right.
- **Format:** `Congress Terminal:\` root + `119TH` (the congress) + section + optional detail, segments separated by ` \ `, ending `>_` with the blinking cursor. `Congress Terminal:\` (or the `:\` glyph) keeps the `--accent-amber` treatment from HO 162. The cursor is the existing blink (a named motion exception).

## Phase 1 — Diagnostic (HALT after — this unifies two components, map before merging)

### The two masthead components
1. Read both: `HomeHeader` (dashboard — has the HO 178 prose-right, dual tapes, HO 183 cycling stamp, the `Congress Terminal:\>` TerminalPrompt) and `HeaderBar` (all other pages — the "CBT // 119TH CONGRESS" branding, single tape, the GroupTabs sub-nav, search). Report each one's current structure: what it renders, where the title/brand string lives, where the tape mounts, what's shared vs. duplicated.
2. **Unification approach.** Report the cleanest way to give every page the same path masthead + dual tapes without regressing the dashboard's extras (prose, the 56/44 body below it). Options: a shared `<TerminalMasthead>` that both consume (dashboard passes the prose as a slot/child); or bring HeaderBar up to HomeHeader's masthead and keep the dashboard-only prose conditional. Recommend.

### The breadcrumb
3. **Per-route segment mapping.** For each route, report the breadcrumb segments it should produce:
   - `/` → Dashboard
   - `/bills` → Bills (or News, per `?mode`)
   - `/bill/[id]` → Bills \ <bill number, e.g. HR 9081>
   - `/members` → Members; `/members/[bioguideId]` → Members \ <last name>
   - `/committees` + `/committee/[systemCode]` → (map: is Committees under Members? → Members \ Committees \ <name>, or top-level Committees \ <name>?)
   - `/races` → Races; `/race/[id]` → Races \ <race label>
   - `/primaries` → (Races \ Primaries? per the HO 173 electoral group)
   - `/patterns`, `/trends`, `/stale` → Patterns \ <sub>
   - `/reports` → Reports; `/changes` → Changes (or Bills \ Changes?); `/president` → Bills \ President (it's a filtered bills view); `/watchlist` → Watchlist
   Report the data each detail page already has for its last segment (bill number, member last name, race label, committee name) and where to source it (the page already fetches these for its own H1, so reuse — don't add queries).
4. **Build mechanism.** Propose how the path is assembled — a helper that takes route + params/data and returns the segment array, rendered by the shared masthead. Server-render where possible (most are server pages); the cursor blink + the Bills|News mode reactivity are the only client bits (bills mode is a `?mode` param, readable server-side, so even that may not need client). Report.
5. **The existing per-page H1.** Pages currently have their own H1 (`Bills:\>`, the HO 184 mode-aware one; member names; etc.). Does the path masthead REPLACE these per-page H1s, or sit above them (masthead = global chrome path, H1 = page content title)? Recommend — likely the path is the global masthead (top, with tapes) and the per-page H1 can stay or go. Flag the interaction so we don't end up with the section name twice.

### The dual tapes everywhere
6. **Tape mount.** Currently HeaderBar mounts ONE `MarketsTape` (combined). The dashboard mounts two (equities + commodities, via the `group`/`reverse` props + the `.markets-tape-block` wrapper from HO 178/179.1). Report how to move the dual-tape mount into the shared masthead so every page gets both. Confirm: the single-tape `showMeta`/stacking/`z-index:30`/`.markets-tape-block` setup all carry; the cycling AS OF (HO 183 `useZoneCycle`) applies to the bottom tape on every page; jump-proofing holds. The combined single-tape code path may be retired if nothing else uses it — report.

**HALT. Report: the two-component structure + unification approach, the per-route segment map (with where each detail label comes from), the build mechanism, the H1 interaction, and the dual-tape-everywhere mount. This is large and touches global chrome — I'll review the plan before Phase 2.**

## Phase 2 — Implementation (only after sign-off; likely sub-staged)

Suggested sub-stages (Code proposes order):
1. Shared masthead component + the breadcrumb path helper (per-route segments), replacing "CBT // 119TH CONGRESS" everywhere with `Congress Terminal:\ 119TH \ <path> >_`.
2. Dual tapes into the shared masthead (every page gets both + cycling AS OF); retire the single-combined-tape path if unused.
3. Dashboard: adopt the path masthead while KEEPING the HO 178 lead-in prose to the right + the 56/44 body intact.
4. Resolve the per-page H1 interaction (no doubled section name).

## Verification
- Every page's masthead reads `Congress Terminal:\ 119TH \ <correct section> [\ <detail>] >_` with the blinking cursor; no "CBT" anywhere.
- Bills|News path tracks the toggle (Bills ↔ News).
- Detail pages show the right last segment (HR 9081, member last name, race label, committee name).
- Dual counter-scrolling tapes on every page; cycling AS OF everywhere; jump-proof through 2+ poll cycles; one AS OF stamp per page (bottom tape).
- Dashboard keeps its lead-in prose + 56/44 body.
- `<700` behavior holds (tapes hidden, the masthead path still renders — confirm it fits/wraps; the cursor-on-title rule from HO 178/179.1 may need to apply to the path's end).
- Type check passes.
- Run the dev server (Code starts it) for Corey to eyeball across several pages.

## Out of scope
- No change to page *content* below the masthead (feeds, charts, tables).
- No new data queries — reuse what each page already fetches for its detail label.
- SKILL.md: flag for the next sweep (the masthead unification + "CBT"→"Congress Terminal" + dual-tape-everywhere + breadcrumb) — large enough that the next doc sweep should capture it.

## Note
- This builds on the HO 184 `/bills` rename (merged). The breadcrumb's Bills segment + the `?mode` tracking depend on that being in place.
