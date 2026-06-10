# HO 186 — SKILL.md reconciliation sweep (HO 182 → 185)

## Why

SKILL.md is current through HO 179.1 (the HO 181 sweep). Since then, four handoffs shipped and merged without a doc update — including HO 185, which changed the masthead architecture, the route naming, and the IA. Reconcile SKILL.md to match. Same approach as the HO 165 / 181 sweeps: **factual updates only, preserve voice and structure, re-grep the client-island count, show the diff, commit separately as a `docs:` commit. Trust the live code over this handoff's summary — `view` the real files.** Don't rewrite untouched sections.

## What shipped since the last SKILL update (the drift to reconcile)

**HO 182 — NJ-07 primary resolved**
- NJ-07-2026 roster: Rebecca Bennett → `won_primary` (Dem nominee); Roth/Shah/Varela → `withdrew`. General matchup: Kean (R, incumbent) vs. Bennett (D). Data-only re-seed via `seed:races`.

**HO 183 — cycling timezone timestamps**
- Both the masthead LAST SYNC and the markets-tape AS OF now **cycle through ET → CT → MT → PT → UTC** (4s/zone, 20s loop), via `lib/zone-cycle.ts` (`formatInZone` + `useZoneCycle`, clock-derived index so both stamps sync for free) and `components/CyclingTimestamp.tsx`.
- DST-correct (IANA zones via `Intl.DateTimeFormat`); generic ET/CT/MT/PT/UTC labels.
- Reduced-motion → static MT. This is the **third named motion exception** (cursor blink + tape marquee + this).
- (Note: as of HO 185 the masthead LAST SYNC lives in the breadcrumb masthead; confirm where the cycling stamp renders now.)

**HO 184 — /feed → /bills rename + sub-nav cleanup**
- The Bills|News route renamed `/feed` → `/bills` (single route, `?mode=bills|news`). `app/feed/` → `app/bills/`. Permanent redirect `/feed → /bills` in `next.config` (query-preserving); `/news` and `/president` redirects retargeted straight to `/bills`. The internal GroupTabs group key stays `"feed"` (so `pathToNavKey` still works).
- H1 is mode-aware: `Bills:\>` / `News:\>` — **but note HO 185 then removed these per-page H1 prompts** (see below).
- The `feed` GroupTabs row dropped its Bills & News tabs (the segmented toggle is the canonical mode switch); sub-nav now reads **Changes · President · Reports**.
- All `/feed` references updated across ~24 files (nav href, filter-component basePaths, SearchBox inline-stay, dashboard ActiveFilterStrip/bubbles, etc.).

**HO 185 — unified PowerShell-path breadcrumb masthead + dual tapes everywhere (the big one)**
- **Brand rename: "CBT // 119TH CONGRESS" → "Congress Terminal"** everywhere. The masthead is now a PowerShell-path breadcrumb: `Congress Terminal:\119TH\<Section>[\<Detail>]>_` (true tight separator spacing, amber `:\`/`\`/`>`, blinking cursor). Tracks the Bills|News toggle (`\Bills` vs `\News`); shows detail segments on detail pages (Bill→`HR 9081`, Member→last name, Race→short label e.g. `GA Senate`, Committee→name, Report→title).
- New: `lib/breadcrumb.ts` (`breadcrumbSegments` helper) + `components/BreadcrumbMasthead.tsx` + `components/DualMarketsTape.tsx` (shared leaf components consumed by BOTH `HomeHeader` and `HeaderBar`).
- **Dual counter-scrolling tapes now on EVERY page** (not just the dashboard) — `HeaderBar` mounts `DualMarketsTape` (equities → / commodities ←) instead of the old single tape. Cycling AS OF (HO 183) applies everywhere; one stamp per page (bottom tape).
- **Per-page `.page-masthead` TerminalPrompt blocks removed** from the list pages (the section name now lives once, in the path). Detail pages keep their content H1. So the HO 184 mode-aware `Bills:\>` H1 is gone — superseded by the path.
- IA in the breadcrumb: Committees nests under Members (`Members\Committees\<name>`); Primaries under Races; Changes/President under Bills.
- `HeaderBar` nav moved to its own full-width row (so the path stops competing/wrapping).
- Dead code removed: `HeaderBar`'s `variant="dashboard"` branch (zero callers).
- Now-unused no-ops left in place (flag, don't necessarily delete): the old `TerminalPrompt` usages, `.page-masthead`, `.home-cursor-title`.

## Phase 1 — light diagnostic (then proceed; doc task)

1. Read the SKILL sections touching: the masthead/branding (any "CBT" references → now "Congress Terminal"), the route table (`/feed` → `/bills`), the markets tape (single → dual everywhere; the cycling AS OF), the timestamp formatting, the races/roster section (NJ-07), the client-island count, and the IA/nav description.
2. Grep `"use client"` for the current island count (HO 183 added `CyclingTimestamp`; HO 185 added `BreadcrumbMasthead`/`DualMarketsTape` — report the new count and what changed).
3. **Trust the live files, not this summary** — `view` `components/HeaderBar.tsx`, `components/HomeHeader.tsx`, `components/BreadcrumbMasthead.tsx`, `lib/breadcrumb.ts`, `lib/zone-cycle.ts`, `app/bills/page.tsx`, `next.config`, `data/races-seed.json`. Report the stale sections + your planned edits before changing them (brief HALT to confirm the edit list).

## Phase 2 — reconcile
- Update stale sections: branding (CBT→Congress Terminal), route (`/bills` + the redirect), the breadcrumb masthead model (`lib/breadcrumb.ts`, BreadcrumbMasthead, the per-route segment map, the toggle-tracking), dual-tapes-everywhere (DualMarketsTape, the HeaderBar mount), the cycling timestamps (zone-cycle, the third motion exception), the per-page-H1 removal, the NJ-07 roster, the sub-nav (Changes·President·Reports).
- Note the known-deferred items: the `<700` deep-path wrap (built to wrap, may shed segments later), the inner-page "UPDATED … MT" subhead not yet cycling, and the now-unused no-ops (TerminalPrompt/.page-masthead/.home-cursor-title).
- Preserve voice/structure; factual only; update the island count.

## Verification
- Show the SKILL.md diff (word-level if large).
- Confirm: no stale "CBT" branding, `/bills` route + redirect, dual-tapes-everywhere, the breadcrumb masthead model, cycling timestamps, NJ-07 = Bennett nominee, the island count.
- Commit: `docs: reconcile SKILL.md for HO 182–185`.
- Docs-only — confirm no code touched.

## Out of scope
- No code changes — documentation only.
- The upcoming inner-page chrome rethink (being spec'd in the design chat) is NOT part of this — this documents the current shipped state, which the chrome rethink will then change. (That's fine — sweep now so the rethink lands on a current doc.)
