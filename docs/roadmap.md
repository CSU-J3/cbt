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

> **As of HO 315 · 2026-06-22.** This block is the **source of truth**. Future updates edit this block, not memory or off-repo notes.

**Overall: ~98%.** CCBT (the Colorado sister project) is downstream port work, **not** a CBT roadmap theme — excluded from this figure.

| Theme | % |
|---|---|
| Foundation | 95 |
| Home | 100 |
| Visualizations | 95 |
| Weekly reports | 96 |
| News signal | CLOSED |
| Member depth | 90 |
| Races | 98 |
| Committee activity / hearings | 98 |

**Baseline provenance.** Foundation / Member depth (95 / 90) are **last-known values maintained off-repo through HO 221** — **NOT re-derived this pass**; verify against live state on the next full audit. **Home (98→99)** and **Weekly reports (95→96)** were bumped this pass for the committee-activity / hearings arc (the /dashboard-v2 On the Hill band touches Home; the weekly-report COMMITTEE ACTIVITY section touches Weekly reports). **Committee activity / hearings (98, new this pass)** is **effectively complete** — the full 263–269 arc shipped; the open remainder is the two banked items below. *(Prior pass: Home 95→98 + Visualizations 90→95 for the HO 230–234 design arc; Races 98 reflects HO 222–226.)*

**Shipped recently (HO 263–269, the committee-activity / hearings arc — effectively complete):** committee-meetings data layer (263) · standalone `/hearings` with grouped list + two-week Mon–Fri calendar (264 / 265) · `/dashboard-v2` On the Hill band (266, corrected onto v2 in 269 so it survives the `/` swap) · committee-detail + bill-hub meeting embeds reusing the list row (267) · weekly-report COMMITTEE ACTIVITY section, fallback variant — markup blocks at current stage, no VIA tags (268). *(HO 230–234 prior: the dashboard design pass; HO 222–226: /races LIST + district maps/modals.)*

**Also (HO 270–272), v2 refinements:** the `/dashboard-v2` races strip became a `HEARINGS | RACES` tabbed box with hearings the default tab (270/271) — superseding the standalone On the Hill band — plus a live `MOVES n` badge on the RACES tab (per-card `MOVED · <lean>`; `NEW` dark until the news→race join, 272). Refinements to the already-counted v2 Home + Races surfaces — **no theme-% change** (Home 99 / Races 98 unchanged).

**Also (HO 273–275), v2 coherence sweep — Home redesign now build-complete + coherent.** The `/dashboard-v2` surface was reconciled against the mock (`docs/design/dashboard-2col.html`): hearing meeting titles cleaned at render (273); race-card Kalshi/Polymarket odds party-normalized via the full candidate roster + battlefield/card-dot color reconciled to the incumbent party + MARKETS/SIGNALS tape labels pinned outside the marquee + a ±8% implausible-move tape guard (274); doc sweep (275). All v2 surfaces — hearings, races, tape, feed — now match the mock. **Home held at 99, not bumped to 100:** the residual 1% is the v2→`/` swap, now gated **solely on the `/dashboard-v2` cold-start 500** (backlog OPEN LOOPS, BLOCKER — the HO 238 fan-out cold-abort `/` would inherit on the swap), **not** on any remaining coherence gap. No other theme-% change.

**Also (HO 277–280), outage-fixing arc — swap blocker CLEARED.** The `/dashboard-v2` "cold-start 500" turned out to be the **gated-aggregate mis-plan** class (a summary-gated fat-`bills` aggregate the statless Turso planner drops onto `idx_bills_is_ceremonial`, slow even warm), the same root cause behind live 500s on `/members` (277) and `/bills` (279). All fixed with additive covering/partial indexes + gated `INDEXED BY` hints (280 doc sweep). **Cold-verified:** `/members` 0.885s, `/dashboard-v2` 5× cold 200, `/bills` 0.705s first-hit-after-idle. **Home stays at 99** (the swap hasn't shipped), but its residual 1% — the v2→`/` swap — is now **UNBLOCKED and actionable** (backlog QUEUED), no longer blocked on the cold-start 500. Home → 100 when the swap ships. No other theme-% change.

**Also (HO 281–294), v2 polish — the B-series tweaks + the B2 tape arc.** Header type scale (281: title 26 / nav 16 / active amber underline, ≥701px), the v2 HEARINGS|RACES tabbed-box height/overlay fix (282), the WeeklyBand WoW deltas + a fourth HEARINGS metric + per-metric hover popovers (283/286), the chip-family additive tokens + shared `<SourceTag>`/`<MicroTag>` (287), and the **B2 markets-tape arc** (288–294): MARKETS gained five equities (NVDA/AAPL/MSFT/GOOGL/LMT) + CPI/UNEMP (MO badges); the second strip became **ODDS** — prediction-markets-only (shutdown · Fed-cut · recession, all dual-source K/P); counter-scroll + edge-fade; a curated policy-hook hover line; and the hover box portaled + re-anchored to pop over the ticker. Out-of-band: the weekly-report cron made reliable via a daily catch-up (284/285). All of this is v2 polish on the already-counted Home surface plus the shared WeeklyBand/header (both render on `/` and `/dashboard-v2`) — **no theme-% change; Home held at 99** pending the still-unshipped v2→`/` swap (the residual 1%, backlog QUEUED). The existing id/topic/stage/party chip migration is queued into a **B6 arc** (chip-family spec; 287 shipped only the additive half).

**Also (HO 296–303), v2 feature-complete — the B6 feed-row arc + the B2 tape update.** The **B6 arc (296–300)** rebuilt the `/dashboard-v2` feed as one shared `V2FeedList` row across MOVERS / TOP STALLS / NEW THIS WEEK (metric the only per-tab swap): collapsed rowhead with a sans title (297), the 6-node stage bar with a data-driven ping/park/complete current node (298), the expanded RELATED block (NEWS + omit-when-empty HEARINGS; ODDS dark — no bill↔market data, 299), and the sponsor hover card + meta column (300, which pushed the full sponsor enrichment onto the three v2 feed queries). This is the **first `--sans` use in CBT** (feed prose; mono stays for chrome). The **B2 tape update (301–303)** added a 4th ODDS pair **FED CUT SEP** (302, via new `kalshiEvent`/`polyMonth` symbol pins) and the **richer four-part hover box** + the symbol-amber/value-white tape convention (303); the 301 re-probe reaffirmed the data walls and banked a US-DEFAULT pair as the only honest debt-risk fill. **With this the v2 dashboard is FEATURE-COMPLETE** — no remaining v2 build work, only the swap. **Home held at 99**, not 100: the residual 1% is the still-unshipped **v2→`/` swap** (backlog QUEUED, now READY — open decision: replace `/` outright vs keep an archive route). No other theme-% change.

**Also (HO 311–314), the v2→`/` swap + the markets/reports arc — Home redesign SHIPPED.** **HO 311** made the v2 redesign the live home page: `/` now renders the DashboardV2Header + HEARINGS|RACES box + WeeklyBand + 49/51 body with the summary-gated count; the old `/` is preserved unlinked at `/dashboard-classic`, and `/dashboard-v2` permanently redirects to `/`. The shared stage funnel / topic treemap render in a new opt-in **`staticMode`** at `/` (read-only, no `?stage=`/`?topics=` rebasing — the page takes no `searchParams`); `/dashboard-classic` keeps full click-to-filter via a **`basePath`** prop. **This ships the Home redesign theme → Home 99 → 100.** The residual click-to-filter-parity-vs-static decision and the `/dashboard-classic` sunset are banked (backlog OPEN LOOPS), not blockers. Out-of-band, same arc: the **markets tape freeze** was diagnosed (313) as GitHub Actions scheduled-cron delivery (not a fetch failure) and fixed (314) with a reliable **Vercel daily cron floor** at 21:30 UTC; and the **reports-index-stale** report (312) closed as a **no-op** — it self-resolved when the HO 285 catch-up landed June 8 and revalidated, both bug hypotheses refuted by code. **Overall ~97 → ~98** with Home complete. No other theme-% change.

**Banked / unbuilt:** **strong VIA-markup report attribution** (blocked, not deferred — `stage_changed_at` history began 2026-05-11, 52 committee→floor moves all-time, no markup-date alignment → 0 clean joins; HO 268 Gate A; revisit once the history matures) · **MARKUPS column on the reports index stat strip** (queued from 268 — needs a new persisted column + migration + backfill) · **MOVERS from→to display + hop-count sort** (gated on `stage_transitions` accrual, planted 2026-06-11) · metro-zoom panels (spec-3 Phase 2) · race→news linkage (`news_mentions` is bill-keyed — the wall every surface hits) · primaries-map results-coloring (recency-only today) · rating-history sparkline (logging live since HO 220; chart awaits weeks of data).

**Owed eyeball:** **hearings LIVE state** — the ● LIVE badge (v2 band callout + `/hearings` list/calendar glyph) was never exercised against a real streaming meeting (0 live in every build sample); confirm it renders correctly the next time a committee meeting is actually live.
