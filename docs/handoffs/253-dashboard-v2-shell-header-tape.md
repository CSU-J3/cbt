# HO 253 — Dashboard v2: route scaffold + header + two-tape + two-column shell

Confirm the next free number before saving: `ls docs/handoffs/ | sort | tail`. Body assumes 253.

## What this is

First handoff of the approved Dashboard v2 redesign (source of truth: the `dashboard-2col.html` mock from the Design session). Strategy is a **separate route, not an in-place rewrite**: build `/dashboard-v2` as a new server component that reuses the existing query functions as-is, compose the new layout, and swap to `/` once it matches the mock. This handoff stands up the route, the stacked header, the two-tape, and the two-column body shell. The battlefield timeline and the rich race cards land in later handoffs into the slots this one defines; until then the races strip drops in the existing `CompetitiveRacesBlock` unchanged so v2 is functional from the first commit.

Do **not** touch `/` (`app/page.tsx`) or change the semantics of any existing query function. v2 reads through the same fns; any new read path is additive.

## Resolved premises (don't re-derive — a live diagnostic confirmed these this session)

- **Clean separation.** `app/page.tsx` (`DashboardPage`) is a server component that `Promise.all()`s discrete query fns from `lib/queries.ts` and passes results as props. No hooks; data access is importable. v2 is a sibling server component calling the same fns, no extraction needed.
- **Reuse inventory (existing fn → its current consumer):** ratings `getMostCompetitiveRaces()` → `CompetitiveRacesBlock`; candidates `getDashboardPrimaries()` → `CompetitiveRacesBlock`; feed `getStageChanges()` / `getStageChangesCount()` → `ActivityTicker`; tape `getLatestMarketTicks()` → `MarketsTape`; news `getBreakingNewsForHome()` / `…Count()` → `BreakingNewsBlock`. v2 imports these.
- **Two-tape data is fully wired (HO 251), no data work.** `getLatestMarketTicks()` already returns all eight v2 symbols. MARKETS = S&P / NASDAQ / 10Y / WTI; SIGNALS = SHUTDOWN (Kalshi `KXGOVTSHUTDOWN`) / FEDCUT (Kalshi `KXFEDDECISION`) / CPI (FRED `CPIAUCSL` pc1) / UNEMP (FRED `UNRATE`), all live via the markets cron. The two-tape is a presentation split of one existing feed.
- **Feed expand is already shared across tabs (HO 249).** `ActivityTabs` hosts movers / stalls / new; all three share `useSingleOpenPanel()` + `BillExpandedPanel`. v2's right column reuses `ActivityTabs` as-is, no parity work.
- **Only new token `--ticker-closed` (#9b3d3d) already landed (HO 234).** No new tokens here.

## Masthead count — pin ONE predicate, v2-wide (the decision 241 flagged but never landed)

The count is still divergent. The dashboard's `getCorpusStats()` counts non-ceremonial bills (~16.2k, summary or not) and matches the stage bars; inner pages' `getFeedStats()` via `buildFeedWhere()` add `summary IS NOT NULL` (~15.2k). A readout can't ship disagreeing with the pages it links to.

Decision: **v2 reads every corpus count through the summary-gated predicate** — the masthead total, its four segments (committee / floor / other / enacted), and the v2 body's stage-distribution and topic-distribution panels. One number across v2, and it agrees with inner pages. The bills v2 calls "tracked" are the bills you can actually open and read, which is the product. Leave `/`'s non-gated `getCorpusStats()` untouched; add a gated read path for v2 (or parametrize the existing count fns with a `summaryGated` flag) rather than mutating the live one.

If a reused body block (stage or topic chart) fetches its own non-gated data internally rather than taking it as a prop, either parametrize it for v2 or feed it gated data as a prop, so v2's headline, four segments, and body charts all sum to the same total. v2 must not re-fork the number internally.

## Build

**Route.** `app/dashboard-v2/page.tsx`, server component. `Promise.all()` the reused query fns plus the gated count read, then compose new presentational blocks; reuse existing body blocks where the mock matches (below).

**Header — stacked: masthead → two tapes → nav.**
- Masthead line 1: brand to the mock, then the gated stat readout `{total} bills tracked · {committee} in committee · {floor} on the floor · {other} other chamber · {enacted} enacted`. Number color tokens per the mock. Blinking amber cursor at line end, desktop only.
- Masthead line 2, on its own line under the readout (not pinned far-right): `LAST SYNC {h:mm} ET`, 11px text-dim.
- Type scale, three tiers: brand 20px / readout + nav 14px / tape + sync 11px.
- Nav text-only to the mock.

**Two-tape — two stacked marquees, each its own scroll.**
- MARKETS: S&P / NASDAQ / 10Y / WTI. Right-pin `AS OF h:mm · CLOSED`, `--ticker-closed` red on CLOSED. Keep the HO 234 closed-state + STALE precedence.
- SIGNALS: SHUTDOWN / FEDCUT / CPI / UNEMP. Green LIVE dot, no close state, never renders CLOSED (prediction markets run 24/7; the econ series never "close" either, so the strip as a whole has no market-hours close).
- Both read `getLatestMarketTicks()`, filtered into the two symbol sets. Reuse the existing `MarketsTape` marquee behavior; this is a split, not a rebuild.

**Two-column body shell — column ratio folds in Design delta 4: left 49%.**
- Full-width **races strip** directly under the header: drop in the existing `CompetitiveRacesBlock` unchanged (COMPETITIVE / PRIMARIES tabs). This is the placeholder the battlefield handoff replaces.
- **Weekly line** full width under the races strip, divider rule above: static counts, reuse the existing weekly metrics/teaser as it stands today.
- **Two-column body:** LEFT 49% holds the breaking box (reuse `BreakingNewsBlock`) above the tabbed STAGE | TOPIC distributions panel (reuse the existing stage + topic charts, gated per the predicate decision). RIGHT 51% holds the feed (reuse `ActivityTabs` with its shared expand). Columns natural height; the feed previews a few rows then `[ + N MORE -> ]` so the two columns finish near the same line.

## Constraints

- Desktop. Static except the two tape marquees and the masthead cursor. No new motion, no new tokens.
- Don't touch `app/page.tsx` or existing query semantics; v2 read paths are additive.
- Reuse the body blocks (breaking, stage, topic, feed) and `CompetitiveRacesBlock` rather than rebuilding them. Only the header, the two-tape split, and the column shell are new here.
- Mono for labels / IDs / counts / glyphs; UPPERCASE section labels.
- Named `git add` per commit, eyeball the diff. Stale `.next` rule on UI ships: verify the stylesheet asset loads (no 404 on `layout.css`); `rm -rf .next` + restart if the dev server's been up a while. `npm run build` clean at the end.
- Ship per the live-verify rule: `git push`, then `npm run verify:deploy` until the SHA matches before reporting shipped. v2 lives at `/dashboard-v2`; `/` stays the current dashboard.

## Ship report

Confirm: `/dashboard-v2` renders and `/` is unchanged. The masthead readout total, its four segments, and the body stage/topic panels all read the gated predicate and sum to the same number — state that number and confirm it matches an inner page. Two stacked tapes render; MARKETS shows the closed-state and SIGNALS shows the LIVE dot and never CLOSED. The races strip shows the existing `CompetitiveRacesBlock`. The two-column body at 49/51 finishes near level. Stylesheet loads; build clean; `verify:deploy` SHA matches.
