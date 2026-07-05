# CBT — Roadmap

> Where the dashboard is going. Looser than a handoff. Items here graduate to numbered handoffs in `docs/handoffs/` when they sharpen up. Polish lives in `docs/ui-plan.md`, not here.

## Framing question

**WTF is going on in Congress?**

That's what someone opens this dashboard to answer. The product positioning isn't "track bills" or "summarize legislation." It's "make sense of what's happening." Every theme below earns its place by serving that question.

This started as a personal sense-making project. The author is figuring out what's actually happening in Congress, building the tools they wished existed, then opening those tools to anyone else asking the same question. The dashboard prioritizes comprehension over coverage. Most existing trackers fail on that axis: they show every bill and help with none.

What answering it in 30 seconds looks like, as the home page the dashboard is building toward:

- Three sentences at the top summarizing the week, generated from the underlying data
- Stage funnel showing where bills are pooling right now (the bottleneck of the moment)
- Topic mix showing what's getting worked on versus ignored
- Top 5 movers (advanced this week), top 5 stalls (went quiet), top 5 in the news
- One historical anchor: pace versus the 118th at the same point in the term

The current home page (page 1 of 157 feed rows) buries the answer six clicks deep. Reorienting around this question gives the home-page redesign a concrete target instead of guessing what the dashboard summary surface should hold.

## Lenses on the framing question

Specific questions an analyst would ask. Each is a sub-cut of "wtf is going on." Add and edit freely; the doc gets sharper as this list grows.

### Noise vs signal

Filtering the noise is what makes the framing question answerable in the first place. Sub-questions, all unlocked by ceremonial classification:

1. What's the noise rate, by chamber, by month?
2. Who makes the noise (highest ratio of ceremonial to substantive bills)?
3. Is the 119th noisier than the 118th?
4. Does noise correlate with party, seniority, swing-district status, or seat-up year?
5. Are some topics noisier than others (health awareness weeks, defense recognition resolutions)?

Cuts 1, 2, and 5 ship as analyst views the day `is_ceremonial` lands in the table. Cuts 3 and 4 need historical or member-level data first.

### Other lenses (seeded, to expand)

6. Which sponsors recycled bills from the 118th and how many landed this time?
7. What's the freshman class focused on?
8. Who introduces the most bills that go nowhere?
9. Which committees are graveyards versus paths to floor?
10. Which bills are getting press right now and from whom?
11. What's the shape of activity over time (introductions per week, enactments per month, deaths per quarter)?
12. Which sponsors are up for reelection next cycle, and what's their pass rate?
13. Which coalitions does each member belong to (caucus memberships, union endorsements, advocacy alignments), and how does that align with their voting and sponsorship behavior?

## Site assessment

Snapshot from a fresh look at https://cbt-chi-silk.vercel.app on 2026-05-12.

What's working: six views established (feed, `/sponsors`, `/stale`, `/changes`, `/president`, `/watchlist`). 15,677 bills synced, daily cron landing at 02:48 MT, stable pipeline. Topic taxonomy renders cleanly as compact tags, stage indicators give immediate progress signal. The terminal aesthetic is consistent across pages.

What's noisy or missing:

- **Ceremonial pollution is loud.** Visual count of page 1: ~14 ceremonial rows out of ~100. Mother's Day, Cinco de Mayo, 200 years of Peru diplomacy, "National Day of Reason," AAPI Mental Health Day, Glioblastoma Awareness Day, Tardive Dyskinesia Awareness Week, National Nurses Week, Eliot L. Engel Post Office renaming, Roy A. Rutherford Air Traffic Control Tower naming, Martinsville Missile land speed record recognition, "National Small Business Week," "National Postpartum Awareness Week for Communities of Color," "Arthritis Awareness Month." Every analyst stat downstream is skewed by this.
- **Zero visualizations.** Pure list views. No topic-distribution charts, no time-series, no funnel, no comparison overlays.
- **No landing moment.** Home page is the feed. There's no "what should I know right now" summary; the framing question gets no answer surface.
- **No external context.** Bills exist in isolation. Nothing surfaces which got coverage, which are being whipped, which are tied to active news cycles.
- **No historical comparisons.** Can't see this Congress versus the 118th at a glance.

## Architecture

Lives in `SKILL.md` as the information architecture rule (snapshot → hub → sub-pages). Themes below reference that rule rather than redefining it.

## Themes

### 1. Bill signal: noise classification + similarity

Direct service to the noise lens, prerequisite for the framing question, highest leverage on the list. Without this, every downstream cut is polluted.

Ceremonial classifier: one additional Gemini classification at summarize time, stored as `is_ceremonial` boolean, hidden by default with a toggle. Folds into the existing summarize call so marginal cost is near zero (rough estimate ~$4 to backfill the 15,677 corpus, then cents per month going forward). Four of the five noise sub-questions become analyst views the day this boolean lands.

Similarity clustering: bills with near-identical structure share title templates and action patterns. v1 is rule-based regex on titles ("Resolution honoring the memory of ___", "Resolution designating ___ as National ___ Day", "To rename the ___ Post Office located at ___"). Becomes the "similar bills" sub-page link off the bill hub, plus a standalone duplicate-shaped-bills view that's useful on its own (shows the post-office-renaming champion, the awareness-week king). Embedding-based v2 deferred until regex proves insufficient.

Sequence: ceremonial first (one handoff, ~1 day). Similarity v1 second (one handoff, ~1 day).

### 2. Home page redesign

Promoted from a sequencing step to a theme. The current home is the feed; the future home is the answer surface for the framing question. The 30-second sketch at the top of this doc is the brief.

This blocks reports and graphs. Both want a dashboard surface that doesn't exist yet, and shipping either one before the home page redesign means rework.

Open questions: keep the feed as a sub-route (`/feed`) or push it lower on the new home? Pagination there or full-bleed list? How much LLM-generated prose at the top before it stops feeling honest and starts feeling like a generated newsletter?

### 3. Weekly reports

A report is a packaged answer to the framing question, generated on a cadence and saved as a snapshot. Different from a live view: it's a moment in time, has commentary, and is shareable as a URL or file.

Two cuts on day one:

Bill changes: what's new this week, what died (no action for some chamber-appropriate window), what advanced (stage transitions), what got revived. Aggregated counts plus a list of the most notable individual movements. Most of this is already computable from existing data; `/changes` is a real-time version of the same thing.

Most talked about: which bills got the most external attention (news mentions, social signal, press releases). Depends on the news signal theme below. Without that data, this cut can't ship.

Open scope before sizing: storage (MDX files in the repo versus a `reports` table), trigger (cron-generated Mondays versus on-demand), authoring (pure LLM versus template with LLM commentary versus hand-written with data injected), format (read-on-site versus downloadable). The Substack draft is effectively the manual prototype.

### 4. News signal: breaking news + media attention

External data ingestion. Pull bill mentions from news sources, tag them to specific bill IDs, store with timestamps. Two surfaces:

Breaking news: real-time ticker or banner showing bills that got coverage in the last 24–48 hours. The closest the dashboard gets to a Bloomberg-style headline feed.

Media attention column: per-bill count of recent mentions, shown on the feed row and in the expanded view. Surfaces which bills are quietly getting traction.

Source options: GDELT (free, comprehensive, noisy), NewsAPI (paid, cleaner, tighter limits), or direct RSS from Politico, The Hill, Punchbowl, Roll Call (controllable, fewer surprises, more setup). The matching is the hard part, not the ingestion. Bill IDs are matchable but most coverage references the marketing title or sponsor name. Plan on iteration.

Sequence: pick a source. Build the sync. Run match accuracy against a hand-labeled sample of 100 bills. Ship breaking-news first (lower bar for usefulness). Media attention column second once matching tightens.

### 5. Graphs and visualizations

The dashboard has no visual idiom yet. Adding graphs is a design decision before it's an implementation task. Pick the idiom once, apply it across views.

Candidate first charts, ordered by analyst payoff: stage funnel on the home page (single bar chart, surfaces the bottleneck of the moment), topic distribution faceted by chamber, activity over time stacked by topic, sponsor productivity scatter (volume versus pass rate) on `/sponsors`, 119th versus 118th laws-enacted comparison on reports.

Library question: D3 directly, Recharts, Observable Plot, or hand-rolled SVG. The terminal aesthetic argues for thin styling and tight control, pushing toward Observable Plot or hand-rolled SVG over Recharts' defaults.

Sequence: pick the library. Ship the stage funnel as the first chart on the new home page. Iterate. Apply the same component pattern to later charts.

### 6. Member legislative depth

Applies the architecture pattern (snapshot → hub → sub-pages) to the member entity. Hub is `/sponsors/[bioguideId]`, thesis is "what this person works on in Congress." Voting record, sponsored bills, committee assignments, badges. Race coverage lives at theme 7's surface and connects back via a header tag, not a hub section. Snapshot lives in the row dropdown on `/sponsors` and the sponsor expansion in the bill feed (couple of badges, current top donor, last notable vote, "view full profile" button).

External data, each a sync pipeline of its own: member bio and committees (Congress.gov `/member/{bioguideId}`, free, already in your auth), endorsements and affiliations (caucus rosters mostly public, union and advocacy endorsements scattered across org sites and press releases), donors (FEC bulk or OpenSecrets API), stock trades (Capitol Trades, Unusual Whales; confirm sources), district demographics (Census API).

Don't batch these. Each is roughly the scope of the original Congress.gov sync.

#### Header indicators (links out, not embedded sections)

Two flags belong in the page header next to the name and party, both clickable to theme 7's race surface:

- "Seat up 2026" (or whichever cycle) when applicable
- "Active campaign" when the member is currently in a contested cycle

These do not get sections on the deep page. Race detail lives on `/race/[id]`; the header indicator is the bridge.

#### Endorsements and badges

The smallest piece in this theme but the most legible at a glance. Powers lens 13 and turns member names on the feed into coalition signals ("this is a DSA-endorsed, Squad-aligned Dem" versus "this is a Freedom Caucus Republican").

Sourcing tiers, easiest to hardest:

1. **Caucus memberships.** Mostly public rosters: Progressive Caucus, New Democrat Coalition, Problem Solvers, Republican Study Committee, the identity caucuses (CBC, CHC, CAPAC). Freedom Caucus is semi-secret but tracked by journalists. Hand-enter the initial set if no clean API exists; refresh quarterly.
2. **Union endorsements.** AFL-CIO, Teamsters, SEIU, UAW, IBEW, NEA. Each org publishes their cycle endorsements; sync would scrape or hand-enter per cycle.
3. **Advocacy alignments.** DSA, Justice Democrats, Indivisible (left); Club for Growth, Heritage Action, Susan B. Anthony List (right); Sierra Club, Planned Parenthood, NRA (issue). Most scattered and per-cycle.

UI: badge component sits in the page header next to the name (top 2–3 by priority) and renders the full set in a dedicated row on `/sponsors/[bioguideId]`. A 10-badge member should not crash the feed-row layout.

Schema sketch: separate `affiliations` table keyed by `bioguideId`, with `org`, `category` (caucus, union, advocacy), `source_url`, `last_verified`. Don't fold into the bills schema.

#### Order

Member bio first (free, unblocks `/sponsors/[bioguideId]` detail pages and the seat-up header indicator). Caucus badges second (small, public, immediate visual payoff). Donors third (largest analytical payoff). Stock trades and broader endorsements after that.

### 7. Races

Separate surface from member depth so neither overcrowds the other. The bridge is the header indicator on the member page; the destination is `/race/[id]` (likely a state-district-cycle pattern like `/race/CO-08-2026`).

A race page answers: when is this seat up, who's running, what do the ratings say, what's the fundraising picture, what does the district look like. Electoral context for the legislator, not a competing thesis to "what they're doing in Congress."

External data:

- Race ratings: Cook, Sabato, Inside Elections (likely manual unless one has an API; quarterly refresh)
- Candidate roster: Ballotpedia or FEC filings
- Fundraising: FEC, can layer on the donor pipeline from theme 6
- District demographics: Census API
- Polling: 538 successor, or curated; harder to source cleanly

MVP race page: rating, seat-up year, top three candidates, link back to incumbent's bio. Ship that with mostly-manual data, layer automated sources in later.

Open question: which races warrant pages? All 435 House + 33–34 Senate seats per cycle is a lot. Tiered approach: full pages for competitive races (any rating not "safe"), stubs for safe seats showing just incumbent and cycle.

### 8. CCBT parity

CCBT lags CBT by every feature that shipped after the fork: `/stale`, `/changes`, `/president`, sponsor depth, sort dropdown, fluid layout, header rename. The longer the gap, the harder the port.

Three options: inline porting (every CBT handoff that ships, follow with the CCBT equivalent in the next session), batched porting (quarterly sweep), or selective porting (only features that pass a "this matters at the state level too" filter). Doing nothing is worse than any of these.

### 9. UI polish

Lives in `docs/ui-plan.md`. Not duplicated here. Pull from there when you want a polish session.

## Sequencing

Working order, subject to your priorities:

1. **Ceremonial classifier.** Cheap, immediately visible, unblocks every downstream stat including the home page summary.
2. **Similarity v1.** Builds on ceremonial. Same regex-on-title shape.
3. **Home page redesign.** Scoping conversation first, then handoff. Sketch the layout, decide what blocks live on it, decide what happens to the feed (sub-route or pushed down).
4. **First graph (stage funnel).** Picks the visual idiom. Lives on the new home page as the first concrete answer to the framing question.
5. **Reports format scoping.** Chat, not a handoff. Decide MDX versus DB, cron versus on-demand, authoring style.
6. **First weekly report (bill changes cut).** Ship with the "most talked about" section as a placeholder.
7. **News sync pipeline.** Pick a source, build, validate matching.
8. **Breaking news view + media attention column.**
9. **Most talked about cut goes live on weekly reports.**
10. **Member bio sync.** Unblocks `/sponsors/[bioguideId]` detail pages plus the "seat up" / "active campaign" header indicators.
11. **Caucus membership data + badge component.** Smallest, most public, biggest immediate visual payoff. Powers lens 13. Schema design here determines how union and advocacy endorsements layer on later.
12. **Race surface MVP.** `/race/[id]` stubs with rating, seat-up year, candidate roster, link back to incumbent. Header indicator from step 10 needs a destination; this is it.
13. **One member-depth pipeline (donors or stocks).** Pick by analytical value.
14. **CCBT port batch.**

That's roughly six months of work at a CBT pace if you ship 2–4 handoffs a week. Don't treat it as a plan. Treat it as one defensible order.

## What this doc isn't

- Not a deadline-bound plan. Order is logical, not calendar.
- Not a feature checklist. Items here are themes; handoffs are checklist work.
- Not where polish lives. `docs/ui-plan.md` owns those.
- Not a contract. Cross things off, reorder, kill items as the dashboard tells you what it actually needs.

## Status

> **As of HO 404 · 2026-07-02.** This block is the **source of truth**. Future updates edit this block, not memory or off-repo notes. *(**HO 404 full audit — the deferred "next full audit" is now done.** Foundation and Member depth were **re-derived against live prod state** (read-only sweep §1–§3), replacing the off-repo 95/90-baseline-plus-bumps: **Foundation held at 96** (structural plumbing sound — sync fresh, FTS/indexes intact, 0 unexpected BAD query plans, all base routes 200 — with two operational cron regressions logged as backlog loops rather than baked into the bar: summarize backlog growing + weekly-report erroring); **Member depth re-derived 99 → 98** (member surfaces are comprehensive — hub/votes/committees/trades/donor-split/crosswalk — but member→news is still unbuilt and the FEC by_size split is 463/530). **HO 398 folded** (race→news hub surface — see its "Also" note; the prior "not folded" flag is cleared). "Also" notes now run through **HO 404**; the old "prose reconciled through HO 382–386" high-water mark was itself stale and is retired. The HO 364 brand rename and HO 366/367 `/hearings` + `/members` header consolidations remain within-theme polish, accounted-for here. **P1 re-confirmed by this audit:** the Oklahoma-Senate wrong-incumbent FIT & FINISH item (open since Jun 12) is **still live** on prod (`S-OK-2026` → Lankford `L000575`), now with an added internal-impossibility smell (`members.next_election_year` = 2031 on the Armstrong row — an odd year no Senate seat elects in) — spec'd for a follow-on data-fix handoff, NOT fixed here; see backlog FIT & FINISH.)*

**Overall: ~98%.** CCBT (the Colorado sister project) is downstream port work, **not** a CBT roadmap theme — excluded from this figure.

| Theme | % |
|---|---|
| Foundation | 96 |
| Home | 100 |
| Visualizations | 97 |
| Weekly reports | 98 |
| News signal | CLOSED · obs layer live; race/mbr joinable |
| Member depth | 99 |
| Races | 99 |
| Committee activity / hearings | 98 |

**Baseline provenance.** Foundation (96) / Member depth (98) were **re-derived against live prod state in HO 404** (the full audit) — no longer the off-repo-through-HO-221 baseline. Foundation confirmed at 96 (plumbing healthy; two cron regressions logged as loops, not baked in); Member depth moved 99 → 98 (comprehensive member surfaces, minus the unbuilt member→news + the 463/530 by_size gap). See the "Re-derivation (HO 404)" note below for the evidence. **Home (98→99)** and **Weekly reports (95→96)** were bumped this pass for the committee-activity / hearings arc (the /dashboard-v2 On the Hill band touches Home; the weekly-report COMMITTEE ACTIVITY section touches Weekly reports). **Committee activity / hearings (98, new this pass)** is **effectively complete** — the full 263–269 arc shipped; the open remainder is the two banked items below. *(Prior pass: Home 95→98 + Visualizations 90→95 for the HO 230–234 design arc; Races 98 reflects HO 222–226.)*

**Shipped recently (HO 263–269, the committee-activity / hearings arc — effectively complete):** committee-meetings data layer (263) · standalone `/hearings` with grouped list + two-week Mon–Fri calendar (264 / 265) · `/dashboard-v2` On the Hill band (266, corrected onto v2 in 269 so it survives the `/` swap) · committee-detail + bill-hub meeting embeds reusing the list row (267) · weekly-report COMMITTEE ACTIVITY section, fallback variant — markup blocks at current stage, no VIA tags (268). *(HO 230–234 prior: the dashboard design pass; HO 222–226: /races LIST + district maps/modals.)*

**Also (HO 270–272), v2 refinements:** the `/dashboard-v2` races strip became a `HEARINGS | RACES` tabbed box with hearings the default tab (270/271) — superseding the standalone On the Hill band — plus a live `MOVES n` badge on the RACES tab (per-card `MOVED · <lean>`; `NEW` dark until the news→race join, 272). Refinements to the already-counted v2 Home + Races surfaces — **no theme-% change** (Home 99 / Races 98 unchanged).

**Also (HO 273–275), v2 coherence sweep — Home redesign now build-complete + coherent.** The `/dashboard-v2` surface was reconciled against the mock (`docs/design/dashboard-2col.html`): hearing meeting titles cleaned at render (273); race-card Kalshi/Polymarket odds party-normalized via the full candidate roster + battlefield/card-dot color reconciled to the incumbent party + MARKETS/SIGNALS tape labels pinned outside the marquee + a ±8% implausible-move tape guard (274); doc sweep (275). All v2 surfaces — hearings, races, tape, feed — now match the mock. **Home held at 99, not bumped to 100:** the residual 1% is the v2→`/` swap, now gated **solely on the `/dashboard-v2` cold-start 500** (backlog OPEN LOOPS, BLOCKER — the HO 238 fan-out cold-abort `/` would inherit on the swap), **not** on any remaining coherence gap. No other theme-% change.

**Also (HO 277–280), outage-fixing arc — swap blocker CLEARED.** The `/dashboard-v2` "cold-start 500" turned out to be the **gated-aggregate mis-plan** class (a summary-gated fat-`bills` aggregate the statless Turso planner drops onto `idx_bills_is_ceremonial`, slow even warm), the same root cause behind live 500s on `/members` (277) and `/bills` (279). All fixed with additive covering/partial indexes + gated `INDEXED BY` hints (280 doc sweep). **Cold-verified:** `/members` 0.885s, `/dashboard-v2` 5× cold 200, `/bills` 0.705s first-hit-after-idle. **Home stays at 99** (the swap hasn't shipped), but its residual 1% — the v2→`/` swap — is now **UNBLOCKED and actionable** (backlog QUEUED), no longer blocked on the cold-start 500. Home → 100 when the swap ships. No other theme-% change.

**Also (HO 281–294), v2 polish — the B-series tweaks + the B2 tape arc.** Header type scale (281: title 26 / nav 16 / active amber underline, ≥701px), the v2 HEARINGS|RACES tabbed-box height/overlay fix (282), the WeeklyBand WoW deltas + a fourth HEARINGS metric + per-metric hover popovers (283/286), the chip-family additive tokens + shared `<SourceTag>`/`<MicroTag>` (287), and the **B2 markets-tape arc** (288–294): MARKETS gained five equities (NVDA/AAPL/MSFT/GOOGL/LMT) + CPI/UNEMP (MO badges); the second strip became **ODDS** — prediction-markets-only (shutdown · Fed-cut · recession, all dual-source K/P); counter-scroll + edge-fade; a curated policy-hook hover line; and the hover box portaled + re-anchored to pop over the ticker. Out-of-band: the weekly-report cron made reliable via a daily catch-up (284/285). All of this is v2 polish on the already-counted Home surface plus the shared WeeklyBand/header (both render on `/` and `/dashboard-v2`) — **no theme-% change; Home held at 99** pending the still-unshipped v2→`/` swap (the residual 1%, backlog QUEUED). The existing id/topic/stage/party chip migration is queued into a **B6 arc** (chip-family spec; 287 shipped only the additive half).

**Also (HO 296–303), v2 feature-complete — the B6 feed-row arc + the B2 tape update.** The **B6 arc (296–300)** rebuilt the `/dashboard-v2` feed as one shared `V2FeedList` row across MOVERS / TOP STALLS / NEW THIS WEEK (metric the only per-tab swap): collapsed rowhead with a sans title (297), the 6-node stage bar with a data-driven ping/park/complete current node (298), the expanded RELATED block (NEWS + omit-when-empty HEARINGS; ODDS dark — no bill↔market data, 299), and the sponsor hover card + meta column (300, which pushed the full sponsor enrichment onto the three v2 feed queries). This is the **first `--sans` use in CBT** (feed prose; mono stays for chrome). The **B2 tape update (301–303)** added a 4th ODDS pair **FED CUT SEP** (302, via new `kalshiEvent`/`polyMonth` symbol pins) and the **richer four-part hover box** + the symbol-amber/value-white tape convention (303); the 301 re-probe reaffirmed the data walls and banked a US-DEFAULT pair as the only honest debt-risk fill. **With this the v2 dashboard is FEATURE-COMPLETE** — no remaining v2 build work, only the swap. **Home held at 99**, not 100: the residual 1% is the still-unshipped **v2→`/` swap** (backlog QUEUED, now READY — open decision: replace `/` outright vs keep an archive route). No other theme-% change.

**Also (HO 311–314), the v2→`/` swap + the markets/reports arc — Home redesign SHIPPED.** **HO 311** made the v2 redesign the live home page: `/` now renders the DashboardV2Header + HEARINGS|RACES box + WeeklyBand + 49/51 body with the summary-gated count; the old `/` is preserved unlinked at `/dashboard-classic`, and `/dashboard-v2` permanently redirects to `/`. The shared stage funnel / topic treemap render in a new opt-in **`staticMode`** at `/` (read-only, no `?stage=`/`?topics=` rebasing — the page takes no `searchParams`); `/dashboard-classic` keeps full click-to-filter via a **`basePath`** prop. **This ships the Home redesign theme → Home 99 → 100.** The residual click-to-filter-parity-vs-static decision and the `/dashboard-classic` sunset are banked (backlog OPEN LOOPS), not blockers. Out-of-band, same arc: the **markets tape freeze** was diagnosed (313) as GitHub Actions scheduled-cron delivery (not a fetch failure) and fixed (314) with a reliable **Vercel daily cron floor** at 21:30 UTC; and the **reports-index-stale** report (312) closed as a **no-op** — it self-resolved when the HO 285 catch-up landed June 8 and revalidated, both bug hypotheses refuted by code. **Overall ~97 → ~98** with Home complete. No other theme-% change.

**Also (HO 316–317), the bill-row standardization arc — collapsed + expanded, both surfaces, COMPLETE.** **316** unified the topic chip into the shared bordered **`TopicChips`** (the dashboard feed + every `BillRow` surface; the lone borderless holdout is `/bill/[id]`). **317** unified the **expanded panel** into the shared **`BillExpandPanel`** (containing the one shared **`BillStageBar`**), rendered identically on the dashboard `/` and `/bills`, differing only in trigger — dashboard hover (`:hover`/`:focus-within`, box grows inline) vs `/bills` click — built to `docs/design/expanded-panel-unified.html`; the `/bills` collapsed title also moved to the sans face. **No theme-% change** — this polishes/unifies already-counted surfaces (Home is at 100; the `/bills` row touches the off-repo Foundation baseline, not re-derived). Banked from the arc: the rich HEARING slot, the dead-CSS sweep, touch-expand, and the `/bill/[id]` chip migration (backlog). No other theme-% change.

**Also (HO 319–321), the dashboard-row arc — interaction + row polish, COMPLETE.** **319** reverted the dashboard expand from the HO 317 hover model back to **click** (it was transient + dead on touch) — both surfaces now expand on click via `useSingleOpenPanel`. **320** restored the **distributions click-to-filter** on `/` (ported from `/dashboard-classic`, deferred at the HO 311 swap as `staticMode`): clicking a STAGE bar / TOPIC tile rebases the gated distributions + MOVERS + BREAKING, with `ActiveFilterStrip` — closing the HO 311 open loop. **321** made the collapsed feed row **two lines** (title over sponsor + `[party-state]` + chips), matching `/bills`. **No theme-% change** — all three polish the already-at-100 Home surface; `/dashboard-classic` untouched. No other theme-% change.

**Also (HO 328), the Members + Committees merge — one surface.** `/members` became a two-pane browser: a committee rail (the former `/committees` index — that route now `redirect("/members")`) + the member list, the chamber filter driving both panes, click-a-committee scoping the roster, per-member topic-mix bars (`MemberTopicBar`), and an UPCOMING HEARINGS rail group. The HO 152/197 productivity scatters were dropped (`getSponsorProductivity` + `SponsorProductivityRow` deleted, HO 330); a new `idx_bills_sponsor_topics` covering index serves the topic-mix bar. **Member depth 90 → 93** — the committee index, member roster, and per-member committee membership now read from one consolidated surface, with committees folded in from the retired standalone index. The member-expand cold-start 500 is under separate diagnosis (HO 329, fix pending). No other theme-% change.

**Also (HO 333), the Electoral consolidation — Races + Primaries → one surface.** `/races` + `/primaries` collapsed into a single **`/electoral`** surface (both 308-redirect in): the competitive map on top + a NEW primary-calendar **timeline band** below it (`PrimaryTimeline` + the `ElectoralBoard` wrapper), wired so clicking a timeline date paints that date's voting states amber on the map (selections accumulate / drop-on-reclick / CLEAR ALL; hover previews an outline). Sen+House COMBINED per date; data via the new **uncached `getPrimaryCalendar(2026)`** (no primaries cache tag exists, matches `getDashboardPrimaries`). The electoral GroupTabs sub-nav (HO 173) is retired; the nav item is relabeled **Electoral**. **State-click → the HO 225 district modal was KEPT** (Corey's call — a deliberate deviation from the handoff's "read-only map," preserving the district drill + HO 236/237 metro panels). The HO 226 primaries recency-map + its modal/scrubber are superseded by the timeline (`PrimariesMap`/`PrimaryDistrictModal`/`RacesMap` left unreferenced — backlog open loop). **Races 98 → 99.** No other theme-% change.

**Also (HO 346–352), the Patterns / Trends / Stale / Reports refinement arc.** **346** reframed the `/patterns` meta line as **LEGISLATIVE PATTERNS** with a new blurb; **347** replaced the `PatternBubbleSVG` bubble cluster with ranked horizontal bars (`PatternBars`, length = bill count, color = % past committee) that also absorbed the old ALL PATTERNS table; **348** added the collapsible **Filler Watch** strip (CEREMONIAL · NON-BINDING) between the meta line and the blurb, every number live-interpolated; **349** cut the redundant TOTAL INTRODUCTIONS line chart from `/trends` (the stacked-by-topic chart already carries that envelope). **350** reframed `/stale` as a **stage-led** surface — default PAST COMMITTEE (`floor`/`other_chamber`/`president`, enacted excluded), sorted legislative-stage-DESC then furthest-action-first, atop the 60-day floor — plus a curated procedural-housekeeping filter (frozen opening-week IDs + an `electing members%` live pattern + a blocklist) with an INCLUDE PROCEDURAL escape hatch and a committee-backlog footer; the ship build's 73s cold query was fixed in `339f8fc` (a CASE `ORDER BY` defeating the date index — oddities). **351** added a **filler-share bar** to the dashboard `WeeklyBand` (broad `is_ceremonial=1 OR cluster IN (four)` definition). **352** added a **stage-movements ladder** by destination stage to the weekly report. **Visualizations 95 → 97** (the `/patterns` bars + filler strip + `/trends` trim), **Foundation 95 → 96** (the `/stale` reframe), **Weekly reports 96 → 97** (the report stage ladder); Home held at 100 (the WeeklyBand filler bar renders on the already-complete home). **Overall holds at ~98** — these are within-theme refinements; Member depth (93) anchors the remainder. No other theme-% change.

**Also (HO 358–361), the Reports section arc + the multi-user landing — arc COMPLETE.** **358** added the weekly report's **Floor votes** section (after the 352 stage ladder): named decisive votes (bold verb · chamber · linkified bare-ID bill or `nominee → position` · margin · contested party split), procedural/amendment votes collapsed, recess states handled. **359** made **`/president` a real in-surface page** (its own `HeaderBar` + feed sub-nav + `StageLegend` + `BillRowList`, active tab marked) instead of the HO 151 `/bills?stage=president` redirect, so CHANGES/PRESIDENT/REPORTS all render in-surface. **360** added the **outcome-verb color rule** to `ReportMarkdown` (exact-text match, render-only — `content_md` stays plain bold). **Weekly reports 97 → 98** for the floor-votes section + color rule (the 352 ladder was already counted last pass — not double-counted; 359 is reports-surface chrome). Separately, **361** shipped **B1 — the `/welcome` split-layout landing** (cookie redirect from `/`, no middleware; live MOVERS/tape/readout reusing `/`'s cached queries; `signIn("github")`), **closing the multi-user arc (A1+A2+B1)**. That auth/landing arc (355/356/361) is **net-new direction, not one of the tracked themes** — no theme bar minted for it. **Overall holds at ~98** — within-theme reports refinements; Member depth (93) still anchors the remainder. No other theme-% change.

**Also (HO 363–365), the B2 tape restyle + the B5 week-strip redesign — dashboard polish.** **363** restyled the v2 two-tape stack (MARKETS/ODDS strip restyle + an inter-instrument pipe divider + even K/P pair spacing). The **B5 arc (364 probe + 365 build)** refreshed the `WeeklyBand`: a **middot-separated** strip with a dated `<MON DD> report →` link (most recent finalized report) + FILLER folded in-run (365 1/2, SHA `5524852`), and a **rich per-metric hover card** (`WeeklyBandMetricCard` — sparkline + breakdowns, replacing the flat HO 284 popover) backed by five new helpers + the canonical `MEETING_TYPE_BUCKETS` 9→3 map (365 2/2, SHA `eda88bc`). Window semantics are **trailing-7d**, not calendar week-to-date (a mock-inferred premise caught in plan mode — oddities). **No theme-% change — Home is already at 100** (these polish the shipped home redesign + the shared `WeeklyBand`/tape, both rendering on `/` and `/dashboard-v2`); the doc-sweep handoff's "bump the home-redesign %" had no headroom to bump. No other theme-% change. *(Flagged for their own pass, not folded here: the HO 364 brand rename — already reflected in SKILL's brand note — and the HO 366/367 `/hearings` + `/members` header consolidations.)*

**Also (HO 373–376), the B2 hover/tape arc — fit-and-finish on the markets tape.** **373** probed `market_ticks` history for a hover sparkline (read-only; settled the roll-stability/monthly-cohort/dead-symbol premises). **374** added a **7d sparkline + 1W delta** to the tape hover (gated ≥2 points / a 7d anchor; the monthly CPI/UNEMP cohort suppressed; odds spark reads the Kalshi series only). **375** fixed the hover-card clipping by switching to the shared `computeTooltipPosition` (measure + four-edge clamp + `preferBelow` to clear the masthead — HO 294's hardcoded 160px/grow-upward was the bug) and added the odds **`closes <MON DD>`** freshness line (the resolution date was already persisted as `market_ticks.market_date`, so render-only — no new store; replaced the redundant "prediction market" clause). **376** shuffles each scrolling strip's order once on mount (independent per strip, hydration-safe) and slowed the marquee ~1.75× (`SCROLL_SPEED_PX_S` 42→24). **No theme-% change — Home is at 100**; all four polish the already-shipped markets tape (renders on `/` and `/dashboard-classic`). A manual prod eyeball is owed (BotID blocks headless hover — backlog OPEN LOOPS). No other theme-% change.

**Also (HO 379, 382–386), the stage-correctness arc + the smoke harness — no theme-% change.** **379** stood up a Playwright route crawler (`e2e/smoke.spec.ts`, prod-default: per-page 200 / no-failed-request / no-console-error + targeted interactions), which caught a prod **filtered-view 500** hidden behind the `ct_seen` gate. **381/382** fixed it — not a logic throw but an unbounded corpus-wide scan on the index-driven filtered stage/topic distributions + the giant-`committee`-bucket feed (date-drive at `FEED_DATE_DRIVE_MIN`=2000). **383** made `computeStage(latest_action_text)` the deterministic **sole authority** for `stage`, written independent of summarization (so a stage advance no longer hides behind the summary-gated home bar), + presentment-queue priority + sync-side transition logging. **384** a one-off corrective stage backfill; **385** extended `computeStage` coverage rules + a 37-case unit suite under the locked floor-rung definition; **386** stripped the dead LLM `stage` output (summarize contract now `{topics, is_ceremonial}`). This is **correctness + test infrastructure, not new theme surface** — **Foundation held at 96** (the block's rubric bumps for shipped theme surface, not bug-fixes/harnesses; "don't invent movement"), **overall holds at ~98**. Residual loops banked/watched (CI-wiring, the ~75-bill `floor→committee` downward correction, the B-sync transition-logging soak, the FEED_DATE_DRIVE margin — backlog). No other theme-% change.

**Also (HO 388–390), the stocks-and-money arc — Member depth surfaced.** **388** probed the stocks/money sources: FMP congressional-trading is **healthy** (HO 70 rebuilt onto `/stable/{senate,house}-latest`, 548 rows, 0 unmatched, bioguide-keyed — NOT dead), while a donor **industry** rollup has no free classified source (banked). **389** shipped the corpus-wide **`/trades`** index — a `stock_trades` recency feed reusing `TradeRow` + a most-traded-tickers rollup, `?member=<bioguide>` scoping to one member, breadcrumb nested under Members. **390** added the **donor small/large-dollar split** (FEC Schedule A `by_size`, off the cached `fec_candidate_id`) beside `MemberFundraisingLine` on the member hub, riding `sync:fec` with **no new cron slot** (shipped `3e57740`, prod-verified, 463/524 populated). **Member depth 93 → 98** — the member surface now carries a dedicated trades index + a donor-composition cut. The **OpenSecrets-style employer/industry rollup stays banked** (no free classified replacement; would need our own classifier). No other theme-% change.

**Also (HO 392–395), the PAC-IE direction feature + the observation layer.** **392–393 (Races surface):** a **`PAC SPENDING`** line on race surfaces showing who a pro-Israel super PAC (UDP `C00799031`, AIPAC's affiliated super PAC; labeled "AIPAC SUPER PAC · via FEC") is **backing / opposing** per seat — **direction only**. Dollars are deliberately NOT rendered in-app (FEC Schedule E has no clean dollar source — the ~5× F24/F3X double-count, banked in oddities `fd8eb7c`); each direction **deep-links to the live FEC IE browser** instead. New `pac_ie_spending` table + manual `sync:pac-ie`. Within-theme Races overlay — **no theme-% change**. **394–395 (News signal):** the **news-as-observations pilot adopted + live** (`4fd9c9d`). `observations` + `observation_entities` are CBT's **entity-resolved news layer**: the news cron dual-writes one entity-resolved `observation` per fetched article alongside the unchanged `news_mentions` write, resolving people/orgs to `bioguide_id`/`system_code`/caucus-slug deterministically (LLM proposes names, code resolves IDs). Gate C closed on a deployed tick (+15 obs, 45.8s, 0 dual-write errors). **News signal was already CLOSED — no % to bump**; the layer's payoff is that **member→news and race→news are now buildable** (the store exists; `observation_entities` joins to `races` via `incumbent_bioguide_id`, EXPLAINs clean) — graduating race→news from "the wall every surface hits" to a queued surface (backlog). Several envelope fields (reliability/credibility/cluster_id/supersedes/schema_version) ride dormant as reserved constants. No other theme-% change.

**Also (HO 402), the member ID crosswalk — enabling infrastructure.** Two additive tables from unitedstates/congress-legislators (`member_ids` scalar external IDs + flattened `member_fec_ids`) now bridge `bioguide_id` → **ICPSR** (Voteview, ~60% native), **wikipedia_title** (pageviews, ~full), **GovTrack/LIS/OpenSecrets/Ballotpedia** titles, and the **authoritative FEC candidate-ID array** (money). One YAML sync (`sync:crosswalk`), run right after `sync:members`, gated on known bioguides so it can never invent a member; one read-only coverage diagnostic. Live coverage: 537/537 current matched (100%), icpsr 59.6%, wikipedia 99.8%, 605 distinct FEC candidate IDs. **ID crosswalk landed — Voteview/pageviews/FEC-money bridges unblocked.** It's **plumbing, not user-facing completion**, so **Member depth 98 → 99** (a single point; the annotation carries the weight — the surfaces that consume these bridges are still to build). Actionable output banked: 3 fuzzy-vs-authoritative `fec_candidate_id` disagreements (Gillen/Ivey/Self) feed a future `sync-fec` switch; `member_social` deferred (no consumer) — both in backlog. No other theme-% change.

**Also (HO 398), race→news on the race hub — within-theme Races add.** `5f26ee9` shipped `getRaceNews(incumbentBioguideId)` reading the **observation layer** (`observation_entities` join on `entity_type='person' AND entity_value=incumbent_bioguide_id` → `observations`), rendered as a NEWS section on `/race/[id]` (`RaceHubBody` + `RaceNewsRow`). This is the **first consumer of the HO 394 observation layer's entity join** — the payoff the layer was built for. **Scope is an honest v1:** race-hub page only (gated `!preview`, not the dashboard drawer), **incumbent-only** (by bioguide, so a challenger surfaces only if already a sitting member), open seats get the empty state, and **no member-hub news surface** (`getMemberNews` doesn't exist). So it **partially** discharges the banked "race→news / member→news surface": race→news (hub, incumbent) is DONE; member→news is still unbuilt (backlog). Within-theme Races overlay powered by the already-CLOSED news layer — **no theme-% change; Races held at 99** (incumbent-only v1 doesn't complete the theme). Live coverage at audit: 15 of the 2026 incumbents have ≥1 resolved person-observation, 70 observations / 65 entity rows total.

**Re-derivation (HO 404), the full audit against live prod state.** Read-only sweep (deploy SHA `7749de5` confirmed live; §1–§3 numbers in the HO 404 handoff). **Foundation held at 96:** plumbing is structurally sound — bills sync fresh (`MAX(update_date)` = 2026-07-02), `bills_fts` fully populated (16,623 == corpus), every forced `INDEXED BY` present, cold-start audit **0 unexpected BAD of 50**, all seven latency-watch routes 200 (warm 0.25–2.5s, `/changes` 0.25–0.76s well under its 8.5s fuse). The two blemishes are **operational cron regressions, not structural gaps**, so they're logged as backlog loops rather than dropping the bar: `/api/cron/summarize` intermittently timing out with the summary backlog **grown 1,011 → 1,374**, and `/api/cron/weekly-report` **erroring on its 06-29 run** leaving reports 2 weeks stale (latest = week-of Jun 15–21). **Member depth 99 → 98:** the member surfaces are comprehensive and live — hub (bio/committees/votes/badges/palestine/trades/donor-split), `/members` roster (552/537), `/trades` index, the HO 402 crosswalk (member_ids 537/537, member_fec_ids 605) — but two real gaps keep it off a near-complete score: **member→news is unbuilt** (HO 398 shipped race→news only) and the **FEC by_size split is 463/530** (the HO 390 rate-limited ~67 never self-healed). Canonical corpus counts settled this pass: "tracked" = `getCorpusStats(true)` = `(is_ceremonial=0 OR IS NULL) AND summary IS NOT NULL` ≈ **15,075**; the old five-number masthead incoherence is resolved (inner-page counts removed HO 323/326; only sunset `/dashboard-classic` still shows the ungated ~16,449). **Overall recomputed from the reconciled bars: ~98% holds** (96/100/97/98/98/99/98). No other theme-% change.

**Also (HO 405–413), the cron-reliability fixes + the senator-integrity arc — correctness, no theme-% change.** The two operational cron regressions the HO 404 anchor logged as backlog loops (not baked into Foundation's bar) both **shipped and cold-verified**, so **Foundation's HO 404 cron fuse is defused — the bar holds at 96** (never docked; the fuse only threatened a future dock if left unfixed): **`/api/cron/summarize`** doom-loop fixed (HO 405 probe / 406 fix, `82fb6bc` — partial `idx_bills_summarize_queue` forced `INDEXED BY` + a C=5 worker pool; one real prod tick 80 summarized/0 fail, the 1,374 backlog drained to 7), and **`/api/cron/weekly-report`** `gatherReportData` misplanners fixed (HO 407, `33cc707` — six `INDEXED BY` hints, the 4th appearance of the stateless-planner class; erroring cron #559 → #673 success 13.5s, stale weeks regenerated + catch-up hardened with a machine-readable `report-catchup-failed:` health field). Separately, the **senator-year integrity arc landed** (HO 408 `d234531` · 410 audit · 411 `db9d910` · 412 `a3a2a18`): the HO 404 anchor's "P1 still live" (`S-OK-2026` → Lankford, plus the `2031` impossible-year smell) **is discharged** — the underlying systemic drift it flagged (18/100 current senators on a wrong-anchor `senateTermStart`+6 derivation) root-fixed by deriving year-pairs from `members.senate_class` (residue-mod-6, `now`-relative), with the S-OK card corrected to appointee Armstrong, two phantom race rows deleted, 17 stale future-cycle cards self-healed by the `backfill:races` upsert, and a standing integrity audit committed as the regression guard. Per the block's rubric this is a **correctness fix, not new theme surface** (line: "bumps for shipped theme surface, not bug-fixes/harnesses") — so **Member depth held at 98 and Races held at 99**; the 17 corrected cards don't complete either theme, and the still-owed member→news + 463/530 FEC by_size gaps are what keep Member depth off a near-complete score. **Also notes now run through HO 413.** No theme-% change.

**Also (HO 414), member→news on the member hub — one of the two Member-depth-98 holds closed.** `3e7d1f1` shipped `getMemberNews(bioguideId)` reading the **same observation layer** as HO 398's race→news (`observation_entities` `person` join → `observations`), keyed on the member's **own** bioguide (no incumbent hop), rendered as a **`News · in the press`** section on `/members/[bioguideId]` (inline server fetch in the existing `Promise.all` + reused `RaceNewsRow`; the member page has no shared body/drawer, so **no `MemberHubBody` split** — the handoff's assumed split was moot). **Second consumer of the HO 394 observation layer** (race→news was the first, HO 398). Cold-EXPLAINed to the 398 covering-index path (`GROUP BY o.obs_id` didn't replan → no `INDEXED BY`); the new `member-news` cache tag is flushed by the news cron beside `race-news` **and** allowlisted on `/api/revalidate` (bogus-tag 400 control confirmed the allowlist entry genuinely took). Prod-verified: `/members/J000299` renders the 4-row section, low-profile members get the empty state. **Member depth held at 98, NOT bumped to 99:** this closes only **one** of the HO 404 audit's two Member-depth holds — member→news is now built, but the **FEC `by_size` split remains** (463/530 at the audit; the ~67 rate-limited members need a **deliberate** `sync:fec` run, not passive self-heal — backlog OPEN LOOP). The 98→99 bump waits until `by_size` is confirmed populated too; don't bump off member→news alone. **Also notes now run through HO 414.** No theme-% change.

**Also (HO 415–416), the FEC member-fundraising completion arc — Member depth 98 → 99.** The HO 404 audit's two Member-depth holds are now **both discharged** (member→news shipped at 414; the FEC `by_size` gap closed here), so **Member depth 98 → 99**. **HO 415 (`c36f0a2`), the by_size cycle-key fix:** `fetchFecBySize` hard-coded `cycle=2026`, but `schedule_a/by_size/by_candidate` keys to the candidate's **election cycle** — so off-cycle senators (Class 1/3, up 2028/2030) returned empty at 2026, which is the entire "463/530 coverage gap" (never rate-limiting, a keying bug). Fixed with `nextElectionYear ?? CYCLE` (HO 411's class-derived, specials-aware column — one source of truth); by_size **464 → 530**, `bysize_empty=0`. This answered the standing **HO 390** question — **there is no genuine by_size floor**; the whole "empty-for-valid-ID" bucket was the bug, 100% recovered. Carried the **rate-hardening** the 60/hr `K0Ue` key forced (cap-55 clean-exit / 1100ms pacing / `skipped_fresh` resume cursor). **HO 416 (`62b7f8e`), the `totals_failed` `candidate_id` sweep:** 2 departed members (Grijalva, Greene) dropped via an `is_current=1` filter on `fetchPendingMembers`; **8 House→Senate 2026 switchers** re-resolved to live Senate ids via a new `data/fec-candidate-overrides.json` (the 2nd resolver-consulted `data/` override after the specials file); Marshall re-resolved through the same override (a stale/live scoring-tie case); Zinke + Barrasso left as named no-action residuals (unfiled / upstream FEC gap). A **"Senate 2026 campaign"** tag on the fundraising line is **computed** from resolved id being S-prefix while `chamber='house'`. by_size **530 → 539**. Per the block's rubric these **complete the audit's two named Member-depth holds** (surface completion, not a bug-fix harness), so the bump is earned; the deferred member-scorecard arc (career vote participation + external scorecards) stays banked as the path to 100 — **not** closed here. **Also notes now run through HO 416.** No other theme-% change.

**Also (HO 418), housekeeping — no theme-% change.** Struck the stale metro-zoom panels (spec-3 Phase 2) entry from the Banked/unbuilt line: it shipped at HO 236/237 (backlog DONE) but the banked entry was never pruned, which had been feeding a stale "next feature = metro-zoom" pointer across session wraps. No feature shipped, no bar moved. **Also notes now run through HO 418.**

**Also (HO 419), the Voteview ideology data layer — enabling data, no bar move.** `da2745d` shipped the **member DW-NOMINATE layer**: a new `member_ideology` table (bioguide PK, `icpsr`, `nominate_dim1/2` + the Nokken-Poole per-congress variant, `number_of_votes`, `conditional`) populated from Voteview's `HS119_members.csv` by a manual **`sync:ideology`** (run after `sync:members` → `sync:crosswalk`, members-gated so it can't invent a member, max-`number_of_votes` dedup for a bioguide's multiple 119th rows, idempotent `ON CONFLICT` upsert), plus a shared `scripts/voteview-source.ts` fetch/parse helper (vendored quote-aware CSV parser — the `bioname` comma trap) and a read-only coverage diagnostic. It bridges **`bioguide_id` → DW-NOMINATE**: `nominate_dim1` is the headline economic left/right axis, `nokken_poole_dim1/2` the per-congress variant. **The join is on Voteview's native `bioguide_id`, not the HO 402 crosswalk's ICPSR bridge** — the "~60% via ICPSR" premise was measuring the wrong join and is retired (oddities). Coverage is essentially complete for current members who've cast a roll call (552 scored / 1 NULL-dim1 / 0 conditional). **No theme-% change — this is enabling data with no user-facing surface, and Member depth is already at 99** (100 stays reserved for the deferred member-scorecard arc). The **first ideology surface** — a member-hub ideology line, an ideology axis on the `SponsorProductivityScatter`, or chamber/party medians — is deferred to a follow-on (backlog QUEUED). It also surfaced a `members.party` data bug (Kiley reads `I`, is a Republican — backlog OPEN LOOP). **Also notes now run through HO 419.**

**Also (HO 421–422), the first ideology surface + the Kiley party finding — no bar move.** **HO 421 (`99de3c1`)** shipped the **first ideology surface** off the HO 419 `member_ideology` layer: a compact **DW-NOMINATE axis on the member hub** (`getMemberIdeology` + `MemberIdeology`), placed with the voting-record stats. It's a fixed **−1..+1** rail (comparable across members, not chamber-scaled) with the member's party-colored marker, both chamber party **medians computed app-side**, `dim1`/`dim2` numerics, and an empty state for the 1 member with too few votes. The axis is **vertically banded** — party medians as ticks above the rail (with a contrasting core), the member's identity as a caret below it, a 2% domain inset for near-edge markers — so a member sitting on their own party median stays legible (the on-median collision). **HO 422** is this doc sweep plus a **correction**: the HO 420 "Kiley party bug" is **NOT a bug** — Kevin Kiley (CA-03) genuinely **switched Republican → Independent on 2026-03-09** (both Congress.gov `partyHistory` and congress-legislators `party_affiliations` confirm), while **caucusing Republican**; `members.party='I'` is correct, and Voteview's `party_code=200` (R) follows **caucus, not registration** (oddities). So no code fix landed — the loop closes as diagnosed, and a small follow-up to teach the ideology diagnostic the caucus-vs-registration distinction is queued (backlog). **Member depth held at 99** (Corey's call): the ideology axis rides as enabling surface; **100 stays reserved for the member-scorecard arc.**

**Also (HO 424–425), the two chamber-ideology surfaces — no bar move.** Two more surfaces off the HO 419 `member_ideology` layer, both live, no new tables. **HO 424 (`127b798`), the dashboard chamber polarization band:** a new `getPolarizationBand()` (all four chamber-party `dim1` medians independent of any member — `getMemberIdeology` is member-chamber-scoped and returns only a pair, so it couldn't be reused) feeds a `PolarizationBand` server component placed full-width between `RacesBoxTabs` and `WeeklyBand` (the battlefield moved inside `RacesBoxTabs`' non-default tab at HO 270/271, so "below the battlefield" resolved to this always-visible slot). It extends the HO 421 positioned-tick rail (**divs + CSS**, not SVG) to chamber-aggregate scale: two chamber rails (HOUSE/SENATE) on a fixed −1..+1 domain (the 2% inset), D and R median ticks, an amber gap line spanning them, the gap magnitude as the hero. **HO 425 (`910f5c4`), the `/members` polarization dotplot strip:** a new `getIdeologyStrip()` (the full scored population, one cache entry) feeds `IdeologyStrip`, a client-island SVG Wilkinson dotplot (`binw 0.02`, party-colored, strict-D/R median ticks pinned to the band's method inline since a client island can't import the server `median()`, empty-center annotation, hover name + dim1 + hub, click-through), ~180px at the top of `/members`, server-scoped to the chamber toggle only. It's the **third live hand-rolled SVG chart** (`BillsTimeSeries`, `CommitteeActivityChart`, `IdeologyStrip`); the over-time chart (below, data-gated) is the fourth, where the shared scatter scaffold gets extracted. **The finding:** both chamber gaps read **0.92** on dim1 (House and Senate) — the "Senate is the calmer chamber" assumption doesn't hold on real data (oddities); cross-checked band-vs-strip, 0 `member_ideology.chamber`-vs-`members.chamber` mismatches across 552 rows, coverage 551 scored / 1 unscored. **Member depth held at 99** — these ride as enabling ideology surface, **100 stays reserved for the member-scorecard arc**; the **over-time chart (ship 3) remains, data-gated** on a per-Congress D/R chamber-medians sync (backlog). **Also notes now run through HO 426.**

**Banked / unbuilt:** **strong VIA-markup report attribution** (blocked, not deferred — `stage_changed_at` history began 2026-05-11, 52 committee→floor moves all-time, no markup-date alignment → 0 clean joins; HO 268 Gate A; revisit once the history matures) · **MARKUPS column on the reports index stat strip** (queued from 268 — needs a new persisted column + migration + backfill) · **MOVERS from→to display + hop-count sort** (gated on `stage_transitions` accrual, planted 2026-06-11) · ~~metro-zoom panels (spec-3 Phase 2)~~ (**SHIPPED HO 236/237** — dense-state CA/TX metro insets + leader lines; see backlog DONE. Extending the per-state config to more dense states is a fresh scoped item, not this banked one.) · ~~**race→news / member→news surface**~~ (**both halves SHIPPED** — race→news hub HO 398, member→news hub HO 414, off the HO 394 observation layer's `observation_entities` entity join; residual drawer/challengers + the dark HO 272 `NEW` badge tracked in backlog QUEUED) · **observation inert fields** (grading / cluster / lineage — activate when a second collector or a real consumer arrives) · **the_hill budget-starvation soak** (watch a few news ticks that politico runs long — confirm the_hill isn't systematically skipped; fix is per-feed budget carving, not a timeout raise) · primaries-map results-coloring (recency-only today) · rating-history sparkline (logging live since HO 220; chart awaits weeks of data).

**Owed eyeball:** **hearings LIVE state** — the ● LIVE badge (v2 band callout + `/hearings` list/calendar glyph) was never exercised against a real streaming meeting (0 live in every build sample); confirm it renders correctly the next time a committee meeting is actually live.
