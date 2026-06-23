# HO 311 — Swap /dashboard-v2 to /

Confirm the next free number before saving (`ls docs/handoffs/ | sort -V | tail`). Body assumes 311; rename if taken.

## What this is

The v2 redesign (HOs 253–310) is done and reviewed. Make it the home page. v2 was built as a separate route (`app/dashboard-v2/page.tsx`) specifically so this swap is a clean cutover, not a rewrite. This handoff points `/` at the v2 content, preserves the old dashboard at an unlinked route for one cycle, redirects the old `/dashboard-v2` URL, and fixes every reference to the v2 path.

One real risk gates the swap: the old `/` has click-to-filter on its stage funnel and topic treemap that rebases the feed; v2 may not. Confirm parity before cutting over (HALT below).

## Resolved premises (strategy, not code-state — don't relitigate)

- The separate-route strategy from HO 253 was always "swap to `/` once it matches the mock." That gate has passed. This is the cutover.
- v2's masthead count is summary-gated by design (HO 253): `getCorpusStats(true)` / `getStageDistribution(undefined, true)` / `getTopicDistribution(undefined, true)`, so the headline total, its four segments, and the body charts all agree with the inner pages v2 links to. The old `/` used the non-gated `getCorpusStats()` (~16.2k). After the swap `/` shows the gated number (~15.2k). That divergence is intended, not a bug to fix: `/` now matches `/bills` and the rest.
- Reversibility post-swap is git plus the preserved classic route below. The parallel `/dashboard-v2` route stops being the safety net once `/` is v2.

## Confirm live first (grep before touching — the /mnt/project copy and SKILL lag the repo)

1. **Route files.** `app/page.tsx` is the old dashboard (`HomeHeader`, treemap+funnel click-to-filter, `BillRowList` / `TopStallsList` feed, `getDashboardReportSnapshot()`). `app/dashboard-v2/page.tsx` is v2 (`DashboardV2Header`, `CompetitiveRacesBlock showBattlefield variant="v2"`, `WeeklyBand`, 49/51 body with `DistributionsTabs` + `ActivityTabs` / `V2FeedList`). Confirm both, and confirm whether the v2 page imports anything co-located under `app/dashboard-v2/` versus only `components/` + `lib/`. The import layout decides the move mechanism. Note v2's `export const dynamic = "force-dynamic"`; it travels with the page.
2. **Every `dashboard-v2` reference, repo-wide.** `grep -rn "dashboard-v2"` across `app/`, `components/`, `lib/`, `docs/`, tests, and `next.config`. Catch nav links, in-app `<Link>`s, the breadcrumb label in `DashboardV2Header`, the page `<title>` / metadata, any sitemap or redirect, and docs. Report the full list before editing.
3. **Click-to-filter parity — the gating check.** The old `/` does `await searchParams` and rebases MOVERS + BREAKING to `?stage=` / `?topics=`, with `ActiveFilterStrip` (`× CLEAR`, `VIEW IN /bills →`). v2 reuses the same `StageFunnel` / `DashboardTopicTreemap` inside `DistributionsTabs`, so the chart clicks still emit those params. Confirm whether v2's page reads `searchParams` and rebases its feed (`V2FeedList`) / breaking / charts the same way, or ignores them. If v2 ignores them, the funnel/treemap clicks become dead interactions at `/` after the swap, a regression from today.

## HALT

If step 3 finds v2 lacks the click-to-filter rebasing the old `/` has, stop before swapping and report it. Don't ship a silent feature loss. Corey decides whether to port click-to-filter into v2 first (separate handoff) or accept the loss and proceed. Everything else can proceed; only the cutover waits on this.

## The swap (after parity is confirmed or Corey green-lights proceeding without it)

1. **Preserve the old dashboard, unlinked.** Move the current `app/page.tsx` content to `app/dashboard-classic/page.tsx`. No nav entry, reachable only by direct URL. This is the one-cycle comparison surface and the no-git-revert undo. Its queries (`getDashboardReportSnapshot()` and the rest) still exist per SKILL, so it keeps rendering. Sunset it in a later handoff once you're satisfied; logged as an open loop.
2. **Make `/` render v2.** Move the v2 page into `app/page.tsx`, carrying its `dynamic = "force-dynamic"`. If the v2 page is self-contained (imports only `components/` + `lib/`), move its body wholesale. If it has co-located machinery under `app/dashboard-v2/`, relocate that to `components/` first, then collapse. Pick the lower-churn path the imports show. Result: `/` renders the v2 composition (DashboardV2Header, races+battlefield, weekly band, 49/51 body), gated count and all.
3. **Redirect the old URL.** `app/dashboard-v2/page.tsx` becomes a permanent `redirect('/')` stub so bookmarks and any external link survive. Don't 404 it.
4. **Fix the references from step 2.** Every `dashboard-v2` link points to `/`. The `DashboardV2Header` breadcrumb label, and the page `<title>` / metadata, must read as the dashboard/home (not "v2" or the old path) once it's at `/`.
5. **Minimal SKILL edit.** Rewrite the two Pages entries: `/` now describes the v2 dashboard (fold in the v2 body it inherited); the old `/` description moves to the `/dashboard-classic` line (marked temporary); the `/dashboard-v2` line becomes "redirects to `/`." Leave the broader doc reconciliation (roadmap home-redesign theme, backlog loop close, oddities) for the follow-up sweep. Flag it, don't do it here.

## Constraints

- Pure cutover. No layout changes, no new components, no token changes. v2 renders at `/` exactly as it does at `/dashboard-v2` today.
- Mono house style untouched. v2 reuses `HomeHeader` classes, so CSS is shared; still verify the stylesheet.
- Stale `.next` rule: confirm `layout.css` loads (no 404) at `/`; `rm -rf .next` + restart if the dev server's been up a while.
- Named `git add` per commit, eyeball the diff. `npm run build` clean.
- Ship per the live-verify rule: `git push`, then `npm run verify:deploy` until the served SHA matches HEAD.

## Ship report

- `/` renders the full v2 composition; `/dashboard-classic` still renders the old dashboard; `/dashboard-v2` permanently redirects to `/`.
- State the masthead total at `/` and confirm it's the gated number matching an inner page (e.g. `/bills`), with the four segments and the body stage/topic panels summing to it.
- Report the click-to-filter outcome: parity confirmed and working at `/`, or the HALT finding and how Corey resolved it.
- Every `dashboard-v2` reference resolved; breadcrumb and page title read correctly at `/`; no dead `<Link>`.
- Stylesheet loads at `/`; build clean; `verify:deploy` SHA matches HEAD.
- Open loops: swap gate closed, `/dashboard-classic` sunset added.
