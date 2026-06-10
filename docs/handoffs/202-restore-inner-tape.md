# HO 202 — Restore the dual markets tape to all inner pages (reverse HO 187)

## Why

The markets tape is currently dashboard-only (`HomeHeader` → `DualMarketsTape`); inner pages on `HeaderBar` have none, because **HO 187 removed it** (after HO 185 had briefly put dual tapes everywhere). Decision: **put the dual counter-scrolling tape back on every inner page** — a deliberate, full reversal of HO 187. The dashboard keeps its tape (unchanged); this adds the same dual tape to the `HeaderBar`-based pages.

## What to build

- Mount the **`DualMarketsTape`** (the same dual counter-scrolling pair the dashboard uses: `equities` + `commodities reverse`) on the inner-page chrome so it appears on every `HeaderBar` page (`/bills`, `/members`, `/changes`, `/stale`, `/watchlist`, `/races`, `/patterns`, `/reports`, etc.).
- **Mount it once in `HeaderBar`** (the shared inner-page chrome) rather than per-page — that's how it reaches every inner page with one change, and it mirrors how `HomeHeader` mounts it once for the dashboard. (HeaderBar.tsx line ~178 already has a stale comment referencing "keeps its own DualMarketsTape mount" — this is where it goes.)
- **Placement:** match the dashboard's tape position relative to the masthead (the tape sits with the header chrome). Confirm where in the HeaderBar band it reads best — same vertical relationship to the breadcrumb/sync line as the dashboard has to its header, so the app feels consistent.

## Phase 1 — light diagnostic (then proceed)

1. **The HO 187 removal.** Read how HO 187 removed the tape from `HeaderBar` — was the mount deleted outright, or gated behind a flag/prop? Report so the restore re-adds it cleanly (re-mount vs. flip a flag).
2. **Single mount point.** Confirm mounting `DualMarketsTape` once in `HeaderBar` puts it on all inner pages (and that no inner page double-mounts it or already has a leftover). Confirm the dashboard (`HomeHeader`) is a separate mount and won't double up.
3. **Data/perf.** `DualMarketsTape` already runs on the dashboard — confirm putting it on every inner page doesn't multiply data fetches per navigation (it's a client island with its own data source — Stooq/FRED via the markets cron, per SKILL). Report whether it's a shared/cached source or each mount fetches. If each mount independently fetches on every page, flag it — but it's likely the same cached client fetch as the dashboard.
4. **Stale comments.** Note the stale comments to fix in the same pass: `HeaderBar.tsx:~178` ("keeps its own DualMarketsTape mount") and `MarketsTape.tsx:~6-7` ("Every other page (HeaderBar, HO 154.2) mounts <MarketsTape />") — the latter hasn't been true since HO 187. Correct them to reflect the restored state.

This is a contained restore (one mount point) — brief HALT to confirm the re-mount mechanics + that it's a single shared/cached data source (not N fetches per nav), then proceed.

## Phase 2 — Implement (after sign-off)
- Mount `DualMarketsTape` once in `HeaderBar`, placed to match the dashboard's tape position.
- Fix the two stale comments to reflect the tape now being on inner pages again.
- Don't touch the dashboard's `HomeHeader` tape (it stays as-is).

## Verification
- The dual counter-scrolling tape (equities one way, commodities the other) appears on `/bills`, `/members`, `/changes`, `/stale`, `/watchlist`, `/races`, `/patterns`, `/reports` — every inner page.
- The dashboard (`/`) tape is unchanged (not doubled).
- No inner page double-mounts the tape.
- The tape's data is the same shared/cached source (not a fresh fetch storm per navigation) — confirm.
- The tape's placement is consistent across pages and reads cleanly with the existing inner-page chrome (masthead + sync + tabs + filter row).
- Type check passes.
- Code uses the running dev server (:3000); Corey eyeballs a couple of inner pages + the dashboard.

## Out of scope
- The dashboard tape (unchanged).
- Tape behavior/data/styling (reuse `DualMarketsTape` exactly as the dashboard renders it).
- Mobile <700 (the tape on inner pages will need the same mobile treatment as everything else — part of the deferred mobile pass; note, don't spec). On the dashboard the tape is hidden on mobile per the 15a work — confirm whether the inner-page tape should follow that same mobile-hide rule, or defer it to the mobile pass.
- SKILL.md — flag for the next sweep (this reverses the HO 187 note: tape is back on inner pages).

## Note
- This reverses HO 187's "tapes removed from inner pages" decision. SKILL's HO 187 entry + the chrome notes will need updating in the next sweep to reflect the tape being restored app-wide.
