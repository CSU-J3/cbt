# CBT Oddities & Gotchas

Field notes on the non-obvious things that broke, or nearly broke, while building this. The kind of thing worth recounting when someone asks what was actually hard about it. Append new entries at the end as you go.

Dates are exact where I tracked them live, flagged `~` where approximate, and tagged with a handoff number (HO) where the precise calendar day is best read off git. `git log` the matching `docs/handoffs/` file to pin those down.

---

## Voteview `cast_code` isn't a coarse cast/miss split — 7/8 = Present = participation, and only a real-rows census reveals it (HO 524, Jul 2026)

The HO 524 cost-probe handoff carried a coarse model for Voteview's per-Congress votes files: `cast_code` **1–6 = cast, 9 = Not Voting (miss), 0 = not seated (exclude)**. Parsing real rows broke it — H119 alone carries **`cast_code` 7 and 8 = "Present"** (~800 rows across the four sampled files), which the {0,1–6,9} model silently drops. A **Present vote is participation, not a missed vote** — the member showed up and voted Present — so the correct split is **cast = 1–8, miss = 9, exclude = 0** (and 0 is itself rare: a non-seated member usually has *no row* for a rollcall rather than an explicit 0-row). Getting it wrong bites two ways: count only 1–6 as cast and Present drops out of the denominator; treat "anything ≥ 7" as miss and Present **inflates** the miss-rate. The general lesson for any coded source — **don't infer a coarse cast/miss split from a codebook; enumerate the code column on live data first** (the same discipline as *Voteview `party_code` follows caucus*, HO 422/430). Baked into `member_career_votes` (B2, HO 525) as cast = 1–8 / miss = 9.

## Non-voting delegates show structurally-inflated miss-rates — keep them in an own-rate display, carve them out of any rank (HO 523/525, Jul 2026)

The six non-voting delegates / resident commissioner (AS, GU, MP, VI, DC, PR) **can't vote on final passage**, and Voteview records those ineligible rollcalls as **Not Voting (`cast_code` 9)** — so their computed miss-rate is **structural, not absenteeism** (Radewagen ~68% career, Moylan ~32%). Three correct-but-different treatments fell out of this: (1) a member's **own-rate** hero stat keeps the raw figure — it's a true fact about that member, and the hub only renders their own page (B1's 119th + B2's career both do this); (2) the **chamber median is robust** to them — a handful of high outliers don't move a median, which is exactly why B1 shows the median, not the mean, as the hero context; (3) any **rank/sort surface** (a `/members` participation dotplot, a Voting-tab rank thread) **must carve them out**, or it reads structural ineligibility as absenteeism and floats delegates to the "worst attendance" top. Banked as a constraint on the unbuilt rank surface (backlog); the own-rate displays needed no carve-out, and it's a *rank*-only constraint — never a member's own displayed rate.

## `member_ideology` retains once-matched members after they leave — join `is_current=1` for a current-only rollup (HO 525, Jul 2026)

`member_ideology` is never pruned: `sync:ideology` upserts a row for every member it matches against the roster, but nothing deletes that row when the member later leaves, so the table **accumulates** — **552 rows against 537 current members** at HO 525. B2's `sync:career-votes` first read the icpsr set straight from `member_ideology` and built **552** rollup rows (16 for departed members). Harmless for the hub (a bioguide point-lookup never reads a non-current row) but off-spec and wasteful — fixed by joining **`members` on `is_current = 1`**, which returns the intended **536** (Graham has no icpsr → no row → the graceful null). The rule: **any rollup keyed off `member_ideology` must filter `is_current=1`** or it over-counts by the departed-but-once-matched tail. Same staleness family as the `sync:members` roster lag (HO 402/520), one table downstream.

## A logged "wrong-incumbent" can hinge on a real-world event after the training cutoff — verify the fact, don't scope it as a bug or dismiss it as bad upstream data (HO 519 §5 → HO 520, Jul 2026)

The HO 519 audit logged an `S-SC-2026` **wrong-incumbent** — the race card showing `G000359` (Lindsey Graham) while congress-legislators' `legislators-current.yaml` had already dropped him and carried **`G000608` "Darline Graham"** as the sitting SC class-2 senator. Two tempting wrong reads: (a) scope it as a CBT derivation bug, or (b) dismiss the upstream `G000608` as a spurious/poisoned yaml entry — the surname coincidence (a *different* Graham, no relation) actively invites (b). **Both wrong.** It was a **real post-cutoff seat change**: Sen. Graham **died** (served 2003–2026), and Gov. McMaster appointed Darline Graham as a caretaker until 2027-01-03 — **verified against the primary source, governor.sc.gov** (corroborated by congress.gov's 1955–2026 member page + GovTrack's "former Senator, 2003–2026"). CBT was simply **stale** (the `sync:members`-staleness class — HO 402 Gallagher CA-01), fixed by the routine `sync:members` → `sync:crosswalk` → `backfill:races` re-sync, zero code. **The durable lesson (the HO 422 Kiley verify-before-fix discipline, one axis further out):** a logged discrepancy is a *claim*, and when it concerns who currently holds a seat, the claim can hinge on an event **after the training cutoff** — which no amount of repo- or upstream-reading resolves. Verify the **real-world fact** (a governor's press release, the official member page) before deciding whether it's a CBT bug, an upstream error, or a correct-but-unsynced change. Here the upstream was authoritative (`G000608`, appointed 2026-07-14) and CBT was the stale one, so the fix was a sync, not code. Same family as *Voteview `party_code` follows caucus* (HO 422/430) and the "logged claim isn't a fact" thread — but those resolve against the live repo; this one only resolves against the world.

## A close criterion whose instrument can't fail — the check reads the same on success and on no-op (HO 503 / HO 506, Jul 2026)

A close criterion is only real if its instrument reads *differently* depending on whether the work happened. Two loops in 48 hours had criteria whose instrument reads **identical on success and on no-op** — so the loop can be "closed" without the work ever being done. Two mechanisms:

- **Self-removing (HO 503).** `test.skip`-on-empty: the check *deletes itself* when its precondition is absent, and Playwright reports a skip as not-a-failure. An under-seeded fixture exercises nothing and the suite goes green. (Its own entry is below.)
- **Saturated (HO 506).** The CA re-ingest loop's instrument was a **NULL-share recount** — but `null_shares` is **0 of 245**, already at its terminal value. It reads **0 → 0** whether the re-ingest locked in certified numbers or no-opped entirely. Any session in the three weeks since the primary could have run `reingest:primary-slate` against a **stale Ballotpedia** (which had not ingested the July-10 certified canvass) and closed the loop clean, with the instrument confirming success it never delivered.

**The near-miss from the same episode shows the spectrum.** CA-22's percentages matched to the tenth across stored / Ballotpedia / certified SoS (40.7 / 32.x / 27.x) — a **%-only** comparison would have read GO. The **vote COUNTS** are what exposed the staleness (74,321 vs certified 79,757; CA-13 stored at *roughly half* the certified total). That check *could* have failed — it just didn't discriminate on this particular data, which is the softer version of the same defect: an instrument that happens not to move, vs one that structurally can't.

**The tell, and why this is worth a named entry:** ask what the check reads **when the work didn't happen.** If that reading is the same as success, it isn't a check — it's a formality. Write the instrument to read differently on a no-op (here: a **vote-COUNT** comparison against the certified SoS file on one known seat, which reads *wrong* until the certified canvass is actually reflected).

**Two live confirmations, one arc, HO 644–645 — noted here rather than filed again, because they are this rule firing, not new rules.** (1) HO 644's `/electoral` control read **0 vs 0** on both candidate strings: equality by absence, indistinguishable from *"neither surface renders it"*. It was rescued by forcing the state into existence — `RaceMapCard` only mounts on `pinnedCell`, and `onStatePick` routes to the district modal, so the check had to pin Michigan by search before it could read anything at all. (2) HO 645 forced `card === null` on one live member to prove a degraded panel omits its two card-dependent blocks; **`0 blocks / 0 empty-shelled` on that member is trivially true**, so the reading only became evidence beside a control member in the same page load showing **2 blocks / 0 empty-shelled**. Both are the same shape: a number that would be identical if the work had never happened, made discriminating by adding the case where the thing *does* appear.

## Skip-on-empty guards invert a fixture's failure mode — the same line is honest against prod and silently green against a fixture (HO 503–504, Jul 2026)

A spec that reads `if (await x.count()) … test.skip(...)` is **honest against prod**, where zero rows can be genuine data variability (a race with no news, a member with zero amendments). Against a **fixture** — deterministic by construction, so a guard can never legitimately be needed — the same line means an **under-seeded fixture passes while exercising nothing.** Playwright reports a skip as not-a-failure, so the suite goes green. That is strictly **worse than the red-blindness the fixture was being built to cure**, and it is what killed the Phase-2 fixture at HO 503 *after* the bucket count (73 tests, **A 41 · B 28 · C 2 · D 2 · E 0** — 95% nominally servable) said build it. The number said go; the failure-mode analysis said stop, and the failure-mode analysis was right. **The corollary that outlived the verdict:** those guards are in the specs **today, running against prod** — so a surface that regresses to zero rows currently **skips its test and the run stays green.** HO 504 converted the one instance in `smoke.spec.ts` where empty means *regression* not *variability* — the `/electoral` cartogram, whose `.us-map-state` cells are static us-atlas topojson, never DB rows, so zero = the map failed to render — from a `test.skip` to a hard `toBeGreaterThan(0)`. `fit-finish.spec.ts` still carries the bulk of the guards and stays manual, by design. **See also** the *"close criterion whose instrument can't fail"* entry above: skip-on-empty is its **self-removing** form; HO 506's saturated NULL-recount is the other.

## Inverting a redirect: verify the new target does NOT redirect back, or you brick both routes at once (HO 501, Jul 2026)

Extracting `/news` off `/bills?mode=news` meant inverting a redirect: `/news → /bills?mode=news` became `/bills?mode=news → /news`. **The one failure mode that isn't recoverable by fixing forward:** if both routes ever redirect at each other — the old `/news → /bills` still live while the new `/bills → /news` deploys — every request ping-pongs between them and *both* routes are dead at once, with no page rendering to fix. You can't deploy your way out of a route you can't reach. **Rule: when inverting a redirect, confirm the new target renders (does NOT redirect anywhere) before pushing, and `curl -IL` both directions.** HO 501, verified on a local prod build: `/bills?mode=news&bill=…` → **exactly one** 307 → `/news?bill=…` → 200, and `/news` itself does **0** redirects (`num_redirects=0`). Ship the render + the inverted redirect as **one atomic deploy** (Next redeploys the whole route tree together) so there's no window where old-`/news` and new-`/bills` coexist.

## A half-finished refactor can leave a stub pointing the WRONG way — it reads as a finished feature (HO 500–501, Jul 2026)

The `/news` split was scoped as a greenfield route build. It wasn't: `app/news/page.tsx` **already existed as a redirect stub pointing INTO the very thing it was meant to replace** (`/bills?mode=news`). An earlier arc had half-started the split and abandoned it, leaving a stub whose *presence* read as "route exists, done" while its *direction* was backwards. So the real work was **inverting an existing arrow, not laying a new one** — a completely different risk profile (inbound-link-shaped, not query-shaped). **Rule: before scoping a route split, check whether the target route already exists AND which direction it points** — a redirect stub is not a finished route, and a file existing tells you nothing about which way the arrow runs. Same read-the-code-not-the-prose family as *The parked `/bills`-redesign plan claimed `getTopicDistribution` "no new query needed"* below (the premise was a claim; the file was the fact) — here the premise was "greenfield" and the stub file was the fact.

## Height-tuning a constant against a variable-height feed gives you one sample, not the distribution — don't re-tune upward on a favorable day (HO 493, Jul 2026)

`/lobbying` filing rows are **variable height**: a filing citing several bill chips wraps, costing ~33px per wrapped row, so the feed's rendered height depends on which filings happen to be recent (the feed is a recency window whose contents change daily). Tuning `PAGE_SIZE` to make the feed floor at the bounded rail (~551px), a **uniform-row measurement** said 14 was the largest fit — but with only 17px of slack, enough to absorb **zero** wrapped rows. 13 leaves ~50px, enough for one. Both floor the page at the rail *when they fit*, so 14 bought exactly one extra row in exchange for the section headers dropping below the fold on any day page 1 carried a wrapped filing. Chose **13**. **Generalizes: measuring a data-dependent layout samples one state, not the range — a constant tuned to a favorable sample silently loses its property on an unfavorable one. Don't re-tune such a constant upward on a day it happens to measure with slack; the slack is a property of that day's data, not the constant.** (This is why the `PAGE_SIZE=13` comment spells out the 14-vs-13 slack math — so a future low-chip-day re-measure doesn't "optimize" it back to 14.)

## Adding `overflow` to a list that carries a selected state breaks selection visibility — the selected item must scroll itself into view (HO 492, Jul 2026)

Unbounded, `/lobbying`'s selected issue-rail row was always on screen. Once the rail got a height bound + internal scroll (the height-compaction pass), scoping an issue low in the 79-item list re-rendered with that row selected **and the rail scrolled back to the top** — the selection was off-screen, invisible. **Rule: any list with a bound and a selected item needs the selected item to scroll *itself* into view on mount/selection** — `scrollIntoView({ block: "nearest" })` on the row's ref (in `IssueRailRow`, already a client component). `block: "nearest"` scrolls only the nearest overflow container (the rail), minimally; **verify the window doesn't scroll along with it** on a deep selection (checked `?issue=MON`, the last of 79: `window.scrollY` stayed 0, only the rail scrolled). If the window jumps, set the container's `scrollTop` directly instead.

## The `.mc-*` two-pane system has no height bounds — by omission, and it's a per-surface call, not a default (HO 492, Jul 2026)

The shared `.mc-pane`/`.mc-rail`/`.mc-content` grid (used by `/members`, `/lobbying`, and the `/bill/[id]` filing rows) has **no height bound anywhere** — panes are set by whichever column is taller. `/lobbying` now bounds *its* rail via `.lob-*`-scoped rules (element-owned classes on the same elements, so the shared `.mc-*` base rules stay byte-identical). `/members` deliberately does **not** bound its rail: its member roster is far taller than its committee rail, so a rail bound there would be a no-op. **Anyone extending the two-pane to a third surface should decide the bound per-surface, not assume either way** — and scope any bound to a surface-owned class (`.lob-*`-style), never onto the shared `.mc-*` (the mistake that broke `/bill/[id]` once before, HO 486-era).

## The per-request-dynamic invariant is load-bearing — and INCIDENTAL (no `force-dynamic` export backs it); a route slipping to static makes ages silently wrong, no hydration warning (HO 490; mechanism corrected + `/news` added HO 502)

The #418 fix computes each relative age **once server-side** (one `nowMs = Date.now()` per page, prop-drilled) and passes it to the client, so server and client always agree on the value. That correctness depends on a condition that holds today but isn't enforced. **Age-rendering routes are dynamic per-request, but INCIDENTALLY** — via `await searchParams` + uncached reads, **not** via an explicit `force-dynamic` export (there are **none** in the repo). The invariant holds only as long as that stays true: if a route's `searchParams` read is refactored away or a `revalidate` is added, it can go **static**, and the server-frozen `nowMs` becomes a **silently-wrong age with NO hydration warning** — both sides agree on the *stale* value, so nothing fires: no warning, no error, just a wrong "3d ago" baked hours or days earlier. The fix deliberately traded a loud, intermittent failure (#418) for a silent one under conditions that don't currently hold. **Verify by the build output's dynamic (`ƒ`) marker, not by grepping `force-dynamic`** (you'll find none, and conclude wrongly that the invariant is violated). **Verified set:** none of the static routes (`/committees`, `/races`, `/primaries`, `/members/pass-rate`) render a relative age, and no route sets `revalidate`; the feed/detail age-routes all show `ƒ` (dynamic) in `next build`. **`/news` (added HO 501, AFTER this HO 490 check ran — so it was never originally covered) renders relative ages** (`NewsRow` → `formatRelativeAge`/`ageHours` off the page `nowMs`); a fresh `next build` at HO 502 confirms **`ƒ /news` (dynamic)** — invariant holds. **If you ever add `revalidate`/`export const dynamic = 'force-static'` to a feed/news/detail route, or move an age-rendering component onto a static page, the clock freezes with it — recompute the age on the client or keep the route dynamic.**

## Dev cannot reproduce hydration mismatches naturally — a clean dev run proves nothing; force the straddle (HO 489, Jul 2026)

Chasing the #418 in dev, **9/9 loads of `/bills`, `/changes`, `/` came back clean** — zero hydration warnings. That is not evidence the bug is gone; it's **structural**: `next dev` never prerenders, and its SSR→hydrate gap is ~0ms, so a minute/hour/day-bucketed relative time almost never straddles a boundary between the two renders. Prod's real server→client latency (network transfer, cold starts) widens that window, which is exactly why the bug was **prod-only and intermittent**. **The technique that does reproduce it:** Playwright `addInitScript` advancing **only** the client's `Date.now()` (leave `Date.parse` intact so ISO parsing is unaffected) before hydration — the server renders at real time, the client hydrates in a later bucket, mismatch guaranteed and deterministic. That is what `scripts/diagnostic/hydration-probe-489.ts` does; re-run it with `CLOCK_OFFSET_MS=90060000` (~25h) to reproduce or to verify any future hydration work. **Rule: for any hydration bug, a clean natural dev run is worthless as a verdict — reproduce with a forced straddle, or you're testing nothing.**

## Prod React minifies hydration errors — chase them in dev, but only *with* the forced straddle (HO 489, Jul 2026)

Production React gives you `#418` with **no component name and no diff** — useless for locating the bad node. Development React prints the actual **server-vs-client text** and a **full component stack** (this is how HO 489 pinned the mismatch to `<StagePill age="…">` under `StagePillStrip`). So you must chase it in dev — but per the entry above, dev alone won't *reproduce* it, so the working setup is **dev (for the readable message) + the forced client-clock straddle (to trigger it)**. Either half alone fails: prod reproduces but won't name the node; natural dev names nothing because nothing fires.

## `Date.now()` read during render in a client component is a hydration bug by construction — enforce with a *required* param, not a default (HO 490, Jul 2026)

Generalizes past time: **any non-deterministic value read during a client component's render** (`Date.now()`, `Math.random()`, locale, timezone, `window.*`) mismatches between SSR and hydration by construction and must be **computed server-side and passed in as data**. The #418 fix made the three relative-age helpers (`formatRelativeAge`, `formatRelativeAgeLong`, `daysSince`) take a **required `nowMs`** — and *required, not defaulted*, is the load-bearing choice. A `nowMs = Date.now()` default would have let all 22 existing call sites compile untouched and let the next client-component age-format reintroduce the bug **silently, intermittently, prod-only**. Required means `tsc` rejects it, and CI runs `tsc` (HO 488), so the enforcement is mechanical and the bug *class* is closed, not just the instance. **When you find a render-time non-determinism bug, the durable fix is a required parameter that makes the compiler reject the next occurrence — a default just papers over today's instance.**

## Two hydration dead ends, recorded so they aren't re-derived — it's NOT the LAST SYNC stamp, and `/dashboard-v2` is NOT a static page (HO 489, Jul 2026)

Both were plausible root-cause theories for the #418, both wrong, both cost real time — written down so the next session doesn't re-walk them:

- **Not the `LAST SYNC` / HO 183 cycling timezone stamp.** `CyclingTimestamp` + `lib/zone-cycle.ts` are hydration-safe *by construction*: SSR and the first client paint both render **MT** (the reduced-motion/pre-mount static zone), the live clock-derived zone swaps in only in `useEffect` (post-hydration), and they format a **fixed `corpus.lastSync`**, not `now`. A rotating timestamp *looks* like the obvious suspect; it isn't.
- **Not static-page staleness. `/dashboard-v2` is a `permanentRedirect("/")`, not a static content page.** HO 488's build output listing `/dashboard-v2` as `○ (Static)` is the **static redirect stub** — the failure attributed to "dashboard-v2" is really the **home page `/` after the 308**. State this plainly: the build output *will* mislead the next reader exactly as it misled this arc into hypothesizing a two-mechanism (static-vs-dynamic) bug when there was one mechanism on three dynamic routes.

## Don't point the smoke suite at dev — `AUTH_SECRET` is missing there and the console-error assertions false-fail (HO 489, Jul 2026)

`next dev` emits `[auth][error] MissingSecret` on every route because dev `.env` carries no `AUTH_SECRET` (a dev-env config gap, backlog — not a code bug). **Correction (HO 581):** it does **not** "live in `.env.production.local`" — that file is a `vercel env pull` artifact whose values read blank (encrypted), never a source of truth; `AUTH_SECRET`'s real home is Vercel **Production** env (Production-scoped, so prod is fine — 24h of prod logs show zero `MissingSecret` — and only dev/previews lack it). The Playwright smoke specs (`e2e/smoke.spec.ts`) assert **zero console errors**, so pointed at `localhost:3000` they **false-fail `/bills`, `/changes`, `/dashboard-v2`** on the auth noise — failures that have nothing to do with the thing under test (and that masquerade as the #418 you might be hunting). Smoke's configured target is the live deploy for a reason; if you must run it against dev, filter the auth console error first or you'll chase ghosts.

## Pooled `cron_runs` percentiles across a fix boundary describe neither state — split at the fix (HO 487, Jul 2026)

The HO 487 trades verification pulled 14 days of `/api/sync` `cron_runs` and read the pool whole: **63% timeout, ~52s p50 elapsed** — which reads as an active, ongoing breach. But two fixes shipped *inside* that window (HO 480/481 lead-query hints, 07-18 14:32; HO 483 trades batch, 07-19), so the pool is half broken-state rows and half fixed-state rows and describes **neither**. Split at the HO 480/481 boundary the same rows read **79% timeout PRE → 14% POST** — fixed, and back on the documented ~1-in-5 soft-cap baseline. The pooled figure would have re-triggered a probe of something already solved. **The rule: before citing any percentile or rate off a `cron_runs` window, check whether a fix shipped inside the window and split at the boundary — a stat pooled across a fix boundary is an artifact, not current state.** This is the mirror of *The planning copy lags the live repo* below: there the stale input is a handoff; here it's a time-pooled metric that averages away the very change you're measuring.

## A shared component's grid class belongs on the component, not an ancestor-scoped selector (HO 486, Jul 2026)

Commit A of the `/lobbying` redesign gave `FilingRow` the `.mc-row` class and put its grid in `.lob-content .mc-row`. But `BillLobbying` renders the same `FilingRow` on `/bill/[id]`, **outside any `.lob-content` ancestor** — so those rows silently fell back to the base `.mc-row` grid (`1fr 320px 56px 64px 52px`, the members layout) and broke. The fix was a row-owned `.lob-filing-row` class. **The rule: when a shared component needs a grid/layout, the class lives on the component. An ancestor-scoped override styles the one surface you were looking at and breaks every other consumer.** Before changing a shared component's markup, enumerate *every* consumer (`grep -rn "<ComponentName" app/ components/`) and check each surface — this is now a `SKILL.md` pre-edit gate.

## Dead files poison "who consumes this?" audits — delete orphans in the commit that orphans them (HO 486, Jul 2026)

Commit A of the redesign orphaned `IssueDrill.tsx` but left it in the tree, and it still `import`ed `FilingRow`. So the consumer grep that should have caught the `/bill/[id]` breakage (above) returned `IssueDrill` as a live `FilingRow` consumer — noise that helped hide the *actual* live consumer. **The rule: delete an orphan in the same commit that orphans it. A dead file that still imports a symbol is indistinguishable from a live dependency in a grep-driven audit.** `IssueDrill.tsx` was removed in `0765aaf`.

## `npm run typecheck` is not covered by the ancestry pre-push eyeball (HO 485, Jul 2026)

The HO 485 probe pushed at `3ed533c` with a broken `npm run typecheck` (a `noUncheckedIndexedAccess` gap in the `pct` helper), and it sat undetected until the next session (fixed at `0614a66`). The pre-push ancestry eyeball (`git log @{u}..HEAD`) verifies *git hygiene* — right commits, clean fast-forward, no concurrent-session files — but says nothing about *build health*. **The rule: `npm run typecheck` clean is a pre-push gate on every commit, diagnostics/probes included** (`scripts/**` is in tsconfig, so a throwaway probe that doesn't typecheck fails the Vercel build — see the HO 297 entry). Now mirrored into `SKILL.md` alongside the ancestry eyeball.

## A component that writes a URL param must ship the inert variant on surfaces that don't read it (HO 486, Jul 2026)

Pre-fix, the `/lobbying` expand toggle would have shipped as-is on `/bill/[id]`, where a row click sets `?expanded=` but **no panel is wired to read it** — the caret flips and nothing happens. Resolved with an opt-in `expandable` prop: the reading surface (`/lobbying`) passes it, the non-reading surface (`/bill/[id]`) gets the inert row (the empty 16px caret cell stays so the grid is byte-identical across surfaces). **The rule: if a component writes a URL param, the surfaces that don't read that param get the inert variant, not the live control.**

## Lobbying rollup-blob stats lag the raw `lda_*` tables by up to one cron cycle — reconcile blob-to-blob (HO 485, Jul 2026)

The prod `/lobbying` header read 110,055 filings / 236,118 activities the same day the HO 485 probe read 112,068 filings / 240,887 activities off the raw tables. Not a bug: the header comes from the precomputed `lda_lobbying_rollup` blob (cron-computed), so it trails the raw tables by up to one refresh cycle. **Expected — don't log it as a discrepancy.** When comparing lobbying figures, reconcile blob-sourced against blob-sourced and raw against raw; never cross the two.

## The enacted helper closed the OR-lure's 5th sibling — and `idx_bills_enacted` isn't the stage_changed_at index HO 335 assumed (HO 481, Jul 2026)

Closing out the last known OR-lure instance in the enacted/lead cluster (see the HO 480 note below): `queryEnactedThisWeek` — the shared HO 232 helper feeding both the lead step and the ENACTED THIS WEEK banner — mis-planned the same way, and the 480 sweep left it alone as a shared helper with blast radius. The fix was hint-first (`INDEXED BY idx_bills_enacted`, Option A) and landed with no migration. Two field notes: (1) **The "obvious" index was the wrong column.** HO 335 recorded this helper as riding `idx_bills_enacted` cleanly; it doesn't. That index is `(congress, latest_action_date) WHERE stage='enacted'` — no `stage_changed_at` — so it serves the `stage='enacted'` seek but not the `stage_changed_at` window filter or the `ORDER BY stage_changed_at DESC`, leaving a residual in-memory sort. It still qualifies (the query's `AND stage='enacted'` matches the partial index's `WHERE`), and the sort is trivial over the few-hundred-row enacted set — but "there's already an index for this" is not "the planner can use it for THIS query." Read the index's actual key columns against the query's filter + sort before assuming. (2) **A partial index is a cheap, safe hint target.** Because `idx_bills_enacted` is `WHERE stage='enacted'`, forcing it bounds the scan to the enacted subset by construction — which made the Option B `stage_changed_at`-keyed index unnecessary.

## The OR-lured `MULTI-INDEX OR` mis-plan, 6th appearance — and `gatherLeadData` was the sibling `gatherReportData` (HO 407) never swept (HO 480, Jul 2026)

The `(is_ceremonial = 0 OR is_ceremonial IS NULL)` predicate keeps luring Turso's stateless planner into a `MULTI-INDEX OR` over the low-selectivity `idx_bills_is_ceremonial` (~most of the 16.8k corpus) + a `TEMP B-TREE` sort — ignoring the tight, already-sorted index the query actually wants. 6th appearance of the class (HO 405/406 summarize, 407 weekly-report, and now 480). The trap this time: **HO 407 hinted `gatherReportData`'s six `bills` reads but never touched `gatherLeadData`, the identical class in a sibling function** — so the class was declared closed at 407 while a live instance sat one function over. `INDEXED BY idx_bills_stage_changed_at` (and `idx_bills_introduced_date` for the intro count) forces the range scan; cold-EXPLAIN before→after is the only reliable check, since the plan is stable but invisible until you ask.

**Two things this appearance taught, beyond "hint it":** (1) **The symptom mis-named the cause.** `/api/sync` was timing out at the 55s wall, so HO 479 hypothesized the trailing step was slow (Gemini latency). It wasn't — cold-timing showed Gemini sub-second and the *DB read* cold-stalling to 12–20s. A wall-clock overrun is a budget symptom; it does not tell you which step, and a plausible latency story is still just a story until the cold-time splits DB from network. (2) **A mis-plan on a non-fatal step fails silently in a second place.** The lead step is wrapped `try/catch` (non-fatal — keep the prior lead). So when the transitions query cold-stalled to the 10s+10s `boundedFetch` double-timeout and *threw*, the route swallowed it and moved on — the dashboard lead had been **stale on every real-delta tick**, a quieter and longer-running failure than the 55s timeout that finally surfaced it. The visible symptom was the newer, smaller problem.

## `timeout` is a designed degraded mode, so cron liveness is row-in-window, not last-clean-success (HO 477, Jul 2026)

A `cron_runs` `timeout` row means the cron **fired and executed** — HO 139's 55s soft cap trips when a *trailing* step overruns *after* the primary work already committed (e.g. `/api/sync` reads `timeout` with bills ~1h fresh while its last clean `success` is ~37h back). So a health check keying "unhealthy" on last-*success* age false-alarms on every soft-timeout-resume route. Correct liveness = **any `success` OR `timeout` row within the route's window** (a true stop = no row at all), with `error`/`orphaned` as the hard-fail. This is why `/api/health` treats `timeout` as alive; the pre-build probe caught the false alarm on `/api/sync` + `/api/sync-votes` before the build.

## Markets health is keyed on `market_ticks` freshness, not the cron row (HO 477, Jul 2026)

Two reasons a status/row check fails for markets: the route logs one `route="/api/cron/markets"` for **both** the bare (`0 */4`) and fmp (`0,30 13-21`) crons (indistinguishable by the `route` column — only by payload symbol-count), and every bare run carries a **permanent POLY-SHUTDOWN chronicErr** (`"markets fetch failures: …"` on a `success` row). So `computeCronHealth` judges markets by `MAX(market_ticks.ticked_at)` — the literal "no `market_ticks` write in N hours" the backlog asked for — unhealthy iff ticks > ~9h stale OR the most-recent markets run is `error`/`orphaned`; a `success`-with-POLY-ghost is healthy and the chronicErr string is never consulted. (fmp-specific freshness stays banked — the shared `route` string can't isolate it without payload inspection.)

## `cron_runs` can't attribute a run to its scheduler — GET-vs-POST and 200-implies-Bearer distinguish a Vercel cron from its still-firing GitHub twin (HO 475, Jul 2026)

`cron_runs` records route / status / payload — **not** method, host, or user-agent — so a Vercel-cron invocation and a GitHub-Actions twin hitting the same route are indistinguishable in the table. To confirm *which* fired, use the Vercel request metadata (a Vercel cron is **GET** off the **deployment host** with the vercel-cron UA; a GitHub workflow was a **curl POST** off the canonical host), or the **200-implies-Bearer** signal: `/api/cron/markets` and `/api/cron/kalshi` 401 without `CRON_SECRET`, and Vercel only attaches the Bearer when the env var is set, so a **200** on those routes is a Vercel-with-secret run. This was the whole verification method for the HO 475 cutover (all three crons confirmed as Vercel GETs during the GitHub-overlap day, read from the Vercel runtime logs — `mcp get_runtime_logs`, scoped to the deployment id).

## A query-string Vercel cron registers as a distinct cron from its bare path (HO 475, Jul 2026)

`vercel.json` can carry both `{ "/api/cron/markets", "0 */4 * * *" }` and `{ "/api/cron/markets?source=fmp", "0,30 13-21 * * 1-5" }` — Vercel keys crons on the **full path string including the query**, so they schedule and fire independently (the feared "collapsed into one path" mode doesn't occur). Proven at the 20:00 UTC window: a bare 18-symbol GET and an `?source=fmp` 7-symbol GET landed 18s apart, both Vercel-attributed. (Related, recorded in the HO 475 roadmap block: the HO 314 `30 21` floor's "NOT firing" note was a **Hobby-era** artifact — it fires on Pro since HO 433, which is why HO 475 repurposed it in place rather than adding a new bare entry.)

## A list-only sync and a detail-hydration pass coexist on one table because `ON CONFLICT DO UPDATE SET` omits the hydrated columns — adding them to the SET clause re-nulls every hydrated row on the next bulk-refresh (HO 459, Jul 2026)

`nominations` is populated in two phases: a cheap list-only `sync:nominations` (every list-level field + the computed `disposition`) and an expensive per-part `--hydrate` pass (the detail-only `committee_system_code`). They share one table and one PK (`id`), and the list sync **re-upserts the whole corpus on any bulk-refresh day** (the `updateDate`-clusters-on-refresh behavior — the frontier re-fetch is idempotent). The two phases don't fight **only** because `buildNominationStatement`'s `INSERT … ON CONFLICT(id) DO UPDATE SET …` clause **explicitly omits `committee_system_code`** (and `nominee_count`): a re-upsert updates the list fields and **preserves** the hydrated value. The INSERT sets them NULL (a new row enters the hydration queue); the SET clause leaves them alone (existing hydration survives).

The trap: it is tempting, when adding the hydration, to add the new columns to the SET clause "for completeness." **Don't** — that re-nulls `committee_system_code` (and the `committee_hydrated_at` sentinel) on every bulk-refresh, silently un-hydrating the corpus and forcing a full re-walk. The rule generalizes to any **two-phase populate** on one table (cheap bulk sync + expensive enrichment): (1) the bulk sync's upsert SET clause must omit the enriched columns; (2) the enrichment needs a **sentinel column** stamped on *every* processed row — including no-result rows — so the "done, nothing found" case (here the ~2% of civilian PNs with no committee) exits the work queue instead of re-fetching forever; (3) a **partial index** over `WHERE <sentinel> IS NULL` (the HO 406 summarize-queue pattern) so incremental re-runs scan only the un-enriched delta. `committee_hydrated_at` + `idx_nominations_hydrate` are that mechanism.

## The nomination `/nomination/{c}/{n}` base endpoint is a stub for multi-part PNs — the per-part record (and its committee referral) lives at the list item's own `url` (HO 458, Jul 2026)

A nomination citation is `PN{number}-{partNumber}`, and the base detail endpoint `/nomination/{congress}/{number}` returns a **different record** than any specific part — for a multi-part PN it's a **stub**: `citation: "PN246"`, `partNumber: "00"`, one nominee's description, and **`committees` absent**. The parts' referrals are not on it. Each part is a distinct record reachable only via that list item's own `url` field (stored in `raw_json`): PN730-1 → African Development Bank, PN730-2 → Federal Labor Relations Authority — same PN, different committees. `committees` is itself a sub-resource `{count, url}` on every record, so reading the referral is a second fetch when `count > 0`.

This matters because **multi-part is the common case, not a tail**: 94.7% of civilian rows (786/830 in the 119th) live inside multi-part PNs. So any per-nomination detail hydration must key on `(pn_number, part_number)` and **follow the stored `raw_json.url` per row** — keying on `number` / the base endpoint reads the stub and misses the referral entirely.

The trap it sprang retroactively: the HO 454 source probe measured the civilian committee-referral rate by fetching `/nomination/{c}/{number}` (the base), so its civilian number was **confounded** — it read stubs for the multi-part majority. HO 458 re-measured on the correct per-part record and got 98% presence / 100% resolution, vs the 454 read that flagged the rate as suspect. **Lesson: a probe that fetches the wrong record measures the wrong thing** — when a resource has a composite key, confirm which key the detail endpoint honors before trusting a join-rate the probe reports (the HO 455 `(pn_number, part_number)` composite-key finding is the same lesson from the list side).

## `--backfill` resets offset, not the frontier — a persisted derived column can't be recomputed by re-running the sync on a populated DB (HO 456, Jul 2026)

A frontier-resume sync (`sync:nominations`, `sync:amendments`) derives its start from `MAX(update_date)` **regardless of the `--backfill` flag** — `--backfill` resets the *offset* (paging within a sweep), not the *frontier*. So on an already-populated DB, `--backfill` re-touches only the delta above the frontier, not the whole corpus.

This bit a disposition-classifier tune (HO 456): after fixing `computeNominationDisposition` (reconsider-tabled → `confirmed`), re-running `--backfill` recomputed the persisted `disposition` on only the ~5 rows above the frontier — the target row (`PN11-22`, whose `updateDate` predates the frontier) was never re-swept and stayed stale. The run's `dispositionResidual=0` was misleading: residual among the 5 touched rows, not the corpus.

**Corpus-wide recompute of a persisted derived column requires a full re-sweep** — either (a) `DELETE FROM {table}` + `--backfill` (empty DB → frontier resets to the floor → every row re-fetched and recomputed), or (b) a dedicated refloor/recompute path. Truncate + re-backfill is safe **only** for list-only, API-reproducible tables whose derived columns are the *only* computed state and whose deferred columns are already NULL (nominations qualifies: list-only, 100% reproducible, `committee_system_code`/`nominee_count` NULL). For a table carrying un-reproducible derived state, truncate is unsafe and a recompute path is needed. Any future classifier/disposition tune on nominations **or** amendments hits this — a re-run of the sync silently half-applies the change to the delta only.

## `pagination.count` overcounts the distinct-enumerable set — the completion gate keys on full enumeration, not count parity (HO 455, Jul 2026)

The Congress.gov nomination feed returns **duplicate list entries**: 5 byte-identical PNs in the 119th (e.g. `PN1022-12` listed twice — same nominee, same everything — 0.27% of 1,884). A `PRIMARY KEY`-deduping store correctly holds the **1,879 distinct** nominations, but `pagination.count` counts raw feed entries **including duplicates** (1,884).

The trap: `sync:nominations`'s `--repair` originally gated completion on `stored >= pagination.count` (1,879 ≥ 1,884 → false, forever). A deduping store can never reach a duplicate-inflated count, so the gate looped all passes doing nothing and reported `complete=false`. The amendments corpus happened to be duplicate-free, so its identical gate worked — nominations exposed the latent bug (`e175fd7` fixes the gate and the diagnostic to key on **full-enumeration `missing.length === 0`** over the distinct-enumerable set, reporting `duplicates = liveCount − distinctEnumerable` explicitly). This is the LDA-40 count-vs-enumerable drift in a new place: **the distinct-enumerable set is the corpus; `pagination.count` can overcount, so completion is "every distinct id enumerated is stored," not count parity.** (`amendments-sync.ts` carried the identical unaligned gate until **HO 570 C5** (`33dfb3e`) brought it to the same full-enumeration shape — harmless throughout only because its corpus stayed dup-free, which is why the latent bug needed nominations to expose it.)

## The amendments status-model NO-GO does not generalize — nominations' disposition model works because coverage is 100%, not 8.6% (HO 456, Jul 2026)

Amendments' persisted status model closed NO-GO (HO 452): only 8.6% carry a top-level `latest_action_text`, the silent 91% are filed-never-acted, and `/actions` recovers nothing. It would be easy to assume the same for nominations — it doesn't. **Nominations carry a top-level `latest_action_text` on 100% of rows**, with a clean deterministic vocabulary along a real procedural pipeline (Received → Referred → Hearings → Reported → Calendar → Confirmed / Returned / Withdrawn). Every PN has an unambiguous status.

The structural difference: amendments are *filed* en masse (vote-a-rama) and mostly never acted, so most have no disposition to record; a nomination is a single executive action moving through a defined confirmation process, always at a current stage. So the persisted `disposition` column (HO 455/456, `computeNominationDisposition`) is the pillar's **differentiator**, not a stopgap — the exact thing amendments couldn't support. The deciding factor for a persisted status model is coverage + vocab cleanliness, measured **per-source** — not a general "status models don't work." Don't let the amendments NO-GO discourage one on a source with clean, complete action coverage.

## No-top-level-action amendments are genuinely filed-never-acted — the `/actions` walk recovers 0% disposition, so the top-level scan is the ceiling (HO 452, Jul 2026)

The HO 448 entry (below) flagged the `/actions` walk as the deferred path to classify the silent 91% of amendments the top-level `latest_action_text` doesn't cover. HO 452 probed it and **closed it NO-GO**: walking `/actions` recovers **0%** additional dispositions.

The intuition it disproves: "a sparse top-level `latestAction` means the disposition is hiding in the `/actions` sub-resource." It isn't. A stratified 155-amendment walk found no-top-level-action == **filed-never-acted**, not "acted-but-not-summarized-at-top-level." Both the general silent stratum and the decisive `119-sconres-7` vote-a-rama stratum returned **100% submit/propose-only** action lists (0% terminal disposition), and — the guard that makes this trustworthy — an **empty residual**: the starter classifier left zero terminal-disposition actions unmatched, so the 0% is a real absence, not a classifier miss. The mechanism: a Senate vote-a-rama *files* ~1,131 amendments (sconres-7) and *votes on* ~24; the ~24 already carry a top-level action (they're part of the 8.6%), and the rest are never called up. So there is nothing in `/actions` to recover — the top-level `latest_action_text` scan is the **disposition ceiling**, and the HO 448/450 display-only dot already colors the full classifiable set. A persisted status enum would persist exactly what render computes, at the cost of ~doubling the backfill (~6,800 → ~13,600 requests) for zero coverage gain — which is why the status-model fork closed NO-GO (backlog DONE). If a future reader re-proposes walking `/actions` to "fill in" the missing dispositions, this is the record that it was measured and there is nothing there.

**What `/actions` *does* uniquely offer (not disposition):** `recordedVotes` on an action ({chamber, rollNumber, url, date}) — a clean amendment → roll-call-vote link, banked as a vote-linkage lead (a different feature, scoped on its own merits).

---

## Amendment `latest_action_text` coverage is 8.6%, not the probe's ~35% — vote-a-rama magnets dominate the filed-not-acted corpus (HO 448, Jul 2026)

HO 447 spec'd the amendments data layer on the HO 446 probe's read that ~35% of amendments carry a top-level `latest_action_text`. At full scale the real rate is **8.6%** — the probe sampled the recent `updateDate` frontier, which skews toward recently-acted floor amendments; the corpus as a whole does not. No build impact (`getBillAmendments` shows raw action text where present, a "no floor action yet" fallback otherwise), but it reframes what the amendments corpus *is*.

**The cause is distributional, not a coverage gap.** A handful of budget **vote-a-rama** vehicles dominate: `119-sconres-7` alone carries **1,131 amendments — 17% of the entire 6,788-row corpus** — and only 24 of those 1,131 have a top-level disposition. Vote-a-rama amendments are overwhelmingly *filed* (to force a vote / make a record) and never separately *acted* at the top level; their outcomes, when they get one, live in the per-amendment `actions` sub-resource. So the corpus-wide 8.6% is a couple of magnet piles of filed-not-acted amendments dragging the rate down, not a sync failure. (If a future reader "fixes" the low rate by re-running the sync, they've misread a distribution as a bug — same trap as the LDA 40-row residual.)

**Why it matters for the roadmap:** this is the concrete case for the deferred **status/disposition model** (backlog QUEUED). The display-only disposition dot (HO 448) can only color the 8.6% with unambiguous top-level phrasing (agreed to / rejected / failed); classifying the vote-a-rama tail (withdrawn / ruled out of order / tabled, and the vote-a-rama outcomes themselves) needs the `actions` walk the HO 447 sync deliberately skips — it would roughly double the backfill request count (~6,800 → ~13,600). A filed amendment is still floor-fight signal, so v1 shows it uncolored; the model is banked, not owed.

---

## LDA issue → CBT topic is deliberately lossy, single-valued, and non-partitioning (HO 444, Jul 2026)

The `LDA_ISSUE_TO_TOPIC` map (`lib/lda-issue-topic-map.ts`, 79 codes → 23 live topics) makes several calls that read as inconsistencies but are decisions — don't "fix" them.

**Abuse-code vs industry-code asymmetry.** ALC (Alcohol & Drug Abuse) → `healthcare` because it's LDA's *substance-abuse* code (public health); TOB (Tobacco) → `other` because it's the *industry* code (like BEV). The divergence is intentional — an auditor seeing ALC-in-healthcare and TOB-in-other should not collapse them.

**`elections` is legitimately empty.** No LDA issue code maps to it; force-mapping one would be worse than a visible gap.

**`other` (21 codes) is the honest residue,** not laziness: sector/profession codes with no policy-topic home (aerospace, automotive, gaming, tobacco) plus genuinely contested ones. Comprehension-over-coverage — the same posture as `enums.ts` `TOPIC_ALIASES`.

**Two contested calls, resolved on review (HO 444).** CPT (Copyright/Patent) → `technology`; FAM (Family/Abortion/Adoption) → `healthcare` — the closest single home, since the map is single-valued (a code maps to exactly one topic). `civil_rights` was the FAM alternative; the per-code comment in the map records it.

**Non-partition (a mechanism fact, not a bug).** A filing carries multiple issue codes, so `computeTopicCrosswalk` lets it land in multiple topic buckets — topic-filings sum (213,780) EXCEEDS the corpus (110,055). This is the same property the native issue bars already have; the `/lobbying` section header discloses it. If a future reader "reconciles" the topic sum to `stats.filings`, they've broken the multi-code semantics.

## The oversized side tables invert the row-fetch-vs-sequential-scan calculus — precompute into a blob beats request-time SQL (HO 437, Jul 2026)

HO 340 established that a non-covering `USING INDEX` row-fetches (a clean plan ≠ a fast query; an unbounded aggregate must be COVERING) — on the 16k `bills` table that was ~20s. The `lda_*` tables are **7–14× `bills`** (108k filings / 233k activities / 174k links), and at that scale random-row-fetch and sequential-scan cost **diverge hard**, which is why the `/lobbying` surface (HO 437) is served from a precomputed blob, not request-time SQL:

- **Whole-table aggregates that row-fetch (non-covering): 30–90s+ cold** — `COUNT(DISTINCT registrant_name/client_name)` 34–45s; the issue-bars `GROUP BY` over 233k >90s.
- **Per-code drill queries that join back to `lda_filings` + hydrate: >25s cold even at `LIMIT 10`** (the auto-selected top code would 500) — same trap, one table deep.
- **Covering indexes DO flip stats/bars to `USING COVERING INDEX`** (verified) **but do NOT rescue the join-with-row-fetch drill** — it crosses `lda_activities → lda_filings`, and no single-table covering index spans a join.
- **Three full SEQUENTIAL reads are fine:** filings 40.8s + activities (index-only) 16.6s + activity_bills 39.1s ≈ 96s, then JS does the whole join + aggregation in memory. The shape this Turso is fast at.
- **Deep OFFSET on a live feed is unsafe regardless of index:** `OFFSET (page-1)*n` walks everything before the window; the 108k-row tail measured **12.3s > the 10s cap** → 500 (the pager even linked to it). Clamp live feeds to a recency window.
- **The per-bill drill is a second, sharper confirmation (HO 439 probe):** the worst bill (`119-hr-1`) seek+hydrate is **44.5s cold**, decomposing **seek 461ms / filing-fetch 18.2s / hydrate 25.9s / JS-aggregate 30ms** — a bounded index seek is cheap and *all* cost is the random row-fetch, exactly as this entry predicts. **`EXPLAIN` still can't price it, only timing can:** warm ran *slower* than cold (93s), so the cold/warm delta carries no signal — the cost is per-chunk round-trips over random rows, high-variance.

**The durable rule for the next oversized side table: full-read-plus-JS-precompute into a `dashboard_state` blob beats clever request-time SQL — start there, don't relearn it.** Generalizes the HO 340 `USING INDEX ≠ USING COVERING INDEX` entry: its covering-index fix holds within one table; across a join on oversized tables, precompute is the answer. **Threshold nuance (HO 440):** on a **fat-tail** distribution (p99 159, max 8,048) the answer isn't all-precompute or all-live but **hybrid — precompute the tail above the point where the workload exceeds the live budget, live-serve the long tail below it, sharing one aggregation function so the rankings match whichever path a bill takes** (≥150 filings → `lda_bill_drill` blob, <150 → live `getBillLobbying`).

**Per-filing shape reference (HO 485 probe, n=112,068 filings / 240,887 activities — raw tables, blob trails):** the *single-filing* expand read is the opposite of the per-bill drill above — it's a PK-prefix seek on `lda_activities` (`WHERE filing_uuid = ?`, `SEARCH … USING INDEX sqlite_autoindex_lda_activities_1`), **75ms cold** worst case (a 31-activity omnibus LD-2), typical 29–85ms; a bounded seek on a *known* key, not the HO 439 random-thousands-of-rows fetch. The panel-sizing shape: **activities/filing p50 2 · p90 4 · p99 10 · max 31** · **description length p50 95 · p90 410 · p99 1,838 · max 24,447 chars · 0.0% empty** · **resolved bills/filing p50 3 · p90 12 · p99 65 · max 449**. **`lda_activities.bill_ids` is the raw extracted JSON and is a superset of the resolved rows in `lda_activity_bills`** (44 vs the resolved subset on the worst row) — always chip bills from the resolved table; the raw JSON produces dead links.

**Cost-probe the shape you'll actually ship — joins included — not its cheapest component (HO 543→544).** The HO 543 STEP-0 probe timed the VOLUME sort as a bare `GROUP BY filing_uuid` over `lda_activities` (index-only, **340–440ms**) and read GO. But the *shipped* feed can't render off that agg alone — it has to join back to `lda_filings` to hydrate the row (registrant/client/dates), and the naive shape (LEFT JOIN from `lda_filings`, order by the joined count) planned an **AUTOMATIC COVERING INDEX on the materialized agg → ~18s cold** (a mid-build EXPLAIN caught it; the fix drives from the agg, INNER JOIN, PK-seeking into `lda_filings`, dropping the invisible ~295 zero-activity filings). The rule: **a probe that measures an aggregate *in isolation* has not measured the feed query that joins back to hydrate rows** — price the whole statement, joins and all, or a "GO" on the cheap component hides a 40×-slower ship. This is a sibling of the HO 340/437 entry above (*a clean `EXPLAIN` says nothing about cold latency; an unbounded aggregate must be COVERING; on oversized side tables precompute beats request-time SQL*) — same failure family, one layer up: there the plan looked clean but the *scan* was slow; here the *component* was fast but the *join* was slow. Both are "the thing you measured isn't the thing that runs."

## `-webkit-line-clamp` + `white-space: pre-wrap` counts hard newlines as lines — so a char-threshold can't gate a clamp safely; render UNCLAMPED below the threshold (HO 545, Jul 2026)

The `/lobbying` expand-panel LD-2 description clamps to 4 lines closed (HO 545). Two facts about the clamp, both non-obvious:

- **`pre-wrap` does NOT defeat `-webkit-line-clamp` in Chrome** — the HO 545 handoff flagged the risk that `white-space: pre-wrap` might make the clamp show all lines (an old WebKit bug). It doesn't: CDP-measured the closed box at `clientH:88` (exactly 4 lines × 18px + 16 padding) with `scrollH:6280` clipped. The clamp engages fine with pre-wrap. (Aside: Chrome computes the `display` of a working `-webkit-box` + line-clamp as `flow-root`, not `-webkit-box` — a normalization, not a failure; judge it by `clientHeight`/`clipped`, not the computed `display`.)
- **The real trap is the inverse — pre-wrap makes the clamp count *hard newlines* as lines.** So the visible line count is `wrapped-lines + hard-newlines`, which a **character-length heuristic cannot predict**: a 150-char description with two mid-text `\n`s can be 5 visual lines and clip at 4, while a 260-char single-run description is also ~5 lines — same clip, wildly different char counts. The CDP-measured column here is 56 chars/line (4 lines ≈ 224 chars), so a naive "clamp everything, show a SHOW MORE only above ~280 chars" would **silently clip** every below-threshold description that happened to wrap or break past 4 lines, with no reveal control — a data-hiding bug.

**The rule: when a clamp's closed height can't be predicted from the data server-side, render BELOW the "offer a control" threshold UNCLAMPED, not in the bare clamped state.** In HO 545, below-threshold text renders in the `--open` (unclamped, bounded-420px-scroll-it-never-reaches) state — clip-proof regardless of column width or newline placement — and the char threshold (250) is demoted to a purely cosmetic "is this long enough to bother offering a collapse" line, never a correctness gate. The clamped state is only ever entered for text the control can un-clamp. Generalizes to any `-webkit-line-clamp` over free text with preserved breaks: the clamp is safe only when a visible affordance can always reveal the hidden lines.

## A `LIKE '%term%'` over SHORT columns is not the bills-LIKE trap; and a search filter FORCES the streaming sort path (HO 546–547, Jul 2026)

Two findings from wiring registrant/client search onto the `/lobbying` corpus feed, both counter to a plausible assumption:

- **Short columns make substring search cheap — the `bills_fts` lesson does NOT generalize by row-count.** The standing rule (HO 335/336) is "a leading-`%` `LIKE` full-scans and cold-aborts → use FTS5." But that was earned scanning `bills.title`+`summary` (hundreds–thousands of chars/row). `lda_filings.registrant_name`/`client_name` avg **25 chars**, so a `%term%` scan of **112k** rows is **~700ms** worst case (zero-match full walk) — 14× under the 10s wall — even though 112k ≫ bills' 16k. **The cost is bytes-scanned, not row-count.** FTS was therefore **probed and REJECTED** (HO 546): it would 22×-over-index the heavily-repeated names (5,201 distinct registrants across 112k filings) AND add a delete+reinsert trigger to the `FLUSH_AT=100`-tuned LDA sync write path — all cost, zero benefit over a plain scan. **Don't re-propose FTS here.** The banked fallback if `%term%` ever climbs is a **distinct-name lookup table** (tiny), not FTS. Corollary: before reaching for FTS, price the actual `LIKE` — a short-column scan may already be sub-second. **HO 598 CORRECTION (Aug 2026) — the conclusion has expired and the DELTA IS UNATTRIBUTED.** Co-located, cold, unbounded client, 90s-spaced: the zero-match full walk is **91.3s** worst (also 56.0s), and — the number that reframes it — a `COUNT(*) WHERE registrant_name IS NOT NULL`, a name read with **no predicate to evaluate**, is **86.3s** (also 47.9s). So the LIKE is a passenger; the **walk** is the cost, and the principle above ("bytes-scanned, not row-count") is exactly right — it is the conclusion drawn from it that broke. **Do NOT read the ~700ms → 91.3s gap as a platform regression.** This entry records **no measurement conditions for the 700ms** — no cold/warm, no co-located/laptop, no spread — while the entry immediately below it (same arc, same surface) distinguishes *"a TEMP B-TREE at **7.8s cold**"* and even reasons that search is *usually served cold*. The arc separated cold for one number and not for the other, so the gap is **unexplained between corpus growth (112k → 129k, only 1.15×), measurement conditions, and platform behaviour**, and nothing here can apportion it. Run-to-run spread today is ~2×, so the honest finding is a **30–90s band**, not a ranking inside it. The banked fallback stands and is now the measurement-backed candidate: a distinct-name lookup table (**5,326 registrants + 22,422 clients = 27,748 distinct names** vs 129,401 filings), which keeps substring semantics. **FTS: REJECTED AGAIN (HO 598), on a NEW reason that supersedes both the HO 546 reason above and the HO 598 fallback plan.** The earlier arguments were about cost (over-indexing repeated names, a trigger on the sync write path) and about semantics (FTS5 is token-prefix, so `%oeing%` stops matching "Boeing"). Those still stand, but they are no longer the deciding ones. **The deciding one is that FTS does not remove the need for routing.** HO 598 measured that the shipped walk and any candidate-set approach have MIRROR cost profiles: the walk short-circuits early when matches are DENSE and walks everything when they are SPARSE; a candidate-set path (name lookup, or FTS) is cheap when SPARSE and expensive when DENSE, because a dense term still yields tens of thousands of rows to sort by `dt_posted`. **FTS fixes the sparse half — which is the broken half — and needs routing for the dense half exactly as the name table does.** So both solve the same half and both need the same routing, and at that point the name table wins on every remaining axis: it is already built, live and maintained; it keeps SUBSTRING semantics; and it needs no new index type, no triggers on the `FLUSH_AT=100`-tuned write path, and no rebuild. FTS would buy a faster predicate in exchange for a user-visible `%oeing%` regression and a fresh build, to solve a half that is already solved. **Do not re-propose it without a reason that engages the routing argument.**

- **A search filter on an agg-driven sort FORCES the cheap streaming path.** `/lobbying`'s two sorts diverge under a `LIKE`: RECENT streams `idx_lda_filings_dt_posted` and the `LIMIT` short-circuits once the page fills — a `%term%` filter stays a **plain SCAN** (34–697ms; the OR over two *unindexed* name columns can't trigger the MULTI-INDEX-OR cold-stall of HOs 405/407/479/480 precisely because there's nothing to misuse). VOLUME is the agg-driven INNER JOIN (`GROUP BY` over 241k `lda_activities` → PK-join): a `LIKE` there **defeats the `LIMIT` short-circuit** — results are ordered by activity-count, so collecting 25 that *also* match walks deeper, and a rare/zero-match term walks the WHOLE materialized agg → a **TEMP B-TREE at 7.8s cold** (HO 547 DECIDER). Compounded by `q` making `unstable_cache` keys unbounded → search is *usually served cold*, so 7.8s is the *typical* number. **Resolution: search FORCES RECENT** (the query overrides `sort→recent`; the UI disables VOLUME). The rule: **a filter that can't ride the sort's index turns a streaming `LIMIT` query into a materialize-everything sort — measure the filter against each *actual* sort path, not just the cheapest.** (Sibling of the HO 543→544 "cost-probe the shape you'll ship" entry above: there the join, here the sort.)

## `lda_filings.dt_posted` is posting-date, not filing-period — which is exactly why resume-from-frontier is gap-safe (HO 435, Jul 2026)

`dt_posted` is when the LD-2 was *posted*, not the quarter it covers, so a late-filed old-quarter report posts in the current period. The sync's resume frontier is `MAX(dt_posted)` per `(filing_year, filing_type)` — trustworthy precisely because every shortfall is **trailing** (a new filing always posts at "now"), never interior: an arrival can only land *past* the frontier, never behind it. So the per-combo `MAX(dt_posted)` is a safe frontier over the offset-based DRF pagination — no stored cursor needed.

## The 40-row LDA residual (0.037%) is DRF count-vs-enumerable drift, not a gap — the forward cron won't chase it (HO 435, Jul 2026)

On the four closed 2025 quarters the DRF `count` header exceeds what pagination enumerates by 40 rows total — withdrawn/superseded filings counted but not paginated. Not a coverage gap: the DB holds the newest filing in each quarter, and since the sync resumes at `MAX(dt_posted)` it never re-walks closed quarters. Accepted; a targeted per-quarter rescan is a cheap future option if the exact count ever matters.

## A sub-100% LDA bill-join rate is a corpus boundary, not extraction failure (HO 435, Jul 2026)

277 distinct non-joining bill IDs, **0 malformed**. ~64% are prior-Congress references the current-window extractor stamped 119th; ~36% are unsynced/withdrawn 119th bills. So activities-with-a-bill topping out below 100% reflects the `bills`-table boundary (current-Congress synced bills), not a parse miss — don't chase it as an `extractBillIds` bug.

## Sustained LDA backfill against prod Turso surfaces as ~3-min all-timeout windows, not `SQLITE_BUSY` — it's latency, not locks (HO 435, Jul 2026)

A heavy paced backfill against the shared prod Turso periodically hits ~3-minute windows where every request (reads **and** writes) times out — never a `SQLITE_BUSY` / lock error. It's connection latency under contention, not lock contention. Burst-and-rest pacing (FLUSH_AT 100, dbRetry 8, `loadValidBillIds` 20-attempt at-startup SPOF budget, pageDelay 400ms, 45s cooldown every 500 filings) dodges what a continuous grind trips — writes arrive in bursts with recovery gaps. This is the standing tuning profile for any heavy prod-Turso backfill.

## LDA "most-lobbied bill" must count distinct filers, not raw activities — `119-hr-1` skews ~8:1 (HO 435, Jul 2026)

`119-hr-1` carries **11,567 raw activities from only 1,506 distinct filers** — one flagship bill draws many near-duplicate activity rows across a registrant's clients/periods. Any "most-lobbied" ranking off raw `lda_activity_bills` / activity counts is dominated by this skew; count **distinct filers** instead. (Feeds the HO 437 filer-weighting thread.)

**Correction (HO 440):** the four counts on `119-hr-1` are **11,567 raw activities / 8,048 distinct filings / ~1,506 distinct registrants / 2,878 distinct clients**. The "1,506 distinct filers" above is **distinct registrants** (what `lda-coverage-435.ts` measured per bill), **not** distinct filings — so it is *not* the row-fetch workload figure. The HO 439 probe sized the per-bill blob against **8,048** (distinct filings), and the `/bill/[id]` drill both ranks entities and heads its count by **distinct filings** — de-skewing multi-activity filings, a different axis from the distinct-registrants de-skew this entry describes for a bill-vs-bill "most-lobbied" ranking.

## The polarization-over-time chart has a caucus/registration seam — two party sources, deliberately not line-connected (HO 428, Jul 2026)

`PolarizationOverTime` draws its curve from two different party sources and does **not** bridge them. The historical **line** (through the 118th / 2023) reads `polarization_history` — Voteview `party_code` 100/200, i.e. **caucus**. The **current-Congress dot** (2025 / 119th) is a separate live pair from `getPolarizationBand` — `members.party`, i.e. **registration**. They agree to three decimals (both gaps 0.92 — Kiley is the only member who differs between caucus and registration, and one member doesn't move a median; see the 0.92/0.92 entry below), so the seam doesn't visibly render. But the line and the dot are **not connected across 2023→2025** — connecting them would draw one continuous curve through two different party rules. This is deliberate, not a data gap: the history table can only be caucus (departed members of past Congresses aren't in `members` to read a registration from), while the live band is registration by design. Same caucus-vs-registration distinction the Kiley finding surfaced at HO 422 (Voteview follows caucus).

## The midcentury polarization low is per-chamber, not the mockup's shared 1961 (HO 428, Jul 2026)

`PolarizationOverTime` places its dashed "midcentury low" guide at the **min-gap Congress computed live from the drawn line, per chamber** — not a hardcoded year. On real Voteview data that's **House 1947 (gap 0.50)** and **Senate 1943 (gap 0.47)**: the minima differ by chamber and both predate the mockup's single hardcoded **1961** guide. Same lesson as the mock-window entries — an illustrative mock value is not the data. (Confirmed via `scripts/diagnostic/polarization-history-coverage.ts` + a read-only min-gap query over congress 46–118, the drawn range.)

## The Senate is as polarized as the House on dim1 — both chamber gaps read 0.92 (119th), against the "calmer chamber" assumption (HO 424/425, Jul 2026)

The chamber polarization band (HO 424) and the `/members` dotplot (HO 425) both measure the D-median-to-R-median distance on DW-NOMINATE `dim1` for the 119th, and **both chambers come out at 0.92** — the Senate is not the calmer chamber the common assumption expects, and the two surfaces agree by construction (band-vs-strip cross-checked, 0 `member_ideology.chamber`-vs-`members.chamber` mismatches across 552 rows). Two consequences:

- **Don't hardcode the over-time mockup's illustrative caption** (Senate 0.81 / House 0.88) — those were made-up endpoints for the ship-3 mockup and don't match real data. The over-time chart's right-edge dots must read the **live** current-Congress gaps from `getPolarizationBand` (`0.92`/`0.92`), not the mockup numbers (backlog, ship 3).
- Coverage at ship: **551 scored / 1 unscored** (the single known NULL-`dim1` member, too few votes).

## A client-island chart can't import `lib/queries`' `median()` or any server helper — it drags `next/cache` into the client bundle (HO 425, Jul 2026)

`IdeologyStrip` is a `"use client"` island (it needs hover + click interaction), and it derives strict-D/R median ticks from exactly the dots it draws. It **cannot** reuse the server-side `median()` in `lib/queries.ts` (or any of that module's helpers) because `lib/queries.ts` imports `next/cache` (`unstable_cache`), which is server-only — importing it into a client component pulls server code into the browser bundle. So the strip **pins the identical strict-D/R method inline** (sort ascending; odd → middle, even → mean of the two middle; independents plot as dots but sit in neither median) rather than sharing the function. The numbers still agree with the band's server-computed rails because the *method* is identical, not because the code is shared. The next client-island chart does the same — copy the method, keep it identical to the server version, so the two never drift.

## Voteview `party_code` follows caucus, not registration — the ideology diagnostic false-positives on independents (HO 422, Jul 2026)

DW-NOMINATE's `party_code` (100=D / 200=R / 328=I) reflects a member's **caucus / voting coalition**, not their legal party registration. So an **independent who caucuses with a major party reads as that party** in Voteview, and it *disagrees* with `members.party` (which follows registration) for exactly those members — and **both sides are correct**, not a data error.

- **Kevin Kiley (K000401, CA-03)** is the current instance and the whole reason HO 420 mis-logged a "Kiley party bug." He **switched Republican → Independent on 2026-03-09** — confirmed by **both** Congress.gov `partyHistory` (a `{partyAbbreviation: "I", startYear: 2026}` entry ahead of his `{R, 2023–2026}` one) **and** congress-legislators `party_affiliations` (`2026-03-09 → 2027-01-03: Independent, caucus: Republican`). He **caucuses Republican**, so `members.party='I'` (registration, correct) and Voteview `party_code=200`/R (caucus, also correct). `sync:members`' `pickCurrentParty` → `normalizeParty` derived `I` faithfully from the most-recent `partyHistory` entry — **no derivation bug.**
- **King (I-ME) and Sanders (I-VT) are the standing Senate pattern** — registered independents who caucus Democratic, coded 100/D by Voteview. Any future independent trips the same gap.
- **Consequence for the diagnostic:** `scripts/diagnostic/ideology-coverage-419.ts` compares `party_code`→letter against `members.party` by **string equality**, so it has a **structural false-positive class** — it flags every such independent as a "disagreement" on every run. The fix is to compare `party_code` against **caucus**, not registration (backlog QUEUED). **Do NOT** "correct" `members.party` to match Voteview for these members — that would overwrite the accurate registration with the caucus label (the HO 422 trap that was almost walked into).

## Voteview member CSVs — the `bioname` comma-shift trap, native `bioguide_id`, and the full-`members` gate (HO 419, Jul 2026)

Three field notes from the Voteview DW-NOMINATE data layer:

- **Voteview member CSVs shift every column right of `bioname` on a naive split.** `bioname` is a quoted field with an embedded comma (`"ROGERS, Mike Dennis"`) positioned **before** `bioguide_id` and every `nominate_*` field, so `line.split(',')` reads first-name fragments into `bioguide_id` and slides `number_of_votes` into `conditional` — **silent** score corruption, no error thrown. Quote-aware parsing + **header-keyed** column indexing (never by position) is mandatory; `scripts/voteview-source.ts` does both. Demonstrated live during HO 419: a verification `awk -F,` split produced fake "duplicate bioguides" (first-name fragments like `Mike"`, `Adam"`) and 400-plus `conditional` values (shifted vote counts) — the corruption looks like real data.
- **Voteview carries `bioguide_id` natively — join `member_ideology` to `members` on bioguide directly.** The HO 402 crosswalk's ICPSR bridge is **not** the path for ideology; that was the pre-verification assumption (the "~60% via ICPSR" figure was measuring the crosswalk's ICPSR *fill*, not this join) and it's retired. `icpsr` is still stored in `member_ideology` — but for a **future** join to Voteview's `votes` / `rollcalls` files (roll-call positions, `HSall_votes.csv` on `icpsr`), not for the members join.
- **`sync-ideology` gates on the full `members` table, not `is_current=1` — the asymmetry with `sync-fec` is deliberate.** The gate is `bioguide_id IN (SELECT bioguide_id FROM members)`, so a member who served in the 119th, voted, then departed (still in `members` with `is_current=0`) **keeps** their DW-NOMINATE row — historical scores are valid and useful. That's why matched (**552**) exceeds `is_current` (**537**) and why the coverage diagnostic reads **over 100%** against the `is_current` denominator. `sync-fec` does the **opposite** (filters `is_current=1`, departed members drop out — see the FEC note below) because campaign-finance rows are current-cycle-scoped. Don't "reconcile" the ideology gate to `is_current`; the two syncs answer different questions.

## FEC `by_size` is election-cycle-keyed, totals are reporting-cycle-keyed — plus the member FEC-identity override machinery (HO 415/416, Jul 2026)

Five field notes from the FEC member-fundraising completion arc:

- **`by_size` keys to the election cycle; totals key to the reporting cycle — opposite axes.** `schedules/schedule_a/by_size/by_candidate/` returns a candidate's Schedule A split **at their election cycle**, so an off-cycle senator (Class 1/3, up 2028/2030) is **empty at the current year 2026** and populated at their election year — query it via `nextElectionYear ?? CYCLE`. Totals (`/candidate/{id}/totals/`) are the **inverse**: they resolve at the reporting cycle regardless of class (Alsobrooks, Class 1/2030, has `totals@2026`). **Do not extend the cycle logic to the totals path** — it's a fix for a bug that isn't there. Barrasso empty at **both** 2026 and 2030 confirmed totals aren't cycle-keyed (his is an upstream FEC gap). This keying bug — not rate-limiting — was the entire "463/530 by_size coverage gap"; fixed to floor 0.
- **No totals ⇒ no by_size (structural gate).** `sync-fec` fetches by_size **only after a fresh/successful totals call**, so a member with an upstream totals gap can't get by_size populated even when it's independently available — totals fails first and short-circuits the loop iteration. Barrasso is the worked example (valid id, by_size unreachable because totals returns empty).
- **Member FEC identity overrides live in `data/fec-candidate-overrides.json`**, consulted by `sync-fec` **before** the chamber-derived resolve — the **second** `data/` override the resolver consults after `senate-special-elections.json` (both are "the resolver checks a `data/` file before its default"). Two reasons a member lands there: a **House→Senate switcher** (the resolver keys office off `chamber='house'` and re-finds the dormant House id forever), or a **scoring tie** between a stale and a live id (Marshall — his House-era `H6KS01179` and live `S0KS00315` both classify office=S and tie at 6 in `scoreCandidate`, so first-wins re-picks stale; a plain re-resolve can't break the tie). Entries are **time-bound** — drop on bid-exit / departure.
- **The switcher display tag is computed, not stored.** The "Senate 2026 campaign" tag on the fundraising line derives from the resolved `fec_candidate_id` being **S-prefix while `members.chamber='house'`** — no hand-maintained flag. Correctly-chambered senators (Marshall, `chamber='senate'`) render plain; the tag keys off the **mismatch**, not off override-file membership.
- **Departed members drop out of FEC sync via `is_current=1`** on `fetchPendingMembers` (mirrors HO 411's `backfill:races` guard). Verified `sync:members` flips departed members to `is_current=0` correctly (Grijalva deceased, Greene resigned — both read 0), so the filter is the whole fix — **no upstream staleness bug** (this was the HO 402-family worry; settled).

## Senator election years derive from `senate_class`, not term math; `backfill:races` self-heals incumbents (HO 411/412, Jul 2026)

Three field notes from the integrity arc that closed HO 404 — the non-obvious parts a future session would trip on:

- **The year-pair comes from Senate class, not term math.** `members` now carries `senate_class` (from the last `terms[]` entry in `legislators-current.yaml`; **NULL for House** — House has no class). Congress.gov carries **no** class, so `sync:members` pulls it from that YAML in the same run (one GET + local parse, the `sync:crosswalk` idiom). `next_election_year` / `current_term_end_year` derive from the class via `lib/derive-term.ts` **residue math** (class 1≡2, 2≡4, 3≡0 mod 6; the next election is the smallest year ≥ the current cycle with the right residue, **computed from `now`** so it doesn't rot at the November boundary — past election day, the class rolls to the next cycle). The old `senateTermStart`/`senateNextElection`/`senateTermEnd` helpers **survive only as the fallback** for departed senators absent from the YAML (no class available) — **don't delete them thinking they're dead.** Special elections (`data/senate-special-elections.json`, keyed by bioguide, **cycle-scoped + self-expiring**) legitimately break `ney = ctey − 1` (OH/FL 2026: `ney=2026, ctey=2029`) and are checked **ahead of** the class default; the standing guard exempts them from the invariant check.
- **`backfill:races` self-heals incumbents.** It's `INSERT … ON CONFLICT(id) DO UPDATE SET incumbent_bioguide_id = excluded.incumbent_bioguide_id` — **scoped to that one column** (never touches rating/margin/`incumbent_running`/roster) — with `AND m.is_current = 1` in the SELECT (so a departed senator's fallback year can't seed a race incumbent or recreate a two-at-2026 ambiguity), and `seed:races` runs **after** it so curated overrides (the S-OK Armstrong pin) win last. The HO 412 run corrected **16 future-cycle cards beyond CO** (S-TX-2030 Cornyn→Cruz, S-OK-2028 Mullin→Lankford, S-CA-2028 Schiff→Padilla, …) in one pass — so the 2028/2030 surface now self-corrects on every backfill, not just the 2026 cycle. That's the property that keeps this bug class from recurring. Safe only because `is_current=1` makes each race id map to exactly one member (0 ambiguity, verified) — otherwise the `SET` would be nondeterministic. (Gotcha: the switch from `INSERT OR IGNORE` means non-PK constraint violations now error instead of being silently swallowed; the SELECT's NOT-NULL filters keep that from firing.)
- **The standing guard.** `scripts/diagnostic/senator-year-audit-410.ts` is the permanent regression probe (now committed). An internal-only `ney = ctey − 1` / even check catches just **1 of 18** drifted rows — the **class cross-check** catches all of them, which is why the guard reads `senate_class` and sources specials from the JSON rather than any hardcoded year map. Its expected values are computed from the same `lib/derive-term.ts` helper the sync uses, so the guard itself **doesn't re-rot** after November.

## Race-card incumbent is derived from `members.next_election_year`, not seeded — and `races` has no seat-type column (HO 408, Jul 2026)

The incumbent shown on a `/races` card is **not** in any seed array — `backfill-races.ts` sets `races.incumbent_bioguide_id` (via `INSERT OR IGNORE`) to the senate member whose `members.next_election_year = <cycle>`, with **no cross-check against that member's `terms[].class`**. So a wrong member-year silently produces a wrong race incumbent. First caught instance: `S-OK-2026` derived to **Lankford (`L000575`)** — his row says `next_election_year=2026` though he's Class III / 2028 — instead of the Class-II seat held by appointee **Armstrong (`A000383`)**. Fixed (HO 408) with a hand-authored `incumbent_bioguide_id` override in `races-seed.json`, applied *over* backfill's derivation by `seed-races.ts` (a conditional UPDATE that sets **only** that column + `last_verified`, never clobbering rating/source/roster). Two structural gotchas this exposed: (1) **`races` has no `seat_type` / `retirement_note` column** — open-seat state is `incumbent_running` **alone** (`0` = OPEN → amber tag + cash suppression, `1` = running, NULL = uncurated); the departing/appointed incumbent is still *named* through the `incumbent_bioguide_id → members` join, so a bare `incumbent_running:0` sitting on a *wrong* incumbent renders "WrongName · OPEN" — the flag and the name are independent columns and both must be right. (2) **An appointed caretaker barred from running is the OPEN case** even though `incumbent_running=0` was authored for retirements — same signal, different cause. NB the HO 408 fix was **card-level**; the root `members` roster drift it left (Lankford's / Armstrong's wrong years) was fixed **systemically by HO 411** (derive the year-pair from `senate_class`) **+ HO 412** (self-healing `backfill:races` upsert + phantom cleanup) — see the note at the top of this file. **Mullin's `is_current=0` was never drift** — it's correct (he resigned 2026-03-23 and is absent from `legislators-current.yaml`); HO 404 mis-flagged it and HO 410 §4 proved `is_current` clean (0/0).

## gatherReportData was the 4th appearance of the 246/277/406 stateless-planner misplan — bank the cold-EXPLAIN rule (HO 407, Jul 2026)

Six `gatherReportData()` queries over the fat `bills` table (weekly-report gen) `MULTI-INDEX OR`'d onto `idx_bills_is_ceremonial` — the `(is_ceremonial = 0 OR IS NULL)` predicate matches ~the whole 16k corpus — plus temp b-trees, and each cold-aborted at the 10+10s `boundedFetch` double-timeout (`DB_REQUEST_TIMEOUT_MS` + one retry ≈ 20s → throw). It took down the weekly-report cron **and** its daily catch-up identically for two weeks (HO 407). Fixed **hint-only with `INDEXED BY` onto EXISTING indexes — no new index needed**: Q1 stage-transitions → `idx_bills_stage_changed_at`; the intro-window COUNTs + notable-intros + topic-breakdown → `idx_bills_introduced_date`; dead-in-committee → `idx_bills_latest_action`. Cold from idle, all six went 20s-TIMEOUT → 156–1948ms; even the `json_each + GROUP BY` topic query held its hint cold (the shape flagged as re-plan-prone — it didn't re-plan). **This is the FOURTH appearance of this exact pattern** — HO 246 (getNewBillsThisWeekCount), HO 277/279 (the gated-aggregate 500s), HO 406 (the summarize queue read), now HO 407 (the report gen). **Banked rule:** any new query touching the fat `bills` table must `EXPLAIN` to a covering-or-hinted plan **cold** (from idle — a warm squeak-under is NOT a pass) before shipping; the stateless Turso planner (no `ANALYZE`) grabs `idx_bills_is_ceremonial` + a corpus scan unless forced with `INDEXED BY`.

## `report-catchup-failed:` is a load-bearing `cron_runs.error_message` prefix — don't rename it (HO 407, Jul 2026)

The weekly-report catch-up (`runReportCatchup()` in `/api/sync`) was wired non-fatal — its failure was `console.warn`'d and the route still returned `success`, so a catch-up failing EVERY day (the gatherReportData cold-stall above) was invisible in `cron_runs` for two weeks before HO 404 caught it by hand. HO 407 surfaces the failure two ways: a machine-keyable `payload.reportCatchup.ok` boolean, and — for status-level audits that don't parse payload JSON — via `chronicErr` into `cron_runs.error_message` with the stable prefix **`report-catchup-failed:`**. A cron-health probe keys on `error_message LIKE 'report-catchup-failed:%'` (or `payload.reportCatchup.ok = false`). **The prefix is load-bearing — do not rename it casually**; a rename silently blinds any audit query pinned to the old string, which is exactly the silent-failure mode HO 407 closed.

## Building an index on the fat `bills` table tips the 10s `boundedFetch` — build it out-of-band (HO 406, Jul 2026)

`npm run migrate` runs every statement through `lib/db.ts`'s `boundedFetch`, which aborts any Turso HTTP request at 10s (`DB_REQUEST_TIMEOUT_MS`, HO 238). Creating a new index on `bills` (16,623 rows) scans the table to build it, and that build **exceeds 10s** — so `CREATE INDEX` aborts, retries once, and throws mid-migration (the partial index `idx_bills_summarize_queue` did exactly this; the server rolled it back, leaving it absent). The bare `summary IS NULL` COUNT tips the same wall for the same reason. **Fix:** build the index once out-of-band with a throwaway libsql client whose `fetch` uses a long `AbortSignal.timeout` (e.g. 120s) — it completes in ~1s once the connection holds — and migrate.ts's `CREATE INDEX IF NOT EXISTS` then no-ops it on every future run. Same class as the FTS-populate chunking note already in migrate.ts (HO 336). On a fresh/empty DB the migrate path works fine (0 rows to scan); this only bites when adding an index to an already-large table on shared prod. Any future large-table index needs this out-of-band build.

## `is_ceremonial` is set at summarize time, so a ceremonial filter on the summarize queue is a no-op (HO 406, Jul 2026)

`is_ceremonial` is populated **only** by the summarize step (it's an LLM-derived field), and `lib/sync.ts` resets it to NULL on every bill update (`is_ceremonial = CASE WHEN excluded.update_date != bills.update_date THEN NULL ELSE bills.is_ceremonial END`). So every `summary IS NULL` row is `is_ceremonial IS NULL` **by construction** — a bill can't be known-ceremonial until it's been summarized, which is exactly what removes it from the queue. HO 406 added `AND (is_ceremonial = 0 OR is_ceremonial IS NULL)` to the summarize queue read expecting an inflow reduction (the brief assumed ~174 ceremonial bills were being needlessly summarized); verified against prod, it removes **zero** rows (1,374 in → 1,374 out). It's kept as harmless defensive alignment with the feed predicate, but **do not re-add a ceremonial filter to the summarize queue expecting it to reduce inflow** — ceremonial exclusion can only act *after* summarization, at the feed/read layer, never on the pre-summary queue.

## News rescue tops out at ~35% joinable, not the ~76% the pilot aspired to — and that's correct precision (HO 394/395, Jul 2026)

The observation dual-write was meant to "rescue" the ~76% of Congress-news articles that name no bill by tagging them to a member/committee instead. It doesn't reach 76%, and shouldn't: rescue is **bounded by how much Congress news is actually attributable to a sitting member or committee**. Executive-branch actors (Vought/OMB, Rubio/Witkoff), local figures (Mamdani/NYC), and genuinely subjectless items legitimately resolve to **zero entities**. The ~42% zero-entity rate is mostly **correct precision** (no over-tagging), not resolver misses — person resolution ran 27/27 with 0% wrong-drop, and the committee "44% drop" is largely correct rejections ("House of Representatives" / "House Democrats" aren't committees → `entity_value` NULL). Do **not** re-litigate the rescue rate as a resolver failure; a lower joinable rate with zero mis-tags is the design goal (precision over recall — a wrong `bioguide_id` poisons the member→news join).

## Native-id upsert makes the obs delta < items-fetched on overlapping runs (HO 395, Jul 2026)

`observations` upserts on `obs_id` (native_id-first). A re-ingest of an already-seen article bumps `last_seen` (ON CONFLICT DO UPDATE) and inserts nothing — so the row delta from a tick is **only the genuinely-new articles**, not the count fetched. The Gate C deployed tick wrote **+15 obs from 55 fetched** because a ~1h-earlier local run had already inserted the overlap. Expected, not a lost-write — when auditing obs growth, compare against *new* articles since the last tick, not items-fetched.

## `the_hill` gets budget-starved when `politico` runs long (HO 395, Jul 2026)

Feeds ingest sequentially under one ~45s route budget (`NEWS_BUDGET_MS`). On the Gate C tick, politico alone ran **32.4s** and `the_hill` hit `budgetStopped:true` (roll_call never reached). This is pre-existing HO 117 budget behavior surfacing on the observation path — later feeds can be **partially or fully skipped** on a slow tick, so a single tick's per-feed counts aren't a feed-health signal. Tracked as a soak in `backlog.md`; if the_hill is *systematically* skipped the fix is per-feed budget carving or feed-order rotation (HO 117 territory), not a timeout raise. **Soaked and closed (HO 400):** 9 ticks / 11 days — the_hill ran every tick, fetched all 15 items each time, budgetStopped only 2/9 and contributed on both; occasional slow-politico, not systematic, no fix. roll_call is the actual marginal feed (last in fixed order, budgetStopped 3/7, skipped on the 2 slow ticks) but still gets its turn.

## A new cache tag must be allowlisted on the revalidate route or the first flush silently 400s (HO 390, Jun 2026)

The `/api/revalidate` route gates on an `ALLOWED_TAGS` set — a tag not in it returns `400 "tag must be one of: …"` and never flushes. HO 390 hit this: `sync:fec` POSTed `?tag=member-fundraising` to publish the new donor split, but the tag wasn't in the allowlist, so the first flush 400'd and the split stayed invisible until the tag was added (`3e57740`). (`member-trades` was already wired, so the HO 389 trades path never tripped it.) **Second time this class of gap has surfaced** — when you add an `unstable_cache` tag AND a CLI/cron writer that flushes it, allowlisting the tag on the revalidate route is a required second step, not an afterthought.

## FEC `by_size` works off the cached candidate-id — no committee resolution (HO 390, Jun 2026)

The small/large-dollar donor split pulls FEC Schedule A `schedules/schedule_a/by_size/by_candidate/`, which aggregates across a candidate's authorized committees and is keyed by **`candidate_id`** — the same `fec_candidate_id` already cached on `members` from the HO 83 totals path. So `fetchFecBySize` needed **no committee-id resolution step**, contrary to the HO 390 handoff's assumption (it expected a committee lookup). Size-bucket floors are 0/200/500/1000/2000; `size=0` is the <$200 unitemized small-dollar bucket, the rest are itemized $200+ large-dollar. A transient failure / no Schedule A rows returns null and the columns stay untouched (honest gap — no fabricated split; totals still land).

## FEC Schedule E has no single clean dollar source — per-transaction dedup only (HO 393, Jul 2026)

FEC Schedule E (independent expenditures) has no single clean dollar source. Three sources, three different wrongs: raw `expenditure_amount` sums ~5× (F24 24-hour notices re-reported on the periodic F3X); `is_notice=false` / the `by_candidate` aggregate reconcile numerically but silently drop recent notice-only spend not yet rolled into a quarterly F3X (this dropped UDP's two largest 2026 targets, Stevens $14.7M and Boafo $11.5M, to $0); `is_notice=true` is notice-inflated (~3.7×). The committee-reported IE total is itself periodic-lagged, so it undercounts recent spend and cannot serve as a reconciliation anchor. The only correct dollar is per-transaction dedup via the back_reference chain (`back_reference_transaction_id` / `previous_file_number`): keep periodic entries, keep notice-only entries with no periodic counterpart, drop notices a periodic entry supersedes. Per-candidate `MAX(periodic, notice)` is also wrong: for a mixed target like Massie ($2.48M periodic, $7.15M notice) the two are largely different expenditures. Confirmed 2026-07-01 on UDP `C00799031`. Direction (who a committee backs/opposes) is clean from raw rows and needs none of this; only the dollar amount does.

## `COUNT(DISTINCT bioguide_id)` on the ticker rollup — NULL-bioguide trades lift trades, not members (HO 389, Jun 2026)

`getMostTradedTickers` counts trades with `COUNT(*)` but members with `COUNT(DISTINCT bioguide_id)`. Because unmatched FMP disclosures land with `bioguide_id = NULL` (the best-effort matcher), a ticker's **trade count can exceed what its member tally would imply** — the NULL-bioguide rows lift the trade count but contribute nothing to the distinct-member count. That's an honest cut, not a bug: the trade happened (count it) but we don't know whose it is (don't invent a member). Same NULL-bioguide honesty as the `/trades` feed rendering the raw disclosed name for unmatched rows rather than dropping them.

## FMP congressional-trading is NOT dead — it moved to `/stable/{senate,house}-latest` (HO 388, records the stale premise)

Recorded so the pipeline isn't re-scoped as dead: FMP's `/api/v4/` congressional-trading endpoints died Aug 2025, and HO 70 **rebuilt the trades pipeline onto `/stable/senate-latest` + `/stable/house-latest`**, which are live and bioguide-keyed (via senateID). HO 388's source probe confirmed it healthy — **548 rows, 0 unmatched, syncing daily**. Do not re-chase this as a dead source; the `/api/v4/` obituary is about the old paths, not the current pipeline. (The free-tier pagination cap — page 0 only, ~100 rows/chamber/run — is the real limit; see SKILL "Things to watch for.")

## A 1-row 500 can still be a full-corpus scan — size-independent in failure, not in work (HO 382, Jun 2026)

A filtered view returning HTTP 500 on a result set of **one row** is not necessarily a logic throw — it can be an unbounded scan/aggregation over the *whole* corpus that's size-independent in its failure but very much not in its work (the giant `committee` bucket / a `?stage=`+`?topics=` distribution recompute that never short-circuits). The one-row result tells you nothing about how many rows the query *touched*. To split the two classes, reproduce via `getDb()` locally against **prod Turso** (no 10s `boundedFetch` cap): a **timeout-class** query runs slow and *completes* (you see it return after 15–30s); a **logic-class** query *throws its real message immediately*. HO 382's home-filter 500 was misdiagnosed as a logic bug for exactly this reason — the small filtered result masked a corpus-wide scan, and only the uncapped local run against prod data showed it completing-but-slow rather than throwing. (Same statless-planner / unbounded-aggregate family as the gated-aggregate and CASE-sort entries below; the new tell is *a tiny result set is no alibi for a fast query*.)

## Stage-staleness hid behind the summary gate — a mis-staged bill read as absent, not mis-placed (HO 383, Jun 2026)

Sync nulls `summary` whenever `update_date` advances (so the bill re-summarizes), but **pre-383 it left `stage` untouched** on that same advance — and the home stage bar is **summary-gated** (`getStageDistribution(summaryGated=true)`). So a bill that advanced a stage but hadn't yet been re-summarized was *both* stale-staged *and* gated out of the bar entirely: it read as **absent** from the funnel rather than sitting in the wrong bar, which is a much harder symptom to spot (you look for a misplaced row; there isn't one — it's just gone). The fix was **not** touching the gate — it was making `stage` a **deterministic function of `latest_action_text` written independent of summarization** (HO 383 `computeStage`, sole authority), so stage is correct the instant the action text lands, regardless of whether the summary has caught up. Lesson: when a value is both gated *and* updated on a different clock than its gate, a staleness bug can present as a disappearance, not a misplacement.

## The monthly cohort re-ticks the same value daily — point-counts/sparklines/deltas must special-case it (HO 374, Jun 2026)

CPI/UNEMP (FRED `cadence:"monthly"`) re-insert the SAME monthly value into `market_ticks` on every cron run — ~11 identical-price rows per week — because the cron writes a fresh `ticked_at` each tick even when the underlying monthly print hasn't changed (the same thing that keeps a fresh-but-unchanged monthly value from reading STALE; see the per-item monthly-overdue check). So any point-count, sparkline, or 1W delta computed over `market_ticks` MUST special-case the monthly cadence (suppress the spark + delta) or it draws a dead-flat line and a misleading `1W +0.0%`. HO 374 handles it by gating: the ≥2-points / 7d-anchor gates drop the monthly cohort out automatically. (Corrects the HO 374-era premise that every roster symbol has a usable 7d series.)

## The odds close/resolution date is already in `market_ticks.market_date` — no new store needed (HO 375, Jun 2026)

For the Kalshi/Polymarket odds symbols, the event resolution/close date is ALREADY persisted. `fetchKalshi` returns it AS `marketDate` (its `when` = `strike_date` / `close_time` / a parsed ticker suffix); `fetchPolymarketMacroQuote` returns `q.resolveDate` as `marketDate`. Both land in `market_ticks.market_date` and are exposed as `MarketTick.marketDate` (the tape already uses it for the `showMonth` suffix). So the HO 375 odds-hover `closes <MON DD>` line was **render-only** — no `market_meta` table, no schema column, no latest-markets query change. This supersedes the HO 374/375 assumption that surfacing a close date would need a new per-symbol store. Note `marketDate` means different things per source — the trading day for FMP/FRED, the resolution date for odds — but for the odds cohort it IS the close date.

## POLY-SHUTDOWN returns no rows — the hover degrades to N/A (HO 374/375, Jun 2026)

The Polymarket shutdown half (`POLY-SHUTDOWN`) returns no liquid same-question market, so `fetchPolymarketMacroQuote` throws → no tick is written → the ODDS pair's P slot reads dim `N/A` and the pair stays intact. The SHUTDOWN sparkline draws from the Kalshi `SHUTDOWN` series (Polymarket never drives a spark), so the empty Poly key costs nothing. Known gap, handled gracefully — not a regression. Open question (backlog): whether the Polymarket shutdown contract id is wrong vs. the market genuinely having no liquidity.

## `market_ticks` holds dead symbols from prior roster swaps — key reads off the displayed roster, not `SELECT DISTINCT symbol` (HO 373, Jun 2026)

~13 stale symbols (old roster members from the Stooq→FMP/FRED swap and the HO 251 tape swap) still sit in `market_ticks` with frozen history. Any tape/series read must key off the CURRENTLY-DISPLAYED roster's internal keys (`MARKET_SYMBOLS` / the tape's `placeholderSymbols`), never `SELECT DISTINCT symbol FROM market_ticks` — the latter resurrects dead instruments. (Settled in the HO 373 sparkline-source probe.)

## Tape freshness reads `MAX(ticked_at)` across all symbols — one fresh feed masks N dead ones (HO 370, Jun 2026)

The markets-tape staleness check reads `MAX(ticked_at)` over the whole roster, so a single live symbol hides any number of stale ones — the strip reads "fresh" while a dead feed sits frozen behind it. The honest health read is **per-source `MAX(ticked_at)`** (FMP vs FRED vs Kalshi vs Polymarket), not a global max. Latent trap when diagnosing "is the tape actually live": the green AS-OF stamp only proves *something* ticked, not that everything did.

## Markets cron silent-307 after the domain rename — `curl` needs `-L` or the function never runs (HO 370, Jun 2026)

After the brand/URL rename (HO 364), a `curl` in GitHub Actions that doesn't follow redirects stops at the **307** to the canonical host without ever reaching the function — so no tick lands and the run still looks "successful" (the curl exits 0 on the redirect). All markets curls now carry **`-fsSL`**. The Vercel **21:30Z daily floor** is the backstop and fires independently of GitHub Actions — which is exactly why this was masked: Actions had been silently carrying the intraday load until it wasn't. (Pairs with the silent-307 note in the markets cron-reliability memory.)

## A news-cron error at ~20s elapsed = a stalled Turso call, not the news budget (Jun 2026)

`/api/cron/news` has a 45s `NEWS_BUDGET_MS` under a 60s function ceiling, but any single Turso request is bounded by HO 238's `DB_REQUEST_TIMEOUT_MS` (10s) plus retry-once, so a stuck DB call aborts the **whole route** at ~20.2s (2× 10s). A `cron_runs` row with `status=error` and `elapsed ≈ 20,200ms` means a specific query is stalling (a mis-plan against a fat table), **not** the ingest budget or the function timeout. **Confirmed HO 369 (2026-06-26):** `getCandidateBills` was driving off `idx_bills_is_ceremonial` (`is_ceremonial = 0` ≈ the whole corpus) instead of `idx_bills_latest_action` — the `(is_ceremonial = 0 OR is_ceremonial IS NULL)` clause lured the statless planner into a `MULTI-INDEX OR` + temp-b-tree sort. Fix is an `INDEXED BY idx_bills_latest_action` hint, **not** a timeout bump. Fix the query plan; leave the timeout alone. (Same statless-planner family as the gated-aggregate / cluster row-fetch entries below.) **Gap closed by 369 (HO 400 soak):** the abort block was contiguous 06-22 → 06-26 and ends exactly at the fix — the last ~20s abort was 2026-06-26 14:40Z, ~1h44m *before* the fix commit `95d0939` (16:24Z), and all 9 news ticks since are `success`. Zero aborts post-date 369.

## A report's outcome-verb color is render-only — it CANNOT live in `content_md` (HO 360, Jun 2026)

The weekly report is one pure-markdown string (`content_md`), and the web render (`components/ReportMarkdown.tsx`) and the `.md` download are meant to be identical — with ONE deliberate exception. `ReportMarkdown` colors floor-vote outcome verbs by **exact-text match** on the bolded token (`PASSED`/`CONFIRMED` → `--stage-enacted`, `ADVANCED` → `--stage-floor`, `FAILED`/`BLOCKED`/`REJECTED` → `--party-republican`; every other `<strong>` stays `--text-secondary`). This color is **render-layer only** — the stored markdown carries just `**FAILED**`, no color/HTML — so a future "make the `.md` match the web" instinct that tries to push the color into `content_md` **can't** (markdown has no color), and shouldn't: the `.md` is plain-bold by design, the web color is the **single** intended divergence. The mechanism is an exact-token map keyed on the strong node's text (not a class or a wrapper element), which is what keeps a bolded prose word from false-matching — and the same rule could later re-color the HO 352 stage-movements ladder's stage labels (banked). This is the report's one deliberate web-vs-file gap; sits beside the HO 352 prose-undercount lesson below.

## The report's section lead miscounts off a sample — feed it the TRUE counts + full named list (HO 352, Jun 2026)

When generating a section's prose lead (stage movements, floor votes), feed the prompt the **true structured counts plus the full named list**, never a sample or a truncated subset. The LLM section lead counts off whatever it is shown, so handing it a sampled list produces an undercounted "N bills advanced" in the prose that then contradicts the section's own structured header (assembly owns the counts — they come from the data; the prose only narrates significance). Same family as the HO 112 no-LLM-invented-counts rule, reached from the other side: don't let a sampled input *become* the count.

## A CASE-based `ORDER BY` defeated the date-index short-circuit — 73s cold `/stale` (HO 350, fix `339f8fc`, Jun 2026)

The stage-led `/stale` base (HO 350) sorts the default past-committee group in legislative-stage order (a `CASE stage WHEN … END DESC`) then furthest-action-first. The ship build forced `idx_bills_latest_action` on that no-stage group — but a CASE / computed `ORDER BY` can't ride a date index for its *primary* key, so the planner scanned the whole `latest_action_date < cutoff` range (~most of the corpus) into a temp b-tree to sort it: **73,492ms**, tripping the 10s `boundedFetch` abort → cold 500. Fix (`339f8fc`): split index + sort by whether a SINGLE stage is picked. Single-stage views (incl. STAGE → COMMITTEE) drop the now-degenerate CASE (all rows share one stage) and order by `latest_action_date ASC` forced onto the selective `idx_bills_latest_action` — the index PROVIDES the order, so the LIMIT short-circuits after 50 (**43ms** even on the 14.8k committee backlog). The default past-committee group instead drives off the selective `idx_bills_summary_stage (stage, is_ceremonial)` to seek the ~845 group rows, then a temp b-tree sorts that small set (~1.6s). **Generalized lesson: a CASE / computed `ORDER BY` can defeat an index short-circuit — for a single-value-filtered view, drop the CASE and let the selective index carry the sort.** Same statless-planner family as the gated-aggregate / cluster row-fetch entries below.

## A `GROUP BY` / `json_each` added to a hinted WHERE can re-plan — re-EXPLAIN after (HO 364/365, Jun 2026)

Same statless-planner family as the CASE-sort entry above and the gated-aggregate / cluster row-fetch entries below. A query that plans onto a selective index as a **bare** WHERE can shift back to a `MULTI-INDEX OR` once you add a `GROUP BY` or a `json_each` join on top — the plan is not stable across that change. The B5 ladder / new-bills breakdown queries validated standalone at ~225ms / ~150ms in the HO 364 probe, but the `INDEXED BY` hint (`idx_bills_stage_changed_at` / `idx_bills_introduced_date`) had to ride the **grouped** form, not just the bare query. Verified pre-ship (HO 365): the ladder EXPLAINs `SEARCH … idx_bills_stage_changed_at` (717ms cold, NOT a MULTI-INDEX OR), new-bills chamber 75ms / topics 28ms. **Lesson: re-run `EXPLAIN QUERY PLAN` after adding `GROUP BY` or `json_each` to a previously-hinted query — the plan can change, and the hint must be on the final grouped shape.**

## The staging index is shared across parallel sessions on one tree — `git add` then commit is racy (HO 350 arc, Jun 2026)

Corey runs parallel agents on ONE shared CBT working tree, and `git add` stages into the repo's single shared index. So between your `git add` and your `git commit`, another session's commit can sweep up your staged files (or yours theirs) — it nearly cost HO 350 this arc. **Commit by explicit pathspec (`git commit <files>`) to bypass the shared index entirely**, and re-check HEAD (`git log --oneline`) before push to confirm you shipped exactly what you staged (then `npm run verify:deploy` your own SHA). Never a bare `git add -A` / `git add .` on this tree. (Mirrors the `concurrent-session git race` memory.)

## A shared-tree push carries concurrent commits even after a clean ancestry check (Jun 2026)

Companion to the staging-index race above, one level up — at `push`, not `commit`. Parallel Code sessions share one working tree, so they share HEAD. A named-pathspec commit scopes what YOUR commit *contains*, but a fast-forward `git push` still ships **every** commit on the branch — including ones a concurrent session committed in the window between your `git merge-base --is-ancestor origin/main HEAD` check and your `git push`. **Observed 2026-06-26:** a `backlog.md` reconcile push (`6abc1de`) carried HO 370's SKILL/oddities/roadmap commit (`c143e7d`) up with it — HEAD had advanced past my commit in the gap. Harmless that time because the two commits touched **disjoint files**. The real hazard is two sessions committing the **same** file in that gap: you'd fast-forward-push the other session's possibly-half-finished state under your commit. **Mitigation:** named `git add` (already standard) limits your commit's contents but not the push; when you know another session is mid-edit, `git fetch` + check `git log origin/main..HEAD` **immediately before pushing** and eyeball that every riding commit is intentionally complete, not just your own. (Mirrors the `concurrent-session git race` memory.)

## `USING INDEX` ≠ `USING COVERING INDEX` — a clean-looking seek can row-fetch most of the corpus (HO 340, Jun 2026)

`/patterns` 500'd on `getUnmatchedClusterCount`: `COUNT(*) FROM bills WHERE cluster_id IS NULL AND (is_ceremonial = 0 OR IS NULL)`. EXPLAIN said `SEARCH bills USING INDEX idx_bills_cluster_id (cluster_id=?)` — which reads like a tidy point lookup, and is exactly why the HO 332 audit cleared it. Two traps in one: (1) SQLite renders `cluster_id IS NULL` as `(cluster_id=?)` (NULL bound as a param), so a **low-selectivity** predicate is indistinguishable in the plan from a selective one — and `cluster_id IS NULL` matches **15,117 of 16,538** rows (most bills are unclustered); (2) `idx_bills_cluster_id` is `(cluster_id)` only, so `is_ceremonial` is **row-fetched** for all 15k rows → ~20s, past the abort, never caches → permanent 500. The tell is **`USING INDEX` vs `USING COVERING INDEX`**: only COVERING is index-only. A plain `USING INDEX` in an *unbounded aggregate* (no LIMIT to cap the row-fetch) over a wide predicate is the trap. Fix: a covering index that carries the filtered/aggregated columns — `idx_bills_cluster_agg (cluster_id, is_ceremonial, stage)`, forced `INDEXED BY`, flipped both cluster queries to `USING COVERING INDEX` (20s/4.7s → ~35ms). **EXPLAIN alone can't price this — only timing can.** The `cold-start-audit-332.ts` probe was hardened to WARN this shape and resolve it by timing (`TIME_WARN=1`), which immediately caught two more latent >25s queries (`getWatchlistBills` drive-order, dead `getSponsorStates`). Third sighting of the row-fetch blindspot after the /search LIKE; lesson generalized: a clean plan ≠ a fast query; an unbounded aggregate must be COVERING.

## A leading-`%` LIKE over a fat text column full-scans the corpus — no index saves it; use FTS5 (HO 335/336, Jun 2026)

`/search?q=` 500'd on common terms (`tax`) warm AND cold, every tab. The cause wasn't a misplan — the plan read fine (a single index SCAN after HO 335's hint). It was the LIKE: `LOWER(title)/LOWER(summary) LIKE '%term%'` can't use ANY index (a leading wildcard isn't a prefix), so it full-scans and reads the (large) summary text of all 16k rows — >10s, past the abort. The HO 332 EXPLAIN audit *passed* this query because **EXPLAIN prices the plan, not the runtime scan** — a full-corpus scan has a clean-looking plan. Lesson 1: **never full-text-search a `bills` text column with `LIKE` — use the `bills_fts` FTS5 index** (HO 336; `MATCH` + `bm25`). Lesson 2 (audit refinement): a plan-only audit is blind to leading-`%` LIKE and unbounded aggregates; those need a runtime timing check.

Two FTS5 gotchas hit while building it (HO 336), both worth not relearning:
- **Don't index `id` in the FTS.** Bill-id tokens (`119`, `hr`, the number) appear in ~every id, so a prefix term like `1*` or `119*` expands to ~the whole index → a `119-hr-1` search 20s-aborted. Index only the prose columns (`title/summary/sponsor_name`). Short query tokens (len 1-2) match exactly, not as prefixes, for the same expansion reason.
- **Don't populate an external-content FTS with a one-shot `INSERT INTO bills_fts(bills_fts) VALUES('rebuild')`.** Reindexing 16k docs is one long statement; the 10s `boundedFetch` (HO 238) aborts it mid-flight and the index lands `SQLITE_CORRUPT` (MATCH then returns 0 or errors). Populate in **small rowid chunks** (500), each well under the bound. And check population with an existence probe (`SELECT 1 FROM bills_fts LIMIT 1`), NOT `SELECT COUNT(*) FROM bills_fts` — a bare fts count iterates the whole index and can itself blow the bound.

The same LIKE 500 also hit `/bills?q=` (the inline feed filter, `buildFeedWhere`); HO 338 wired that path to `bills_fts` too. Note the FTS-vs-sort-index conflict it exposed: `getFeedBills` carries HO 335's forced sort-index hint, but an FTS `MATCH` must drive from `bills_fts` — you can't force the sort index AND drive from FTS, so the query **branches on `q`** (q-present = FTS drive, no hint; q-absent = HO 335 sort-walk). Forcing the sort hint onto the q path silently re-breaks it back to a scan.

## An `OR sponsor_name` fallback on a `bills` query walks the whole fat table (HO 329/331, Jun 2026)

The member-expand `?expanded=` path cold-started a 500. Cause: three sponsor helpers filtered `(sponsor_bioguide_id = ? OR sponsor_name = ?)`. `sponsor_bioguide_id` is indexed; **`sponsor_name` is not** — and SQLite can't do an OR-index-union unless *both* branches are indexed, so the planner fell to a MULTI-INDEX OR over `idx_bills_is_ceremonial` (≈every non-ceremonial row of the 16.5k-row table). Warm ~200ms; cold the HO 277 plan that swings to 18s+ → past the 10s `DB_REQUEST_TIMEOUT_MS` abort → 500. The kicker: the `OR sponsor_name` branch was **provably dead** — the sole caller passes a `bioguide_id`, which never equals a `sponsor_name`, so it matched nothing while wrecking the plan. Fix (HO 331): drop the dead branch, go `sponsor_bioguide_id = ?` only, and **force** the existing covering index (`INDEXED BY idx_bills_sponsor_agg` / `idx_bills_sponsor_topics` — the statless Turso planner won't pick it unhinted). EXPLAIN flipped all three to covering-index point lookups. **Lesson: never add an `OR <unindexed_col>` to a `bills` query** — one unindexed disjunct silently converts a point lookup into a full-table walk that only bites cold. Fourth sighting of this misplan class in one session; probe `scripts/diagnostic/member-expand-329.ts`.

## The `/members` rail shows UPCOMING HEARINGS, not LIVE NOW — the mock can't be built honestly (HO 328, Jun 2026)

The HO 328 design mock (`docs/design/members-committees-live.html`) shows a "LIVE NOW" rail group — committees *in session this minute*. Prod ships **UPCOMING HEARINGS** instead. This is intentional, not drift: the schema has **no hearing end-time / in-progress signal** (`committee_meetings` carries a start `meetingDate` + a raw `meetingStatus`, but no "live now" flag), and the page is **daily-cached**, so "in session now" can't be derived honestly at request time. UPCOMING (real scheduled starts, `getUpcomingMeetings({days:7})`, soonest-per-committee) is the honest surface. A future reader comparing the LIVE NOW mock to prod should know the swap was a deliberate honesty call. (Same family as the hearings ● LIVE badge that's never been exercised against a real streaming meeting — roadmap "Owed eyeball.")

## `MemberTopicBar`'s bar length is dual-scale — same width means two different things (HO 328)

The per-member topic-mix bar on `/members` scales its total length to `pageMax`, which is **the global filtered max on the full ranked list** but **the roster max when a committee is scoped** (`?committee=`). So a bar that fills, say, 60% of the row means "60% of the busiest member in Congress" unscoped, but "60% of the busiest member on THIS committee" scoped — the same rendered width encodes a different denominator in the two states. Intentional (a scoped roster of 10 members would otherwise render as a row of near-empty stubs against the global max), but worth knowing before reading absolute volume off the bar across a scope change.

## GitHub Actions scheduled crons are best-effort — they silently drop most slots (HO 313/314, Jun 2026)

The markets tape froze for ~1.7 days and the leading theory was a dead data source. It wasn't: every source ticked fine when the cron ran. The cron just wasn't running. `markets-tick` (`0,30 13-21 * * 1-5` = 18 weekday slots) was delivering only **~3–5 (~20%)** of them on a good day, firing hours late (a 21:00Z slot landed 23:14Z), and on some weekdays **zero** times — workflow files unchanged + `state: active`, repo public (Actions free/unlimited), so it's purely GitHub's scheduler dropping the events. The control that nailed it: `cron_runs` showed Vercel's declared crons hitting their slots reliably (8+ daily) while the GitHub ones went dark. Lesson: **don't put a freshness-critical pipeline on a GitHub Actions schedule.** Back it with a reliable trigger (HO 314: a Vercel daily cron floor at 21:30 UTC). `gh run list --workflow=<f>` is the source of truth for whether a scheduled Action actually fired.

## Vercel's Data Cache persists across deployments — a redeploy does NOT cold `unstable_cache` (HO 312, Jun 2026)

Chased a "reports index is stale, missing the June 8 report" bug that had already self-resolved. Two things to internalize: (1) `unstable_cache` entries live in Vercel's **Data Cache, which survives redeploys** — shipping a fix does not flush a stale cached query; you need an explicit `revalidateTag`, the entry's TTL to expire, or the next cron that revalidates. (2) To surface a backfilled row on demand there's an affordance: `POST /api/revalidate?tag=<tag>` (Bearer `CRON_SECRET`, tags allow-listed). Don't assume "I redeployed, so the cache is fresh." **(HO 636) A local `next start` reproduces the same behaviour against `.next/cache`** — so a local render check can show a pre-change value after a correct rebuild, and the value only turns over on a `revalidateTag`, the TTL, or a wiped `.next`. That is verification hygiene rather than a second platform finding, noted here because the local case is where you will actually meet it; the HO 635 flip that prompted it was observed locally, never on prod. **(HO 647) The key itself is not the `keyParts` literal** — it is `${cb.toString()}-${keyParts}`, so what a deploy cannot rotate, an edit inside the callback body can; see *An `unstable_cache` key hashes the callback's own source text* at the end of this file.

## The HO 285 report catch-up absorbs `/api/sync` morning soft-timeouts — a report can land a day late with no bug (HO 312, Jun 2026)

The June 8 report was "missing from the index" because it simply **hadn't been generated yet** — not a cache or predicate fault. The daily `/api/sync` catch-up (HO 285) regenerates the most-recent missing week, but the Jun 19 and Jun 20 *morning* sync runs **soft-timed-out** (the heavy-cron Turso-cold-stall / slow-Gemini family), so the gen didn't complete. It landed on the next successful run (Jun 20 16:57) and that run's `revalidateTag("reports")` flushed the index immediately. So the safety net worked exactly as designed — "retried daily until it lands" — just a day slower than the observer expected. Before diagnosing a "stale report" as a cache/predicate bug, check whether the row even exists yet and when `/api/sync` last completed without a timeout. (Both HO 312 hypotheses — catch-up skips revalidate, index has a status predicate — were refuted by the code: the catch-up path *does* revalidate at `app/api/sync/route.ts`, and the index query has no WHERE filter.)

## Feed-style queries need the full sponsor enrichment or the sponsor card degrades (HO 300, Jun 2026)

The v2 feed-row sponsor hover card reads `depiction_url` / `first_name` / `last_name` / `district` / `cosponsor_count`. `getFeedBills` already projected those (the `SPONSOR_ENRICH` select+join), but the OTHER feed-shaped queries — `getStageChanges` / `getStaleBills` / `getNewBillsThisWeek`, which back the v2 MOVERS / TOP STALLS / NEW THIS WEEK tabs — did not. Without the enrichment the card silently degrades: raw `Last, First` name, wrong district, initials instead of the photo, no cosponsors. Fix is a JOIN-projection add (the same `SPONSOR_ENRICH_SELECT`/`JOIN`), not a plan change, so the `INDEXED BY` hints stay untouched. Lesson: any query that feeds a row component must carry that component's FULL column dependency, or the row degrades without erroring.

## A bare `fr` grid track won't shrink — ellipsis is inert without `minmax(0, …)` (HO 297, Jun 2026)

A `fr` grid column defaults to `min-width: auto`, which means it refuses to shrink below its content's intrinsic width — so a long unbreakable title in an `1fr` track blows the track wide instead of ellipsizing, and the `text-overflow: ellipsis` you set never fires (the box never gets narrow enough to overflow). Fix: `minmax(0, 1fr)` (or `minmax(0, auto)`) to let the track shrink below content. The tell is "my ellipsis does nothing" on a grid child — it's the track, not the text rule.

## `scripts/**` is in tsconfig — a throwaway probe that doesn't typecheck fails the Vercel build (HO 297, Jun 2026)

`scripts/` is inside the `tsconfig.json` include, so `tsc` (and the Vercel build's typecheck) compiles every diagnostic/probe script — even ones that never run in prod and exist only to capture a number. A throwaway probe with a type error reds the whole deploy. Keep probe scripts compiling (or delete them before pushing). The build doesn't care that the script is "just a throwaway."

## Backticks in a commit message trigger shell command substitution (HO 297, Jun 2026)

Passing `git commit -m "...\`getFeedBills\`..."` through a shell runs the backticked text as a command (substitution) and mangles the message — or errors. Commit via a message FILE (`git commit -F msgfile` / a heredoc) when the message contains backticks (which CBT's code-referencing messages always do). The bash tool's commit guidance bans backtick `git commit -m` for exactly this reason.

## A box taller than the thin tape strips spills onto the nav if dropped downward (HO 294, Jun 2026)

Once the markets-tape hover box was portaled (293), anchoring it below the whole two-strip tape block dropped it over the nav — the nav sits right under the tapes. The box (~80px, 3 lines) is taller than the two thin strips (~76px), so there's no clean "below" that clears both the sibling strip and the nav. The anchor that works for items on either strip: pin the box's BOTTOM ~at the ticker block's bottom and grow it UPWARD (`translateY(-100%)`) so it overlays the strips, never the nav. Lesson: when a popover is taller than its anchor row, "drop below" has nowhere to land — overlay upward instead.

## A hover box nested in a strip is painted over by a sibling strip at the same z-index (HO 293, Jun 2026)

The tape hover box was a CSS-`:hover` span inside `.markets-tape-item`, inside the MARKETS strip (`.markets-tape`, `z-index:30`). The ODDS strip is a sibling `.markets-tape` (also `z-30`), later in the DOM, so it paints over the entire MARKETS subtree — including the box's `z-60`. The box dropped below the item onto the ODDS strip and hid behind it; only the sliver below the strip (the bottom meta line) showed, which is why the screenshot had the name + hook missing. A child's high z-index can't escape its strip's stacking context. Fix: portal the box to `<body>` + `position:fixed` + high z-index + opaque bg, leaving the strip's stacking context entirely.

## Some Kalshi markets carry no date — `parseTickerDate` needs a year-only fallback (HO 290, Jun 2026)

`fetchKalshi` picks the soonest open event in a series by date (strike_date / close_time / a month parsed from the ticker). The recession series `KXRECSSNBER` events (`-26`, `-27`) carry NONE of those — no strike_date, no close_time, and a bare `-26` year with no month — so `parseTickerDate` returned null and the soonest-event selection found nothing, failing the symbol. Fix: a year-only fallback (`-26` → `2026-12-31`). Dated markets (shutdown `-26OCT01`, fed via strike_date) resolve first, so they're unaffected. Verify a new Kalshi series' event shape before assuming the existing date logic covers it.

## Kalshi rate-limits a parallel symbol burst (429) (HO 290, Jun 2026)

The markets cron fetches every same-source symbol in parallel (`Promise.all`), and each Kalshi symbol fires TWO calls (events + markets). With 2 Kalshi symbols (4 calls) it held; adding a 3rd (recession → 6 concurrent calls) tripped the public-API rate limit, failing 2 of 3 per run (a different 2 each time). Fix: retry-on-429/503 with a short jittered backoff inside the Kalshi fetch — the jitter spreads the concurrent symbols' retries so they don't re-collide. The race-odds cron sidesteps this by throttling 250ms between sequential calls; the markets cron is parallel, so it needs the retry.

## CPI/UNEMP don't show the market-CLOSED wash that intraday symbols do (HO 290, Jun 2026)

When US markets are closed, the MARKETS strip washes daily symbols to `--ticker-closed`. CPI/UNEMP (FRED monthly) sit on that same strip but stay in normal color — `itemState` returns `closed:false` for `cadence==='monthly'` regardless of strip kind. Correct: a monthly econ print isn't "closed for trading," so it shouldn't read dormant. Not a bug.

## `_`-prefixed App Router folders are private (non-routable) in Next.js (HO 288, Jun 2026)

A throwaway prod-egress FMP probe route at `app/api/_probe288/route.ts` 404'd live. Next.js treats any folder starting with `_` as a *private folder* — opted out of routing entirely. Renamed to `app/api/probe288/` and it routed. (Context: HO 288's egress probe needed the prod FMP key, which isn't in the preview scope, so the probe deployed to prod main and was reverted after capture.)

## The 281 header type bump moved the one-line threshold to ~1420px (HO 281, Jun 2026)

After bumping the desktop masthead title to 26px / nav to 16px, the header's single-line threshold rose to ~1420px, so a 1366px laptop reflows the counts readout + nav to a clean 2nd line. Acceptable — it wraps, doesn't clip. The only clean lever if 1366 density ever matters is trimming the counts-readout copy.

## B4 tabbed box: RACES anchors height, HEARINGS overlays absolute (HO 282, Jun 2026)

The v2 HEARINGS|RACES tabbed box keeps RACES in normal flow as the height anchor and overlays HEARINGS absolutely on desktop (`display:none`-but-mounted on mobile, which preserves the per-browser MOVES-since-last-open badge state). Both tabs hold the box at 468px so switching doesn't jump. The mounted-but-hidden mobile branch is deliberate — unmounting would reset the badge.

## Kill lingering dev servers before a clean `.next` restart (HO 282, reaffirmed HO 300, Jun 2026)

`npm run dev` zombies accumulate across sessions (a killed terminal doesn't always reap the node child), and a stale one can keep serving an old bundle — the HO 212 stale-CSS trap by another door. Before a fresh `rm -rf .next` + restart, `pkill -f "next dev"` (and any `next-server`) first, or you eyeball a stale render and chase a phantom. **HO 300 recurrence + nuance:** an over-broad `pkill node` (vs the scoped `pkill -f "next dev"`) is its own trap — on Windows/Git-Bash it can leave a half-killed process **holding the port**, so the next `npm run dev` binds 3001+ and you eyeball the wrong server. Clean with `taskkill` (`taskkill //F //IM node.exe` when nothing else needs node) and verify the restart is actually on a fresh server + the expected port.

## The gated-aggregate mis-plan class — "cold-start 500" was a misnomer (HO 277–279, Jun 2026)

Three live `/members`, `/dashboard-v2`, and `/bills` 500s in a row turned out to be one class, not three bugs. Adding a gating predicate (`summary IS NOT NULL`) to a fat-`bills` COUNT/aggregate makes the statless Turso planner (ANALYZE blocked) intermittently drop it onto a `MULTI-INDEX OR` over `idx_bills_is_ceremonial` (≈ a full table scan, since `(is_ceremonial=0 OR IS NULL)` matches ~every row). The tell that it isn't a cold-start problem: it's **slow even fully warm and wildly nondeterministic** — the dashboard-v2 corpus COUNT swung 112ms ↔ 18s+ across consecutive warm hits. When a roll lands past the 10s DB abort, `boundedFetch` aborts + retries (~20s) and the page 500s; when it lands fast, 200. That variance is exactly the "transient 500, 2 tries then 200" signature. Remedy: a partial/covering index matching the predicate (e.g. `… WHERE summary IS NOT NULL`) **plus** a gated `INDEXED BY` hint — the planner refuses the index unhinted every time. `getFeedStats` (the masthead count) was the sneaky one: it ran on every HeaderBar page, so the same mis-plan was an app-wide 500 risk, not route-local. *(HO 326 note: `HeaderBar` no longer calls `getFeedStats` — the inner-page count was removed; the app-wide exposure now rides `getCorpusStats(true)`, the HO 325 sync-subhead source, which shares the same `idx_bills_summary_feed` index, so the lesson holds.)*

## Over-gating an INDEXED BY hint forces the wrong index on a sibling path (HO 279, Jun 2026)

A forced `INDEXED BY` doesn't just fix the path you aimed at — it overrides the planner for *every* query that shares the function, including ones where the planner was already choosing a better index. HO 279's first cut hinted `getFeedBills`'s COUNT onto `idx_bills_summary_feed` for every non-`cluster` path. The bare `/bills` COUNT went 44s → 30ms (the win), but `/bills?stage=` regressed: the planner had been picking `idx_bills_summary_stage` (a clean `SEARCH (stage=?)`, 152ms), and the blanket hint forced a full partial-index SCAN + per-row fetch instead (8.5s cold). The cold test caught it; the fix was narrowing the hint to the *bare* gated case. Lesson: gate a hint to the exact WHERE shape it helps, and **re-measure the filtered/sibling paths after adding it**, not just the target.

## The drive-order trap: a news/search join drives from the 16k bills side, not the 227-row news side (HO 332/335, Jun 2026)

`news_mentions` is tiny (227 rows) and the bills table is fat (16.5k). A query like `FROM news_mentions m INNER JOIN bills b ON b.id = m.bill_id WHERE <m.published_at window> AND (b.is_ceremonial = 0 OR IS NULL)` *should* drive from `m` (227 rows, filtered further by the window) and join `bills` by PK. But the statless Turso planner (no ANALYZE) instead drove from **`bills` via `idx_bills_is_ceremonial`** — a MULTI-INDEX OR over ~every non-ceremonial row, ~16k join probes — because it has no row-count stats telling it `news_mentions` is the small side. Same cold-abort class as the gated-aggregate mis-plan, just reached through the join. The HO 332 audit caught it on `getNewsFeed`, `searchNews`, and the dead `getBreakingNews`; `getBreakingNewsForHome` was already immune because HO 241 had hinted it. **Fix (HO 335): force the small side as the driver** — `FROM news_mentions m INDEXED BY idx_news_mentions_published`. The plan flips to `SCAN m USING idx_news_mentions_published` + `SEARCH bills … (id=?)` PK. **Lesson: on a small⟗fat join, never trust the statless planner to pick the small driver — hint the small table's index** (and re-EXPLAIN; the win is invisible warm, fatal cold). Probe: `scripts/diagnostic/cold-start-audit-332.ts`.

**Same trap, `/watchlist` (HO 342 → absorbed into HO 356, Jun 2026).** `getWatchlistBills` joined `FROM bills b INNER JOIN watchlist w` and the statless planner drove from the 16k bills side (`SCAN bills`), SEARCHing the tiny watchlist per bill — ~27s cold, and (being `unstable_cache`d) the timeout never populated → permanent 500. The HO 342 fix was written but **never shipped** (HO 354 found the doc untracked, no commit, the tree still bills-first). HO 356 (per-user watchlist) rewrote the same query and folded the fix in: drive `FROM watchlist w INDEXED BY sqlite_autoindex_watchlist_1 INNER JOIN bills b ON b.id = w.bill_id WHERE w.user_id = ?` — the composite PK leads on `user_id`, so the lookup is `USING COVERING INDEX` and bills join by PK (`sqlite_autoindex_bills_1 (id=?)`). The helper is also UNCACHED now, which is its own standing trap worth stating plainly: **all three watchlist read helpers — `getWatchlistBills`, `getWatchedBillIds`, `isInWatchlist` — CANNOT be `unstable_cache`-wrapped once they read `auth()` internally.** `unstable_cache` has no request-scoped cookie access (so `auth()` resolves wrong/empty inside it), and a single global cache key would **bleed one user's stars to another**. Uncached is required here, not a perf regression to "fix" — and as a bonus the cache-masks-the-timeout half of the drive-order trap above is gone too (the timeout can no longer hide behind a populated cache). The write helpers stay the asymmetric counterpart: they take an explicit `userId` and never read the session.

**HO 514 re-measure (Jul 2026) — the trap re-fired on a 4th surface, and the row count is NOT the lesson.** The `/news` topic rail (`getNewsTopicRailCounts`, the same `news_mentions m INNER JOIN bills b` + a `json_each` GROUP BY) hit the identical drive-order trap: unhinted **bare 2231ms** cold (MULTI-INDEX OR off `idx_bills_is_ceremonial`), `signal=breaking` 943ms → **30ms** with `INDEXED BY idx_news_mentions_published`. `news_mentions` is now **726 rows** (was 227 when this entry was written — 3.2× growth), and the trap **did not weaken at all**, because the OR-lure scales with the *bills* (fat) side, not the news (small) side. So the small⟗fat **asymmetry** is what matters, never the specific row count — don't read the "227" above as load-bearing. The durable form: on any small⟗fat join, hint the small driver regardless of how the small side has grown.

## A non-breaking space silently defeated the title-prefix strip (HO 273, Jun 2026)

Committee meeting titles render verbatim from Congress.gov, and Senate ones lead with procedural boilerplate ("Hearings to examine the nomination of…"). `cleanMeetingTitle` strips those lead-ins with literal-space regexes — except a chunk of titles carry a non-breaking space (U+00A0) or narrow NBSP (U+202F) between words (notably between "examine" and the topic), so `to examine ` never matched and the prefix passed through uncleaned. They look identical in a terminal; the tell is only in the bytes. Fix: normalize `[  ] → " "` before any prefix matching. The lesson generalizes — any prefix/substring match against text sourced from a government feed should NBSP-normalize first.

## FRED series lag, and the markets cron diffs a fresh value against a stale prior (HO 274, Jun 2026)

The tape showed WTI 84.65 with −10.89%. The price was the faithful FRED value; the change was a phantom. FRED's `DCOILWTICO` publishes with a multi-day lag (`last_updated` trailing `observation_end` by days), so on every daily tick before it caught up, the newest observation was a week-old 95.0 — and the cron's "prior session" diff (`market_date < new`) compared the fresh 84.65 against that week-stale row, printing a 7-day move as if it were one session (the real intervening sessions 88.62/91.58/93.68/91.90 were never captured). The single-session move was actually −4.5%. Assume the other FRED rate/commodity series lag the same way. The render guard (drop the arrow + change on any daily move beyond ±8%, keep the real price) masks the egregious ones; the real fix — capture the intervening rows or handle the lag in the cron diff — is deferred (see backlog WATCH).

## Battlefield marker and race-card odds can point opposite ways for the same seat (HO 274, Jun 2026)

On `/dashboard-v2`, the battlefield marker's POSITION is the rater-consensus lean (rating-based), while the race card's Kalshi/Polymarket cells are market-based. For ME-SEN the markers sit toward R (ratings call it a Toss-up leaning the incumbent's way) while both markets favor D — so the two surfaces legitimately disagree. The marker COLOR is the incumbent/holder party (matches the card dot), only the position diverges. Expected, not a bug — don't "fix" it by forcing one onto the other; they answer different questions (where forecasters put it vs. where money is).

## The homepage cold-start 500: a four-layer stack (found Jun 14, fixed Jun 15, 2026)

`/` started intermittently throwing 500s, then got stuck 500ing. The cause wasn't one bug, it was four things stacked, and each fix uncovered the next layer.

1. The bills table carried 27 MB of `raw_json` inline across ~16k rows. The homepage aggregates don't even select that column, but to read any column SQLite has to load the row's page, and those pages are fat with blob. So the first cold scan after Turso evicted its page cache took 8–14s.

2. HO 238's 10s DB abort + retry then turned "slow" into "dead." A cold aggregate can't finish inside 10s, so it aborts, retries (still cold), aborts again, throws. The "20s 500" in the logs was literally 2×10s.

3. `unstable_cache` is populate-on-read, and the read is exactly what couldn't finish cold. The cache could never self-populate, so every request re-ran the same doomed recompute. That's why it was *stuck* 500ing rather than just intermittent. A cron pre-warm didn't help either: the pre-warm runs the same query, hits the same abort, and 504'd the sync.

4. ANALYZE is blocked on hosted Turso (see below), so the planner is statless and was grabbing `idx_bills_is_ceremonial` (where `is_ceremonial=0` matches ~every row, so it scanned the whole table) instead of the selective date index that already existed. The feed queries were 17–20s *even warm*.

The fix ended up tiny: two covering indexes so the aggregates go index-only and never touch the fat table, plus `INDEXED BY` hints on five feed queries to force the planner onto the right existing index. Final diff was 5 hints in one file and 2 new indexes. `/` now heals itself cold through plain populate-on-read.

The real lesson was process, not code: every premise we opened with was wrong, and each got disproven by measuring live state, not by reasoning. The raw_json migration died on VACUUM being blocked; the caching theory died on populate-on-read; "keep the pre-warm as a fallback" died when the pre-warm hit the same abort.

## VACUUM is blocked on hosted Turso (hit Jun 2026, during the abandoned HO 241 migration)

`SQL_PARSE_ERROR: SQL not allowed statement: VACUUM`. You can't reclaim space or repack a table from the client, and the Turso CLI hits the same protocol wall. This killed the clean version of moving `raw_json` out: `DROP COLUMN` rewrites rows but doesn't repack pages, so without VACUUM the only way to actually shrink a table is a full rebuild-and-swap.

## ANALYZE is also blocked (hit Jun 2026, same session)

Same family as VACUUM. No `sqlite_stat1`, so the planner has no statistics and makes bad index choices, and it won't pick a selective index even when one exists. On a fat table that's fatal, because a mis-planned query scans everything. The fix isn't ANALYZE (you can't run it), it's `INDEXED BY` hints to force the planner's hand on the queries it gets wrong.

## FRED works on a laptop and is blocked from Vercel (found Jun 10, 2026, HO 227; resolved HO 228 / Jun 12)

`fredgraph.csv` fetched fine in local dev and timed out for every symbol from Vercel's egress, a cloud-IP block rather than a code bug. The "TNX/VIX already tick in prod" assumption turned out to be a local-run artifact. Lesson: probe third-party endpoints from the actual deployment egress, not your machine.

## A missing env var failed silently in prod (HO 227, Jun 10, 2026)

`FMP_API_KEY` was in local `.env` but never added to Vercel. The markets cron "worked" locally and failed in production with no error, just no data. Env parity is invisible until something quietly returns nothing.

## Route-level `revalidate` does nothing in Next.js 15 for dynamic pages (standing behavior, no fix date)

Exporting `revalidate` from a dynamic route is inert. Caching has to live at the query layer (`unstable_cache` + `revalidateTag`). Easy to set the route export, see no effect, and conclude caching is broken when it was never wired.

## Green build, 200 response, full payload, and an unstyled page (HO 212, Jun 9, 2026)

A drifted `.next` build served a stale CSS hash, so the page 404'd on `layout.css` and rendered completely unstyled while `tsc` passed, the route returned 200, and the JSON was all there. The tell was a 404 on the stylesheet asset, which is not where you'd think to look. `rm -rf .next` and restart fixes it.

## A running graveyard of dead data sources (external deaths OpenSecrets ~Apr 2025 · FMP v4 ~Aug 2025 · Stooq Jun 2026; all hit in CBT building HO 65 / 70 / 227, ~May–Jun 2026)

A surprising share of the dev was sources dying mid-flight: OpenSecrets' API shut down, FMP's `/api/v4/` congress-trading endpoint was deprecated, Stooq's CSV quote endpoint was retired (Stooq is effectively dead as a programmatic source). The pattern: free-tier third-party data is a moving target. "FMP has it" doesn't mean "FMP's free tier still has it at this path." Only `/stable/` endpoints have held up.

## Vercel's free tier keeps no logs past ~30 minutes (standing limit; cron_runs workaround HO 105, May 21, 2026)

You can't go back and read what a cron did an hour ago. All cron validation runs through a `cron_runs` table written to directly, because the logs are gone by the time you'd check them.

## Two race predicates that look interchangeable aren't (May 19, 2026)

`getRacesIndex` (inner-join on a rating existing, ~137 races) and `getMostCompetitiveRaces` (toss-ups only, ABS(score)≤1, ~61 races) answer different questions. Using one where the other belonged (treating either as "the competitive count") caused a bug. Worth a comment wherever a count gets reused.

## The planning copy lags the live repo (ongoing)

More than once, work was scoped against a frozen snapshot of the code and either no-op'd (the thing was already shipped) or nearly re-shipped something already rejected. The discipline that came out of it: trust a live grep of the actual repo, not a snapshot or a frozen handoff file.

**Mechanism facts lag worst (HO 316–318).** The most expensive version isn't a stale *feature* claim — it's a stale **mechanism** claim: *what's stored* and *how state works*. The HO 317 handoff carried three — "cosponsors are skipped," "schema has state, not district," "/bills uses `?expanded=` URL state" — and each cost a correction round mid-build. A 30-second live check disproved all three: `bills.cosponsor_count` is stored (in `SPONSOR_ENRICH_SELECT`), district comes from the `SPONSOR_ENRICH` members-join (`msp.district`), and `/bills` expand is React `useState` via `useSingleOpenPanel` (no URL param). Notably, **SKILL was already correct on all three** — the staleness was in the *handoff*, not the doc — so "fix the stale SKILL premises" itself needs verifying before you trust it. Before scoping any panel/query/state work: grep the schema (`scripts/migrate.ts` / the `SELECT` lists) and the state model (the actual hook/component), don't trust the prose. Verify the premise that says a premise is stale, too.

**A window/period is a live-code fact too, not a mock inference (HO 365).** Same lesson, one more axis: a design mock showing `WEEK OF JUN 22` with a partial-looking current bar does **not** tell you the underlying window. The live `WeeklyBand` is **trailing-7-day** (`[now-7d, now)` in the helpers), but the HO 365 handoff assumed **calendar week-to-date** from the mock — which would read ▼ every day until Sunday (partial-vs-full), a daily false "down" signal. Code caught the contradiction in plan mode before build, but it cost a cycle. When a handoff asserts a window/period, confirm it against the live helper (`getWeeklyBandPriorWeek` etc.) before building, don't take the mock's visual as the period.

## congress-legislators `fec` is NOT reliably every career candidate ID (HO 402, Jul 2026)

The `fec` array in unitedstates/congress-legislators is often just the **latest registration**, not a member's complete career of FEC candidate IDs. Laura Gillen (G000602) lists only her 2024 `H4NY04158` despite a documented 2022 NY-04 run (`H2NY04244`) — the older ID is simply absent upstream. Consequence for a future `sync-fec` switch: it **cannot assume the authoritative `member_fec_ids` array is complete** when disambiguating the fuzzy `members.fec_candidate_id` to the current-office ID. The array is authoritative for what it contains, not exhaustive of what exists. (The inverse case is cleaner: 2nd-term members like Ivey/Self have their real IDs and the fuzzy pick is just a wrong-registration match — see backlog.)

## `sync:members` is manual; between runs, special-election seatings are absent from `members` (HO 402, Jul 2026)

`sync:members` runs by hand (quarterly-plus), so a mid-Congress special-election winner has no `members` row until the next re-run. When `sync:crosswalk` runs against that gap, its gate (load all known bioguides, skip anyone absent) **refuses to invent the member** — the gap surfaces as a `skipped_no_member` count, never an orphan crosswalk row pointing at a non-existent member. James Gallagher (G000607, CA-01, sworn in Jun 10) was the instance: `skipped_no_member` until the members re-sync added him, then picked up on the next crosswalk run. Fix is always the same ordered pair: `sync:members` → `sync:crosswalk`.

## FEC candidate IDs persist per-person-per-office, so distinct-ID count == flattened rows (HO 402, Jul 2026)

An FEC candidate ID is stable per person per office across cycles, so in `member_fec_ids` the count of distinct `fec_candidate_id` equals the total flattened row count (605 == fec_rows in the HO 402 coverage run — no member shares an ID with another, and no dedupe is needed). If those two numbers ever diverge, something upstream reused an ID across members and the flatten assumption is broken.

## Voteview `party_code` follows caucus, so genuine independents read 328→I and only a major-party-caucusing independent diverges from registration (HO 430, Jul 2026)

The ideology diagnostic's `party_code`-vs-`members.party` check flags almost nobody. Voteview codes genuine independents `328` (→I): **King (I-ME) and Sanders (I-VT) code `328`**, already matching `members.party='I'`, so they agree. The only current divergence is **Kiley** (registered `I`, Voteview `200`/R because he caucuses R). The backlog's QUEUED item (carried from HO 422) had logged **all three** as flagged; a live run before touching the code showed **one**. Same lesson as *The planning copy lags the live repo* above — the logged claim was a claim, not a fact, and the diagnostic run is the authority. The correct invariant is **neither-match**: flag only when Voteview's letter matches neither registration nor caucus (a caucus-*only* swap would newly break King/Sanders, VV=I vs caucus=D). Fixed at HO 430 (`d061284`) with a small typed `INDEPENDENT_CAUCUS` map; the disagreement line now reads 0 on a clean roster with all three independents present.

## The dashboard competitive popover renders only on the default variant, not live `/` (v2) (HO 470 / 432, Jul 2026)

`CompetitiveRacesStrip` has two render branches: `variant === "v2"` renders the whole-`<Link>` `RaceCard` (no popover); the default (else) branch renders the `.competitive-race-cell` hover **popover** (`RaceHubBody preview`). Live `/` passes `variant="v2"` (`app/page.tsx:123`), and the **only** route that reaches the default popover branch is `/dashboard-classic` (`app/dashboard-classic/page.tsx:97`, the sole `<CompetitiveRacesBlock />` with no variant) — the sunset route. So anything added to that popover (e.g. HO 432's race-news "IN THE PRESS" block + hover-bridge) ships on **classic only**, invisible on the live dashboard.

Both HO 432's author and the HO 470 executing session independently asserted "the dashboard has a race-news popover to extend" by grepping the popover branch **without checking which variant the caller passes** — a stale premise that survived two handoffs (HO 470's own "no live drawer" read was correct but stated too flatly, which made the disagreement look real). **Lesson: `CompetitiveRacesStrip` branches on `variant`; confirm the caller's variant (`app/page.tsx` = v2, `/dashboard-classic` = default) before reasoning about which card/popover renders.** Landmine that will re-trigger this: the HO 260 comment at `CompetitiveRacesStrip.tsx:74` still reads "`/` keeps the default variant" — **stale since the HO 311 v2→`/` swap**; fix on next touch of that file (a code change, deliberately not folded into this doc sweep).

## The parked `/bills`-redesign plan claimed `getTopicDistribution` "no new query needed" — false, it rebases on STAGE only (HO 495–496, Jul 2026)

The plan that scoped the `/bills` two-pane logged "existing `getTopicDistribution()` — no new query needed." A 30-second read of the helper disproved it: `getTopicDistribution` applies `filters.stage` and **nothing else** (not chamber, not ceremonial, not `q`; `filters.topic` is never touched), so the redesign's rail — which rebases on stage/chamber/ceremonial — was genuinely new query work, shipped as the separate `getBillTopicRailCounts`. Same logged-claim-isn't-a-fact pattern as the **Kiley independent flag** (a QUEUED diagnostic logged all three independents as flagged; a live run showed exactly one — see *Voteview `party_code` follows caucus* above, fixed HO 430) and the **stock-trades "FMP is dead / trades parked" premise** (both wrong on a live check — HO 388). Same fix every time: read the implementation before scoping, not the prose about it. This is the same lesson as *The planning copy lags the live repo* above, on the query-behavior axis.

## On `/bills`, free-text `q` gives ZERO scan-narrowing to the topic-rail count (HO 495, Jul 2026)

The `/bills` rail counts (`getBillTopicRailCounts`) rebase on stage/chamber/ceremonial but deliberately **not** on `q` — a cost/correctness fact, not a preference. The count query `GROUP BY`s all 24 topics regardless, so it walks the whole (filtered) topic index whether or not a `q` predicate is present: broad "act" (29k matches) and narrow "quantum" (74) timed **identically** (HO 495). The `LIKE` only filters which rows survive into the count; it never shrinks the scan. So rebasing the rail on `q` buys nothing on cost while making every distinct search string its own unbounded cache key. **Don't "fix" the rail to rebase on search** — the rail is a browse spine, search is a needle-finder. (The feed itself still filters by `q`; only the rail count ignores it — the intended PARTIAL behavior, confirmed on sight in HO 496.)

## A multi-select rail over OR feed semantics needs self-exclusion — two topic-handling rules in one request (HO 496, Jul 2026)

`/bills` topics filter the feed with **OR** (`topics LIKE ? OR …`), and the topic rail is **multi-select**. Two behaviors read as bugs until you know the rules: (1) selecting a *second* topic **grows** the feed count (HLTH 2,778 → HLTH+TAX 3,873), because OR is a union, not an intersection; (2) selecting a topic does **not** collapse the rail to that topic — the rail count **omits the topic clause entirely** (self-exclusion), because a rail count must predict what *clicking* a topic does (clicking TAX while HLTH is lit ADDS TAX bills), so each row means "topic X under the current stage/chamber/ceremonial", never "HLTH-and-X". So one request carries two different topic-handling rules: the feed applies the OR topic filter; the rail count omits it. `getBillTopicRailCounts` is kept a separate function from `getTopicDistribution` partly to keep this self-exclusion explicit and off the dashboard treemap.

## An optional field on a shared row type can't tell you whether the SELECT populates it — the check tsc can't run (HO 507–508, Jul 2026)

The HO 507 `/bill/[id]` hero needed `sponsor_bioguide_id`, `cosponsor_count`, and `stage_changed_at`, and the spec waved them through as part of "everything else the page already fetches." It didn't fetch them — `getBillById`'s SELECT never covered any of the three. Yet nothing failed to compile, because all three are **optional** on the shared `FeedBill` row type (`lib/queries.ts:130`, `:139–140`): the HO 188 comment makes the sponsor/cosponsor pair `undefined-safe in rowToFeedBill` *precisely* so feed-shape queries that don't SELECT them (`/stale`, `/changes`, `/watchlist`) "degrade to null," and `stage_changed_at` is likewise an optional stage field. `BillDetail = FeedBill & {…}` (`:160`) inherits that optionality, so `getBillById`'s hand-assembled object literal **omitting all three typechecked cleanly** — tsc had nothing to catch. The type said *"these may be absent,"* and they were: permanently, for every caller of this function. So the banked instinct — "`BillDetail` casts as `FeedBill & {…}` but the SELECT didn't cover it, so the type lied to tsc" — is the right smell and the wrong mechanism. A *lie* implies tsc *could* have caught it; it couldn't. An optional field carries no information about whether any given query populates it — that's the check tsc structurally cannot run. The failure mode isn't a compile error, it's a **silently-null render**: a new consumer writes `bill.cosponsor_count`, tsc is happy, and the support bar renders empty **forever**. `stage_changed_at` is the sharper case — `BillStageBar` reads it, so the bar would have rendered with *no timing* rather than simply not rendering. The rule: **before consuming an optional `FeedBill` field on a new surface, read the SELECT, not the type.** Here Code's diff review caught it pre-merge; the fix was three plain `bills` columns on the existing point lookup — no JOIN, no new row shape. Same class as *The parked `/bills`-redesign plan claimed `getTopicDistribution` "no new query needed"* above, on the query-behavior axis: both trusted prose (a spec line / a plan note) over the implementation, and the fix is identical — read the SELECT, not the claim about it.

## Empty-state policy is a property of the data's cardinality, not of the component (HO 509–510, Jul 2026)

The same `RecordTabs` shell makes opposite empty-state calls on its two consumers and both are right. On the member hub a tab renders at zero and dims (`TRADES (0)`, `AMENDMENTS (0)`): a member always *is* something, so "0 disclosed trades" is a true fact about that person, worth stating. On `/bill/[id]` a tab is **omitted** at zero, so a bill with none of committees/hearings/amendments/lobbying gets **no box at all** — because most of the ~15k-bill corpus has exactly that shape, and four dimmed tabs would be noise on the majority of the corpus. The rule to carry: decide show-vs-omit from **how often the zero case fires across the corpus**, not from a single surface's aesthetics. And keep the component dumb about it — membership is the page's contract; `RecordTabs` only knows `tabs.length === 0 → null`, and the page decides per-tab whether a zero-count tab exists at all. Two consumers, one shell, opposite-and-correct policies, because the deciding fact lives in the data, not the widget.

## A client island's lazy useState initializer doesn't re-run on a same-instance route reconcile — key it to the entity (HO 510, Jul 2026)

`RecordTabs` resolves its `initialKey` (which tab opens) in a **lazy `useState` initializer**, which runs on **mount only**. If the App Router ever reconciles `/bill/a` → `/bill/b` (or `/members/x` → `/members/y`) as the *same* component instance rather than remounting, the `active` tab index carries across the navigation and `initialKey` is silently ignored on arrival; the `active < tabs.length` backstop prevents a crash but yields an arbitrary opening tab. Fixed with `key={bill.id}` / `key={member.bioguideId}`, which forces a remount per entity so the initializer re-runs. **State it honestly: this was never observed firing** — no bill→bill or member→member client nav is reachable from inside either page today (the links out go to feeds or other entity types), so it's cheap insurance against a future link, not a diagnosed bug. The generalizable form: **any per-entity client island whose initial state derives from props needs an entity `key`**, or that derivation is mount-only and goes stale the first time the router reuses the instance.

## A helper that "already joins X" may not — check the FROM clause, not the neighborhood (HO 512, Jul 2026)

The backlog line proposing the `/news` `?member=` feature asserted `getNewsFeed` joins `observation_entities` because the news *pillar* has an observation layer (HO 394) and two sibling helpers (`getRaceNews`, `getMemberNews`) do join it. `getNewsFeed` drives `news_mentions INNER JOIN bills` and never touches the observation tables. Had the filter been built where the backlog pointed, it would have shipped **green** — a person-filter over bill-matched mentions returns rows, just the wrong subset (~the fraction of a member's coverage that also matched a bill), so **the failure would have been a quietly short list on the out-link, not an error** (and one that reads as *fewer* rows than the tab it came from). A backlog line's *mechanism* is a claim like any other; the probe-before-fix rule covers it. HO 512 resolved it by branching to `getMemberNews` — zero `getNewsFeed` changes; see roadmap "Also (HO 512)". **HO 559 is the strongest case of the rule: a single read-only probe falsified *both* halves of a two-year banked pair — M1 found the "date-driven VOTED classification" item targeting code HO 333 had already orphaned, and M4 found the "never re-polled" item describing a re-poll the cursor already did — so neither was built (see the primaries-arc oddities near EOF + roadmap "Also (HO 559–561)").**

## A client-nav (router.push) timing artifact can fake a count-invariant failure — re-measure by direct URL (HO 515, Jul 2026)

The `/news` topic rail's design invariant is "the rail count for a topic EQUALS the feed total when that topic is selected" (both count DISTINCT ARTICLES via the shared `NEWS_ARTICLE_KEY_SQL`, HO 442 coherence). Code's first Playwright check *appeared* to show a mismatch (rail 43 vs feed 50); re-checking by loading `/news?topic=government_operations` **directly** showed **43 === 43**. The apparent failure was pure instrument: `NewsTopicRailRow` scopes via **client `router.push`** (a soft nav, no network load event), so `waitForLoadState("networkidle")` returned before the soft nav updated the URL/DOM, and the assertion read the still-bare page (feed capped at 50). **The rail count and the feed total are computed in the SAME server render**, so they *cannot* actually disagree — meaning **any observed mismatch here is an instrument defect, not a data defect**, and the correct response is to re-measure by direct URL, not to hunt a drift bug. Sibling of the HO 506 instrument-defect class ("a close criterion whose instrument can't fail") and the BotID/headless notes (HO 486/504): the failure mode is *wasted debugging of a non-bug*, cheap to prevent and expensive to repeat. Rule: to verify a server-render invariant, drive the server render (direct URL), not a client soft-nav under a network-idle wait.

## A delegate carve-out on a participation dotplot is population-correctness, not outlier-trimming — the real high tail is voting members (HO 527, Jul 2026)

The `/members` participation dotplot (HO 527) carves out the 6 non-voting House delegates — `chamber='house' AND state IN ('DC','AS','GU','MP','PR','VI')` (there is no delegate flag; that territorial set is the reliable predicate, and it caught exactly 6). The HO 527 handoff's premise was that the carve-out earns its place because "the delegates are the high outliers." The STEP-0 distribution read shows that's only half-true. Only **2 of 6** delegates are extreme outliers (Radewagen AS **82%**, Plaskett VI **50%**); King-Hinds (MP 22.6%) is mild; and Moylan/Norton/Hernández (GU 13.1 / DC 8.3 / PR 6.0%) sit **inside the normal cloud**. Conversely the non-delegate max is **29.02%** — Frederica Wilson, a full voting member — **higher than 4 of the 6 delegates**, with Hunt (24.7%) and Kean (22.8%) right behind. So the carve-out is a **population-correctness rule** (delegates are structurally ineligible on final-passage votes, Voteview `cast_code=9`, regardless of where their rate lands), **not** an outlier trim — and the surface's right edge (`CAP=30`) is set by real absentee **voting** members, not the carved delegates. Dropping the 2 extreme delegates genuinely rescues the domain (82%/50% would blow the x-axis to 5–6× the real ~29% spread), but the footer's "delegates excluded (non-voting)" disclosure is honest precisely because it's framed as structural ineligibility, not "worst attendance." The transferable rule: when a carve-out is justified as "removing the outliers," check whether the excluded set actually *is* the tail — here it isn't, and the correct justification (structural ineligibility) is stronger and survives the data not matching the premise. Same probe-the-premise class as the backlog-mechanism corrections (HO 512/514), on the distribution-shape axis.

## The amendment→vote join is two different keys per chamber, and the "obvious" column is dead — probe the mechanism (HO 529, Jul 2026)

The banked `recordedVotes` item (HO 452) assumed one mechanism for a member-level amendment-vote surface: walk each amendment's `/actions` to recover its roll-call number (~2× the amendments backfill). The HO 529 probe found that premise **half wrong**, and the two "obvious" join keys behaved opposite to expectation. **(1) `votes.amendment_designation` is dead for amendments.** The column name suggests it links amendment votes to amendments; it doesn't — the vote syncs write it only for nomination/treaty votes (`PN11-13`), and tag actual amendment votes to the underlying `bill_id` or to nothing (both `amendment_designation` and `bill_id` NULL). 0/431 amendment votes join through it, raw or normalized — not a zero-pad/casing gap, a *populated-for-the-wrong-thing* column. **(2) The real Senate key is the `question` free text.** Senate amendment votes read `On the Amendment S.Amdt. 14 to S.Amdt. 8 to S. 5` — the voted amendment's number is the first one, a regex away, and `(congress, number)` is unique so it's an unambiguous join with zero API/backfill (114 SAMDT, `member_votes` present). **(3) The House has no cheap key at all.** House amendment votes read a generic `On Agreeing to the Amendment` — no number, only `bill_id`, which can't say *which* of a bill's amendments — so text-parse can't do the House; only the `/actions.recordedVotes.rollNumber` walk disambiguates it (and it resolves 100% to already-ingested `votes` rows, so it's a *linkage* backfill, not a member-vote one). So the same logical join is FREE on one chamber and needs an API walk on the other, and the column literally named for the job is inert — none of which is visible without reading real rows. Transferable: a plausible-looking join key (a column named `*_designation`, a shared `question` format) is a claim about the data, not a fact about it; measure the actual match rate per stratum before scoping the build around any one key. Same probe-the-mechanism class as HO 512 (`getNewsFeed` "already joins observation_entities" — it didn't) and HO 514, on the join-key axis; and the surface's tail (the House needing the walk for a rare payoff) is the HO 461 "the floor almost never votes on amendments" finding recurring.

## Never return a Map/Set/Date/class from an unstable_cache function — it round-trips to {} on a cache HIT (HO 533, Jul 2026)

`getBillAmendmentVotes` (HO 530) returned a `Map<amendmentId, AmendmentVote[]>`. It worked on every cache *miss* and threw on every cache *hit*: `unstable_cache` serializes its return value, and a `Map` serializes to `{}` — entries lost, `.get` gone — so the consumer's `votes.get(a.id)` threw `votes.get is not a function` and **500'd every amendment-bearing `/bill/[id]` for ~59 of every 60 minutes, latent since HO 530 first shipped.** Same failure for `Set` (→ `{}`), `Date` (→ an ISO string, silently), and class instances (→ plain objects, methods gone). The fix is to return **plain objects / arrays / primitives** — here a `Record<amendmentId, AmendmentVote[]>`, consumer reads `votes[a.id]`. The repo already followed this everywhere else (a ~90-function audit found this the only violation; the `Record`-returning cached functions like `getPacIeSpending` and the LDA bill-drill are the correct pattern; dates are always `.toISOString()`'d to strings before return). **The tsc blind spot:** the function was annotated `Promise<Map<…>>` and tsc was clean — the type was *honest*, the `unstable_cache` layer just doesn't honor it at runtime, so the compiler can't catch it (the HO 508 optional-shared-field-vs-SELECT class: a real gap tsc structurally can't see). Rule: an `unstable_cache` return type may only contain JSON-serializable values; a `Map`/`Set`/`Date`/class in the return position is a runtime bug the compiler will pass.

## Cache-miss verification right after a deploy does not exercise the cache-hit path — repeat the hit (HO 533, Jul 2026)

The Map-serialization 500 above fired **only on a cache hit**, yet HO 530 and HO 532 both landed "verified live" — because every check ran in the ~1-hour window right after a deploy, when the `unstable_cache` entry was cold and the code took the cache-*miss* path (which builds the Map fresh in-process and works). Three deploys, three misses, three false "verified"; the bug shipped and lived latent across all of them. The cache-hit path is the *normal* path (it serves ~59 of every 60 minutes at a 3600s revalidate); verifying only the miss tests the one path that can't fail this way. **Rule: to verify anything behind `unstable_cache`, hit it 2–3 times (or wait out the revalidate window) — the second hit is the real test, since it reads the serialized-and-deserialized value.** Sibling of the HO 486/504 headless/BotID class and the HO 515 client-nav-timing artifact: the failure mode is a verification method that structurally can't observe the defect, so "verified" is a false negative — cheap to prevent (one extra request), expensive when it ships a 500 to every relevant page.

**HO 548 mechanized this into the crawl so it no longer rests on someone remembering to hit twice:** `smoke.spec.ts` now hits every route a second time (a fresh `goto`, not `reload`), marks the collectors after hit 1, and asserts the hit-2 slice hard-200 — `hit1=200 … | hit2=500 …` is the readable HO 533 signature straight off the CI log. **The detector was proven able to fire (HO 549 STEP 0, nothing committed):** re-injecting the exact defect on HEAD — `getBillAmendmentVotes` returns a `Map`, `BillAmendments` reads `.get` — and running the crawl against a local `next start` produced `[bill-detail] hit1=200 … | hit2=500 … bad=1 console=1 pageErr=1` on `119-hr-8800`, then reverted clean. This closes the "an instrument that structurally can't fail reads the same as one that works" gap named in the backlog preamble: the mechanized check is only protection because it was shown to catch the very defect it guards. **Caveat that keeps a green hit-2 from being over-read:** if a route were served from Next's *full-route* cache, hit 2 wouldn't re-enter the component and would prove nothing — every crawled route reads `searchParams` / is dynamic so the component does re-run, but a green hit-2 is "no serialization regression observed," not a stronger guarantee (documented in the crawl loop comment). **And local ≠ Vercel for the miss→hit transition:** STEP 0 fired locally because `next start` keeps the Data Cache on the filesystem; a non-firing local result would have been *ambiguous, not a disproof* — the honest posture there is to record the check as unproven, not to hunt for a green.

## An unqualified column inside an ORDER BY *expression* resolves against input tables, not SELECT aliases (HO 535, Jul 2026)

The `/members` MISSED sort (HO 535) carves delegates by exposing their missed-rate as NULL in the SELECT — `CASE WHEN <delegate predicate> THEN NULL ELSE pa.missed_pct END AS missed_pct` — so their rows display `—`. The handoff then ordered by `CASE WHEN ? = 'missed' THEN missed_pct END DESC`, expecting that carved (NULL-for-delegates) value. It did not get it: SQLite lets an ORDER BY reference a bare SELECT alias **only when the alias stands alone as the entire ORDER BY term**; the moment the name appears *inside an expression* (here, inside the CASE), it resolves against the FROM/JOIN tables instead — picking up `part_agg`'s raw, un-carved rate. So Radewagen (82%) and Plaskett (50%) sorted to the **top** of "most missed" while their rows still displayed `—` (the SELECT carve worked; the ORDER-BY carve silently did not). Fix: repeat the carve expression in the ORDER BY — a shared `MISSED_CARVE_EXPR` constant used in **both** the SELECT and the ORDER BY, so they cannot diverge. General rule: a SELECT alias is NOT visible to an *expression* in ORDER BY / WHERE / GROUP BY — only as a standalone ORDER BY term; any computed ordering that must match a computed column has to repeat the expression (or wrap the query and order the outer). The probe caught it (delegates-on-top before commit) — the diagnose-before-fixing discipline; same "verify the mechanism, not just that it compiles" class as the HO 533 cache-hit lesson, on the SQL-scoping axis.

## A roll call's yea/nay is renderable as support for an amendment ONLY when the question IS the amendment (HO 537, Jul 2026)

The `/amendments` "voted" cut and `getBillAmendmentVotes` match Senate amendment votes by `votes.question LIKE 'On the Amendment S.Amdt. N …'` — deliberately NOT every roll call that *mentions* an amendment. HO 537 measurement 8 enumerated the 161 senate votes mentioning "Amdt": **97 are up-or-down** ("On the Amendment"), **64 are procedural** — `On the Motion to Table / Cloture Motion / Decision of the Chair S.Amdt. N` (14, all resolving) plus `Motion to Waive … Budgetary Discipline Re: <Senator> Amdt. No. N` (50 budget waivers, a different number token). Resolving an S.Amdt number is **necessary but not sufficient** to be the amendment's vote: a procedural vote's yea/nay is on the MOTION, so its polarity is inverted or orthogonal to the amendment's fate, and the amendment-framed `VoteLine` (which prints `{yea}–{nay}` as *on the amendment*) would render it wrong. Concrete cases: `119-samdt-2310` (Motion to Table **Failed** — the amendment was **withdrawn**), `119-samdt-4421` (Cloture Motion Rejected — **withdrawn**), `119-samdt-2360` (Decision of Chair Sustained 53–47 — the amendment was actually **adopted 51–50** by a separate roll call; surfacing the point-of-order vote would hide the win); and 3 of the 14 resolving residual already carry an anchored decisive vote, so a widen would **double-line** them (`list[0]` date-sort could even promote the procedural one). The pre-authorized "widen to the resolving residual" was rejected on this evidence — **the anchored matcher is correct by design.** This also **corrects the HO 529 reading**: its "114 SAMDT" was procedural-inclusive; `votes` is append-only so it can't have shrunk to 97 — 97 is the genuine up-or-down count. Don't widen without a motion-aware model (invert tallies, distinguish cloture from adoption, suppress when an anchored vote exists) — banked as its own arc.

## `deriveDisposition` is safe on `latest_action_text` but misleading-on-tally on a procedural `votes.result` — one helper, two call sites, different safety (HO 537, Jul 2026)

`deriveDisposition(text)` (the amendment disposition keyword scan — `agreed`/`failed`/`other`) is correct on an amendment's own `latest_action_text` ("Amendment Agreed to" / "not agreed to") and on the `votes.result` of an **"On the Amendment"** roll call (the result IS the amendment's outcome). Applied to a **procedural** `votes.result` it gets the *word* but not the *meaning*: `Motion to Table Failed` → `failed` (but the amendment SURVIVED the tabling), `Cloture Motion Rejected` → `failed` (the amendment may have been withdrawn), `Cloture Motion Agreed to` → `agreed` (cloture ends debate, ≠ adoption). This is exactly why HO 537 excludes procedural votes at the **matcher** (the up-or-down `SENATE_AMDT_Q` regex; see the yea/nay-renderable oddity) rather than trusting `deriveDisposition` to sort them — the same helper is safe at one call site and misleading at another, and the safety lives in *what you feed it*, not in the function. Rule of thumb: a text-keyword classifier is only as honest as the guarantee that its input describes the subject you're labeling.

## Cache tags must follow the tables a query READS, not the pillar it belongs to (HO 537, Jul 2026)

`getAmendmentsSummary` / `getAmendments` are "amendments" surfaces, so they were tagged `["amendments"]`. The HO 537 voted cut makes them **READ `amendment_votes` / `votes` / `member_votes`** too, so a votes re-sync would leave the readout + per-row vote lines stale to the 3600s revalidate backstop — invisible until someone notices the numbers lagging. Fix caught in review: add the `votes` tag (`{ tags: ["amendments", "votes"] }`). The rule: a cached query's `unstable_cache` tags must cover **every table it reads**, not just the pillar it nominally belongs to — the tag set is a function of the query's FROM/JOIN clauses, and it drifts whenever a query grows a new read. Precedent: HO 535 added `votes` to `getMembersRanked` / `getCommitteeRoster` for the same reason (they started reading `member_votes`); `getBillAmendmentVotes` already carried `["votes","amendments"]`. When you add a table to a cached query, re-derive its tags.

**The boundary (HO 540 — "every table it reads" is too absolute).** HO 540's vote queries found where the rule stops: **tag a joined table when the field you surface is MUTABLE independent of the row you keyed on; skip it when the join supplies a denormalized display label that can't change without the keyed row changing too.** Both examples, because the contrast is what makes it usable: `getVoteMemberPositions` **tags `members`** — it surfaces `members.party`, which is mutable and drives the party color, and Kiley switched R→I mid-Congress (HO 422), which would have stranded a wrong color behind a 3600s TTL. `getVoteById` (and `getVotesByBill` / `getRecentVotes`, the in-repo precedent) **do NOT tag `bills`** despite the `LEFT JOIN bills` — the only field surfaced is `bills.title`, which can't drift without the bill row moving, the staleness is cosmetic and bounded, and tagging it would flush every vote query on a 6-hourly 17k-row `bills` sync for a label that never changes. So "reads a table" is necessary context, not sufficient reason: the test is whether the surfaced field can go stale while the keyed row stays put.

## An empty state must distinguish data that hasn't arrived from data that will never arrive (HO 540, Jul 2026)

`/vote/[id]` ships TWO empty states on one page, chosen by the tally: a vote with `tally>0` but zero `member_votes` is **lag** — the vote list syncs ahead of member detail (4 votes, newest `house-119-2-269`), so it reads "Member positions haven't synced yet" and self-heals on the next votes sync; a vote with `tally=0` AND zero positions is a **by-name / procedural** roll call (`house-119-1-2`, Election of the Speaker — members vote for a candidate by name, no yea/nay enum ever lands in `member_votes`), so it reads "no recorded per-member positions" and the zero tally is suppressed (a "0–0" on a Speaker election is meaningless). Shipping "positions haven't synced yet" on the second would be a **lie** — nothing is coming. This generalizes HO 533's wrong-is-worse-than-absent from *suppressing a false value* to *choosing between two truthful ones*: the question to ask of any empty state is not just "is it empty" but **"is something actually coming, or is this the final state?"** — the copy has to say which.

## A git fast-forward onto a preview-built SHA can leave prod behind (Vercel dedup) (HO 540, Jul 2026)

`df155de` (a docs commit) sat unpromoted on prod for ~30 min while `verify:deploy` reported a SHA *behind* HEAD — with no failing build to point at. Mechanism: the review-ref workflow (HO 539) pushed `df155de` to `refs/heads/539-review` FIRST, so Vercel built that SHA as a **preview** (`target: null`); when `main` then fast-forwarded onto the same SHA, Vercel **deduped against the existing preview build** and never created a production deployment, so the production alias stayed on the predecessor (`588bed0`). It's timing-dependent — HO 538's `9a10791` got both a preview AND a production build because the two events landed far enough apart. **Harmless on a docs commit; a verification BLOCKER on a UI one**, since cache-hit prod verification is the ship gate. The fix is automatic: the **next direct-to-main push is a fresh SHA Vercel has never built**, so it gets a production build and promotes, carrying the stuck content forward. Diagnose via `list_deployments` — the stuck SHA shows `state: READY, target: null, githubCommitRef: <ho>-review`. **Recognition symptom:** `verify:deploy` reports a SHA behind HEAD right after a review-ref fast-forward, no failing build. (SKILL's review-ref section names this and links here — the HO 505 ownership split.)

## Senate amendment votes don't carry `bill_id`, so they never leak into `getVotesByBill` (HO 542, Jul 2026)

`getVotesByBill(billId)` is `WHERE v.bill_id = ?`, so it returns a bill's own passage/procedural votes AND any amendment votes that carry the bill's `bill_id`. The HO 542 `/bill/[id]` VOTES tab must show only the *own* votes, so amendment votes are excluded — and the exclusion set turns out to be **House-link only**, provably sufficient. Why: House amendment votes are recovered through the `amendment_votes` walk table AND carry `bill_id` (HO 532); **Senate amendment votes are matched by parsing `votes.question` (`On the Amendment S.Amdt. N`) and carry no `bill_id`** — the same chamber asymmetry HO 540 found in amendment-context presence (90 House amendment votes carry `bill_id`, 97 Senate don't) and HO 529 first found in the question text. STEP 0 (`bill-votes-overlap-542.ts`) measured it directly: of **92** amendment votes among the 890 bill_id-carrying votes, **92 House-linked, 0 Senate-pattern, 0 Senate-not-also-House** — Senate amendment votes never enter `getVotesByBill` at all. So the belt-and-suspenders `SENATE_AMDT_QUESTION_LIKE` check the handoff pre-authorized is a no-op, and the page's exclusion is a plain `Set<string>` over the already-fetched `amendmentVotes` map values — **no `lib/amendment-vote-key.ts` import request-side**. The rule: a filter over `getVotesByBill` needs only the House amendment-vote link set; Senate amendment votes are invisible to it by construction. **If a future Senate ingest ever stamps `bill_id` onto amendment votes this inverts** — re-measure the Senate-pattern count before trusting House-link-only.

**The same asymmetry's second face (HO 550 M5 → 551).** The chamber split cuts the *other* way too, and it produced a live P1. Because the Senate matches amendment votes by parsing `votes.question` through the anchored `SENATE_AMDT_Q`, it filters to the decisive up-or-down form **for free**; the **House** recovers links by constructing `vote_id` from `/actions.recordedVotes` (HO 532), which carries **no question**, so the HO 532 walk linked EVERY `recordedVote` unfiltered — including the procedural roll calls Congress.gov attaches to a HAMDT's `/actions`. HO 550's M5 found **2 live** (`119-hamdt-40`→`house-119-1-187`, `119-hamdt-175`→`house-119-2-122`, both "On Ordering the Previous Question") rendering through the amendment-framed `VoteLine` as the amendment's own outcome. HO 551 closed it by giving the House a counterpart to `SENATE_AMDT_Q` in the **same leaf module** — `HOUSE_AMDT_QUESTION_LIKE`, applied by JOINing `votes` at link time (the walk has no question in hand). The generalization worth keeping: **an anti-drift leaf module only prevents drift for the chambers that actually have an entry in it.** The Senate had `SENATE_AMDT_Q` from HO 537; the House had nothing until HO 551; and the gap was exactly where the mislink lived — a shared module documents the *convention* but only enforces it on the code paths that import its predicate.

## A queue that stamps on exit turns a transient failure into a permanent one — unless that failure is explicitly non-stamping (HO 551/552, Jul 2026)

`amendment_votes` is filled by a walk over a HAMDT queue: `walkAmendmentVotes` fetches each amendment's `/actions`, links the decisive vote, and **stamps `amendment_vote_walked_at` on exit**; the queue predicate (`update_date > walked_at`) then skips the walked row. That's the HO 459 sentinel pattern, whose rule is "**stamp every row you walk, even one that yielded no link**," so a walked-but-empty amendment doesn't re-fetch forever. But HO 459's rule is about **walked-no-result** (a *settled* state — there is nothing to link), and the HO 551 decisive-form gate introduced a failure the rule does NOT cover: **walked-can't-tell-yet** — the `votes` row for a just-cast roll call hasn't synced, so the link can't be made *this* run but will be makeable next run. Stamping *that* on exit drops the decisive link **permanently**, because the `update_date` bump that would re-queue the amendment was already spent getting it queued this run (a just-voted HAMDT gets exactly one bump; the queue predicate can't re-fire off a bump that already happened). The walk already had the right instinct for the analogous case — a `/actions` **fetch error** deliberately does NOT stamp (`continue`, retry next run) — but the missing-`votes`-row case was silently folded into the stamp path, and the 551 gate turned that latent asymmetry into a live drop (fixed HO 552: an existence check leaves an absent-row HAMDT unstamped). **The rule: when you add any new failure mode to a stamp-on-exit queue, classify it as *settled* or *pending* before deciding whether it stamps.** Settled (no-result, wrong-question) stamps; pending (a dependency not yet available, a transient fetch error) must NOT — it retries. The tell that HO 552 was the right call: the fix mirrors `fetchErrors`, the one failure the walk had already classified correctly, and HO 459's "stamp every row" was never a licence to stamp a row you *couldn't yet evaluate*.

## A shipped VALUE change behind unstable_cache doesn't land on the first prod read — verify by convergence, not hit-count (HO 555, Jul 2026)

The HO 533 rule ("hit it 2–3 times — the second hit is the real test") covers the serialization-SHAPE class: a `Map`→`{}` round-trip breaks on any hit, so two hits expose it. It says nothing about WHEN a new VALUE arrives — and because the Vercel Data Cache **survives deploys** with build-stable keys (the HO 312 entry above), a shipped value change is NOT live on the first post-deploy read: the first hit serves the **stale pre-deploy value** and only *triggers* the SWR regeneration in the background. HO 555 hit this verifying the `deriveDisposition` widening: the served SHA was confirmed current, yet the first `/amendments` reads still showed the old 337/173 buckets. The rule for a cached value change: **(1)** confirm the served SHA first (`/api/version` via `verify:deploy`) so a stale read isn't misdiagnosed as a failed deploy; **(2)** hit until the value **converges to the expected new number and then holds** across further hits — "hit twice" is not the criterion. Expect per-query convergence rates: at 555 the lighter per-bill dot query converged before the heavier `/amendments` summary (a lighter regen finishes first). A cron firing `revalidateTag()` mid-verification also clears it. Corollary: this is only visible for value changes — a shape bug (HO 533) fails the hit path regardless of staleness, which is why the double-hit harness assertion and this convergence rule are different instruments, both needed.

## Widen a keyword classifier only to a measured vocabulary — and kill-family-first ordering is correctness, not style (HO 554 M2 → 555, Jul 2026)

HO 554's probe surfaced 3 example phrasings the disposition dot missed; HO 555 refused to patch the examples and instead clustered the FULL `other` bucket (115 acted rows, top-30 normalized shapes hand-tagged KILL/PASS/NEITHER/AMBIGUOUS), so the widening is the **measured** kill set: "ruled out of order" anchored to the full phrase (bare "out of order" over-matches) and word-boundaried "fell". The measured **exclusions** matter as much as the additions: "withdrawn" = survived the vote, pulled later (neither); "rendered moot" describes the cloture motion's fate, not the amendment's; "cloture not invoked" is orthogonal procedure; "stricken" is not a kill token (a "…stricken by SA N withdrawn" row is a withdrawal). Two gates before shipping a widened token set: **(1) collision** — grep every candidate token against the OTHER input family the function serves (`votes.result`, 4 strings): zero overlap means one shared function holds; a collision would force a split, silently changing the voted-block semantics. **(2) zero-flip** — no row may move agreed↔failed under the candidate; a flip HALTs for a human call. The one flip here (`119-samdt-3963`) was accepted because the OLD read was the wrong one: its text is "SA 3963 fell when …" with a trailing "agreed to" belonging to the subordinate clause, and the old classifier read the clause. Which is the second lesson: **the failed-family-FIRST branch order is load-bearing correctness**, originally for "not agreed to", now also for subordinate clauses — a trailing agreed-family token about a *different* motion loses to a kill token about the amendment itself only because failed tests first. Reordering the branches is a behavior change, not a refactor.

## A procedural motion's implication is a statement about a moment, not an outcome — and only one-directional motions can be rendered as a fate (HO 550 → 554 → 557, Jul 2026)

The motion-aware amendment surface carried a model, from HO 550 through 554, that mapped a motion's result to the amendment's fate: a tabling motion agreed → the amendment "failed", a tabling motion failed → the amendment "agreed". It validated at 96% and passed a DISAGREE=0 tripwire. It was wrong, and the labels hid it: **"survived" and "agreed" are not the same claim**, but the model called both `"agreed"`, so agreement with the disposition dot looked like confirmation when it was a coincidence of vocabulary. HO 557's STEP 0 exposed it only because the HO 555 classifier widening changed the dot underneath — `119-samdt-3946`/`3947` (tabling motion **failed**, then "SA N fell when SA N−1 fell") went from muted dots to red ones, and the contradiction surfaced: the model said *survived*, the dot said *killed*, and **both were true about different moments**. A motion decides the amendment's status **at the motion**; the dot reports its **outcome**; an amendment that survives a tabling motion is *pending*, not adopted, and can still die by another mechanism. The general rule: **a procedural motion can only be rendered as an outcome in the direction where it terminates the thing** — tabling **agreed** kills, budget waiver **failed** kills, and the opposite results mean only "not killed by this motion," which is not a fate. So the shipped `motionFate` has **no positive value** (`"killed" | "undecided" | "orthogonal"`); the non-terminal cases render the tally with no fate clause at all. Two smaller lessons ride along: the rejected fix was to compare the implied fate against the dot at render time and suppress on disagreement — which would have **coupled the motion model to `deriveDisposition`'s vocabulary**, so a later dot widening would silently change motion-line behavior, and would have hidden the modelling error rather than fixing it. And the rename from `"agreed" | "failed"` to `"killed" | "undecided"` is **type safety, not style**: the old union was structurally assignable to `AmendmentVote["disposition"]`, so the compiler would have permitted an implied fate to flow into `dispositionColor()`/`voteVerb()` and print "Agreed" on an amendment that merely wasn't tabled.

## A probe that pins a verbatim copy of shipped logic goes stale silently — and its green is then a measurement of the past (HO 554 → 556 WATCH → 557, Jul 2026)

`motion-outcome-model-554.ts` deliberately re-declares `deriveDisposition` verbatim rather than importing it (importing `lib/queries.ts` drags `next/cache` into a node script, and the probe wants a pinned baseline to compare against). Correct at the time. Then HO 555 widened the shipped classifier, and the copy became a **measurement of a version that no longer runs** — while still printing a clean DISAGREE=0. HO 556's sweep predicted this in a WATCH ("any future edit to `deriveDisposition` must update the probe's copy in the same change or it reads a stale classifier"); HO 557 discharged it on the first opportunity and the reconciled probe immediately read **DISAGREE=2**, catching a model error that would otherwise have shipped as a rendered contradiction on two live rows. The rule: **when a probe embeds a copy of production logic, the copy is a dependency with no compiler edge and no test** — nothing links them, so nothing breaks when they diverge. Two mitigations, applied here: name the mirrored SHA in the copy's comment (so a reader can check it in one `git log`), and treat "re-run the probe" as **including** "reconcile its copies first" — a probe re-run against stale copies isn't a re-run, it's a replay. The generalizable tell is the HO 503/506 same-as-success shape: a stale copy and a current one emit identical green, so the instrument reads the same whether or not the thing it watches has moved. **Second citation, HO 635 — and this time it was inside the standing instrument built to catch the neighbouring class.** `cold-start-audit-332.ts` pins verbatim copies of production SQL so it can EXPLAIN them, and its `queryEnactedThisWeek` copy still windowed on `stage_changed_at` after `9e95b21` re-sourced the shipped query onto `latest_action_date`; re-running it unreconciled would have EXPLAINed a statement **that no longer exists in the product** and passed it green — a misplan audit reporting on a query nobody runs. The cutover reconciled the copy and added its missing prior-week sibling. **The reusable half is one line past the rule above: an instrument that HOLDS a copy needs a check that the copy still matches its original**, because here the instrument's own green is exactly what the staleness buys you.

## An empty collection in a seed file means "no assertion," not "assert empty" (HO 560, Jul 2026)

HO 560 C1 shipped a seed loader that delete-rebuilt the roster unconditionally, so `"candidates": []` in the seed JSON would have **deleted** whatever roster was there. For a dated-but-unpublished contest the seed ships empty on purpose (the field isn't out yet) — but the moment Ballotpedia publishes it and an ingestion pass fills the row, the next routine re-seed would wipe it. The HO 552 class exactly: a normal, idempotent-looking operation converting real data into permanent loss, with nothing to notice and nothing to log. The fix is **asymmetric**: a non-empty `candidates` array asserts a roster (delete-then-insert, the refresh path), an empty/absent one asserts **nothing** and leaves the roster alone (`roster untouched (no seeded field)`). The rule generalizes to any idempotent loader whose input is a collection: distinguish "the source says this set is empty" from "the source is silent about this set" — only the first licenses a delete. The reverse (treating silence as an empty assertion) is the shape that quietly destroys data a *different* writer produced.

## A documented recovery path has to be checked against the state it recovers from (HO 560 → 561, Jul 2026)

HO 560's seed note pointed a future reader at `reingest:primary-slate` to fill the SC special roster "when the page lands." But `reingest-primary-slate.ts` selects seats on `EXISTS(primary_candidates)` and only `UPDATE`s by `(primary_id, name)` — so against a **rosterless** contest it finds nothing to update, prints "nothing to do," and exits clean. The note asserted a protection that could not fire (the HO 549 shape: recorded-as-protection before it was proven able to run), and worse, it read as reassuring — a reader would have trusted a path that no-ops. The correction was to state reachability as a **fact**: no automated path filled those rows until HO 561 built one, so before then the seed is a dated placeholder and nothing more. The rule: when you document "recover with X," run X against the exact state you're recovering *from* — a recovery tool written for a populated row can silently no-op on an empty one, and "it exited 0" is not "it worked."

## A fallback is only reachable when its trigger holds, and the trigger can quietly stop holding (HO 561, Jul 2026)

HO 561's obvious design routed on which URL served: `scrapeSenateCandidates` already falls back to the special-election page when the standard page 404s, and the success path preserves the winning URL on `result.url`, so a roster off the special page could route to `-special-` ids. Correct code that **never executes for SC** — the standard SC senate page returns 200 (the June regular), so the fallback is never reached. Then the S2 sweep found the fallback unreachable for **all 35** states, including FL and OH — the two the fallback was *written for* — because their standard pages now return 200 too. So the routing key wasn't wrong, it was **unreachable**, and its guarding comment ("FL / OH 2026 specials live there") had gone stale without anything failing. The build instead fetches the special page *in addition*, gated on a seeded `-special-` row existing. Sibling of the two entries above and of the backlog-mechanism class (HO 512/529): reachability, not correctness, was the binding constraint — a design can be correct and inert at once, and a fallback silently stops being load-bearing when the condition it waits for stops occurring. (Don't rip the FL/OH fallback out on this evidence — a page can 404 transiently; backlog WATCH.)

## Absence of a parse is not authority to delete (HO 563 → 564, Jul 2026)

The House sync's fall-through treated "page reachable but unparsable" (`no_section` / `no_candidates`) as "the contest is empty" and delete-then-inserted nothing over real results — HO 563 M3 measured this **live at 30%** of resulted House districts, each one a single cursor visit from destruction. The two causes are indistinguishable at the write — the contest genuinely emptied, versus the page stopped parsing — and one of them is destructive, so the write has to refuse: HO 564 sends `no_section` past the write block entirely and gates the per-contest delete on a non-empty incoming roster. This is a sibling of the HO 560 *"an empty collection in a seed file means 'no assertion,' not 'assert empty'"* entry (silence about a set never licenses a delete) and of the HO 552 *stamp-on-exit settled-vs-pending* entry (a not-yet-knowable state must not be handled as a settled one) — **cross-referenced rather than restated here**. The generalization worth keeping: a delete-then-insert is idempotent only when the incoming data is authoritative, and the status code is what tells you whether it is — an empty payload from a parse *failure* is a different fact from an empty payload from a parse that *ran and found nothing*, and only the second one licenses the delete.

## A guard can be correct for the wrong failure (HO 560 → 563/564, Jul 2026)

The House clobber guard sat queued for two handoffs as "the HO 560 predicate, ported across." But HO 560's predicate keys on *already carries a share*, which cannot protect a row whose shares are exactly what gets deleted. Porting it would have shipped a plausible, tested, **useless** guard — it would have passed its own tests (settled rows do stay frozen) while the erasure it was filed against ran on untouched, because erasure hits the *unshared* rows the freeze deliberately leaves open. What separated the real fix from the analogy was **measuring the failure** (HO 563 M3: the House mode is erasure, the Senate's was substitution) rather than reasoning from the resemblance — the two hazards share a delete-rebuild shape and nothing else. The rule: when a new hazard "looks like" one you have already guarded, measure it before porting the guard; a guard aimed at the wrong failure mode is worse than none, because it reads as protection while the actual loss continues.

## The deficit shape did the diagnosing (HO 566 → 567, Jul 2026)

The four zero-`member_votes` rolls HO 566 M2 found were diagnosed by the *shape* of the deficit distribution, not its size: the 1–4 partial bucket was **empty in both chambers** and there were zero surpluses, so every per-member skip cause (a Senate resolver miss, a null position, a missing bioguideID — all of which produce *partial* deficits) was ruled out before a single upstream fetch, leaving only an all-or-nothing inflow race (the tally publishes, the roster doesn't, the row freezes empty). Reading the distribution's shape rather than its count picked the mechanism — and the predicate that fell out of it, **zero-roster (`NOT EXISTS`) never deficit-based**, is self-limiting by construction (a vote that heals even partially gains rows and exits the set), which is exactly what made permanent retry safe to adopt without a spin risk. Sibling of the HO 552/553 settled-vs-pending stamp entry (classify the failure before deciding what to do about it) — **cross-referenced, not restated**.

## A windowed sync freezes its own inflow bugs (HO 566 M3 → 567, Jul 2026)

A watermark/frontier sync (here both vote syncs: House `MAX(vote_date)`, Senate `MAX(roll_call)` per session) converts a *transient* upstream race into a *permanent* local defect — because the retry that would have healed it is precisely what the watermark optimizes away (a stored row is never re-fetched). The fix was **not** touching the watermark (it is correct for cost — re-fetching every settled row every tick is the thing the frontier exists to avoid) but a **targeted self-heal predicate beside it**, re-visiting only the rows written bad the first time. The generalization worth keeping: any frontier/watermark sync owes an explicit answer to *"what re-visits a row that was written wrong on its first and only pass?"* — the absence of that answer is the HO 552 stamp-on-exit entry (a queue that stamps a row it couldn't yet evaluate) wearing a different key. **Cross-referenced, not restated.**

## A prefix glob is not a dead-code list, and a comment naming a dead set rots into a deletion instruction (HO 570, Jul 2026)

The HO 570 cleanup handoff named `.v2f-sponsor*` as dead CSS to sweep. Two things under that prefix were **live**: `.v2f-sponsor-last` / `--plain` (rendered by `V2FeedList.tsx:123,130`), and — more insidiously — the `.v2f-sc-*` sponsor-card block that sat *inside* the same `globals.css` comment declaring "these are dead, sweep later," while actually being **reused by `.bxp`** (revealed by `.bxp-sponsor:hover .v2f-sc-card`, rendered by `BillExpandPanel`). A prefix sweep would have silently killed the sponsor hover card HO 472 had verified. Two rules. **(1) Sweep by enumerated selector, never by prefix** — a `*` glob is a guess about a namespace, not a list of dead rules, and namespaces get reused (`.v2f-sc-*` was lifted from the retired private-Expand into the shared panel). **(2) A comment recording "these are dead, sweep in a follow-up" is a claim with a shelf life** — the neighbourhood shifts under it (HO 319 revived `.v2f-group.open`; HO 317 reused `.v2f-sc-*`), so the sweep must **rewrite the comment against current reality**, not delete under it, or the stale comment becomes the deletion instruction that kills a live rule. The same shape bit C2's export sweep from the other side: the planning grep for `lib/hearings` consumers **excluded `lib/hearings.ts` itself**, so it missed that `weekdayOfKey` is live via an in-module `mondayOfKey` call — a consumer search that skips the defining file can't see intra-module use. Cross-references the shared-component consumer-enumeration gate (a grep that returns a dead file as a live consumer) — same family: a grep is only as good as its scope, and a dead-set claim is only as good as its date.

## A render-layer symptom over a data-layer asymmetry — check what depends on the shape before assuming a direction (HO 570, Jul 2026)

The `FilingRow` React duplicate-`key` warning on `/lobbying` had two tempting readings, both wrong. The reflex ("just a dev-only React warning, cosmetic") and the alarm ("duplicate bill IDs → the distinct-filings ranking is inflated") each assumed a consequence without reading the consumer. The actual shape: the precomputed `readLdaTables` path builds `billsByUuid` with **no `SELECT DISTINCT`** (the live `hydrateFilings` path does), so 82 filings arrive carrying duplicate bill IDs — but the HO 440 ranking is **safe**, because the only consumer that counts, `computeBillDrill`, inverts `billsByUuid` through a `Set<string>` (`lda-rollup.ts:459-464`): a bill repeated inside one filing adds its uuid to a set once. The duplication only ever escaped through `FilingSummary.billIds` — the **display** field `FilingRow` renders — which is exactly where it was fixed (dedupe both chip arrays with `new Set`). So the data-layer asymmetry is real and *stays* (the two ingest paths still disagree on `DISTINCT`); it's harmless only because it converges at the renderer, and only the render path ever saw it. The rule: a symptom at the render layer sitting over an asymmetry at the data layer tells you nothing about severity until you **read what actually depends on the shape** — the ranking that looked threatened was defended by a `Set` two files away, and the warning that looked cosmetic was a real (if benign) duplicate. Neither the dismissive nor the alarmed reading survives reading the consumer.

## A guard that only runs when someone runs it (HO 570, Jul 2026)

HO 570's verification ran `fit-finish.spec.ts` by hand and found a standing red: `e2e/fit-finish.spec.ts:460-470` soft-asserts a scroll to `#lobby-drill`, but that element hasn't existed since the HO 486 `/lobbying` redesign removed it (the `TopicCrosswalk` href still points at the dead anchor). The red had sat undetected — not because of a skip, but because **the suite is manual by design** (a deliberate HO 504 call: it carries the bulk of the interaction guards and stays local, and `e2e-prod.yml` runs `smoke.spec.ts` explicitly, never globbing `e2e/`). This is the sharper sibling of the skip-on-empty trap: there, a guarded test goes silently *green*; here, a whole suite emits **neither red nor green** until a human invokes it, so a soft-assert failure survives indefinitely with nothing even claiming coverage. The cost of the manual posture is not that the posture is wrong — it's that its greens are imaginary until run, so counting them as coverage is the error. Recorded as the demonstrated cost, with the three options (add to `e2e-prod.yml` / promote the stable subset into `smoke.spec.ts` / keep manual and stop counting its greens) left as a decision. **Cross-references** the *skip-on-empty guards invert a fixture's failure mode* and *close criterion whose instrument can't fail* entries — same family (a check that reads the same whether or not the work happened), the manual-suite variant.

## An anchor must live on an element that renders in every state its link can produce (HO 572, Jul 2026)

`#lobby-drill` broke because the HO 486 `/lobbying` redesign removed the element it pointed at, and the obvious restoration — put the id back on the scoped context block, the thing the link is conceptually *for* — would have re-broken it on the unknown-code path, where a well-formed-but-unknown `?issue=` resolves `selectedDrill = null` and the page falls back to unscoped, so that block doesn't render. The fix put the id on the pane container (`.mc-content lob-content`), which renders in every state. The general rule: **enumerate the states the link's own parameters can produce, and place the target on the element common to all of them, not the one you had in mind when you wrote the link.** Note the residue honestly — the id is now named for the drill while marking the pane, which is why it carries a comment; a name that no longer describes its element is a live invitation to a well-meant "correction," and the comment is the only thing standing between the next reader and re-introducing the bug in a narrower door. Cross-references the HO 492 selection-visibility (`scrollIntoView`) and HO 517 rail-pin entries as the same family — a selection the reader made must be visibly located — rather than restating them.

## A failing set characterised from too few samples names the wrong shared property (HO 572 → 574, Jul 2026)

Two `e2e-prod` failing runs made the `pageErr` #418 firing set look **tape-bearing** (`/` + `/?stage=other_chamber`, exactly the tape routes). Four runs made it look like **the relative-age feed surfaces**, after `/president` and `/members` — both non-tape inner pages — fired. Each reading was defensible on its data; each was **premature**. The tell was that the set **grew** with sampling (2 routes → 6, one of them a non-tape inner page) instead of converging on a stable membership. The rule: **before naming the shared property of a failing set, check whether the set has stopped growing — a property shared by everything seen so far is not yet a property that identifies a cause.** The contrast is the load-bearing half: the HO 563 contiguous-districts read and the HO 566 empty-1–4-partial-bucket read (*The deficit shape did the diagnosing*) are the **successful** versions of exactly this reasoning, and what made them work is that the shape was **stable and bounded before it was read** — a contiguous block, an empty bucket — not a set still accreting members. The transferable difference is **sample stability, not cleverness**; cross-reference both rather than restating them.

## A collector that captures more than it prints is a diagnostic you can only use retroactively (HO 574, Jul 2026)

`smoke.spec.ts:129` had been recording `err.message` for every uncaught page error since the crawl was wired; `:200` printed only `pageErr=${n}`. So every failing prod run had the answer in hand and surfaced a **number** instead — and the message survived only inside an expiring **14-day** report artifact, recoverable here only because someone went looking before the window closed (it carried the string; the error was **React #418 `args[]=HTML`**, identical across all four failed runs). The rule: **if a collector stores a string, print the string.** A count tells you *something* happened; it cannot tell you *what*, and by the time you want to know, the run that knew is usually gone. C1 (HO 574) added the second log line that prints the messages on a non-clean route, so the next occurrence self-diagnoses without the artifact dig. Sibling of the *close criterion whose instrument can't fail* family — an instrument that records but doesn't surface is one you can't read at the moment it fires.

## A table must not derive its writes from an unfiltered aggregate over itself (HO 577, Jul 2026)

`calByState` (the House primaries sync) was `MAX(primary_date) GROUP BY state` with no filters — it wrote each state's house primary date by aggregating over `primaries`, **the same table it writes into.** The aggregate had **three distinct wrong winners**: a senate **special** (a later, unrelated election date), a **runoff** row (later than the primary by construction), and — the one that makes this a defect *class* rather than a leak — a **previously-poisoned house row**, which is itself `election_round='primary'` and so wins MAX on the next tick. Measured LA/GA/SC, 48 rows, cause tally special=2 / runoff=3 / **house=48**: the house bucket dominated, so **the loop was already self-sustaining** and the special/runoff were no longer the active cause. The tell: **the feedback rows are indistinguishable from legitimate ones by `election_round`** — both read `primary` — so a filter written against the *observed* cause ("exclude specials, exclude runoffs") would have looked correct and **converged on nothing**, because the poisoned house rows keep winning MAX. The fix is not three exclusions; it is restoring the aggregate to a **clean, non-self-referential source** — the regular statewide senate row (`election_round='primary'`, `district IS NULL`, non-special). **`district IS NULL` is load-bearing because it removes the class that can feed back** — every house row carries a district — not because specials happen to lack one. The rule: a table must not derive its writes from an unfiltered aggregate over itself; the moment its own output re-enters the aggregate, a single downstream error becomes permanent and self-sustaining, and any filter aimed at the symptom you can see misses the copy of the symptom hiding as a legitimate row. Cross-references *A guard can be correct for the wrong failure* (HO 560 → 563/564) — the same reasoning-from-the-observed-symptom trap, one layer down.

## A correct claim with an expiry (HO 577, Jul 2026)

`93_5-la-closed-partisan` recorded that Louisiana moved to closed party primaries for 2026. It was **true when written** — LA genuinely did legislate the change — and was then **undone by an external event after the fact:** *Louisiana v. Callais* struck the congressional map as a racial gerrymander, and Gov. Landry's EO 26-038 (2026-04-30) suspended the U.S. House primaries, which is why HO 577 could trust neither the recorded May-16 closed-primary date nor its own repair's derived date for the LA house rows and had to model them as postponed. This is the sharpest instance of the staleness pattern this ledger keeps hitting: **not a wrong claim, not a stale line number, but an accurate record of a world that changed.** The claim-verification family already covers claims that *look* suspicious — the S-SC-2026 caretaker seat change, Kiley's caucus-vs-registration, the HO 570 dead-CSS glob — and its discipline is "verify the real-world fact before deciding it's a bug." What's different here is that **re-verification has to cover claims that were right**, not just ones that look wrong: a correct, confidently-written record of a real-world fact carries no smell, so nothing prompts a re-check until a build trips over it. When a claim asserts a fact about the world (a primary system, who holds a seat, whether a map stands), its correctness has a shelf life independent of whether anyone edited the doc. Cross-references the claim-verification family (*a logged discrepancy is a claim* — HO 519 / 422 / 430) rather than restating it, and names what's new: the trigger for re-verification can't be suspicion alone.

## A deadline check placed before a call that can sleep is not a deadline (HO 580, Jul 2026)

`/api/cron/lda`'s budget looked airtight: `LDA_BUDGET_MS 280s` (stop starting pages) < soft timeout `290s` < the `300s` function ceiling, and the page loop checked `Date.now() >= deadlineMs` before every `fetchPage`. It still died at the ceiling with a 504. The hole: the 429 `retry-after` sleep lived **inside** `fetchPage`, the very call the check was guarding — so a check passing at 279s was followed by a 39s sleep that landed at 318s, and the SIGKILL skipped the clean `deadlineHit` exit. The rule: **a time budget is only enforceable at the granularity of the longest uninterruptible operation it wraps** — a check *before* a call bounds when you *start* it, never when it *returns*, so any sleep/retry/backoff the callee can perform is outside the budget unless the deadline is plumbed into it. The tell is that the layering looks complete on the page (three numbers, correctly ordered); the gap only appears when you ask what the guarded call is allowed to do once entered. The fix made `fetchPage` deadline-aware (return `null` rather than sleep past the ceiling) and routed that to `deadlineHit`, not `fetchError` — a clean pause, not a recorded failure. Cross-references *A shared budget starves the second job* below (same arc) and the stamp-on-exit family (a clean pause misfiled as an error).

## A shared budget starves the second job precisely when the first has work (HO 580, Jul 2026)

The `/lobbying` rollup ran in the tail of `/api/cron/lda`, gated on `msLeft >= ROLLUP_RESERVE_MS (220s)` of a 300s ceiling — so the sync had to finish inside **80s** for the rollup to start. A real authenticated sync made 259 `lda.gov` calls at ~1s each (~259s). The consequence is an **inversion**: the rollup ran only on days the sync had nothing to do, and was starved on exactly the days new filings arrived — the blob went not "a day stale" (as the code comment accepted) but stale indefinitely until a hand-run `lda:rollup`. Neither constant was wrong in isolation: `ROLLUP_RESERVE_MS` correctly reserved what the rollup needs; the defect was the **coupling**. The rule: **when a network-bound job and a compute job share one time budget, the second one's schedule is set by the first one's idleness, not by its own needs** — and if the first job's busy periods are exactly when the second job's inputs change, the second job is guaranteed to miss them. The fix was to give the rollup its own cron (`/api/cron/lda-rollup`, `0 22`), decoupling the two. Cross-references *A table must not derive its writes from an unfiltered aggregate over itself* (HO 577) as the same family: a component correct on its own, wrong in what it was wired to.

## An entitlement gate is not a rate limit, and the usage meter can't see it (HO 579, Jul 2026)

FMP returned `402` on `page=1` of `stable/house-latest` every `/api/sync` tick, while its own dashboard showed **0/250 calls and 0 MB of bandwidth used**. Both readings were accurate and non-contradictory once you know the distinction: the usage meter tracks **volume** (calls, bandwidth), but the `page=1` block is a **plan feature** — the Free plan permits `page=0` only — and no amount of *not using* the API brings a plan feature into range. The trap is that a 402 with a healthy usage graph reads as "transient / misconfigured / will clear," so the instinct is to retry or re-key rather than to read the plan. The rule: **when a provider's dashboard says you're fine and its API says no, check the plan's feature matrix, not its usage graph** — an entitlement gate is orthogonal to quota, fires deterministically regardless of load, and is identified by the API naming the gated parameter in the body (here, `The values for 'page' can only be 0…`), which is also what lets code tell it apart from a real payment/quota 402. The fix keyed on `402 AND the page-parameter text` and carried it as `planCappedAtPage`, a recorded boundary rather than an error.

## Rows read and milliseconds are different currencies — a covering-index scan is cheap in one, expensive in the other (HO 582, Jul 2026)

HO 582 STEP 0 read the tape query's Q1 plan — `SCAN market_ticks USING COVERING INDEX idx_market_ticks_symbol_time` — and called it "index-only, cheap, ~32ms," and on that basis SKIPPED the C3 rewrite as a no-op. That was wrong, and the reasoning error is the record. `COVERING INDEX` means the scan never touches the table heap, which makes it fast in **milliseconds** — but it still reads **every entry in the index** (~6,604 rows), and this HO's currency was **rows read** against a Turso budget, where an index row costs the same as a table row. After C2 that covering scan was **~6,604 of the ~8,223 residual (~80%)** and — the load-bearing part — it **grew with table history, not symbol count** (~100 rows/day trends toward ~43k/regen within a year), while the fix (N per-symbol `ORDER BY ticked_at DESC LIMIT 1` seeks) bounds it at the symbol count. The rule: **a plan that reads the whole index unbounded by anything but history is still a scan for budget purposes, even when it's index-only and fast in wall-clock** — "cheap" is meaningless until you name the currency. This is the same mistake mirrored from the HO 340/437 family (*a clean `EXPLAIN` says nothing about cold latency; an unbounded aggregate must be COVERING*): there a clean plan hid a slow *scan* (latency the plan didn't show); here a fast *scan* hid an expensive *read count* (budget the latency didn't show). Both are "the plan is not the thing you're paying for."

## A read-time dedupe removes the symptom of a write-path defect, so the defect must carry its own instrument or it goes silent (HO 582, Jul 2026)

The tape's old Q1 (`MAX(ticked_at) … GROUP BY symbol` joined on `ticked_at = max_t`) returned **every** row sharing a symbol's newest timestamp, so when the markets cron double-wrote CPI and WTI (two identical rows tied to the millisecond on `ticked_at` — ids 6580/6582, 6581/6583), the join returned both and the tape **rendered those symbols twice**. HO 582 C3 replaced the join with a per-symbol `ORDER BY ticked_at DESC LIMIT 1` seek, which returns exactly one row per symbol — correct, and it stays. But the correctness has a cost: the tape can **no longer surface the double-write**. Before C3 the duplicate was a visible tell that something in the write path was wrong; after C3 the write path can keep double-writing and nothing downstream will ever show it (the duplicate spark points already shared a coordinate, the 1W anchor re-assigns the same value, and `change_pct` diffs a strict `market_date < ?` prior — so *every* read path was already symptom-free except the render count C3 just fixed). The rule: **when you fix a read to be robust against a write-path defect, you have hidden the defect, not resolved it — the defect must be given its own instrument at that point or it becomes permanently silent.** The instrument was filed as a P3 backlog item (the `cron_runs` `payload.outcomes` for `/api/cron/markets` around those ids, which shows one run or two); without it, a "harmless" dedupe would have quietly retired the only signal that the cron over-writes.

## Dropping a SQL `ORDER BY` that a downstream re-sort already discarded removes a dead clause, not a live guarantee (HO 582, Jul 2026)

C3's rewrite of the tape's latest-tick query has no SQL `ORDER BY`, where the old join ended `ORDER BY m.symbol`. Reviewing the order gate, the question was whether dropping it changed the tape's presentation order — and the answer is no, because `getLatestMarketTicks` **already re-sorts its whole output into `MARKET_SYMBOLS` order** right before returning (`queries.ts:8720`, `out.sort((a, b) => order.get(a.symbol) − order.get(b.symbol))`, an HO 178 tape-order guarantee). So the SQL `ORDER BY m.symbol` had been **dead since that re-sort landed** — alphabetical-by-symbol was computed and then thrown away. Dropping it removed a no-op, not a guarantee. This matters for two reasons worth recording: (1) keeping the SQL order would have forced a `USE TEMP B-TREE FOR ORDER BY` on the compound `UNION ALL`, so removing the dead clause is also what keeps the new plan temp-b-tree-free; (2) a future reader who "restores" the `ORDER BY` for tidiness would add that temp b-tree back for an order the code immediately overwrites. The rule: **before preserving a SQL ordering clause through a rewrite, check whether anything downstream re-sorts the result — a clause whose output is discarded is dead weight, and on a compound query it is dead weight that costs a temp b-tree.**

## `primaryTypeFor` returns a default, not a determination — `open` is the fallback for ~45 states, true of none of them by derivation (HO 584, Jul 2026)

`primaryTypeFor` (`lib/primary-calendar-scrape.ts:62-67`) resolves `top_two`/`top_four`/`ranked_choice` and returns **`open` for everything else**, so `open` is the catch-all fallback across ~45 states and asserts nothing about how any of them actually run a primary. LA's senate `open` is the **known-wrong instance** — LA ran closed/semi-closed party primaries in 2026 (Act 1/640, its first Senate party primaries since 2010) — and it only ever read "correct" because nothing consumed it as a determination. This changes the reading of HO 577's SC note: SC's `open` is right **by coincidence, not by derivation** — "don't repair SC" still stands (its stored value happens to be correct), but "therefore `open` is trustworthy" does **not** (the same fallback produced LA's wrong value from the same code path). Any surface that treats `primary_type` as authoritative for a non-top-N state is reading a default as a fact. The clean fix is a determined per-state map or a distinct `unknown`/NULL default whose instrument is a determined-vs-defaulted count (backlog P3). Same shape as *a covering-index scan is cheap in one currency, expensive in another* — the value looks like a finding until you ask what actually produced it.

## HO 584's `primary_type` override is an `open→open` no-op today, and only because the senate row is wrong (HO 584, Jul 2026)

`HOUSE_PRIMARY_OVERRIDES.LA` sets `primary_type='jungle'`, but the value it replaces on the six `house-LA-*-open` rows is already `open` — so the type-clobber the override guards against is `open→open` today, a **visible no-op** that reads like dead code to anyone who doesn't know why it's there. It isn't dead: the source `open` is `open` only because `primaryTypeFor` DEFAULTS LA-senate to `open` (the entry above) — LA senate's *true* type is `closed`. A **correct** future upstream fix to `closed` would flow through the `calByState` senate-row proxy and stamp `closed` onto six **all-party** House rows. The override writes `jungle` to be safe against that correct fix, **not** because today's value collides. Record it, because "we override a value that currently matches" is exactly the shape a later cleanup deletes as redundant — and deleting it re-arms the clobber the moment the senate type is corrected. The general trap: an override that guards against a *future correct value* is indistinguishable at rest from one that guards against nothing.

## A falsification that writes the known-wrong value to prod trades a proof for a data incident (HO 584, Jul 2026)

HO 584's leg 2 deliberately wrote the 05-16 clobber to the **production** DB — it unlocked LA and ran the real `syncHouseDistricts` to prove "unlocking alone re-clobbers" — and relied on leg 3 (the C1 override) to undo it. It was survivable **only** because the primaries query helpers are deliberately uncached plain `db.execute` (`queries.ts:~1615`): under an `unstable_cache` helper, a regeneration inside the window between the wrong write and the correcting write could have captured 05-16 and served it past the fix (HO 555: the Data Cache survives deploys and converges only on repeated hits), while a DB-row check afterward reads green either way. **The leg never needed the write:** proving the branch selection (unlock → the non-suspended COALESCE branch) and that the generated args carry `2026-05-16` establishes the same defect without touching prod. "A later run corrected it" is not a defense — the correcting write does not reach anything that cached the wrong value in between. The rule (now in SKILL, extending the code-side falsification discipline to data): **a falsification leg must not write a known-wrong value to the production database — prove the defect at the branch-and-args level, or run against a scratch DB, never prod.**

## An outcome gate cannot see a branch that never fired — instrument which branch ran, not just the output (HO 586, Aug 2026)

HO 586's M3 diffed the resolved primary chip for all 534 current members — shipped query vs proposed — and bucketed **five of the six at-large House members as "unchanged."** They weren't correct: their district-first branch **never fired** (the first build's `district != null` guard skipped a NULL district before any lookup could run), so resolution quietly fell through to the senate proxy and the *output* never moved — identical green whether the new branch worked or was dead. **M6 caught it only by instrumenting WHICH branch ran** (asserting the resolved id starts `house-` for a known at-large member), not what came out — and it found all five fire branch 1 correctly, which an outcome diff could never have told apart from five silent fallbacks. Same family as the untriggered-guard rule (*a detector that works and one that structurally can't fire emit identical green*, HO 440/553): an outcome gate is blind to a branch that never executes. When a change adds a branch, the falsification must prove the **branch fired**, not just that the answer looks right.

## A reviewer-injected spec defect, caught by the mandated re-run-after-change (HO 586, Aug 2026)

The district-first ORDER BY shipped in the first build with **"exact party match wins, `open` second" as the FIRST sort key** — it arrived from the review spec, which said "exact party wins" without scoping it to a temporal class, and was implemented faithfully. It was wrong: a stale **PAST** exact-party row would outrank a live **FUTURE** `open` row, defeating the chip's "next primary" semantic (the very thing the future-first ordering exists to guarantee). **The review-ref diff read caught it** — the mis-ordering was spotted in the built SQL off `586-review`, and the mandated re-run-after-change then proved the corrected ordering a no-op on current data (byte-identical M-series). The diff read is what caught it; the re-run is what made the fix safe to ship. Two things worth recording: (1) **the spec was wrong, not the implementation** — faithful implementation of an under-specified spec is a defect path, and reading the built artifact rather than the spec is what catches it; (2) the fix scopes party-preference as a tie-break **WITHIN** a temporal class, never across one (future-first is the primary key; exact-party-over-`open` breaks ties only among rows on the same side of today). A review instruction that reads as a complete rule can still be under-scoped — treat it as a claim to verify against the data, not a spec to transcribe.

## A two-branch render over a three-value column — the HO 420 binary-over-non-binary class, second instance (HO 586, Aug 2026)

The chip label read `party === "D" ? "Dem" : "Rep"` — a binary over `primaries.party`, which is a **three-value** column (D / R / `open`). So an `open`/jungle row (and an `I`) rendered **"Primary Rep:"** — a Louisiana Democrat's all-party jungle contest labeled Republican, exactly the shape of the HO 420 "`members.party='I'` reads as a bug" finding (binary code over non-binary data). **The fix is the branch, never the case:** the render now shows a party word only for exact D or R and drops it otherwise ("Primary:", the honest all-party label). Special-casing `'open'` — `party === 'open' ? "" : (D?Dem:Rep)` — would have left `I` still rendering "Rep." Binary code over a column that has quietly grown a third value keeps re-emerging; fix the shape, not the one value you happened to notice.

## "Populated → empty" was "wrong-roster → honest-empty" — a loss only under a false baseline (HO 586, Aug 2026)

M5 flagged **19 same-date roster-vanish cases** — a member whose chip moved to their own district row, where the candidate roster went from populated to empty on the same date. It reads as a regression only under the assumption that the **statewide Senate** field was ever the correct roster for a House member. It wasn't: the chip was showing the *Senate contest's* candidates for a House member (wrong contest), so "populated → empty" is really **"wrong-roster → honest-empty,"** and the empty district row is the honest state. Moot for the chip itself — the consumer renders the **date only**, never the roster (which is also why the M5 halt-class had no user-visible manifestation) — but the framing matters on `/primaries` and `/electoral`, where the roster does render and the **77-of-560 empty-past-house-roster debt** (the 19 rows hosting a current member decompose as 11 uncontested-with-a-rostered-sibling + 8 both-party-empty holes; the other 58 are uncharacterized — pre-existing) actually shows. Before scoring a delta as a loss, check the baseline was ever right.

## In a minified React build, every structural hydration mismatch emits a byte-identical string — message identity is not cause identity (HO 589, Aug 2026)

React #418's message has **two `%s` slots**: the first is the discriminator (`fromText ? "text" : "HTML"` at `react-dom-client.development.js:5240`, so `args[]=HTML` is a **structural / markup** mismatch and `args[]=text` a text-content one — they are different bugs), and the second is the component-naming diff produced by `describeDiff`, which is **DEV-only**. The production `react-dom` bundle carries **0** occurrences of the `hydration-mismatch` template/link, so in prod the second slot is empty and the whole message is `Minified React error #418; visit https://react.dev/errors/418?args[]=HTML&args[]= …` — **byte-identical for every structural mismatch anywhere in the app**. Consequence, which cost HO 574 a wrong inference: "the message was identical across four runs ⇒ a single cause" **does not follow** — message identity carries zero cause-count information, and an unattended prod crawl that can only read the thrown message has a **ceiling no truncation budget can raise** (raising HO 574's 200-char cap buys nothing; verified 42 prod occurrences → 1 distinct string). To name a component you must reproduce under **`next dev`**, where React 19 appends the DEV diff — which is exactly what the HO 590 harness does. The corollary bug is a **detector** that greps for the minified `#418`: DEV emits *"Hydration failed because the server rendered HTML/text didn't match"* through `pageerror`, not `#418`, so a `#418`-only filter reports **NO FIRES** on a run that is firing every time (589's first pass; caught in 590). Match on both forms and log the raw message.

## A render-time `Date.now()` that gates a NODE is an intermittent hydration bug — invisible locally, grows its route set, and can't fire on a fresh-served prod route (HO 589/590, Aug 2026)

A client component that reads a non-deterministic value **at render** (`Date.now()`, `Math.random()`, `window.*`, an unpinned locale/timezone) computes a different value on the server (SSR) than on the client (hydration). Two failure shapes, and the distinction is load-bearing: if the value **gates whether a node exists** (e.g. `MarketsTapeClient`'s `showSlots = !stale` deciding whether the `<span class="markets-tape-arrow">` renders), the mismatch is **structural → `args[]=HTML`**; if it only **drifts a string** inside a node (`FilingRow.relAge()`'s "Nd ago"), it is **text → `args[]=text`** — the same class of bug, but only the first is what a prod #418-`HTML` crawl is catching, and they must be tracked as **distinct defects** (fixed in separate commits, proven by node-count vs string-equality respectively). The fix for both is the HO 489/490 shape: compute one `nowMs = Date.now()` in the owning **server** component and prop-drill it (required prop, no default, so `tsc` enforces it) — see *Client-component clock discipline* in SKILL. **Why it's so hard to see:** firing needs the SSR HTML and the hydration clock to **straddle a threshold** (a 26h stale edge, a 09:30/16:00-ET market boundary, a midnight day-boundary), so it is intermittent, does not reproduce on a normal local load, and its observed route set **grows with every surface that adds a now-gated node** (which is why scoping a fix around "the routes seen firing" is a trap — HO 574's guard). **The sharp corollary (HO 590 C5), the one that keeps you honest:** a **fresh-served** dynamic prod route (`X-Vercel-Cache: MISS`, `no-store`, `Date` advancing per request) has a **sub-second** render→hydration gap — measured `control(+0)` in the harness never fires — so a `Date.now()`-straddle bug **cannot fire there**; it needs a **cache gap** (stale-served HTML) or a manufactured clock skew. So proving such a bug reproducible under a harness skew does **not** prove it is what's firing in prod: the HO 590 tape/`lob-age` fixes are correctness hardening, and prod's actual `args[]=HTML` fires stayed unattributed. Reproduce with `scripts/diagnostic/hydration-clock-harness-590.ts` (local-only; `page.clock.install({time})` before `goto`, DEV owner tree + variant captured).

## Page residency under 60s makes a request-time aggregate over a large table unfixable by indexing (HO 594/595, Aug 2026)

A covering index took the three `member_votes` participation aggregates from 20-24s to **140ms-1.5s steady state** — and did **not** close the defect. Co-located on pdx1, the **first touch of the index pages after a >60s gap still cost 8.2-14.1s** against the 10s `DB_REQUEST_TIMEOUT_MS`, worst **>20s** with both `lib/db.ts` attempts lost — that reading was written as "20.005s", but **20.00Xs is the abort ceiling, not a duration** (10s + a 10s retry), so it is a lower bound; corrected HO 597, which measured the same censoring on a different query and found the true cost past **55s**. Only the sub-ceiling readings (8.2-14.1s) are real durations. Every 45-60s gap went cold again, so **page residency is under 60s**. Two controls pinned the mechanism rather than assuming it: **`?order=`** moved the spike to whichever query touched the table first (the CTE took 13.5s/8.2s leading and 462-1024ms following), and **`?warm=1`** showed a trivial `SELECT 1` costs 1.4-1.9s and does **not** absorb it — so it is neither one bad query nor connection setup, it is reading pages that are not there. Cron warming cannot fix it either: sub-60s residency outruns any schedulable cadence, and warming an `unstable_cache` entry does not keep *index pages* resident. **This lowers the LDA rule's size threshold** — that rule was written about tables 7-14x `bills`, and **366k rows is now proven over the same line**. The control on the other side is what makes materializing work: a `dashboard_state` single-key read **never spiked cold** across three 90s-gapped co-located runs (15/26/15ms). Small is genuinely resident.

## The first query in a cold function pays a 2-6s tax, whoever it is (HO 595, Aug 2026)

Measured by reordering, not asserted. `cte_new` took **2268ms/2014ms in first position and 15-55ms in every later one**; `context_new` — the same query shape against the same table — ran **23-137ms whenever it followed**. So the tax attaches to the *position*, not the query. The practical consequence for anything sized against the 10s bound: the effective budget for a route's **first** query is 10s minus the tax, not 10s. **Unresolved, and left that way deliberately:** whether the tax is *additive* to a query's own cost or *subsumes* it — these measurements don't separate the two, and the difference matters for any margin arithmetic that leans on it.

## Retry masking: a route 500 is roughly the SQUARE of the query-breach rate (HO 593/594, Aug 2026)

`lib/db.ts` retries once, so a route fails only when **both** attempts breach the bound. HO 594's pre-fix probe measured **1/13 route non-200 while the surviving 200s took 18-21s** — that is an abort at 10s plus a successful retry, i.e. twelve near-misses reported as passes. Consequences, both load-bearing: every route-level failure count in this arc **understates** the defect, and this class **must be instrumented at the query level**. The worked example is HO 593's M2 stage table, whose counts (2/0/0/1/1/1) were too small and too noisy to rank for exactly this reason — and are recorded unranked because of it. A 0/N route count with a 10s query in the sample is not a green.

## Four instruments that read identical whether or not the work happened (HO 592-595, Aug 2026)

Instances of the existing close-criterion rule — a success signal that does not depend on the check succeeding — not a new principle. (a) **`gh run view --log` invoked in parallel** produced **110 empty files** through auth-keyring contention on Windows; an empty log is indistinguishable from a clean run, and had it not been spot-checked HO 593 would have reported "no correlation" from no data. Run it serially. (b) **`npx tsc --noEmit; echo "tsc ok"`** prints `ok` whether or not tsc passed — `;` where `&&` was meant — and it masked four real type errors into a commit. Check the exit code. (c) **`npm run sync:votes` skips vote ids it already holds**, so a second run writes nothing and **cannot measure its own write cost**; HO 594 timed the sync's atomic unit (per-vote `DELETE` + re-`INSERT`, idempotent, row count verified unchanged) instead. (d) **A stale materialized table renders correct-looking numbers with no error and no visual tell** — the reason HO 595 ships a `refreshed_at` stamp, a cron-payload outcome, and a greppable `[participation] refresh-failed:` prefix rather than trusting the surface to look wrong.

## `migrate.ts`'s 10s client cannot build an index on a large table (HO 594, Aug 2026)

`CREATE INDEX idx_member_votes_participation ON member_votes(bioguide_id, position)` over 365,996 rows took **14.3s** — past the 10s `DB_REQUEST_TIMEOUT_MS` that `migrate.ts` inherits from `getDb()`. It was applied with a dedicated long-timeout client instead, and `migrate.ts` carries the statement for the record. The same trap HO 406 hit building a partial index on `bills`. Any future migration touching a large table needs the same treatment — and note the failure would present as a timeout during migration, not as a bad index.

## A comment can describe the author's mental model while the SQL does something broader — twice in one query family, both preceding a 500 (HO 594/595, Aug 2026)

`"Small grouped aggregate (~537 rows) — no INDEXED BY / no new index"` sized the query by **rows returned** while the scan covered all **365,996** `member_votes` rows (a **683x gap**), because the GROUP BY spanned the table and the members-side filters applied after the group. Separately, `"for the MISSED sort"` described `participationAggCte` as if it were sort-conditional, while the CTE is interpolated **unconditionally** into both `getMembersRanked` and `getCommitteeRoster` — so it ran on every `/members` and `/committee/[code]` render at any sort, and HO 593 missed it entirely because the comment said otherwise. **Neither comment is wrong about intent; both are wrong as descriptions of behaviour**, and a reviewer reading either gets the model rather than what runs. The reusable tell is the first one: if a comment sizes an aggregate by its output, go and check what it reads.

## A guard INSIDE a cache wrapper caches its own degradation — the failure stops being transient the moment you record it (HO 597, Aug 2026)

`getRecentFilings`'s HO 440/448 try/catch — the one that keeps a `/lobbying` feed timeout from 500-ing the whole page — sat **inside** the `unstable_cache` callback. So the degraded `{ items: [], … }` was the callback's **return value**, and `unstable_cache` did what it is for: it stored it, for the full `revalidate: 3600`. **One cold miss poisoned that cache key for an hour, and the retry that would have succeeded never ran.** The guard read as pure defence and was quietly converting a transient failure into a durable one — the HO 552 shape (an exit path that *records* where it should *defer*), in a place nobody thinks of as an exit path.

The fix is placement, not logic: let the cached function **throw** so nothing is stored, and catch in an exported wrapper around it. Same user-visible behaviour on failure, opposite recovery behaviour after it.

**Falsified as a matched pair**, because the reasoning ("of course it caches, it's a return value") is exactly the kind that has been wrong twice this month. Same cheap cache key (`?linked=1`, chosen RECENT-shaped so recovery is *visible* rather than masked by the 20s cost of the query actually being fixed), one injected read failure, cold `.next/cache` each run:

| variant | hit 1 | hit 2 | hit 3 |
|---|---|---|---|
| RED (guard inside the cache) | 0 rows, 8417ms | **0 rows, 493ms** | **0 rows, 592ms** |
| GREEN (guard outside) | 0 rows, 8042ms | **13 rows, 1169ms** | 13 rows, 662ms |

RED's later hits never touched the DB — sub-600ms is the cache answering — and served the stored empty. The guard fired **exactly once in both**, which is what rules out the instrument as the difference.

**The general rule: a `try/catch` that returns a fallback must sit OUTSIDE any memoization of the thing it guards.** Inside, you are not degrading — you are *committing*. This applies to `unstable_cache`, to a hand-rolled Map cache, and to anything else that treats "returned normally" as "worth keeping." It also generalizes the SKILL note about `unstable_cache` serialization (HO 533): the wrapper doesn't only reshape what you return, it decides **whether the next caller gets to try again.**

## A cost measurement is a property of the corpus, not of the query — HO 547's `<=67ms` is now 92.8s and ships a wrong answer (HO 597, Aug 2026)

Found while prod-verifying something else, and only visible because the HO 597 guard rewrite had just started logging the failing cache key. `/lobbying?q=boeing` renders **"No filings match"** with a **200** on prod while the database holds **78** matching filings. Runtime logs, every request, both `lib/db.ts` attempts lost:

```
[db] timeout, retrying
[getRecentFilings] read failed — feed hidden: sort=recent linked=false q=true page=1: TimeoutError
```

HO 546/547 priced this path properly before shipping it — RECENT+search at 34–697ms, the parallel pager `COUNT(*)` at **≤67ms** — and those numbers were *true when measured*. At 129,401 filings the same two statements measure **15.6s** and **92.8s**; they run in one `Promise.all`, so the COUNT dominates and the guard degrades to empty.

**The point is not that the estimate was sloppy — it wasn't.** It is that a timing is a measurement of `f(query, corpus, cache state)` and gets recorded as a fact about the query. Three separate defects in this family now share that shape: HO 594's participation aggregate (sized by rows *returned*), HO 597's VOLUME (`~295` zero-activity filings, which was 421 by the time anyone re-counted), and this one. **A cost figure in a comment or a backlog entry should carry the corpus size and the date it was taken**, so the next reader can see it has aged rather than trusting it.

The corollary for review: **a query that was measured safe at ship time is not covered by that measurement forever, and nothing re-checks it.** The `/lobbying` guard means the expiry is silent — a 200 with an empty list — which is the fifth and sixth instance of the "reads identical whether or not the work happened" pattern this file already tracks, and the second one found running in production.

## A lookup table doesn't beat a walk — it rotates the failure, so the fix is routing, not substitution (HO 598, Aug 2026)

The `/lobbying?q=` feed's shipped cost is **inversely** proportional to match density. It walks `idx_lda_filings_dt_posted` newest-first and stops once the page fills, so a **dense** term fills 13 rows immediately and short-circuits, while a **sparse** term walks the whole table to find its handful. A name-lookup table (`lda_names`, resolve the term to `registrant_id`/`client_id` then seek by id) is **proportional** to the same quantity: sparse resolves a few ids and seeks a few rows; dense resolves ~3,928 ids, seeks ~50k `lda_filings` rows, then TEMP B-TREEs them into `dt_posted` order. Measured co-located, same corpus: `boeing` (sparse) **19.8s → 8.83s**, `llc` (dense) **58.1s → 182.5s**. Each path is fast exactly where the other is slow, so **substituting one for the other cannot be an improvement — it relocates the breach onto the other half of the input space.** The fix is to keep both and **route** between them at request time. Worth naming because on the sparse measurement alone the candidate looked like a clean 2.2× win; only measuring the dense half showed the trade. Same shape as the FTS rejection recorded above (FTS fixes the sparse half and still needs routing for the dense half) — which is why that rejection now rests on the routing argument rather than on cost or on `%oeing%` semantics.

## `m* = √(k·N)` is the DERIVED crossover for a fill-a-page-then-stop feed — derived, not tuned (HO 598, Aug 2026)

For a feed that walks an ordered index until `k` rows match and then stops, the expected rows walked is `N × (k ÷ matches)` — so the walk and a candidate-set path cross where `matches ≈ √(k·N)`. At `PAGE_SIZE = 13` and 129,401 filings that is **√(13 × 129,401) ≈ 1,297**, about **1% density**, and the routing predicate is written as that formula over `PAGE_SIZE` and the rollup blob's `stats.filings` — so it **re-derives as the corpus grows** instead of aging into a wrong constant. That is the distinction that separates it from `PAGE_SIZE = 13` itself, which is a threshold tuned on one day's feed (see the height-tuning entry above): **a derived threshold carries its own justification; a tuned one carries a measurement that expires.** Verified on a STRADDLING pair rather than on comfortable extremes — `insur` at 1,119 matches (**0.86×** the threshold → seek) and `hospital` at 1,500 (**1.16×** → walk), both row-identical to the shipped predicate. Two properties of the density hint make it cheap and safe: it **rides in the same covering scan that resolves the names** (no distinguishable added cost), and it **over-counts** — a filing lobbied by two matching registrants is counted twice (84 vs 78 for `boeing`; 55,834 vs 50,197 for a dense term) — so the error always pushes toward the **walk**, the conservative direction: over-counting can only route a sparse term into the path that is merely slower, never route a dense term into the path that explodes.

## The empty short-circuit is a correctness dependency, not an optimisation — so completeness has to be instrumented (HO 598, Aug 2026)

Because `lda_names` is **complete** (every distinct `(kind, entity_id, name)` in `lda_filings`), a term that resolves to zero ids **proves** the answer is empty, so the routed read returns without touching `lda_filings` at all: a zero-match search went **91.3s → ~400ms** on prod. The inverse is the danger, and it is not a slow path — it is a **wrong** one: any gap in `lda_names` makes those filings invisible to search and renders as a confident *"No filings match"*, the exact defect this HO existed to remove. So completeness stopped being an implementation detail and became the thing that has to be watched: the sync reports `namesUnreachable` in its payload, folds it into `chronicErr`, and logs a greppable `[lda] names-unreachable:` prefix. And the **maintenance** path was proven, not just the backfill — a synthetic new name written through the live sync was searchable immediately — because a table that is complete only as of its backfill decays into exactly the silent wrong answer above. **The general form: when a shortcut turns "no rows here" into "no rows anywhere," the source of that authority needs an instrument, or the optimisation degrades into a lie.**

## Verifying one branch of a `Promise.all` is not coverage of the pair (HO 598, Aug 2026)

`getRecentFilings` runs the page query and the pager `COUNT(*)` **in parallel inside one guard**. The e2e equivalence harness compared the page query's rows, so it **never executed the COUNT** — and it reported green while `e4f09ba` shipped a bounded COUNT that bound **2 args against a 17-arg routed predicate**. The two statements share a predicate by intention, not by construction, so their failure modes are independent: one can be rewritten correctly while the other is left binding the old shape, and a harness that reads only the first sees nothing. **A check that exercises one branch of a parallel pair is not coverage of the pair — verification has to execute every branch whose correctness it is claiming.** Seventh instance of the family this file already tracks (a check whose pass doesn't depend on the thing it claims to cover — the close-criterion entry above, the four instruments at HO 592-595, and the two at HO 597). What caught it in the end was not the harness but production: the guard degraded to an empty feed within minutes of the deploy and the HO 597 log line named the failing key (fixed `06d03dd`).

## Use the upper tail, not the range, when gating on variance (HO 598, Aug 2026)

The HO 598 ship gate compared each regime's margin under the 10s bound against its measured **spread**, and the first pass used `max − min`. That statistic **penalises a fast outlier** — a 380ms best case in the sparse regime widened its "spread" to **7.36s** and failed the gate on evidence of *safety*. The quantity that actually predicts a breach is the **upper tail, `worst − median`**: how far above typical the bad runs go. Recomputed that way the same data reads sparse **4.23s**, dense **3.11s**, zero-match **3.34s** (from 7.36 / 3.79 / 4.90) — which flipped dense and zero-match to PASS on numbers that had not changed, and left sparse failing for the right reason. **A variance gate must be one-sided: a distribution's downside is what breaches a ceiling, and a range statistic charges you for its upside.**

## The bytes model holds across a 23× size change; the variance does not shrink with it (HO 598, Aug 2026)

The arc's cost model — cost tracks **bytes dragged off the table**, not row count and not predicate complexity — survived a hard test. The full `lda_filings` name walk is ~**22.9 MB** and measured ~**86s**; the `lda_names` covering scan that replaced it is ~**1 MB** and measured ~**6.6s** worst. Roughly linear across a **23×** size reduction, so removing data buys the median exactly as predicted, and the model earns continued use for sizing. What did **not** come along is the spread: the **2-15× run-to-run variation on byte-identical work** is present at every size — the ~1 MB scan still ranges **0.3-6.6s** across runs, so a ~1 MB scan can cost more than a *typical* run of a scan 23× its size. **Shrinking data buys the median, not the variance** — which is why the residual after this arc is not a query-design problem (there is very little data left to remove) and belongs to the variance thread instead (backlog OPEN LOOP). Pair with the page-residency entry above: that names a plausible mechanism for the spread, and it has never been probed on its own terms.

## A page that self-reports its own type cannot gate what it contains (HO 601, Aug 2026)

`parseCandidatesPage` kept a votebox only when the box's specialness **agreed
with the page's** — `/special/i.test(h5) !== onSpecialPage → drop` — where
`onSpecialPage` is `isSpecialElectionPage()`, which reads the `<title>`. It looked
symmetric and defensible for two years. It is unanswerable, and the reason is
that **the `<title>` is not the URL**: Ballotpedia serves the FL/OH
special-election *article* under the plain
`United_States_Senate_election_in_{State},_2026` URL (HTTP 200, `redirected=false`),
so those pages self-report as special and their "Special …" boxes agreed and were
kept. South Carolina's page is a genuine regular article that **also** hosts an
additional Aug 11 special primary: page-special false, box-special true, so the
only box carrying a **published 10-candidate field** was silently dropped and the
parser returned `no_candidates` (HO 600 M3/M4).

The generalizable shape: **a container's self-reported type is a property of the
container, and using it to filter the container's contents fails the moment one
container legitimately holds both kinds.** The fix is to classify each item by its
own signal and let the container's type be a diagnostic. Do not restore the
symmetry check — it cannot express a seat carrying both a regular and a special
contest on one page.

Corollary caught in the same change: once both contests can be read off one page,
**the dedup key has to include the discriminator**. A `contest|name` key silently
dropped Mark Lynch's Aug 11 candidacy as a duplicate of his June one — the same
person legitimately runs in both.

## A seed file that looks additive can move data (HO 601, Aug 2026)

`data/special-primary-seeds/` is a registry, and since HO 601 it is also a
**router input**: a special-classified votebox goes to
`senate-{ST}-2026-special-{party}` *iff that id is seeded*, else to the base id.
That makes adding a seed row **not additive**. Seed a state that is already being
written correctly to its base ids and the boxes MOVE: the base rows then take an
empty incoming roster, the HO 564 non-empty-delete gate correctly refuses to erase
them, and they **freeze silently at stale values** while the new special rows go
live beside them. Nothing errors; two rows now describe the same contest and one
is rotting.

Why the router keys on the seed rather than the `<h5>` alone: the `<h5>` says a box
is a special **contest**; it does not say whether that contest is **additional to a
regular one for the same seat**, which is what decides the destination. FL/OH's
2026 Senate races *are* special elections, so every primary box on their pages
reads "Special …" while the base ids are their correct and only home — routing on
the `<h5>` alone was measured to move all four rosters onto unseeded ids.

The transferable warning is about **where a failure mode can re-enter**: this one
was designed out of the code and straight into the config, where no typecheck, no
test and no review diff will catch it. When a data file becomes an input to a
routing decision, the warning belongs **on the data file**, not only at the code
that reads it.

## The skip-on-empty inversion, THREE times in one subsystem — record the shape (HO 600/601, Aug 2026)

Three instances, two HOs, one subsystem, one shape: **a check whose "nothing to
report" and "reported nothing" are the same output**. The ledger's own bar is that a
third instance makes something a convention problem rather than a coincidence, and
this cleared it inside a single arc.

1. **HO 600 M2** — `runSpecialPriorityPass` returned `string[]` (attempted ids).
   `scrapeSenateSpecialState` computed a real `fetchFailure` for each 404 and the
   return **discarded it**. Three consecutive ticks 404'd; all three logged
   `fetchFailures: []`. The backlog WATCH named `fetchFailures` as its evidence,
   so the instrument the ledger pointed at was **structurally incapable of reading
   FAIL**.
2. **HO 601 §2** — the pre-flight compared each state's writes across router
   models. Ballotpedia answers a burst with HTTP 202 (bot challenge), an
   unreachable state contributed nothing to the changed-state list, and "did not
   load" was therefore indistinguishable from "would not change". The first run
   printed `HALT` in the detail block and `PASS` in the verdict off the same data.

3. **HO 601 C3, caught pre-emptively while fixing (1).** With the new regular-page
   fallback, a seeded id reached on a page carrying no special box would `continue`
   silently — and "attempted, no fetch failure, nothing populated" reads exactly
   like success. `emptyRosterSkipped` was added in the same change rather than
   filed as a lesson. **This is the instance worth noticing**: the shape was
   recognized *during* the work, on a path nobody had asked about, which is what
   the rule is for.

All three were fixed locally (C3 returns a result object incl.
`emptyRosterSkipped`; the pre-flight retries a 202 and treats missing coverage as
INCONCLUSIVE, never PASS). The durable lesson is none of the fixes but the
**recognition rule**:

> When a verification reports a **count, a list, or an absence**, ask what an
> infrastructure failure would print. If it prints the same thing as success, the
> instrument cannot fail and its green is worth nothing. Coverage is a
> **precondition of a verdict, not a footnote** — assert the denominator first,
> then read the numerator.

This sits beside the existing `test.skip`-on-empty entry and the "verifying one
branch of a `Promise.all` is not coverage of the pair" entry. Same family:
**absence of evidence rendered as evidence of absence**, at the instrument layer
rather than the data layer.

## A fix upstream of a guard can make it unreachable — and the fix's own success report reads as the guard being exercised (HO 601, Aug 2026)

The HO 560 settled-row freeze exists for one hazard: Ballotpedia rebuilding a
seat's page around a **later** contest, so a delete-rebuild overwrites a past
election's results with a different contest's field. HO 601 put a **router**
upstream of it — a special-classified votebox never routes to the base id — which
removes the hazard's *delivery mechanism*. The freeze is now **structurally
unreachable for the thing it was built for**: there is no longer any path by which
a substituting roster arrives at a settled row.

The trap is what the verification then prints. HO 601's leg 2 reported
`isSettled consulted and REFUSED: true`, which is **true** — and the natural
reading, "the freeze is now exercised against substitution," is **false**. The
payload it refused was the *correct* June roster; `isSettled` is evaluated before
the roster is even built, so it short-circuits unconditionally on any settled row.
Every line of that ship report was individually accurate and the aggregate drifted
toward claiming more protection than exists.

**This is distinct from the HO 549/553 rule** ("an untriggered guard is UNPROVEN,
not protection — fire it before recording it as protection"). Here the guard *did*
fire. It fired **on a different input than the one it exists for**, which no
"did it fire?" check can distinguish.

> **Recognition rule: when a fix removes a hazard's delivery mechanism, the guard
> downstream of it needs its status RE-STATED, not RE-CONFIRMED.** Ask what input
> the guard actually saw, not whether it ran. A guard that can no longer be reached
> by its motivating case has changed role — usually from first line to second line —
> and the ledger should say so, because the next reader will otherwise inherit the
> stronger claim.

The freeze remains live and useful for its **general** case (any rewrite of a
settled row: an upstream edit to a past result, a re-scrape parsing differently) —
HO 601's leg 3 caught exactly that, with OH's settled rows skipped. Downgrading a
guard's claimed role is not the same as removing it. Filed as a backlog WATCH, and
as a queued comment-only fix at `isSettled` itself, because the overstated version
is what the code comment there still says and **a code comment outranks a doc for
anyone working in the file**.

## Rows read and milliseconds are different currencies — the strongest instance (HO 602, Aug 2026)

This entry already existed in weaker form (HO 582). The measurement that settles
it: the **single largest read-budget consumer on the database** is a query whose
own comment certifies it as fast. `bills_agg`'s block in `lib/queries.ts:6015`
records the HO 277 hint making it *"index-only ... 96ms"* — **true, and beside the
point**. Per-query `rows_read` over 30 days (Turso dashboard, org `csu-j3`,
2026-08-05): **110.0M rows across 317 calls, ~347k rows per call, 26% of the
entire account budget.** It is the *fastest expensive query* on the database.

**No latency instrument can see this.** Not `EXPLAIN` (the plan is a clean
covering-index scan), not a timing harness (96ms), not the route-level 500 rate
(it never breaches). The cost is real and it is invisible in the units every other
guard in this repo measures. Only per-query `rows_read` shows it — which is why
that view is now named in SKILL as the read-attribution instrument of record.

The general form: **an optimization that converts a slow query into a fast one
does not necessarily convert an expensive query into a cheap one.** A covering
index removes the row-fetch, not the rows scanned. When the budget being spent is
rows rather than seconds, "we indexed it and it's 96ms now" is an answer to a
different question — and it will be quoted for years as though it closed both.

## A 24-hour attribution window shows what SURVIVED, not what caused a rise (HO 602, Aug 2026)

Diagnosing the read-burn ramp, a 24-hour Top Queries read showed the LDA family on
top, and that was taken here as the ramp's cause. It was not. The 24-hour window
sat *after* HO 582/594/595 had removed the markets and participation costs, so it
showed **the residual** — what was left standing once the actual causes were
already fixed. The 30-day window, which contains the ramp, names the participation
aggregates instead, and they shipped **into** it: HO 523 (`2b8d62b`, Jul 25),
HO 527 (`7fa729c`, Jul 26), HO 535 (`b565c13`, Jul 27).

**Attributing a change requires a window that contains the change.** A window that
starts after the event measures the aftermath and reports it in the same units,
with the same ranking, looking exactly like an answer. The tell is that the top
row of a post-fix window is *by construction* whatever you have not fixed yet.

Related and unresolved: **the two windows disagree in a way nothing yet explains** —
the 24-hour view's top row (`lda_filings` completeness COUNT, 5.95M / 46 calls)
does not appear in the 30-day list at all, where its magnitude says it belongs.
Filed as a WATCH. Treat them as two instruments, not one, and do not build a number
on their difference until that is resolved.

## A backlog entry that points at a file is only as tracked as the file (HO 603, Aug 2026)

The backlog's header says *nothing is tracked only in chat*. Three arcs were, and
an artifact audit against `origin/main` found each in a **different** state — which
is the point, because a single word ("filed") would have covered all three and
been true of none:

| arc | artifact | actual state |
|---|---|---|
| Absence Watch (HO 588) | `scripts/diagnostic/absence-watch-588.ts` | **tracked** (`7ce1f0e`) |
| Dashboard redesign (HO 590) | `mock-590-dashboard-declutter.html` | **absent from disk entirely** |
| Layout audit (HO 591) | `scripts/diagnostic/layout-audit-591.ts` | **never built** |

**A QUEUED entry whose content lives in a file it merely names is the same failure
as tracking it in chat** — one `git clean`, one machine change, one directory the
gitignore covers, and the entry is a title with nothing behind it. That is not
hypothetical here: the HO 590 mock is **gone**, and the entry written for it had to
carry all six design decisions in prose because there was nothing left to point at.
The near-miss is worth as much as the loss — `docs/design/dashboard-2col.html`
exists, sounds right, and is an HO 254 artifact; a filing pass that matched on
plausibility rather than provenance would have pointed the entry at the wrong file
and looked complete.

**The rule: an entry must survive the deletion of everything it references.** A
pointer is a convenience; the prose is the record. Write the decisions, the numbers
and the rejected alternatives *into* the entry, and let the file be a shortcut —
then verify the pointer resolves (`git ls-files`, not `ls`, since a gitignored
directory hides the difference between "present locally" and "in the repo").

Corollary that fired the same day: **re-measure a number before re-filing it.** The
HO 591 arc logged its type-scale blast radius as *~450 font-size declarations*;
re-measured at filing it is **416 in CSS plus 368 `text-[Npx]` arbitrary utilities
in TSX = 784**. The original counted the CSS half only, so the figure that made the
change look tractable **understated it by ~1.7x**, and the missing half is exactly
what a CSS-only sweep would fail to catch. A number carried forward unexamined is
not a record of a measurement, it is a rumour with a citation.

**Corrected at HO 604 by the sweep that did the work — the 784 was short too.**
The reproduction glob `app/*.css` **misses `app/welcome/landing.module.css`**
(a directory down), and that file writes `font-size:11px` with **no space after
the colon**, so a substitution regex tuned to the `globals.css` style would have
skipped all 22 of its declarations *and reported clean* — the HO 549/553 shape
again, one layer deeper. Measured against `e8279c1`: **438 px-literal CSS
`font-size` declarations (416 + 22) + 355 `text-[Npx]` in TSX + 34 `fontSize`
sites in TSX (SVG presentation attributes plus a few inline styles) = ~827 type
sites**, of which **714 are the six values 9–14px**. The TSX half was 355, not
368. The entry's own lesson lands on the entry: the authoritative figures now
live in the `--fs-*` comment block in `globals.css`, next to the code they
describe, where they cannot drift without the change that drifts them.

---

## Tailwind v4 scans what the *repo* `.gitignore` allows — it does not honour `core.excludesFile` (HO 604, Aug 2026)

`docs/handoffs/` was ignored per-machine through `core.excludesFile`
(`~/.gitignore_global`), so handoff docs never reach the repo and a deploy never
sees them. Tailwind v4's content scanner honours a **repo** `.gitignore` but not
the global one — so locally it was reading handoff **prose** as source and
compiling class names out of it: `.text-[10px]` through `.text-[13px]` off older
handoff docs, and `.text-[length:var(--fs-N)]` — a **literal `N`** — off a line
of spec text describing the substitution.

The rules were harmless in themselves (no element carried them). **The defect is
build-input parity: the local build was compiling from inputs the deploy does
not have,** so a locally-inspected CSS artifact could not be trusted to describe
production. Fixed at `5b9c34c` by repeating the ignore in the repo `.gitignore`,
which also makes a fresh clone behave like this machine.

**Corollary, and it is load-bearing for parking artifacts:** any scratch or
handed-forward file containing literal utility-class strings — a JSON baseline
whose *keys* are `text-[12px]`, a diagnostic that greps for one — must live
under a **repo-ignored** path, or the scanner regenerates exactly the phantoms
you just removed. HO 604's parked walk baselines went to
`docs/handoffs/604-artifacts/` for this reason, not to `scripts/diagnostic/`.

---

## Under native CSS nesting every `CSSStyleRule` exposes `.cssRules`, so an either/or CSSOM walk visits almost nothing (HO 604, Aug 2026)

A CSSOM census written the obvious way —

```js
if (rule.cssRules) walk(rule.cssRules)   // grouping rule?
else count(rule)                          // ...otherwise a style rule
```

— reported **0 font-size rules on a stylesheet with 1468 top-level rules**, on
the *unmodified* build as well as the changed one. Modern engines give **every**
`CSSStyleRule` a `.cssRules` list (usually empty) so that CSS nesting works, so
the first branch is always taken and the walk recurses past all 1468 rules,
visiting ~54 leaves and counting none of them.

**Process and recurse — they are not alternatives:** yield the rule when
`rule.style` exists, *then* descend if `rule.cssRules?.length`. A nested rule
legitimately has both its own declarations and children.

Second trap in the same instrument: **`rule.style.fontSize` returns `""` when
the value contains `var()`.** The typed CSSOM getter cannot resolve custom
properties, so the moment `font-size: 11px` became `font-size: var(--fs-11)`
every declaration read as absent. Read the declaration off `rule.style.cssText`
and parse it. Between the two bugs the detector reported a clean sweep on a
build where nothing had changed — the same-as-success shape this file keeps
finding new costumes for.

---

## A keyed diff goes blind exactly where the change renames the key (HO 604, Aug 2026)

The HO 604 identity gate compared computed `font-size` per element between two
builds, keyed on a signature built from each element's class chain. It reported
**0 differences and 0 unmatched elements**, which is what a correct identity
substitution should produce. It was measuring half the work.

The TSX half of the substitution **renames the class itself** —
`text-[12px]` → `text-[length:var(--fs-12)]` — so every element it touched had a
*different key* on the two sides. Those elements fell into "present only in A" /
"present only in B", which the comparison reported separately as data drift, and
the size diff was computed over the untouched CSS-only elements. The number was
real, precise, and answered a question nobody asked.

**The rule: if a change can alter the value you key on, normalize the key before
comparing, and check the unmatched buckets are empty rather than glancing at the
headline number.** Here the unmatched counts were a suspiciously symmetric 99 /
99 — the tell, sitting in the output the whole time. Normalizing the token back
to its pre-change form dropped both buckets to 0 and put the 344 TSX sites into
the comparison, where they belonged.

---

## `git push --ff-only` is not a push flag — it prints usage and pushes nothing (HO 604, Aug 2026)

`--ff-only` belongs to `git merge` and `git pull`. Passing it to `git push`
produces the push **usage text** on stderr and a non-zero-ish result that is
easy to skim past as ordinary git chatter — no refs move, and the next
`git rev-parse origin/main` still reads the old SHA.

There is nothing to add for safety: **plain `git push` already refuses a
non-fast-forward** unless forced, which is the mechanism the fast-forward-only
discipline actually relies on. The flag was belt-and-braces for a belt that does
not exist. Verify a push by comparing `origin/main` to `HEAD` afterward, not by
trusting the command's exit.

---

## A `flex: 1` child's layout box spans exactly the whitespace a gap detector is trying to measure (HO 606, Aug 2026)

The HO 606 layout audit measures far-right anchors (convention C1) as the gap
between one child's right edge and the next child's left edge. Pointed at the
dashboard's breaking-news row — a headline whose timestamp visibly sits about
1,100px away, the exact defect the audit exists to find — it reported **10px**.

The row's headline carries `flex: 1`. Its *layout box* stretches across the
whole gap; only its *text* stops early. Box-edge measurement therefore reads
"these two children are adjacent", which is true of the boxes and false of
everything a reader sees. The same defect sat one level down in M2 (stretched
panels): a panel whose own last child also stretches hides its slack inside that
child, so measuring to the deepest *direct child* read zero on precisely the
panels C7 is about.

**Measure to the deepest INK, not the layout box.** An element's ink is its
painted box when it has one — a bordered or backgrounded chip *is* its box — and
otherwise the client rects of its text plus any painted descendants. Same row,
same threshold, after the change: **10px → 1,092px**; M2 on `/` went 0 → 3.

Two notes for whoever touches this next. **Thresholds were never adjusted** —
only the measurement definition, which is the line between correcting an
instrument and tuning one until it agrees with you. And the falsification leg is
what caught it: the audit was pointed at a known defect *before* any zero was
trusted, could not see it, said so, and refused to spend 78 page loads of Turso
reads on a broken detector.

---

## A diagnostic that evaluates on a fresh blank page prints `[]`, which reads exactly like "the route has no such element" (HO 606, Aug 2026)

The audit's M2 has a branch for the case where it finds nothing: dump the panel
predicate's intermediates for the known offender, so a zero is diagnosable
rather than merely disappointing. It opened a **new page** to run that dump and
never navigated it. Against `about:blank` the selector matched nothing and the
diagnostic printed `[]` — indistinguishable from the finding it was written to
rule out, in the one place whose entire job is explaining a zero.

**Bind a diagnostic to the page it is explaining**, not to a fresh context that
merely resembles one. This is the fourth same-as-success instance in this arc
(after HO 549's detector, HO 604's identity gate, and 604's CSSOM walk), and the
most pointed: the failure was inside the machinery built to detect failure.

---

## Overflow-hidden marquees produce legitimately huge negative trailing gaps (HO 606, Aug 2026)

The audit reports a **trailing gap** — parent's right inner edge minus the
rightmost child ink — alongside each interior gap, deliberately: it is the
target state, not a defect, and reporting both means "M1 = 0" cannot be reached
by deleting rows.

On the dashboard it reads **−10,702px**. That is correct. The markets tape is a
marquee: a ~13,000px track inside an overflow-hidden box, scrolled by transform.
Ink wider than its container is the entire mechanism, so 258 rows site-wide
carry trailing gaps below −50px and all of them are marquees.

Harmless **while trailing gap is reported and not thresholded**, which is true
today. The entry exists for whoever later decides to gate on it: a naive
`trailingGap > N` rule inverts on marquees, and a naive `abs()` turns the
site's most extreme non-defect into its top finding.

---

## A falsification anchor expires when the defect it names is fixed (HO 610)

`layout-audit-606.ts` refuses to crawl until it has proven its detectors fire, and
v1's M2 anchor was **"M2 must find a stretched panel on `/`"** — true and useful
in HO 606, when `/` had three. HO 610 removed the last one. The next run reported
`M2 0`, concluded the detector was broken, dumped the panel-predicate
intermediates, and **halted before it could score the very fix that produced the
zero**.

This is the same-as-success shape the arc keeps producing, inverted: usually a
broken detector reads like a clean site; here a **clean site read like a broken
detector**, and the instrument's own safety mechanism was what blocked the
measurement.

**The rule: a falsification anchor must assert that the DETECTOR fires, not that a
particular surface is defective.** Every anchor pinned to a specific known defect
has a shelf life exactly as long as the defect, and remediation arcs are in the
business of ending them. Two forms that don't expire — both now in the script:

- **Probe a set, pass on any.** The M2 leg re-probes fallback routes when `/`
  reads zero and names which one fired.
- **Keep a KNOWN-BAD control that the change cannot touch.** v2's leg C asserts
  `/members` still holds 548 rows over threshold. Legs A and B both assert v2
  reports LESS than v1, and **on their own they are satisfied by an instrument
  that reports nothing at all** — leg C is the only thing separating a
  correction from a silencing.

And when a fix invalidates an anchor, the anchor **inverts rather than being
deleted**: HO 610 packed the breaking rows, so v2 asserts those same rows now read
SMALL. That is a sharper test than the original, because it fails in both
directions — v1 read them at 873px and the masthead at 75px, and both were wrong.

---

## A `*` before a `/` inside a CSS comment ends the comment, and the build warning that says so goes unread (HO 610)

`globals.css` carried a comment listing swept class families with glob stars:

```
   .v2f-exp/-grid/-summary/-related/-side/-sk/-sv/-btns/-cmte-*/-sponsor*.) */
```

The `*` closing `-cmte-*` and the `/` that follows it form `*/`. **The comment
ends there.** Everything after parsed as CSS, and the parser discarded the rule
that followed — `.bxp { padding: 14px 16px 16px }`, the expand panel's padding,
**dead in every built stylesheet from HO 570 until HO 610**. The panel measured
372px wide with a 372px body and nobody noticed, because a missing padding looks
like a design choice.

Two things make this worth an entry rather than a fix note:

**It announced itself and was ignored.** Every `next build` printed
`Found 1 warning while optimizing generated CSS: … Unexpected token Delim('*')`,
with the offending text quoted. Forty handoffs of builds printed it. **A build
warning nobody reads is same-as-success** — the information existed the whole
time and changed nothing, which is the same failure as a detector that cannot
fire, one layer up.

**It silently ate a LATER edit too.** HO 610's first attempt at the container
query added `container-type: inline-size` to that same discarded rule; the
`@container` block survived (it is a separate rule) and did nothing, so the
feature read as "container queries don't work here" rather than "this rule is
being thrown away." A dropped rule is not localised to the line that broke it —
it swallows whatever is written into it afterwards.

**So: never put `*` immediately before `/` inside a CSS comment** — write class
families as prose or with the star elsewhere — **and when a build prints a CSS
warning, read it before the next commit.**

---

## Banding a row by centre-Y splits it wherever type sizes differ (HO 610)

M1 groups a row's items into horizontal bands before measuring gaps, and v1
bucketed on `Math.round(centreY / 4px)`. Two items on the **same baseline** whose
font sizes differ have different box heights, so different centres, so — at a 4px
bucket — different bands.

On a breaking row that HO 610 had just packed left (id at x 41–94, headline
144–957, age 967–993), the 13px id and 13px age landed in one band and the 17px
headline in another. The instrument then measured the largest gap **within** the
id/age band: id→age, **873px**, with the headline sitting invisibly in the middle
of it. The row was correct; the reading was not.

**The size of the class is what matters: CBT's type ladder has six tokens and the
whole point of a row is a size hierarchy, so mixed sizes on one baseline are the
NORM.** v1 could not read *any* real row correctly — it just happened to be
directionally right while the rows were genuinely broken. It was also wrong the
other way on the same page: the masthead, a real ~700px C1 defect, scored **75px**
because its right-hand item sat in a band of its own.

v2 clusters by **vertical interval overlap** (items sharing ≥50% of the smaller
one's height are one band), which is baseline-invariant. The same rows read 12px
and 24–50px.

**The general form: a geometric bucket keyed on a derived scalar (a centre, a
midpoint, a rounded coordinate) silently partitions anything that varies in the
dimension it collapsed.** Cluster on the interval, not the point.

---

## A party-colour token used as age heat reads as party, not age (HO 609/610, filed not fixed)

`daysSinceColor` (`components/BillRow.tsx:17`) paints a bill's days-since figure
by threshold, and the hot end is **`var(--party-republican)`**:

```
if (days >= 365) return "var(--party-republican)";
if (days >= 180) return "var(--accent-amber)";
```

In a UI where red means Republican on every other surface — party dots, sponsor
brackets, rating chips, the battlefield axis — **a red number on a bill row reads
Republican before it reads old.** The reader has to know that this one number is
on a different colour system.

HO 609 removed the heat from the dashboard's compact rows as C3 noise. It is
**still live on `/bills` and `/stale`**, where the days-since column is the
point of the view, and HO 610 deliberately did not touch it: the variant is a
different surface with a different argument (on `/stale` the column IS the
signal), so it is a design call, not a sweep.

**Filed, not fixed.** The durable half is now a SKILL design-system rule — party
tokens carry party and nothing else; heat and severity get their own tokens or
stay dim. When `/stale`'s momentum work comes up, that is the moment to give
staleness its own ramp rather than borrowing a party colour.

---

## M3 samples M1a groups only, so a route's row noise can sit still while its rows improve (HO 610)

M3 (C3, row noise) is computed **per repeated-row group** — specifically over the
M1a groups, which require **≥3 siblings sharing a tag+class signature**. A row
that is the only child of its wrapper never enters the sample at all.

That is exactly the dashboard feed's shape: a `.v2f-row` inside a `.v2f-group`
is a sole child, so **the rows HO 609 rewrote — five bordered/coloured elements
per row down to a quiet two-line format, the arc's largest single C3 improvement
— are not in M3's population.** The site-wide M3 for `/` moved 8.41 → 6.06 → 5.18
across three slices largely on *other* rows, and a reader comparing those numbers
would conclude the feed rework barely registered.

**So M3 is a cross-route instrument, not a slice one.** To score a specific
component's noise, use a per-selector probe against that component; use the site
M3 to compare routes to each other. A slice score that quotes M3 as evidence its
own rows got quieter is quoting a number that may not contain them.

---

## A PowerShell text gate over non-ASCII can false-negative on the console codepage (HO 607 close, filed HO 610)

A verification gate that greps a file through `Get-Content` reads it through the
console codepage. Over non-ASCII content that is lossy: an **en-dash** in `M1–M6`
was split, the gate's match failed, and it reported **False on a correct file** —
a verification failure indistinguishable from the defect it was checking for.

**Decode raw bytes as UTF-8 before believing a text gate's failure**, or restrict
gates to ASCII-only anchors. The class is wider than PowerShell: any gate whose
read path can transcode is a gate that can invent a failure, and a false negative
in a verification step costs more than the check saves — it sends the next
session looking for a bug that is not there.

---

## A pin can live outside the component it visibly pins, and the container will not confess (HO 613, filed HO 615)

`/bills`' filter bar read 1,600px of interior gap. The bar rendered a
`.mc-fbar-spacer` with `flex: 1`, that was found by decomposing the bar, and
removing the element left the row at **1,600px** — unchanged.

The second pin was `.control-sort { margin-left: auto }`, a **shared control
class** applied to the sort dropdown. Nothing in the bar's markup, nothing in the
bar's own stylesheet block, and nothing in a read of the container says so; the
dropdown is pinned right by a rule that belongs to a control family used across
several surfaces. Five bars were packed in that one commit and **all five had a
different mechanism** — `margin-left: auto` on a corpus label, `flex: 1` on a
spacer element, `ml-auto` on a bare SORT label, `justify-content: space-between`
on a section header — which is why "one rule to delete" was never the shape.

**Trace the computed style to its source rule; do not read the container and
stop.** A decompose-first pass that enumerates a row's children and their own
declarations misses any pin that arrives by cascade from a shared class, and the
tell is exactly what happened here: the defect does not move when the thing you
found is removed. **If a fix does not move the number, the cause is elsewhere and
not merely under-applied** — the second look, not a bigger version of the first.

---

## A cap derived against one end of the ink distribution is wrong by the other end's slack (HO 612/614, filed HO 615)

Capping a `1fr` label track is the standard C1 move, and the obvious derivation —
size the cap to the WIDEST label so nothing truncates — is the one that does not
work. A fixed track leaves every row `cap − ink` of slack, so a cap sized off the
long end donates its whole width to the short end.

Measured on `/members`: name-cluster ink runs **121px to 320px**, median 170. The
specified widest-name-plus-2ch cap of **340px** left the SHORTEST name **231px of
gap** and took the route from 548 rows over threshold to **527** — a 4% dent from
a change that looked, on the long end, like a complete fix.

The correct form derives against the SHORT end and the threshold together.
HO 614: `cap = threshold + min-ink − column-gap = 120 + 239 − 14 = 345`, taken at
340, and it cost **zero truncation**.

**And the precondition is the SPREAD, not either end.** When the ink spread
exceeds the gap threshold — 199px on `/members`, 322px on `/lobbying`, 343px on
`/trades`, all against a 120px threshold — **no cap satisfies both "no truncation"
and "under threshold" at once**, because comparable columns need a shared x and a
shared x under a variable label means per-row slack. At that point the honest
output is a cost curve and a knee, not a cap: `/members` took 240px for 16 clipped
names to buy 11 rows, `/trades` 280px just above p75 for 2 of 50 live, and both
filed the next increment rather than taking it. **Check the spread against the
threshold before deriving anything; if it is wider, you are choosing a trade, not
finding a cap.**

---

## C1 remediation manufactures the exact geometry that breaks gap measurement (HO 613/614 → fixed HO 615)

The layout audit measured a row by grouping its children's client rects into
horizontal bands and reading the gaps within each band. A cell that **wraps onto
two lines** produces two rects, and v2 treated each as an independent item — so
its short last line could be measured against the next cell **with its own long
first line sitting between them, invisibly**. The reported gap was hundreds of px
on a row with none: 590px on a fixture reproduction, 375px live on `/lobbying`,
664px on `/trades`.

**The part worth remembering is the direction of causation. Packing a row left is
precisely what lets a long cell wrap instead of being pushed out of view, so every
C1 fix the phase shipped created more of the geometry that broke the instrument
scoring it.** HO 614's commit body names it: *"the fourth instance of that class
in two HOs, and the first the wrap fix itself caused."* An instrument whose error
term GROWS with the remediation it measures will read as a plateau — the route
stops improving, and nothing in the output says whether the page or the ruler is
responsible.

**The fix is to measure INK SPANS, not rects** (HO 615 v3): one item per child
node, extent = the union bbox of its rects, present in every band its span
overlaps, so a gap can never be measured *across* it. A second rule the
measurement forced and the plan had not anticipated: **a band whose member set is
a SUBSET of another band's is a continuation, not a line** — it holds no item not
already measured somewhere richer, so it can only report a gap across items the
fuller band contains. The live case was a `/trades` row whose second band held
exactly `{date, amount}`, the only two cells with a second line, and reported the
625px between them — an area the reader sees occupied by five single-line cells.

**And the regression trap is a negative control in a committed fixture, not a
comment.** `scripts/diagnostic/fixtures/layout-legc.html` carries the wrapped-cell
row as `legc-neg-wrap`, asserted to read under threshold forever. It caught its
own author on the way in: the first draft right-aligned the row's trailing cell,
putting a genuine 135px far-right anchor inside the case meant to isolate the
phantom, and v3 duly reported it. **The correct response to a failing negative
control is to check whether the control is clean, not to relax the assertion** —
the instrument was right and the fixture was wrong, and a negative must carry
exactly one property: the thing it denies.

---
## A uniform gap is a reservation, not a stretch — C4 wearing C1's clothes (HO 618)

`/stale` carried **47 M1 rows and every one of them read EXACTLY 121px**, one
pixel over the 120px threshold. That signature is the finding. A gap produced by
content — a long name against a short one, a headline against a timestamp —
**varies with the content**; a gap that is identical on 45 rows is a **fixed
reservation** and the number is a track width, not a stretch.

Measured across all 50 rows: 45 no-HEARD rows at **121px**, 4 HEARD rows at
**57px**, 1 at **65px**. Inside a no-HEARD cell: `.row-support` at 40px reading
`—`, then `.row-hslot` at **52px reading nothing** — space held open for a HEARD
badge that appears on **5 of 50 rows**. The reservation bought nothing even on
those five, because the badge right-aligns against the age column either way,
which is exactly what the 57px rows already demonstrate.

**Why it matters beyond the route: the defect was C4 and it was ONLY ever going to
be reported by the C1 detector.** M1 caught it because the reservation happened to
sit *between* two other cells; had the slot been at the row's end it would have
been trailing gap, which is the target state and unthresholded, and nothing in the
audit would have seen it at all. **Read the SHAPE of a gap distribution before
designing against its magnitude** — a tight cluster one pixel over threshold is a
reservation to delete, not a row to pack, and packing it would have moved the
number without touching the cause.

---

## A height-keyed emptiness detector cannot see a width-shaped reservation (HO 618, → M4w at HO 620)

M4 emits any visible element **≥40px tall** with ≤12 characters of text. `/stale`'s
`.row-hslot` is **52px wide and content-height tall**, so it is genuinely reserved
empty space that **M4 read as nothing, on every one of 50 rows** — while it was
simultaneously the whole of that route's M1.

This qualifies rather than contradicts the HO 617 conclusion that M4's emitter had
"closed on measurement with essentially no reserved space left site-wide"
(96.7% feed-row furniture, 1.6% everything else). That arithmetic was correct
about what it covered. **It just could not be about width.** An instrument keyed on
one axis reports a defect on the other axis as *absence*, and absence is the one
output that looks identical to success — the same-as-success shape, entered
through a coordinate rather than through a predicate.

**The general form: when a detector is keyed on a dimension, ask what the same
defect looks like rotated 90°.** The fix (HO 620 `59a45cd`) is an explicit `M4w`
column — an empty element with an explicit width ≥40px inside a repeated row —
counted on its own line rather than folded into M4, because the two are different
defects with different fixes. The live instance was already fixed by then, so the
**fixture carries the only positive**, which is the shape a detector for an
extinct defect has to take.

---

## M3 sampled M1a's groups, so a route's "row noise" could be its NAVIGATION (HO 619, → fixed HO 620)

M3 — the C3 row-noise metric — reused M1a's candidate gate: **≥3 element children,
≥3 siblings**. Feed rows on `/changes` and `/bills` carry **two** visible element
children. **They never entered the sample.**

So the number was real and it was measuring something else. **`/changes`' "M3 3.00"
was 10 nav items at 3.00 apiece** — the primary nav, present on every route,
wearing the route's name. Same for `/bills`, `/president`, `/search` and
`/watchlist`; `/stale` read 6.55 only because its momentum overlay gives those rows
a fourth child. **This is the reframe the arc owes its own record: several cited M3
means in the HO 610–619 chain describe navigation, not feeds**, and any conclusion
of the form "this route's rows are quiet" that rests on a 3.00 rests on the nav
bar.

**The demonstration is HO 619's chip convergence.** It made **796 topic chips**
across nine `BillRow` surfaces plain — the single largest C3 change of the arc —
and **M3 did not move on any of the seven routes, by construction**, because none
of those rows was ever sampled. *The instrument built to score row noise was blind
to the largest row-noise change made under it.* The commit reported that as a
measured null rather than presenting the flat numbers as a result, which is the
only reason it was caught rather than read as "the convergence didn't help".

**Fixed at HO 620:** M3 samples every repeated-sibling group with **≥2** element
children, as a **second, wider pass** that leaves M1a untouched so M1 cannot move
with it. `/changes` goes 3.00 → 11.23 and **that movement is instrument, not
product** — the era wall now covers M3.

---

## Two ways a border survives the rule that removed it (HO 618/619)

A cascade pair, both found while making chips plain, and both of them fail
**silently and green**: the class is applied, the DOM says so, the border is still
there.

**(1) Tied specificity loses to source order, and nothing warns.**
`.v2f-topic--plain` and `.v2f-topic` both compute to **(0,1,0)**, and the base rule
sits later in `globals.css`. So the override lost, **the plain class was applied
and doing nothing through an entire build**, and M3 read 8.05 with the "fix" live.
The tell is a metric that does not move on a change you can see in the rendered
markup. `.v2f-topic.v2f-topic--plain` — repeat the base class in the override —
raises it to (0,2,0) and it wins. Same trap the `.mobile-nav` comment already
records, which is why this one is filed as a **pair** rather than as an incident.

**(2) `border-color: transparent` is not `border: 0`.** A transparent border still
has **width**, so it still occupies layout and still reads as a box — the element
is boxed in exactly the geometry sense the metric and the reader both care about,
and only the ink is gone. If the rule says "no border", set `border: 0`.

**And a third path to the same outcome, from the responsive branch:** HO 618's
`plain` prop never reached `TopicChips`' **mobile** branch, so `/stale` kept
shipping one bordered chip per row to a phone — 50 of 140, the 50 entirely that
branch — while every desktop measurement read clean. **A prop that styles by
function has to reach every branch that renders it**, which is now a SKILL rule
with this and the HO 609 `variant="v2"` miss as its two citations.

---

## A bar is an empty element whose width was CHOSEN — paint is what separates it from a reservation (HO 620)

M4w's first draft — "an empty element with an explicit width ≥40px inside a
repeated row" — passed a green fixture and then fired **359 times on `/members`**:
201 committee-activity bars, 153 topic-mix segments, 4 tracks. Every one of them
matches the predicate exactly. Every one of them is the **opposite** of what the
predicate is for.

**A reservation and a bar are geometrically identical and semantically inverse.**
A reservation is space held open for content that is absent; **a bar's width IS
the datum** — it is the content. Nothing about the box distinguishes them, and no
amount of tightening the size or sibling clauses will, because the difference is
not geometric.

**What separates them is PAINT: a reservation is invisible by definition.** The
predicate now requires the element to have no paint of its own — no background, no
border, no ink — and `/members` reads **359 → 0**. The fixture gained an
identically-sized **painted** segment as the negative control it should have
carried from the first draft.

**This is the same distinction `data-viz-row` draws for M1, drawn by a property of
the element rather than by an attribute someone must remember to add** — and that
is the better version of it where it is available, because an attribute-based
exemption fails open on every element nobody thought to mark. The near-miss is
recorded rather than quietly fixed because **the fixture comment had already named
this failure mode and the predicate committed it anyway**: knowing the shape is not
the same as writing the control, and only the control fires.

---

## An instrument can suppress the very property it keys on, and its fixture will not notice (HO 620)

The layout audit runs its browser context with `reducedMotion: "reduce"` —
**deliberately and correctly**, because a moving marquee perturbs the geometry
every other measurement in the crawl depends on. The app carries
`@media (prefers-reduced-motion: reduce) { .markets-tape-track { animation: none } }`.

v4's new `M5s` column classifies scroll-by-design containers as *overflow-hidden
with an **animated** descendant*, reading `animation-name` off computed style.
Measured both ways on `/`: **no-preference reads `markets-marquee`, reduce reads
`none`.** So the computed animation-name of the site's one marquee is `none`
**under the only conditions this audit ever looks at it** — and worked example #1
of the very backlog entry the column implements read M5s 0 and left all 86–88
elements in bucket (b).

**The fixture could not have caught it, and that is the lesson rather than the
excuse.** Its marquee case had no reduced-motion override, so **it passed under
both the broken predicate and the fixed one and proved nothing about either.** A
negative control that does not model the environment the instrument runs in is
decoration. The new case (`v4-C2`) carries the same geometry **plus the same
`@media (prefers-reduced-motion: reduce) { animation: none }` the app carries**,
and it fails on the first draft and passes now.

**The general form: a fixture runs under the instrument's own environment,
emulated preferences included — a preference-conditional style is part of the
measured system.** The fix reads animation from the **stylesheet**: an element is
animated *by authorship* if any rule matching it declares a non-`none`
animation-name, whatever the active media query says about **playing** it. (A
second, duller cause rode along: the tape computes `overflow-x: clip`, not
`hidden`, and the predicate checked `hidden` only. Same family — clipped, not
scrollable — both accepted now.)

**And it was found by the bridge run, not by the fixture**, which is the argument
for running the old ruler and the new one on the same DOM even when the new one is
green.

---

## "27 → 4" — a defect count that nets an accepted residue is laundering, caught at the commit message (HO 619/620)

A draft commit message for the P6b batch summarised the phase as **"site M1
27 → 4"**. The 27 was real. The 4 was arrived at by taking the true post-work
figure — **17** — and **subtracting the 13 rows on `/members` that had been
formally accepted and priced at HO 612**.

Every step of that is individually defensible and the result is a lie. The 13 rows
are **still over threshold, still in the crawl, still rendering the gap**; what
"accepted" bought them is a *reason*, not a deletion. **A defect count nets
nothing.** Presenting 4 would have made the register invisible — the very register
whose entire purpose is that the residue stays visible and priced — and the next
person to crawl the site would have found 17 where the record said 4 and had no
way to tell which number was wrong.

**The form is: "27 → 17, with the register named."** The number is the number; the
acceptance is a separate, cited line. **Caught pre-push at the message**, which is
the honest place to record it, because the code was already right — the laundering
was entirely in how the result was described, and that is the layer nothing else in
this arc's toolchain inspects. It is now a SKILL rule.

---

## A constant fitted to a measured MINIMUM scores a row safe by 6px and it still gaps 121 — because ink is not an input to the geometry (HO 634, Aug 2026)

`/lobbying`'s registrant→client column is capped at **340px**, and the cap is
derived on the record: rc ink measured **min 239 · median 379 · max 561**, so
`cap = threshold (120) + min-ink (239) − column-gap (14) = 345`, taken at 340. The
model behind it is `gap ≈ cap − ink`, and it has two independent failure modes
that look alike on a crawl and are not alike at all.

**(i) The stale minimum — repairable.** A minimum is the one statistic over a
growing corpus that can only move one way. Six of the seven over-threshold rows
had natural ink **below 239** — 173, 173, 223, 231 among them — strings shorter
than anything in the sample the cap was fitted to. Every pixel under 239 goes
straight into the gap. **No commit, no regression: the data crossed under a
constant.** Re-fitting the constant moves these rows, which is what makes them the
easy half.

**(ii) The false negative INSIDE the model's safe zone — and this is the one worth
the entry.** One row measured natural ink **346px**: *above* the fitted minimum and
near the fitted median, i.e. sitting in the middle of the distribution the cap was
sized against. `cap − ink` scores it **6px, safe**. It gaps **121**. The cell wraps
at a space, so what the geometry actually reads is the **widest resulting line**
(231px), and the widest line has no relation to the natural width the model takes
as input. Lowering the cap re-breaks the lines and moves that width in a way no
track arithmetic predicts — which is why the disposition curve had to be **applied
in the page and re-read** rather than computed.

**The distinction that earns the entry:** (i) says the constant is stale and can be
re-fitted. (ii) says **re-fitting is the wrong operation**, because no value of the
cap makes the model's input the quantity that determines its output. A model can be
wrong about a row *and score it comfortably safe* — 6px of margin on a 121px gap.
Sharper sibling of *measured slack is a property of that day's feed* (HO 494),
*illustrative mock data sets no numeric expectation* (HO 631), and *a mock or
specimen is evidence about itself* (HO 633). Filed with disposition **(a) accepted
residue**: the class is admitted to the permanent-residue register as class + bound
+ statistic rather than a px constant, precisely because it cannot have one.

---

## A criterion fixed in advance to be unfittable had a sample COUNT in it — so it failed on drift, not on mechanism (HO 634, Aug 2026)

The ruling criterion for the `(c′)` disposition was written down and encoded
**before** the measurement ran, specifically so the result could not be fitted to
it afterwards. Clause 2 read: **"the six (i) rows each read gap 12"**, encoded as
`count === 6 && atTwelve === 6`.

At the run there were **four** (i) rows, and **all four read exactly 12**. The
clause reported FAIL. Nothing about the mechanism had failed — the drift control in
the *same script* independently showed the per-page over-counts moving
`2/1/1/2/0 → 0/2/1/1/0`, because `/lobbying`'s feed is date-ordered and new filings
push rows across page boundaries between crawls.

**The instrument built to be immune to fitting carried the arc's own subject inside
it: a sample reading baked into a constant, on the route where that count was
already known to vary 1–3.** The rule that falls out: **a pre-fixed criterion must
be written in the quantities that DON'T vary.** "Six" was a reading, not a
mechanism.

What saved it was that the clause also stated its **failure condition** — *"the (i)
rows not reaching 12 (mechanism wrong, not margin thin)"* — and that half is what
disambiguated the count half at ruling time, which is how it was ruled PASS on the
mechanism. **A criterion that states what failure would MEAN survives its own stale
constants; one that states only a threshold does not.** Same shape one level up as
the cap entry above: a constant fitted to a sample, then used as though it were a
property.

---

## An override that loses to `!important` silently re-reads the unchanged value — and the tell is a column identical to the one it should differ from (HO 634, Aug 2026)

Third instance of one family: an instrument applies an override, re-reads, and
reports the **unchanged** number because the override never took effect. It reads
as a clean pass every time.

- **The cap curve.** `feedH` / `pageH` were captured in the return expression,
  which ran *after* the style was restored — so every cap reported an identical
  feed height and the entire height cost of wrapping was invisible.
- **The bound check.** `el.style.gridTemplateColumns = "…min-content…"` — a plain
  inline declaration — **lost to the injected `!important` stylesheet**, so the
  min-content column re-read the `fit-content` track it was supposed to differ
  from. Fix: inline `!important` outranks author `!important`, so
  `setProperty(…, "important")`. With it applied, min-content read **115px against
  a 340px bound** where the broken version had read 340.

**The tell is the reusable part, and it was the same tell both times: a column
identical to the one it was supposed to differ from.** The cap curve's `feedH` was
flat across every cap; the bound check's `maxMinContent` equalled `maxRcTrack` at
all five widths (340/340 four times, 230/230 once). **An instrument that reports the
same number for every input is not measuring its input** — check that before
believing a clean result, because both of these presented as passes.

One asymmetry worth keeping, because it stops the lesson being over-applied: the
gate the clause actually turned on (`maxRcTrack ≤ 340`) was read **directly under
the applied style and needed no override**, so its PASS was sound. Only the
diagnostic beside it was dead. **A broken instrument does not automatically
invalidate every number it printed — it invalidates every number that depended on
the override.**

---

## A field named for the EVENT gets read as the event by everyone who arrives later (HO 632 → 634 → 635, Aug 2026)

`bills.stage_changed_at` recorded when the sync **observed** an advance, not when
the stage changed: both write sites stamp `new Date().toISOString()` at the top of
the run, so one run stamps a whole batch of referrals with one clock. Measured over
the 40 most recent movers: lag positive on **40 of 40**, median 3.76 days, max
20.76, and the 40 rows carried **two distinct minute-stamps** while the actions
behind them spanned 2026-07-21 → 2026-08-08. That is correct behaviour for a field
named for observation, and it is exactly what the field is. **The defect was
entirely in the name.**

**Fifteen consumers read it, nine of them windowing counts on it, and every one was
written by someone reading the column name.** Nothing catches this: both an
occurrence timestamp and a write timestamp are `TEXT`, so the type system is blind;
and no query can catch it either, because each query is *correct* about the column
it names. So the general form is the entry, not this instance: **a timestamp column
whose name describes the EVENT rather than the WRITE will be read as the event by
every consumer that arrives later**, and the misreading compounds silently because
each new reader inherits the previous reader's interpretation rather than the
column's semantics.

It surfaced only when a display change (HO 632's day-grouping) put two readings of
the same field beside each other on one row — `INTRODUCED · 2D` next to
`COMMITTEE · 28M` — and even then the two were **internally consistent**, both off
the observation clock, which is why nothing looked broken from inside. An
externally-wrong, internally-consistent surface is the hard case: it has no
self-contradiction to trip over.

**Name the write, not the event.** `stage_observed_at`, `ingested_at`, `fetched_at`,
`last_seen`, `first_seen` — CBT already gets this right everywhere the name wasn't
inherited from a hurry, which is what made the one exception invisible. And a rename
alone is worth shipping even though it **fixes no instance**: it converts every
reader from an unexamined default into a deliberate choice, which is the only cheap
move available against a defect whose whole mechanism is that nobody re-reads the
semantics.

---

## Reader-lessness does not license a bare rename — a writer binds a schema name as hard as a reader (HO 635, Aug 2026)

`stage_transitions.changed_at` has **zero production readers**, verified rather than
inherited from the backlog: the only production references are the two INSERTs. That
is what a "so just rename it" ruling keys on, and the premise held. **The conclusion
didn't.** Both writers name the column explicitly in an **unguarded
`await db.execute`**, and the column is `NOT NULL` with no default — so a bare
`ALTER TABLE RENAME COLUMN` under running code fails the sync and summarize paths
outright the moment it lands, with no reader involved at all. It took the same
expand/contract as its reader-heavy sibling, plus a **one-release dual-write**: the
INSERT cannot stop naming `changed_at` until the contract drops it, so both columns
take the identical value for exactly one release, and the ordering is forced (code
first, drop second — dropping under the dual-writing build would fail every
transition log).

**The rule: a rename's blast radius is every statement that NAMES the column, not
every statement that READS it.** A reader census answers "who breaks on the value";
whether a rename can be bare is a **reference** question, and the `NOT NULL`-with-no-
default case is the one that also fixes the *order* of the two commits. Filed
because the reader-only analysis is the natural one to reach for and it is right up
until it is expensively wrong.

---

## A hardcoded label off the matchup SHAPE is not evidence that the status column changed — `RaceCard:206` reads identically either way (HO 638, Aug 2026)

After the S-ME-2026 roster correction, the live race card renders
`Jackson  D · nominee` — which looks exactly like proof that the new
`race_candidates.status` value landed. It is not. That string is a **hardcoded
label at `RaceCard:206`**, printed for the `challenger.kind === "nominee"`
**matchup shape** (HO 305) — a display classification of how a challenger row
was derived, computed upstream of and unrelated to the status column. It would
read **byte-identically** if Jackson's status were `won_primary`, or `declared`,
or a typo. Two same-spelled things at different layers, and the one that renders
is the one that proves nothing.

**The instruments that do discriminate**, all three used before the change was
believed: the **two `ORDER BY` fires** — `getRaceCandidates` via
`GET /api/race/S-ME-2026/hub` and `getRaceCandidatesForCycle` via a rendered
`/electoral`, both returning Jackson 0 / Platner 1 / Mills 2 where a
non-landing would have sorted Jackson to 3+, below the withdrawn rows — and
`RaceCandidates`' **title-case `Nominee`**, which is derived from the status
value rather than the shape. Plus the raw column read back as the literal string,
because `seed:races` does not validate status (backlog WATCH) and a typo fails
identically to a correct value at the seed step.

**The rule this instance belongs to: a layer check has to look where the value
LANDS, not where a similar-looking string is AUTHORED.** The trap is not that
the label is wrong — it is right, and it was right before the change too. That
is the whole problem: a string that reads correct under both hypotheses is a
constant, not a measurement. Same family as the same-as-success instruments
(HO 503/506/637), one layer over: there the check couldn't fail, here it
couldn't distinguish.

---

## `races.last_verified` records when `seed:races` last RAN, not when a roster was last checked (HO 638, Aug 2026)

`seed:races` upserts every entry it walks and **stamps `last_verified` whether
or not the entry's content changed** — there is no diff step between reading the
JSON and writing the row. So the column answers *"when did the script last touch
this race"*, while its name, and every surface that renders it, promise *"when
was this roster last confirmed correct"*.

The gap is not theoretical and it shipped to a user-facing surface:
`/race/S-ME-2026` printed **"last verified 2026-07-03"** underneath a roster
that was **two candidate-states stale** — Platner had won the June 9 primary and
withdrawn on July 10, and Troy Jackson had been nominated at a July 25
convention, none of which the card knew. The stamp was not lying about its own
semantics; the 2026-07-03 run **did** happen and **did** touch ME. It changed
nothing, and stamped anyway.

The same misreading caught the HO 638 handoff itself, which asserted the entry
was frozen at HO 171 with `last_verified` 2026-06-01 — inferring from a frozen
JSON entry that no run had occurred. **A frozen entry and an unrun script are
different facts and this column cannot tell them apart.** Do not use
`last_verified` as a staleness instrument for curated rosters; it is the
same-as-success shape (HO 503/506/637) wearing a date. The stronger available
signal is an independent feed disagreeing with the roster — a name market
resolving to no active roster member, which `favoredMember` already computes and
discards (backlog QUEUED).

---

## A guard whose predicate is a SUBSET of what one write produces can fire on a partial write (HO 640/641, Aug 2026)

`primaries-sync.ts::isSettled` decides a contest is finished on **two**
conditions: its date has passed, and some candidate row carries a non-NULL
`vote_pct`. The write it is guarding produces **three** things in a single
INSERT — the roster, the share, and `status` (`c.isWinner ? "winner" :
"running"`). The guard reads one of the two columns that arrive together and
infers the whole write landed.

It usually has. Ballotpedia normally posts a result and marks the winning
votebox row at the same time, so shares and a winner arrive in one scrape and
the contest settles complete. But the two are **independently timed at the
source**, and a scrape that lands in the window after results post and before
the race is called writes shares + `running`. That row now satisfies the
predicate. Every later tick refuses it — at all three write paths, because the
guard is consulted *before* the incoming roster is even built, so the correct
roster the next tick would have written is never compared against what's there.

**Measured:** 516 of 718 completed contests are settled. Most froze correctly.
**11 froze mid-write** — CA-04/14/16/43, WA-05/07/08/09, ME-D, ME-R,
NJ-09-R — carrying shares and no winner. The sharpest exhibit is WA: all ten
completed WA contests were touched at or after their own 2026-08-04 date, and in
the **same 2026-08-06 tick** WA-04/06/10 each took two winner rows while
WA-05/07/08/09 took none. Same date, same run, same code path — the difference
was entirely whether Ballotpedia had called that particular race yet.

**The generalizable tell: when a guard's predicate is a strict subset of what
one write produces, the guard can fire on a partial write, and it will do so
exactly on the rows where the source was slowest** — which is to say, on the
close and the contested ones. Ask of any done-flag: does it observe *everything*
the write produces, or the part that happens to arrive first?

Not irreversible, and the distinction matters. `isSettled` is module-private and
guards only the three sync paths; `backfill:primary-results` and
`reingest:primary-slate` bypass it and write both columns. So the freeze is
**unreachable by any automatic path but recoverable by hand** — while the cron
reports success on every tick without ever touching these rows, which is the
same-as-success shape (HO 503/506) arriving on the ingestion side.

---

## `primaries.race_id` is the RUNOFF join key — the name promises a generality it does not have (HO 640/641, Aug 2026)

`primaries` carries a `race_id TEXT REFERENCES races(id)` column. Reading the
schema, it is the obvious way to get from a primary contest to the race it
belongs to. It is not, and the column is not broken — it is **narrow**.

**4 of 876 rows carry it**, and **0 of the 718 completed** ones do:
`senate-GA-2026-R-runoff` → `S-GA-2026`, `senate-LA-2026-{D,R}-runoff` →
`S-LA-2026`, and `senate-SC-2026-special-R` → `S-SC-2026`. Those are exactly the
rows that need it: `getRunoffsForRace` (`lib/queries.ts:1608`) matches
`p.race_id = ? AND p.election_round = 'runoff'`, and a runoff has no other way
to name its parent race. The column does its job. It just isn't the general
primary→race link.

The general link is a **shape join** — `state` + `chamber` +
`CAST(district AS INTEGER)`, which is what `backfill:race-challengers` uses.

**The exhibit is this probe's own first pass.** HO 640 set out to measure which
of the 11 the harvest could reach, read `primaries.race_id`, found it NULL on
all eleven, and reported **all 11 unreachable**. Re-measured on the shape join
gated by `EXISTS(race_ratings)`, the answer is **5** — NJ-09, WA-05, WA-08,
ME-D, ME-R. The wrong number was not obviously wrong: "the harvest can't reach
any of them" is a plausible finding that would have quietly closed the product
question. **When a column's name matches the join you want, check what the
consumer actually joins on before believing it.**

Ride-along, no separate line: the comment at `lib/queries.ts:1684` states this
density as **3/907**. Current corpus is **4/876**. Correct it whenever
`queries.ts` is next open for another reason.

---

## An instrument that reads a PROXY for the thing instead of the thing — three from one arc (HO 642/643, Aug 2026)

Three separate measurement failures in one arc turned out to be the same
failure, so they are filed once as a family rather than as three unconnected
notes. In each, the instrument read something that **looks like** the quantity
it wants, is **adjacent to** it, and is not it — and in each, the wrong reading
was the *plausible* one, which is why nothing caught it on sight.

**1. An index is not a clock.** Two per-chamber occupancy series were pooled by
array position: `series[k] + series[k]`. But cursor 0 is each chamber's own
newest roll call, and the House was in recess — **house cursor 0 = 2026-07-23,
senate cursor 0 = 2026-08-08, sixteen days apart**. Summing by index adds two
different moments and calls it one. It moved the headline: **median 3 / max 7 by
index against median 4 / max 9 by date**. The fix is to pool on the shared axis
(date), restricted to the window both series actually cover — outside it one
chamber contributes no sample, and a zero there reads as "nobody absent" rather
than "not measured". Same family as *`primaries.race_id` is the RUNOFF join key*
above: a field that looks like the axis you want and isn't.

**2. An element rect is not rendered ink.** Battlefield label collision was
measured on `.cm-lbl` bounding boxes and reported **five overlaps at 1440**
(5px + 4×23px). The boxes are wider than their glyphs and centred on the dot, so
the boxes overlap while the text does not. Re-measured by **ink span** (a
`Range` over the text node), the gaps are **51/35/35/33/30px** and it is clean —
and the screenshot agreed with the ink, not the rects. This is the HO 615
ink-span rule arriving one instrument down: a layout audit already knew to band
by ink, and an ad-hoc collision check did not inherit it.

**3. `grep -c '^-[^-]'` is not a deletion count.** In unified diff a deleted
markdown bullet `- **text**` renders as `-- **text**`, which `^-[^-]`
**excludes by construction**. So the count reads **0** on a diff that deleted
bullets, and 0 is exactly what "no deletions" looks like. It was reported as
verification across the HO 639–641 arc by two different readers. The ruled
instrument is **`git diff --numstat`'s deletions column** (or normal-format
`^<`). Related trap in the same family: diffing against `git show HEAD:file`,
which reports every line changed because `core.autocrlf` is true with no
`.gitattributes` — an LF blob against a CRLF worktree.

**The check that catches all three:** state what the instrument would read if
the work had gone wrong in the specific way it is meant to detect. If that
reading is indistinguishable from success — 0 deletions, no overlaps, a plausible
median — the instrument is measuring a proxy, and the proxy is where to look.

---

## A verdict string that does not read its own numbers (HO 642/643, Aug 2026)

Distinct from the proxy family above, and worth its own entry because the half
that failed is the half nothing tests. A probe's ruling criteria named three
outcomes, one of them `CONDITIONAL` with the parenthetical *"(median 0, max >
0)"*. The measured result landed in that bucket from the **other side** —
median **4** (passing the `>= 1` half) and max **9** (breaching the `<= 6`
ceiling) — and the branch printed its canned line anyway:

> the band is reachable but **sits empty at the median**

directly beneath a printed median of 4. **The computation was right and the
sentence describing it was wrong.** No assertion covers that: the numbers were
correct, the verdict label was correct, and only the prose contradicted the
table two lines above it. This is the same-as-success shape relocated into the
**reporting layer** — a reader skimming for the conclusion gets a false one from
an otherwise sound probe.

The fix is to **derive the verdict text from the values, or drop the prose and
print the table**. Here the branch became two-armed on `median === 0`, and the
non-anticipated arm says what actually happened (the failure is
over-population, not rarity, and the lever is a higher threshold). The general
rule: **a summary sentence is an assertion about the data and needs the same
scepticism as a computed one** — if it is written once and printed under every
outcome, it is a claim nobody re-checks.

---

## Occupancy of a transient state is not measurable from one sample (HO 642/643, Aug 2026)

Not an instrument failure but a sampling one, and it inverted a finding. A probe
measured how many members sat in a `[5, 30)` missed-vote streak band, found
**zero**, and its summary generalised that to *"any WARN in 5..29 selects
zero"* — a claim about the **corpus** made from a **single cursor**.

The state is transient by construction: a member **passes through** the band on
the way to the 30-roll MIA tier. So one sample can easily land between crossings
and report a permanently-empty band that is in fact routinely occupied. Replaying
the identical streak rule with the cursor set to each of the last 60 roll calls:
**median 4, p90 7, max 9, and 31 distinct members entering the band** over the
window. Today's zero was real and was the last five House cursors only — a
well-attended closing series before the recess had reset everybody's streak.

**One sample cannot distinguish "never" from "not right now",** and a tier
declined on the former would have been declined on evidence supporting only the
latter. The replay cost nothing: the position matrix was already in memory from
the control walk, so 60 cursors and later a 15-rung threshold sweep added **zero
queries** — the statement count was byte-identical before and after.

The structural follow-on is worth copying: the replay and the sweep were made to
share **one** `occupancyFor(W)` function, so the date-axis pooling could not be
fixed in one and left broken in the other. **When a correction lands in one of
two near-identical code paths, merge them rather than patching both** — two
copies of a fix are two chances for the next one to miss.

---

## A threshold expressed in the wrong variable cannot see the thing that moves (HO 645/646, Aug 2026)

The absence band's payload trigger read *"band membership grows past a handful —
at today's 2 members the payload is not the problem it becomes at ten"*: a
**population** threshold. HO 645's ship gate then priced the new tier at *"2× the
15,481-byte post-HO-631 baseline"*: a **total-bytes** threshold. Both were blind
to the same thing.

The population never moved — **2 members before, 2 members after** — and
**bytes-per-member went 7,740 → 14,760 on corpus drift alone, with no code change
between the two readings**. The gate came in at **1.91×**, so it very nearly fired
on a change that had added nothing to the payload; and had the at-risk tier
actually carried members, one number would have fused drift and tier with no way
left to separate them.

**A gate must be expressed in the variable the change moves, or it measures the
background.** The re-priced entry watches bytes-per-member, which is the quantity
that was actually growing the whole time and which neither original threshold
could see.

This is the proxy-instrument family one level up: there the *reading* stands in
for the thing you care about, here the *threshold* does. Same tell, asked of the
gate instead of the measurement — **if the quantity in the threshold can hold
still while the thing you are protecting against doubles, it is not the
threshold.**

## `__name is not defined` inside `page.evaluate` is a build artifact, not a product failure (HO 646, Aug 2026)

A Playwright probe run through `tsx` dies with `ReferenceError: __name is not
defined` the first time it evaluates a function in the page. Nothing is wrong with
the page: esbuild's `keepNames` rewrites every arrow function to reference a
`__name` helper that exists in the Node module scope and **not** in the browser
context `page.evaluate` serializes into.

It presents as the product being broken — the harness reports a failure, in a
run whose whole purpose was to find one — and the repo already carries the fix
twice, as `NAME_SHIM` in `feed-click-gate-627.ts` and `layout-audit-606.ts`. The
new harness simply did not inherit it. `await ctx.addInitScript(NAME_SHIM)` before
the first navigation, and it goes away.

## A lesson encoded in one instrument is not inherited by the next (HO 615 + HO 646, Aug 2026)

Two instances, one arc apart, and the second is what makes it a rule rather than
an anecdote.

- **HO 615.** The ink-span rule lived inside the layout audit. An ad-hoc collision
  check written later re-learned it from scratch, by reporting five overlaps that
  were not there.
- **HO 646.** `NAME_SHIM` above, carried by two committed harnesses and absent
  from the third.

The failure is structural rather than careless: these harnesses share a language,
a runner and a set of traps, but **no base**. Every new probe re-derives the same
ones, and the cost is paid in a red run that looks like a product defect. The
instruments that do carry the fix carry it as a copied constant, which is the same
no-compiler-edge dependency the verbatim-SQL-mirror entry is about.

*Promote to a shared harness preamble when:* a third probe hits either trap, or
the next one is written from scratch rather than copied from one that already has
them. Not before — a premature shared module is one more thing to keep current,
and two instances is a pattern, not yet a cost.

## An `unstable_cache` key hashes the callback's own source text — a change in anything it CALLS is invisible to it (HO 647, Aug 2026)

The key is not the `keyParts` literal you passed. Next 15.5 builds it as `${cb.toString()}-${keyParts}` (`unstable-cache.ts:95`), so it is content-addressed on the cached function's own body — and that one line decides whether a change invalidates itself or hides. HO 645 recorded the absence band's entry serving a stale tier split “after a revert and a full rebuild”, and HO 647's handoff generalised that to *the key is the literal `["getAbsenceWatch"]`, so a shape change is invisible to the cache*. Measured against `next start` + `.next/cache/fetch-cache` (2026-08-12) — three points, only the last of which rotates the key:

| change | key rotates? |
|---|---|
| rebuild alone, new `BUILD_ID` | **no** — the request reused the entry byte-for-byte, zero new files |
| module-level only (a constant, an import, a type) | **no** — zero new entries |
| inside the cached callback's own body | **yes** — a NEW entry is written, the old one orphaned |

So the two cases look identical from outside — “I changed the code and the number is still wrong” — and behave oppositely. **An edit inside the cached function self-invalidates** (a new key; the stale entry is orphaned, never served, and lingers on disk looking authoritative to any probe that reads the directory rather than the served value). **An edit that changes the cached VALUE without touching that function's text does not** — so the old value keeps serving until the TTL or a `revalidateTag`. **Practical consequence: never conclude “the cache key doesn't include X” from the fact that a value went stale** — ask instead whether your edit landed inside the callback body, and when in doubt delete the entry and re-request, which is correct under both branches.

**Two clauses that fall out of the same line and are easy to get backwards.** (a) `cb.toString()` returns the **MINIFIED** body in a production build, so a comment- or whitespace-only edit inside the callback does not rotate a prod key even though it changes the source you are looking at; the text being hashed is the bundler's output, not the file. (b) The key covers **only that function's own text — never the functions it calls.** So a value change in a callee, in an imported helper, or in a module-level constant the body merely *references* by name leaves the key byte-stable and the stale value keeps serving to the TTL. That is exactly the discriminator between the two incidents: HO 645 changed `ABSENCE_STREAK_MIN`, a module constant the body only names, so the key held and it saw staleness; HO 647 rewrote the projection inside the body, so the key rotated and it did not. The general rule is that the key is content-addressed on ONE function's text, while the cached value depends on everything that function reaches — and the gap between those two is where staleness lives.

**This SUBSUMES *Vercel's Data Cache persists across deployments* (HO 312) rather than contradicting it:** a deploy does not rotate the key precisely *because* the key is derived from the function's text and not from the build, which is the same fact seen from the other side (measured here: a new `BUILD_ID` reused the entry byte-for-byte). It also corrects a conclusion drawn from the older framing and shipped in this arc's first draft — that a body edit's blob “shrinks when the entry regenerates.” **It does not — and that correction is DERIVED, not observed.** The derivation: `generateCacheKey` is handed `fixedKey` + args in Next's shared path (`unstable-cache.ts:133-134`) **before any cache handler is consulted**, so a rotated key resolves to a different entry regardless of which handler backs it — the step is handler-agnostic, which is what lets a local `.next/cache` reading carry to Vercel's Data Cache rather than being a fact about the filesystem. On that derivation a rotated key has no prod entry at all, so the first read after deploy is a cold miss that builds the new value directly: no convergence window and nothing to wait out. Convergence-by-repeated-hits (the HO 555 rule) applies to the *stable-key* branch — where the value changed underneath an unchanged callback — and not to this one.

**The prod arm is UNOBSERVED, and why it stayed that way is the durable part.** HO 647 measured all three rows of the table locally, and on prod confirmed the served SHA, the render and the population — but never the prod cache state, because **the band's public surface cannot discriminate**: a fat payload is a *superset* of a thin one, so `AbsenceCardBack` reads the same three keys out of either and renders byte-identically (prod md5 `a3278f5b9ae5afef8083573658f88f4f`, unchanged across five consecutive hits). No amount of hitting prod would have settled it — the observation was never available, so its absence is not a gap in diligence. Read the prod clause as **derived-and-unfalsified**, not measured. The two-arm instrument that would close it, and the three traps that make the obvious version invalid, are banked in `docs/backlog.md`.

## A matching check whose pattern cannot fail for some inputs reports those inputs as passing (HO 651 + HO 655, Aug 2026)

**Instances of the existing close-criterion rule — a success signal that does not
depend on the check succeeding — not a new principle.** What earns a separate entry
is the DIAGNOSIS: in all three the fault is in the **pattern's reach**, not in what
the check was pointed at. The check is aimed correctly, runs correctly, and still
cannot discriminate — so the output is byte-identical to a real result, which is
why none of the three was caught by reading the output.

It has two polarities, and they look nothing alike until the mechanism is named:

- **The pattern cannot MATCH, so everything reports absent.** HO 651's control used
  a ±120-character window to find a deletion marker sitting ~162 characters away.
  Unreachable — so the control passed under the correct classifier AND under the
  deliberately broken one, discriminating nothing.
- **The pattern cannot MISS, so everything reports present.** Two of these. HO 651's
  phantom probe scanned a tree containing its own source, and its own comments name
  the components it hunts, so it vouched for a phantom it was enumerating. HO 655's
  selector census used a bare substring match over `components/` + `app/`: the token
  `open` matched the English word in a comment, `v2f-id` matched inside the longer
  string `bill-id-chip`, and a short token therefore could not fail the test no
  matter what the specs contained.

**The pre-flight question is cheap and would have caught all three: what input would
make this pattern report the OTHER answer?** If you cannot name one, the check is a
constant wearing the costume of a measurement. A ±120-char window has no input that
reports a marker at 162. A substring search for `open` over a large tree has no
input that reports absent.

**A corrected instrument that reaches the SAME answer is the interesting case, and
it is why a result can never vouch for its method.** HO 655's strict re-run —
whole-word on a `className=` line, or `.token` in CSS — returned the same
`0 tokens with no producer` as the broken matcher, with the attributions now
correct. **The RESULT stood and the INSTRUMENT did not**, and nothing in the first
output distinguished them. Had the corrected run disagreed, the defect would have
announced itself; agreement is the silent case, so the re-run is worth doing even
when you expect it to confirm.

**And what none of the three could catch, because it bounds the whole family:** all
are EXISTENCE checks, and the defect that motivated HO 655 was *selector exists,
behaviour moved* — `a.v2f-id` is real, and the assertion wrapped around it encoded
a contract HO 609/613/627 had reversed. A pattern with perfect reach still cannot
see that. Only running the test does, which is why HO 655's rot ruling came out at
*accept manual rot* rather than at a static gate.

## A perturbation instrument can fail in BOTH directions — falsify it for each (HO 658)

Removing a CSS declaration and diffing every descendant's rect is the standard way
to ask *"does anything depend on this?"* — and it has two failure modes that look
like clean answers.

**Vacuous zero.** Aimed at a pane that is `display:none` (an inactive tab, a
collapsed disclosure), every rect is `0×0` and nothing can move. The perturbation
reports "nothing depends on it" **without ever having measured the thing**. Guard:
assert the target renders with non-zero area first, count VISIBLE nodes as the
denominator, and run a control that MUST move things — the padding injection that
moved 22/22 (HEARINGS) and 317/338 (RACES) here is the pattern.

**Spurious one hundred percent.** The first RACES run reported **338 of 338 nodes
moved** on dropping `position: relative` — a total dependency that did not exist.
`getBoundingClientRect()` is viewport-relative, and the driver's `hover()` scrolls
its target into view, so re-hovering between snapshot A and snapshot B moved the
CAMERA, not the layout. Every rect shifted by one uniform delta. **The tell is the
uniformity**, and the fix is document-relative coordinates (`+ window.scrollX/Y`)
or a scroll reset before each reading. With that, both legs read 0 and the
declaration was safe to delete.

The shape: a control leg proves the instrument can see movement, and coordinate
normalization proves what it sees is the SCENE. A 0 without the first is vacuous;
a 100% without the second is an artifact. Neither number is evidence on its own.

## A cost stated in units the architecture doesn't spend — the parameter looked expensive because nobody priced the mechanism (HO 656 → HO 661, Aug 2026)

HO 656 recommended a bounded re-check window for `isSettled` and told the build
to be honest about its price: *"Cost is N wasted fetches per uncontested seat;
say that in the build rather than pretending the parameter is free."* That is a
careful sentence, written by someone deliberately refusing to hide a cost — and
the cost does not exist. **`isSettled` is a WRITE-freeze, not a fetch-skip.** All
three call sites evaluate *after* the page has been fetched and parsed, and the
cursor's unit selection (`buildScrapeUnits` / `readCursor`) carries no settled
term at all, so **the unit is fetched whether the row is settled or not**.
Widening the window from 0 days to 30 changes the fetch count by zero. What N
actually buys is N days of *rewrite-eligibility* on decided-but-uncalled rows —
which is not a cost paid for the healing, it **is** the healing.

**Why it survived review, and this is the part worth keeping.** The claim was
never checked because it was never checkable from where it was written: it is a
statement about a *mechanism* ("settled ⇒ we skip work") smuggled inside a
statement about a *parameter* ("N ⇒ N units of that work"). The parameter half is
arithmetic and reads as rigorous; the mechanism half is an assumption and is
where the error lives. And the framing was **conservative** — it overstated the
cost of the author's own recommendation — so every incentive that normally
catches a wrong number was pointing the other way. A cost you are talking
yourself *out of* gets audited; a cost you are talking yourself *into* gets
believed. It sat through the recommendation, the QUEUED entry and the handoff,
each restating it faithfully, until a STEP 0 that had to name the three call
sites for an unrelated reason read what they actually do.

**The check, which is cheap:** before quoting a per-N cost, name the operation N
multiplies and find the line that performs it. If the guard sits *downstream* of
the expensive thing, N is not multiplying that thing. Same family as *`EXPLAIN`
prices the plan, not the runtime scan* and *rows read and milliseconds are
different currencies* — a real quantity, measured or reasoned honestly, attached
to the wrong mechanism. The tell here was available in the original sentence:
"wasted fetches **per uncontested seat**" prices a per-seat loop, while the thing
being changed is a per-row predicate consulted inside one.

## A completeness check run in a fresh clone measures the clone, not the work — tracked-equals-on-disk is guaranteed there, and it mis-scoped an archive by 53 files (HO 662, Aug 2026)

The HO 662 recon established the handoff archive's scope from a fresh clone: `git ls-files docs/handoffs/` returned **386** files, the highest number among them was **429**, and the conclusion recorded in the handoff was that tracked handoffs *stop at 429* and everything from **430** onward exists only on Corey's disk. The archive was specified as `430-661`.

**The reading was true and the scope drawn from it was wrong.** A fresh clone contains **only tracked files**, so in that tree the on-disk set and the tracked set are the same set by construction. Any check of the form *does what is tracked match what is here* returns equality in a fresh clone **whether or not untracked files exist anywhere**, because the one place they could have shown up is the one place they cannot be. The instrument had no failing case available to it. Read against the real working tree, `docs/handoffs/` holds **674 entries against 386 tracked** — 288 untracked, and the untracked numbering starts at **362**, not 430: HO 362-429 is partly tracked and partly not, which is invisible from either number alone because "the highest tracked is 429" and "the lowest untracked is 362" are perfectly compatible facts. Archiving 430-661 would have shipped 214 files and left **53** behind, for 122 KB saved.

**This is the same-as-success family, with a new carrier: the environment rather than the assertion.** The usual form is an assertion that cannot fail (a detector with nothing to detect, a coverage grep pointed at the wrong path, a piped exit status). Here the assertion is fine — comparing two file sets is a real comparison, and in a working tree it would have caught this immediately. What guaranteed the green was **where it ran**. A fresh clone is the right environment for reading *committed content* and the wrong one for measuring *what is missing from the commit*, and nothing about the command says so.

**The check that catches it:** name the environment as part of the instrument, and state what the reading would be if the work had gone wrong in the specific way it is meant to detect. *"If there were 300 untracked handoffs, what would this command print?"* — in a fresh clone, exactly what it printed. A completeness or gap measurement runs against the **working tree**, never the clone, and the two must not be treated as interchangeable just because their tracked contents agree. Related: the falsification-anchor entries above, where the instrument was fine and its subject had expired; and the coverage-versus-breakage entry (HO 604), where the count had to be taken before the change as well as after.

## A pinned NEGATIVE claim about schema has no source to diff against, and the HO that falsifies it has no reason to look for it (HO 663, Aug 2026)

`scripts/diagnostic/roster-coverage-642.ts` carried, in its M5 section header and in a line it **printed into every report**: *"`race_candidates` HAS NO TIMESTAMP COLUMN … the last-run time is NOT recoverable from the table."* True when written at HO 642, and the whole reason M5 answered the freshness question behaviourally instead. **HO 659 added `race_candidates.updated_at`** — a per-run reach stamp, added specifically to close the gap M5 was working around — and the claim became false and stayed false through HO 660, 661 and 662, printing to anyone who ran the probe.

**The mirror-drift rule already on the books does not cover this.** That rule (HO 554 → 557, and SKILL's pre-flight section) is about a diagnostic pinning a **verbatim copy of shipped logic**: the copy is a dependency with no compiler edge, so you reconcile it against its source before trusting a re-run. It works because there *is* a source to diff against. **A negative claim has no source.** "This column does not exist" cannot be diffed against a schema, because the thing it names is precisely the thing that is absent — there is no line in `migrate.ts` to compare it to until someone adds one, and at that moment the claim silently inverts.

**And the direction of the change is what makes it invisible.** A rule that says *reconcile the copy when the source changes* points the obligation at whoever edits the source. But HO 659 did not edit anything the probe had copied — it **added** a column. An HO adding a column has no reason to grep the diagnostics for prose asserting that column's absence; nothing in the change's own blast radius (SKILL's "every statement that NAMES the column" test, from the rename rule) reaches a sentence whose entire content is that the name does not occur. The rename rule's grep gate is *zero references to the old name*; there is no corresponding gate for *references to a name that has just started existing*.

**Both halves passed every check that was run.** STEP 0 of HO 663 diffed all four pinned SQL copies term-by-term and found **zero drift** — the SQL genuinely was byte-identical, so a reconcile scoped to "check the pinned copies" would have reported clean and moved straight to the run, with the false line still in the output. What caught it was reading the section the copies sat in rather than only the copies. The sibling defect in the same file was the ordinary kind and equally invisible to the SQL diff: a provenance line reading `scripts/backfill-race-challengers.ts … at 3de13e6`, pointing at a file that has merely wrapped the harvest since HO 660 moved it to `lib/`, so the pointer dangled while the SQL it pointed at was correct.

**The check that catches it:** when reconciling an instrument, **read its claims, not just its copies** — and treat every sentence of the form *"X does not exist"* / *"this cannot be answered from the table"* / *"there is no such column"* as load-bearing with an expiry date, because it is a statement about the *absence* of something and absences end without notice. A pinned copy rots when its source changes; a pinned negative rots when its source **appears**. Corollary for the other side: a change that ADDS a column, field or endpoint should grep the diagnostics for prose asserting the absence it just ended — the rename rule's grep gate has no counterpart for additions, and this is it.


## A backgrounded verification server that never bound still serves a passing gate — because something else already answers on its port (HO 664, Aug 2026)

HO 664's STEP 3 gate was `npm run start` then `curl -s -o /dev/null -w "%{http_code}"` against `localhost:3000`, expecting 200 and a non-zero `v2f` count. It returned **exactly that** — 200, `v2f` 426, the feed renderer intact — and **none of it was this branch's build**. The server had been backgrounded, hit **`EADDRINUSE`** and exited immediately; a **concurrent session's** `next start` already held 3000 (Corey runs parallel agents against one shared working tree, which is the normal case here, not an exotic one). Every assertion in the gate was satisfied by a foreign process.

**Nothing in the gate could have caught it, because every symptom of the failure is also a symptom of success.** A backgrounded process that dies writes its error to a log nobody reads; `curl` cannot tell you which build answered; and the page under test was *already working on main*, so a stale server renders it correctly. Checking the exit status of `npm run start` would not have helped either — it was launched detached precisely so the gate could run against it.

**Two tells, and only one of them was in the plan.** The weak one: **“up after 1s”**, far too fast for a cold Next boot — suggestive, easy to read as good news. The decisive one was a **stylesheet 400**. The page referenced two CSS files; one returned 200 and the other **400, because it did not exist on disk**. That process had booted against an older `.next`, and this branch had since rebuilt it twice — so the running server's build manifest named a content-hashed CSS file the rebuild had deleted. The 400 was not a bug in the work under test; it was **the running server telling you it was not the one you built**, and it only appeared because the gate happened to assert that the stylesheets load (the standing rule from the stale-`.next`-serves-200-with-404'd-CSS trap, HO 212). A gate that had only checked the document status would have gone green and stayed green.

**The rebuild also perturbs the other session, which is worth knowing before reaching for a kill.** `next start` reads its manifest at boot but serves static assets off disk, so any rebuild by *another* session silently breaks the running one's asset URLs. That is the same collision seen from the other side, and it means the polite move is not always available: by the time you notice, you have already degraded the neighbour.

**The fix, and the general rule.** The reading was **discarded rather than reinterpreted** — a gate run against the wrong process yields no information about the right one, so there was nothing in it to salvage — and re-run on a private instance on a free port (3100), where it passed on this build: 200, `v2f` 426, every removed selector 0 in the served HTML, and **both** stylesheets 200. The other session's process was **left alive** and this one's killed by PID, port-scoped, per SKILL's process-cleanup rule. **So: bind before you measure.** Confirm the server you are about to test is *yours* — assert the listener's PID is the one you spawned, or take a port nobody else can be on — before any assertion about the response means anything. On a shared tree the default assumption should be that port 3000 is occupied, not free. This is the same-as-success shape the codebase keeps meeting (the skip-on-empty guard, the detector that cannot fire, the `grep -c '^-[^-]'` deletion count), entered this time through **process identity** rather than through a predicate: the instrument was pointed at the wrong object, and the wrong object was healthy.

## Deleting one route file turned two gates red without touching the product — stale `.next/types` and an aborted `git add` (HO 665, Aug 2026)

HO 665 deleted a single 34-line orphaned API route, `app/api/race/[id]/hub/route.ts`. The code change was as small as a change gets. Both of the gates around it still produced readings that, taken at face value, said something was wrong with the work — and neither had anything to do with it.

**`npm run typecheck` goes red on a file you just deleted, and the errors name that file.** Running it straight after the deletion produced three `TS2307: Cannot find module '…/app/api/race/[id]/hub/route.js'` errors — two in `.next/types/app/api/race/[id]/hub/route.ts`, one in `.next/types/validator.ts`. Next generates per-route type shims into `.next/types` at **build** time; `tsc --noEmit` reads them as ordinary sources, so after a route file is removed the shims outlive it and point at nothing until a build regenerates the set. The failure is therefore *about the previous build*, not the current tree, and it is signed as such if you read the paths: every error is under `.next/`, none under `app/`. **Gate order matters after a deletion — build first, then typecheck.** There is a genuine positive signal buried in it, worth taking rather than discarding: the shim's existence is independent evidence the route really was in the prior build manifest, which is exactly what the manifest check afterward was there to falsify.

**`git add` aborts on the whole command when one pathspec is already gone, and the commit that follows looks complete.** This project stages by **explicit pathspec, never a bare `git add`**, because sessions run concurrently against one working tree. Deleting a tracked file with `git rm` stages the deletion immediately. The natural next command — `git add -- <deleted-path> <edited-path>` — then fails with `fatal: pathspec '…' did not match any files`, because the deleted path matches nothing in the worktree. Git treats that as fatal for the **entire** invocation: the second pathspec, the one that mattered, is never staged. And the failure does not stop the commit, because `git rm` had already staged something — so `git commit` succeeds, and `git show --stat` reports a clean single-file commit that reads exactly like a correct one. The tell is only visible if you compare the stat against the *expected* shape (here: two files, not one) or check `git status` before committing. **The rule that protects against the concurrency hazard is what creates this one** — a bare `git add -A` would have caught both changes and never surfaced the error. The fix is not to abandon the pathspec rule but to stage the edits and let `git rm` own the deletion: name only the paths that still exist.

The shared shape is the reusable part. A deletion is the one edit that makes tools reference something that is no longer there, and the tools report it in the vocabulary of a broken build — a missing module, an unmatched path. Both readings here were **about the deletion having worked**, which is the opposite of how they read.

---

## HO 667 (2026-08-15) — a threshold guard treats "no sample" as "best possible sample", so an empty measurement prints a pass

**`(agg.max ?? 0) >= FLAG` inverts when the sample is empty, and the guard then confirms the thing it was built to catch.** Retiring the dashboard-lead step from `/api/sync` removed `payload.timings.lead` from every future `cron_runs` row. `scripts/diagnostic/sync-trades-margin-482.ts` §1 is a "lead regression guard": it maps the post-fix rows to their lead timings, filters out nulls, and asks whether the max crossed a threshold. Post-retirement that filter returns an **empty array**, `dist([])` yields a null max, `(leadD.max ?? 0)` becomes **`0`**, and zero clears both thresholds downward — so control falls through to the final `else` and prints:

> `✓ All post-fix leads < 5000ms — hint holding, HO 480/481 confirmed.`

A confirmation rendered by the **absence** of data. Nothing errored, nothing read null, and the line is indistinguishable from a genuine pass.

**The mechanism generalizes past this file, and it is not the same as a missing null check.** The `?? 0` is doing exactly what it was written to do — supply a neutral default — but "neutral" for a *coalesce* and "neutral" for a *threshold comparison* are opposite values. In a `>=` guard hunting for a HIGH outlier, `0` is not neutral: it is the **most-passing value in the domain**. Any guard shaped `(aggregate ?? IDENTITY) >= LIMIT` has this property whenever `IDENTITY` sits on the passing side of `LIMIT`, which for a max-based upper-bound check it always does. A min-based lower-bound check inverts identically with `?? Infinity`.

**The fix is to branch on the SAMPLE SIZE before comparing, not to change the default.** §1 now short-circuits on `n === 0` and says the step was retired — "not a pass and not a regression" — because there are three states here and the original code had two. Picking a different sentinel would only move which threshold gets falsely crossed.

**What makes this an entry rather than a bug report is how it was found.** The handoff's recon had classified that file as **prose-only** — three comment mentions, RECORD-and-stay — because it was located by grepping the *name*. The name-grep is a search over mentions; what mattered was the set of **readers**, and `timings.lead` was structurally consumed there: a required field on the `SyncRow["timings"]` type, a term in `residualOf()`, and §1's entire subject. Two files down the same list, `sync-timeout-verify-480.ts` was also carrying an unnoticed `payload.timings.lead` read at `:44`. **When retiring a field, enumerate its readers by type and by use, not by name** — the name-grep finds the comments and misses the consumers, which is the wrong half.

**And the corollary that decides what to do with the survivors: an instrument that measures a retired step is not neutral, it is a future false reading.** It will be re-run by someone who does not know the step is gone, and it will answer. The three diagnostics here needed three different answers — 482 a real guard change, 480 a header dating it to its window (its post-667 verdict is a false *negative*, `"NOT YET: only 0 in-band success tick(s)"`, which reads as a regression of a closed fix), and 479 the arm deleted outright. Filing them all as "RECORD, stays" would have left three instruments able to lie in two directions.

---

## HO 668 (2026-08-15) — a silently-failed kill makes a byte-identical gate pass by construction

**The failure mode: you compare the new build against the old build, except the "new" server is the old server, so you compare the old build against itself and `cmp` says identical.** HO 668's gate is a before/after `/electoral` render diff — the HO 603 shape, and exactly right for a CSS-only excision. The sequence that nearly certified nothing:

1. Start a server on port 3108, capture `electoral-pre.html`.
2. Kill it with `taskkill //PID <pid> //T //F | tail -1`, then check `netstat -ano | grep ":3108" | grep LISTENING`, which printed nothing.
3. Read "nothing" as *released*, edit the CSS, rebuild, start "the post server" on 3108, capture `electoral-post.html`, `cmp`.

Step 3's server **never started** — `EADDRINUSE`, into a log file nobody is forced to read — and the process from step 1 was still serving the pre-change build. The `curl` in step 3 would have been answered by the pre-change build, `cmp` would have reported **byte-identical**, and the gate would have certified the excision by comparing a build with itself. Every individual reading would have been true. The conclusion would have been worthless.

**Two independent defects, and the first is the general one.**

- **The kill's exit status was discarded by a pipe.** `taskkill … | tail -1` exits with `tail`'s status, always 0. This is the piped-command exit-status rule (SKILL, *Pre-flight verification*) landing on process management rather than on a build: **the command that was supposed to guarantee the precondition reported success unconditionally.**
- **The verification was an absence-of-evidence reading.** `grep LISTENING` printing nothing is consistent with *port released* and with *grep ran during a transient*, and the two are indistinguishable in the output. A check whose failure mode is indistinguishable from the condition it checks for is not a check.

**What caught it was a coincidence worth converting into a rule: the "new" server reported the SAME PID as the old one.** That is not a coincidence at all — a bind failure means no new process took the port — but nothing in the procedure required comparing them. **So: after restarting a server for a before/after comparison, assert the PID CHANGED.** It is one line, and it falsifies the entire class.

**Three fixes shipped, and the third is the one that survives a future procedural slip.**

- Kill **unpiped**, exit status read.
- Verify the port is down **positively and redundantly**: `tasklist` reporting *No tasks are running which match the specified criteria*, `netstat` empty, and a `curl --max-time 4` that must fail with **exit 7** (connection refused). Three instruments, one of which is an active probe rather than a passive look.
- **Give the gate a BUILD DISCRIMINATOR** — something in the response that differs between the two builds, checked before the comparison is trusted. Here: the served stylesheet hash had to move (`4e8dbc70…` → `788dc503…`) and the served bundle had to carry **0 `pdc`** against **5 `rdm-action`**. This is the durable one, because it does not depend on the operator having killed anything correctly: **if the discriminator does not move, the comparison is invalid no matter how clean the process hygiene looked.**

**The generalization: a before/after gate needs a way to prove the "after" is actually after.** A diff of two captures is evidence about the captures, not about the code — and it is at its most convincing precisely when it is measuring the same artifact twice, because then it is perfectly identical. Any such gate should carry a cheap assertion that the two sides genuinely differ *somewhere they must* (a build hash, a version endpoint, a deliberately-changed marker) before the identity of everything else is read as a result.

**Related, and worth keeping adjacent:** a normalization step that strips ~70% of the payload should itself be controlled. HO 668's normalizer removed scripts and the hashed stylesheet link, taking 821,768 bytes to 252,214; the compared remainder was checked to still contain real page markup (`cart-` 19, `race` 24) rather than an emptied shell. Two empty files also `cmp` identical.

## A freshness discriminator that *cannot* vary is not a weak check — it is not a check, and a literal reading of it HALTs a correct run (HO 669, Aug 2026)

HO 668's entry above ends with the right rule: a before/after gate needs a way to prove the "after" is actually after, and that proof should be a cheap assertion that the two sides genuinely differ *somewhere they must*. HO 669 inherited that rule as a concrete instruction — confirm the served stylesheet hash **differs** between the pre- and post-change builds, and treat a match as a HALT — and the instruction was wrong for the change it was guarding.

The change stripped a dead code branch out of a server component. Its own central claim was that **`app/globals.css` is untouched**, which was true and was proved structurally: the file contributes zero class tokens, so no selector can lose its last consumer. But Next.js content-hashes its CSS. Untouched CSS means byte-identical CSS means **the same hash, necessarily**. The discriminator was chosen from the *previous* HO's failure mode (a survived server serving the old build) without checking whether the artifact it keys on could move under *this* HO's change. It could not. So the specced HALT condition would have fired on a correct run, and — worse in the other direction — the discriminator would have been equally silent had the server genuinely been stale.

**The generalization: a discriminator has to be chosen against the change, not inherited from the last incident.** Ask of any freshness marker, before trusting it, "what would make this differ, and does my change do that?" If the answer is no, the marker is inert and must be replaced rather than reported as passing.

**The replacement instrument, which is the reusable half of this entry — prove freshness from a token the change actually REMOVES, with a control token that SURVIVES.** HO 669 asserted directly against the served build artifact: `.next/server` contained **0** files carrying `BARE_TAPE_EXCLUDED` and **0** carrying `bareTape` — the two tokens the change deleted — while the control token `placeholderSymbols`, which the change kept, still read **1**. Both halves are load-bearing. The zero alone is the same undiscriminating reading a wrong path or a typo'd token produces; the surviving control is what proves the search worked at all. This keys on precisely what the change did, so it *cannot* be inert the way a borrowed hash can.

**Port distinctness is not a substitute for it, and the distinction is worth keeping straight: the port proves TRANSPORT, the token proves the ARTIFACT.** A second server on a second port, both binds PID-verified and the first port confirmed free, establishes that the response came from a different *process* — which is exactly what HO 668 needed, because there the failure was a survived server. It says nothing about which *build* that process is serving, since a fresh process happily serves a stale `.next`. Run both: transport first because it is cheap, artifact second because it is the one that answers the question.

Note the asymmetry that makes the inert case dangerous rather than merely useless: an identity result reads as a **pass** in both stories. The gate here also passed *by construction* (both live mounts short-circuit before any touched arm, so the render could not have changed), which is fine to report — as long as it is reported as what it is. A gate that cannot fail and a discriminator that cannot vary, stacked, produce a green result carrying no information at all.

## `cron_runs.payload` nests the real payload one level down, so `p.timings` reads undefined on every row — pre- and post-change alike (HO 669, Aug 2026)

Reading `cron_runs` to confirm a pipeline step was removed looks like a one-liner: parse `payload`, check whether `timings` still carries the step's key. The envelope is `{ok, elapsedMs, payload:{timings, sync, …}}` — the column is named `payload` and its *contents* have a `payload` key. Reading `JSON.parse(row.payload).timings` therefore returns `undefined` for **every** row in the table.

That failure is invisible in the exact case it matters, because "no `timings` object anywhere" and "the step was successfully removed" print the same. The first cut of the HO 669 probe reported `timings=[—]` on all 24 rows and would have closed a WATCH on it. The rows *do* carry the data: pre-change ticks read `timings = {reportCatchup, sync, lead, trades}` with `lead` at 780–5,854ms.

The same probe carried a second, independent trap in one screenful: it classified rows against a deploy boundary by **string**-comparing an ISO instant to a space-separated timestamp. `"2026-08-15T18:01:04Z" >= "2026-08-15 21:44:33"` is **true**, because `T` (0x54) sorts above space (0x20) at the first differing byte. That silently flipped four known pre-change ticks onto the post-change side — i.e. it would have reported ticks that still carried the step as evidence the step was gone. (This is the same `'T' > ' '` mixed-format hazard HO 637 tracked in product code; it is just as available in a throwaway diagnostic, where nothing typechecks the semantics.)

**Both traps are caught by the same discipline and neither is caught by re-reading the code: a control on the same invocation.** Require a row that *must* show the thing being looked for — here, a pre-change tick printing a **numeric** lead — and refuse to trust any zero until it does. 15 of 16 pre-change rows printed one (the 16th being a `timeout` row with no timings at all), which is what made the 8 post-change zeros mean something.

**Keep the running count, because at this point the ratio is the argument.** Across HO 664–669 the tally stands at **thirteen instrument failures against zero code failures**: ten through HO 668, and three more in HO 669 alone — the payload-nesting read, the `'T' > ' '` boundary compare, and the void discriminator in the entry above. Every one of the thirteen was caught by a control, and not one was caught by re-reading the instrument's source, which always looks correct. The operational conclusion is not "be careful"; it is that **the default posture toward one's own measuring apparatus should be the same suspicion applied to the code under test** — budget for controls first, treat an uncontrolled zero as unread rather than as evidence, and expect the next failure to be in the ruler.

## A CSS-only marquee has a minimum content width, and the number appears nowhere in the CSS (HO 670, Aug 2026)

The seamless-loop idiom is `translate(0 → -50%)` over a track holding the item set exactly twice. It is seamless **only while each half is at least as wide (or tall) as the strip it runs in**; below that the two halves cannot cover the viewport and the loop shows a dead gap that reads as missing data, not as motion. Nothing in the CSS states the threshold, and nothing fails loudly when it is crossed — the animation runs perfectly, over a hole.

`/welcome` hit it on both axes in one build:

- **Horizontal.** MARKETS carries 11 symbols (~2,400px per half) and covers any desktop. ODDS carries 4 pairs (~900px per half), so at 1920 — a strip mask of ~1,750px — the right third of the row was empty. Fixed by **overshooting**: three copies per half (`ODDS_COPIES_PER_HALF`), ~2,700px, past any desktop.
- **Vertical**, and this one was *created* by the fix for something else. The panels were briefly grown from the spec'd 420px to fill the board (a fixed height had left a dead zone under the rows on tall viewports), which pushed the viewport past what the 5-row Patterns dataset covers — 10 rows ≈ 590px in a ~700px viewport, gap. Reverted to the spec'd fixed 420px, which **every** dataset covers, with `margin-top:auto` on the bottom rail so the slack on a tall screen lands below the board instead of inside a panel.

**The live tape does not have this bug and the reason is the general lesson.** `MarketsTapeClient` **measures** the rendered set and computes a repeat count (`:800–813`), so it adapts to any roster and any width. A server-rendered strip cannot measure, so it has exactly two options: **overshoot the content, or fix the viewport** — and if it does neither, the failure is silent and width-dependent, which means it will not appear on the machine that built it.

## The layout gates were all green and the layout was still wrong three times (HO 670, Aug 2026)

`npm run build` green, `npm run typecheck` green, `/welcome` 200, both stylesheets 200, all **nine** panel datasets present in the served HTML with every row matched, `TAPE_SLOTS`/`TapeItem` at 0 with a positive control reading 11. On that evidence the rebuild was shippable. It had three real render defects, and **every one was found by looking at a screenshot**: a ~300px dead zone under each panel's rows, an empty right third of the ODDS strip, and — under `prefers-reduced-motion`, where nothing scrolls — a top fade permanently half-erasing the first row's title and a bottom frost blurring the last.

Each is invisible to every gate that was run, and not because the gates were weak: a string is in the markup whether or not it is inside the visible box, and a mask that erases text does not change the DOM. **A content assertion answers "is it there", never "is it legible".**

**The tally inverts here, and that is the point of keeping it.** HO 664–669 ran **thirteen instrument failures against zero code failures**; HO 670's instruments were sound and the **code** was wrong three times. The two lessons do not compete — control your instruments *and* look at the artifact — but the operational rule for a layout change is the narrower one: **a rendered screenshot at more than one width is a gate, not a courtesy**, and the reduced-motion path needs its own capture because it is a different layout, not a dimmer one (the run measured 32 animating elements normally against **0** under `reduce`, with 3 dataset layers visible and 6 `display:none` — a discriminator that can fail, unlike "the media query is in the file").

## Two throwaway-instrument traps in one session: esbuild's `keepNames` and a build that typechecks untracked probes (HO 670, Aug 2026)

Neither is about product code; both cost a red gate on a clean change.

**`page.evaluate(() => …)` under `tsx` throws `ReferenceError: __name is not defined`.** esbuild compiles with `keepNames`, which wraps function declarations in a `__name` helper that exists in the *script's* module scope and not in the *page's*. Playwright serializes the closure's source and evaluates it in the browser, where the helper is undefined. The fix is to pass the body as a **string** — the failure has nothing to do with the code inside the closure, so reading it does not help.

**`next build` typechecks the untracked diagnostics.** A scratch probe carrying an unused `@ts-expect-error` red-lit `npm run build` on a commit the file is not part of. This is the same `tsconfig.json` `include: scripts/**/*.ts` exposure HO 669 filed as a QUEUED entry from the opposite direction — there a probe's `TS2532`s failed the gate, here a stale directive did — and it is worth noting that it fires on the **build**, not only on `typecheck`, so "I'll just run the build" is not a way around it.

## `npx tsx -e` cannot run top-level await — but the reason it looked like a silent no-op was my own `tail` (HO 671, Aug 2026)

A one-liner meant to null a single column read as if it had done nothing: `npx tsx -e "…await…" 2>&1 | tail -3` printed only `Node.js v25.5.0`, the write appeared not to have happened, and the tick that followed found nothing to do. **For a WRITE that is the worst possible failure mode — not "it failed" but "it is unclear whether it landed."**

Two separate things, and only one of them is the tool's:

- **The real error.** `tsx -e` transforms its input as `/eval.ts` in **CJS** output format, and esbuild refuses top-level await there: `Top-level await is currently not supported with the "cjs" output format`. The *same code in a `.ts` file* runs fine, which is why every committed probe in `scripts/diagnostic/` does. So `-e` is for expressions, not for scripts, and the workaround is a file — not a rewrite of the logic.
- **Why it looked silent, which is the transferable half.** The failure was reported in full: an uncaught promise rejection whose **first** lines carry the message and whose last lines are stack frames. `| tail -3` shows the frames. **Never `tail` a command whose failure mode is a stack trace** — the informative line is the first one; `head`, or no pipe at all, is the right instrument. The same pipeline had already hidden this once earlier in the session's family of probes, and it read as tool flakiness both times.

**The check that catches it costs one line and is the same one this file keeps arriving at:** make the write report its own effect — `rowsAffected`, then re-read the row and print it. The replacement script did exactly that (`UPDATE rowsAffected: 1`, `AFTER: {"summary_null":1}`, then the runner's own eligibility predicate re-run to prove the next tick would claim it), and the ambiguity disappeared. A write instrument that does not read back is not an instrument.


## `git check-ignore -v` exits 0 on a **negated** pattern, so "not ignored" reads as "ignored" (HO 672, Aug 2026)

HO 672 added a `scratch/` directory that git ignores and `tsconfig` excludes, with the directory's own README negated back in so the rule ships with the repo:

```
scripts/diagnostic/scratch/*
!scripts/diagnostic/scratch/README.md
```

The obvious check for the negation is `git check-ignore -v <path>`, and it answered:

```
.gitignore:55:!scripts/diagnostic/scratch/README.md   scripts/diagnostic/scratch/README.md
exit 0
```

Read at a glance — a matched rule printed, status 0 — that says **ignored**, and the negation had failed. It had not. `-v` documents that *"exclude patterns which are negated are also shown (prefixed with `!`)"*, and the exit status is about whether the command matched anything to report, not about whether the path ends up ignored. So the one flag added to make the answer legible is the flag that makes success and failure print the same shape, distinguished only by a `!` that is easy to read past when it is the thing you were hoping to see.

**The authoritative instrument is `git add --dry-run`**, which answers the question actually being asked — *can git stage this without `--force`?*:

```
$ git add --dry-run scripts/diagnostic/scratch/README.md
add 'scripts/diagnostic/scratch/README.md'      # exit 0 — negation works
```

**The transferable half is the family, not the flag.** This is the same shape as `| tail -3` on a stack trace (HO 671, above) and as a skip-on-empty guard going green: **a check whose failure mode is indistinguishable from the condition it checks for.** Three of the four instances now on record are about reading an instrument wrongly rather than about the thing under test, which is why the rule landed in `docs/method.md` § Gates as a class — *a gate you cannot fail is not a gate* — rather than as a fourth one-off note here.

The narrow, memorable form: **`check-ignore` reports which rule matched last; it does not report the verdict.** When the last matching rule may be a negation, ask git to do the thing instead of asking it what it thinks.

## `TaskStop` reports success without killing the detached child — and the tidier output design would have hidden the damage (HO 672, Aug 2026)

HO 672's prod measurement was a latency sampler: fetch `/welcome` every 20s across a window containing one known flush and one known idle tick. The window was revised twice, so the sampler was stopped and relaunched twice, and `TaskStop` answered both times with `Successfully stopped task`.

**It stopped the task wrappers. All three `node` processes kept running to their own end times.** For 45 minutes three clients hit the subject URL simultaneously every 20s.

**How it was caught, and it was nearly not:** the output file held **540 lines for 240 cycles**. The duplicates share `n` and share the timestamp to the millisecond — all three woke from the same absolute `setTimeout` target — but carry **different latencies** (`1681` / `1675` / `1866` ms on cycle 1), which is what proves three independent clients rather than a write-duplication bug. The copies-per-cycle histogram then dated each exit exactly: `3` writers for cycles 1–135, `2` from 00:40:01, `1` from 00:50:02.

**The damage was specific rather than general.** Concurrency was constant across the sensitivity slot, the clean positive and the clean negative, so those three readings are internally comparable and survived. But the two later negatives sat at **00:40Z and 00:50Z — the exact instants the load changed** — so a latency change there could not be attributed to cache state, and both were discarded. Half the negatives, lost to the instrument rather than to the phenomenon.

**The transferable half is counterintuitive, and it is why this is here rather than in a commit message: the neater design would have concealed it.** One shared append-only output file is what made the line count wrong and the contamination unmissable. Per-run filenames — the obvious tidy-up, and what a second pass would likely have "fixed" — would have produced three separate series, each internally consistent, each inflated by concurrent load, none showing any sign of the other two. The analysis would have run on one of them believing it was the only client, and every latency in it would have been wrong in the same direction with nothing to indicate it.

Two rules: **when a process is supposed to have stopped, verify that it stopped** (`Get-CimInstance Win32_Process | Where-Object CommandLine -like …` on this box); and **prefer the output arrangement in which contamination is visible over the one that is merely neater.**

Filed in `docs/method.md` § Gates as its fifth instance, and it is the first one there where **a tool lied about an action rather than about a state** — `check-ignore -v` misreports a verdict, `| tail` hides a message, but both at least did what they said. This did not.

## `git show --word-diff=color > file.txt` writes a diff with no change information in it (HO 672, Aug 2026)

The HO 672 SKILL diff was exported for review with `--word-diff=color`. The delivered file was **38,468 bytes containing 0 `[-old-]` and 0 `{+new+}` markers** — because in `color` mode git marks changed tokens with **ANSI escape sequences and nothing else**, and those are meaningless the instant the file is read as text rather than piped to a terminal. What arrives is the document's prose with no indication of what moved.

**It is undetectable by inspection, which is the whole problem.** The file is the right size, correctly named, contains the right document, and opens cleanly. The `-` lines in it look like removals and are markdown bullets in the content. A reviewer skimming it sees a plausible diff of a document with, apparently, nothing changed in it — and **an empty word-diff and a diff of a commit with no changes are the same bytes.**

Regenerating the identical commit with `--word-diff=plain` produced **38,313 bytes with 2 `[-` and 3 `{+`** markers (three edits, one a pure append, so it shows only additions). Same commit, same range, same file — the only difference is a format whose markers are text.

**Rule: when writing a diff to a file, use a format whose markers survive being written to a file** — `--word-diff=plain`, or plain unified. Never `--word-diff=color` into anything but a terminal. `git --no-pager` and `--color=never` do not help; the marker information genuinely is the colour in that mode.

It landed in `docs/method.md` § Gates as the sixth instance, and it earned that placement by occurring **inside the delivery step of the commit that closes the gate entry** — the export intended to let a reviewer read the change was itself a check that could not fail visibly.

---

## `git grep -c` counts matching FILES, not matching lines (HO 673)

A STEP 2 gate asked how many references to the retired `.v2f-sc-*` classes
survived in render code. The instrument was
`git grep -c 'v2f-sc-' -- '*.tsx' '*.ts' | wc -l`, which printed **2** and was
labelled "expect 0". The real answer was **3 lines in 2 files** — `-c` emits one
`path:count` line per matching file, so piping it to `wc -l` counts *files* and
silently discards the per-file counts it just computed.

The failure is mild in one direction and dangerous in the other: the number is
always ≤ the true occurrence count, so a grep like this **under-reports** and can
read 1 where there are twenty. It is the same class as the §Gates entry on
`grep -c '^-[^-]'` for deletions — a cheap instrument answering a *different*
question than the one asked, and returning a plausible small integer either way.

The re-run that gave the real answer classified rather than counted: 3 lines
total, **2 comments, 1 absence assertion** (`expect(await page.locator('.v2f-sc-card').count()).toBe(0)`,
which is a *correct* live reference — it asserts the class is gone), and
**0 render usages** — against a control confirming the `className` grep finds
surviving `v2f-` classes. "Zero occurrences" would have been the wrong claim to
make; "zero render usages, two comments and one absence assertion" is the true
one, and only the classified form distinguishes them.

**Rule: `git grep -c` for an occurrence count is wrong. Use `git grep -h … | wc -l`
for lines, or classify the hits when some of them are legitimate.**

---

## A capture that does not wait for a remote image disproves the feature it was taken to prove (HO 673)

HO 673's whole point was that the sponsor portrait is now visible without hover,
and the first capture sweep produced a screenshot of the panel showing an **empty
dark box** where the portrait belongs. The readings taken alongside it said
`photo=true, fallback=false` — the `<img>` was in the DOM and was not the initials
tile — so the numbers and the picture disagreed.

Neither was wrong. Portraits load from `congress.gov` over the network, the
harness screenshotted 500ms after opening the panel, and `.bxp-sponsor-photo`
carries `background: var(--bg-panel)`, so an `<img>` that has not painted is
indistinguishable from a deliberately dark tile. `onError` never fires — nothing
failed, it simply had not arrived. A follow-up probe with a 3.5s settle read
`complete: true, naturalWidth: 175`, rendered 80×94: the feature was working the
whole time, and the artifact retained as its proof showed it not working.

This is the visual-gate rule turning on itself. §Gates requires captures because
greps and 200s cannot see a layout — but **a capture is an instrument too, and an
under-waited one reads the same as a broken feature.** The fix is a
`waitForFunction` on `el.complete && el.naturalWidth > 0`, falling through when
the element is the initials `<span>` (nothing to load), before the screenshot.

**Rule: a visual capture of anything fetched over the network must wait for the
fetch, and the wait must have a defined pass for the no-fetch case.** Retaining an
under-waited capture is worse than retaining none: it is filed as evidence, and it
argues the opposite of what it was taken to show.

A second, duller instance sat next to it and is recorded because it cost two
debugging rounds: **`npm run build` while `next start` is running leaves the server
serving a hybrid tree**, which surfaced as `net::ERR_ABORTED` on a CSS chunk and a
`.bxp-sponsor-photo` that had vanished from the DOM entirely. Rebuild, then
restart — and re-check the port owner, not just that something answers.

---

## An unqualified alias in GROUP BY resolves against the joined table, and it produced a confident wrong answer (HO 674)

Characterising the 82 related-bill ids that do not resolve to a `bills.id`, the
first query was:

```sql
SELECT substr(x.related_bill_id, 1, instr(x.related_bill_id,'-')-1) AS congress,
       COUNT(*) AS n
FROM bill_related_bills x LEFT JOIN bills b ON b.id = x.related_bill_id
WHERE b.id IS NULL GROUP BY congress ORDER BY n DESC
```

It returned **`[{congress: "117", n: 82}]`** — all 82 in a prior Congress, which
reads as a complete non-finding: the corpus is 119th-only, so of course
references to older bills dangle. It is also **wrong**. `bills` has its own
`congress` column, and the unqualified `congress` in `GROUP BY` binds to **that
input column, not to the SELECT alias** — so every row grouped under a single
value. Wrapping the expression in a subquery and grouping on the derived column
gives the real answer: **119: 74 · 118: 6 · 117: 2.**

The two answers point in opposite directions. The wrong one says *nothing to see,
prior-Congress artifact*; the right one says **74 bills of the CURRENT Congress
are referenced but absent from the corpus**, which is a completeness gap and is
now a filed entry. The sample rows visible alongside the wrong aggregate
(`118-hr-1398`, `118-s-3763`) even contradicted it — the aggregate said 117, the
sample showed 118s — and that contradiction is what made it worth re-running.

This is the HO 535 `MISSED_CARVE_EXPR` gotcha in a second dress: there it was
`ORDER BY`, here `GROUP BY`, same rule — **an unqualified column in an ORDER BY
or GROUP BY expression resolves against the input tables before it resolves
against a SELECT alias.** The joined table only has to *contain* a column of that
name for the query to become silently wrong rather than an error.

**Rule: alias a derived grouping column to something no input table has, or group
on the expression inside a subquery. And when an aggregate and the row sample
beside it disagree, believe the sample.**

---

## The relationship-type value set has a capital-B variant that a straight equality misses (HO 674)

Congress.gov's related-bill `relationshipDetails.type` reads, corpus-wide across
10,254 stored rows:

| type | rows |
|---|---|
| `Related bill` | 6,187 |
| `Identical bill` | 3,454 |
| `Procedurally related` | 375 |
| `Public law contains the text` | 114 |
| `Contained in public law` | 100 |
| **`Identical Bill (Became Law)`** | **24** |

Note the **capital B** on the last one. It is the only value in the set that
capitalises `Bill`, and it is semantically a member of the `Identical bill`
family — so `WHERE relationship_type = 'Identical bill'` silently drops 24 rows
that a reader would expect it to include, and `LIKE 'Identical%'` catches both
while `LIKE 'Identical bill%'` catches only one.

Two of the six values (`Contained in public law`, `Identical Bill (Became Law)`)
**did not appear at all** in a 40-bill sample that produced 1,078 relationship
entries. They are rare-but-real tail values, and the tail is exactly where a
value set gets its inconsistent casing. A sample large enough to be convincing
about the common values said nothing about these.

**Rule: an observed value set from a sample is a lower bound on the value set.
Re-derive it at full scale before writing an equality against it** — and where a
family of values exists, match the family rather than one spelling.

---

## Pricing a job against a limit it never approaches (HO 674)

The full backfill was costed at **~1.5h** and took **~4h**. The request estimate
in the same breath was **24,505** against an actual **24,429 — 0.3% off.**

The difference is which number was measured. The request count came from counting
the corpus: bills with cosponsors, bills with related bills, pages at limit 250.
The wall clock came from dividing that count by the **rate limit** — 24,505 ÷
20,000/hr ≈ 1.2h — a limit the job never came near. Observed throughput was
**~2.1 requests/second ≈ 7,500/hr**, so the binding constraint was per-request
round-trip latency, not the quota, and the slice had already said so: 50 bills in
17.9s is 2.8 bills/sec, which extrapolates to roughly the right answer and was
available before the estimate was given.

**Rule: a ceiling is only a schedule if you are going to hit it.** Cost wall clock
from observed throughput — and prefer the throughput you already measured on a
slice over any headline limit. This sits beside *price before optimize*: the
quantity was priced properly and the duration was not, in the same sentence.

## A capture harness that never reached the page reported three clean greens (HO 675, Aug 2026)

The STEP 3 render gate ran 70 passes and reported **0 console errors, 0 non-200
stylesheets, 0 horizontal overflow** — and had not opened a single panel. Two
independent faults, either of which alone was enough:

**The trigger selector was unscoped.** `[role="button"][aria-expanded]` looked
specific. The only element it matched was the header's **mobile-nav toggle**, so
Playwright clicked the hamburger 70 times. The bill row's trigger is the same
shape (`BillRow.tsx:222`) but lives inside `li.feed-row`, and the page also
carries 24 `role="button"` topic-rail rows that use `aria-pressed`.

**The search returned nothing.** The harness filtered `/bills?q=119-hr-842`,
which reads like an id lookup. `buildFeedWhere`'s `q` clause does match on
`LOWER(id) LIKE`, but **`getFeedBills` passes `skipQ` and matches through
`bills_fts MATCH` instead** (`lib/queries.ts:229`) — so on `/bills`, and only on
`/bills`, a bill cannot be found by its id at all. `?q=Social Security` returned
231; `?q=842` returned 0.

Every metric the run printed was *true of the page it was on*. A page with no
panel has no panel errors, and its stylesheet loads fine. **The failure mode of a
zero-counting gate is that an instrument which never arrives is indistinguishable
from one that arrives and finds nothing.** The check that separates them is not a
better assertion, it is a **census**: count the things you expected to visit and
fail if the count is short. The harness now exits 2 unless `opened ===
readings.length`, and the message says every other number above it is meaningless.

Rule: **before believing a gate's zeros, make it prove it arrived.** A pass count
is not a nicety on top of the assertions — on this class of harness it is the only
assertion that can fail for the right reason.

## A `border` shorthand silently deleted a party token, and only the computed style knew (HO 675)

`.bxp-face-photo` and `.bxp-face-photo--fb` shared a rule setting
`border-bottom: 2px solid var(--pc)` — the party-coloured edge that is the whole
encoding of a grouped face strip. The `--fb` rule then set
`border: 1px solid var(--border-strong)` for its own hairline. **The shorthand
resets all four sides**, so every initials fallback lost its party edge.

Nothing in the markup showed it: same element, same classes, same `--pc` custom
property set inline and still resolving. The class list was correct. The variable
was correct. Only the **computed** `border-bottom-color` was wrong, reading
`rgb(31, 41, 55)` where a face with a photo read `rgb(59, 130, 246)`.

Two faces in the entire corpus have no `depiction_url`, so the defect's live
surface is about 5 renders in 219 — small enough that browsing would never have
found it and a screenshot might have been dismissed as a dark tile.

Rule: **when a shared rule sets a longhand and a variant sets the shorthand, read
the computed value, not the source.** And the reading needs a control from the
same instrument — the party colour of a *different* party on a working face is
what proves `rgb(31,41,55)` is a defect rather than what that token happens to be.

## A grid that reads as a ledger in the mock strands its own labels in the real container (HO 675)

`docs/design/mock-673-related-bills.html` lays each related-bill row out as
`grid-template-columns: auto 1fr auto` — id, title, relationship. Inside the
mock's ~560px isolation box that is exactly right: the labels align down the
right edge and the rows read as a table.

The real left column of the expand panel is **~880px at 1920**. The `1fr` title
column stretches to fill it, so a short title left its `RELATED` label floating
roughly **500px away** against the panel's right edge, with nothing in between
and no visual tie to the row it belonged to.

The mock was not wrong; it was **measured in a container the product does not
have**. The sibling element in the same mock — the promoted companion row — was
already flex, and it rendered correctly at the same width in the same capture,
which is what identified the grid as the cause rather than the panel width.

Rule: **a mock's layout primitive is scoped to the mock's container.** Before
transplanting one, check the width it will actually live at — and when a mock
contains two elements of the same kind built differently, the one that survives
the real width is telling you which to copy.

## `grep -c` against minified CSS counts lines, and minified CSS is one line (HO 675)

The built-CSS gate ran `grep -c "\.bxp-face[^a-z-]" app.css` per selector and got
**1** for all 21 new classes. That reads as "one rule each", which is plausible
and wrong: `-c` counts matching **lines**, the production stylesheet is a single
159KB line, so every present selector reads 1 and every absent one reads 0. The
instrument was a **presence test wearing a count's clothes**.

`grep -o … | sort | uniq -c` on the same file reports what is actually there:
`.bxp-face` ×1, `.bxp-face:focus-visible` ×1, `.bxp-face:hover .bxp-tip` ×1,
`.bxp-face-photo` ×1, `.bxp-face-photo--fb` ×2 — which is the reading that shows
the tip-reveal rule survived minification at all.

This is `git grep -c` counting FILES (HO 673) in a new costume, one HO later, and
it landed in the same section of the same gate. The generalisation both instances
share: **`-c` counts the container, not the thing.** Whenever a count is the
answer, use `-o` and aggregate, and say what one unit of the number means.

## Bounding a payload where the budget is known, and only there (HO 675)

The expand panel draws six cosponsor faces. `119-hr-842` has 338 active
cosponsors, so serialising the roster to the client would ship ~50KB of member
objects to render six 32×38 images. The apportionment therefore runs in the
**route**, and the payload carries the drawn faces plus the per-party totals.

The related-bill half looks like the same problem and is not. Its last filter is
against the agenda of the **one meeting the HEARING block chose**, and that
choice depends on `showMomentum` — a prop the route cannot see (`/stale` picks
the most recent hearing, every other surface the soonest current-or-upcoming). So
the route can promote, dedupe and order, but it cannot cut; the component
finishes it.

The asymmetry looks like an inconsistency in review and is a consequence of where
the deciding input lives. Worth writing down because the tidier-looking
alternatives are both wrong: bounding both in the route would filter against a
hearing that is not on screen, and bounding both in the component would put 338
member objects on the wire.

Rule: **push a cut as far upstream as the inputs allow — and no further.** When
two halves of one feature bound at different layers, the reason is which layer
first knows enough, and it belongs in a comment before someone "fixes" the
asymmetry.

