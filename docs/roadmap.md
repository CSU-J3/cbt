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

> **As of HO 519 · 2026-07-25.** This block is the **source of truth**. Future updates edit this block, not memory or off-repo notes. *(**HO 519 — the 2nd full re-derivation** (the deferred "next full audit"), read-only §0–§5 against live prod `5681322`. **Structurally green:** sync fresh (17,027 bills == `bills_fts`), 14 crons healthy, the four fixed loops holding in steady state (summarize 406, weekly-report 407, `/api/sync` trailing-step 480/481 at 7% post-fix timeout, trades 483 p90 well clear), cold-plan audit clean (0 unexpected BAD of 50) — plus **9 post-404 queries spot-EXPLAIN'd by hand** to close the frozen-`cold-start-audit-332` coverage gap (the LDA / amendments / nominations / news-rail pillars postdate its inventory), every one riding its intended index. **Two ratified bar changes:** **News signal CLOSED → 98** (the "obs layer joinable" label under-sold a now richly-surfaced pillar — `/news` route + `?member=` + topic rail + member rail, race→news, member→news, the dashboard NEW badge), and a **new combined bar `Lobbying / amendments / nominations` = 92** (the 435–463 "extend downstream along the bill spine" arc, v1-complete across data + aggregate + detail + cross-links). **Overall ~98 → ~97**, recomputed from the reconciled 9 bars. **One data-integrity item cleared this pass:** the SC Graham seat change (HO 520) — replacing HO 404's now-fixed "P1 OK-Senate still live" line (that was resolved at 411/412; the new integrity finding this pass was SC, now also fixed via a routine roster re-sync, zero code). "Also" notes now run through **HO 520**.)*

**Overall: ~98%.** Recomputed from the reconciled **9** bars (96·100·97·98·98·100·99·98·92 ≈ 97.6) — nudged up from ~97 as **Member depth closed 99 → 100** (HO 526, the participation arc; see provenance). The HO 519 re-derivation had eased it to ~97 when News became a number (CLOSED→98) and the new 92 pillar bar joined the average. CCBT (the Colorado sister project) is downstream port work, **not** a CBT roadmap theme — excluded from this figure.

| Theme | % |
|---|---|
| Foundation | 96 |
| Home | 100 |
| Visualizations | 97 |
| Weekly reports | 98 |
| News signal | 98 |
| Member depth | 100 |
| Races | 99 |
| Committee activity / hearings | 98 |
| Lobbying / amendments / nominations | 92 |

**Baseline provenance.** Foundation (96) / Member depth (98) were **re-derived against live prod state in HO 404** (the full audit) — no longer the off-repo-through-HO-221 baseline. Foundation confirmed at 96 (plumbing healthy; two cron regressions logged as loops, not baked in); Member depth moved 99 → 98 (comprehensive member surfaces, minus the unbuilt member→news + the 463/530 by_size gap). See the "Re-derivation (HO 404)" note below for the evidence. **Home (98→99)** and **Weekly reports (95→96)** were bumped this pass for the committee-activity / hearings arc (the /dashboard-v2 On the Hill band touches Home; the weekly-report COMMITTEE ACTIVITY section touches Weekly reports). **Committee activity / hearings (98, new this pass)** is **effectively complete** — the full 263–269 arc shipped; the open remainder is the two banked items below. **HO 519 re-derivation (#2):** the canonical tracked corpus grew 15,075 → **16,657** (`getCorpusStats(true)`); **News signal was promoted CLOSED → 98** (a now richly-surfaced pillar — `/news` route + rails + race/member hubs — not an excluded thread; `98` because the residue is gated/inert, not active gaps); a **new combined bar `Lobbying / amendments / nominations` was minted at 92** (the 435–463 downstream arc, v1-complete data + aggregate + detail + cross-links, with real banked gaps); every other bar **held** (the 113 HOs since 404 were chrome/infra/enabling, self-declared no-bar-move and confirmed in aggregate by the §1/§2 green audit); and the **SC Graham data-integrity item was cleared** (HO 520, roster re-sync + `backfill:races`, zero code). Overall eased ~98 → ~97 across the 9 reconciled bars. **Post-audit bar move (HO 526):** **Member depth 99 → 100** for the participation arc (B1 chamber-median context, HO 523 + B2 career-votes rollup, HO 525); the **"external scorecards"** half of the old Member-depth hold is **reframed** from a hold to **optional breadth** — USCPR already ships on the hub, and the HO 522 probe established broader scorecards are a maintenance-appetite choice, not a capability gap (VoteSmart NO-GO on access; LCV / Heritage viable-but-unbuilt). This is **one tracked bar move on top of the HO 519 re-derivation, not a new audit** — the anchor stays "As of HO 519", and this clause resolves any apparent table-vs-anchor drift. *(Prior pass: Home 95→98 + Visualizations 90→95 for the HO 230–234 design arc; Races 98 reflects HO 222–226.)*

**Shipped recently (HO 263–269, the committee-activity / hearings arc — effectively complete):** committee-meetings data layer (263) · standalone `/hearings` with grouped list + two-week Mon–Fri calendar (264 / 265) · `/dashboard-v2` On the Hill band (266, corrected onto v2 in 269 so it survives the `/` swap) · committee-detail + bill-hub meeting embeds reusing the list row (267) · weekly-report COMMITTEE ACTIVITY section, fallback variant — markup blocks at current stage, no VIA tags (268). *(HO 230–234 prior: the dashboard design pass; HO 222–226: /races LIST + district maps/modals.)*

The "Also (…)" changelog is append-only and the pointer is frozen-per-block. Close an arc by adding a new block — which carries its own `Also notes now run through HO N` — never by editing a prior block's clause or its pointer. Each block freezes its `run through HO N` at append time, so the "running pointer" is simply whichever block is last: every distinct `run through HO N` appears exactly once, monotonic. A doc sweep therefore adds a pointer via its new block and touches no earlier one — a sweep's grep gate expects the previous block's pointer to still read 1, not 0. Mis-bumping a prior block both duplicates a pointer and violates the append-only rule (the HO 518 §1b near-miss; the HO 418/429 precedent). **A CORRECTION block is the one exception and carries NO pointer** — it corrects earlier blocks rather than closing an arc, so there is no new N to run through, and appending one with a pointer duplicates the N the block above already froze (HO 597 did exactly that; the fix was to strike the clause from the correction block, which is legitimate because a block appended in the same session by the same HO is not settled history — the prohibition protects *prior arcs'* blocks). State the decline explicitly (*"No pointer advance — … the pointer stands at HO N from the block above"*) so a later reader can tell a correction block from one that forgot its pointer.

> **Archived:** the blocks before HO 780 are in `docs/roadmap-archive.md`, verbatim and in order.

**Also (HO 780), Louisiana's runoff box: once Ballotpedia posts a seat's Dec 12 contest as a General election box, its candidates publish as Advanced, and the page keeps Runoff Dec 12 until that box carries a mark. It opens with HO 779's FF go as taken.**
- **What's here:**
  - HO 779's FF go as taken;
  - STEP 0, with its measurements;
  - § 1, the roster, and § 2, the result;
  - legs 0 to 4, and the two runs before the one that stands;
  - the FF go's commit: the two lines it files, the stub sentence after election day and the news ages' clock.
- **Six commits, kinds unmixed:** `feat` · `feat` · `diag` · `docs` · `docs(skill)` alone, then the FF go's `docs` (the two lines).
- **No prod write.** Prod was read by `SELECT` only: STEP 0, the plants' row shapes, and each seed.
- **The pointer is 780:** pointer 779, highest HO in commit subjects 779, `main` at `bae5790`.

**HO 779's FF go, as taken** (`docs/handoffs/779-artifacts/ff/paste-779-ff.md`).
- **Production before the FF** (2026-10-13 01:40:20Z, serving `0d53dae`): S-AL, WI-07 and MI-10 read RETIRING, and AZ-05 and FL-19 NOT ON THE BALLOT. `/electoral` held 27 tags (SENATE 6, HOUSE 21). The 18 `senate` and `moved` cards, `/`'s 4 tags and `/welcome`'s 14 were kept for the comparison, and no page carried `data-incumbent-outcome`.
- **The FF:**
  - immediately before it, the cold build (01:41:20-01:42:26Z, exit 0, *Compiled successfully in 25.2s*, no warning line) and the cheap gates (green);
  - then `0d53dae..bae5790`, 6 commits, no force (01:42:58Z). The classifier didn't block it;
  - `779-review` deleted, remote and local (`779-review-local`), and `main` reads `bae5790bddd3…`.
- **`verify:deploy`, in the foreground:** matched at 21s, five consecutive reads at 62s.
- **The Production build,** `dpl_AL35NpGpmrE7TrfgMAuAFshQB9Pm` (`bld_epp46m0da`, iad1), skipped the build cache: *VERCEL_FORCE_NO_BUILD_CACHE is set so skipping build cache step.* at 01:43:03.670Z. It compiled in 8.3s and went READY at 01:43:49.957Z. Its log, read whole in two windows, held no Next warning line.
- **Both of Vercel's records came at most 1s after READY:** the Preview's (7024604378) at 21:41:00Z against READY 21:40:59.955Z, and Production's (7027980633) at 01:43:50Z against READY 01:43:49.957Z. The Vercel line closes on them (below).
- **`e2e-prod`:** the Production record fired #38333516212 (01:43:52Z): `smoke` **141 passed (5.5m)**, all 39 crawl lines clean. Nothing was dispatched.
- **The flush,** after `smoke` ended: `POST /api/revalidate?tag=races`, Bearer `$CRON_SECRET` by name, HTTP 200 at 01:51:00.651Z.
- **After the flush** (01:51:06Z, serving `bae5790`): **8 PASS, 0 FAIL.**
  - The five cards read RUNNING FOR GOVERNOR: `governor`, unlinked, in `.micro-tag`, with no qualifier.
  - `/electoral`'s 27 tags equal the before reading but MI-10's, RETIRING → RUNNING FOR GOVERNOR.
  - No `data-incumbent-outcome` on `/electoral`, `/`, `/welcome` or the 18 pages, 0 of 68 tags with an outcome word, and AL-01 reads RUNNING FOR SENATE → `/race/S-AL-2026`.
  - The 18 cards, `/` and `/welcome` equal the before reading.
- **Named:** nothing was read between the deploy and the flush, so the go's premise (a cached value that predates the governor kind) went unread. This HO files it as the flush line.

**STEP 0** (a check, HO 768's rule), 2026-10-13 02:45Z: **all five hold.**
- **1:** `main` is `bae5790`, its Production smoke passed (#38333516212), and after the `races` flush Production read 8 PASS, 0 FAIL.
- **2:** `planBallotRoster` publishes `advanced` only in a top-two or top-four state (`lib/harvest-challengers.ts:356`, `:370`). Elsewhere a D or R row is `won_primary` when `primary_marked`, else `nominee`, and every other printed row is `on_ballot` (`:376` on).
- **3:** `JUNGLE_FROM_WHERE` (`:223-232`) leaves out every race with a `box` read: its `json_each(?)` is the plan's `boxRaces`.
- **4:** in `boxKind`, a general box's `<h5>` says *general election* and neither *primary* nor *runoff* (`lib/general-ballot.ts:163`); a *Nonpartisan primary* box is `primary-kept`, contest `open` (`:166-174`); a *runoff* label is `runoff` (`:175`). `primary_marked` is a kept primary's winner mark (`:567`, `:598`; the model's `primaries` are the section's `primary-kept` boxes).
- **5:** `resultFromRows` reads the box first whenever the read is `box` (`lib/race-result.ts:88-117`), and the jungle only otherwise (`:118` on). `raceResultView`'s decided header names election day (`:170`), and its runoff label the jungle row's `runoff_date` (`:169`). `/electoral`'s `readRaceResults` hands the rated seats to the same function, jungle rows included (`lib/electoral-general.ts:624-680`).
- **The measurements** (`docs/handoffs/780-artifacts/step0-measurements.txt`):
  - **LA's six, prod by `SELECT`:**
    - every read is `no_box` (2026-10-12 16:21Z), with no `general_ballot` row, and none is rated;
    - each jungle row is `house-LA-0N-2026-open`, Nov 3 with a Dec 12 runoff, and has 0 winners: every candidate `running` (4, 5, 6, 5, 9 and 10);
    - the roster is the jungle rule's `on_ballot` rows (3, 4, 5, 4, 9 and 10), the incumbent left out;
    - today's rows at a Nov-5 clock read *Not yet called*, with LA-05's and LA-06's incumbents (Letlow, Fields), in no jungle box, *not on the ballot*.
  - **HO 747's saved LA pages (09-25), every box, 27:**
    - 2026: each page's one section box, *Nonpartisan primary election for U.S. House Louisiana District N*, dated Nov 3, 2026, `primary-kept`, contest `open`, unmarked;
    - past cycles, under *District history*: the November contest is *Nonpartisan primary election* every time (Nov 5, 2024, six; Nov 8, 2022, five; Nov 3, 2020, six);
    - **the one regular runoff,** LA-05's Dec 5, 2020 (Luke Letlow over Lance Harris), is labelled ***General election***, after its Nov 3, 2020 nonpartisan primary with two marked;
    - the 2021 specials: LA-02's *Special Nonpartisan primary election* (Mar 20, two marked), then its *Special general election* (Apr 24); LA-05's *Special Nonpartisan primary election* (Mar 20, one marked, no runoff);
    - no *General runoff election* label on any of the six.

**§ 1, the roster** (`feat` `2729b36`).
- **A jungle seat with a box read is planned as a top-two state is.** `planBallotRoster` reads the cycle's jungle seats in its one read snapshot, by the jungle rule's own join (`JUNGLE_JOIN`, which `JUNGLE_FROM_WHERE` now shares and renders unchanged). Such a seat publishes every printed row that isn't a write-in, less the incumbent's, as `advanced`: the Dec 12 box holds the two advancers, whatever their parties.
- **Every other race plans as before** (leg 1's whole-table diff).

**§ 2, the result** (`feat` `10ff9d1`).
- **`resultFromRows`:** a jungle seat with a `box` read reads its box only once the box carries a mark (an `on_ballot` row marked). Until then it reads its jungle box as it does with no box: two winners *Runoff Dec 12*, one *Decided · Nov 3, 2026*, none *Not yet called*, and the incumbent's qualifier follows.
- **A runoff its box decides is dated the runoff's day:** the reading gains `decidedOn`, the jungle row's `runoff_date` where the jungle marked two and the box marks the one, and `raceResultView`'s header names it, *Decided · Dec 12, 2026*.
- **Two more readers take the same rule, named,** since each weighs a seat's box against its jungle box on its own: `getRaceRoster`'s marks (a Nov-3 winner on an unmarked box reads *Elected*), and `getElectionResults`' jungle half, which now leaves out a seat whose box carries a mark rather than every box read. Without them, leg 3's page would read *Decided* with no *Elected* on the winner's row, and the band wouldn't count the seat.
- **Every other race reads as before** (leg 4). The race page and `/electoral` share `resultFromRows`.

**The legs** (`diag` `3973c16`, `scripts/diagnostic/louisiana-runoff-legs-780.ts`): **r3, 21 PASS, 0 FAIL.**
- **The seed** (r3, 03:12Z): the real `scripts/migrate.ts` against a `file:` template; 22 tables whole from prod by `SELECT`, `bills` and `member_votes` cut to the rated seats' members, and the newest 400 `cron_runs`; prod's fingerprint equal before and after. Two copies, one per build, each with its own sentinel.
- **The plants,** the same on each copy, are what the reader would write for a Dec-12 *General election* box: the jungle box's winners, a `box` read, and the box's printed rows with `primary_marked` 1, the incumbent underlined and identified.
  - **LA-05** (leg 1): Pat Moore (D) and Misti Cordell (R), the box unmarked; the incumbent is in no box.
  - **LA-01** (leg 1, the qualifier): Steve Scalise (R, the incumbent) and Lauren Jewett (D), unmarked.
  - **LA-06** (leg 2): Chauna Banks (D) and Blake Miguez (R), the box marking Miguez.
  - **LA-04** (leg 3): Mike Johnson (R, the incumbent), the box printing him alone, unmarked.
  - **LA-03** (leg 3): Kate Cotten (R), the box printing her alone, unmarked.
  - LA-02 is unplanted, inside leg 4's control.
- **The builds:** HEAD's (`bae5790`) and the tree's (`10ff9d1`), cold and secretless in scratch worktrees, exit 0 with no warning line.
- **Each build's harvest** is its own `/api/cron/race-challengers`, POSTed to its own server on its own copy before any page is read: HTTP 200 on both, 888 rows on 464 races, 468 ballot races and 884 planned rows, with LA-02 the jungle rule's one seat.
- **Leg 0, the reader** (unchanged by HO 780): HO 747's saved LA-01 page reads `no_box` as saved. With CA-17's 2026 *General election* box spliced in, carrying LA-01's two advancers, and the jungle box's two rows marked, `pageResult` reads `box`: two rows, both `primary_marked` 1 and unmarked, Scalise underlined and identified as S001176.
- **Leg 1, Nov 5:**
  - **LA-05:** HEAD reads *Not yet called* with Moore and Cordell *Won primary* (red); the tree *Runoff Dec 12* with both *Advanced* (green).
  - **LA-01:** HEAD reads *Not yet called*, Jewett *Won primary*, and no qualifier; the tree *Runoff Dec 12*, Jewett *Advanced*, and Scalise's card *runoff Dec 12*.
  - **`race_candidates`,** each build's after its harvest: 895 rows each, 889 equal in every column but `updated_at` (each run's stamp). The 6 that differ are the planted seats' `won_primary` → `advanced`.
- **Leg 2, Dec 13:** LA-06 reads *Decided · Nov 3, 2026* on HEAD and *Decided · Dec 12, 2026* on the tree, with *Elected* on Miguez's row on both, and Banks *Won primary* against *Advanced*.
- **Leg 3, Nov 5:**
  - **LA-04:** HEAD reads *Not yet called*; the tree *Decided · Nov 3, 2026*, with Johnson *re-elected*. The page is a stub on both, since the box prints only him.
  - **LA-03:** HEAD reads *Not yet called*, Cotten *Won primary*; the tree *Decided · Nov 3, 2026*, with *Elected* on Cotten's row.
  - **The band** (`/electoral`): HEAD *House R 1 · D 0 · 434 open*; the tree *House R 3 · D 0 · 432 open*.
- **Leg 4, Nov 5:** every other race page's `<main>`, 465 of 465, is byte-identical to HEAD's, each page read twice per server and equal to itself, with the news ages set aside (785 spans, all matched). None of the five is rated, so `/electoral` has no planted row to read.
- **Captures** (`docs/handoffs/780-artifacts/captures/`, 20): the five planted pages at 1440, 430 and 1440 with reduced motion, and HEAD's at 1440, eyeballed styled.
- **The two runs before it, named:**
  - **r1** read 13 PASS, 1 FAIL: leg 4's AZ-04. The race page's news ages run on `Date.now()`, not the clock seam (HO 490), and AZ-04's item of 2026-07-22T03:06:03Z turned *82d* into *83d* at 03:06:03Z, between HEAD's read and the tree's.
  - **r2** read every page twice per server and dumped any difference: 21 PASS, 0 FAIL. r3 sets the news ages aside, so a label crossing a unit can't fail the control, and counts the spans it set aside.
- **Clean-up:** the worktrees are removed, the checkout's `node_modules` is back to one link per file (0 of 15,152 multiply linked), and r1's and r2's copies are deleted (r3's kept).

**Docs (HO 780):**
- This block.
- **backlog, 5+/3−:**
  - **The Louisiana-box line is struck** on the legs, its premise named as inferred.
  - **The Vercel line is struck** with HO 779's FF go reading: both records at most 1s after READY.
  - **Two lines filed at the top:** the general runoff (a *General runoff election* box is read nowhere; Code, medium, dated before Tuesday 2026-12-01), and the flush (whether the data cache serves a cached read's old value across a deploy; Code, low).
  - **The WATCH (HO 758) line's reads** gain the first Louisiana seat whose read turns `box` after Nov 3.
  - **Two more lines filed at the top** (the FF go's commit, 2+/0−): the stub sentence after election day (*Owner:* Corey, a copy call, then Code; dated before Tuesday 2026-11-03), from the paste's LA-04 note, and the news ages' clock (*Owner:* Code, low), from r1's AZ-04.
- **OPEN LOOPS reconciled:**
  - open: 264 live / 347 struck (611), § OPEN LOOPS `:14-209` 63 / 118;
  - close, after the FF go's commit: **266 / 349 (615), § OPEN LOOPS `:14-213` 65 / 120** (the review's close was 264 / 349 (613), `:14-211` 63 / 120; the two lines filed);
  - the control, `^- \*\*~~`, is 0 at both.
- **SKILL, its own commit, last:** the three places the handoff expects (HO 750's roster rule, in its scope and its statuses; HO 758's jungle rule; `:1974`'s *Decided · Nov 3, 2026*), and three more the build made false, named: the band's Louisiana count (`:1949`), the race page's reading (`:1973`) and the roster's *Elected* (`:1977`).
- **Also notes now run through HO 780.**

**Also (HO 781), past election day a stub page drops its sentence and keeps its provenance line, and the race page's news ages read the clock seam. It opens with HO 780's FF go as taken.**
- **What's here:**
  - HO 780's FF go as taken;
  - Corey's ruling, verbatim;
  - STEP 0, its HALT and its rerun, with the count;
  - § 1, the stub sentence, and § 2, the news ages' clock;
  - legs 0 to 2, and the run before the one that stands.
- **Five commits, kinds unmixed:** `feat` · `fix` · `diag` · `docs` · `docs(skill)` alone and last.
- **No prod write.** Prod was read by `SELECT` only: each seed.
- **The pointer is 781:** pointer 780, highest HO in commit subjects 780, `main` at `2ffc153`.

**HO 780's FF go, as taken** (`docs/handoffs/780-artifacts/ff/paste-780-ff.md`).
- **The go's `docs` commit, `2ffc153`, on `780-review`:**
  - the two lines filed at the top of OPEN LOOPS: the stub sentence after election day (*Owner:* Corey, a copy call, then Code; dated before Tuesday 2026-11-03) and the news ages' clock (*Owner:* Code, low);
  - HO 780's block shipping true (six commits, the two lines, the close after the commit);
  - the reconcile, 264 / 349 (613) to 266 / 349 (615), § OPEN LOOPS `:14-213` 65 / 120, the control 0.
- **The FF:**
  - a cold build and the cheap gates before the review push (19:39:31Z) and again immediately before the FF, each build exit 0 with no warning line, each gate run green;
  - then `bae5790..2ffc153`, 6 commits, no force (19:40:38Z). The classifier didn't block it;
  - `780-review` deleted, remote and local (`780-review-local`), and `main` reads `2ffc153dc0ab…`.
- **`verify:deploy`, in the foreground:** matched at 41s, five consecutive reads at 83s.
- **The Production build,** `dpl_J312m49HKG73kcwcYz18KjrnzS15` (`bld_kska5qhmi`, iad1), skipped the build cache: *VERCEL_FORCE_NO_BUILD_CACHE is set so skipping build cache step.* at 19:40:44.023Z. It compiled in 11.5s and went READY at 19:41:42.202Z. Its log, read whole in two windows, held no Next warning line.
- **Both of Vercel's records came at most 1s after READY:** Production's (7048319227) at 19:41:42Z against READY 19:41:42.202Z, and the review push's Preview's (7048291852) at 19:40:23Z against 19:40:22.487Z.
- **`e2e-prod`:** the Production record fired #38456875946 (19:41:44Z): `smoke` **141 passed (5.5m)**, all 39 crawl lines clean. Nothing was dispatched.
- **No flush,** as the go ruled.
- **Named:**
  - the stub-sentence line's LA-04 clause is narrower than the go's note. HO 780's saved dumps show the sentence on both builds, and *Decided · Nov 3, 2026* and *re-elected* on the tree's only;
  - the review push's Preview fired `narrow-preview` #38456698659: 82 passed. 18 cells differ from #38189661717's, each only in the home page's enacted-bill chip count (`ids:3` for `ids:2`), and with that field aside all 82 are equal. `36a4a30..2ffc153` touches only docs, so the difference is data: a third bill enacted this week.

**Corey's ruling, 2026-10-12, verbatim** (answered by selection):
- the question: *"On Nov 4, an unrated race page whose ballot lists only the incumbent will show 'Decided · Nov 3, 2026' and 're-elected', but its sentence still says 'Incumbent running for re-election. No competitive rating yet.' What should that sentence say after election day?"*;
- the answer: *"Drop the sentence (Recommended)"*.
- **The architect's read:** past election day (`raceResultView`'s `passed`), a stub page shows no sentence, decided or not, in all three of its forms, and the provenance line stays. Extending the ruling from the asked case to all three forms was the architect's call.

**STEP 0** (a check, HO 768's rule).
- **First run, 2026-10-13 19:07Z: HALT on claim 1.**
  - `main` was `bae5790`, and `780-review` was still on the remote at `36a4a30`, five ahead: HO 780's FF go had not been taken.
  - OPEN LOOPS held neither of the go's lines.
  - Claims 2 to 4 held at `36a4a30`, and nothing was built (`docs/handoffs/781-artifacts/step0-halt.txt`).
- **Rerun, 19:51Z, after the go: all four hold.**
  - **1:** `main` is `2ffc153`, `36a4a30` plus the go's `docs` commit; its Production `smoke` passed (#38456875946); OPEN LOOPS holds both lines (`:15`, `:16`).
  - **2:** `stubSentence`'s three forms (`lib/race-stub.ts:11-16`); its one rendering caller, `RaceHubBody` (`components/RaceHubBody.tsx:193`), inside the stub `<p>` (`:186-199`) that carries the provenance line (`:194-198`); `isStub` (`:106-110`). Named and not counted: HO 750's legs (`scripts/diagnostic/harvest-yields-legs-750.ts:760`, `:772`) call it to check its forms.
  - **3:** `DORMANT` (`lib/race-result.ts:171`) is returned before election day (`:182`), and `passed` is true after it (`:204`).
  - **4:** the news clock is `Date.now()` (`app/race/[id]/page.tsx:33`), with `clockNowMs` imported (`:5`) and already read at `:95` and `:121`.
- **The measurement** (a fresh copy, HEAD's build, today's clock; r1's seed at 19:58Z and r2's at 20:05Z read the same): **5 stub pages of 470.**
  - *Incumbent running for re-election. No competitive rating yet.*: 4, MA-02, MA-05, MA-07 and WI-02, each box printing its incumbent alone;
  - *No competitive rating yet.* alone: 1, FL-10, read `no_box` (its canceled general);
  - *Open seat. Candidate filings forthcoming.*: none.

**§ 1, the stub sentence** (`feat` `7da4ac9`).
- **`RaceHubBody` prints `stubSentence` only while the result view's `passed` is false.** Past election day the stub `<p>` holds the provenance line alone, and with neither it doesn't render. `raceResultView` can't produce that state today: past election day it always gives a provenance line.
- **Before election day nothing changes** (leg 0).

**§ 2, the news ages' clock** (`fix` `dbb5cff`).
- **`app/race/[id]/page.tsx` computes its one `nowMs` (HO 490) from `clockNowMs()`, not `Date.now()`.** On Production and every Preview the two are the same. On a `file:` copy, `CBT_CLOCK_NOW` now sets the news ages too.

**The legs** (`diag` `eec7fdf`, `scripts/diagnostic/stub-sentence-legs-781.ts`): **r2, 18 PASS, 0 FAIL.**
- **The seed** (r2, 20:05Z): the real `scripts/migrate.ts` against a `file:` template; 22 tables whole from prod by `SELECT`, `bills` and `member_votes` cut to the rated seats' members, and the newest 400 `cron_runs`; prod's fingerprint equal before and after. Two copies, one per build, each with its own sentinel.
- **The builds:** HEAD's (`2ffc153`) and the tree's (`dbb5cff`), cold and secretless in scratch worktrees, exit 0 with no warning line.
- **Leg 0, today's clock (no seam):**
  - every race page's `<main>` equals HEAD's, the stub sentences included: 469 of 470 byte-identical as served, and S-KS differing only in a news age, the set-aside's one catch (its newest item was minutes old, so its label runs on the minute);
  - each stub's paragraph is equal on both builds, 5 of 5, each with its sentence;
  - each page read twice per server is equal to itself.
- **The plants,** the same on each copy:
  - MA-02's one printed row, McGovern's, marked (the decided stub);
  - one news item for leg 2, on S-KS (M001198), observed two minutes before the plant (20:04:49Z);
  - MA-05 is the undecided stub, and the census holds no open-seat stub, so that case is unread.
- **Leg 1, Nov 4:**
  - **MA-02:** both builds read *Decided · Nov 3, 2026* and *re-elected*. HEAD's prints the sentence above *Called by Ballotpedia · read Oct 13, 2026, 10:21 AM MT* (red); the tree's prints the line alone (green).
  - **MA-05:** *Not yet called* on both. HEAD's prints the sentence; the tree's prints none, its *No call on Ballotpedia · read …* line kept.
  - **The census:** no stub page on the tree prints a sentence, 5 of 5 keeping the provenance line; each stub page's `<main>` is HEAD's less its sentence (5 of 5), and every other page's equals HEAD's (465 of 465), the news ages aside.
- **Leg 2, Nov 4:**
  - on the tree, every news age on every race page reads against the set clock: 793 of 793 spans equal `formatRelativeAge(observed_at, Nov 4)`. On HEAD, all 793 read against the read's own time, and none equals the Nov 4 label;
  - S-KS read twice 60s apart: the tree's byte-identical (*21d*, *21d*, *21d*, *23d* …), HEAD's planted item *2m* then *3m*;
  - on the tree every race page read twice is equal to itself, with nothing set aside.
- **Captures** (`docs/handoffs/781-artifacts/captures/`): MA-02 on the tree at 1440, at 430, and at 1440 with reduced motion, and HEAD's at 1440, eyeballed styled. The tree's news age reads *110d* at the Nov 4 clock, HEAD's *88d*.
- **The run before it, named:** r1 read 17 PASS, 1 FAIL, the instrument's own. Its census filed a stub paragraph with no sentence under *other*, which the check counts as a printed sentence, so the tree's five sentence-less stubs failed it while its detail read 5 of 5 with no sentence. r2 gives them their own bucket, on a fresh seed. r1's other 17 checks passed, with S-KY as leg 2's page and every leg-0 page byte-identical as served.
- **Clean-up:** the worktrees are removed, the checkout's `node_modules` is back to one link per file (0 of 15,152 multiply linked), and r1's copies are deleted (r2's kept).

**Docs (HO 781):**
- This block.
- **backlog, 2+/2−:**
  - **The stub-sentence line is struck** on the legs, Corey's ruling quoted.
  - **The news-ages line is struck** on leg 2: at a set clock the tree's every race page read twice equals itself with nothing set aside. Leg 1's cross-build control still set the ages aside, since HEAD's build predates the fix.
- **OPEN LOOPS reconciled:**
  - open: 266 live / 349 struck (615), § OPEN LOOPS `:14-213` 65 / 120;
  - close: **264 / 351 (615), § OPEN LOOPS `:14-213` 63 / 122**;
  - the control, `^- \*\*~~`, is 0 at both.
- **SKILL, its own commit, last:**
  - the handoff's sentence, a bullet of its own in the race page's result list: past election day a stub page shows no sentence, only its provenance line (HO 781, Corey's ruling);
  - and four places the build made false or left short, named: the provenance bullet's *(and under a stub's sentence)*, the stub state's *single muted line*, HO 490's rule's *`const nowMs = Date.now()`*, and the clock seam's readers, which now include the race page's news ages.
- **Also notes now run through HO 781.**

**Also (HO 782), Cook's two seed snapshots leave the public repo before Corey answers Cook, and SKILL stops calling the seed files the source of truth.**
- **What's here:**
  - Cook's reply, paraphrased;
  - Corey's ruling and its three parts;
  - the why;
  - STEP 0;
  - § 1, the files, and leg A;
  - what stays.
- **Three commits, kinds unmixed:** `chore` · `docs` · `docs(skill)` alone and last.
- **No migration and no prod write;** prod's `race_ratings` rows don't move.
- **The pointer is 782:** pointer 781, highest HO in commit subjects 781, the HO stacked on `781-review`'s head (`c03727a`), so one FF takes both.

**Cook's reply, 2026-10-12** (paraphrased; this file is public): to the 10-09 API request, Cook answered that access needs a subscription, at a level set by the use case, plus a signed licensing agreement. It asked three things: how the Ballotpedia pull worked and what changed, who has access to the site and how it works, and whether others could replicate it.

**Corey's ruling, 2026-10-13** (answered by selection): asked whether the two Cook snapshot files in the public repo come out before he replies, he chose *Remove them before I reply*. Its three parts:
- the two files leave the repo first (this HO);
- Cook's frozen 09-30 column stays up, credited and linked, and the reply offers to take it down;
- the reply asks the price before deciding.
- The last two live in the email, not in code.

**The why:**
- `github.com/CSU-J3/cbt` is public and MIT, and the two files were Cook's ratings in it:
  - `data/race-ratings-cook-2026.json`, 35 Senate rows: Wikipedia's table as of Jan 12, 2026, with Cook's Apr 13 updates applied to GA, NC, NE and OH;
  - `data/race-ratings-cook-house-2026.json`, 62 House rows, fetched 2026-05-19.
- Nothing read them but `scripts/seed-race-ratings.ts`, a first fill.
- While a license is negotiated, the honest state of the repo is code only, and the reply will say the files are gone, so this lands before it.

**STEP 0** (a check, HO 768's rule), 2026-10-13 20:41Z at `c03727a`: **all four hold.**
- **1:** `git ls-files data` lists six `race-ratings-*.json` files, a Senate and a House file each for Cook, Inside Elections and Sabato. Cook's pair holds 35 and 62 rows.
- **2:** `scripts/seed-race-ratings.ts` is the one reader:
  - `DATA_DIR` and `SEED_PATTERN` at `:53-54`, the `readdirSync(DATA_DIR).filter(…)` at `:64-65`, and the no-match warning at `:84-85`;
  - `git grep -n race-ratings-cook -- app lib components scripts e2e` finds nothing.
  - Named and not counted: a plain `grep -rn` also finds two lines in `scripts/diagnostic/scratch/tree-759-a2fail/`, an untracked, gitignored copy of SKILL and the backlog from HO 759, not a reader.
- **3:** SKILL names the Cook file once, in the `race_ratings` schema comment (`:365-366`), and calls the seed files the source of truth once: `:2947`, which was `bae5790`'s `:2946` until HO 781's added bullet. `:1355` names no file and stays.
- **4:** the README names neither file, and its credits (`:157-159`) already say Cook's and Inside Elections' ratings are as Ballotpedia last carried them, on 2026-09-30.
- **The verbatim SKILL text, read against the tree before it lands:**
  - `lib/race-ratings-sync.ts` writes `race_ratings`;
  - *one reader per rater since HO 770* is the sync route's own description (`app/api/sync-race-ratings/route.ts:3`), with `WIRED` (`lib/race-ratings-scrape.ts:155`) naming Sabato alone;
  - the race-id formats and the Senate-specials collapse are carried from the old bullet's text.

**§ 1, the files** (`chore` `d30f990`).
- **`git rm`** of the two files, by explicit path, nothing else staged.
- **`scripts/seed-race-ratings.ts`'s header** gains two lines after its line 4, verbatim: *Cook's two files left the repo in HO 782 (SKILL, race_ratings); a fresh database holds no Cook rows until Cook is wired.* Its code is unchanged.

**Leg A, the tree.**
- **The red** (the base, `c03727a`): `git ls-files data | grep -c race-ratings` reads **6**.
- **The green** (`782-review`): it reads **4**, Inside Elections' and Sabato's, none of them Cook's.
- **`git grep -l race-ratings-cook` on the green lists four files, and not the four the handoff expected:**
  - **two docs:** `docs/backlog.md`, whose one mention is the struck HO 743 line (`:87`, naming the Senate file as a snapshot's source; this HO's backlog text doesn't name the files), and `docs/roadmap.md`, whose six mentions are all this block's: the two files as removed, the leg's own grep pattern, and the old handoff's file name;
  - **two tracked old handoffs:** `docs/handoffs/71-race-ratings-cook.md` and `73-additional-rating-sources.md`. They are among the 386 handoffs committed before `.gitignore:79` ignored `docs/handoffs/`, and name the file as the one to create;
  - **two missing:** the seed script and SKILL. The handoff's verbatim lines for both don't carry the string (they say *Cook's two files* and `data/race-ratings-*.json`), so neither is listed. The tree wasn't bent to match: what the leg means to show holds, since no code names the files and every doc that does names them as history or as removed.
- **The build and the cheap gates** pass unchanged, since nothing imports the files.

**What stays:**
- **Inside Elections' and Sabato's four seed files,** with a backlog line of their own (below):
  - Senate files dated 2026-01-12 and 2026-01-29;
  - House files dated 2026-05-19.
- **The history:** the two files stay in git history, as every deleted file does. Nothing is rewritten.
- **The database:** prod's `race_ratings` doesn't move. HO 781's r2 copy of prod (2026-10-13 20:05Z, a local file) holds 87 Cook rows, 48 of them as the seed last wrote them on 2026-05-19; the rest are as the sync last wrote them, through 2026-09-30.
- **Named, and left as ruled:**
  - **`docs/handoffs/71-race-ratings-cook.md`,** tracked and public, keeps a two-row format example presented as Cook's (`ME-SEN-2026` and `NC-SEN-2026`, *Toss Up*, 2026-04-15). It's outside the ruling's two files.
  - **SKILL's `:1355`** (`npm run seed:ratings`) still says *v1 covers Cook, Sabato, and Inside Elections* and *Refresh quarterly by re-pulling each rater's page*.
  - **The seed script's header** still calls a re-run *the quarterly refresh workflow*. Its upsert (`ON CONFLICT(id) DO UPDATE`) would write the snapshots over the sync's rows if run against a live database. The new SKILL bullet says the files are a first fill and that nothing reads them after it.

**Docs (HO 782):**
- This block.
- **backlog, 2+/1−:**
  - **The Cook line gains, in order:** Cook's 10-12 reply, paraphrased; the 10-13 rulings; *the two seed files removed, HO 782*; and *Corey replies after this FF; the site keeps Cook's 09-30 column, credited and linked, and the reply offers to take it down.* Its owner stays Corey.
  - **New, at the top of OPEN LOOPS:** Inside Elections' and Sabato's four seed snapshots are still in the public repo (*Owner:* Corey). Its *Reads if never done* clause, the ledger's rule, is Code's addition to the handoff's text.
- **OPEN LOOPS reconciled:**
  - open: 264 live / 351 struck (615), § OPEN LOOPS `:14-213` 63 / 122;
  - close: **265 / 351 (616), § OPEN LOOPS `:14-214` 64 / 122**;
  - the control, `^- \*\*~~`, is 0 at both.
- **SKILL, its own commit, last:** the two replacements, verbatim. The `race_ratings` schema comment (`:365-366`) now says the sync writes the rows and the seed is a first fill. The bullet that called the seed files the source of truth (`:2947`) is now *Race ratings are synced, not hand-seeded (HO 88, HO 770)*.
- **Also notes now run through HO 782.**

**Also (HO 783), the general runoff box: the reader stores a race's *General runoff election* box, and its mark decides the seat on every reader, Georgia's Dec 1 and Louisiana's Dec 12 if it's labelled so. It opens with HOs 781 and 782's FF go as taken.**
- **What's here:**
  - HOs 781 and 782's FF go as taken;
  - Corey's choice;
  - STEP 0, with its measurements;
  - the prod migration;
  - § 1, the reader, and § 2, the readers;
  - legs 0 to 4.
- **Five commits, kinds unmixed:** `feat` (the migration and § 1) · `feat` (§ 2) · `diag` · `docs` · `docs(skill)` alone and last.
- **One prod write, the migration,** before the review push (method.md, HO 754's rule). Otherwise prod was read by `SELECT` only: the read-back and the seed.
- **The pointer is 783:** pointer 782, highest HO in commit subjects 782, `main` at `4d73ca7`.

**HOs 781 and 782's FF go, as taken** (`docs/handoffs/782-artifacts/ff/paste-781-782-ff.md`).
- **The FF:**
  - immediately before it, the cold build (21:00:27-58Z, exit 0, *Compiled successfully in 9.1s*, no warning line) and the cheap gates (green);
  - then `2ffc153..4d73ca7`, 8 commits, 781's five and 782's three, no force (21:01:12Z). The classifier didn't block it;
  - `781-review` and `782-review` deleted, remote and local, and `main` reads `4d73ca79dc8b…`.
- **`verify:deploy`, in the foreground:** matched at 31s, five consecutive reads at 73s.
- **The Production build,** `dpl_EvjD9fEFMZcajo3hYuNfk4tsXmtd` (`bld_kp1be19fs`, iad1), skipped the build cache: *VERCEL_FORCE_NO_BUILD_CACHE is set so skipping build cache step.* at 21:01:16.787Z. It compiled in 8.9s and went READY at 21:02:01.601Z. Its log, read whole in two windows, held no Next warning line.
- **Vercel's records came at most 1s after READY:** Production's (7049997553) at 21:02:02Z against 21:02:01.601Z, and HO 782's review Preview's (7049725779) at 20:48:25Z against 20:48:25.080Z.
- **`e2e-prod`:** the Production record fired #38467503450 (21:02:04Z): `smoke` **141 passed (5.6m)**, all 39 crawl lines clean. Nothing was dispatched.
- **No flush:** the stub's gate and the news clock are both render-time.
- **Reading 1, Cook's files gone from `main`** (21:03:27Z): both answer **404** on `raw.githubusercontent.com/CSU-J3/cbt/main` (`X-Cache: MISS`), a Sabato control answers 200, and `git ls-tree origin/main data` lists four `race-ratings-*.json` files. Corey sends his reply on this reading.
- **Reading 2, the stub sentence still up today** (21:03:39Z): `/race/MA-02-2026` on Production, serving `4d73ca7`, prints *Incumbent running for re-election. No competitive rating yet.* under *21 days to election*, with no provenance line.

**Corey's choice, 2026-10-13** (from four): *"Georgia runoff reading (Recommended)"*, the backlog's general-runoff line (HO 780, dated before Tuesday 2026-12-01).

**STEP 0** (a check, HO 768's rule), 2026-10-14 00:22Z at `4d73ca7`: **all six hold.**
- **1:** `main` is `4d73ca7`, its Production `smoke` passed (#38467503450), and both Cook files answer 404 on `main`.
- **2:** `boxKind` gives a primary runoff and a general runoff the one `runoff` kind (`lib/general-ballot.ts:175`). `PageModel` keeps `general`, `primaries` and `outsideGeneral` (`:146`, `:313`), `pageResult` reads `model.general` only (`:563-565`), and `writeRace` (`:710`) writes `general_ballot` (`:689`) and `general_ballot_reads` (`:695`) only.
- **3:** the scrape drops a general runoff box (`lib/primary-candidates-scrape.ts:379-384`, the drop at `:405`).
- **4:** `resultFromRows` reads two or more marks in the general box as a runoff (`lib/race-result.ts:98`, `:127`). The runoff label dates only from the jungle row (`:186`), and `decidedOn` is the jungle's runoff date only (`:130`, `:188-189`).
- **5:** the four readers of a result read `general_ballot`'s marks only: `getRaceRoster`, `getElectionResults`, the qualifier's outcome, and `readRaceResults`, which hands its rows to `resultFromRows`. Named and not counted:
  - `lib/pac-target-status.ts:214-225` builds a `why` from the box's marks, past election day (*decided* or *a runoff*), but its one caller keeps `.status` alone (`lib/queries.ts:2656`), and a printed row's status is `active` marked or not;
  - `lib/electoral-general.ts:182` selects `marked` and never uses it.
- **6:** georgia.gov's *Election Day - General Election Runoff* page lists **December 1, 2026**; Nov 3 plus 28 days is Dec 1, a Tuesday.
- **The measurements,** over HO 747's saved pages (470 races, the latest page each; `step0-runoff-h5.txt`):
  - **5 `<h5>` say *runoff* and not *primary*, all outside the 2026 section:**
    - S-GA's two *General runoff election for U.S. Senate Georgia* (Dec 6, 2022; Jan 5, 2021);
    - GA-05's and TX-18's *Special general runoff election* (Dec 1, 2020; Jan 31, 2026);
    - NM-01's *Special Democratic convention runoff* (Mar 31, 2021), which says no *general*.
  - **Every such box prints its date** in its results text (*"… on December 6, 2022."*), and the heading above it doesn't. A pending 2026 box prints its date too (*"… are running in the general election … on November 3, 2026."*), so the box's own date is preferred where it prints one.

**The prod migration** (before the review push): `npm run migrate` on prod, 2026-10-14 00:29:07-00:29:24Z, exit 0. It printed `ok: CREATE TABLE IF NOT EXISTS general_runoff (` and `migration complete`. Read back by `SELECT` at 00:29:38Z: the table's 11 columns as written, `PRIMARY KEY (race_id, person_key)` with its automatic index, and 0 rows.

**§ 1, the reader** (`feat` `a2c97d5`).
- **`general_runoff`** (`scripts/migrate.ts`): one row per person in a race's 2026 general runoff box, keyed on race and person. Its columns are race, person key, name, party, bioguide by identity (as `general_ballot` takes it), `marked`, `on_ballot`, box prefix and read time, plus two more:
  - `incumbent_marked`, the box's underline, which the incumbent rule reads;
  - `box_date`, the date the box prints.
- **The read** (`lib/general-ballot.ts`): a box in the 2026 section whose `<h5>` says *general* and *runoff* and not *primary* is a kind of its own, `general-runoff`.
  - Every READ stores the race's one such box, replaced whole in the same batch as the general box and before the reads stamp, whatever the general box's status, so a Louisiana seat read `no_box` keeps its runoff rows.
  - None stores nothing. Two store nothing, and the run's payload names the race (`runoffAmbiguous`), as it names each stored box (`runoffBoxes`).
  - Each box carries the date its results text prints.
  - A READ write without a runoff part (HO 749's and HO 751's legs, which build their own) leaves `general_runoff` alone.

**§ 2, the readers** (`feat` `a86a287`).
- **`resultFromRows`** (`lib/race-result.ts`) takes the race's runoff rows, and where the race is.
  - **One marked printed row decides the race.** The header reads *Decided* on the runoff's date, that row is the mark, and the incumbent reads *re-elected* or *defeated* by their own runoff row.
  - **No mark keeps the runoff:** the general box's two marks, or Louisiana's jungle winners, stay its advancers.
  - **The runoff's date (`runoffOn`)** is the one the box prints, else Louisiana's jungle row's, else Georgia's, 28 days after election day. So a Georgia race whose general box reads two marks reads *Runoff Dec 1* before any runoff box exists.
  - The race page's read and `/electoral`'s batched read both fetch the rows.
- **The roster, the band and the tag take the same rule:**
  - `getRaceRoster`'s *Elected* comes from the runoff box's one mark;
  - `getElectionResults` counts a race decided in its runoff by that mark, and no longer by its general box or jungle;
  - a `senate` or `moved` tag whose race is decided in its runoff reads ELECTED or LOST by that mark.
- **Every race without runoff rows reads as before** (leg 4).

**The legs** (`diag` `aaf4393`, `scripts/diagnostic/general-runoff-legs-783.ts`): **r1, leg 0 4 PASS and legs 1-4 18 PASS, 0 FAIL.**
- **The seed** (00:39Z): the real `scripts/migrate.ts` (so `general_runoff` exists, empty) against a `file:` template; 22 tables whole from prod by `SELECT`, `bills` and `member_votes` cut, the newest 400 `cron_runs`; prod's fingerprint, `general_runoff` included, equal before and after. Three copies: HEAD's, the tree's and leg 0's.
- **The builds:** HEAD's (`4d73ca7`) and the tree's (`a86a287`), cold and secretless in scratch worktrees, exit 0 with no warning line.
- **Leg 0, the reader** (the tree's `runGeneralBallot` and its real write, through a fetch shim). The template is S-GA's own 2022 *General runoff election* box, spliced into HO 747's saved pages:
  - **S-GA,** its general box's two advancers marked: it stores two runoff rows, Collins marked, dated 2026-12-01, both identified, Ossoff underlined, and its general rows (7, two marked) equal the same page's without the box;
  - **two runoff boxes** store nothing, and the payload names S-GA;
  - **LA-01,** with no general box, stays `no_box` and keeps its runoff rows (Jewett marked, 2026-12-12).
- **Leg 1, Nov 5** (S-GA's general box marking Ossoff and Collins):
  - S-GA reads *Runoff* on HEAD (red) and ***Runoff Dec 1*** on the tree, its incumbent's card *runoff Dec 1* (green);
  - GA-10's tag reads IN THE SENATE RUNOFF on both.
- **Leg 2, Dec 2** (S-GA's runoff rows marking Collins):
  - **HEAD (red):** *Runoff*, no *Elected*, GA-10's tag IN THE SENATE RUNOFF, `/electoral`'s chip RUNOFF, and the band *0 of 99 competitive seats called*;
  - **the tree (green):** ***Decided · Dec 1, 2026***, *Elected* on Collins's row alone, Ossoff *defeated*, GA-10's tag ELECTED TO THE SENATE, the chip R GAIN, and the band *1 of 99*.
- **Leg 3, Dec 13** (LA-01, read `no_box`, two jungle winners, runoff rows marking Jewett): HEAD reads *Runoff Dec 12*; the tree ***Decided · Dec 12, 2026***, *Elected* on Jewett's row.
- **Leg 4, the control at Dec 2:** every other race page's `<main>`, 468 of 468, is byte-identical to HEAD's with **nothing set aside** (795 news-age spans), and each page read twice equals itself on both servers. Both builds carry HO 781's clock, so this is the news-ages line's *Close* read in practice.
- **Captures** (`docs/handoffs/783-artifacts/captures/`): S-GA at Nov 5 and at Dec 2, on the tree at 1440, at 430 and at 1440 with reduced motion, and HEAD's at 1440, eyeballed styled.
- **Clean-up:** the worktrees are removed, and the checkout's `node_modules` is back to one link per file (0 of 15,152 multiply linked).

**Docs (HO 783):**
- This block.
- **backlog, 3+/2−:**
  - **The general-runoff line is struck** on the legs.
  - **The `seed:ratings` line is filed at the top** (HO 782's note 5; *Owner:* Code, low): run against a live database, the seed would write its January-to-May snapshots over the synced rows.
  - **The WATCH (HO 758) line's reads** gain Georgia's: any race whose general box reads two marks on Nov 4 should read *Runoff Dec 1*.
- **OPEN LOOPS reconciled:**
  - open: 265 live / 351 struck (616), § OPEN LOOPS `:14-214` 64 / 122;
  - close: **265 / 352 (617), § OPEN LOOPS `:14-215` 64 / 123**;
  - the control, `^- \*\*~~`, is 0 at both.
- **SKILL, its own commit, last:** the general runoff added where SKILL describes the reader and its tables, and every sentence the build made false rewritten (named in the paste).
- **Also notes now run through HO 783.**

**Also (HO 784), the ratings sources line: every ratings surface names its three raters, links each one, and says how old its ratings are, and `seed:ratings` refuses a table that has rows. It opens with HO 783's FF go as taken.**
- **What's here:**
  - HO 783's FF go as taken;
  - Corey's ruling, its trail and the mock;
  - STEP 0, with its measurements;
  - the line, AS OF, VIA and the token;
  - §§ 1 to 5;
  - legs A to F.
- **Seven commits, kinds unmixed:** `docs(design)` (the mock, ahead of the code that cites it) · `feat` (§§ 1 to 4 and the smoke test) · `fix` (§ 5) · `feat` (the line's spacing, after leg B's r1) · `diag` · `docs` · `docs(skill)` alone and last.
- **No migration and no prod write.** Prod was read by `SELECT` only: STEP 0's reads, the seeds and leg A, each fingerprinted before and after.
- **The pointer is 784:** pointer 783, highest HO in commit subjects 783, `main` at `372c433`.

**HO 783's FF go, as taken** (`docs/handoffs/783-artifacts/ff/paste-783-ff.md`).
- **The FF:**
  - immediately before it, the cold build (01:51:07-38Z, exit 0, *Compiled successfully in 8.9s*, no warning line) and the cheap gates (green);
  - then `4d73ca7..372c433`, 5 commits, no force (2026-10-14 01:51:59Z). The classifier didn't block it;
  - `783-review` deleted, remote and local, and `main` reads `372c4330a27b…`.
- **`verify:deploy`, in the foreground:** matched at 31s, five consecutive reads at 72s.
- **The Production build,** `dpl_64sHegejbL4KRwdDJiJFhkUw8bdn` (`bld_hu6kck28u`, iad1), skipped the build cache: *VERCEL_FORCE_NO_BUILD_CACHE is set so skipping build cache step.* at 01:52:04.645Z. It compiled in 7.7s and went READY at 01:52:44.943Z. Its log, read whole in two windows, held no Next warning line.
- **Vercel's records came at most 1s after READY:** Production's (7054753348) at 01:52:45Z against 01:52:44.943Z, and HO 783's review Preview's (7053770370) at 00:46:45Z against 00:46:44.462Z.
- **`e2e-prod`:** the Production record fired #38498068482 (01:52:47Z): `smoke` **141 passed (5.8m)**, all 39 crawl lines clean. Nothing was dispatched.
- **No flush:** before Nov 3 no race has two marks.
- **The first tick on the new code,** #24866 (02:20:35-02:24:30Z): `success`, 40 races READ, and `runoffBoxes` and `runoffAmbiguous` both empty, the first payload to carry them. All 40 batches committed (40 `general_ballot_reads` rows stamped after READY), and `general_runoff` holds 0 rows.
- **The paste's note 1,** a header comment HO 783 made false (`app/api/cron/general-ballot/route.ts:7-8`), wasn't taken by this HO, so it's filed in the backlog (method.md: a finding caught in relay is filed).

**Corey's ruling, verbatim: *"this works send it"*, on `docs/design/mock-784-sources-line-v3.html` as it opens.** The line as set: ELECTORAL foot · RACE chips · WELCOME foot · FRESH via · LAYOUT line · CASE chrome · COOK on · EMBER #d2500e. The trail:
1. *"prob should have like a drop down on the dashboard that list these upfront?"*, answered with a static line, not a dropdown, since a dropdown hides what was asked for upfront.
2. On v1 Corey set FOOT, UNDER CHIPS, FOOT, AS OF + VIA, ONE LINE, CHROME, SHOWN, and said: *"from its own page cant be the wording. make this more noticeable, maybe make the text a dark orange that we have not used yet"*.
3. On v2: *"no just this text as of 2026-09-30 · via Ballotpedia. keep the ratting site name with the same color associated with it"*.
4. On v3: *"this works send it"*.
- **The mock,** committed in its own `docs(design)` commit ahead of the `feat` whose `app/globals.css` cites it (HO 718's order), so the citation resolves at every commit: sha256 `47fd497ac03c5471db12676a47c18472a978d0b0e014ff705a8e922520d22135`, 29,176 bytes, the committed blob reading the same. It was drawn as mock-783 and renamed before HO 783 went to the general runoff box; the old name was never cited in the repo. The bar's SABATO FEED buttons preview a future state and are not a ruling.
- **The mock as it opens draws two of its three surfaces otherwise than its v3 note says.** Its CSS declares `.src-line a` and `.src-line .fr` twice, and the later pair (`:114-115`) wins the cascade. So on `/electoral` and `/race`, read headless, the names draw in `--text-secondary` (rgb(203, 213, 225)) and the dates in `--text-dim` (rgb(107, 114, 128)); only the welcome foot draws the dates in the ember (`docs/handoffs/784-artifacts/step0-mock-colours.json`). The build follows the v3 note and Corey's v2 words: names in `--text-muted`, as the chips', and the dates in the ember.

**STEP 0** (a check, HO 768's rule), 2026-10-14 18:28-18:40Z at `372c433`: **claims 1 to 5, 7 and 8 hold; claim 6 holds by its letter, not its substance.** Its *Fails if* is empty, so no HALT.
- **1:** `main` is `372c433`, HO 783 is on it, and its FF paste recorded Production's `smoke` green (141).
- **2:** the mock reads the sha256 above, 29,176 bytes.
- **3:** the `race_ratings` DDL (SKILL `:368-378`); the unchanged-skip (`lib/race-ratings-sync.ts:349-352`); the upsert writing `rating_date` (`:386`) and the reader's `sourceUrl` (`:387`); `SABATO_CHANGES_URL` (`lib/race-ratings-scrape.ts:375`), the only `sourceUrl:` value (`:704`); the seed writing each row's `source_url` (`scripts/seed-race-ratings.ts:131`), which in all four files is the file's `source_url_base`, the rater's own chamber page. The `rating_date` comment the handoff cites at `:358-367` runs to `:368`.
- **4, the prod read** (leg A's red half; `step0-prod-ratings.txt`):
  - Cook: 87 rows, MAX(`rating_date`) 2026-09-29, the newest row (by `updated_at`) on `ballotpedia.org`;
  - Inside Elections: 86 rows, 2026-09-22, `ballotpedia.org`;
  - Sabato: 95 rows, 2026-09-29, `ballotpedia.org`;
  - so the line must print *RATINGS · COOK · AS OF 2026-09-29 · VIA BALLOTPEDIA · INSIDE ELECTIONS · AS OF 2026-09-22 · VIA BALLOTPEDIA · SABATO · AS OF 2026-09-29 · VIA BALLOTPEDIA*, and `/welcome`'s foot *ratings as of 2026-09-22 to 2026-09-29*.
- **5:** the surfaces at their anchors: `RaceListView` client (`:1`), `tab` (`:314`), `measure()` (`:355-365`) sizing the box from the window's bottom (`:360-362`), `.rl-main` / `.rl-box` (`:500-510`), the aside (`:561`); `/electoral`'s call (`app/electoral/page.tsx:172-184`); `RaceHeader`'s strip (`:68-92`), rendered only by `RaceHubBody` (`:119`) from the race page (`:112-124`, its `Promise.all` `:70-95`); the welcome foot (`app/welcome/page.tsx:408`, its `div` closing at `:421`, one past `:420`) and its classes; the box off under 900px (`app/globals.css:6194-6199`).
- **6:** `getRaceRatings` (`lib/queries.ts:2425-2445`) is `unstable_cache`, a day, tag `race-ratings`, and its comment says the seed refreshes quarterly. No code calls `revalidateTag("race-ratings")` by that name, but `app/api/sync-race-ratings/route.ts:102` calls `expireTag("race-ratings")`, which is `revalidateTag(tag, { expire: 0 })` (`lib/cache/expire-tag.ts`), at the end of every run that doesn't throw. The seven runs since 2026-10-07 all threw, Sabato's page answering 403 with Cloudflare's challenge (`step0-sync-runs.txt`), so nothing has expired it since the 2026-09-30 run, but the code does. The comment and the new backlog line say that, not that nothing revalidates the tag.
- **7:** the seed counts nothing before it writes (`:81-89`), its header calls it the quarterly refresh (`:1-6`), and SKILL `:1376` and `:2968` describe it.
- **8:** `e2e/smoke.spec.ts`'s `targeted interactions` describe is at `:898`.
- **The colours:** `#d2500e`, `#ea580c` and `#c2410c` are used nowhere in `app components lib`; `#b45309` is the nearest orange in use (`components/ElectoralBoard.tsx:154`, `components/PrimaryTimeline.tsx:35`). Measured: `#d2500e` is 4.702:1 on `--bg-panel` and 4.507:1 on `--bg-base`.

**The line.**
- **AS OF is MAX(`rating_date`) over the rater's cycle-2026 rows:** the reader's own stamp, Ballotpedia's widget caption date, else the scrape date, and for Sabato the race's newest change. The sync writes a rating only when it changes, so this is the rater's newest rating date, not its last read; for a live feed with no changes it understates. Nothing records a rater's last successful read, so that's filed, not fixed.
- **VIA comes from the `source_url` of the rater's most recently updated row:** `ballotpedia.org` by host is *via Ballotpedia* (the chip's own test); a direct reader's URL is *direct* (`DIRECT_SOURCE_URLS`, beside `SABATO_CHANGES_URL` in `lib/race-ratings-scrape.ts`, which holds that one URL today and takes the next direct reader's); anything else says no via.
- **Matching the rater's own domain can't stand for DIRECT:** the seed wrote each rater's own chamber page as `source_url` (each file's `source_url_base`) on rows that came from Wikipedia, so a seed row would read *direct*.
- **The token** is `--rating-freshness: #d2500e`, for a rater's as-of and via and nothing else (HO 610's rule): 4.70:1 on `--bg-panel` and 4.51:1 on `--bg-base`, both AA at 12px.

**§ 1, the data and the component** (`feat` `62bacb3`).
- **`getRaterFreshness`** (`lib/queries.ts`, `unstable_cache`, a day, tag `race-ratings`) runs the handoff's query and returns, per rater with rows, `{ asOf, via }`. A rater with no rows is absent, and the line still names and links it without a clause.
- **`getRaceRatings`' comment** now says the sync writes a rating when it changes and expires the tag at the end of a run that doesn't throw, and that a run that throws expires nothing.
- **`components/RatingSourcesLine.tsx`,** presentational with no hooks, renders `<p data-rating-sources>` at 12px, uppercase: *Ratings* in `--text-dim`, then per rater a hidden dot and `<span data-rater>` holding its name, linked as the chip links it (`sourceLabel`, now exported from `RatingChip`), and `<span data-rater-freshness>` in the token, each date `nowrap`. The raters keep the fixed order, Cook, Inside Elections, Sabato (`RATER_ORDER`).
- **`app/globals.css`:** the token on `:root`, and `.rl-sources` continuing the list box.

**§ 2, `/electoral`'s foot.** The page reads the freshness, and `RaceListView` renders the line in a footer under `.rl-box`, its links following the tab, with the box's border continued and its bottom corners squared while the footer is there.
- **`measure()` changes, the architect's call:** the box fills to the window's bottom, so a footer just appended would sit below the fold on the House tab, against v2's *make this more noticeable*. The box's height now gives up the footer's, and RACE NEWS runs to the footer's bottom, the two columns sharing one bottom edge. Under 900px nothing changes.

**§ 3, `/race/[id]`, under the chips.** The page adds the freshness to its `Promise.all`; `RaceHeader` renders the line after the chip strip, naming the strip's raters in the line's order, outside the strip's `div`, so never at the decided state's 0.55.

**§ 4, `/welcome`'s foot.** After FEC: *Cook · Inside Elections · Sabato*, each in `.footK` and linked to its House page (the board mixes chambers), then *ratings as of <date>* in the token (*<oldest> to <newest>* while the dates differ; nothing when none has one). The links underline on hover.

**§ 5, the guard** (`fix` `76cd610`). `main()` counts `race_ratings` before it reads a seed file; with rows and no `--force` it prints that the table has N rows and the seed is a first fill for an empty table that would write its snapshots over the synced ratings, sets exit code 1 and returns without a write. The header says first fill.

**The line's spacing** (`feat` `caa2b58`). The dots carried 6px side margins, as the mock's do, so the line's text ran *Ratings·Cook · as of …*, and a screen reader got *RatingsCook* past the hidden dot. A space either side of the dot parts the words, about 1.7px wider a side. Leg B's r1 read it (two FAILs, both this), and r2 reads the line word for word.

**The legs** (`diag` `cae3780`, `scripts/diagnostic/rating-sources-legs-784.ts`): **r2, 24 PASS and 1 FAIL, with the seed's 1 PASS and leg E's 4 PASS.**
- **The builds:** HEAD's (`372c433`) and the tree's (`caa2b58`; r1 ran `76cd610`), cold and secretless in scratch worktrees, exit 0 with no warning line.
- **The seed:** the real `scripts/migrate.ts` against a `file:` template, 23 tables whole from prod by `SELECT`, `bills` and `member_votes` cut, the newest 400 `cron_runs`; four copies (HEAD's, the tree's and leg E's two), each server's with its own sentinel. Prod's `race_ratings` and schema fingerprints equal before and after every mode.
- **A:** the prod read again, as STEP 0 read it, and both copies' `race_ratings` hash as prod's.
- **B, the smoke test** (the tree's *the ratings sources line names, links and dates the raters*, by Playwright against each server):
  - **HEAD red:** 1 failed, at its first assertion, *`/electoral`'s sources line*;
  - **the tree green:** 1 passed;
  - and read by the leg on the tree: `/electoral`'s line names the three raters in order, links the Senate pages and, after the HOUSE tab, the House pages, and reads A's text word for word; `/race/S-AK-2026`'s names the strip's three; `/welcome`'s foot links the three House pages and reads *ratings as of 2026-09-22 to 2026-09-29*. HEAD has no line and no rater link in the foot.
- **C, the box fit** on `/electoral`'s HOUSE tab:
  - **2560x1440 passes:** the document doesn't scroll, the line (one row, 39.5px) lies wholly in the window, and its bottom is RACE NEWS's (1423.25 against 1423.75);
  - **1440x900 FAILS:** the document scrolls 32px, and the line (two rows there, 53px, the main column being narrower than the mock's) ends at 916 of 900. The box is held at its 320px floor (`BOX_MIN`, mock-767's): its top is 543, which leaves 900 - 543 - 16 = 341px, less the line's 53 is 288;
  - **the counterfactual holds at both:** sized as before HO 784, the document scrolls by the line's height (53 at 1440, 39 at 2560);
  - **HEAD, the control,** has no line and doesn't scroll at either size.
- **D, the colours** on the tree: every freshness clause (7: `/electoral`'s three, `/race`'s three and the welcome foot's date) reads rgb(210, 80, 14); every rater name (9) reads rgb(148, 163, 184), as do the three chip names; the lowest contrast against its computed background is 4.51:1 (the freshness on `--bg-base`), the names 7.54:1.
- **E, the seed** on scratch copies, each run in a worktree with no `.env` under an environment carrying its copy's URL and none of ours:
  - **HEAD's script** on a table of 268 rows: exit 0, `updated_at` moved on 167 of the files' 248 ids, 114 rows rewritten with the snapshots, and 81 inserted;
  - **the tree's:** exit 1 with the message (*race_ratings has 268 rows; …*), and the table hashes the same before and after;
  - **the tree's with `--force`:** exit 0, the same 167, 114 and 81.
- **F, captures** (`docs/handoffs/784-artifacts/captures/`): `/electoral` on Senate and House, `/race/S-AK-2026` and `/welcome` on the tree at 1440 and 2560, again with reduced motion, and HEAD's at 1440, 20 files, eyeballed styled. CI's `narrow-preview` and the Preview's 430 captures follow the review push.
- **Locally at 430 and 390** (the tree, before the push): the three routes overflow by 0, and the line wraps to four rows (`narrow-local-r2.txt`, and two captures at 430, `tree-local-*`).

**Docs (HO 784):**
- This block.
- **backlog, 3+/1−:**
  - **The `seed:ratings` line is struck** on leg E.
  - **Filed at the top:** the sources line's AS OF is a rater's newest rating date, not its last read (*Owner:* Code, low), and the general-ballot route's header (HO 783's FF paste, note 1; *Owner:* Code, low).
- **OPEN LOOPS reconciled:**
  - open: 265 live / 352 struck (617), § OPEN LOOPS `:14-215` 64 / 123;
  - close: **266 / 353 (619), § OPEN LOOPS `:14-217` 65 / 124**;
  - the control, `^- \*\*~~`, is 0 at both.
- **SKILL, its own commit, last:** the palette gains the token; the ratings section gains the sources line; the seed's two descriptions say it refuses a table with rows unless run with `--force`; and the sentences this HO made false are rewritten (named in the paste).
- **Also notes now run through HO 784.**

**Also (HO 785), handoffs 662 to 784 ride as one tracked gzip, the way 362 to 661 do: 245 files, with the directory's ignore untouched. It opens with HO 784's FF go as taken.**
- **What's here:**
  - HO 784's FF go as taken, with the two notes it asked this block to record;
  - STEP 0;
  - M1, the census; M2, the archive read back; M3, the ignore;
  - a secret check before the push, which the handoff didn't ask for, and the review reply's wider scan;
  - the review reply's rulings, and the halt ruling on the wider scan's two findings;
  - the README sentence, its last clause reworded at the review reply.
- **Two commits, kinds unmixed:** `chore` (`c58cbb1`, the archive alone) · `docs`. No SKILL commit: neither SKILL nor method.md names the archive (`handoffs-archive`, 0 hits in each).
- **Why now:** the CBT Project moved accounts on 2026-10-18. Everything after HO 661 in `docs/handoffs/` was on one disk and in one Project's knowledge. HO 662 priced the trade and Corey took it; this HO takes it again for the next range.
- **The range starts at 662:** HO 662 archived through 661 and left its own file out, so `662-pre-migration-sweep.md` was the one hole. This archive closes it and leaves `785-handoff-archive.md` for the next.
- **The pointer is 785:** pointer 784 (`docs/roadmap.md:6763`), highest HO in commit subjects 784, `main` at `9784a47`.

**HO 784's FF go, as taken** (`docs/handoffs/784-artifacts/ff/paste-784-ff.md`).
- **The FF:**
  - immediately before it, the cold build (Node 24.21.0, 19:44:52-19:45:23Z, exit 0, *Compiled successfully in 8.9s*, no warning line) and the cheap gates (green);
  - then `372c433..9784a47`, 7 commits, no force (2026-10-14 19:45:39Z). The classifier didn't block it;
  - `784-review` deleted, remote and local, and `main` reads `9784a47b9087…`.
- **`verify:deploy`, in the foreground:** first matched at 41s, five consecutive reads at 83s.
- **The Production build,** `dpl_5PkorJfUuMUSsY5Mo1VEHRqjUKoU` (`bld_hdbe3g739`, iad1), skipped the build cache: *VERCEL_FORCE_NO_BUILD_CACHE is set so skipping build cache step.* at 19:45:49.026Z. It compiled in 9.4s and went READY at 19:46:34.939Z. Its log, read whole in two windows, held no Next warning line.
- **Vercel's records came at most 1s after READY:** Production's (7075542310) at 19:46:35Z against 19:46:34.939Z, and HO 784's review Preview's (7074747694) at 19:10:25Z against 19:10:24.443Z.
- **`e2e-prod`:** the Production record fired #38626503217 (19:46:37Z): `smoke` **142 passed (6.0m)**, one more than HO 783's 141, and all 39 crawl lines clean. **The new test passed on its first Production run:** `smoke.spec.ts:970`, *the ratings sources line names, links and dates the raters* (2.9s). Nothing was dispatched.
- **No flush:** `getRaterFreshness` is a new cache entry, so its first read is fresh.
- **The reading** (plain `curl`, 19:48:14Z):
  - `/api/version` reads `9784a47`;
  - Production's `/electoral` serves one `[data-rating-sources]` whose text equals leg A's, case-insensitively: *Ratings · Cook · as of 2026-09-29 · via Ballotpedia · Inside Elections · as of 2026-09-22 · via Ballotpedia · Sabato · as of 2026-09-29 · via Ballotpedia*, linking the Senate pages;
  - `/welcome`'s foot reads *ratings as of 2026-09-22 to 2026-09-29*, linking the House pages.
- **Leg C's corrected bound:** the page scrolls by `max(0, boxTop + box + line + pad − innerHeight)`, with the box at `max(BOX_MIN, fit)`. At 1440×900 that's 543 + 320 + 53 + 16 − 900 = 32, which is what leg C measured; at 2560 it's 0. The bound HO 784 carried missed `BOX_MIN`, so the FAIL was the bound's, not the build's, and the floor stands (option c).
- **mock-784's colours were a cascade bug in the mock.** v3's rules came earlier in its stylesheet than v1's, at equal specificity, so on `/electoral` and `/race` it draws the names in `--text-secondary` and the dates in `--text-dim`. **The mock is evidence for placement and text, not for its colours on those two surfaces.** The build follows Corey's v2 words and stands.
- **Since the FF:** no commit on `main`, and the four scheduled `e2e-prod` runs on `9784a47` (10-15 to 10-18) all read `success`.

**STEP 0** (a check, HO 768's rule), 2026-10-18 at `9784a47`: **all five claims hold.**
- **1:** `main`, `origin/main` and `ls-remote` read `9784a47` (*docs(skill): HO 784 — the ratings sources line…*), its Production reading passed (above), and `9784a47..origin/main` is empty.
- **2:** `.gitignore:79` is `docs/handoffs/`, with the HO 604 rationale at `:69-78`. No rule matches `docs/*.tar.gz`: `git check-ignore` on the 362–661 archive prints nothing and exits 1.
- **3:** `docs/handoffs-archive-362-661.tar.gz` is 829,609 bytes and 267 entries, every one `handoffs/<name>.md`, with no directory entry and no `*-artifacts/`.
- **4:** `git ls-files docs/handoffs` lists 386 files; the highest-numbered is `429-doc-sweep-427-428.md`, and one more, `home-dashboard-cleanup.md`, has no number.
- **5:** README carries the gzip at `:133-135`, its only mention (`tar.gz`, `gzip`, `handoffs-archive`: `:133` alone). The sentence § 2 rewrites starts at `:131`, but its first two lines stand, so the edit replaces `:133-135`.

**M1, the census** of `docs/handoffs/`'s top level (1,031 names, 486,204,666 bytes), before this HO's artifacts folder existed. A name is in range when it starts with a number from 662 to 784 followed by `-`.

| Reading | Value |
|---|---|
| in-range `.md`, archived | **245**, `662-pre-migration-sweep.md` to `784-rating-sources-line.md`, 2,170,669 bytes raw |
| HOs 662–784 with no `.md` | **3:** 736, 739 and 762, each with only its `*-artifacts/` |
| in-range `*-artifacts/`, excluded | 92 directories, 6,137 files, 412,785,304 bytes |
| other in-range names, excluded | **19**, 2,651,041 bytes: 11 loose files (`663-review-diff.txt`, `674-artifacts-backfill.log`, `684-skill-diff.txt`, `685-skill-diff.txt`, `687-skill-diff.txt`, `689-skill-diff.txt`, `719-docs-and-skill.diff`, `723-docs.diff`, `724-code-and-docs.diff`, `724-skill.diff`, `727-skill-diff.patch`) and 8 directories not named `*-artifacts` (`731-artifacts-postff`, `731-scratch`, `732-artifacts-daily`, `732-artifacts-postff`, `733-artifacts-daily`, `733-artifacts-postff`, `733-artifacts-sample`, `733-scratch`) |
| no numeric prefix, excluded | 2: `home-dashboard-cleanup.md` (tracked) and `registers-crosswalk-new-gray-pins-handoff-2026-09-26.md` (another repo's handoff) |
| numbered above 784 | 1, `785-handoff-archive.md`, so no HALT |

- **The HOs the handoff expected without a project file mostly have one on disk.** Of 662, 690, 713–717, 721, 739, 758, 759, 761, 762, 765, 766, 782 and 783, only 739 and 762 have none. 662 is present, as expected, and the other fourteen have a spec, a relay file or both.
- **Appendix A against the disk: 102 of its 105 are on disk.** Three aren't:
  - `671-sponsor-portrait-always-on.md` and `672-title-weight-breaking-sans-topic-colour.md`, whose slugs are on disk as `673-…` and `674-…` (HO 673 shipped the sponsor portrait);
  - `736-fed-cut-second-horizon.md`, under no name on disk. HO 736 shipped the advancer status, and its number has only `736-artifacts/`. **It stays out, the review reply's ruling:** that spec never ran. HO 681's fork B is still live (`docs/backlog.md:230`), and the number 736 shipped as the advancer fix (`docs/roadmap.md:2542`), so archiving it would put a second, different 736 beside the roadmap's. It stays in the Project for when fork B is built under a fresh number.
- **Appendix B against the disk: 95 of its 108 are on disk and ride.** 13 aren't, as B expects: `670-review-reply`, `670-skill-approval`, `671-reading-c-authorisation`, `671-skill-approval`, `671-step0-approval`, `672-step1-ruling`, `672-step2-ruling`, `672-worddiff-export-failure`, `686-ff-go`, `687-ff-go`, `688-ff-go`, `689-fork-rulings`, `692-step0-ruling` (each `.md`).
- **On disk and in neither appendix: 48, and they ride** (each `.md`): `662-pre-migration-sweep`, `673-sponsor-portrait-always-on`, `674-title-weight-breaking-sans-topic-colour`, `678-pasteback`, `690-dashboard-chrome`, `696-reply2`, `696-review-reply`, `696-step0-ruling`, `697-a-prime-ruling`, `697-beta-clock-plex-mono`, `697-tag-arms-ruling`, `699-stats-strip-tiling`, `702-review-reply`, `703-step0-rulings`, `704-midflight-reply`, `705-step0-ruling`, `706-step4-ruling`, `712-congress-rollover`, `712-ff-go`, `712-step0-ruling`, `713-absence-watch-dark`, `713-ff-go`, `713-step0-ruling`, `714-absence-watch-two-zeros`, `714-ff-go`, `715-committee-votes-probe`, `715-ff-go`, `715-step0-ruling`, `716-ff-go`, `716-weekly-band-390`, `717-ff-go`, `717-recorded-votes-pointer`, `717-step0-ruling`, `718-electoral-report`, `721-step0-ruling`, `721-vote-col-flow-marking`, `724-step0-paste`, `730-step0-ruling`, `747-pass2-ruling`, `758-race-page-shows-the-result`, `759-incumbent-qualifier-by-kind`, `761-runoff-rounds-ingested`, `765-pac-rungs-read-the-ballot-first`, `766-select-codes-and-daily-comments`, `768-ff-go-amended`, `782-cook-seed-files`, `783-ff-go`, `783-general-runoff`.
- 102 + 95 + 48 = 245, the archive's count.

**M2, the archive read back** (`docs/handoffs-archive-662-784.tar.gz`, built by GNU tar 1.35 with `-C docs` from a list file sorted by name):
- `gzip -t` is clean. There are 245 entries, equal to M1's count, and every one is `handoffs/<name>.md`, with no directory entry, no `*-artifacts/` and no `785-`. The entry list equals the census list.
- **Every entry streamed out matches its working copy's md5: 245 match, 0 mismatch.**
- **The control,** once and not archived: `784-rating-sources-line.md`, copied to scratch with one byte appended, reads a mismatch against its entry (`f12f60a9…` against `8b515cac…`), and the entry still matches the disk.
- **746,432 bytes from 2,170,669 raw, 2.91×** (362–661's was 2.79×).

**M3, the ignore:**
- `git check-ignore -v docs/handoffs-archive-662-784.tar.gz` prints nothing and exits 1;
- **the control,** `docs/handoffs/785-handoff-archive.md`, prints `.gitignore:79:docs/handoffs/` and exits 0;
- `git status --porcelain docs/` shows the archive as `??` and no handoff file. It was staged by its pathspec alone.

**A secret check over the 245, before the push** (not in the handoff; the repo is public, so the review push publishes them):
- **By name:** the repo's 13 env names and 10 more credential names, reporting only `file:line`, the name and the length of the token that follows. **By sha256:** the 10 current `.env` values against 52,523 file tokens. Each arm fired on a planted control first.
- **No credential.** There were 12 name hits:
  - 7 are names followed by other names, in lists of names (HOs 678 and 679);
  - 2 are 6-character `api_key` fixtures in HO 679's redaction test cases, and 2 more are that HO's `TRACER679…` tracer and `FIXTURE_CONGRESS_0123456789`;
  - 1 is a `file:` database URL in HO 724.
- There was 1 hash hit: HO 726's `http://localhost:3000/api/revalidate`, which is the local `REVALIDATE_URL`.
- Shape counts (JWT, Google key, GitHub token, `_vercel_share=`, a bypass header with a value) read 0 each; their control read 1.

**The review reply** (2026-10-18):
- **`c58cbb1` stays.** Code committed it before checking Corey's commit rule, but it's on `785-review`, local, and `main` hadn't moved. On a public repo the review-ref push is publication, not staging, so the push waited for Corey's paste of the reply.
- **Flag 1, the secret check:** accepted, and widened before the push (below). It hashed today's `.env`, so it couldn't see a key rotated at HO 680 or a credential this machine never held.
- **Flag 2, the README clause:** reworded (below), and the Project's 736 spec stays out (M1, above).
- **Flag 3, the artifacts folder's re-run census:** accepted.

**The wider scan: HO 678's instruments over exactly what publishes.** `c58cbb1`'s archive blob (`git hash-object` equal to the committed `117b25c6…`) was extracted to a scratch folder outside the repo: 245 files, 2,170,669 bytes.
- **gitleaks 8.30.1, default rules, `gitleaks dir <scratch> --redact`: 2 findings,** both `generic-api-key` in `679-emission-sink-redaction.md`:
  - `:66`, the `FIXTURE_CONGRESS_…` fixture (27 chars, all capitals, digits and underscores);
  - `:78`, the `TRACER679…` tracer.
  - Both were classified by shape from the report's column span, and neither was printed.
- **gitleaks's control:** a fake `ghp_` token planted in a scratch `handoffs/785-control.md` read 1 `github-pat` finding, redacted.
- **gitleaks on the gzip itself:** at the default `--max-archive-depth 0` it reads 0, because it doesn't open archives; at depth 2 it reads the same two findings. So a default gitleaks run over the repo can't see inside either archive.
- **Arm B, after HO 678's instrument B: 0 hits.** It compares the sha256 of each of the 8 held secrets' full value and first 8 chars against every window of the same length in every file: 17,136,852 windows, a superset of comparing candidate tokens.
  - There was one config hit, HO 726's localhost `REVALIDATE_URL`, as above.
  - The auth trio isn't held on this machine, so gitleaks is the instrument for that half.
- **Arm B's control:** the script wrote `CONGRESS_API_KEY`'s first 8 chars into a scratch file inside filler text, never printing them. It read 1 `prefix8` hit, and the file was deleted afterwards.
- **The same instruments over the 362–661 archive,** an extra reading outside the reply's ask. That archive has been public since HO 662, inside a gzip HO 678's history scan couldn't open:
  - gitleaks reads 0;
  - arm B reads 0, with one config hit: `TURSO_DATABASE_URL`'s full value in `602-doc-sweep-600-601-platform.md:68`, which HO 678 classed as configuration.
- **The HALT:** the reply's rule is that any hit halts before the docs commit, so the two 679 findings HALTed it, pasted redacted.
- **The halt ruling (Corey's paste): both findings ride as fixtures.** Nothing is redacted or edited, and the archive at `c58cbb1` stands as built.
  - `:66` is fixture 7, a stub the redaction test sets itself: `CONGRESS_API_KEY` given `FIXTURE_CONGRESS_` and the digits 0 to 9 in order. The block names it by shape, because quoting the assignment trips gitleaks' `generic-api-key` rule in tracked text (this block's first draft did).
  - `:78` is the tracer the control plants: `TRACER679_`, the digits 0 to 9 in order, then the letters a to f in order. The file calls it *a fake key* at `:76`.
  - Arm B reads neither as a current secret or the start of one.
  - The 362–661 reading stands as HO 678 classed it: `TURSO_DATABASE_URL` is config, not a secret.
  - **Filed:** gitleaks reads 0 inside both gzips at its default archive depth and finds the two at depth 2. So a QUEUED line (`docs/backlog.md:220`) now requires any scan that claims an archive's coverage to run at depth 2 or over the extracted set, and every future archive to be scanned extracted before it's committed.

**README** (`:133-137`, 5+/3−): the sentence is rewritten as the handoff gives it, with N = 245, wrapped to the file's width, and nothing else in the file changed. Its clause *less the HOs that shipped as inline blocks and have no file* didn't fit 736, whose number has a spec in the Project but none on disk. The review reply reworded it to state the measurement and no reason: *in 662–784, HOs 736, 739 and 762 have no file.*

**Docs (HO 785):**
- This block, and the README as above.
- **backlog, 1+/0−:**
  - **Nothing to strike.** At open, no live line named the archive (none in OPEN LOOPS, as the handoff said). The hits for `archive`, `local-only` and `after 661`, at this commit's line numbers:
    - struck lines: `:156`, `:187`, `:222`, `:674` and `:869`;
    - two lines calling `*-artifacts/` files local-only (`:390`, `:410`), which stays true, since the archive excludes those folders;
    - `fit-finish.spec.ts`'s manual posture (`:620`).
  - **Filed at the top of QUEUED** (`:220`), the halt ruling's instrument-family line: gitleaks at its default archive depth doesn't read inside the handoff archives (*Owner:* Code, standing).
- **The reconcile:**
  - open: 266 live / 353 struck (619), § OPEN LOOPS `:14-217` 65 / 124;
  - close: **267 / 353 (620)**, § OPEN LOOPS `:14-217` 65 / 124, the new line being QUEUED's;
  - the control, `^- \*\*~~`, is 0 at both.
- No SKILL commit and no oddities entry.
- **Also notes now run through HO 785.**

**Also (HO 786), the sources lines: a surface that renders an upstream's data names it where the data sits. senate.gov, LDA, 270toWin and Ballotpedia get a line in HO 784's register, and the news meta prints publisher names, not slugs. It opens with HO 785's FF go as taken.**
- **What's here:**
  - HO 785's FF go as taken, with the four records it owes;
  - the review reply's rulings, and the departures it settled;
  - STEP 0, three claims falling to their own rules, none a HALT;
  - a correction to the chat audit this HO comes from (`/primaries`);
  - the line, the URLs, the six surfaces and the news names;
  - legs A to I and the smoke test, r3 on the committed code;
  - what's held, and what the terms say.
- **No ruling was needed** (method.md § Roles): a per-surface line in HO 784's ruled register is a non-fork call, and it pre-empts neither open fork, the footer + `/sources` surface or FMP's licence.
- **Six commits, kinds unmixed:**
  - `refactor` (`72d999a`), `fix` (`1b77b32`) and `feat` (`786d1b4`), the foot's nowrap phrases and dates riding the last;
  - `diag` (`feb73d0`), `docs`, and `docs(skill)` alone and last.
  - The first push carried `feat` as `23dbc61`. The second reply's amend (the dates) rode it, and the later commits were replayed onto it, so the ref moved by `--force-with-lease`.
- **No migration and no prod write.** Prod was read by `SELECT` only, its schema fingerprinted before and after every mode.
- **The local copy's read cost, on record** (HO 597's failure mode): the seed read all 56 tables whole **once**, and every later mode reused its copies.
  - That's 1,452,565 rows in 402 page queries, and a page reads what it returns. Measured over hrana `/v2/pipeline` on four of the seed's own page queries: 4000 of 4000, 4000 of 4000, 4000 of 4000 and 1500 of 1500.
  - **So about 1.45M `rows_read`,** about 0.06% of the plan's 2.5B a month (HO 602), plus a few hundred for the schema reads.
  - The calibration cost 13,502. The planning pass's bare `COUNT(*)`s under-report, by HO 624's trap, and aren't priced.
- **The pointer is 786:** pointer 785 (`docs/roadmap.md:6885`), highest HO in commit subjects 785, `main` at `692b276`. The HO was first written as 785 against `9784a47`, before the handoff archive landed under that number; every anchor was re-read at `692b276`.

**HO 785's FF go, as taken** (`docs/handoffs/785-artifacts/ff/paste-785-ff.md`; the close read the remote itself).
- **The FF:**
  - immediately before it, the cold build (Node 24.22.0, 23:37:37-23:38:11Z, exit 0, *Compiled successfully in 10.1s*, no warning line) and the cheap gates (green);
  - then `9784a47..692b276`, 2 commits, no force (2026-10-18 23:39:02Z). The classifier didn't block it;
  - `785-review` deleted, remote and local, and `main` reads `692b276f6981…`.
- **`verify:deploy`, in the foreground:** first matched at 1s, five consecutive reads at 41s. A plain `curl` of `/api/version` (23:42:48Z) read `692b276`, `no-store`, `X-Vercel-Cache: MISS`.
- **The Production build, no dedup:** `dpl_5TLwQAxTaEz6JpADx7vt3mowQpLS` (`bld_mh37sa1nl`, iad1), created 23:39:06.810Z, 5s after the push.
  - It skipped the build cache (*VERCEL_FORCE_NO_BUILD_CACHE is set so skipping build cache step.* at 23:39:09.483Z), compiled in 8.5s and went READY at 23:39:49.568Z. Its log, read whole in two windows, held no Next warning line.
  - HO 540's case (`docs/oddities.md:700`) didn't recur: the review Preview of the same SHA (`dpl_F6rwkmvVVsA2ZZdM9v8aZcx99yRz`) and the Production build are two deployments, two hours apart.
- **Vercel's records came under 1.5s after READY** (GitHub stamps whole seconds, so the lag is a bound): Production's (7162462657) at 23:39:50Z against 23:39:49.568Z, and the review Preview's (7161144790) at 21:39:53Z against 21:39:52.795Z.
- **`e2e-prod`:** the Production record fired #39177458645 (23:39:51Z): `smoke` **142 passed (5.3m)**, HO 784's `smoke.spec.ts:970` among them, all 39 crawl lines clean. Nothing was dispatched.
- **No flush:** no cached read changed.
- **The four records the go owes:**
  1. **The fixture literal at `docs/roadmap.md:6837` stands.**
     - That line is in the by-name check's hit list (`:6835-6838`), not gitleaks' (`:6849-6852`, where fixture 7 is named by shape at `:6850`). The go placed it in gitleaks' list, and the close confirmed the by-name placement against the ref.
     - It's HO 679's synthetic string, tracked at `scripts/diagnostic/redact-fixtures-679.ts`. A re-scan of the committed block (`692b276:docs/roadmap.md:6765-6885`) read gitleaks 0 and arm B 0 secret hits; its one config hit is the localhost `REVALIDATE_URL` quoted at `:6839`.
  2. **The 771 and 777 readings:** against the Project's copies, the disk is the later text both times: `771-ratings-daily.md` by a 4-byte code-fence indent, and `777-ff-go.md` by a revision of the go.
  3. **The 48 disk-only entries are the archive's surplus over the Project:** 195 byte-identical and 2 differing make 197, M1's appendix names on disk (A's 102 and B's 95), and 197 + 48 = 245.
  4. **Production serves `692b276`,** built fresh, with no dedup (above).
- **Chat side, the same day (the close):** the Project's knowledge was backfilled from the archive (the 48 and the two later texts), and the Drive mirror was audited against it, 268 for 268.

**The review reply (2026-10-19, three pastes: the go, its additions, and one amend on the ref), and the departures it settled:**
- **The HALT before any commit.**
  - Code built and read everything, then held before the first commit. It cited the user's standing rule (*"Never commit, push or run a destructive git operation until I've approved the diff"*) against the handoff's *"build through to the review push without stopping"*.
  - The reply read the hold and set the rule as this repo practises it, the review-ref route: commits on `786-review` are local and are how the diff is shown, the push is the publication, and Corey pasting the reply approves it.
- **STEP 0's three fallbacks stand,** as the HO's own rules.
- **Decision 2, `/electoral`'s fit, is accepted as a recorded cost, with no tuning.** The consequence was captured rather than discovered:
  - the line and its 6px gap move everything under the band down 24px;
  - **at 1440×900,** where the box holds its 320px floor, the document scrolls **56px, where HEAD's scrolls 32,** on both tabs (box top 543 → 567);
  - **at 2560×1440** the box gives the space back (HOUSE's 809 → 781px high, its top 575 → 603), and nothing scrolls on either tab, before or after.
- **Decision 3, the welcome foot:** *synced 4× daily* and the sync time with its *MT* are each one phrase, so each is in a `whitespace-nowrap` span, as `RatingSourcesLine` keeps the raters' dates whole (`:74`). The foot breaks between phrases, never inside one, and two rows at 1440 stand (leg G, below).
  - **The first push read worse at 430, and it was pasted, not reverted:** the foot took a fifth row (four on HEAD), and its date range broke at a hyphen (*2026-* / *09-29*), a phrase that ruling didn't name. *LAST SYNC* dropped from four rows to two, its time whole.
  - **The amend:** each date of the *ratings as of* range sits in its own `whitespace-nowrap` span, and only *to* may break. `ratingsAsOf` keeps the range's two ends rather than one string. r3 reads the foot at 430 in 5 rows, as before the amend (4 on HEAD), each date whole and the break inside the range at *to* (*ratings as of 2026-09-22 to* / *2026-09-29 · synced 4× daily*), with *LAST SYNC* in 2 rows, its time whole.
- **Decision 4, the SKILL note:** Ballotpedia's copyright page, `https://ballotpedia.org/Ballotpedia:Copyrights`, read 2026-10-19 from the chat side (the dev box reads a 403).
- **The two extra backlog lines stand,** for a close of 277 with the QUEUED line below. The race-page gap is named by subject, and its close stores the Ballotpedia page URL per race at harvest time.
- **The 403:** the box read a 403 from `ballotpedia.org`, where SKILL records a 202 challenge for the reader. It's recorded on the dropped-link line and not acted on, since the reader runs from Vercel's egress.
- **The six LF → CRLF files:**
  - The Edit and Write tools left `app/vote/[id]/page.tsx`, `components/BillExpandPanel.tsx`, `lib/news-sources.ts` and the three new files LF.
  - Git normalizes them, and the numstat read true. But the clone's working tree is CRLF, so all six were put back with a script that refuses mixed and lone-CR files, and the numstat read the same after.
  - The first count of them was blind: `grep -c $'\r$'` can't count CRs on this box.
- **The index skew:**
  - The legs' copies lacked `idx_bills_dash_stage` and `idx_bills_dash_topics`, which prod has and `scripts/migrate.ts` doesn't make.
  - So `/stale` answered 500 on both builds (*no such index*, from `lib/queries.ts:7311`'s `INDEXED BY`).
  - Filed QUEUED (data integrity). SKILL has no local-copy recipe to carry them; its schema lists both (HO 241).
  - **The full width run's last stretch at 390 also timed out on both builds, and that isn't the indexes'.** r2 made them and still left 5 cells unread on HEAD and 6 on the tree. The instrument half is an oddities note.
- **`--fit` isn't a departure:** it's HO 784's leg C, read again, because the line moves `/electoral`'s box.
- **Backlog `:184`:** the cause is appended as a dated note, an inserted paragraph with no strike.

**STEP 0** (a check, HO 768's rule), 2026-10-19 17:08-17:30Z at `692b276`: **claims 1, 2, 3 and 6 hold; 4, 5 and 7 fall to their own rules, none a HALT.**
- **1:** `main`, `origin/main` and `ls-remote` read `692b276`, the tree clean.
- **2:** every anchor in the handoff reads as stated. Two things beside them:
  - `lib/primary-calendar-scrape.ts` also exported `PRIMARY_CALENDAR_URL = CALENDAR_URL` (`:142`), imported by nothing; the move takes it out;
  - the Senate sync's header names the detail path (`lib/senate-votes-sync.ts:4`), which would be leg C's second site; it now points at `senateRollCallUrl`.
- **3, senate.gov:** `senateRollCallUrl(…, "htm")` answers 200 with the roll number in the body on `senate-119-2-256`, `senate-119-1-458` and `senate-119-1-1` (the newest, the median and the oldest of 915), as does the sync's `.xml` beside each.
- **4, the homes:** `https://lda.gov/` answers 200, landing on `/system/public/`, and 270toWin's calendar 200. **`https://ballotpedia.org/` answered Playwright with a 403,** CloudFront's *The request could not be satisfied*, from the dev box, whose IP Ballotpedia's wall has challenged since HO 773. By the claim's rule the link drops and the name stays: `/electoral` names Ballotpedia unlinked, and there's no `BALLOTPEDIA_HOME_URL` (filed).
- **5, the welcome board:** eight of the nine datasets read Congress.gov, the news feeds or LDA. **Races reads Ballotpedia:** its incumbent tags come from `getIncumbentQualifiers`, which reads `general_ballot` (Ballotpedia's general-election box) and `primary_candidates` (its primary pages). By the claim's rule the foot names Ballotpedia too. Members' query reads participation for its MISSED sort (`member_votes`, a senator's from senate.gov), but the board prints only sponsored and enacted counts, so the foot doesn't name senate.gov.
- **6:** the handoff's `SELECT` returns `119-hr-10828` (`the_hill`, 13 mentions, not ceremonial); the control is `119-s-5588`, with one Politico mention.
- **7, recorded, not gating:**
  - **LDA:** three filings read from the API with the sync's key, by name. Each `filing_document_url` is `https://lda.gov/filings/public/filing/{uuid}/print/`, one pattern in the uuid alone, and each answers 200 (*LD-2 Disclosure Form*), **but no body carries its uuid,** in any case or without its dashes. The rule doesn't hold, so the line ships alone and the link is filed.
  - **House:** `house-119-2-314`'s `raw_json` carries `sourceDataURL` = `https://clerk.house.gov/evs/2026/roll314.xml`, a Clerk URL, so the House out-link is filed.

**A correction to the chat audit this HO comes from:** it named `/primaries` as an uncredited surface. `/primaries` is a 308 to `/electoral` (HO 333, `app/primaries/page.tsx:8`), so the primary data lives in `/electoral`'s timeline band, credited here, and in the dashboard's next-primaries line (`components/CompetitiveRacesBlock.tsx:176`), held with `/`.

**The line** (`feat`). `components/SourcesLine.tsx`, presentational with no hooks and no server-only import (`ElectoralBoard`, a client component, renders it), renders `<p data-sources>` with `RatingSourcesLine`'s classes: per group *<label> via <name>*, the label and *via* in `--text-dim`, the name in `--text-muted`, groups parted by the hidden dot with the spaces outside it. A name with an href is a `source-link` anchor in a new tab (`rel="noopener noreferrer"`), else a span. `app/globals.css` adds `.source-link` to the `.rater-link` selectors, one rule under two names. `RatingSourcesLine` isn't touched.

**The URLs** (`refactor`). `lib/source-links.ts`, import-safe, holds each out-link once:
- `senateRollCallUrl(congress, session, roll, ext)`, the path that was inline in the sync's `detailUrl` (`lib/senate-votes-sync.ts:131-137`), the roll padded to five digits. `detailUrl` calls it with `"xml"`.
- `PRIMARY_CALENDAR_URL`, moved from the scraper's `CALENDAR_URL`; the scraper imports it.
- `LDA_HOME_URL = "https://lda.gov/"`.

**The surfaces** (`feat`):

| Surface | The line |
|---|---|
| `/vote/[id]`, Senate | *Roll call via senate.gov* under the head, linked to `senateRollCallUrl(…, "htm")` |
| `/vote/[id]`, House | *Roll call via Congress.gov*, unlinked |
| `/members/[bioguideId]` | a senator only: *· Senate votes via senate.gov* at the end of the footer's attribution, plain |
| `/lobbying` | *Filings via lda.gov* under the header, linked to `LDA_HOME_URL` |
| `/electoral` | *Primary dates via 270toWin · Candidates and results via Ballotpedia* directly under the band, 6px under it (`.electoral-sources`), 270toWin linked to `PRIMARY_CALENDAR_URL` |
| `/welcome` foot | *· lda.gov · Ballotpedia* after *FEC*, plain, like *congress.gov*; *synced 4× daily* and the sync time each in a `whitespace-nowrap` span |

**News names** (`fix`). `newsSourceName(slug)` in `lib/news-sources.ts` returns the matching feed's `display`, else the slug with `_` as a space. `app/bill/[id]/page.tsx` and `components/BillExpandPanel.tsx` print `newsSourceName(n.source).toUpperCase()`, so a Hill row reads *THE HILL*, not *THE_HILL*.

**The smoke test:** `targeted interactions` gains *the sources lines name where the data comes from*: `[data-sources]` on `/electoral` (270toWin linked to `PRIMARY_CALENDAR_URL`, Ballotpedia named), `/lobbying` (`LDA_HOME_URL`) and `/vote/senate-119-1-1` (`senateRollCallUrl(119, 1, 1, "htm")`). HO 784's test finds the welcome foot as the span that holds *synced 4× daily* and the raters' links, since the phrase now has a span of its own and a text-only locator matched two.

**The legs** (`diag` `feb73d0`, `scripts/diagnostic/source-credits-legs-786.ts`): **r3, on the committed tree, 29 PASS and 0 FAIL; leg C 4 PASS; the width re-reads, 6 PASS; the fit 1 PASS.**
- **The builds:** HEAD's (`692b276`) and the tree's (`feb73d0`), cold and secretless in scratch worktrees under Node 24.22.0, each exit 0 with no warning line.
- **The earlier runs:** r1 ran on the tree before the commits (`692b276` plus the 15 changed files), and r2 on the first push's `94c0e2b`, before the dates' nowrap. They read the same except the foot.
- **The seed:** the real `scripts/migrate.ts` against a `file:` template, then every prod table copied whole by `SELECT` (56 tables, 452s) except `users`, `watchlist` and the FTS index, which `bills`' own insert trigger refills. There were two copies, each server's with its own sentinel. Prod's schema fingerprint read the same before and after every mode.
- **A, news names:** on `119-hr-10828`, HEAD's served page carries `THE_HILL` 10 times (5 in the DOM) and the tree's 0, with `THE HILL` 10 (5). The control, `119-s-5588`'s `POLITICO`, reads 2 (1) on both. The expand panel, opened on the bill's row in `/bills?sponsor=M001137`, reads `· THE_HILL · 1h` on HEAD and `· THE HILL · 1h` on the tree, 5 metas each.
- **B, vote pages:** `[data-sources]` reads 0/0 on HEAD and 1/1 on the tree.
  - `senate-119-2-256` reads *ROLL CALL VIA SENATE.GOV*, its one anchor `senateRollCallUrl(119, 2, 256, "htm")`.
  - `house-119-2-314` reads *ROLL CALL VIA CONGRESS.GOV* with no anchor, and the House page holds no `senate.gov` anchor (the control).
- **C, one copy of the Senate path:** for five real triples (119-1-1, 119-1-229, 119-1-458, 119-2-28, 119-2-256), HEAD's `detailUrl` string equals the tree's, and `senateRollCallUrl(…, "xml")`'s, byte for byte, and differs from the `"htm"` string (the control). `roll_call_votes/vote` is in `lib app components` once, at `lib/source-links.ts:15`.
- **D, the member line:** *Senate votes via senate.gov* reads 0 on HEAD and 1 on the tree on B001236's page (a senator); on M001137's (House), it reads 0 on both.
- **E, `/lobbying`:** 0 → 1, *FILINGS VIA LDA.GOV*, its anchor `https://lda.gov/`. The per-filing rule didn't hold (STEP 0), so no filing links.
- **F, `/electoral`:** 0 → 1, *PRIMARY DATES VIA 270TOWIN · CANDIDATES AND RESULTS VIA BALLOTPEDIA*, **with one anchor, not the handoff's two:** 270toWin's, `PRIMARY_CALENDAR_URL`. Ballotpedia is named, not linked (claim 4). The line follows the band, 6px under it, and `2026-state-primary-calendar` is in `lib app components` once (`lib/source-links.ts:19`).
- **G, `/welcome`'s foot:** *lda.gov* 0 → 1 and *Ballotpedia* 0 → 1 (claim 5); the three rater anchors read 3 on both. **The nowrap rulings**, read by a Range over each phrase's own characters, so HEAD's bare text reads on the same instrument:

| Width | HEAD: rows (foot / LAST SYNC); pieces (*synced 4× daily* / the time / each date) | The tree, every phrase and date nowrap |
|---|---|---|
| 1440 | 1 / 1; 1 / 1 / 1, 1 | **2** / 2; 1 / 1 / 1, 1 |
| 2560 | 1 / 1; 1 / 1 / 1, 1 | 1 / 1; 1 / 1 / 1, 1 |
| 430 | 4 / 4; 1 / **2** / 1, 1 | **5** / 2; 1 / 1 / 1, 1 |

  - The same row counter reads the tree's foot as 2 rows at 1440, the control that it can read a wrap.
  - At 430 the break inside the range falls at *to* (`tree-welcome-430`). The first push's capture, `captures/r2/tree-welcome-430`, shows the date it split (*2026-* / *09-29*).
- **H, the served stylesheet:** in the stylesheets `/lobbying` links, `.source-link` reads 0 on HEAD and 3 on the tree, and `.electoral-sources` 0 → 1.
- **The smoke test:** the tree's *the sources lines name where the data comes from*, run by Playwright against each server.
  - **HEAD red:** 1 failed, at its first assertion, *`/electoral`'s sources line* (`smoke.spec.ts:1035`).
  - **The tree green:** 1 passed.
- **The width reading, local** (`e2e/narrow.spec.ts`; the CI reading follows on `786-review`'s `narrow-preview`):
  - **Every full run left cells unread,** and the check that compared them passed anyway:
    - r1 (9 cells on HEAD and 10 on the tree): `/stale` answered 500, because the copies lacked the two indexes, and the last stretch at 390 timed out;
    - r2, with the indexes made (5 and 6): only the timeouts;
    - r3, on the amended tree (5 and 6): the same timeouts.
  - **The reading of record** is a fresh server per build and width, one worker, requiring the same cells read on both. At the first push's tree (`94c0e2b`, before the dates' nowrap) it read **41 of 41 at 390 and 41 of 41 at 430 on both builds, every cell `over=0`,** each changed surface among them. Before the commits it read the same.
  - At the amended head, CI's `narrow-preview` on `786-review` is the reading.
- **`/electoral`'s fit** (HO 784's leg C, read again) is the recorded cost above. It was read at the tree before the commits; the commits change nothing on `/electoral` since.
- **I, captures** (`docs/handoffs/786-artifacts/captures/`, 54 files from r3; r2's under `captures/r2/` and r1's under `captures/r1/`), eyeballed styled:
  - **The surfaces:** both vote pages, a senator's and a House member's pages, `/lobbying`, `/electoral`, `/welcome`, `/bill/119-hr-10828`, and `/bills` with its panel open.
  - **The views:** the tree at 1440 and 2560, again with reduced motion (18 of 18 read `prefers-reduced-motion` back true in the page); HEAD's at 1440; and the tree's at 430, each document `over=0` and each line inside the width.

**Held, untouched:** FMP (a licence question, Corey's), FRED's notice, Kalshi, Polymarket, the dashboard `/` and its tape, and the courtesy credits (unitedstates, the Wikipedia caucus seed, Census geometry). All but FMP wait on the footer + `/sources` ruling. What the terms say is in SKILL (External data sources, *Credits*).

**Docs (HO 786):**
- This block.
- **backlog, 13+/0−:**
  - **Nine lines at the top of OPEN LOOPS, newest first:**
    - the handoff's five: FMP's display licence, FRED's notice, the Kalshi agreement, Polymarket's and 270toWin's terms, and the global credit surface;
    - its two conditional lines, both filed by STEP 0: the House roll-call out-link and the LDA per-filing link;
    - two beyond its list, accepted: `/electoral`'s Ballotpedia link (claim 4, with the box's 403 against SKILL's 202), and the race pages' Ballotpedia link (5 of 470).
  - **One QUEUED line:** the two indexes `migrate.ts` doesn't make (data integrity).
  - **`:184`'s cause**, three lines inserted under it, the line itself untouched.
- **oddities, 14+/0−:** *A credit line can document a licence breach*, and *A check that compares only the cells that printed passes over what it never read* (both HO 786).
- **The reconcile:**
  - open: 267 live / 353 struck (620), § OPEN LOOPS `:14-217` 65 / 124;
  - close: **277 / 353 (630), § OPEN LOOPS `:14-229` 74 / 124**;
  - the control, `^- \*\*~~`, is 0 at both.
- **SKILL, its own commit, last:**
  - External data sources gains *Credits (HO 786)*, its Ballotpedia clause citing `Ballotpedia:Copyrights` (decision 4);
  - the member hub's footer sentence (`:1994`) gains the senator's clause, a sentence this HO made false.
- **Also notes now run through HO 786.**

**Also (HO 787), the GradShow poster's numbers: every figure the poster prints, read from the tree and prod with its predicate, its scope and its as-of time; a CRS spot-check pack for Corey to grade; and the odds snapshot Corey takes on Nov 2 and Nov 3. It opens with HO 786's FF go as taken.**
- **What's here:**
  - HO 786's FF go as taken, with its records;
  - STEP 0, a check: all eight claims hold, none a HALT;
  - what was read, A to G, and the three questions the handoff settled from the tree;
  - the labels finding;
  - the snapshot plan;
  - the review reply, taken before the push;
  - prod's `rows_read`.
- **No ruling was needed:** a diagnostic-only probe with its findings under `docs/probes/` is HO 715's and HO 747's shape, and nothing here touches app code, the schema, a sync or the database's contents.
- **Three commits, kinds unmixed:** `diag` (`52c201f`), then `docs` (the two probe files, this block, the backlog and the oddities), then `docs(skill)`, alone and last. The handoff's Docs section says each probe file is *committed alone*. Its Commits section lists one `docs` commit and *the three*, which is what HO 715 and HO 747 did, so this follows the Commits section.
- **No migration and no prod write.** Prod was read by `SELECT` only, through `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN` by name. Its schema fingerprint read `736e6b987bf77620` before and after every mode.
- **Prod's `rows_read` for the run** (HO 597's failure mode): **890,762** over 182 statements in six runs, summed off each hrana pipeline response, and every statement's result carried the field. That's `--numbers` r1 197,426, then r2, r3 and r4 217,513 each; `--crs-pack` 37,254; and the snapshot's dry run 3,543. It's about 0.04% of the plan's 2.5B a month (HO 602).
  - A count with no other predicate reads `WHERE id IS NOT NULL`, so its cost isn't under-reported (HO 624's trap).
  - Congress.gov took **90 requests** for the pack, all 200, with `CONGRESS_API_KEY` by name in a header, one request in flight and at least 1s between starts. SKILL sets the limit (`:46`), not a probe cadence. The completeness read made one more, on Oct 20.
- **The pointer is 787:** pointer 786 (`docs/roadmap.md:7050`), highest HO in commit subjects 786, `main` at `88d6327`.

**HO 786's FF go, as taken** (`docs/handoffs/786-ff-go.md`). The handoff names `786-close.md` for the records; there's no such file, and they were read from `docs/handoffs/786-artifacts/ff/paste-786-ff.md`.
- **The FF:** `692b276..88d6327`, 6 commits, no force (21:18:13Z, 3:18 PM MT Oct 19). `786-review` was deleted, remote and local, and `main` reads `88d6327`.
- **Production built fresh, with no dedup:** `dpl_EKMDSmrKmhZW7xbgnrzJ5Rxx728o` (`bld_28ohv615w`), created 5.8s after the push. It skipped the build cache and went READY at 21:19:08.787Z (3:19 PM MT).
- **`verify:deploy`, in the foreground:** its first read matched, and it held for five reads in a row (*first match at 0s*, five at 42s). The handoff says *matched at 1s*; that was HO 785's.
- **`e2e-prod` #39326531220,** fired by Production's record: `smoke` **143 passed (5.8m)**, HO 786's test at `smoke.spec.ts:1035` among them. Its narrow pass made **82 checks against Production**, 41 of 41 at 430 and 41 of 41 at 390, every cell `over=0`.
- **The CI 430 reading on the review head:** `narrow-preview` in #39314270842, 82 of 82, every cell `over=0`, the Preview serving `88d6327`.
- **The foot's 430 reading:** five rows (four on HEAD), every date and phrase whole, the range breaking at *to*.
- **The lag, read as two bounds** (GitHub stamps whole seconds): Production's record (7185251991) came 0.2 to 1.2s after READY, and its `success` status 1.2 to 2.2s after.
- **No flush,** as the go ruled.
- **Chat side:** the claude.ai `cbt` skill, rebuilt from `main`'s SKILL and uploaded, reads as blob `bcdd704` where it syncs to the dev box. That's `88d6327`'s SKILL, read 2026-10-19.

**STEP 0** (a check, HO 768's rule), 2026-10-19 at `88d6327`: **all eight claims hold; no HALT.** The table is the probe file's.
- **5 (record):** with `{}`, `${ceremonial}` reads ` AND (is_ceremonial = 0 OR is_ceremonial IS NULL)` (`lib/queries.ts:7423-7425`, by `:7512`). `bills_agg` has no Congress clause (`:7426-7444`); the members side is `m.is_current = 1`.
- **8 (record):** `congress = 119` (`getCurrentCongress()`) reads 19,106, as does no clause, so the table holds one Congress and every count is the 119th's.
- **The completeness read** (the review reply's, one call): Congress.gov lists **19,716** bills for the 119th (`/bill/119`, `limit=1`, its `pagination.count`, at 11:35 AM MT Oct 20, 17:35:41Z). That's **610 more** than CT's 19,106 at 7:54 PM MT Oct 19, about 20 days of introductions at the Congress's average pace, far more than a day's. So CT's rows aren't every 119th bill, and the poster's *Introduced* counts the bills CT holds. Which 610, and why, is unread (A).

**What was read** (`docs/probes/787-gradshow-numbers.md`; `--numbers` r4, 7:54 PM MT Oct 19 / 01:54Z Oct 20, is the reading of record):
- **A:**
  - `/welcome`'s own statements read **18,137 introduced and 120 enacted (0.7%)**, the poster's figures. Both sit inside the bounds the rows changed since its read allow: [18,082, 18,141] and [120, 120].
  - The ungated count is 18,137 too: at the read no non-ceremonial bill waited for a summary.
  - Law-eligible bills: 16,303, with 119 enacted (0.7%). 1,834 (10.1%) are resolutions that can't become law.
- **B:** 215 CRA resolutions and 18 enacted, 18 of 120 in both scopes: every CRA resolution is non-ceremonial and summarized, so the poster's mixed scopes change nothing today.
- **C:** the top 12 sum to **1,551 and 9** (current members, non-ceremonial, the 119th; resolutions counted).
- **D:**
  - HO 786, or 787 once this lands; 1,656 commits at `88d6327`.
  - The first commit is `c578e09` (May 3, 2026, 3:15 PM MT), earlier than the roadmap's first dated entry (2026-05-12, `:52`). The handoff's `git log --reverse … -1` prints HEAD instead (oddities).
  - `vercel.json` has 20 cron entries over 19 routes. The poster's *19 cron jobs* counts routes; the other six cron claims are in Corey's draft, which is chat-side, so the probe tables every entry in words.
  - Three workflows.
- **E:**
  - N is **99** rated races (86 House, 13 Senate). Kalshi covers 99, Polymarket 13, both 13, neither 0.
  - No per-race odds history exists anywhere.
  - `dashboard_state` holds nine keys, and `kalshi_chamber_control` is its only odds key.
- **F:** 90 drawn bills read: **3 independent, 31 shown, 56 with no CRS summary yet**. The pack is the 3 independent bills and the first 27 shown ones. Every bill read carries one CRS version, so the handoff's rule and the pack's stricter one agree.
- **G:** nothing in the tree counts visitors; Vercel Web Analytics is Corey's to read, if it's on.

**The three questions the handoff settled from the tree held when read:**
- the poster's figures are the summary-gated corpus, and today it equals the ungated count;
- the CRS summary is a model input (`lib/summarize.ts:219`), so F's pack marks each bill independent or shown;
- no per-race odds history exists, so E built the snapshot rather than HALT.

**The labels:**
- `computeStage` puts a bill that passed one chamber at `floor`. So the draft's *Passed one chamber = other_chamber+* (677) misses every bill waiting on its second chamber.
- The handoff's text rule adds only 8, because a passed bill's latest action is usually a later step: *Held at the desk*, a motion to reconsider, a message between the chambers. Read from each bill's latest action, **848 to 885 bills passed at least one chamber.**
- *Reached the floor* (1,472) holds 65 calendar placements the old model stored at `floor`, the BANKED *Deferred ~75-bill downward stage correction (HO 385)*.
- *Became law* (120) holds one Senate resolution, `119-sres-611`, stored at `enacted` by the old model (filed). Bills alone, 119.

**The snapshot plan:**
- `--odds-snapshot` writes `docs/probes/odds-snapshots/<YYYY-MM-DD-HHMM-MT>.json`.
- **The dry run** (7:57 PM MT) wrote `2026-10-19-1957-MT.json`, 192,299 bytes.
  - Its row counts equal the tables', 469 and 34.
  - 460 of the 469 Kalshi rows came from the newest tick (6:15 PM MT). The 9 older are California rows from Jun 30, none in N.
  - It was deleted, and a separate process read it gone.
- **Corey's three runs** (the review reply's), MST, each just after a :15 tick: **Monday Nov 2 at 9:30 PM, Tuesday Nov 3 at 7:30 AM, and Tuesday Nov 3 at 3:30 PM.** The third follows the 3:15 PM tick (22:15Z), the last before any poll closes: the first closures are at 6 PM ET (4:00 PM MST), and the next tick is 5:15 PM MST.
- The HO after the results commits the three files and computes *favorites won X of N*.

**Departures, named** (the probe file lists each):
- F's stricter independence rule;
- the pack's one added sentence on `updateDate`, written after the run. The committed instrument also adds a log line for the candidate list's hash, after `--crs-pack`'s run; its other modes are as they ran;
- D's first commit read by `git rev-list --max-parents=0 main`;
- the snapshot's 24-hour MT name;
- four `--numbers` runs as the instrument grew, every shared number the same;
- the completeness read from a scratchpad script, not the instrument, since the reply amends only the docs commits.

**The review reply** (2026-10-20), taken before the push:
- **Flags 1 and 2 were the architect's, and both corrections stand:** HO 786's records come from `786-artifacts/ff/paste-786-ff.md` (`786-close.md` is a chat-side file), `verify:deploy`'s first match was at 0s, and `git rev-list --max-parents=0 main` is the first-commit read.
- **Flags 3 to 8 didn't reach the reply** (the attachment cut them), so they ride in the push paste in full. None needs a ruling the HO's rules don't give, so the push didn't wait on them.
- **The `.next` junction, taken:** an oddities note in this commit, and one SKILL line in `docs(skill)`: before removing `.next` for a cold build, unlink any junction under it (`cmd /c rmdir`) and confirm the target intact. SKILL's only *Gotchas* heading is the Congress.gov API's (`:88`), so the line is the last of *Things to watch for* (`:2986`).
- **The completeness read, taken:** one call, recorded beside STEP 0's 19,106 above and in the probe file's A. The two differ by far more than a day's introductions, so the block says so.
- **One more OPEN LOOPS line,** owned by Code, low: the foot's *LAST SYNC* is Congress.gov's clock, not CT's; relabel it or source it from the sync's own time. The close count is 281, with the 610's line the second amend filed.
- **Three snapshot runs, not two:** the third at 3:30 PM MST Nov 3, after the last tick before any poll closes (the snapshot plan, above).
- **For the poster chat,** beside the probe file's table: *passed at least one chamber* prints the lower bound, at least 848; *reached the floor* is 1,472 as stored or 1,407 under today's rule, and the poster says which; the corpus as-of is Congress.gov's updates through 2:05 AM MT Oct 19.
- **Two consequences in this HO's own text:** the backlog's odds line names the three runs, and the table's *Introduced* scope names the bills CT holds.
- **Then** the build, the cheap gates and the push, with the two docs commits amended in place and `diag` unchanged.

**Docs (HO 787):**
- This block.
- `docs/probes/787-gradshow-numbers.md` and `docs/probes/787-crs-spotcheck.md`.
- **backlog, 4+/0−:** four lines at the top of OPEN LOOPS. One is the handoff's, the per-race odds history, owned by Corey, its runs now three. One is the loop the probe found, `119-sres-611` at `enacted`, owned by Code, low. The third is the reply's, the foot's *LAST SYNC* on Congress.gov's clock, owned by Code, low. The fourth is the second amend's, the 610 bills CT lacks, owned by Code. Nothing struck.
- **oddities, 18+/0−:** *`git log --reverse -1` prints the newest commit, not the first*, */welcome's LAST SYNC is the newest Congress.gov update among the counted bills, not the time CT synced*, and *Turbopack's `.next` holds a junction into `node_modules`…* (all HO 787).
- **The reconcile:**
  - open: 277 live / 353 struck (630), § OPEN LOOPS `:14-229` 74 / 124;
  - close: **281 / 353 (634), § OPEN LOOPS `:14-233` 78 / 124**;
  - the control, `^- \*\*~~`, is 0 at both.
- **SKILL, its own commit, last:** the pointer at the `/welcome` line (`:1975`), and the reply's line, the last of *Things to watch for* (`:2986`): before removing `.next` for a cold build, unlink any junction under it and confirm the target intact. The pointer: the banner's *Introduced* and *Became law*, and the foot's *LAST SYNC*, read the summary-gated corpus, and the two probe files are named. The handoff calls them *the foot's figures*; the two stats sit in the banner (`app/welcome/page.tsx:305-315`).
- **Also notes now run through HO 787.**

**Also (HO 788), the bills Congress.gov lists that CT lacked or held behind: named by type and number, their cause read off `/api/sync`'s own ledger as a join, and the ones that changed in substance repaired through `runSync`'s own upsert, the rest of the list read current on the read side only. It opens with HO 787's FF go as taken.**
- **What's here:**
  - HO 787's FF go as taken, with its records;
  - STEP 0, a check: claims 1 and 2 hold, no HALT;
  - the ledger, the census and the cause;
  - the HALT before `--repair`, the estimate and its correction, and the ruling;
  - the repair in two passes, and the censuses after it;
  - the ruling on flags 1 and 2, and pass 3: the seven written under the rule by instant, with a write-time guard;
  - the four readings the ruling asked for, and the list cache;
  - the budgets, and one sentence for the poster chat.
- **The probe file is `docs/probes/788-bills-gap.md`.** Every number below is the instrument's (`scripts/diagnostic/bills-gap-788.ts`), and its logs, list pages, census CSVs and allow-sets are in `docs/handoffs/788-artifacts/` (repo-ignored).
- **Three commits, kinds unmixed:** `diag` (the instrument alone), then `docs` (the probe file, this block, the backlog and the oddities), then `docs(skill)`, alone and last.
- **Prod was written only by ruling:** by the repair's `runSync`, through its own upsert, for the allow-set and nothing else, in passes 1 and 2 and again in pass 3. Everything else read prod by `SELECT` only, through `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN` by name. No product code, schema or sync code changed.
- **The pointer is 788:** pointer 787 (`docs/roadmap.md:7153`), highest HO in commit subjects 787, `main` at `7776ea3`.

**HO 787's FF go, as taken** (`docs/handoffs/787-ff-go.md`). These are the chat side's records, as the handoff lists them, each checked against the paste. The handoff names `docs/handoffs/787-artifacts/ff/paste-787-ff.md`; the paste is `docs/handoffs/787-artifacts/paste-787-ff.md`, one level up, and it agrees with every record below.
- **`main` at `7776ea3`:** `88d6327..7776ea3`, three commits, no force (12:27 PM MT, 18:27:05Z). `787-review` was deleted, remote and local, and local `main` was forwarded `--ff-only`.
- **Production built fresh, with no dedup:** `dpl_CoSJA5oi1ypMjgdTrCDG9WTC9TbD` (`bld_nf5c88ot5`), created 18:27:10Z. It skipped the build cache and went READY at 18:28:01Z (12:28 PM MT). The review Preview of the same SHA (`dpl_6ppK5w…`, 18:17:47Z) was a separate deployment, 9.4 minutes earlier.
- **`verify:deploy`, in the foreground:** first matched at 31s and held for five reads in a row (confirmed at 72s).
- **`e2e-prod` #39474983073,** fired by the Production record: `smoke` **143 passed (6.2m)**, and its narrow pass made 82 checks against Production, every cell `over=0`.
- **The record's lag, as a bound:** the Production record (7207815123) and its `success` came 2.6 to 3.6s after READY, the bound the whole-second stamps allow. That's slower than HO 785's (under 1.5s) and HO 786's (0.2 to 2.2s).
- **The served SHA:** the box read `/api/version` at 12:57 PM MT (18:57:01Z and 18:57:02Z), plain and with a fresh query string, and got `7776ea3` both times, with `Cache-Control: no-store`, `X-Vercel-Cache: MISS` and `Age: 0`. The production alias (`congressional-terminal-chi-silk.vercel.app`) resolves to `dpl_CoSJA5oi1ypMjgdTrCDG9WTC9TbD`. The chat side's fetch tool answered `88d6327` for over thirty minutes across fresh query strings, so a chat-side `/api/version` read is not a reading of record.
- **The `cbt` skill, rebuilt from blob `3a58079`:** the box's synced copy hashed `3a58079…` at 2:32 PM MT (20:32:26Z), one line, its file written at 12:57 PM MT (18:57:45Z).
- **The standing instruction until Nov 3:** Corey's three odds snapshots, MST, each at least five minutes after its `:15` tick: Mon Nov 2 at 9:30 PM, Tue Nov 3 at 7:30 AM and Tue Nov 3 at 3:30 PM, each `npx tsx scripts/diagnostic/gradshow-numbers-787.ts --odds-snapshot`. The HO after the results commits the three files.

**STEP 0** (a check, HO 768's rule), 2:28 PM MT Oct 20 (20:28Z) at `7776ea3`: **claims 1 and 2 hold; no HALT.** The table is the probe file's.
- **3 (record):** 19,127 bills, all 119th; `MAX(update_date)` 2026-10-20T17:49:25Z; `sync_state` empty.
- **4 (record):** 481 `/api/sync` rows. **The handoff's path was the anchor's error, so ruled:** `$.sync.*` reads 0 budget stops, and the path `lib/cron-log.ts:170-171` writes, `$.payload.sync.*`, reads 126.
- **5 (record):** Congress.gov lists 19,716, and the eight types sum to it.
- **6 (record): `fromDateTime` filters on `updateDateIncludingText`, to the second.** For `119-hr-10841`, a ±1 s window around that field lists the bill, and the same window around `updateDate` lists nothing. The list prints both dates as a bare day.
- **7 (record):** SKILL's local-run line is `:1240`, not `:1241`.

**The ledger** (`--ticks`): **126 of the 411** ticks whose stats carry `budgetStopped` stopped on the 30 s budget (30.7%), worst in June (54.5%) and July (56.9%), and 61 more rows timed out. `failed` and `timedOut` are 0 in every row, and `seen` peaks at 240, so no tick has read a second page. A budget-stopped tick gets through a median 63 `seen` and 57 `upserted`.

**The census, pass 1** (2:31 to 3:24 PM MT): the whole list, 79 pages plus 77 tie windows and a half-offset walk, 19,712 of 19,716 returned. **589 missing and 8,287 behind;** ahead 0, current 10,836, extra 4. The missing are mostly hr 9088–10544, s 4488–5677, hres 1303–1617 and sres 725–855, their latest actions mostly June (357) and July (148) 2026.

**The cause, a join on `cron_runs`:** each bill's owed tick is the first row whose window `[fromDateTime, started_at)` holds its `updateDateIncludingText`, to the second off one detail read. **583 of the 589 missing and 8,021 of the 8,287 behind were first owed by a tick that stopped partway** (budget-stopped 347 and 6,666, timed out 223 and 1,231, errored 13 and 124). That is shape 1, HO 116's stopped-tick tail. Shape 2, the page-boundary tie, has never been exposed in a tick. Shape 3, before the ledger, holds 6 and 196. 50 behind are the handoff's unexplained fifth reading, and 20 were dated after the last tick.

**The HALT, and the estimate's correction.** Pass 1 put 8,876 bills to write against the handoff's *about 900*. Every behind bill held a summary the upsert nulls, 43.3% of the corpus, and only 370 showed a newer latest action. So the HO HALTed before `--repair` and offered four options. **The ruling, option 3:** *the halt was right and the bound was mine.* The estimate carried HO 752's 3 of 200 from a sample of committee-walked bills, the recently updated ones, so it ran low by an order of magnitude for the corpus. The census's whole-list count is the reading (oddities). The cause is settled as shape 1, and *126 of 411 ticks budget-stopped, 61 timed out* is the capacity the next HO sizes from.

**The repair, as ruled.** It writes the census's missing and its behind with a newer latest action, each listed before the day of `MAX(update_date)` read immediately before the run. The rest of `runSync`'s list reads current on the read side only, and nothing is marked in the store.
- **Printed before the run** (7:25 PM MT, 01:25:13Z Oct 21):
  - the watermark, **2026-10-20T22:49:19Z**;
  - the allow-set, **950**: 585 missing and 365 behind with a newer action (the predicate read 368 at the run, against `--impact`'s 370);
  - the control, 7,919;
  - 7 excluded by the rule: `119-hr-9474`, `119-hres-1545`, `119-hres-1581` and `119-s-4914` (missing), and `119-hr-1653`, `119-hr-3514` and `119-hr-9640` (behind);
  - **all seven dated Oct 20 before the watermark instant,** so no tick lists them either. Flagged at the push: the rule's *a bill dated on or after that day is the cron's* holds only from the watermark on. Ruled, and pass 3 wrote them (below).
- **Pass 1** (7:25 to 7:37 PM MT, 11.9 min): `seen` 19,716, `upserted` **944**, `skipped` 18,772, `failed` 0, `timedOut` 0.
  - 944 detail fetches, every one an allow-set bill.
  - 944 rows stamped, all in the allow-set, 0 outside it; 581 new rows; the watermark unchanged.
  - The walk never listed 6 allow-set bills (the offset walk's losses).
- **Pass 2** (7:48 to 7:50 PM MT, `--from` 2026-08-10T11:51:26Z, one second before the residual's oldest date): `upserted` **6**, the six, 4 of them new rows.
- **Together: 950 of 950 written,** 585 inserted and 365 updated, with 48 stage advances logged at upsert. **`rows_written` 14,446 against the allow-set's 950:** the upsert 950 times (14,254 rows, 15.0 a bill) and `stage_transitions` 48 times (192). Every row came from `runSync`'s statements, and no pass wrote a bill outside the allow-set.

**After the repair** (the third census, 7:50 PM MT, the list complete at 19,716 of 19,716):
- **Missing: 4,** the frontier rule's four, the whole of Congress.gov's 19,716 against CT's 19,712 (pass 3 wrote them, below).
- **Behind: 7,897.** Of these, 7,890 are the control, plus the rule's three and four listed Oct 21 (the midnight tick's).
- **The allow-set reads 950 of 950 current.**
- **The control: `--impact`'s 7,917 read 7,890 still behind.** The 6:00 PM MT tick (#26680) wrote the other 27 before the repair began. Of the 988 rows stamped since census p1's snapshot, 950 fell inside a repair's window, every one in the allow-set, and the other 38 are that tick's.
- The second census (7:40 PM MT, after pass 1) read 8 missing and 7,899 behind. Its first run stopped on a page whose body was cut off mid-read; the instrument now retries one.

**The ruling on flags 1 and 2, and pass 3** (Oct 21, 7:11 to 7:41 PM MT):
- **Flag 1 was a hole in the frontier rule:** it was written by day, and the cron lists from the watermark instant, to the second. **The rule, restated by instant:** the allow-set is (missing ∪ behind with a newer action) dated strictly before the watermark instant, read at the run. A bill listed on an earlier day is in on its list date, and one listed on the watermark's day is placed by one detail read. **A write-time guard** in the view removes `bill` from any detail response dated at or past the instant, so `lib/sync.ts:411-414` counts it failed and writes nothing, and the watermark can't move.
- **Flag 2, ratified:** outside the allow-set, a stored bill reads current and an unstored one reads undated, and the sync skips both without a fetch.
- **Census p4** (7:11 PM MT): the four missing and 7,905 behind. The day since p3 added 21 behind, all listed Oct 21 and none with a newer action, and no missing. **So the allow-set was the seven.**
- **The day's ticks:** midnight, 6:00 AM and noon MT finished clean. **The 6:00 PM MT tick errored on a Cloudflare 520** at its first list page, so the watermark held at 2026-10-21T17:38:45Z.
- **r3** (7:16 PM MT): the watermark 17:38:45Z, read at the run. The seven were all listed Oct 20, a day before the watermark's, so the run made no placement read and excluded none. `upserted` **5**, and the guard removed none. The walk never listed `119-hres-1581` or `119-hr-9640`.
- **The `--from` pass** at 2026-10-20T08:05:19Z, one second before `119-hres-1581`'s date: r4 stopped on a 520 at its second page with nothing written, and r5 wrote both.
- **The seven, written:** 4 inserted and 3 updated, `rows_written` 105, the watermark unchanged throughout.
- **The closing census** (7:37 to 7:41 PM MT): **0 missing,** CT's 19,716 against Congress.gov's 19,716, and **7,902 behind, all by metadata alone:** census p4's control, every one still behind, none stamped by pass 3. The seven read current, and no bill in the gap sits outside the control. Of the 957 the ruling repaired, 956 read current; `119-hr-9467`, which pass 1 inserted, moved again on Oct 21 without a newer action and reads behind by metadata.
- **The three doc asks:** deviation 6(a) reads three; the list cache has its own heading in the probe, the half walk read as the tie windows again plus two pages; and the instrument's `--readings` label and comments read the unsettled wording.
- **One ride-along correction, flagged:** the probe's pass 2 said a `--from` pass moves every page boundary. Under `sort=updateDate desc` it doesn't: `fromDateTime` trims only the list's old end, and pass 2 listed `119-hr-9474` at offsets 0 and 250, as pass 1 did.

**The four readings the ruling asked for:**
- **The four stored bills no walk in census p1 returned** (`119-hr-4981`, `119-hr-4979`, `119-hr-4821` and `119-hr-5224`): **all 200, so Congress.gov dropped none; why no walk returned them is unsettled.** Each was updated on Oct 20 between 2:13 and 2:25 PM MT, 7 to 19 minutes before that census's walk read its first page, and the 6:00 PM MT tick has since written all four. Either the walk lost them, or Congress.gov's list lagged its detail (the handoff's fifth class, an entry that appeared in the list after its own `updateDate`), the plainer reading, since a bill updated minutes before a newest-first walk sits on its first page. Neither is measured: the next HO lists an id by `fromDateTime` right after its detail changes and times when it appears. p1's completeness check read short by exactly these four.
- **The precision:** census p1's 235 saved pages hold 58,557 entries, and **0 carry a time in `updateDate`, 0 in `updateDateIncludingText`.** The repair's own pages read the same. This is the next HO's STEP 0 input.
- **The predicate behind *a newer latest action*:** the census's listed `latestAction.actionDate` is later, as a `YYYY-MM-DD` string, than the stored `latest_action_date`, or the stored one is NULL and the listed one isn't.
- **Claim 4's path:** `$.payload.sync.*`, corrected in the probe file.

**The list cache** (its own heading in the probe): Congress.gov answers a repeated list URL from a cache, read off the saved pages. Census p1's half walk was the tie windows again plus two new pages, not a second walk, and census p3's list is p2's. **For the next HO:** a cursor that re-lists the same URL after a stopped tick may read a cached page; the cache's age is its STEP 0 measurement.

**The budgets:**
- **Congress.gov: 10,555 requests for the HO, all 200,** including the 9,132 spent before the HALT. That's census p1's 9,119, the repair's 1,067 (1,023 and 44), the three later censuses' 352, `--step0`'s 12, `--impact`'s 1 and the readings' 4. **`x-ratelimit-remaining` 17,629 of 20,000 at the end.** The handoff expected under 1,200; census p1's 8,876 detail reads are the overrun, flagged at the HALT. **Pass 3 added 587** (the three censuses' 497 and the repairs' 90), all 200 but r4's one 520, for **11,142** in all; `x-ratelimit-remaining` 19,319 at its end.
- **Prod: `rows_read` 413,789 by the instrument,** over 2,122 hrana results that each carried the field, and 53,393 by the cron-window side read. That's against an expected 70,000, and most of it is whole-table reads of `bills`. **`rows_written` 14,446,** every row the repair's `runSync`. Pass 3 read 323,396 more by the instrument and 53,950 by side reads, and wrote 105, every row `runSync`'s upsert: **737,185 and 14,551 in all.**
- **The schema fingerprint** read `736e6b987bf77620` before and after all seventeen runs.
- **No cron failed alongside** either window, or pass 3's: news ran once and summarize three times, all `success`, and `/api/sync` didn't run.

**For the poster chat:** *Introduced* on `/welcome` moves as the summarizer drains the repaired bills: the 589 new rows count once summarized, and the 368 updated ones drop out until they're re-summarized (pass 3's seven held summaries by 7:30 PM MT Oct 21). So the poster reads it again before it prints.

**Docs (HO 788):**
- This block.
- `docs/probes/788-bills-gap.md`, in HO 747's header form: STEP 0, the corrections and the deviations, the ledger, the census and the cause, the HALT and the ruling, both passes, the censuses after, the ruling on flags 1 and 2 and pass 3, the residual, the four readings, the list cache, the cost, and every missing id in the appendix.
- **backlog, 3+/2−:**
  - One new OPEN LOOPS line at the top of the section, owned by **Corey**: whether a Congress.gov change with no new action should null a bill's summary at all.
  - The 610 line (`:18`, now `:19`) is struck with its close reading, its text otherwise verbatim.
  - The HO 752 line (`:78`, now `:79`) is annotated with a dated note naming it the next HO, its *low* read as *medium*.
  - The two deletions are those two lines' rewrites.
- **oddities, two entries:** *a tick's own `cron_runs` row names the window it owed…*, the handoff's, and *an estimate carried from a biased sample read an order of magnitude low…*. The second is a separate lesson: the join says what caused the gap, and the sample said how big it was.
- **The reconcile:**
  - open: 281 live / 353 struck (634), § OPEN LOOPS `:14-233` 78 / 124;
  - close: **281 / 354 (635), § OPEN LOOPS `:14-234` 78 / 125**;
  - the control, `^- \*\*~~`, is 0 at both.
- **SKILL, its own commit, last:**
  - one paragraph after Sync logic's step 5: the stopped tick's tail, counted and repaired; the 959 / 7,917 split; and the frontier rule by instant, the standing rule for any future pass, with its write-time guard and the read-side clauses for stored and unstored bills;
  - the `:90` gotcha's clause on the list's filter field;
  - one sentence on the HO 135 watch (`:1342`) with `--ticks`' budget-stop count;
  - one Backfill scripts bullet pointing at the paragraph.
- **The FF go follows the architect's read of the ref.**
- **Also notes now run through HO 788.**

**Also (HO 789), Sabato's ratings from a page a person saved: the sync reads a saved copy of the rating-changes page, and the CLI flushes when any leg wrote. The Oct 20 House entry was an image on the page and a board on the House ratings page; two readers transcribed it and agreed on all 95 cells, and it went in as a supplement checked against the board's own counts. The Oct 22 page was written to prod in one run. It opens with HO 788's FF go as taken.**
- **What's here:**
  - HO 788's FF go as taken, with its records;
  - the Oct 22 read and its headers;
  - STEP 0, and its HALT on claim 4: the Oct 20 House entry is an image;
  - the ruling, (a) to (d), and its amendment: the image is a board;
  - § 1: the file run, the image entry, the supplement and the flush;
  - the transcription by two readers, and the board against the store;
  - the legs;
  - § 3, the prod run, and the read-back;
  - the cadence, and what was flagged;
  - the review reply: its amend (no `node:` import in the scraper), the legs again, and the race the board leaves off, by id.
- **There is no probe file.** The probe section is this block, from *The image, and the amendment* to *The board against the store*. The legs' readings, the board preview, the second reader's run and the prod run's output are in `docs/handoffs/789-artifacts/` (repo-ignored).
- **Four commits, kinds unmixed:** `feat` (§ 1's three files), `diag` (the legs), `docs` (this block, the backlog and the oddities), then `docs(skill)`, alone and last.
- **Prod was written by § 3's one run and nothing else,** through the sync's own upsert and departures, then the flush. Everything else read prod by `SELECT` only, through `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN` by name. Code fetched nothing from centerforpolitics.org: the page and the image are Corey's saves.
- **The pointer is 789:** pointer 788 (`docs/roadmap.md:7263`), highest HO in commit subjects 788, `main` at `79cd202`.

**HO 788's FF go, as taken** (`docs/handoffs/788-ff-go.md`). The paste is `docs/handoffs/788-artifacts/paste-788-ff.md`, and it agrees with every record below.
- **`main` at `79cd202`:** `7776ea3..79cd202`, three commits, no force (12:52 PM MT, 18:52:20 to 18:52:22Z). `ls-remote` read `main` alone at 18:52:41Z.
  - Local `main` was forwarded `--ff-only` first, and then `788-review` was deleted, local and remote.
  - That reverses the go's order, as at HO 787, because `-d` refuses a branch `main` doesn't yet contain.
- **Production built fresh, with no dedup:** `dpl_6TTnLdvCUG29rMdzdcDu7ParYF4R` (`bld_4fybk8ajo`, iad1), created 18:52:25Z.
  - Its build printed *VERCEL_FORCE_NO_BUILD_CACHE is set so skipping build cache step*.
  - It went READY at 18:53:26Z (12:53 PM MT), 60.9s after it was created.
  - The review Preview of the same SHA (`dpl_9nBSfmQRyW4PvccYCtPSPmCE43kq`, 01:57:43Z) was a separate deployment, 16.9 hours earlier.
- **`verify:deploy`, in the foreground:** first matched at 41s and held for five reads in a row (confirmed at 82s).
- **The served SHA:** the box's `curl -sD -` on `/api/version` at 12:54 PM MT (18:54:27Z), plain and with a fresh query string.
  - It read `79cd202` both times, with `Cache-Control: no-store`, `X-Vercel-Cache: MISS` and `Age: 0`.
  - The production alias resolves to that deployment. It was updated at 18:53:26Z, 0.2s after READY.
- **`e2e-prod` #39835322645,** fired by the Production record: `smoke` **143 passed (5.6m)**, and its narrow pass read 82 cells against Production, every one `over=0`.
- **The record's lag, as a bound:** the Production record (7260829805) and its `success` came at 18:53:27Z.
  - That's 0.9 to 1.9s after READY, the bound the whole-second stamps allow.
  - HO 787's was 2.6 to 3.6s.
- **The two cron rows:**
  - **`/api/sync-race-ratings` #27065** (Oct 22, 5:00 AM MT, 11:00:44Z), `error`. It's the twelfth scheduled refusal in a row, Oct 11 through Oct 22 (#24166 to #27065).
    - Each was a 403 `cf-mitigated` challenge. This one carried `cf-ray a4e8000149b6fb74-PDX` and a 5,689-byte body.
    - It is backlog `:40`'s wall. The last `success` is #21278, Sep 30.
  - **`/api/cron/bill-rosters` #26890** (Oct 21, 12:40 PM MT, 18:40:03Z), `error`: *The operation was aborted due to timeout* at 20.1s, its payload carrying no stats.
    - The next tick, #26924 (3:40 PM MT, 74.7s), read `success`: 120 fetched, 26 bills changed, flushed.
    - Of the 15 rows from Oct 21 00:40Z through Oct 22 18:40Z, every other one read `success`.
- **The `cbt` skill, rebuilt from blob `7ef6fa3`:** the box's synced copy hashed `7ef6fa3…`, which is `79cd202`'s SKILL. One line, its file written at 1:29 PM MT Oct 22 (19:29:45Z), and still one line at `7ef6fa3` when re-read at 12:10 PM MT Oct 23 (18:10:53Z).

**The Oct 22 read.** At 1:46 PM MT (19:46Z) Corey fetched the rating-changes page from his box with the sync's own agent string, one plain GET, and Cloudflare answered 200.
- **The read:** `CF-RAY a4eb0251d8755616-SJC`, `last-modified: Thu, 22 Oct 2026 11:06:54 GMT`, 443,558 bytes.
  - It was saved as `docs/handoffs/sabato-rating-changes-2026-10-22.html` (repo-ignored).
  - pdx1 is refused that agent every morning (#27065 above), so the two networks still read differently.
- **The scheduled daily read re-read it** at 7:31 PM MT (01:31:48Z Oct 23). This is Corey's task, below.
  - **Its headers:** 200, `CF-RAY a4ecfbfb1b5ee669-DEN`, `cf-cache-status: BYPASS`, and the same `last-modified`.
  - **Its page:** the same `article:modified_time` (2026-10-22T10:37:28+00:00), and 443,558 bytes again.
  - **Its bytes differ** (sha256 `c57864f0…` against STEP 0's `dbf44297…`), but the parse reads the same rows: the House's 33 tables and 136 rows through Oct 8 plus the image entry, and the Senate's 21 tables and 31 rows through Oct 14.
  - § 3 ingested this copy.

**STEP 0** (a check, HO 768's rule), 2:35 PM MT Oct 22 (20:35Z) at `79cd202`: claims 1, 2 and 3 hold. **Claim 4 is false, so the HO HALTed.**
- **4:** the file is the real page:
  - 443,558 bytes;
  - *Just a moment* appears 0 times;
  - the `<title>` is *2026 Rating Changes - Sabato's Crystal Ball*;
  - `article:modified_time` 2026-10-22T10:37:28+00:00;
  - the Senate parses: 21 tables, 31 rows, newest Oct 14.
- **The House throws before it reaches the floors:** *table 36 has no date: 2 date lines above it (2026-10-20, 2026-10-08)*.
  - Oct 20's House entry is a date line and an `<img>` (`102026houseratings.png`) in one `<p>`, with no table.
  - So the parser saw two date lines above Oct 8's table, and HO 770's date rule refused to guess which one governed.
- **5 (record):**
  - **Sabato's rows:** 95 (House 83, Senate 12), with `rating_date` running 2026-01-29 to 2026-09-29. No row cited the rating-changes page yet.
  - **History:** 221 Sabato `rating_history` rows.
  - **The cron ledger:** the last `success` is #21278 (Sep 30), with 15 `error` rows since (#23114 to #27065).
  - **The tables:** `races` 540, `race_ratings` 268, `rating_history` 820.
  - **The schema fingerprint:** `736e6b987bf77620`.
- **2 and 6 (record):**
  - Two range ends are one line off: `fetchSource` closes at `:303`, and `readSabato` at `:719`.
  - SKILL had no `sync:race-ratings` line, so the docs(skill) commit adds one.
- **The preview for the ruling** (read-only, 2:36 PM MT):
  - **The Senate:** 5 changed, 2 new, 0 conflicts, 0 departures.
  - **The House,** with the image paragraph removed in memory, so read through Oct 8: 13 changed, 3 new, 2 departures (CT-05 and KS-03, Likely D → Safe D on Jul 30), 0 conflicts.
  - The HALT recommended writing the Senate now and holding the House.

**The ruling** (5:34 PM MT, `docs/handoffs/789-step0-ruling.md`): *the halt was right, and the recommendation is half right.* The Senate goes in. The House is written through Oct 20 from the image, read by two readers and supplied as a dated supplement.
- **(a)** The parser learns image entries. A date line followed by an `<img>`, before the next date line or table, is recorded as `{ date, src }` (`images`), and its date no longer dates the table below. A chamber with one and no supplement throws by name: *house: the Oct. 20, 2026 entry is an image (102026houseratings.png), no text rows; supply a supplement or hold the chamber*.
- **(b)** The CLI's flush fires when any leg wrote (`upserted + deleted > 0`), whatever the other leg did. The route has the same gap (`app/api/sync-race-ratings/route.ts:99-102`): one backlog line, owner Code, low, not fixed here.
- **(c)** The supplement rides beside the file into `readSabato`, through `runRaceRatingsSync({ run, supplements })`, and `scrapeChamber`'s signature is kept.
  - The CLI takes `--supplement <csv>`.
  - A supplement whose date matches no image entry, or whose chamber is wrong, is an error.
  - Its rows cite the rating-changes page as `source_url`, and the stats' `dataUrl` names the image beside the file's label.
- **(d)** Leg A gains a red: the file without the supplement. The House fails by name, the Senate is ok, and the flush fires for the Senate's writes.

**The image, and the amendment** (7:50 PM MT, `docs/handoffs/789-board-amendment.md`).
- **The image 404s.** `102026houseratings.png` renders as a broken image on the rating-changes page, and Corey's screenshot at 5:42 PM MT reads *Page not found*.
- **The House ratings page carries it under a new name.** `/crystalball/2026-house/` (*2026 House Ratings, Updated Oct. 20, 2026*, `article:modified_time` 2026-10-21T23:45:57+00:00) shows the same graphic as `102026houseratings-2.png`.
- **It's a board, not a changes table:** every competitive House district in eight columns, each header printing its count.
  - **Republicans:** Toss-up (8), Leans Republican (16), Likely Republican (20), Safe GOP Pickup (3).
  - **Democrats:** Toss-up (4), Leans Democratic (20), Likely Democratic (21), Safe Dem Pickup (3).
  - **95 cells,** under the footer *Races not listed are rated as Safe for the incumbent party*.
  - **The totals:** Safe R 164, Safe+Likely+Leans R 200, Safe D 182, Safe+Likely+Leans D 223. That's 200 + 223 + 12 toss-ups = 435.
- **The supplement gains a kind,** `board` or `changes`.
  - **A board row** is the race's rating as of the board's date. It enters the chain as `{ date, from: null, to }` and matches any stored label in the chain check, since a board states a position, not a transition.
  - **A race the board leaves off** (one with a stored Sabato row or a text-table entry) is Safe for the incumbent party as of the board's date. It becomes a locked cell, which `applyDepartures` retires with its history row.
  - **The pickup cells** are Safe for the party named.
- **The control:** before anything else, the CLI reads each section's count from its header's parentheses and refuses the file unless every section's rows equal it. A dropped row is the one error that would wrongly retire a rating.
- **The floors** apply to the chamber as a whole, and the House's `pageAsOf` is the board's date.
- **The HALT before § 3:** more than 15 departures, or any departure of a race the text tables moved on Oct 8 or later.

**§ 1** (`feat`, three files, 565+/26− since the review's amend):
- **`lib/race-ratings-scrape.ts`:**
  - `fileScrapeRun({ html, label })` serves the page's text, which the caller read, for Sabato's URL, and throws on any other (`fetch … -> 0: offline run: nothing is fetched`). The module imports no `node:` module (the review's amend, below).
  - `ScrapeRun` gains `label` (the caller's `file:<basename>`) and `supplements`.
  - `readSabato` writes `dataUrl` as the label plus each supplement's source, and a file run's failed parse names the file.
  - `parseSabatoChanges(html, chamber, supplements)` records image entries and reads supplements.
  - `parseSupplementCsv` reads the header and rows and applies the counts control.
- **`lib/race-ratings-sync.ts`:**
  - `runRaceRatingsSync({ run, supplements })`.
  - `boardSilence`: a stored row the board leaves off is retired as Safe for the incumbent's party (`races.incumbent_bioguide_id` → `members.party`). If that party is neither D nor R, the row is kept and named in `offBoard`.
  - The chain check matches a board's entry against any stored label.
  - `RaceRatingsSyncError` carries both legs' results under the same message.
- **`scripts/sync-race-ratings.ts`:**
  - `--html`, `--supplement` (repeatable) and `--flush`, the flush in sync-fec's pattern;
  - it reads the `--html` file itself, after the supplements' checks, and hands its text to `fileScrapeRun`;
  - unknown flags are refused;
  - it exits 1 if a leg failed, after the flush.
- **Unchanged:** `USER_AGENT`, `fetchSource`, `FETCH_TIMEOUT_MS`, the route, the cron and every UI file.

**The transcription, two readers.**
- **Reader 1, the architect,** from the image Corey attached at 7:44 PM MT: `docs/handoffs/sabato-house-2026-10-20.csv`.
  - 95 rows of `cell,rating,section`.
  - The header names the source, chamber, date and kind, the readers, the controls and the board's footnote: *Kiley, previously elected as a Republican, is seeking reelection as an independent*, on his CA-06 cell.
- **The image, saved:** Corey saved `102026houseratings-2.png` into `docs/handoffs/` at 11:42 AM MT Oct 23 (17:42:51Z).
  - 569,874 bytes, 600 × 1341 px, sha256 `74b9148d…`. That's the 1,253 × 2,800 px the change log's JSON-LD gives the original, scaled by 0.479 on both axes.
  - Two halves stacked, *Republicans* over *Democrats*. Each half has its Toss-up, Leans and Likely columns side by side and its pickup box under the first; the cells are tinted by the seat's party.
- **Reader 2, Code:** `tesseract.js` 5.1.1 with its English data, installed in the session scratchpad. It needs no system install and fetches nothing at run time.
  - **Its read,** 12:00 PM MT (18:00:23Z): the eight headers and their counts off the image, then each column's cells, every district placed under its header.
  - **The result:** 95 rows, each column equal to its header's count, and every row in all four passes (plain and inverted, each as a block and as a column) with no character corrected.
  - **The rest of the image:** the totals (164, 200, 182, 223) and both footer lines read as reader 1 has them.
- **How reader 2 was made to read** (its script and controls in `docs/handoffs/789-artifacts/reader2/`):
  - **First, two boards drawn offline from reader 1's CSV.** On those, a white header on a coloured bar read nothing until each bar was read from its own crop.
  - **On the real board, the header cells are tinted close to the cells under them,** so a column starts below its header's own text line.
  - **A crop that took in the table's rules on both sides** read none of the 16 Leans R cells in the full run, and at most two when cropped alone, so crops stop inside the rules.
  - **A brightest-channel pass was tried and taken out:** on the synthetic boards it invented districts in 2 of 6 passes.
- **The diff:** none. Reader 2 agrees with reader 1 on all 95 rows, district and column, the two toss-up columns told apart by their header counts. **Settled by Corey:** nothing, since there was no difference to settle.
  - The CSV's header now records reader 2's reading and *differences: none*.
  - Its rows are untouched and parse the same.
- **The control:** a copy of the CSV with five planted faults (a wrong district, a row moved, a row dropped, a toss-up on the wrong side) showed exactly those five against the same image.
- **The counts:** every section's rows equal its header's count, every cell mints one House id, and no district appears twice.

**The board against the store** (read-only, 7:57 PM MT, 01:57:55Z Oct 23; `board-preview.txt`).
- **The text tables** hold 136 rows in 88 chains, none with an old label outside the vocabulary. Prod held 83 House Sabato rows.
- **Of the 95 cells:**
  - 35 change a stored row, 8 are new, 46 match, and 6 are pickups (locked).
  - All 95 have a races row, including the eight *New* districts: FL-22, TX-09, TX-35, LA-06, TX-32, CA-01, CA-41 and UT-01.
- **Stored rows the board leaves off:** two, CT-05 (Hayes) and KS-03 (Davids).
  - Each is stored Likely D (dated 2026-05-19), and the text tables made each Safe D on Jul 30.
  - Neither was moved on Oct 8 or later, so the HALT doesn't fire.
- **Text-table races the board leaves off with no stored row:** 22, so nothing to write.
  - 21 are Safe in the tables.
  - **`CA-03-2026` is the one the tables rate competitive,** the House stats' *the board leaves off 1 race(s) the tables rate competitive*. Its one row is the Nov. 5, 2025 table's: *Kevin Kiley (R, CA-3)*, Likely Republican → Likely Democratic. Read by the tables alone, it would be a new Likely D row dated 2025-11-05.
  - **The board's silence kept that row out.** The board doesn't list CA-3; it lists Kiley as `Kevin Kiley (CA-6)*`, Likely Democratic, with the footnote above. The parse holds `CA-03-2026` in the board's `offBoard`, so the race is neither rated nor locked. `boardSilence` reads stored rows only, and no rater has a row for `CA-03-2026` in prod (`SELECT`, 2:41 PM MT Oct 23, 20:41:59Z), so nothing was retired or named. Its incumbent in `members` is Kiley, `I`, for whom the footer names no label in any case.
  - **Kiley's own cell** went to `CA-06-2026`, Bera's seat in `races`. Its stored Likely D (2026-09-15) matched, so that row is unchanged.

**The legs** (`diag`, `scripts/diagnostic/ratings-from-file-789.ts`, 586 lines since the review's amend): **27 PASS, 0 FAIL** at 8:21 PM MT.
- **Run again on the settled CSV:** 12:05 PM MT Oct 23 (18:05Z), 27 PASS, 0 FAIL. Line for line it's the same, but for its times and the newest refusal (#27332).
- **Run again at the review's amend** (`57ba88e`), 2:51 PM MT Oct 23 (20:51:29Z): 27 PASS, 0 FAIL, on run 4's copy (`--template`), since § 3 had written prod in between. Line for line it's run 4, but for its times, its ports and the copy's line.
- **The setup:** each leg runs on its own `file:` copy of prod, built by `scripts/migrate.ts` and filled by `SELECT` (`members`, `races`, `race_ratings`, `rating_history`). The process never opens prod.
- **The tripwire** counted 0 at every reading but its own control.
- **C, the offline guarantee:**
  - A file run asked for any URL but Sabato's throws and fetches nothing.
  - Sabato's URL reads the file, labelled by its name.
  - The tripwire's control refuses `example.invalid` and counts 1.
- **B, a saved challenge page** (`origin-check-retry-page.html`, 5,572 bytes, *Just a moment...*):
  - Both legs fail at the floors, and the message names the file (*read from file:origin-check-retry-page.html*).
  - Nothing is written, and the CLI exits 1 with no POST.
- **D, the network path's control:** `fetchSource` against a local 403 reads as HO 771's legs did (`cf-mitigated challenge, server cloudflare, cf-ray …, 5,572 bytes, "Just a moment..."`), and nothing is written.
- **A, red** (the file without the board, by the CLI with `--flush`):
  - The House fails by name with (a)'s message, and its rows don't move.
  - The Senate writes its 7 rows.
  - The flush POSTs once, with the dummy bearer, and the CLI exits 1.
- **A, the control:** a row dropped (VA-1) and a row doubled are each refused before anything else (*refused, every section must hold the count its header prints*). Nothing is written, and there is no POST.
- **A, green,** in-process and by § 3's command on copies: both legs are ok, and the two move the same rows to the same labels and dates.
  - **The House:** 89 competitive and 29 locked. Upserted 43 (35 changed, 8 new), unchanged 46, conflicts 0, `skippedNoRaceRow` 0.
  - **Its departures:** 2, CT-05 and KS-03, each with its Safe D history row dated 2026-07-30.
  - **The Senate:** upserted 7 (5 changed, 2 new), unchanged 7.
  - **The stats:** `dataUrl` is the file plus the board's image URL, and `pageAsOf` is 2026-10-20. The copy's AS OF moves 2026-09-29 → 2026-10-20.
  - **The HALT check:** 2 departures, none moved on Oct 8 or later.
- **A, planted:**
  - A D-held and an R-held seat the board leaves off (AL-07 planted Likely D, AL-01 planted Lean R) retire as Safe D and Safe R as of Oct 20, each with its history row.
  - An independent's seat (CA-03, planted Likely D) is kept and named in `offBoard`.
- **Regressions:** HO 770's shape legs read 31/0 and HO 771's daily legs 23/0. HO 770's source legs fetch Sabato live, so they weren't run (guard 3).

**The board's dates** (flagged): a board row whose label matches the race's newest text move keeps that move's date, as HO 770's *date of the race's newest change* reads, and one that differs is dated Oct 20.
- 28 rows were decided by the board and read Oct 20.
- 17 read their text dates: Sep 29, Oct 8, and CT-05's and KS-03's Jul 30.

**§ 3, the prod run,** 12:07:50 to 12:08:22 PM MT Oct 23 (18:07:50 to 18:08:22Z), Node 24.22.0, exit 0 (`s3-run.txt`).
- **The command:** `npm run sync:race-ratings -- --html docs/handoffs/sabato-rating-changes-2026-10-22.html --supplement docs/handoffs/sabato-house-2026-10-20.csv --flush`, with `REVALIDATE_URL` set to Production's `/api/revalidate` for that process only.
- **The House:** ok. 89 competitive and 29 locked; upserted 43 (35 changed, 8 new), unchanged 46, deleted 2, `skippedNoRaceRow` 0, conflicts `[]`, `offBoard` `[]`.
  - `pageAsOf` 2026-10-20, and `dataUrl` is the file plus the board's image URL.
  - The stats count one race the tables rate competitive that the board leaves off: `CA-03-2026`, with no stored row, so nothing was written for it (*The board against the store*, above).
- **The Senate:** ok. 14 competitive and 2 locked; upserted 7 (5 changed, 2 new), unchanged 7, deleted 0, conflicts `[]`, `offBoard` `[]`, `pageAsOf` 2026-10-14.
- **The flush:** *Flush of `race-ratings`: 200*.
- **The House rows the board decided:** 28, its entry the newest, each dated Oct 20.
  - **Changed:** AZ-01, AZ-06, CA-13, CA-48, CO-04, CO-08, IA-02, IA-03, MN-01, NC-01, NC-11, NH-01, NV-02, NV-03, NY-04, NY-21, OH-01, PA-10, SC-01, TX-23, TX-35, WI-03.
  - **New:** IN-05, KS-02, MD-01, NE-01, NJ-02, WA-05.
- **The House rows the text tables decided,** the board agreeing: 15, each dated by its text move.
  - **Sep 29:** CA-45, KY-06, ME-02, MO-02, MT-01, PA-07, VA-01, VA-02 and VA-05 changed; NC-03 and OH-15 new.
  - **Oct 8:** FL-22, FL-25, NE-02 and WI-01.
- **Every `CHANGED` line,** by its move. Each chain is in the paste, and in `legs-run4.txt`'s table, which prod matches row for row.
  - **House, Toss Up → Lean D (12):** AZ-01, AZ-06, CO-08, IA-02, IA-03, NC-01, NC-11, PA-10 and WI-03 (the board); FL-25 (Oct 8); PA-07 and VA-02 (Sep 29).
  - **House, Likely R → Lean R (12):** CO-04, MN-01, NV-02, NY-21, SC-01 and TX-23 (the board); WI-01 (Oct 8); KY-06, ME-02, MO-02, MT-01 and VA-05 (Sep 29).
  - **House, Lean D → Likely D (8):** CA-13, CA-48, NH-01, NV-03, NY-04 and OH-01 (the board); NE-02 (Oct 8); CA-45 (Sep 29).
  - **House, Lean R → Toss Up (3):** TX-35 (the board); FL-22 (Oct 8); VA-01 (Sep 29).
  - **House, new, all Likely R (8):** IN-05, KS-02, MD-01, NE-01, NJ-02 and WA-05 (the board); NC-03 and OH-15 (Sep 29).
  - **Senate (5 changed, 2 new):** S-AK Toss Up → Lean D (Oct 6); S-KS Lean R → Toss Up, S-MN Likely D → Lean D, S-NE Likely R → Lean R and S-NH Lean D → Likely D (Oct 14); S-MS Likely R (Oct 14) and S-SC Likely R (Oct 6), new.
- **The departures:** CT-05 and KS-03, each stored Likely D (May 19), deleted with a Safe D history row dated Jul 30.
- **The readings around it** (`SELECT` only; `s3-before.txt`, `s3-after.txt`, `s3-diff.txt`): before at 12:07:11 PM MT (18:07:11Z), after at 12:08:40 PM MT (18:08:40Z).
  - **The schema fingerprint** read `736e6b987bf77620` both times.
  - **The tables:** `race_ratings` 268 → 276, `rating_history` 820 → 822, `races` 540.
  - **Sabato's rows:** 95 → 103, with 40 changed, 10 new and 2 departed. No row whose label held was touched: its date, source and stamp are kept.
  - **The newest date:** MAX(`rating_date`) 2026-09-29 → 2026-10-20.
  - **The sources:** the 50 rows written cite the rating-changes page. The 53 unchanged rows keep the sources they had: Ballotpedia for 26 House and 6 Senate rows, and the Crystal Ball's House and Senate pages for 20 and 1.
  - **Against leg A's CLI copy,** prod after the run matches on all 103 rows, by label, date and `source_url`.
  - **The cron ledger alongside:** no cron row started between the two reads, and the 73 rows of the six hours before read `success`.
  - **That morning's ratings tick, #27332** (5:00 AM MT, 11:00:44Z), was refused like the twelve before it: a 403 `cf-mitigated` challenge, `cf-ray a4f03d624979b7b9-PDX`, 5,689 bytes.
  - That's thirteen scheduled refusals in a row, Oct 11 through Oct 23, and 16 rows without a `success` since #21278 (Sep 30).

**The read-back on Production** (12:09 PM MT, 18:09:34 to 18:09:41Z; `readback-789.txt`), every request with a fresh query string but the plain `/api/version`:
- **The served SHA, the HO 787 way:** `curl -sD -` on `/api/version`, plain and fresh.
  - It read `79cd202` both times, with `Cache-Control: no-store`, `X-Vercel-Cache: MISS` and `Age: 0`.
  - § 3 wrote data only; nothing deployed.
- **`/electoral`:** the sources line reads *Sabato · as of 2026-10-20 · direct*.
  - Beside it are Cook *as of 2026-09-29 · via Ballotpedia* and Inside Elections *as of 2026-09-22 · via Ballotpedia*.
- **`/race/AZ-01-2026`,** a race the board decided: its Sabato chip reads *Lean D*, titled *Updated 2026-10-20*, and the page's own sources line reads *Sabato · as of 2026-10-20 · direct*.

**The cadence, until Sabato answers the cron or Nov 3 passes:**
- **The read:** a scheduled daily read from Corey's box with the sync's own agent (a Windows scheduled task; the script lives beside the saved pages, repo-ignored), the page opened in his browser at the same time; a challenge stops it for the day.
- **The ingest:** `npm run sync:race-ratings -- --html <file> --flush`, each run's `CHANGED` lines pasted to the chat.
- **The Oct 20 entry stays on the change log,** so every later ingest passes its settled transcription with `--supplement`. Without it, the House fails by name and only the Senate writes.
- **A new image entry** means a transcription before that day's ingest: two readers and Corey's settling, then `--supplement`.

**Flagged at the push:**
1. **The board's dates,** above.
2. **The board's mark:** the chain check matches a board's entry by its `board` mark, not by `from` being null. A text row whose old label is outside the vocabulary also reads null, and no text row does today.
3. **The incumbent's party** is read through `races` → `members`. A seat whose incumbent is neither D nor R keeps its row and is named in `offBoard`; only the planted seat does.
4. **The legs' copy carries `members`,** for that join.
5. **Leg B's file is 5,572 bytes.** The handoff's 5,689 is #27065's live body.
6. **`node:fs` in `lib/race-ratings-scrape.ts`** was safe under HO 774's rule (client islands import only types from `lib/queries.ts`), and the cold build confirmed it. The review took it out anyway, by SKILL's house pattern (below).
7. **A both-ok run that wrote nothing doesn't flush,** by (b)'s letter.
8. **The bill-rosters note sits on HO 677's live line** (`:258`). There is no HO 676 WATCH or OPEN LOOPS line for the route.
9. **The scheduled task's ingest line passes no supplement yet.** It's off for now, and it needs the supplement before it's turned on (the cadence, above).
10. **One board per chamber:** a second board image in the House would throw *two boards (…); one at a time* until a rule says which board governs.
11. **The CLI's header comment** still reads *one `curl.exe` a day from the box with the sync's own agent string*. The scheduled task runs exactly that, so it stays.
12. **SKILL's cron line (`:1266`) gains a sentence, not a clause.** Its second half says what a board day changes in the line's own claims.
13. **Reader 2's crops were fitted to this board's geometry,** where to cut and what to leave out. Every word and number is still Tesseract's reading, and its script lives only in the repo-ignored artifacts. The review filed that as an OPEN LOOPS line (`:16`).

**The review reply** (2026-10-23), taken before the push:
- **The hold is HO 786's:** commits on `789-review` show the diff, the push publishes it, and Corey pasting the reply approves it. The FF go follows the architect's read of the ref.
- **Checked by the reply:** reader 2's 95 cells and its planted control; the legs, 27/0 with the tripwire at 0; § 3's one run and its readings; the read-back; the dates as ruled, 28 by the board and 15 by the text move; the docs and the reconcile; the gates and the audit.
- **One amend, in `feat`: no `node:` import in `lib/race-ratings-scrape.ts`.** Flag 6 held, but SKILL's house pattern (`:86`) keeps a `lib/<source>.ts` import-safe for client bundles, its deps type-only, so its types can ride into client components, and `RatingSource` and `Chamber` live in that file. SKILL's `:2373` (HO 774) is what one value import from a `node:`-bearing lib module cost: `node:fs` failed `/search`'s build at HO 773.
  - `fileScrapeRun({ html, label })` takes the page's text, and the CLI and the legs read the file with `node:fs` on their side.
  - `feat` was amended in place (`9bb2e4b` → `7fa5179`), and the three commits above it were replayed: `diag` (`12708a2` → `57ba88e`), with the legs' side of the read and `--template`, then `docs` and `docs(skill)`.
  - A missing `--html` file now fails before either leg runs, as a missing `--supplement` already did. Before, it failed both legs inside the run.
  - The prod run wasn't repeated: the upsert path didn't change.
- **The legs again,** at the amend: 27 PASS, 0 FAIL on run 4's copy (*The legs*, above).
- **A reading beside flags 7 and 9,** outside the reply's ask: § 3's command on a fresh `SELECT` copy of today's prod (2:52 PM MT, 20:52:42Z) wrote nothing. Both legs were ok, 89 and 14 rows unchanged, nothing deleted, no conflicts, and *No leg wrote, so there is nothing to flush*. That's the daily ingest on a day the page hasn't moved, the supplement passed.
- **Two readings for the push paste:**
  - the race the board leaves off, named by id in the probe section: `CA-03-2026` (*The board against the store*);
  - flags 7 to 11, which the attachment cut at the fold, in full. None needs a ruling the HO doesn't give, so the push didn't wait on them. Flag 9's `--supplement` is Corey's to carry into the daily script after the FF.
- **One more OPEN LOOPS line,** from flag 13, owned by Code, low: the board reader isn't in the repo. The close count is 283.
- **Then** the cold build, the cheap gates and the push.

**Docs (HO 789):**
- This block.
- **backlog, 5+/3−:**
  - Two new OPEN LOOPS lines at the top, each owned by Code, low: `:15`, the route skips its flush when one leg throws (ruling (b)); and `:16`, the review's from flag 13, the board reader isn't in the repo.
  - `:32` (now `:34`), the four seed snapshots: *the 10-13 emails* corrected.
  - `:40` (now `:42`), a dated note: the manual path, the two 200 reads, the image entry and the supplement every later ingest carries, and the record corrected. No email has gone to the Center for Politics; Corey wrote to Ballotpedia only; that email is drafted as of Oct 22 and remains Corey's. The close is unchanged.
  - HO 677's bill-rosters line (`:256`, now `:258`): a dated note with #26890 and #26924.
  - The three deletions are those three lines' rewrites.
- **oddities, one entry:** *a change log carried its largest entry as a picture, then lost the picture, and the board on the sibling page is read by its own headers' counts*.
- **The reconcile:**
  - open: 281 live / 354 struck (635), § OPEN LOOPS `:14-234` 78 / 125;
  - close: **283 / 354 (637), § OPEN LOOPS `:14-236` 80 / 125**;
  - the control, `^- \*\*~~`, is 0 at both.
- **SKILL, its own commit, last:**
  - the Sabato bullet (`:74`): the saved-page path and its cadence, the ingest, a saved challenge page writing nothing, and both entry kinds (table and board), with the board's counts as the control;
  - the cron line (`:1266`): a refused day can be filled from a saved page;
  - a scripts-list line for `npm run sync:race-ratings` and its three flags;
  - `:2977` gains *or ingested from a page a person saved, through the same sync (HO 789)*.
- **The FF go follows the architect's read of the ref.**
- **Also notes now run through HO 789.**

**Also (HO 790), the bill sync's frontier: a row in `sync_state` that moves only when a listing completes, a `sync_queue` between the listing and the writes, the list walked `updateDate asc` in overlapping pages, a 240 s budget, and the summary reset keyed on a new action or a new text version by Corey's ruling. It opens with HO 789's FF go as taken.**
- **What's here:**
  - HO 789's FF go as taken, with its records;
  - STEP 0, a check: claims 1 to 7 held, two read off their anchor or their bound, neither a HALT;
  - the ruling;
  - § 1's model, and the one place it departs from the handoff: the wide listing;
  - § 2, the reset;
  - the legs, red at `b64cc81` and green at the `fix` commit, plus a leg for the pass;
  - the migration, run by Corey before the push;
  - the pass after the FF, and what it sets going;
  - what was flagged.
- **Five commits, kinds unmixed:** `feat` `474bbb1` (§ 1's five files), `fix` `24d37a5` (§ 2, with the comments it made false in two more files), `diag` `8307dae` (the legs and the pass), `docs` (this block, the backlog, the oddities), then `docs(skill)`, alone and last.
- **Prod was written once, by the migration, and otherwise read by `SELECT` only,** through `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN` by name. The migration, the handoff's write 1, ran from the box by Corey's hand before the push (below); the enqueue and the drain run after the FF. The legs wrote `file:` copies and reached nothing beyond 127.0.0.1.
- **The pointer is 790:** pointer 789 (`docs/roadmap.md:7550`), highest HO in commit subjects 789, `main` at `b64cc81`.

**HO 789's FF go, as taken** (`docs/handoffs/789-ff-go.md`). The paste is `docs/handoffs/789-artifacts/paste-789-ff.md`, and it agrees with every record below.
- **`main` at `b64cc81`:** `79cd202..b64cc81`, four commits, no force (3:18 PM MT Oct 23, 21:18:00 to 21:18:02Z). `ls-remote` read `main` alone at 21:18:16Z.
- **Production built fresh, with no dedup:** `dpl_91MMjkQoTnAYayqnYqZ6EsD7STjs` (`bld_fdssxtd5e`, iad1), its build printing *VERCEL_FORCE_NO_BUILD_CACHE is set so skipping build cache step*. READY at 3:18:57 PM MT (21:18:57.929Z). The review Preview of the same SHA (`dpl_2UwCUMCrJuB7e2aztTsUNZ1Vzhbn`) was a separate deployment, 18.0 minutes earlier.
- **`verify:deploy`, in the foreground:** first matched at 41 s and held five reads in a row.
- **The served SHA:** the box's `curl -sD -` on `/api/version`, plain and with a fresh query string, read `b64cc81` twice with `Cache-Control: no-store`, `X-Vercel-Cache: MISS` and `Age: 0`. The production alias resolves to that deployment, updated 0.2 s after READY.
- **`e2e-prod` #40025861206,** fired by the Production record: `smoke` **143 passed (6.0m)**, and its narrow pass read 82 cells against Production, every one `over=0`. GitHub labels its `head_branch` `789-review`, because the ref still carried the SHA when the record fired; the run checked out `b64cc81`.
- **The record's lag, as a bound:** 0.1 to 1.1 s after READY (HO 788's was 0.9 to 1.9 s).
- **The chat side:** the `cbt` skill rebuilt from blob `8ae326a` (`789-close.md`); the daily Sabato read's ingest switched on Oct 24 with the Oct 20 House board as its supplement (the HO 790 handoff).
- **`/api/sync-race-ratings` #27600** (Oct 24, 5:00:44 AM MT, 11:00:44Z), read by this HO from `cron_runs`: `error` in 125 ms, the 403 `cf-mitigated` challenge in both legs (`cf-ray a4f87ac44a26ef57-PDX`, 5,689 bytes), nothing written. The expected reading: the HO 789 code's first scheduled run on Production, refused as before. It's the fourteenth scheduled refusal in a row, Oct 11 through Oct 24 (#24166 to #27600); the last `success` is #21278, Sep 30. Backlog `:40`'s wall.

**STEP 0, a check (method.md, HO 768): claims 1 to 7 held, and two read off their anchor or their bound without failing.**
- **1:** `main` and `origin/main` at `b64cc81`; the pointer 789 at `:7550`; the highest HO in commit subjects 789; the one numbered file above 789 is this one.
- **2 to 4:** every `lib/sync.ts`, route, `vercel.json`, `lib/cron-log.ts`, committees-route and `scripts/migrate.ts` anchor read as stated, and all 135 statements in `migrate.ts`'s `statements` are `CREATE … IF NOT EXISTS`. Prod at 2:00 PM MT Oct 24 (20:00:54Z): no `sync_queue` in `sqlite_master`, and `sync_state` empty (no `donors_cursor`).
- **5, read one line off its anchor:** the prompt's inputs are as stated (the title, `latest_action_text`, the CRS summary, the bill text), at `lib/summarize.ts:217-220`, one line below the handoff's `:216-219`; `:115` fetches the text. The premise holds, so no HALT; the clause comment cites `:217-220`, and the new CRS line cites `:219`.
- **6, read under its expected 99% and over its 90% HALT line** (prod, 2:01 PM MT): `textVersions.count` non-null on 19,369 of 19,775 rows, **97.95%**. All 406 nulls have `textVersions` absent, and no row has a count of 0; the newest ten are introductions of Oct 23 with no text yet, which the rule reads as a count of 0 (§ 2). `MAX(update_date)` 2026-10-24T13:53:37Z (7:53:37 AM MT). `/api/sync` over the 30 days from 2:01 PM MT Sep 24: 120 rows (115 `success`, 3 `timeout`, 2 `error`); `budgetStopped` on 30 of the 115 with stats (26.09%); `seen` median 33, p90 93, max 138, sum 4,523, so **151 a day** as the volume floor; `runSync`'s median 14.5 s, at 2.13 bills upserted a second.
- **7, three reads, the key in each URL and in no printed line:**
  - the list from 48 hours before, `sort=updateDate+asc`, `limit=5`: 200, `pagination.count` 301, five non-decreasing `updateDate`s (Oct 22 four times, then Oct 23), and every date in both reads a bare day;
  - the same list sorted desc, the control the handoff's two named calls lacked (five equal bare days are non-decreasing either way): it opened on Oct 24 where asc opened on Oct 22, so asc is honoured;
  - the first asc entry's detail (`119-hr-227`): `updateDateIncludingText` 2026-10-22T20:16:35Z, 15.5 minutes into the window, `textVersions.count` 6, `summaries.count` 2.
- **8:** SKILL `:50`, `:90`, `:115`, `:1230-1242`, `:1263`, `:1337`, `:1344` and `:1365`, and backlog `:17`, `:81`, `:105` and `:655`, read as stated. The reconcile at open: 283 live / 354 struck on 637, mis-struck 0.
- **9:** the Oct 21 census is labels p4, p5 and p6 in `docs/handoffs/788-artifacts/`, behind 7,905, 7,903 and 7,902 (missing 4, 1 and 0); p6 is pass 3's 7,902.

**The ruling, Corey's on backlog `:17`** (the HO 790 handoff: *Corey ruled on `:17` today, 1:15 PM MT Oct 24*): ***the summary resets on a new text version or a new latest action, and keeps on a metadata-only move.***

**§ 1, the model** (`lib/sync.ts`'s header carries it).
- **The frontier** is `sync_state`'s `bills_frontier`, an ISO instant. An absent key is bootstrapped from `MAX(update_date)` (`getWatermark`, kept as the bootstrap's read), or seven days back on an empty table.
- **The listing:** `/bill/{congress}` from the frontier, `sort=updateDate asc`, pages of 250 advanced by 225 (HO 754's overlap), each page's entries into `sync_queue` in one INSERT keyed by bill id: a row already queued keeps its `enqueued_at` and takes the later list day, and a live listing takes over a backfill row. Only a listing that reaches the end of the list moves the frontier, to the instant it began less 15 minutes. A listing the deadline cuts, or a page that throws (a 5xx past `fetchJson`'s 429 retry, recorded as `listError`, redacted), leaves the frontier and keeps every row it queued, and the tick goes on to the drain.
- **The drain:** the queue oldest list day first, in rounds of 500, each round past the previous one's last row, so a row that failed this tick waits for the next. A write deletes the row; a failed fetch charges an attempt and writes `last_error`; the third drops the row, named in the stats.
- **Nothing on that path compares at day precision.** The list prints days, the filter reads seconds and the detail carries the instant, so every entry the filter returns is fetched and the upsert decides.
- **The wide listing, where § 1 departs from the handoff.** Once a UTC day (`bills_wide_at`), the handoff's wide listing ran from the frontier less 48 hours *instead of* the frontier listing, and queued only what was missing or behind at day precision. Standing in for the frontier listing, its day compare passes over a same-day second update made after the frontier, leg F's shape, and then moves the frontier past it. So it runs *after* a completed frontier listing, as a second listing that never moves the frontier. At 151 updates a day it costs about two list pages. Leg H's added case reads it.
- **The route:** `maxDuration` 300, a 240 s budget, a 290 s soft timeout, the committees route's layering. At 2.13 bills a second, 240 s drains about 500 a tick against about 38 a tick of Congress.gov's volume.

**§ 2, the reset.** `UPSERT_SQL`'s seven summary clauses test a bound flag, `? = 1`: `update_date` moved and the latest action's date or text, or the text versions' count, changed. A count the detail omits reads 0. `changed_at` and the committee walk's failure count stay on `update_date` (a committee referral is metadata, and the HO 753 walk must see it); the stage trio is untouched. Each write reports whether it reset, by action and by text, and two moves the ruling counts without acting on: the CRS summaries' count (`crsMoved`, and `crsOnly` where nothing else reset) and the title.

**The legs** (`scripts/diagnostic/sync-frontier-790.ts --legs`, sha256 `520823ea…` on all three runs; the seed is 1,000 prod bills copied by `SELECT`, sha256 `0820a466…`). Each runs on a `file:` copy built by the real `scripts/migrate.ts`, against a stub Congress.gov on 127.0.0.1, with HO 771's tripwire installed and `.env` never loaded.
- **At `b64cc81`** (a worktree, the script copied in; `lib/sync.ts` there has no seam, so the tripwire rewrote Congress.gov to the stub, 19 times), **A, E and F read red:**
  - **A:** tick 1 upserted 10 and stopped on the budget; tick 2 listed from 2026-10-24T18:17:42Z, the window's freshest instant, and skipped it; 10 of the 40 at their new instants, 30 at their old `update_date`. HO 116's shape.
  - **E:** case 1, metadata only, nulled.
  - **F:** tick 2 listed from T and skipped the bill, `stored >= listUpdate` against the bare day; the store kept T.
- **At `feat` `474bbb1`:** A, B, C, D, F, G and H green; E and P red, both on § 2: a metadata-only write still resets, so E's case 1 was nulled and P's drain counted 11 resets where 4 are due.
- **At `fix` `24d37a5`: A to H and P green, 37 checks, 0 failed.** The tripwire refused 0 on every run.
  - **A:** tick 1 listed all 41 and stopped the drain on its deadline with 32 queued; tick 2 upserted those 32; all 40 at their new instants; the frontier moved once in tick 1, to its listing start less 15 minutes.
  - **B:** a re-update between pages 1 and 2 shifts every later entry left by five: all 600 queued once, the five re-updated at their newest day. The control at `overlap: 0` lost the five pushed across the boundary, positions 250 to 254, named.
  - **C:** the deadline fell during page 2: two pages, 475 queued, `listComplete` false, the frontier unchanged; tick 2 re-walked from the same frontier, queued the other 125, moved the frontier, and wrote all 600.
  - **D:** a 503 on the first list page set `listError` (redacted), kept the frontier, and the tick still drained the 5 queued before it; a detail answering 503 every time read attempts 1, 2, then dropped and named; one failing once was cleared on the next tick.
  - **E:** metadata only kept its summary, topics and `is_ceremonial`, with `changed_at` stamped; a new action nulled all seven and advanced the stage (`committee` → `other_chamber`, logged); a new text version nulled all seven; a same-instant re-read changed nothing, `changed_at` included. The tally: 4 written, 2 resets, 1 by action, 1 by text.
  - **F:** stored T (16:35:47Z), then T plus 4 hours (20:35:47Z), both on Oct 24.
  - **G:** the first tick listed from `MAX(update_date)` with `bootstrapped` true and the key written; on an empty table, from seven days back.
  - **H:** the wide listing ran from the frontier less 48 hours and wrote `bills_wide_at`; an entry 30 hours old stored on an older day was queued, one stored on its list day wasn't; the added case, a same-day second update past the frontier, was queued by the frontier listing while the wide listing's day compare passed over it; run again, `wide` false.
  - **P, added to the handoff's legs:** `--enqueue`'s and `--drain`'s own functions on the copy. The enqueue is idempotent; a live listing took a backfill row over, keeping its `enqueued_at`; the box's drain emptied the backfill queue in rounds of 2, 2 and 0 resets under a cap of 2, waited twice on the hole, kept both live rows, and left the 7 metadata-only summaries as they were. The checkpoint stopped a run without `--go` and halted one past its halt line with it.

**The migration on prod, run by Corey before the push.** Code's `npm run migrate` was refused by the session's auto-mode classifier as a production action, so Corey ran it from the box at 5:01 PM MT Oct 24 (23:01Z), after the go and before the push. It printed 214 lines. Against `b64cc81`'s output, read off fresh `file:` copies each migrated twice, the only new lines are 39 and 40: `ok: CREATE TABLE IF NOT EXISTS sync_queue (` and `ok: CREATE INDEX IF NOT EXISTS idx_sync_queue_drain …`. The handoff named the table's alone; the index is the next statement. Against HEAD's trial output the only differences are prod reading *already populated* and *already seeded (19775 rows)*, where an empty copy repopulates and seeds; no stop line. The schema read went from 222 entries to 225, the three on `sync_queue`: the table, `idx_sync_queue_drain`, and `sqlite_autoindex_sync_queue_1`, SQLite's own index for the text primary key. The 222 older entries still fingerprint `736e6b987bf77620`, and `sync_queue` holds 0 rows. The deployed `b64cc81` neither reads nor writes the table, so the order is safe.

**The pass, after the FF** (the same script; backlog `:81`'s second half). `--census` runs the HO 788 census as label 790a; `--enqueue --census 790a` queues every missing and behind row as `backfill`; `--drain` runs the cron's own drain on that queue in rounds capped at 150 resets, the next round 90 s past the next 10-minute boundary, after the summarizer's `*/10` tick, and checks the projection at the first round boundary at or past 300 drained: over 2,000 it waits for Corey's `--go`, over 4,000 it HALTs. The summary hole is read before each round, and a round waits while the pass's addition to it is over 1% of the corpus. The handoff paced the hole by the cap and the cadence alone, against a summarizer that clears 80 to 120 bills a tick, so 150 a round could outrun it. Then `--census` as label 790b, which reads 0 behind, or only rows listed today or yesterday.
- **What it sets going:** the pass stamps `changed_at` on every bill it writes, so the committee-bills walk (HO 753, `5 */6`) re-walks about 7,900 bills over the following days at its own budget. `bills_fts`'s `UPDATE OF title` trigger fires on every row. The next `/api/sync` tick's unconditional `expireTag("bills")` carries the writes to the pages.
- **The first Production tick** reads `bootstrapped` true and runs the wide listing too, since `bills_wide_at` is absent.

**What was flagged** (the paste carries each):
- the wide listing as a second listing (§ 1);
- the drain's `DELETE` and its attempt `UPDATE` scoped to the drain's own source, so a live listing that takes a row over while its bill is in flight keeps the row;
- `queueBefore`/`queueAfter` count the queue the tick drains, live on the route;
- three stats keys beyond the handoff's list: `droppedCount`, `wideComplete` and `crsOnly`;
- a detail with no update date charges an attempt where the old loop counted it upserted;
- the `fix` commit touches three files where the guard said one: comments in `scripts/migrate.ts` and `lib/summarize-runner.ts` that § 2 made false;
- the citation `lib/summarize.ts:217-220`;
- claim 7's control read;
- leg H's added case and leg P;
- the drain's hold on the hole;
- the instrument the handoff named for the new same-day line, which compares at day precision and can't see the shape (backlog);
- backlog `:81` noted rather than struck, since its close's second half is the 790b census;
- the migration, refused to the session by its classifier and run by Corey before the push, with two new lines where the handoff named one and three entries on `sync_queue`, the third SQLite's index for the text key.
- **The reconcile:** open 283 / 354 on 637, close **283 / 356 on 639**, mis-struck 0 at both, § OPEN LOOPS `:14-238` 81 / 126. `:17` and `:655` struck, two lines new, `:81` and `:105` noted. The handoff expected 282 / 357 with `:81` struck as well.
- **Also notes now run through HO 790.**

**Also (HO 791), the same-day late-index sampler, the frontier's first ticks read, and the ledger after HO 790. The sampler's first run reads 47 of 500 recently updated bills behind Congress.gov by a same-day second update the old sync left, none of them the frontier margin's. It opens with HO 790's FF go as taken.**
- **What's here:**
  - HO 790's FF go as taken, with its records;
  - the first tick and the pass, as read after the FF;
  - the corrections to HO 790's close and to two lines of its block, append-only;
  - STEP 0, a check: every claim held;
  - the frontier's ticks and the CRS meter;
  - the sampler, its control and its reading;
  - the ledger;
  - what was flagged.
- **Three commits, kinds unmixed:** `diag` (the sampler and `docs/probes/791-late-index.md`), `docs` (this block, the backlog, one oddities entry), then `docs(skill)`, alone and last.
- **Prod was read by `SELECT` only,** through `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN` by name, and nothing was written. Congress.gov had 1,001 detail reads, the key in each URL and in no printed line.
- **The pointer is 791:** pointer 790 (`docs/roadmap.md:7639`), highest HO in commit subjects 790, `main` at `a5ba9ee`.

**HO 790's FF go, as taken** (`docs/handoffs/790-ff-go.md`). The paste is `docs/handoffs/790-artifacts/paste-790-ff.md`, and it agrees with every record below.
- **`main` at `a5ba9ee`:** `b64cc81..a5ba9ee`, five commits, no force (1:13:23 PM MT Oct 25, 19:13:23Z). `790-review` was deleted on the remote at 19:13:38Z, and `ls-remote` then read `main` alone.
- **Production built fresh, with no dedup:** `dpl_G8xgVMhiyBHe3tyckMeMFAJ5sLRM` (`bld_403jlq8rt`, iad1), its build printing *VERCEL_FORCE_NO_BUILD_CACHE is set so skipping build cache step*. READY at 1:14:03 PM MT (19:14:03.272Z). The review Preview of the same SHA (`dpl_7fcAsEY98zDZwSfHd3EtbXNSgFMT`) was a separate deployment, 19.8 hours earlier.
- **`verify:deploy`, in the foreground:** first matched at 0 s and held five reads in a row, confirmed at 41 s.
- **The served SHA:** `/api/version`, plain and with a fresh query string, read `a5ba9ee` twice with `Cache-Control: no-store`, `X-Vercel-Cache: MISS` and `Age: 0`. The production alias resolves to that deployment, updated 0.14 s after READY.
- **`e2e-prod` #40225049209,** fired by the Production record: `smoke` **143 passed (5.6m)**, and its narrow pass read 82 cells against Production, every one `over=0`. GitHub labels its `head_branch` `790-review`, though the ref was deleted 27 s before the run was created; the run checked out `a5ba9ee`.
- **The record's lag, as a bound:** 0.7 to 1.7 s after READY.
- **The go's lag, 19.5 hours.** The go was written against the ref at 5:35 PM MT Oct 24 and reached Code at 1:10 PM MT Oct 25 (19:10Z). In between, four `/api/sync` ticks ran on `b64cc81`: #27733, #27794, #27859 and #27922, each `success` and each with `seen` 0 from the old watermark, 13:53:37Z Oct 24. **Nothing was lost because Congress.gov listed nothing past that watermark during the lag,** not because of the queue, which `b64cc81` never reads or writes. The first tick on the new code was 00:00Z Oct 26 (6:00 PM MT Oct 25).

**The first tick and the pass, as read after the FF** (`paste-790-tick.md`, `paste-790-pass.md`, `paste-790-monday.md`).
- **Tick #27983** (6:00:11 to 6:01:29 PM MT Oct 25, 00:00:11 to 00:01:29Z Oct 26): `bootstrapped` true, `frontierBefore` 13:53:37Z Oct 24 (the `MAX(update_date)` read), `listComplete` true, `frontierAfter` 23:45:43Z Oct 25 (the listing's start less 15 minutes), `wide` and `wideComplete` true, `pages` 3 (one frontier, two wide), **`enqueued` 182**, the queue 0 before and after, `resets` 5 (all by text), 78,299 ms. The frontier listing listed 0. The wide listing queued the 182.
- **The 182's cause, proven.** Their update times fall in the Oct 23 window 08:05:17Z to 08:06:11Z. Old-code tick #27341 (6:00:31 to 6:00:40 AM MT Oct 23, 12:00:31 to 12:00:40Z) has 53 surviving writes, with `update_date`s from 08:06:11Z, the top of that window, to 10:56:21Z, none lower. Its descending walk reached the batch and stopped inside it on its budget: HO 116's drop, read directly. The first wide listing was its first live repair.
- **Census 790a** (6:06:40 to 6:12:03 PM MT Oct 25, read-only): Congress.gov listed 19,775 and prod stored 19,775. It read 0 missing, 0 ahead, 12,068 current and **7,707 behind**. That's 195 fewer than HO 788's closing 7,902, and all 195 had been written: 116 by the first tick's 182 and 79 by old-code ticks from 12:00Z Oct 22 to 12:00Z Oct 24. None joined.
- **The enqueue** (12.6 s): the queue empty before, 7,707 queued as `backfill`, every census id present after.
- **The drain** (`--reset-cap 150`, 6:13:01 to 7:34:35 PM MT, 00:13:01 to 01:34:35Z), three rounds, the queue empty after, nothing dropped. The reset parts are separate (action only / text only / both), so each round's parts sum to its resets:

| Round | Written | Resets | Action only / text only / both | Kept | CRS moved (no reset) | Title moved | Failed |
|---|---|---|---|---|---|---|---|
| 1 | 1,385 | 150 | 28 / 122 / 0 | 1,235 | 178 (174) | 102 | 0 |
| 2 | 4,799 | 150 | 16 / 132 / 2 | 4,649 | 213 (207) | 134 | 5 |
| 3 | 1,523 | 91 | 8 / 82 / 1 | 1,432 | 112 (108) | 72 | 0 |
| Sum | **7,707** | **391** | **52 / 336 / 3** | **7,316** | 503 (**489**) | 308 | 5 |

  With the overlap counted twice, by action is 55 and by text 339, so 55 + 339 − 3 = 391.
  - **The checkpoint** projected 835 resets at the first round boundary at or past 300 drained, which was round 1's end (1,385 drained, 150 reset). The run made 391. The oldest-listed end reset the most: 10.8% in round 1, 3.1% in round 2, 6.0% in round 3.
  - **The five Senate timeouts** (`119-s-698`, `119-s-707`, `119-s-762`, `119-sres-225`, `119-sres-371`) each took over 15 s in round 2. All five were written on their second try, as round 3's first rows.
  - **Prod matched the tally.** 7,707 bills carry a `changed_at` in the drain's span. All 391 reset summaries were rewritten by the 7:40 PM MT tick (01:40Z): the 7:35:56 PM MT read found 30 still empty, and that tick landed them. 7,316 kept theirs. One stage transition was logged, and the queue was empty.
  - **The summary hole peaked at the 6:20 PM MT tick's 107** (00:20:23Z). The summarizer selects only `summary IS NULL`, and the hole was 0 when the drain began. Each round's resets were cleared before the next began, so the hole never passed a round's 150, under the ~198 that is 1% of the corpus, and the drain never waited on it.
- **Census 790b** (7:36:16 to 7:43:21 PM MT Oct 25, 01:36:16 to 01:43:21Z Oct 26): **0 behind, 0 missing,** at day precision. HO 791's sampler reads what that precision can't (below).
- **Monday's ticks and the walk,** as Code read them at 3:45 PM MT Oct 26 and as `--ticks` reads them below. #28044 and #28110 listed 0, and #28183 queued and wrote 26. The committee walk's four rows from #27986 read walked 182, 500, 500 and 500, with `remaining` 0, 7,023, 6,523 and 6,042.
- **The box's rules** (`.claude\settings.local.json`):
  - three allow rules, narrow by design: `Bash(npm run migrate)` exact, `… sync-frontier-790.ts --enqueue:*` and `… --drain:*`;
  - one ask rule, `… sync-frontier-790.ts --drain *--go*`;
  - the two echo-with-grep one-offs removed.

  The ask rule is structural only for commands typed mode flag first. The script reads `--drain` and `--go` anywhere in its arguments (`sync-frontier-790.ts:70`, `:1031`), so `--go --drain` or a respelled path gets past it. The script's own stop, over 2,000 projected without `--go`, holds regardless. The rule has never fired, so it is untested live.
- **The security monitor's flag, as Code corrected it.** It flagged two of Code's docs-check agents `[Auto-Mode Bypass]`. `research:syntax` ran two open-web WebSearch queries, which returned third-party links it never opened. Every WebFetch went to code.claude.com/docs or the Claude Code changelog, and the rest were read-only Grep and Read. Nothing was edited, and no shell command ran.
- **The Sabato daily task's 5:00 PM MT run on Oct 25 logged nothing and saved no page.** `sabato-daily.log` ends at 5:00:14 PM MT Oct 24 (23:00:14Z). Read at 6:05 PM MT Oct 26 (00:05Z Oct 27), it holds no Oct 26 line either (backlog, new).

**The corrections, append-only** (`docs/handoffs/790-artifacts/paste-790-close-check.md`, Code's read-only check of `790-close.md` against the logs, the readings and `main`, 12:45 to 1:55 PM MT Oct 26). HO 790's block is settled history, so these land here and nothing above changes. The handoff calls all 17 corrections to the landed block. **Two are, in item 2; the other fifteen correct the chat's close** (`docs/handoffs/790-close.md`, untracked, its line numbers as saved at 12:39 PM MT Oct 26), whose readings the records above carry corrected.
- **In landed text** (item 2, from `dcae4c4`):
  - **`docs/roadmap.md:7575`'s *Backlog `:40`'s wall*** is Sabato's reader line, *Sabato's reader is refused: Cloudflare challenges the honest agent from both networks* (`:44` at `a5ba9ee`, `:42` at `b64cc81`, `:40` at `57ba88e`). The number was copied from `789-close.md`. At `a5ba9ee`, `:40` is Code's data-cache line (HO 780).
  - **`docs/roadmap.md:7621`'s mechanism** named the next `/api/sync` tick's `expireTag("bills")`. The summarizer runs `expireTag("bills")` on every tick that lands a summary (`app/api/cron/summarize/route.ts:121`), and all nine of its ticks from 6:20 to 7:40 PM MT Oct 25 landed some. So the pages took the pass's writes during the pass, every one flushed by 7:40 PM MT (01:40Z), and the 06:00Z flush added nothing for it.
- **In the close:**
  1. `:36`'s *Backlog `:81`'s close is read* is `:83`, the HO 752 line. `:81` at `a5ba9ee` is the HO 754 committees-errors line.
  2. `:67`'s *"missed nothing" narrowing* never landed (`git grep -i "missed nothing" main` finds nothing). It was said of tick #27983's frontier listing, not of #27341 (`:44`). The same correction's second half, that the tick paste's 173 passed over counts reads, about 148 distinct bills of 330 listed, is dropped at `:44`. The two lines of landed text are item 2's.
  3. `:62`'s *Backlog `:40` stays Corey's* is `:44`, the same stale number.
  4. `:26`'s *its queue peaked at 18 bills* understates it. 18 was one reading in round 2 at 7:04 PM MT. The 6:20 PM MT tick landed 107, so the hole held at least 107 then (the record above).
  5. `:35`'s *835 resets after the first 300* came at round 1's end, 1,385 drained and 150 reset (`drain-2026-10-26T0013.log:19`). "After the first 300" is the handoff's spec. The gate could act only after a full round.
  6. `:35`'s *30 still empty, 361 rewritten by 7:40 PM MT* is the 7:35:56 PM MT read. The 7:40 PM MT tick landed the last 30, so by 7:40 all 391 were rewritten.
  7. The table at `:28-33` carries by action and by text with the overlap counted in each. As separate parts the rounds read 28 / 122 / 0, 16 / 132 / 2 and 8 / 82 / 1, summing to 52 / 336 / 3, the table above. `:59`'s *eight times the by-action resets* is 489 / 55 = 8.9.
  8. `:67`'s *three censuses* were two, 790a and 790b.
  9. `:8`'s *the queue is durable* has the outcome right and the mechanism wrong. `b64cc81` never touches `sync_queue`, which held 0 rows at 1:19 PM MT Oct 25. Nothing was lost because Congress.gov listed nothing past the 13:53:37Z Oct 24 watermark (the record above).
  10. `:62`'s *`sabato-daily.log` lines for Oct 24 and 25 are unread*: the log has no Oct 25 line. Its four lines end at 5:00:14 PM MT Oct 24.
  11. `:50`'s *official docs and the changelog* was Code's first filing, corrected before the close: two open-web WebSearch queries, nothing opened (the record above).
  12. `:50`'s *verified by two harmless calls at 1:47 and 1:48 PM MT* ran at 1:47:59 and 1:48:28 PM MT, after the allow rules and before the ask rule existed (2:55 PM MT). They are consistent with the allow rules taking effect and don't prove it, and the ask rule has never fired.
  13. `:49`'s *makes Corey's 2,000-reset gate structural* holds only for the form typed mode flag first (the record above). The settings diff is in the tick paste, not the pass paste.
  14. The title's *proven on its first tick*: that tick's frontier listing listed 0, the 182 came from the wide listing, and the tick never stopped on its budget. A budget-cut tick resuming from the queue has been shown only on the stub, in legs A and C.
  15. `:3`'s *read off the remote, not off Code's paste* is true of the refs. The `e2e-prod` and lag bullets (`:7`, `:8`) are Code's readings as pasted, like `:6`'s deploy.
  16. `:37`'s *found 7,523 bills owed a walk and started on them at 12:05 AM MT Oct 26*: 7,523 is Code's `SELECT`, by the walk's own predicate, at 7:39 PM MT Oct 25. No walk row has reported it; the walk's rows are above.
  17. `:41`'s *(a weekend)*: Oct 26 was a Monday. Both censuses ran Sunday evening MT, 00:06 to 01:43Z Monday, so the UTC "today or yesterday" window held only weekend hours. The newest list day was Saturday Oct 24, with 23 entries.
- **The rule this applies is the method's existing one,** not a new entry. A ground-truth paragraph quotes what was read at its SHA, and a backlog `:N` is an as-of marker: so a `:N` rides here only as a parenthetical with its SHA, and every line is anchored by its opening words (guard 4).

**STEP 0, a check: claims 1 to 10 held, and none was a HALT.**
- **1:** `main` at `a5ba9ee`; the pointer 790 at `:7639`; the highest HO in commit subjects 790; the one numbered file above 790 is this one.
- **2:** every `lib/sync.ts` anchor read as stated: `FRONTIER_MARGIN_MS` `:35`, `WIDE_WINDOW_MS` `:37`, `walkList` `:526`, the wide listing's day compare `:562-569` (`s.slice(0, 10) >= day` at `:566`), `runSync` `:701`, the frontier advance `:763`, the wide decision `:769`, `wideFrom` `:772`.
- **3** (prod, 5:46 PM MT Oct 26, 23:46Z): `bills_frontier` `2026-10-26T17:45:10Z`, updated 12:00:15 PM MT (18:00:15Z); `bills_wide_at` `2026-10-26T00:00:55.127Z` (6:00:55 PM MT Oct 25), updated then; `sync_queue` 0 rows.
- **4:** every `/api/sync` row since 00:00Z Oct 26 read `success`: #27983, #28044, #28110 and #28183, and nothing since, as Code read them at 3:45 PM MT.
- **5:** `app/api/cron/summarize/route.ts:121` is `if (stats.ok > 0) expireTag("bills")`.
- **6:** `bills-gap-788.ts`'s `--census` usage at `:10` (with `--vs` beside the handoff's flags), `ART` at `:72`, `MODES` at `:93`; `census-790a.csv` 7,707 behind and 0 missing, `census-790b.csv` 0 and 0.
- **7:** the backlog lines and the two roadmap lines as stated; the reconcile at open 283 / 356 on 639, mis-struck 0.
- **8:** SKILL `## Congress.gov API` `:44`, `### External data sources` `:59`, `## Sync logic` `:1249`, `### Backfill scripts` `:1365`, the 790 scripts line `:1385`; `docs/probes/` held five files.
- **9:** `paste-790-close-check.md` on the box, 17 items.
- **10:** one detail read, `x-ratelimit-remaining` 19,999.

**The frontier's ticks** (`scripts/diagnostic/late-index-791.ts --ticks`, 5:46 PM MT Oct 26): every `/api/sync` row since Production READY, four ticks, about a day. The handoff's "first week" isn't there yet.

| tick | started | elapsed_ms | listComplete | pages | listedCount | enqueued | upserted | resets (action / text) | crsOnly | wide | budgetStopped | failed | dropped |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| #27983 | 6:00:11 PM MT Oct 25 (00:00:11Z Oct 26) | 78,299 | true | 3 | 0 | 182 | 182 | 5 (0 / 5) | 5 | true | false | 0 | 0 |
| #28044 | 12:00:11 AM MT Oct 26 (06:00:11Z) | 7,119 | true | 1 | 0 | 0 | 0 | 0 | 0 | false | false | 0 | 0 |
| #28110 | 6:00:10 AM MT (12:00:10Z) | 8,536 | true | 1 | 0 | 0 | 0 | 0 | 0 | false | false | 0 | 0 |
| #28183 | 12:00:10 PM MT (18:00:10Z) | 22,180 | true | 1 | 26 | 26 | 26 | 0 | 3 | false | false | 0 | 0 |
| **Sum** | 4 ticks, all `success` | | | 6 | | 208 | 208 | 5 (0 / 5) | **8** | | | 0 | 0 |

Every tick read `queueBefore` and `queueAfter` 0, and `wideComplete` matched `wide`. The full table, with every key the handoff named, is in the probe.
- **The CRS meter: `crsOnly` 8 over `upserted` 208, 3.85%.** Five are the first tick's repair, and three are among #28183's 26 writes. One day of ticks isn't the ongoing rate, so Corey's ruling waits as planned.
- **The committee walk:** #27986, #28046, #28113 and #28186 walked 182, 500, 500 and 500, with `remaining` 0, 7,023, 6,523 and 6,042, `failed` 0 throughout, and `capHit` from #28046 on. At 500 a tick, 6,042 is 13 more ticks, the last near 6:05 PM MT Oct 29 (00:05Z Oct 30). That's a projection. `remaining` fell 481, not 500, between the last two, so newly owed bills join as it goes.

**The sampler** (`scripts/diagnostic/late-index-791.ts --sample`, `docs/probes/791-late-index.md`).
- **The method.** The population is every `bills` row with `update_date` in the last `--days` (7). A seeded shuffle (mulberry32) draws `--n` (500), the seed defaulting to the run's start second. `bills_frontier` (F) is read once before the first detail read. Each bill gets one detail read (the 15 s cap, `fetchJson`'s 429 retry). The detail's `updateDateIncludingText` (U2) is set against the stored `update_date` (U1), both to the second.
- **The classes:**
  - *current* (U2 = U1);
  - *pending* (U2 > U1, U2 ≥ F);
  - *same-day miss* (U2 > U1, U2 < F, the same UTC day);
  - *wide-reachable* (a later day, U2 ≥ F − 48 h);
  - *wide-unreachable* (a later day, U2 < F − 48 h);
  - *ahead* (U2 < U1);
  - *unread*.
- **The control** runs on the same reads before any class prints. Five current bills have U1 moved back an hour in memory (U1 at or past 01:00Z, U2 < F) and must read *same-day miss*. Five others moved back three days (U2 < F − 48 h) must read *wide-unreachable*. Every other bill must read as it does unmodified.
- **Run 1, seed 1793058413** (5:49:52 to 5:52 PM MT Oct 26, 23:49:52 to 23:52Z). The population was 670 bills with `update_date` at or after 2026-10-19T23:49:52Z, and 500 were drawn. F was 2026-10-26T17:45:10Z. 500 details read, all 200, in 105 s.
  - **The control passed:** `119-s-2702`, `119-hr-6025`, `119-hr-7177`, `119-s-3082` and `119-hr-7815` at −1 h read *same-day miss*; `119-hr-2940`, `119-s-1158`, `119-hr-10083`, `119-hr-7247` and `119-hr-5769` at −3 d read *wide-unreachable*; nothing else moved.
  - **The reading:** 436 current, 17 pending, **47 same-day misses**, 0 wide-reachable, 0 wide-unreachable, 0 ahead, 0 unread.
  - **The 47,** each named with its lags in the probe, run from 7 minutes (`119-s-2787`) to 16 hours 59 minutes (`119-s-2316`). Every U2 falls on Oct 20 to Oct 24, before 13:53:37Z Oct 24, the frontier's bootstrap instant, so no frontier listing ever covered one. Every U2 is also below F − 48 h. 24 were inside the first tick's wide window, from 13:53:37Z Oct 22, and its day compare passed them over. 17 share one Congress.gov batch, 13:58:33Z to 13:58:34Z Oct 23. Five read by `SELECT` were written by old-code ticks from details that read U1 at the time: their `raw_json` dates equal their `update_date`.
  - **The 17 pending** have U2 from 19:25:19Z to 21:39:35Z Oct 26, above F, which leaves them to the 00:00Z Oct 27 tick's frontier listing. **Read after that tick** (#28252, `success`, 40 written, its wide listing from 17:45:10Z Oct 24; `SELECT` at 6:04:20 PM MT): all 17 at their U2, and all 47 misses still at their U1.
- **The first run's control failed, and that was a defect in the handoff's classes.** As written, *same-day miss* (U2 < F, same day) and *wide-unreachable* (U2 < F − 48 h, any day) overlap. The first build checked the window first, so all five −1 h bills, each older than the window, read *wide-unreachable*. The control voided the run before a class printed (`docs/handoffs/791-artifacts/sample-1793058413-control-failed.log`). The second build puts same-day first, because below the frontier a same-day late index is missed wherever U2 falls. *Wide-unreachable* is now a later day only. The same seed redrew the same 500 from the same 670.
- **What it reads, for the margin:** nothing yet. 16 sampled bills were stored since the frontier began, and all 16 read current. **For the pass:** census 790b's zero is at day precision. At second precision a residual exists, about 63 in the 670 by the sample's rate, an estimate. The corpus before Oct 20 is unsampled. No listing will reach these bills again. That residual is the old compare's other loss, not the older-tail drop the pass repaired. It is filed as its own line, and its repair is the next HO's (guard 5).

**The ledger.**
- **Backlog:**
  - *`/api/sync` leaves a bill's stored `update_date` behind Congress.gov…* (HO 752) **struck** on census 790b, with the residual filed, as the line's own rule asks: leg A red at `b64cc81` and green at `474bbb1`; the first tick's 182; 790a 7,707 behind, the pass's 7,707 written; 790b 0 behind and 0 missing. The handoff's close note said *no residual*, and this one names the residual instead.
  - *Should a new CRS summary re-summarize?* gains 489 and the meter's 8 of 208. Still Corey's.
  - The struck HO 788 line gains the pass's tally.
  - *A same-day second update that Congress.gov indexes late…* gains the instrument and run 1. Its sampler reads the rows stored since the frontier until the residual line closes, and its close is unchanged.
  - Two lines new: *Bills the old sync left behind by a same-day second update sit below every listing* (Code, medium), and *The Sabato daily task's 5:00 PM MT runs on Oct 25 and Oct 26 logged nothing* (Corey, low).
  - **The reconcile:** open 283 / 356 on 639, close **284 / 357 on 641**, mis-struck 0 at both. The numstat reads 6 / 4: the 4 deletions are the four lines rewritten in place (three appended, one struck), and the 2 net additions are the new lines.
- **Oddities:** one entry, *The zero that closed a pass was read at day precision*, with the class overlap the control caught.

**What was flagged** (the paste carries each):
- the reading itself: 47 same-day misses, none the margin's, all from before the frontier;
- the handoff's overlapping classes, caught by the first run's control, and the order the second build gives them;
- the HO 752 line struck with its residual filed as a new line, where the handoff wrote *no residual* and filed a second line only on a wide-unreachable or ahead bill;
- the oddities entry's subject, the day-precision zero, where the handoff's wording, *the 15-minute margin met a real indexing lag*, would be false of this reading;
- the same-day line's sampler scoped to the rows stored since the frontier, a forced consequence of the residual and not a widening;
- the 17 corrections, two to landed text and fifteen to the chat's close, where the handoff counts all 17 against the landed block;
- "the first week of ticks" reading one day, four ticks;
- the Sabato line covering Oct 26's run as well, read today;
- 1,001 detail reads where the handoff costed about 500: the first run's 500, the second's 500, and STEP 0's one.
- **Also notes now run through HO 791.**

**Also (HO 792), the old compare's residual counted at second precision and re-synced: 468 of the 11,768 bills old code stored read behind Congress.gov by a same-day second update, went through the 790 pass's enqueue and drain, and a recheck reads every one current. The Sabato task's cause found and fixed by Corey. It opens with HO 791's FF go as taken.**
- **What's here:**
  - HO 791's FF go as taken, with its records;
  - the Sabato task, found and fixed by Corey;
  - STEP 0, a check: every claim held;
  - the count, its control and its reading;
  - the enqueue, the drain and the recheck;
  - the ticks and the CRS meter;
  - the ledger;
  - what was flagged.
- **Three commits, kinds unmixed:** `diag` (`--count` and `--recheck` in `scripts/diagnostic/late-index-791.ts`), `docs` (this block and the backlog), then `docs(skill)`, alone and last.
- **Prod was written twice, by `scripts/diagnostic/sync-frontier-790.ts --enqueue --census 792r` and `--drain --reset-cap 150`, under their allow rules,** and read by `SELECT` otherwise. No `/api/sync` call, no migration, no `--go`. Congress.gov had 12,345 detail reads from the box (STEP 0's one, the count's 11,768 and its 108 retries, the recheck's 468), plus the drain's 468 through `runSync`, the key in each URL and in no printed line.
- **The pointer is 792:** pointer 791 (`docs/roadmap.md:7783` at `5d862e3`; the handoff cited `:7653`), highest HO in commit subjects 791, `main` at `5d862e3`.

**HO 791's FF go, as taken.**
- **`main` at `5d862e3`:** `a5ba9ee..5d862e3`, three commits, no force. `791-review` was deleted on the remote and locally, local `main` went forward by `--ff-only`, and `ls-remote` then read `main` alone.
- **The cold build before the push:** `.next` held one junction, `.next\node_modules\@libsql\client-6da938047d5fc1cd` to `node_modules\@libsql\client`. It was unlinked with `cmd /c rmdir`, its target was confirmed intact from a separate process, and only then was `.next` removed. The build exited 0 with 0 warning lines.
- **The typecheck:** the first e2e call, `tsc --noEmit -p e2e`, was the wrong path (TS5057, no `tsconfig.json` there). The reading is `npm run typecheck`, which runs `tsc --noEmit` and `tsconfig.e2e.json`, exit 0. `check:odds-sites` read OK (190 `.tsx` scanned, 13 reference a market, 13 listed) and `check:design-citations` OK (1,166 scanned, 167 citations, 0 problems).
- **The deploy:** Production record `7347880432` at 7:25:05 PM MT Oct 26 (01:25:05Z Oct 27), `success`. `/api/version` read `5d862e3` at 7:25:42 PM MT (01:25:42Z); a read at 7:24:23 PM MT (01:24:23Z), before the record, still read `a5ba9ee`.
- **`e2e-prod` `40432444562`,** fired by the record: smoke **143 passed (5.8m)**, concluded 7:31:39 PM MT (01:31:39Z). No dispatch, no flush.

**The Sabato task, found and fixed by Corey at 8:32 PM MT Oct 26 (02:32Z Oct 27).**
- **The cause:** Task Scheduler fired at 5:00:01 PM MT Oct 26 and refused: `LastTaskResult` 2147946720 (`0x800710E0`, *the operator or administrator has refused the request*), `NumberOfMissedRuns` 0, the task reading `State: Running`. Saturday's 5:00 PM MT run (Oct 24) logged at 5:00:03 PM (ok 200, 447,120 bytes) and 5:00:14 PM (ingest exit 0, 89 and 14 unchanged, nothing to flush), then held the task on its verdict popup. The task's default refuses a second instance, so the Oct 25 and Oct 26 runs never started.
- **The fix:** Corey stopped it, turned the two battery conditions off, `StartWhenAvailable` on and `ExecutionTimeLimit` to two hours, and ran it through Task Scheduler: `LastTaskResult` 0 at 8:32:14 PM MT. The log carries 8:32:15 PM (ok 200, 447,120 bytes, cf-ray `a50e4a0bcbe6b7cf-DEN`) and 8:32:24 PM (ingest exit 0, unchanged, nothing to flush).
- **Read back at STEP 0** (11:55 AM MT Oct 27, 17:55Z): `DisallowStartIfOnBatteries` False, `StopIfGoingOnBatteries` False, `StartWhenAvailable` True, `ExecutionTimeLimit` PT2H, `MultipleInstances` IgnoreNew; `State` Ready, `LastRunTime` 8:32:14 PM MT Oct 26, `LastTaskResult` 0, `NextRunTime` 5:00 PM MT Oct 27, `NumberOfMissedRuns` 0. The log's lines since 8:32:15 PM are those two. A day nobody clicks the popup now ends at 7:00 PM with `LastTaskResult` `0x41306` (terminated), the log carrying the verdict.

**STEP 0, a check: every claim held** (11:55 AM MT Oct 27, 17:55Z; `docs/handoffs/792-artifacts/step0.log`).
- **1:** `main` `5d862e3`, pointer 791 (at `:7783`, not the handoff's `:7653`), highest HO in subjects 791, and the one numbered file above 791 is this handoff.
- **2:** `late-index-791.ts` at every cited line: `MODES` `:39`, `ART` `:42`, `WIDE_WINDOW_MS` `:52`, `DETAIL_TIMEOUT_MS` `:53`, `WRITE_WORD` and `q()` `:103-104`, `detail()` with its own 429 retry `:117-137`, `detailInstant` `:139-142`, `classify` `:255-265` with same-day before the window, `sample()` `:269`.
- **3:** `sync-frontier-790.ts`: `ART788` `:72`, `CensusRow` `:896`, `readCensus` `:897-907` with the four header columns and the day from `list_updateDateIncludingText` else `list_updateDate`, `enqueueBackfill` `:933-947`, `--enqueue` taking `missing` and `behind` `:1009`.
- **4:** #27983 (6:00:11 PM MT Oct 25, 00:00:11Z Oct 26) is the one `/api/sync` row whose `sync.bootstrapped` is true; the row before it, #27922, carries no `listComplete`, old code's payload. The six rows since read `success`. `sync_queue` held 0 rows. `bills_frontier` 2026-10-27T11:45:11Z (updated 6:00:24 AM MT, 12:00:24Z); `bills_wide_at` 2026-10-27T00:00:25.698Z.
- **5:** the population (`changed_at IS NULL OR changed_at < '2026-10-26T00:00:11Z'`) **11,768**, of them 9,063 with `changed_at` NULL; the complement 8,020; `COUNT(*)` 19,788, the two summing to it. `MAX(update_date)` over the population is 2026-10-24T13:53:37Z, the bootstrap instant itself.
- **6:** `x-ratelimit-limit` 20,000, `x-ratelimit-remaining` 19,999.
- **7:** the task's settings read back as Corey set them (above).
- **8:** backlog `:15` to `:18` and `:46` as cited, reconcile 284 / 357 on 641, mis-struck 0; SKILL `:74` and `:1386` as cited.

**The count, `--count --label 792a`** (`docs/handoffs/792-artifacts/count-792a-2026-10-27T1956.log`, `count-792a.csv`).
- **The run:** one start, no restart, 11:59:09 AM to 1:56:40 PM MT (17:59Z to 19:56Z), 117.5 minutes. F was read once before the first detail read: 2026-10-27T11:45:11Z (5:45:11 AM MT). Two workers held to 2.5 reads a second; Congress.gov's latency held them under it, from 1.81 a second in the first 500 to 1.04 at the slowest stretch. `x-ratelimit-remaining` never fell under 8,000, so there were no pauses. 108 reads timed out at 15 s; each was retried once at the end and read.
- **The control** ran on this run's own first 22 rows, before any was written or any class printed, and passed. Moved back one hour, each read *same-day miss*: `119-hconres-10`, `119-hconres-108`, `119-hconres-111`, `119-hconres-112`, `119-hconres-113`. Moved back three days, each read *wide-unreachable*: `119-hconres-114`, `119-hconres-118`, `119-hconres-12`, `119-hconres-120`, `119-hconres-121`. Every other row was unchanged.
- **The reading:** current 11,265 · pending 23 · **same-day miss 468** · wide-reachable 12 · wide-unreachable 0 · ahead 0 · unread 0.
- **The misses' lag:** median 5 h 15 m, p90 9 h 50 m, max 18 h 00 m 28 s (`119-hres-1530`).
- **By U1's month, misses over the population:** none from Jan 2025 through Apr 2026 (0 of 6,894); then May 2026 4/240, Jun 1/274, Jul 24/557, Aug 56/795, Sep 193/1,483, Oct 190/1,525. The misses fall on 62 stored days, the most on Sep 24 (41), Aug 20 (39) and Oct 16 (37). Why none before May isn't read here.
- **HO 791's 47 against the count:** 39 are among the 468. Six read pending (Congress.gov moved them again on Oct 27). `119-hr-10866` and `119-hr-10870` left the population: the frontier wrote them on Oct 27 (`changed_at` 12:00:42Z and 18:00:23Z) after Congress.gov moved them.
- **The 12 wide-reachable** are one batch, `119-hr-10885` to `119-hr-10906`, U1 13:58:33–34Z Oct 23 and U2 05:23:33–34Z Oct 27, under F and inside the window. Tick #28313 (12:00:11 AM MT Oct 27, 06:00:11Z) listed from its frontier, 23:45:12Z Oct 26, and wrote 19, not these; #28378 listed from 05:45:11Z, above them. So Congress.gov indexed them at least 37 minutes after their instant: the first late index past the 15-minute margin that the sampler or the count has read. The wide listing of the 00:00Z Oct 28 tick should take them (a different day from U1); left out of the census as the handoff says, and the next HO reads them.
- **The 23 pending** have U2 on Oct 27, at or after F; the frontier takes them.
- **The census file:** `docs/handoffs/788-artifacts/census-792r.csv`, 468 rows (468 same-day misses, 0 wide-unreachable), class `behind`, both date columns U2's day.

**The enqueue, the drain and the recheck.**
- **The enqueue** (1:57:06 PM MT, 19:57:06Z): `census-792r: 468 rows (missing 0, behind 468)`, the queue before empty; newly queued 468, already queued 0; the queue after `backfill 468`, the census's ids in the queue 468 of 468.
- **The drain** (`--drain --reset-cap 150`, 1:57:33 to 2:02:53 PM MT, 19:57Z to 20:02Z, 319.8 s; `drain-792r.log`): one round, the hole at the start 0 of 19,788. Fetched 468, written 468, **resets 20** (by action 14, by text 10, by both 4), kept 448, `crsMoved` 16 (**`crsOnly` 16**), title moved 35, failed 0, dropped 0. The checkpoint projected 20 for the run, under 2,000, so no `--go` came up. The queue ended at 0.
- **The recheck** (`--recheck 792r`, 2:03:04 to 2:06:14 PM MT, 20:03Z to 20:06Z, 2.50 a second; `recheck-792r.csv`): F 2026-10-27T17:45:10Z; **current 468**, pending 0, every other class 0. None dropped, so no `census-792s.csv`.
- **The consequence:** the drain stamped `changed_at` on every bill it wrote, so the committee-bills walk re-walks them at its own budget.

**The ticks and the CRS meter** (`--ticks`, 2:06:22 PM MT, 20:06Z).
- **Eight `/api/sync` ticks since HO 790's READY,** every one `success`: 448 enqueued, 448 upserted, 34 resets (by action 23, by text 15), `crsOnly` 13. **The meter reads 13 of 448, 2.90%**; the drain's is 16 of 468, 3.42%.
- **The committee walk:** `remaining` 5,578 at 6:05 PM MT Oct 26, 5,442, 5,040, then 4,984 at 12:05 PM MT Oct 27 (18:05Z). Two ticks walked short: #28315 (12:05 AM MT Oct 27) 140 with 2 failed, and #28454 (12:05 PM MT, during the count) 78 with 20 failed. The count shared Congress.gov's slowness that hour and may have added to it; which isn't settled here.

**The ledger.**
- **Backlog:**
  - *Bills the old sync left behind by a same-day second update…* (HO 791) is **struck**: 468 counted, 468 re-synced, the recheck 468 current.
  - *The Sabato daily task's 5:00 PM MT runs on Oct 25 and Oct 26 logged nothing…* gains the cause and the four settings, with a dated note: one logged run so far (8:32 PM MT Oct 26). The strike is owed to the next HO, at three.
  - *Should a new CRS summary re-summarize?* gains a dated note with the meter and the drain's `crsOnly`; still Corey's.
- **Reconcile:** 284 / 357 on 641 at open; 283 / 358 on 641 at close, mis-struck 0.
- **No oddities entry:** the count read 0 wide-unreachable and 0 ahead. The month pattern is recorded above, unexplained.

**What was flagged.**
- The pointer's line: `:7783` at `5d862e3`, not `:7653`.
- The count ran at 1.04 to 1.81 reads a second, not 2.5: Congress.gov's latency, 108 timeouts at 15 s. It took 117.5 minutes, not about 80.
- The drain's command carried a redirect of its output to `drain-792r.log`; the allow rule matched it, no prompt.
- The 12 wide-reachable bills: a late index past the margin, read once, owed to the next HO's read.
- The Sabato line isn't struck: two of its three runs fall after this commit.
- **Also notes now run through HO 792.**

**Also (HO 793), the wide listing fetches everything it lists, and the queue drains first in, first out. The last day compare leaves the live path, so an update Congress.gov indexes under 48 hours late is fetched whether it falls on the stored day or a later one. It opens with HO 792's FF go as taken.**
- **What's here:**
  - HO 792's FF go as taken, with its records and its two reads;
  - STEP 0, a check: every claim held;
  - the change;
  - the legs, red at the base and green at the fix;
  - the ledger;
  - what's owed after the FF;
  - what was flagged.
- **Four commits, kinds unmixed:** `fix` (`lib/sync.ts`), `diag` (the legs in `scripts/diagnostic/sync-frontier-790.ts`), `docs` (this block and the backlog), then `docs(skill)`, alone and last.
- **Prod was read by `SELECT` only** and nothing was written: no pass, no enqueue, no drain, no `/api/sync` call, no migration. The legs wrote `file:` copies only.
- **The pointer is 793:** pointer 792 (`docs/roadmap.md:7856`), highest HO in commit subjects 792, `main` at `67e9575`.

**HO 792's FF go, as taken.**
- **`main` at `67e9575`:** `5d862e3..67e9575`, three commits, no force. `792-review` was deleted on the remote and locally, local `main` went forward by `--ff-only`, and `ls-remote` then read `main` alone.
- **The gates before the push:** the cold build, its one junction (`.next\node_modules\@libsql\client-6da938047d5fc1cd`) unlinked first and its target confirmed from a separate process, exit 0 with 0 warning lines; `npm run typecheck` 0; `check:odds-sites` OK (190 scanned, 13 reference a market, 13 listed); `check:design-citations` OK (1,166 scanned, 0 problems).
- **The deploy:** Production record `7374811499` at 7:34:26 PM MT Oct 27 (01:34:26Z Oct 28), `success` at 01:34:31Z. `/api/version` read `67e9575` at 01:34:42Z; a read at 01:34:31Z, the second the record succeeded, read `5d862e3`, the alias not yet moved.
- **`e2e-prod` `40615852674`,** fired by the record: smoke **143 passed (5.5m)**, concluded 7:40:34 PM MT (01:40:34Z). No dispatch, no flush.
- **Read 1, the 00:00Z Oct 28 tick:** #28520 (6:00:10 PM MT Oct 27), `success`, `wide` and `wideComplete` true. Its frontier listing (from 17:45:10Z) listed 24, and the tick enqueued and wrote 36, 12 resets. The twelve (`119-hr-10885` to `119-hr-10906`) are among them, each stored at its own instant (05:23:34Z, `119-hr-10899` and `119-hr-10905` at 05:23:33Z) and written at 00:00:48–49Z.
- **Read 2, the Sabato task:** it fired at 5:00:01 PM MT Oct 27 and logged at 5:00:02 PM *refused: status 403, challenge=True, 5,497 bytes, cf-ray `a515508f387424a5-DEN`*, keeping the challenge page, then ended at the two-hour limit with its popup up (`LastTaskResult` `0x41306`), as the settings predict.

**STEP 0, a check: every claim held** (8:04 PM MT Oct 27, 02:04Z Oct 28; `docs/handoffs/793-artifacts/step0.log`).
- **1:** `main` `67e9575`, pointer 792 at `:7856`, highest HO in subjects 792, the one numbered file above 792 this handoff.
- **2:** `lib/sync.ts` at every cited line: the header's wide-listing sentence `:12-15`; `DRAIN_BATCH` `:40`; `skipped`'s comment `:97`; `getStoredUpdates` `:250` with its HO 790 note `:248`, the day compare its only caller; `walkList` `:526`, `dayCompare` `:530`, `listedCount` `:543`, the no-date skip `:555`, the day compare `:562-569`; `drain` `:658` with *oldest list day first*, both `ORDER BY`s `:671` and `:677`, the cursor tuple `:676`; the frontier walk `:761`, the wide decision `:769`, the wide walk `:774`.
- **3:** `sync-frontier-790.ts`: `StubBill` `:315`, `failNextList` `:325`, `handleStub` `:357`, `tick()` `:436`, `setup()` `:488`, leg H `:734`, leg P `:767`, `legs()` `:823`.
- **4:** #28520 `elapsed_ms` 40,864, `budgetStopped` false, `queueAfter` 0. The last seven days of `/api/sync` (28 rows from 8:04 PM MT Oct 20): `elapsed_ms` max 78,299 (#27983, the bootstrap's wide tick) and median 17,872. One `budgetStopped`, #27341 (6:00 AM MT Oct 23), old code and not a wide tick; no wide tick has run out of budget. Two rows not `success`, #26948 and #27009 (Oct 22, 00:00Z and 06:00Z), old code's 520s on the `desc` listing (HO 788). The wide ticks: #27983 182 enqueued, #28252 40, #28520 36.
- **5:** `bills_frontier` 2026-10-27T23:45:10Z (updated 6:00:14 PM MT Oct 27); **273 bills** stored with `update_date` at or after it less 48 hours (23:45:10Z Oct 25), the stored share of what the next wide listing fetches. The handoff estimated about 340.
- **6:** SKILL `:50`, `:90`, Sync logic steps 2 and 3, and the `sync-frontier-790.ts` line as cited; backlog `:15`, `:16`, `:18`, `:46`; reconcile 283 / 358 on 641, mis-struck 0.

**The change** (`fix`, `lib/sync.ts` only).
- **The wide listing queues every entry it lists.** `walkList` loses `dayCompare` and its branch; `listedCount` is read when `!cfg.wide`, the one other place the flag told the listings apart. `getStoredUpdates` went with its only caller, a RECORD at the removal site (HO 116 batched it; HO 790 kept it for the day compare; HO 793 removed both). `skipped` counts list entries with no date, its comment saying the day compare also counted there until HO 793.
- **The drain is first in, first out:** both `ORDER BY`s and the cursor read `enqueued_at, list_update_day, bill_id`. The frontier listing enqueues before the wide listing, and a row already queued keeps its `enqueued_at`, so on the wide tick the fresh entries drain ahead of the window's re-reads. A backfill run stamps one `enqueued_at` for all its rows, so they still drain by list day.
- **The header:** nothing on the path compares a listed date with a stored one; once a UTC day the wide listing re-reads the last 48 hours whatever the stored day says; a RECORD of what comparing days cost (HO 791's 47 of 500, HO 792's 468 of 11,768).
- **`drainOrder?: "fifo" | "listDay"`** on `RunSyncOptions`, default `fifo`, for leg O's control only.
- Nothing else changed: the frontier, its 15-minute margin, the 48-hour window, the wide decision, the reset rule, the route and its budget. No migration.

**The legs** (`docs/handoffs/793-artifacts/legs-base-67e9575.log`, `legs-head-5b6dbe3.log`).
- **Red at `67e9575`** (a worktree at the base, the new script copied in, `--only H,L,O`): **H** red, 3 checks (`h2`, stored on its own list day, not queued; `skipped` 2; `h2` never fetched). **L** red on its one check (after tick 2 the store keeps U1 2026-10-27T21:00:00Z, U2 23:00:00Z); its control and its tick 1 pass. **O** red, 2 checks: the wide listing queued 10, not 310, so the deadline never cut and the control wrote all 10 fresh; O's red is the control's, as the handoff said. The tripwire refused 0.
- **Green at `5b6dbe3`,** every leg A to H, L, O and P: **43 checks passed, 0 failed,** the tripwire 0 refused.
  - **H:** h1 and h2 queued, `skipped` 0, and the second run writes h1, h2 and h3 at their listed instants, `h2` fetched once.
  - **L:** the control (tick 2 with `wide: false`) keeps U1; tick 1's frontier moves above U2 (to 01:56:10Z) with the store at U1; tick 2's wide listing writes U2.
  - **O:** `fifo` wrote 35 under the 5 s deadline, all 10 fresh among them, 275 of the 300 left queued; the control, `listDay`, wrote 36 and **0 of 10 fresh**.

**The ledger.**
- **Backlog** (no strike):
  - *A same-day second update that Congress.gov indexes late…* (HO 790): a dated note. The shape now needs a lag over 48 hours; leg L; HO 792's twelve as the first reading past the margin; the close stays.
  - *The Sabato daily task's 5:00 PM MT runs…*: a dated note with Oct 27's run and the ruling, **a refused run that logged counts**. Two of the three; Oct 28's comes after this commit, so the strike is owed to the next HO.
  - *Sabato's reader is refused…*: a dated note, Oct 27's refusal after 200s on Oct 22, 23, 24 and 26, and the saved-page fill.
  - *Should a new CRS summary re-summarize?*: the meter over nine ticks, **21 of 484, 4.34%** (8:11 PM MT Oct 27). Still Corey's.
- **Reconcile:** 283 / 358 on 641 at open and at close, mis-struck 0.

**Owed after the FF.** `lib/` changed, so Production serves new code: `verify:deploy`, the served SHA, `e2e-prod` with smoke 143. Then the first wide tick on the new code, the first 00:00Z tick after the deploy: `enqueued` (expected near claim 5's 273), `upserted`, `resets` (no more than the day's real changes), `elapsedMs` against the 240 s budget, `budgetStopped`, `queueAfter`. If it runs out of budget, the queue carries the rest by design and the next tick's row shows it clearing.

**What was flagged.**
- Claim 5 read 273 where the handoff estimated about 340.
- The Sabato reader's note names Oct 23's 200 too; the handoff's text named Oct 22, Oct 24 and Oct 26, and the log has Oct 23 at 5:00:02 PM MT.
- Leg L's instants: run after 00:00Z, it put U2 at 23:00Z the day before (U1 21:00Z), so U1 and U2 share a UTC day and U2 sits an hour or more before the tick.
- **Also notes now run through HO 793.**

**Also (HO 794), a new CRS summary re-summarizes, by Corey's ruling of Oct 28. The bills already holding an AI summary older than their CRS summary are counted, 539, for a reset at the summarizer's pace after the FF. It opens with HO 793's FF go as taken.**
- **What's here:**
  - HO 793's FF go as taken, with its records;
  - the first wide tick on the new code, and the meter's correction;
  - the Sabato task's third logged run;
  - the ruling;
  - STEP 0, a check: every claim held;
  - the rule, and leg E red and green;
  - the catch-up's instrument, its legs and the count;
  - the ledger;
  - what's owed after the FF;
  - what was flagged.
- **Four commits, kinds unmixed:** `fix` (`lib/sync.ts`), `diag` (leg E's case 5 and `scripts/diagnostic/crs-catchup-794.ts`), `docs` (this block and the backlog), then `docs(skill)`, alone and last.
- **Prod was read by `SELECT` only** and nothing was written before the FF. Congress.gov had 34 reads: STEP 0's three (two of the list, one per-bill `/summaries`), the probe's two with `fromDateTime`, and the count's 29 pages, the key in each URL and in no printed line.
- **The pointer is 794:** pointer 793 (`docs/roadmap.md:7915`), highest HO in commit subjects 793, `main` at `21f1d2e`.

**HO 793's FF go, as taken.**
- **`main` at `21f1d2e`:** `67e9575..21f1d2e`, four commits, no force. `793-review` was deleted on the remote and locally, local `main` went forward by `--ff-only`, and `ls-remote` then read `main` alone.
- **The gates before the push:** the cold build, its one junction (`.next\node_modules\@libsql\client-6da938047d5fc1cd`) unlinked first and its target confirmed, exit 0 with 0 warning lines; `npm run typecheck` 0; `check:odds-sites` OK; `check:design-citations` OK.
- **The deploy:** `verify:deploy` first matched at 52 s and held five reads. `/api/version` with a fresh query string read `21f1d2e`, `no-store`, MISS, Age 0. Production record `7375632484` at 8:34:08 PM MT Oct 27 (02:34:08Z Oct 28), at `congressionalterminal-gimzio10w`, a separate deployment from the review Preview (`c2h5929x9`).
- **`e2e-prod` `40621701766`,** fired by the record: smoke **143 passed (5.7m)**, `success` at 8:40:59 PM MT (02:40:59Z). No dispatch, no flush.

**The first wide tick on the new code, #28788** (6:00:10 PM MT Oct 28, 00:00:10Z Oct 29): `wide` and `wideComplete` true, 3 pages, `listedCount` 188, 320 enqueued and written (188 from the frontier listing, 132 added by the wide listing), 0 resets, `crsOnly` 21, 133,232 ms of the 240,000 budget, queue 0 → 0, nothing failed or dropped.
- **The meter's correction.** HO 793's paste read `crsOnly` 21 as the re-reads finding CRS moves and predicted the wide ticks would lift the meter. `upsertBill` computes `crsMoved` only when `update_date` moved (`lib/sync.ts:423-430` at `21f1d2e`), so a re-read counts nothing there and only adds to `upserted`, which since HO 793 dilutes the rate on every wide tick. The meter that holds is `crsOnly` per day.

**The Sabato task's third logged run** (5:00:01 PM MT Oct 28): logged at 5:00:02 PM *refused: status 403, challenge=True, 5,497 bytes, cf-ray `a51d8deccf83fa0d-DEN`*. It ended with `LastTaskResult` `0x2` (read 7:16 PM MT), not the `0x41306` the handoff expected: `0x2` is the script's own exit after a refusal (`docs/handoffs/sabato-daily.ps1:115`), so its popup was dismissed before the two-hour limit. The box was refused two days running.

**The ruling.** At 6:45 PM MT Oct 28, on *"Should a new Congressional Research Service (CRS) summary trigger a fresh AI summary? Today it doesn't, so a bill summarized before CRS published its summary keeps the older AI summary written without it."*, Corey chose **"Yes, re-summarize"**, whose description read *"Treat a new CRS summary like a new action. About 15 extra summaries a day, plus a one-time catch-up the next handoff measures first."* Read as: a write whose `update_date` moved and whose CRS summaries' count changed resets the summary, exactly as a new latest action or a new text version does since HO 790; and the bills whose AI summary predates the CRS summary they now carry are re-summarized once, sized here before any reset.

**STEP 0, a check: every claim held** (`docs/handoffs/794-artifacts/step0-*.log`).
- **1:** `main` `21f1d2e`, pointer 793 at `:7915`, highest HO in subjects 793, the one numbered file above 793 this handoff.
- **2:** `lib/sync.ts`: `SyncStats`' CRS comment `:140-141`, `crsMoved` and `crsOnly` `:142-143`; `UPSERT_SQL`'s reset comment `:337-345`; `UpsertResult` `:372`; the flags `:423-430`, each computed only when `updateMoved`; `substantive` `:431`; the drain's tally `:596-597`.
- **3:** `lib/summarize.ts`: the per-bill `/summaries` fetch at `:152` (the handoff cited `:153`), the latest by `actionDate` `:153-157`, the prompt's CRS line `:219`; `lib/summarize-runner.ts` writes `summary_updated_at` with the summary at `:321` and `:378`. The premise holds.
- **4** (7:16 PM MT Oct 28, 01:16Z Oct 29): `/summaries/119?limit=5&sort=updateDate+asc` answered 200, **`pagination.count` 35**, every item dated Oct 28: without `fromDateTime` the list answers a recent window only. Each item names its bill (`congress`, `type`, `number`, with the bill's `updateDateIncludingText` and `url`) and carries two dated fields with a time, `updateDate` (the record) and `lastSummaryUpdateDate` (the summary). The same sorted desc answered from 20:16:23Z down, after the asc list's last: the sort is honoured. `/bill/119/s/890/summaries` carries `actionDate`, `actionDesc`, `text`, `updateDate` and `versionCode`, its `updateDate` 20:15:34Z equal to the list's `lastSummaryUpdateDate`, not the list's `updateDate` (20:16:23Z): the summary's own instant is `lastSummaryUpdateDate`, and the count reads it. A probe with `fromDateTime=2025-01-01T00:00:00Z` answered `pagination.count` 6,378, so the count reads the list from there.
- **5:** 19,788 bills, every one with a summary; of them 6,221 with `raw_json`'s `summaries.count` at 1 or more; 0 with a summary and `summary_updated_at` NULL. The latest `summary_updated_at`, 2026-10-28T18:10:25.528Z, has the guard's bound's format.
- **6:** the Sabato task: `State` Ready, `LastRunTime` 5:00:01 PM MT Oct 28, `LastTaskResult` `0x2`, `NextRunTime` 5:00 PM MT Oct 29; Oct 28's log line as above. Oct 29's run hadn't happened.
- **7:** backlog `:16`, `:18` and `:46` as cited; reconcile 283 / 358 on 641, mis-struck 0; SKILL step 4 `:1256`, the endpoint list and the scripts list as cited.

**The rule** (`fix` `387862c`, `lib/sync.ts` only): `substantive = byAction || byText || crsMoved`; `crsOnly` counts `crsMoved && !byAction && !byText`, the resets the CRS term alone caused, so the meter is now a count of real resets inside `resets`; `SyncStats`' and `UPSERT_SQL`'s comments say so, the latter naming the three inputs of the prompt besides the title and both rulings. The flags, the stage trio and `changed_at` are untouched; a title, a subject or a cosponsor still keeps the summary.

**Leg E** (`docs/handoffs/794-artifacts/legs-E-base-21f1d2e.log`, `legs-head.log`): case 5, a stored bill with a summary re-listed with a moved instant and its CRS summaries' count up by one, action and text unchanged.
- **Red at `21f1d2e`** (a worktree at the base, the script copied in, `--only E`): case 5 kept its summary, and the tally read `resets` 2, `crsMoved` 1, `crsOnly` 1. Cases 1 to 4 green. The tripwire refused 0.
- **Green at `387862c`,** every leg A to H, L, O and P: **44 checks passed, 0 failed**, the tripwire 0. Case 5 nulled, the tally `resets` 3, `crsOnly` 1; case 1, metadata only, still keeps its summary.

**The catch-up's instrument, `scripts/diagnostic/crs-catchup-794.ts`.**
- **Its legs** (`--legs`, a `file:` copy built by `scripts/migrate.ts`, seeded from HO 790's `seed-1000.json`, a fetch tripwire refusing every request and `.env` never loaded): **12 checks passed, 0 failed**, the tripwire 0. (a) an older summary nulled, all seven columns, and an unstamped one counted apart and nulled; (b) a newer one kept by the guard; (c) a NULL summary untouched; (d) a bill re-summarized after the count kept, and a re-run writing nothing twice; (e) 2,001 without `--go` stopped, 4,001 with it halted, 2,000 without it run, the hole unmoved; (f) 5 at 2 a round: rounds of 2, 2 and 1, a wait between each.
- **The count, `--count --label 794a`** (7:17 PM MT Oct 28, 01:17Z Oct 29; `count-794a.csv`): 29 pages, 7,078 entries read with the overlap's repeats, 6,378 distinct summaries on **6,221 bills**, every item with a bill and a `lastSummaryUpdateDate`. Against `bills`: **539 candidates**, none with `summary_updated_at` NULL. Their CRS dates by month: May 59, Jun 148, Jul 163, Aug 19, Sep 56, Oct 94. The busiest day is Oct 28 with 34, so no bulk touch. The list names no bill `bills` doesn't hold. 539 is under the 2,000 gate, so the reset runs on its own after the FF.

**The ledger.**
- **Backlog:**
  - *Should a new CRS summary re-summarize?* (HO 790) is **struck** on its close: the ruling verbatim with its date, the term in `substantive` (`387862c`), leg E's case 5 red and green, the meter's correction, and the catch-up handed to its own line.
  - **New:** *The CRS catch-up: 539 bills hold an AI summary older than their latest CRS summary* (Code, medium), its close `--count` reading 0 candidates among them after the summarizer drains the hole.
  - *The Sabato daily task's 5:00 PM MT runs…* is **struck**: three logged runs, the ruling that a refused run that logged counts, the settings holding.
  - *Sabato's reader is refused…* gains a dated note: refused Oct 27 and Oct 28, the box's reach maybe gone, the saved-page fill, the Center for Politics email unsent. Still Corey's.
- **Reconcile:** 283 / 358 on 641 at open; **282 / 360 on 642** at close, mis-struck 0.

**Owed after the FF.** `lib/` changed: `verify:deploy`, the served SHA, `e2e-prod` with smoke 143. Then the box's two rules for the new script in HO 790's form (allow on `--reset`, ask on `--reset *--go*`), `npx tsx scripts/diagnostic/crs-catchup-794.ts --reset --count 794a` typed bare, and, once the summarizer has drained the hole, `--count --label 794b`, expected 0 candidates or only bills whose CRS summary arrived after the reset began.

**What was flagged.**
- Claim 3's fetch is at `:152`, not `:153`; the premise holds.
- Claim 4: the list without `fromDateTime` answers 35, a recent window. The count adds `fromDateTime=2025-01-01T00:00:00Z`, a probe's 6,378, and reads `lastSummaryUpdateDate`, the field the per-bill `/summaries` carries as its `updateDate`. STEP 0's first read was sorted asc where the handoff named none, so the desc read separates the two orders.
- The catch-up's legs seed from HO 790's `seed-1000.json`, a `SELECT` of prod read once, rather than a new `SELECT`, so `--legs` never loads `.env`.
- The Sabato task's Oct 28 end state is `0x2`, not `0x41306`: the popup dismissed, the script's own refusal exit.
- The estimate of ~600 read 539.
- **Also notes now run through HO 794.**

**Also (HO 795), election-week readiness. The HO 777 rehearsal was re-run on today's tree: 238 / 9 / 1 as first read, every FAIL a pre-ruling expectation, then 247 / 0 / 1 after Corey's ruled re-match. The Nov 4 runbook is restated at today's lines in `docs/probes/795-election-night-readiness.md`, and the crons it leans on were read for the week. It opens with HO 794's FF go as taken, and the CRS catch-up.**
- **What's here:**
  - HO 794's FF go as taken, and the CRS catch-up;
  - STEP 0, a check: claims 1 to 6 held;
  - the rehearsal: the first run, the HALT, the ruling, the re-match, the second run;
  - the hand reads, as worded and as ruled;
  - the probe file;
  - the ledger;
  - what's owed after the FF;
  - what was flagged.
- **Three commits, kinds unmixed:** `diag` (the rehearsal's re-match and the probe file), `docs` (this block, the backlog and the oddity), then `docs(skill)`, alone and last.
- **Prod was read by `SELECT` only.** No cron was called and nothing was written, and the rehearsal ran on `file:` copies.
- **The pointer is 795:** pointer 794 (`docs/roadmap.md:7981`), highest HO in commit subjects 794, `main` at `dc491c8`.

**HO 794's FF go, as taken.**
- **`main` at `dc491c8`:** `21f1d2e..dc491c8`, four commits, no force. `794-review` was deleted on the remote and locally, local `main` went forward by `--ff-only`, and `ls-remote` then read `main` alone.
- **The gates before the push:**
  - the cold build: its junction unlinked first and its target confirmed, then exit 0 with 0 warning lines;
  - `npm run typecheck`: 0;
  - `check:odds-sites` and `check:design-citations`: OK.
- **The deploy:**
  - `verify:deploy` read `21f1d2e` until 21 s, then `dc491c8` from 31 s on five reads.
  - `/api/version` read `dc491c8` plain and with a fresh query string at 7:31:31 PM MT Oct 28 (01:31:31Z Oct 29): `no-store`, `MISS`, `Age: 0`.
  - Production record `7401660737` at 7:30:48 PM MT Oct 28 (01:30:48Z Oct 29), at `congressionalterminal-dei6trbwd`, a separate deployment from the review Preview (`go4i2iwio`), so no dedup.
- **`e2e-prod` `40800869364`,** fired by the record: smoke **143 passed (6.2m)**, done at 7:37:44 PM MT (01:37:44Z). The first `gh run watch` exited 1 mid-run, so the run was polled to the end. No dispatch, no flush.

**The CRS catch-up** (`scripts/diagnostic/crs-catchup-794.ts`).
- **The box's two rules** (`.claude/settings.local.json`, gitignored):
  - allow `Bash(npx tsx scripts/diagnostic/crs-catchup-794.ts --reset:*)`;
  - ask `Bash(npx tsx scripts/diagnostic/crs-catchup-794.ts --reset *--go*)`.
- **The reset** (`--reset --count 794a`, typed bare) started at 7:32:19 PM MT (01:32:19Z), with all 539 still matching the guard and the hole at 0. It named the host and paused five seconds. Four rounds, at the summarizer's pace:

  | round | at | written | refused | the hole after |
  |---|---|---|---|---|
  | 1 | 7:32:46 PM MT (01:32:46Z) | 150 | 0 | 150 |
  | 2 | 7:41:49 PM MT (01:41:49Z) | 150 | 0 | 150 |
  | 3 | 7:51:51 PM MT (01:51:51Z) | 150 | 0 | 150 |
  | 4 | 8:01:53 PM MT (02:01:53Z) | 89 | 0 | 157 |

  539 written, 0 refused. The 2,000 gate wasn't reached, and no `--go`.
- **The summarizer's ticks:** #28808 (150), #28809 (150), #28811 (82, stopped on its budget), #28812 (139, budget) and #28814 (18). That's 539 summarized, 0 failed, 871,150 prompt and 54,512 output tokens. The hole read 0 at 8:21:17 PM MT.
- **794b** (`--count --label 794b`, 8:21:32 PM MT, 02:21:32Z Oct 29) read the same 6,378 summaries on 6,221 bills, and **0 candidates**.
- **The 539, checked directly:** every one holds a summary, every `summary_updated_at` falls from 7:40:25 to 8:20:29 PM MT, and none failed. The catch-up's backlog line is struck on it.

**STEP 0, a check: claims 1 to 6 held** (`docs/handoffs/795-artifacts/step0-2026-10-29T21-03-31-478Z.log`, read at 3:03:31 PM MT Oct 29, 21:03:31Z).
- **1:** `main` `dc491c8`, pointer 794 at `:7981`, highest HO in subjects 794; this handoff is the one numbered file above 794.
- **2:** the rehearsal script as cited, except three header ranges one line off: copies `:12-16`, shapes `:17-26`, safety `:28-32`, against `:12-17`, `:18-27`, `:29-33`. `lib/clock.ts:11-13` and `daysToElection` `lib/format.ts:142` as cited.
- **3:** the routes, the tick's bounds, `RunResult` and `vercel.json`'s schedules as cited. `kalshi` is `15 */2 * * *` (`:116-117`).
- **4, the ballot cron's week:**
  - **84 rows, all `success`.**
  - **82 ticks read alike:** 40 of 40 READ, stop `cap`, 40 requests, `minGapMs` 6000, 0 runoff boxes, 234,251 to 241,658 ms.
  - **Two stopped on an UNREAD,** both timeouts on Oct 23: #27325, `MA-03-2026` after 25 READ; #27490, `VT-AL-2026`, its first race.
  - **The sums:** 3,307 attempted, 3,305 READ.
  - **The HALT tests:** no cause names a challenge, a WAF or a 202, and no tick in 48 hours read UNREAD more than 5.
  - **The races:** all 470 were read within 24 hours (the oldest attempt 4:21:36 PM MT Oct 28), every last attempt a READ (463 `box`, 7 `no_box`). **0 marked**, and `general_runoff` has 0 rows.
- **5, the other crons' week:**
  - primaries: 14 of 14 `success`; the last `?state=` row is still HO 778's #24524.
  - race-challengers: 7 of 7. #28924 wrote 909 rows in 465 races, jungle 0 decided.
  - kalshi: 24 of 24 in 48 hours. `kalshi_odds` (469 rows) and `polymarket_odds` (34) were written at 2:15:37 PM MT.
  - sync-race-ratings: 7 of 7 `error`, Sabato's challenge, as expected.
  - `/api/sync`: 28 of 28 `success`; the wide ticks enqueued 182, 40, 36 and 320.
- **6, the box:**
  - `.env` carries `CRON_SECRET`, checked by name.
  - `gradshow-numbers-787.ts` with no mode prints its usage (`:1035`) and exits 2.
  - The Sabato task is Ready; it last ran Oct 28 with `0x2`, and Oct 29's run is at 5:00 PM MT.
- **7, re-derived:** backlog `:15`, `:17`, `:47` and `:76`; reconcile 282 / 360 on 642. The WATCH line carries no `lib/general-ballot.ts:785`: that cite is HO 777's block's (`docs/roadmap.md:6018`), and the pacer is at `lib/general-ballot.ts:946` now.

**The rehearsal, re-run** (`scripts/diagnostic/election-night-rehearsal-777.ts`, Node v24.22.2).
- **The seed** (`--seed --label 795`, 3:09:39 to 3:10:35 PM MT):
  - 22 whole tables, with `bills` and `member_votes` cut to the 107 members and the newest 400 `cron_runs`.
  - Prod's fingerprint was equal before and after.
  - HO 777's 17 marks and Louisiana's three jungle winners were planted.
  - STALE: only S-ME's curated name, as at HO 777.
- **The build:** cold, the junction unlinked first: exit 0, 0 warning lines, `JVYNrudYscPa3pSDUsrXb`.
- **The first run** (`--run --label 795`, 3:12:36 to 3:14:15 PM MT) read **233 PASS, 9 FAIL, 1 N/A**, so **238 / 9 / 1** with the seed's 5. Each FAIL was an expectation HO 777 wrote on Oct 11, before the ruling that changed its page:
  - **Seven, HO 779** (`c4d116b`, Oct 12, `components/RaceHubBody.tsx:180-188`): *the card's word reads not on the ballot* on IA-02, S-NH, S-IA, FL-25, GA-13, AL-01 and S-AL. Each card shows the tag the ruling keeps instead: LOST THE SENATE RACE, RETIRING, RETIRING, RUNNING IN FL-20, LOST PRIMARY, ELECTED TO THE SENATE and RAN FOR GOVERNOR.
  - **Two, HO 783** (`a86a287`, Oct 13, `lib/race-result.ts:177-180`): S-GA's header *Runoff* and card word *runoff*. The page reads *Runoff Dec 1* and *runoff Dec 1*, which HO 783's own leg read as its green.
- **The HALT** went to chat with each check's line, the copy and the capture (`docs/handoffs/795-artifacts/halt-795.md`).
- **Corey's ruling:**
  - all thirteen are instrument FAILs: the nine, and the four hand reads below;
  - no surface FAILed, so no fix HO;
  - option 2: re-match the script to the rulings in this HO's `diag` commit, each new expected string taken from the ruling's code or block and citing it, nothing read off the page; then re-run on the same seed and copies.
- **The re-match:**
  - The seven shapes expect the tag with no word: a `tag` expectation, its key and words, and the card's check reads the tag where the ruling keeps one.
  - S-GA expects *Runoff Dec 1*, matched at the header's end like a bare *Runoff*, and *runoff dec 1*.
  - Each shape's check count is unchanged.
  - The tags were derived from the seed's data and the rulings' order and words (`docs/handoffs/795-artifacts/rematch-derivation-795.log`). **The tautology guard:** a second derivation was barred from the runs' logs and captures and from the first derivation. From the rulings' code and blocks and the night copy's data alone, it reached the same seven tags and S-GA's two strings, and it found each cite in the diff pointing at what it claims.
  - **The check logic, reviewed:** sound. The scope is the eight shapes, the type, the header comment and the two checks, and each shape's check count is unchanged. Four of the seven tags (RETIRING twice, LOST PRIMARY, RUNNING IN FL-20) read the same before and after election day, so the run's clock rests on IA-02's, AL-01's and S-AL's (`docs/handoffs/795-artifacts/rematch-guard-795.json`).
- **The second run** (`--run --label 795b`, 3:46:12 to 3:47:48 PM MT, on the same copies byte for byte) read **242 PASS, 0 FAIL, 1 N/A**, so **247 / 0 / 1**.
  - The other 233 checks read as in the first run.
  - The N/A is AL-01's R HOLD, as at HO 777.
- **Readings, not FAILs:**
  - **The band at the real clock:** *ELECTION DAY · NOV 3 · 5 DAYS · ~58 competitive seats*.
  - **The band at the Nov 4 clock:** *RESULTS · NOV 3 · 61 of 105 competitive seats called · House R 43 · D 44 · other 1 · 347 open*, equal to its `SELECT`.
  - **The 105 rated seats** against HO 777's 99 are Sabato's moves since HO 777's seed: eight added (six of them dated Oct 20) and two dropped.

**The hand reads, as worded and as ruled** (the `night` copy, 3:16:42 to 3:17:18 PM MT):
- **HO 780, LA-01:** FAIL as worded (*two Advanced*), PASS as ruled. It reads *Runoff Dec 12*, Jewett *Advanced* and Scalise's card *runoff Dec 12*, which is HO 780's recorded LA-01 (`docs/roadmap.md:6365`).
- **HO 780, LA-02:** PASS: *Decided · Nov 3, 2026*, with *Elected* on Renada Collins's row.
- **HO 783, S-GA:** PASS: *Runoff Dec 1*, the card *runoff Dec 1*, and `/electoral`'s row RUNOFF.
- **HO 784:** PASS: the sources line gives each rater's AS OF on MI-04's page and on `/electoral`.
- **HO 789:** PASS: *Sabato · as of 2026-10-20 · direct* on both tabs, equal to the unmarked copy's line.
- **HO 779, AL-01, S-AL and GA-13:** FAIL three times as worded (*HO 758's word where the tag was*), PASS as ruled: ELECTED TO THE SENATE, RAN FOR GOVERNOR and LOST PRIMARY.

**The probe file,** `docs/probes/795-election-night-readiness.md` (`diag`):
- the Nov 4 runbook in the WATCH line's order, (a), (c), (b), then the reads, every mechanism at today's line;
- the clock: MST from Nov 1, 15:00Z, the windows, and the pages turning at 00:00Z Nov 4, 5:00 PM MST Nov 3;
- the preconditions;
- each read's expectation, as ruled;
- what each step reads if nothing happened;
- the rehearsal and its captures' index.

The Nov 4 handoff is written from it on Nov 3.

**The ledger.**
- **Backlog:**
  - *The CRS catch-up: 539 bills…* (HO 794) is **struck** on 794b's reading and the direct check of the 539.
  - *WATCH (HO 758) · the first Nov-4 read* gains a dated note: the readiness re-read, the rehearsal's counts and its re-match, the ballot cron's week, the lock and the state route at today's lines, the clock, and the probe file as the runbook. The WATCH stays dated Nov 4.
  - *Sabato's reader is refused…* (Corey's): nothing appended. Oct 29's run is at 5:00 PM MT, after this commit, and the handoff appends it only if read.
  - No FAIL line, since none survives the ruling.
- **Oddities:** one entry. A rehearsal's expectations are the rulings' text, and a re-run after a ruling re-matches them before it reads; the re-match reads the ruling, never the page.
- **Reconcile:** 282 / 360 on 642 at open; **281 / 361 on 642** at close, mis-struck 0.

**Owed after the FF.**
- Docs and a diagnostic only, so Production's code doesn't change: read the served SHA once, `e2e-prod` if the record fires one, and no flush.
- The `docs(skill)` commit means the chat rebuilds `cbt.zip`, held and not uploaded.
- The Nov 4 handoff is written from the probe file on the evening of Tuesday Nov 3, and run Wednesday Nov 4 after 8:00 AM MST.
- Corey's three odds snapshots (Mon Nov 2 9:30 PM, Tue Nov 3 7:30 AM and 3:30 PM, MST) are his, by the 787 script.

**What was flagged.**
- **Ratified:** claim 2's three header ranges one line off; claim 7's `:785` cite as HO 777's block's.
- **The rehearsal's first read:** the handoff expected 247 / 0 / 1 from HO 777's expectations, and the tree read 238 / 9 / 1, every FAIL pre-ruling. Ruled instrument, and re-matched.
- **The handoff's § 1.2 wording** for LA-01 and for HO 779 was HO 777's block's. Ruled.
- **Node:** the rehearsal ran on v24.22.2 (`node@24` in the session scratchpad), as HO 777's ran on 24.21.0. Ratified.
- **The artifacts:**
  - The script writes to `docs/handoffs/777-artifacts/` (its `ART`), so HO 777's r1 captures were set aside for each run and restored, and the runs' captures and labelled files sit under `795-artifacts`. Ratified.
  - `795b` reads the 795 seed under its own label, so the copies, sentinels and plant record were given `795b` names, byte for byte (sha256 equal).
- **The ruling's *105 against 99 (Sabato's Oct 20 ratings)*, measured:** eight seats added and two dropped, all Sabato's, six of the eight dated Oct 20.
- **The derivation's first pass** read GA-13's NULL curated flag as 0, so RETIRING. The rule is `= 0` (`lib/incumbent-qualifier.ts:34`), and the corrected pass reads LOST PRIMARY.
- **The pages turn at 00:00Z Nov 4, 5:00 PM MST Nov 3,** by the UTC-date gate (`lib/format.ts:142-148`). Until Ballotpedia marks, every race page reads *Not yet called* and the band reads RESULTS with 0 called. A reading, not a FAIL.
- **After `795b`, one comment changed:** S-GA's cite gains `:276` and `:280`, the header's and the word's own lines, on the review's note. The committed script differs from the run's blob (`f606d0e`) by that comment alone.
- **Also notes now run through HO 795.**

**Also (HO 796), the account surfaces hidden behind one constant: no sign-in on either masthead or the landing, no watch star, no WATCHLIST item, and `/watchlist` a 404, while the routes, the API and the tables stay. `ACCOUNT_UI` in `lib/account-ui.ts` is `false`, and flipping it brings the arc back. It opens with HO 795's FF go as taken.**
- **What's here:**
  - HO 795's FF go as taken;
  - three reads: the Sabato task, Nov 1 on the box, the odds task;
  - the ruling;
  - STEP 0, a check: claims 1 to 5 held;
  - the change, the crawl list, and two forced consequences, each measured red then green;
  - § 3's reading, the captures and the layout reads;
  - the builds, base and change;
  - the review;
  - the ledger;
  - what's owed after the FF;
  - what was flagged.
- **Four commits, kinds unmixed:** `feat` (the ten files of § 1), `test` (the crawl list and fit-finish's `/watchlist` test), `docs` (this block and the backlog), then `docs(skill)`, alone and last.
- **Prod was read by `SELECT` only,** through the app's own reads on a local production server, and once over HTTP for claim 7. No cron was called and nothing was written.
- **The pointer is 796:** pointer 795 (`docs/roadmap.md:8124`), highest HO in commit subjects 795, `main` at `eba6c0d`.

**HO 795's FF go, as taken** (`docs/handoffs/795-artifacts/ff-mechanics.txt`).
- **`main` at `eba6c0d`:** `dc491c8..eba6c0d`, three commits (`dcbb495` diag, `0cbd331` docs, `eba6c0d` docs(skill)), no force. `795-review` was deleted on the remote and locally, local `main` went forward by `--ff-only`, and `ls-remote` then read `main` alone.
- **The gates before the push:**
  - the cold build on Node v24.22.2: its junction unlinked first and its target confirmed, then exit 0 with 0 warning lines;
  - `npm run typecheck`: 0;
  - `check:odds-sites` and `check:design-citations`: OK.
- **The push** ran between 8:07:00 and 8:07:25 PM MT Oct 29 (02:07:00Z to 02:07:25Z Oct 30). The chain (the push, the ref's deletion, local `main`'s fast-forward) ended at 8:07:25 PM MT.
- **The deploy:**
  - Production record `7428903110` at 8:08:03 PM MT (02:08:03Z Oct 30), `success` a second later, at `congressionalterminal-6btpzbmzz`. It's a separate deployment from the review Preview (`ko3pvc5t0`), so no dedup.
  - `/api/version` read `eba6c0d` once at 8:08:56 PM MT (02:08:56Z).
- **`e2e-prod` `40989898929`,** fired by the record: smoke **143 passed (5.8m)**, and every one of the 82 narrow cells read `over=0`. No dispatch, no flush.

**Read 1, the Sabato task** (`docs/handoffs/sabato-daily.log`, read again at 12:28 PM MST Nov 1, 19:28Z).
- **Oct 29** (5:00:02 PM MT, 23:00:02Z): refused, 403, the challenge, 5,603 bytes, cf-ray `a525cb4d4c8c4de3-MCI`. The task ended `0x41306` (its two-hour limit), as read at HO 795's FF.
- **Oct 30 and Oct 31** (5:00:02 PM MT, 23:00:02Z each): refused, 403, the challenge, 5,603 bytes, cf-rays `a52e08aff93be75b-DEN` and `a536460a5ed07c34-DEN`. Each kept the challenge page, with no retry. Their end states weren't read; the read was the log.

**Read 2, Nov 1 on the box.**
- The honest agent's `curl.exe` read (`docs/handoffs/sabato-daily.ps1:80`, `CBT-ratings-sync/1.0`), run by hand with the VPN off at 11:22:57 AM MST (18:22:57Z): 403, `challenge=True`, 5,497 bytes, cf-ray `a53ced8a3e5779a2-DEN`.
- The log holds a second hand read at 11:33:41 AM MST (18:33:41Z) with the same answer, cf-ray `a53cfd454fbdfd76-DEN`.
- The day's files are named by the date, so `sabato-rating-changes-2026-11-01.challenge.html` (5,497 bytes) and its headers are the second read's (`Date: Sun, 01 Nov 2026 18:33:41 GMT`).
- So the score is on the request, not the network.

**Read 3, the odds task.**
- `CBT odds snapshots` was registered Nov 1 as Corey. It has three ONCE triggers: 9:30 PM MST Nov 2, then 7:30 AM and 3:30 PM MST Nov 3 (04:30Z, 14:30Z and 22:30Z). `StartWhenAvailable`, `WakeToRun`, `PT30M`.
- It was tested at 10:51:32 AM and 11:03:36 AM MST, both `0`.
- The log is UTF-8 after the first test (`docs/handoffs/odds-snapshots.log`). The first test's UTF-16 log is kept as `odds-snapshots-utf16-2026-11-01-1052.log`.
- The two Nov 1 files, `docs/probes/odds-snapshots/2026-11-01-1052-MT.json` and `…-1103-MT.json` (193,122 bytes each), are tests, not snapshots, and stay untracked.

**The ruling** (Corey, Nov 1): *"i want to hide the login box and watch list. just to keep it super basic. i dont want them to think im tryting to hack them.. we are seeing a lot of that lately."*
- The site's link goes in the Center for Politics allowlist email and on the GradShow poster.
- Logged-out has always been the demo (SKILL `:17`), so hiding the account surfaces loses no reader anything.
- Whether they return or go for good is Corey's, after GradShow (backlog, new).

**STEP 0, a check: claims 1 to 5 held** (read at `eba6c0d` before any edit).
- **1:** `main` `eba6c0d`, locally and on the remote (`ls-remote` read `main` alone); pointer 795 at `:8124`; highest HO in subjects 795. This handoff is the one numbered file above 795.
- **2 to 5:** every anchor as cited, in `HeaderBar.tsx`, `DashboardV2Header.tsx`, `BillRow.tsx` (the only renderer of `.feed-row`), `app/bill/[id]/page.tsx`, `app/welcome/page.tsx`, `LandingCTAs.tsx`, `app/watchlist/page.tsx`, `app/globals.css` and `OddsToggle.tsx:4`.
- **6, re-derived:**
  - `e2e/routes.ts:85` carries `/watchlist`.
  - fit-finish `:1024-1031` expects 200.
  - `e2e-prod.yml:246` runs smoke, odds-off and narrow, not fit-finish.
  - **`ROUTES` holds 39, not 35:** 33 literal entries plus the six `?stage=` variants spread from `STAGES`, counted by importing the module. So § 2 leaves 38, not 34.
- **7, prod's served HTML,** read once at 11:58:51 AM MST (18:58:51Z) with curl 8.17.0 (Git for Windows' build) and no agent flag, with `/api/version` at `eba6c0d`:
  - `/welcome`: 200, 316,093 bytes, `>LOGIN<` once.
  - `/bills`: 200, 166,482 bytes, `row-star` 25 times, `pnav-mine` twice, `href="/watchlist"` once.
  - That's the before.
- **8:** SKILL `:17`, `:28`, `:2003`, `:2006`, `:2070`, `:2236` and `:2887`, and backlog `:47`, all as cited. Reconcile 281 / 361 on 642, mis-struck 0.

**The change** (`feat`, the ten files).
- **`lib/account-ui.ts`,** new: `ACCOUNT_UI = false`, under the handoff's header.
- **`components/HeaderBar.tsx`:**
  - The eleven entries stay in the source array, now `ALL_NAV_ITEMS`, its HO 608 comment intact. `NAV_ITEMS` is that array filtered, so `MobileNavDrawer` and both `PrimaryNav` variants follow with no change of their own.
  - The divider renders before the item keyed `"feed"`, so DASHBOARD | LEGISLATION… holds in both states. One line after the HO 608 paragraph in `PrimaryNav`'s comment says so. `pnav-mine` stays keyed on `"watchlist"`.
  - The session read is `ACCOUNT_UI ? await auth() : null`, recorded in the HO 355 comment.
  - The `·` + `AuthButton` pair renders only while `ACCOUNT_UI`.
- **`components/DashboardV2Header.tsx`:** the same two gates, its HO 355 comment recording the read's. ODDS follows LAST SYNC, and the HO 692 comment over it says so.
- **`components/OddsToggle.tsx:4`:** *after LOGIN*, and while `ACCOUNT_UI` is false, after LAST SYNC on the dashboard and after IN BETA on inner pages.
- **`components/BillRow.tsx`:** the `.row-star` span renders only while `ACCOUNT_UI`, and when it doesn't, the row carries `feed-row--nostar`. The `onWatchlist` prop stays. The HO 613 comment gains the handoff's line.
- **`app/globals.css`:** the handoff's four rules after the momentum rule, under one HO 796 comment, and two more in the `max-width: 700px` block (below).
- **`app/bill/[id]/page.tsx`:** `isInWatchlist` runs only while `ACCOUNT_UI` (`Promise.resolve(false)` otherwise), and `WatchlistToggle` mounts only then.
- **`components/LandingCTAs.tsx`:** a `showLogin` prop, and LOGIN renders only when it's true, recorded in the header comment's LOGIN entry.
- **`app/welcome/page.tsx`:** passes `ACCOUNT_UI` as `showLogin` and renders `micro2` only while it's true; `micro1` stays.
- **`app/watchlist/page.tsx`:** `notFound()` first while `ACCOUNT_UI` is false, before any read.
- Nothing in the handoff's untouched list changed, and no component was removed.

**The first forced consequence: the phone-width block.**
- `app/globals.css`'s `max-width: 700px` block re-declares the row grid: `26px 1fr` for the base and both days-since variants, `22px 1fr` compact. It also hides `.row-days-since` and `.row-momentum`.
- The handoff's two nostar days-since rules outrank those by a class, so alone they'd keep their 90px column there with nothing in it.
- Two rules in the block set `1fr` for both. They tie those two on specificity and win by order.
- **Measured, red and green** (`/stale`'s first row at 390):
  - as served: one 356px track, 0px empty;
  - with only those two rules deleted through CSSOM: `266px 0px 90px`, and 90px empty on the right of every row.

**The crawl list** (`test`).
- `e2e/routes.ts`: the `/watchlist` entry is commented out in place under the handoff's line. `ROUTES` reads 38.
- `e2e/fit-finish.spec.ts`: the test keeps its name and its collectors, and its status expectation is 404 under the same line.

**The second forced consequence: fit-finish's collectors.**
- **Run as the handoff wrote it, against the local server, the test failed.** The status read 404, but `assertClean` failed twice on the document's own 404:
  - `bad` held `404 http://localhost:3000/watchlist`;
  - the console held Chromium's *Failed to load resource: the server responded with a status of 404 (Not Found)*.
- The collectors now expect exactly those two: `c.bad` the one URL, `c.consoleErr` one line matching `status of 404`, `c.pageErr` empty. `assertClean` is commented out in place, to return with the surface.
- Run again: **1 passed** (3.5 s). `typecheck:e2e` passed both versions; it can see neither.

**§ 3's reading.**
- **The server:** `next start` at `:3000` on Node v24.22.2, the box's `.env`, the change's cold build.
  - Bind check: one listener, pid 38672, the scratchpad's v24.22.2 `node.exe`.
  - The served stylesheet (184,444 bytes) carries all six `feed-row--nostar` selectors.
- **The handoff's grep,** read at 12:18:39 PM MST (19:18:39Z) with `ct_seen`:

  | route | status | grep -c |
  |---|---|---|
  | `/welcome` | 200 | 0 |
  | `/` | 200 | 0 |
  | `/bills` | 200 | 0 |
  | `/stale` | 200 | 0 |
  | `/changes` | 200 | 0 |
  | `/patterns` | 200 | 1 |
  | `/search?q=tax` | 200 | 1 |
  | `/bill/119-s-2` | 200 | 0 |
  | `/committee/hlig00` | 200 | 1 |
  | `/members/A000055` | 200 | 0 |
  | `/electoral` | 200 | 0 |
  | `/race/AL-01-2026` | 200 | 0 |

- **The three 1s are one string,** `"onWatchlist":false`: BillRow's prop key in the RSC flight data, where a server page renders the rows directly. It appears 10 times on `/patterns`, 50 on `/search?q=tax` and 3 on `/committee/hlig00`, and nothing else matched. It's the plumbing the handoff keeps, not a sign-in surface.
- **`/watchlist` read 404** (7,964 bytes).
- **Controls, so a dead page can't read 0:** `pnav-item` 20 on each HeaderBar route (ten items, markup and flight), `IN BETA` twice everywhere, `ENTER TERMINAL` once on `/welcome`. The first pass read 0 bytes on every route because `MSYS_NO_PATHCONV` broke `curl.exe`'s output path, and the controls caught it.
- **The captures,** 1440, with `ct_seen` and reduced motion: `796-artifacts/welcome.png`, `home.png` and `bills.png`, plus `stale-390.png`.
- **The layout reads** (`796-artifacts/layout-reads.json`):
  - ten nav items, the divider before LEGISLATION, on `/` and `/bills`;
  - the title bar `· IN BETA · ODDS ON`; the dashboard's meta row `IN BETA`, `LAST SYNC …`, `ODDS ON`;
  - every row on `/bills`, `/stale`, `/changes`, `/search`, `/committee/hlig00` and `/patterns` is nostar, its first child at the row's left edge;
  - `/stale` at 1440: `1262px 54px 90px`; at 390, one track on every feed route, and doc overflow 0;
  - no WATCH on the bill hero, and 0 console errors at either width.
- **`/welcome`'s `.ctagrid` second column computes to 143.688px, not nothing.** The stats strip spans both columns and feeds it. Nothing sits in it, ENTER TERMINAL keeps the stats' left edge, and no CSS changed.
- **The server's log:** 29 `[auth][error] MissingSecret`. They come from the `auth()` calls the change keeps (the watchlist helpers and `/`'s gate), on a box `.env` with no `AUTH_SECRET`, checked by name. Production carries it.

**The builds, base and change.**
- **A secretless worktree at `eba6c0d`** (Node v24.22.2, `cp -al` node_modules), built at the base and then with the change: both exit 0 with 0 warning lines.
- **Their route tables differ on one row:** `/watchlist` ƒ → ○, prerendered as the 404. `/bill/[id]`, `/vote/[id]` and every other route keep their type, so dropping the headers' `auth()` made nothing static.
- **The checkout's cold build** (its junction unlinked first, the target 24 files before and after): exit 0, 0 warning lines. Then `npm run typecheck` 0, and `check:odds-sites` and `check:design-citations` OK.

**The review** (workflow `wf_795f9f98-161`, nine agents): five readers over the diff (completeness, layout, runtime, tests, fidelity), and a skeptic for each reader that found something.
- **Completeness:** no route renders a sign-in, LOGIN, a star, the WATCH toggle, WATCHLIST (inline or in the drawer), the *Want your own watchlist?* line or a `/watchlist` link. The one sign-in-on-401 path (`use-watch-toggle`) is reachable only through the two gated components.
- **Layout:** no defect, the phone-width rules included.
- **Confirmed, and fixed:**
  - fit-finish's test as the handoff wrote it can't pass (four readers; fixed above);
  - SKILL `:2867`, the `ROUTES` count's canonical home, read *prints 39* and 78 document requests a run. It now reads 38 and 76;
  - `PrimaryNav`'s comment still read *divider before index 2*, so the HO 796 line moved there from the HO 608 comment over the list;
  - `DashboardV2Header`'s HO 692 comment said ODDS follows LOGIN. It now names LAST SYNC while `ACCOUNT_UI` is false.
- **Refuted:**
  - that the crawl doesn't read `ACCOUNT_UI`: that's the handoff's design, and the restoration is written at both sites and in the backlog;
  - that the phone-width rules are a defect: they're needed and named, and the four prescribed rules are present verbatim.
- **Uncertain:** that `OddsToggle.tsx:4`'s departure goes unnamed. It's named below.
- **After the fixes, a last cold build** (12:32:04 to 12:32:37 PM MST, 19:32Z): exit 0, 0 warning lines, `/watchlist` ○. Then `npm run typecheck` 0, and both checks OK.

**The ledger.**
- **Backlog:**
  - New, OPEN LOOPS: *The account surfaces are hidden (HO 796)…*, Corey's, after GradShow (Nov 18). It names the flip's two restorations and carries a close.
  - *Sabato's reader is refused…* (Corey's) gains a dated note: refused at every scheduled run since Oct 27, and twice by hand Nov 1 from the DEN edge. The allowlist email is Corey's to send once this HO is served.
- **Oddities:** none.
- **Reconcile:** 281 / 361 on 642 at open; **282 / 361 on 643** at close, mis-struck 0.

**Owed after the FF.**
- `components/` and `app/` changed, so Production serves new code:
  - the served SHA;
  - `e2e-prod` with the crawl one route shorter (smoke and narrow each lose `/watchlist`'s tests; the counts from the run);
  - then § 3's grep against prod's `/welcome` and `/bills`, expected 0 and 0. That reading goes to chat, and the allowlist email goes out on it.
- The `docs(skill)` commit means the chat rebuilds `cbt.zip`.
- Corey's three odds snapshots run by the task: 9:30 PM MST Nov 2, and 7:30 AM and 3:30 PM MST Nov 3.

**What was flagged.**
- **Claim 6:** `ROUTES` is 39, not 35, so 38 after § 2, not 34. The handoff's 35 counts `{ slug:` lines over the whole file: it takes in the two `FIXTURE_ROUTES` and misses the spread. SKILL `:2887` says 38 and points at the evaluated count.
- **SKILL `:2867`, not in the handoff's list,** is that count's canonical home, and this change made it false (*prints 39*, 78 requests a run). It reads 38 and 76, with the old figures kept beside them.
- **The two forced consequences,** the phone-width rules and fit-finish's collectors, each measured red then green.
- **The `.ctagrid`'s second column** computes to 143.688px, fed by the spanning stats strip, not nothing. No visible effect, and no CSS change.
- **`OddsToggle.tsx:4`:** the handoff's *after IN BETA while `ACCOUNT_UI` is false* holds on inner pages only. On the dashboard ODDS follows LAST SYNC, so the comment names both.
- **`NAV_ITEMS`:** the full list is `ALL_NAV_ITEMS` and the export filters it, since a literal can't be filtered in place and keep its `NavItem` typing. SKILL `:2236` names both.
- **The HO 608 line:** it sits after the HO 608 paragraph in `PrimaryNav`'s comment, where *divider before index 2* is written, not in the `HO 608 —` comment over the list. It's one sentence on two lines.
- **`DashboardV2Header`'s HO 355 and HO 692 comments** record the gate and the new neighbour, as `HeaderBar`'s and `OddsToggle`'s do.
- **The backlog line** names the flip's two restorations and carries a close, which the handoff's text didn't.
- **Read 2:** the log holds two hand reads on Nov 1, and the kept page is the second's.
- **Claim 7's curl** is Git for Windows' 8.17.0, with no `-A`.
- **HO 795's push time:** 8:07:25 PM MT is when the chain ended; the push ran between 8:07:00 and 8:07:25.
- **SKILL lines left as they are:** `:2024`, `:2226`, `:2280`, `:2396` and `:2422` describe the star and the toggle as components, and the components stay. `:2221`'s `1fr 40px 36px` has been stale since HO 613, not since this HO.
- **Also notes now run through HO 796.**

**Also (HO 797), the dashboard feed's tabs read NEW THIS WEEK / MOVERS / TOP STALLS and open on NEW THIS WEEK, or on MOVERS when a page carries `?stage=` or `?topics=` or NEW's count is 0. The chamber selector is its own row under the strip, in the `/hearings` filter idiom. It opens with HO 796's FF go as taken.**
- **What's here:**
  - HO 796's FF go as taken;
  - the rulings and the mock;
  - the architect's call on MOVERS;
  - STEP 0, a check: claims 1 to 4 held, 5 and 6 re-derived;
  - the change;
  - the test, red at the base;
  - § 3's readings, the captures and a finding;
  - the review;
  - the Nov 3 go (`docs/handoffs/797-push-go.md`, 11:10 AM MST Nov 3, 18:10Z): the mock tracked and read, the comment reworded, the row's offset set from the mock's reading;
  - the ledger;
  - what's owed after the FF;
  - what was flagged.
- **Four commits, kinds unmixed:** `feat` (`ActivityTabs.tsx`, `page.tsx`, `globals.css`), `test` (one smoke test), `docs` (this block, the backlog and the mock), then `docs(skill)`, alone and last. The ref was first made on Nov 1 and remade on Nov 3 for the go's changes (flagged below).
- **Prod was only read,** by what this session ran: the app's own reads on a local production server, and `gh` for HO 796's records. No cron was called and nothing was written.
- **The pointer is 797:** pointer 796 (`docs/roadmap.md:8308`), highest HO in commit subjects 796, `main` at `e19d7e3`.

**HO 796's FF go, as taken** (`docs/handoffs/796-artifacts/ff-mechanics.txt`; the Production record, its status, and the `e2e-prod` run and its log re-read through `gh` in this session).
- **`main` at `e19d7e3`:** `eba6c0d..e19d7e3`, four commits (`fc2a62f` feat, `f2cdc7f` test, `0c57bf1` docs, `e19d7e3` docs(skill)), no force. `796-review` was deleted on the remote and locally, local `main` went forward by `--ff-only`, and `ls-remote` then read `main` alone.
- **The gates before the push:**
  - the cold build on Node v24.22.2: its junction unlinked first and its target confirmed (24 files before and after), then exit 0 with 0 warning lines;
  - `npm run typecheck`: 0;
  - `check:odds-sites` and `check:design-citations`: OK.
- **The push** was done by 12:52:11 PM MST (19:52:11Z).
- **The deploy:**
  - Production record `7478194013` (`vercel[bot]`), created and `success` at 12:52:51 PM MST (19:52:51Z), at `congressionalterminal-fxyhdtm5f`. The review's Preview of the same SHA (record `7478080798`, `pd9s5z5dm`) is a separate deployment, so no dedup.
  - `verify:deploy` read `e19d7e3` from 21 s and five in a row by 62 s. `/api/version` read `e19d7e3` once at 12:53:55 PM MST (19:53:55Z).
- **`e2e-prod` `41343968945`,** fired by the record, 12:52:53 to 12:59:17 PM MST (19:52:53Z to 19:59:17Z), `success`: smoke **140 passed (5.5m)**, one route shorter than HO 795's 143; 76 documents over 38 routes, every one 200; every one of the 80 narrow cells `over=0`. No dispatch, no flush.
- **Prod's three reads** at 12:54:32 PM MST (19:54:32Z), served `e19d7e3`, with `ct_seen`: `/welcome` and `/bills` 0 and 0 on the handoff's grep, `/watchlist` 404.
- **The Center for Politics message** went from the CSU address at 2:01 PM MST Nov 1 (21:01Z), as the handoff records it.

**The rulings** (Corey, Nov 1), verbatim.
- His request, before the mock: *"lets move the tabs to be: New this week , Movers , last is top stalls. move all,house,senate button to below the tabs?"*
- His ruling, off `docs/design/mock-797-feed-tabs.html`: *"chamber = C, open on =new"*.
- **The reading: C and New.** The selector is option C, `CHAMBER [ALL] HOUSE SENATE` at 11px with the active option bracketed, and the feed opens on NEW THIS WEEK.
- **The mock** was absent from disk at this block's first writing: swept by name in `~/Downloads`, `docs/design/` and the repo from 2:29 PM MST Nov 1 (21:29Z), last at 3:20:42 PM MST (22:20:42Z), and once more at 8:47:45 PM MST Nov 1 (03:47:45Z Nov 2) on the first go, which HALTed on it. The chat wrote it onto this box at 11:00 AM MST Nov 3 (18:00Z; the file's mtime 11:00:54 AM, 18:00:54Z) as `docs/design/mock-797-feed-tabs.html`, and this commit carries it unedited: 81,497 bytes, LF line endings, sha256 read off the disk at 11:34:46 AM MST (18:34:46Z) `bbfb2e3d9f587be68731e83aed004aa6485e7c2707d5e9b1f39d8fed6681d220`, the handoff's. It loads on option A at 887 wide and opens on New, as the handoff says, the ruling being what Corey selected in it.
- **The mock, read** (`797-artifacts/mock-797-measure.mjs` → `nov3/mock-797-reads.json`, 11:39:02 to 11:39:05 AM MST Nov 3, 18:39:02Z to 18:39:05Z: the file opened in Playwright, option C selected, at the mock's two panel widths, 887 and 390, on each of its three tabs). Its `.tabs` take `margin-bottom: var(--space-sm)` with `--space-sm: 8px`; its `.row-filter` takes `margin: -2px 0 var(--space-sm)` and `padding: 0 0 2px` at `normal` line height, its options and label 11px (`--fs-11`), `[ALL]` in `rgb(251, 191, 36)` with the brackets in `rgb(217, 119, 6)`. So **the row sits 6 px under the strip's rule, is 16 px tall, and sits 8 px above the list**; the list is 30 under the strip (8 with the strip alone, the mock's *now* layout) and 73 from the panel's top at 887 (51 with the strip alone: the handoff's 51 → 73). The same 6 / 16 / 8 / 30 / 73 at 390, where its strip wraps to 69 px tall.

**The architect's call on MOVERS,** which the mock didn't show.
- NEW THIS WEEK and TOP STALLS don't take `filters` (`app/page.tsx:266-267` at `e19d7e3`); only MOVERS does (`:260-264`). With NEW open, a funnel or topic click would rebase nothing in the feed, and HO 320's click-to-filter would read as broken there. (The handoff says *nothing visible*; the filter strip, BREAKING and the other half of the distributions do move.)
- So a page carrying `?stage=` or `?topics=` opens on MOVERS, and the island is keyed on that condition, so setting or clearing a filter re-applies it. Without the key a soft navigation keeps the island's tab state, which is what the chamber toggle still relies on.
- The same expression opens on MOVERS when NEW's count is 0 for the chosen chamber, so, in the handoff's words, `/` never opens on *No new bills introduced in the last 7 days.* and smoke's first-row test can't go red on a quiet week.
- NEW's badge and its rows share one predicate (`getNewBillsThisWeekCount` and `getNewBillsThisWeek`, `lib/queries.ts:667` and `:733`). They're cached under different tags, though (`bills`, and `bills` with `news-breaking`), and the review derived the minutes after 00:00Z (5 PM MST) in which a news flush can recompute the rows before the count. There the *never* doesn't hold, and neither does the *can't*, though `e2e-prod` runs smoke with `--retries=2`, so a red needs all three attempts inside that window (backlog, new).

**STEP 0, a check: claims 1 to 4 held** (read at `e19d7e3` before any edit, 2:28 PM MST, 21:28Z).
- **1:** `main` `e19d7e3`, locally and on the remote (`ls-remote` read `main` alone); pointer 796 at `:8308`, the file's last line; highest HO in subjects 796. This handoff is the one numbered file above 796.
- **2 to 4:** every anchor as cited, in `ActivityTabs.tsx` (`:33`, `:52`, `:59`, `:61-87` in the order MOVERS, TOP STALLS, NEW, `:88-97`), `app/page.tsx` (`:97-100`, `:137`, `:258-294`, `:260-264`, `:266-267`, `:276-293`, `:277`) and `app/globals.css` (`:1838-1844`, `:1845`, `:1851`, `:1855`, `:1860`, `:1870`, `:1873`, and `.hcal-filter-*` at `:11067`, `:11073`, `:11088`, `:11091`, `:11095`). In tracked files `feed-filterslot` and `feed-chamber-sep` appear only at their own CSS rules and at `ActivityTabs.tsx:91-92`.
- **5, re-derived:**
  - `StageFunnel.tsx:91` is `router.push(href, { scroll: false })`.
  - No e2e spec names `feed-chamber`, `feed-filterslot`, `breaking-stalls-tabs` or a feed tab's label.
  - The tests that read rows on `/`'s open tab are `smoke.spec.ts:913` and fit-finish `:106`, `:156` (its second load at `:179`, read at `:181`) and `:563`. All three tabs render `V2FeedList`, so `.v2f-row` and `.v2f-group` are on NEW's rows as they were on MOVERS'. The other tests that load `/` don't read the feed's rows: the tape hovers (both specs), the ODDS strip, the WeeklyBand hover, click-to-filter, the races box (three tests), the no-sideways-scroll widths, the dropdown hunt, the PRESIDENT click and the anonymous `/?stage=president` redirect.
- **6, re-derived:** SKILL `:1835`, `:2001`, `:2314` and `:2379` as cited, and no other SKILL clause places the selector or names the open tab. Reconcile 282 / 361 on 643, mis-struck 0.

**The change** (`feat`).
- **`components/ActivityTabs.tsx`:**
  - `Tab` is exported, and a required `initialTab` seeds `useState`.
  - The buttons run NEW THIS WEEK, MOVERS, TOP STALLS, each one's markup unchanged, and the nav's `aria-label` is *New this week, movers, or top stalls*.
  - `filterSlot` leaves the nav and renders straight after it, in `<div className="feed-chamber-row">`. The middot and `.feed-filterslot` are gone.
  - The header gains the HO 797 paragraph: the order, `initialTab`, the row, and the mock cited on one line. The HO 642 paragraph gains *HO 797 moved the slot out of the nav to its own row.*
- **`app/page.tsx`:** `feedFiltered` and `feedInitialTab` directly above the return, under the handoff's comment, whose *or a funnel click would change nothing visible* the Nov 3 go reworded to *(otherwise the funnel click still moves the filter strip, BREAKING and the distributions, but the open feed tab wouldn't change)*, the rest verbatim. The mount carries `key={feedFiltered ? "filtered" : "plain"}` and `initialTab={feedInitialTab}`, and `.feed-chamber` opens with `<span className="feed-chamber-label">Chamber</span>`. The `<Link>`s are unchanged.
- **`app/globals.css`:**
  - `.feed-filterslot` and `.feed-chamber-sep` are removed.
  - `.feed-chamber-row`, `.feed-chamber-label` and the two `.is-on` pseudo-element rules are added, and the options move to `--fs-11` and `--text-muted`: the handoff's values throughout, and no new tokens, with one value changed by the Nov 3 go: `.feed-chamber-row`'s top margin is **−10 px, not the handoff's −2**, so the row sits 6 px under the rule as the mock does (the strip's effective margin-bottom is `.search-tabs`' 16 px, not the 8 the mock's strip has), with a comment beside it saying so.
  - The HO 642 comment's first sentence and its load-bearing sentence are rewritten: the options sit outside `.search-tabs` since HO 797, the descendant scoping is kept for specificity with the rest of the block, and the treatment copies `.hcal-filter-*` as values, not shared classes. Its second sentence loses *against the last tab* (flagged below).
  - No `@media` block re-declares any of these selectors.
- **Nothing under `lib/`,** and no change to the three feeds' queries or row markup, to `/hearings`' CSS, or to what `filters` reaches.

**The test** (`test`): the handoff's test, verbatim, in `targeted interactions`, after *expand a bill row*.
- **Red at the base.** The base's cold build at `e19d7e3` (Node v24.22.2, 2:35:27 to 2:36:02 PM MST, 21:35:27Z to 21:36:02Z; its junction unlinked first, the target 24 files before and after; exit 0, 0 warning lines), served at `:3000` (one listener, pid 41464, the scratchpad's v24.22.2 `node.exe`), with the test as written: **1 failed** at 2:37:08 PM MST (21:37:08Z), on the first tab's text: *Expected substring: "New This Week"*, *Received string: "Movers(49)"*, after the 15 s expect timeout.
- **Green on the change:** § 3a below.

**§ 3's server.**
- The change's cold build, its junction unlinked first and the target 24 files before and after: 2:42:52 to 2:43:29 PM MST (21:42:52Z to 21:43:29Z), exit 0, 0 warning lines.
- `next start` at `:3000` on Node v24.22.2 with the box's `.env`. Bind check: one listener, pid 55372, the scratchpad's v24.22.2 `node.exe`.
- The served stylesheet (184,702 bytes; the base's 184,444) carries `feed-chamber-row` and `feed-chamber-label` and no `feed-filterslot`. The base's carried `feed-filterslot`. `.search-tabs` is in both, the control. Each was read over HTTP from its own server, and the files weren't kept (`797-artifacts/mechanics.txt`).
- **Nov 3, the go's two feat changes rebuilt:** the junction unlinked first (24 files before and after, 0 reparse points left), `.next` removed, the cold build on Node v24.22.2 from 11:40:41 to 11:41:47 AM MST (18:40:41Z to 18:41:47Z), exit 0, 0 warning lines. `next start` at `:3000`: one listener, pid 39436, the scratchpad's v24.22.2 `node.exe`, the box's `.env`. `/` 200 (439,604 bytes) with `ct_seen`; the served stylesheet (184,703 bytes) carries `feed-chamber-row` with `margin:-10px`, no `feed-filterslot`, `.search-tabs` 7. Its log held `[auth][error] MissingSecret` ×38 and nothing else error-like.

**§ 3a,** 2:44:12 to 2:44:28 PM MST (21:44:12Z to 21:44:28Z): **5 passed** (13.9 s): the new test, *expand a bill row*, *feed row expand*, *feed id: plain click* and *sponsor portrait*. The portrait test found a resolved sponsor within NEW's first six rows, so there's no finding to name. The three fit-finish tests' collector lines each read `console=0 pageErr=0 bad=0`.

**§ 3a again, Nov 3,** on the rebuilt feat: the new test alone, **1 passed** (4.3 s), 11:43:12 to 11:43:30 AM MST (18:43:12Z to 18:43:30Z); then the same five, **5 passed** (10.2 s), 11:43:30 to 11:43:42 AM MST (18:43:30Z to 18:43:42Z), the three collector lines again `console=0 pageErr=0 bad=0`.

**§ 3b, at 1440** (`docs/handoffs/797-artifacts/read-797.mjs` → `reads-change.json`, the run of 2:48:47 to 2:48:58 PM MST, 21:48:47Z to 21:48:58Z; every context with `ct_seen`, so the strip rendered with no 307 to `/welcome`, and with reduced motion, read back in the page).
1. **`/`:** `New This Week(44)`, `Movers(49)`, `Top Stalls(5)` in that order, NEW active. `.feed-chamber-row` sits 14 px below the nav. `.feed-filterslot` 0, and no `.feed-chamber` inside the nav.
2. **MOVERS, then HOUSE:** `/?chamber=house`, the tab **still MOVERS**. **Then ALL:** `/`, still MOVERS. A marker set on `window` survived both, so they were same-document, the soft navigation the comment relies on. No HALT.
3. **From `/` on NEW, two funnel bars,** each from a fresh load, each bar's filtered MOVERS count read off its own page before any click:
   - **COMMITTEE,** the largest count that still narrows: `/?stage=committee`, MOVERS, 49 → 46. The rows stay 30, `ActivityTicker`'s cap. × CLEAR: `/`, NEW.
   - **FLOOR,** the largest under the cap (tied with PRESIDENT at 3; the funnel's order broke the tie): `/?stage=floor`, MOVERS, 49 → 3, rows 30 → 3, each with FLOOR at one end of its transition (*FLOOR → CMTE*, *FLOOR → PRES*; the dashboard's stage filter is `stage = ? OR previous_stage = ?`, `lib/queries.ts`, `buildChangesWhere`). × CLEAR: `/`, NEW.
   - All four navigations were same-document.
4. **`/?stage=floor&chamber=senate`:** MOVERS. HOUSE: `/?stage=floor&chamber=house`, MOVERS. ALL: `/?stage=floor`, MOVERS.
5. **Computed styles:** `.is-on` (ALL) is `rgb(251, 191, 36)`; its `::before` is `"["` in `rgb(217, 119, 6)`, and its `::after` `"]"` the same. The three options and the label all compute 11px, which is `--fs-11` at 1440. The other options read `--text-muted` (`rgb(148, 163, 184)`) and the label `--text-dim` (`rgb(107, 114, 128)`).
6. **`.v2f`'s top less the nav's bottom.** The first read, Nov 1, with the handoff's −2 px: **16 px at the base, 40.5 px on the change, +24.5 px,** the same on all three tabs and inside the handoff's 18 to 28 (−2 + 18.5, the row, + 8; from the panel's top 62 → 86.5, the handoff giving the mock's as 51 → 73). **Re-read Nov 3 with the go's −10 px** (`797-artifacts/strip-797-nov3.mjs` → `nov3/strip-reads-nov3.json`, 11:43:44 to 11:43:49 AM MST, 18:43:44Z to 18:43:49Z; and `read-797.mjs` again → `nov3/reads-change.json`, 11:43:50 to 11:44:03 AM MST, 18:43:50Z to 18:44:03Z): **the row 6 px under the rule and 8 above the list at 1440 and 390 on every tab, and `.v2f` 32.5 px under the nav, +16.5 on the base's 16,** 78.5 from the panel's top at 1440. Beside the mock's own numbers rather than the derived bound: the mock's row is 6 under and 8 above too, and its list sits 30 under its strip against the page's 32.5; the 2.5 px is the row's height, 18.5 on the page (a 16.5 px line at 11px on the panel's 1.5 line-height, plus 2 px of padding) against the mock's 16 at `normal`. The strip's own margin, 16 on the page and 8 in the mock, is what the −10 absorbs.

Reads 1 to 5 re-ran on Nov 3's build with the same result (`nov3/reads-change.json`, `fail: []`): NEW active, the counts now 37 / 51 / 5; MOVERS through HOUSE and ALL, same-document; COMMITTEE 51 → 48 (rows 30) and FLOOR 51 → 3 (rows 3), each × CLEAR back to NEW; `/?stage=floor&chamber=senate` holding MOVERS through HOUSE and ALL; the same colours and 11px.

**The captures** (`797-artifacts/`, gitignored), 1440 and 390: `home-new-*.png`, `home-stalls-*.png` (no day header; the row sits on the rows) and `home-movers-house-*.png`, plus the base's three tabs at 1440. At 390 the strip wraps, TOP STALLS on its own line and the nav 77 px tall, and the row sits under it. The document doesn't scroll sideways in any of the six. Nov 3's six are in `797-artifacts/nov3/`, the row 6 under the rule in each, and `strip-built-nov3-{1440,390}.png` are the crops beside Nov 1's `strip-built-*.png` and `strip-whatif-6px-*.png`.

**A finding, filed:** TOP STALLS' badge reads *(5)* over 60 rows. The badge is HO 133's constant and the 60 is HO 627's ceiling; the captures show both (backlog, new).

**The review** (workflow `wf_d33e52cb-96e`, ten agents): four readers over the diff (fidelity, the cascade, runtime, the tests) and a refute-first skeptic for each of their six findings.
- **Fidelity:** only the four files changed. Every clause of § 1 and § 2 is as written, each button block byte-identical to the base's, and guards 1, 3 and 4 hold. The two departures are the ones flagged below.
- **Runtime, read in Next 16.3.4's source:** the page segment's React key drops its search params (`node_modules/next/dist/client/components/layout-router.js:549`, `createRouterCacheKey(activeSegment, true)`, applied as the key at `:673-688`), so a navigation that changes only the query keeps the island, and the key is what remounts it. A topic row (a `router.push`, like the funnel bar), `?topics=` alone, an invalid `?stage=` or `?topics=` (NEW, since nothing is applied), back and forward across a filter, and a clear into a chamber whose NEW is empty (MOVERS) all read as designed, with no console error and no hydration report.
- **Tests:** the test is verbatim and `typecheck:e2e` covers it. The `(0)` regex can't match `(10)` or `(1,204)`, its assertions read server-rendered attributes, and `e2e-prod`'s smoke should read 140 + 1 = 141, owed after the FF.
- **Confirmed:**
  - **The row sits 14 px under the strip's rule, where the handoff's 51 → 73 puts the mock's 6 px under it.** `.search-tabs { margin-bottom: 16px }` (`:5958` now) comes after `.breaking-stalls-tabs { margin-bottom: var(--space-sm) }` (`:1811`) at the same specificity, so the strip's margin is 16, not 8, and the row's −2 px acts on 16. Read 6 can't see it, since the margin sits in both base and change. Measured on the build (`797-artifacts/strip-reads.json`, 3:18 PM MST, 22:18Z): 14 px under the rule and 8 above the list at 1440 and 390; with `margin-top: -10px` injected in the page alone, 6 and 8 (`strip-built-*.png`, `strip-whatif-6px-*.png`). Not changed, because the mock isn't on disk and the 6 px is derived, not read. When it lands, its option C is measured and decides. **Nov 3:** it landed and was read, 6 under, 16 tall and 8 above (above); the go set `margin-top: -10px`, and the build reads 6 and 8 (read 6, re-read).
  - **The open-on-NEW rule reads NEW's cached count, and NEW's empty state its separately cached rows** (two readers): filed.
- **Refuted, as the handoff's design:** a chamber toggle into an empty NEW keeps NEW on its empty state, since the key covers the filter only and read 2 requires the tab to hold; and the smoke test's `?stage=` leg is a full load, so it can't see the key. Both are flagged below.

**The ledger.**
- **Backlog,** two new OPEN LOOPS lines, both Code's, low:
  - *The TOP STALLS badge reads (5) over a tab that renders 60 rows (HO 797's § 3b captures)*;
  - *The feed's open-on-NEW rule reads NEW's cached count, and NEW's empty state reads its separately cached rows… (HO 797's review)*.
- **Oddities:** none.
- **Reconcile:** 282 / 361 on 643 at open; **284 / 361 on 645** at close, mis-struck 0.

**Owed after the FF.**
- `components/` and `app/` changed, so Production serves new code: the served SHA; `e2e-prod`, smoke **141** with the new test, narrow's cells `over=0`, the real counts from the run; then § 3b's reads 1 and 3 against prod.
- The `docs(skill)` commit means the chat rebuilds `cbt.zip`; the upload stays held until after GradShow.
- Corey's three odds snapshots run by the task: 9:30 PM MST Nov 2 (04:30Z Nov 3), then 7:30 AM and 3:30 PM MST Nov 3 (14:30Z and 22:30Z). The first two had run by this block's Nov 3 remake (`docs/probes/odds-snapshots/2026-11-02-2130-MT.json` and `2026-11-03-0730-MT.json`, untracked and left out of every commit). Nothing here touched `scripts/diagnostic/gradshow-numbers-787.ts`.

**What was flagged.**
- **The mock was absent from disk** through Nov 1 and the first go (8:44 PM MST Nov 1, 03:44Z Nov 2), which HALTed at its step 1 on it; through that, `check:design-citations` read three problems, one token DANGLING at three sites: `ActivityTabs.tsx:38`, this block's ruling line and SKILL `:2001`. It landed at 11:00 AM MST Nov 3 (18:00Z), this commit carries it, and the gate resolves all three.
- **The row's offset** (the review): 14 px under the rule as built, 6 px in the mock by the handoff's own numbers, held for the mock. The mock read 6 on Nov 3, and the go set `margin-top: -10px`: a departure from the handoff's § 1 CSS (`margin: -2px 0 var(--space-sm)`), named here, and the build reads 6 and 8.
- **The HO 642 CSS comment's second sentence** lost *against the last tab*, which this change made false. The handoff named only the first sentence and the load-bearing one.
- **`key` and `initialTab`** are the mount's first two props; the handoff didn't place them.
- **Read 3:** the handoff names a funnel bar, and two were clicked, so the narrowing reads in the rows as well as the count. The instrument's first stage check was wrong about the filter: it read the current stage alone. That run is kept (`reads-change-run2-stagecheck-misread.json`), and the check now reads both ends.
- **Read 6:** first +24.5 px against the mock's +22, inside the handoff's bound; with the go's −10 px, +16.5. The page's 1.5 line-height makes the row 18.5 px tall, where the mock's row, at `normal` line height, is 16: on Nov 1 that was the review's derivation from the handoff's 51 → 73, and on Nov 3 it was read in the mock (16, with the list 30 under the strip). So the page's list sits 32.5 under the nav against the mock's 30, the row's 2.5 px, and the handoff's +22 is on a strip margin 8 px shorter than the page's.
- **The handoff's *rebases nothing visible*** (its line 5): with NEW open a funnel click still moves the filter strip, BREAKING and the other half of the distributions. It's the feed that wouldn't move, and the architect's-call section says so. The Nov 3 go reworded the `app/page.tsx` comment, which the handoff gave verbatim, to match: *or a funnel click would change nothing visible* is now *(otherwise the funnel click still moves the filter strip, BREAKING and the distributions, but the open feed tab wouldn't change)*.
- **The ref was remade on Nov 3:** `reset --soft e19d7e3`, then the four commits again with explicit pathspecs, the feat with the go's two changes and the docs with the mock; the test's and SKILL's contents are unchanged. Nov 1's `9344ff0`, `981ba9b`, `d70b36d` and `b9a1e7a` stay in the reflog. The Nov 1 reads and captures stand as recorded; Nov 3's sit beside them in `797-artifacts/nov3/`.
- **SENATE's NEW is 0 today,** so SENATE clicked from `/` on NEW lands on NEW's empty state in the same document, while a load of `/?chamber=senate` opens on MOVERS. That's the design (the key is the filter's alone, and read 2 holds the tab), and the review refuted it as a defect. It's recorded so it isn't rediscovered.
- **The key's soft-navigation path has no automated guard.** The smoke test's `?stage=` leg is a full load, so it passes without the key; § 3b's read 3 is the reading. A soft-click leg would change the handoff's verbatim test, so it's proposed, not done.
- **The HO 133 CSS comment** (`:1806-1809`) still says the strip takes *a tighter margin*, which `.search-tabs`' 16 px has overridden since HO 133 put the strip rule earlier in the file. It's pre-existing, and the handoff says nothing else in the file changes, so it stands.
- **The architect's *never* and *can't*** hold while NEW's cached count and cached rows agree; the review derived the window where they don't (backlog, new).
- **Also notes now run through HO 797.**

**Also (HO 798), the first Nov 4 read: the ballot taken once more after the polls closed (twelve authorized POSTs, 8:24 to 9:13 AM MST, 480 of 480 READ, none yielded), Louisiana read live (#30558 at 9:35 AM MST (16:35Z), 6 of 6 in 18.6 s: four incumbents outright, LA-05 to Dec 12, LA-06 uncalled), the rosters re-derived (#30559 at 9:36 AM MST (16:36Z), 902 rows in 647 ms, four jungle seats decided), then the pages, the band and `/electoral` read on Production against the rulings (64 PASS, 0 FAIL, 2 N/A at 9:43 AM MST (16:43Z)), and the WATCH line (HO 758) closed on the first night's read (383 of 383 decided pages, and the band's 65 of 105 · House R 135 · D 219 · 81 open equal to the SELECT over the marks). It opens with HO 797's FF go as taken.**
- **What's here:**
  - HO 797's FF go as taken;
  - the three odds snapshots and the Sabato runs, the hand readings the box gives;
  - STEP 0, a check: claims 1 to 8 held at 8:23 AM MST (15:23Z), 0 HALTs, 0 findings;
  - the clock;
  - (a) the ballot, (c) Louisiana, (b) the harvest, each by its `cron_runs` rows;
  - the eight reads, PASS / FAIL against the ruling each was read against;
  - the close, *383 of 383*;
  - the findings;
  - the ledger;
  - what's owed after the FF;
  - what was flagged.
- **Two commits, kinds unmixed, both `docs`:** the findings file (`docs/probes/798-election-night-run.md`) alone, then this block, the backlog and the oddity. No app code: nothing under `lib/`, `app/`, `components/`, `scripts/`.
- **Prod was written only through the three authorized routes** (`/api/cron/general-ballot`, `/api/cron/primaries?state=LA`, `/api/cron/race-challengers`), each by one authorized POST per call, the same code the schedule runs; read otherwise by `SELECT` only. No migration, no `/api/sync`, no flush beyond the routes' own `expireTag`, no hand `UPDATE`.
- **The pointer is 798:** pointer 797 (`docs/roadmap.md:8443`), highest HO in commit subjects 797, `main` at `bd29e97`.

**HO 797's FF go, as taken** (`docs/handoffs/797-ff-go.md`, taken up 6:54 PM MST Nov 3, 01:54Z Nov 4).
- **`main` at `bd29e97`:** `e19d7e3..bd29e97`, four commits (`bf335b9` feat, `6530ca8` test, `77f687a` docs, `bd29e97` docs(skill)), no force; `797-review` deleted on the remote and locally, local `main` forwarded by `--ff-only`, and `ls-remote` then read `main` alone at `bd29e97a4b2b48511137975747d8c430b2c03fef`.
- **The gates before the push,** on Node v24.22.2: the cold build SKILL's way (the `.next` junction unlinked first, its target's 24 files confirmed intact from a separate process), `npm run build` 6:59:50 to 7:00:54 PM MST Nov 3 (01:59:50Z to 02:00:54Z Nov 4), exit 0, 0 warning lines; `typecheck` 0 on both projects; `check:odds-sites` OK (190 / 13 / 13); `check:design-citations` OK (1170 scanned, 171 citations, 157 resolved, 4 allowlisted, 0 problems).
- **The push** at 7:02:12 PM MST (02:02:12Z): `e19d7e3..bd29e97 -> main`.
- **The deploy:** Production record `7535845190`, `success` at 7:03:14 PM MST (02:03:14Z), deployment `congressionalterminal-mgnsa6yp7`; `verify:deploy` in the foreground read `e19d7e3` at 0 s and 11 s, `bd29e97` from 21 s, five consecutive by 62 s; `/api/version` the HO 787 way at 7:04:36 PM MST (02:04:36Z), plain and with a fresh query string: `bd29e97`, no-store, MISS, Age 0.
- **`e2e-prod` `41758181995`** (`deployment_status` on the Production record): smoke **141** (`141 passed (5.8m)`; 46 smoke, 80 narrow, 15 odds-off; 0 retries, nothing failed, flaky or skipped), 76 documents over 38 routes all 200 with the counters 0, narrow 80 cells `over=0`, the feed-tabs test at `e2e/smoke.spec.ts:924` 2.9 s. No dispatch, no flush.
- **§ 3b's reads 1 and 3 on prod** at 1440, 7:04:40 to 7:04:53 PM MST (02:04:40Z to 02:04:53Z): New This Week (37) / Movers (38) / Top Stalls (5), New open, `.feed-chamber-row` 6 px under the rule and 8 above the list, `.feed-filterslot` 0; from New the FLOOR bar → `/?stage=floor` on Movers (1), × CLEAR → `/` on New, each a soft navigation, read twice.

**The hand readings the box gives (STEP 0).**
- **Corey's three odds snapshots** (`docs/probes/odds-snapshots/`, untracked until the results HO): `2026-11-02-2130-MT.json`, 193,164 bytes, taken 9:30:20 PM MST Nov 2 (04:30:20Z Nov 3) at head `b9a1e7a`, last tick #30137; `2026-11-03-0730-MT.json`, 193,173 bytes, 7:30:09 AM MST Nov 3 (14:30:09Z) at `b9a1e7a`, last tick #30247; `2026-11-03-1530-MT.json`, 193,162 bytes, 3:30:03 PM MST Nov 3 (22:30:03Z) at `bd29e97`, last tick #30343. Each read back equal to its tables (kalshi_odds 469, polymarket_odds 34) with prod's schema fingerprint unchanged (`docs/handoffs/odds-snapshots.log`). The two Nov 1 files are the test runs and stay out of everything.
- **The Sabato task's runs:** refused Nov 1 (by hand, 11:22:57 and 11:33:41 AM MST from DEN, then 1:03:18 PM MST, 20:03:18Z, `cf-ray a53d808b0ad7397e-MCI`; the 5:00 PM task saw the day refused and didn't fetch again), Nov 2 (5:00:02 PM MST, 00:00:02Z Nov 3, `a54718afacae4dde-MCI`) and Nov 3 (5:00:01 PM MST, 00:00:02Z Nov 4 by the response's Date, `a54f560e9a8ffb49-MCI`), each 403, `cf-mitigated: challenge`, 5,497 bytes (`docs/handoffs/sabato-rating-changes-2026-11-0{1,2,3}.challenge.html`, `.headers.txt`; `docs/handoffs/sabato-daily.log`). **The Center for Politics:** the message went through centerforpolitics.org's contact form from the CSU address at 2:01 PM MST Nov 1 (21:01Z), as the HO 797 block records; no reply as of Nov 4 (Corey's word in the chat).

**STEP 0, read 8:23:28 to 8:23:32 AM MST Nov 4 (15:23:28Z to 15:23:32Z), prod by `SELECT` only (17 statements, the schema's object list unchanged across the read), the box read-only: claims 1 to 8 held, 0 HALTs, 0 findings** (`798-artifacts/step0-798-2026-11-04T15-23-28-475Z.log`).
- **Claim 1:** HEAD `bd29e97` on `main`, `ls-remote` reading `main` alone at `bd29e97`; the tree clean but for `?? docs/probes/odds-snapshots/`; highest HO in subjects 797; pointer 797 at `docs/roadmap.md:8443`; reconcile 284 / 361 on 645; the WATCH line at `docs/backlog.md:79`, the Sabato line at `:50`.
- **Claim 2, the ballot cron since 15:00Z Nov 2 (8:00 AM MST Nov 2):** 24 rows, every one `success`; the 16 before 00:00Z Nov 4 (5:00 PM MST Nov 3) all 40 attempted, 40 READ, stop `cap` (640 of 640); the eight since the polls closed, one by one: #30367 5:20:35 PM MST Nov 3 (00:20:35Z) 40 / 40 / 0 / 0, box 40, 90 rows written, 234,267 ms; #30387 7:20:35 PM (02:20:35Z) 40 / 40 / 0 / 0, box 39, no_box 1, 118 rows, 234,285 ms; #30407 9:20:35 PM (04:20:35Z) 40 / 40, box 40, 120 rows, 235,382 ms; #30427 11:20:36 PM (06:20:36Z) 40 / 40, box 40, 111 rows, 235,698 ms; #30449 1:20:36 AM Nov 4 (08:20:36Z) 40 / 40, box 35, no_box 5, 95 rows, 235,275 ms; #30470 3:20:35 AM (10:20:35Z) 40 / 40, box 40, 132 rows, 236,969 ms; #30493 5:20:36 AM (12:20:36Z) 40 / 40, box 40, 125 rows, 234,304 ms; #30517 7:20:35 AM (14:20:35Z) 40 / 40, box 40, 102 rows, 234,337 ms: 320 attempted, 320 READ, 0 UNREAD, 0 NO_PAGE since the close, every stop `cap`, `minGapMs` 6000, no UNREAD cause at all, no tick in flight.
- **Claim 3, the races:** `general_ballot_reads` holds all 470 (no 2026 race without a row); `MIN(last_attempt_at)` 9:21:37 AM MST Nov 3 (16:21:37Z), 23.0 hours before the read, `MAX` 7:24:30 AM Nov 4 (14:24:30Z); every last attempt READ (box 464, no_box 6: FL-10 and Louisiana's five without a box; LA-05's read turned `box` at 1:24:19 AM MST, 08:24:19Z, the Dec 12 general's box with two unmarked printed rows); **181 races marked, one mark each, all read after 00:00Z Nov 4** (the election, not a fault); `general_runoff` 0 rows.
- **Claim 4, the other crons since 00:00Z Nov 3:** `/api/cron/primaries` 4 of 4 `success`, the 12:00Z Nov 4 tick #30487 at 5:00:22 AM MST, 27,102 ms; `/api/cron/race-challengers` 2 of 2, the 12:30Z tick #30496 at 5:30:25 AM MST, 1,060 ms (902 rows, 465 races, rated index 105, jungle 5 races / 26 rows / 0 decided / 0 runoff, LA-05 now a box race); `/api/cron/kalshi` 20 of 20, the newest #30515 at 7:15:10 AM MST (14:15:10Z), `kalshi_odds` 469 and `polymarket_odds` 34 written at 7:15:35 AM; `/api/sync` 7 of 7; `/api/sync-race-ratings` 2 of 2 `error` on Sabato's Cloudflare challenge, as expected (#30209, #30477 at 4:00:44 AM MST, 11:00:44Z). The last `?state=` row is still HO 778's #24524 (Oct 12).
- **Claim 5:** `.env` carries `CRON_SECRET`, present and non-empty, by name.
- **Claims 6 and 7:** every constant, schedule, route and reader read at its cited line (`TICK_CAP` 40, `TICK_BUDGET_MS` 240,000, `MIN_START_GAP_MS` 6,000, `stopRule` `first-unread`; `maxDuration` 300 and the 290 s soft timeout; the Bearer check at `:37` and `:45`, GET `:67`, POST `:71`; the reaper at 5 minutes; the five schedules; `resolveHouseTarget` `:2620`, `runPrimariesStateTarget` `:2653`, `isSettled` `:662`, the `?state=` log line `:54`, the harvest and its `expireTag` `:52-53`, the seven readers, the three gates, HO 779's kept tag `:180-188`).
- **Claim 8:** SKILL `:1299` and `:1389` stand.

**The clock.** MST (UTC−7). The run started at 8:23 AM MST (15:23Z), an odd UTC hour; (a) began at 8:24 AM MST (15:24Z) and its driver checks every call's 305 s span against the stay-clear windows (:15 to :35 of an even UTC hour; 00:00–00:10Z and 12:00–12:10Z) and waits by itself, as do the reads and the close. (a) ran 8:24:03 to 9:13:12 AM MST (15:24:03Z to 16:13:12Z) without a wait; (c)'s driver, reached at 9:14:03 AM MST (16:14:03Z), found its span touching 16:15Z and waited until 9:35:15 AM MST (16:35:15Z); (b), the reads and the close ran inside 16:36–16:44Z.

**(a) The ballot: the 470 read once after the close, by twelve authorized POSTs of `/api/cron/general-ballot`** (`798-artifacts/calls-798.mjs --ballot`, the Bearer read from `.env` by name; its log `calls-ballot-2026-11-04T15-24-03-528Z.log`). The first call went out at 8:24:03 AM MST (15:24:03Z), clear of every window; **the first reading call's row started at 8:24:06 AM MST (15:24:06Z)**; each row was read back before the next call, with a 10 s pause after it closed, and the twelve ran back to back with no yield, no drop and no HALT, ending at 9:13:12 AM MST (16:13:12Z). The rows, in order (id, started → ended, attempted / READ / UNREAD / NO_PAGE, box / no_box, rows written, stop, ms):
- #30529 · 8:24:06 → 8:28:02 AM MST (15:24:06Z → 15:28:02Z) · 40 / 40 / 0 / 0 · box 40 · 108 rows · cap · 236,397 ms
- #30530 · 8:28:13 → 8:32:07 AM (15:28:13Z → 15:32:07Z) · 40 / 40 / 0 / 0 · box 40 · 172 rows · cap · 234,222 ms
- #30534 · 8:32:18 → 8:36:14 AM (15:32:18Z → 15:36:14Z) · 40 / 40 / 0 / 0 · box 40 · 107 rows · cap · 235,553 ms
- #30535 · 8:36:25 → 8:40:19 AM (15:36:25Z → 15:40:19Z) · 40 / 40 / 0 / 0 · box 40 · 119 rows · cap · 234,237 ms
- #30538 · 8:40:30 → 8:44:25 AM (15:40:30Z → 15:44:25Z) · 40 / 40 / 0 / 0 · box 40 · 80 rows · cap · 235,407 ms
- #30539 · 8:44:36 → 8:48:31 AM (15:44:36Z → 15:48:31Z) · 40 / 40 / 0 / 0 · box 39, no_box 1 · 132 rows · cap · 235,343 ms
- #30540 · 8:48:43 → 8:52:37 AM (15:48:43Z → 15:52:37Z) · 40 / 40 / 0 / 0 · box 40 · 119 rows · cap · 234,298 ms
- #30542 · 8:52:49 → 8:56:43 AM (15:52:49Z → 15:56:43Z) · 40 / 40 / 0 / 0 · box 40 · 106 rows · cap · 234,202 ms
- #30543 · 8:56:56 → 9:00:51 AM (15:56:56Z → 16:00:51Z) · 40 / 40 / 0 / 0 · box 35, no_box 5 · 87 rows · cap · 235,366 ms
- #30548 · 9:01:03 → 9:04:57 AM (16:01:03Z → 16:04:57Z) · 40 / 40 / 0 / 0 · box 40 · 146 rows · cap · 234,237 ms
- #30549 · 9:05:09 → 9:09:04 AM (16:05:09Z → 16:09:04Z) · 40 / 40 / 0 / 0 · box 40 · 117 rows · cap · 235,358 ms
- #30550 · 9:09:16 → 9:13:12 AM (16:09:16Z → 16:13:12Z) · 40 / 40 / 0 / 0 · box 40 · 104 rows · cap · 236,209 ms

**480 attempted, 480 READ, 0 UNREAD, 0 NO_PAGE**, every stop `cap`, `minGapMs` 6000 and 40 requests on every row, no runoff box read, no UNREAD cause. After each row the count of races whose `last_attempt_at` still predated the first call fell 430, 390, 350, 310, 270, 230, 190, 150, 110, 70, 30, 0; **after call 12 `MIN(last_attempt_at)` read 8:25:09 AM MST (15:25:09Z), not before the first call**, with no NULL. Unlike HO 777's #24309, the client side held every call to its 200 (234,612 to 238,357 ms); no call was re-sent. Each tick that READ expired `general-ballot` once (`lib/general-ballot.ts:1099`).

**(c) Louisiana: one authorized `POST /api/cron/primaries?state=LA`** (`calls-798.mjs --la`; the log `calls-la-2026-11-04T16-14-03-339Z.log`). The driver reached the call at 9:14:03 AM MST (16:14:03Z), found its 70 s span touching the 16:15–16:35Z window and waited, as the clock section asks, until 9:35:15 AM MST (16:35:15Z). **The row: #30558, `/api/cron/primaries?state=LA`, 9:35:16 → 9:35:34 AM MST (16:35:16Z → 16:35:34Z), `success`, 18,566 ms**, unit `house-target`, state LA, attempted 6, parsedOk 6, 39 candidates, 4 matched incumbents, no fetch failure, no settled contest skipped, no runoff stray, per-unit p50 2,830 ms, max 3,992 ms (the client's 200 after 19,052 ms, `x-vercel-id cle1::pdx1::…`). **The six boxes after the call,** each jungle contest's rows as pdx1 read them (`primary_candidates.status`, `primaries.updated_at` 9:35:16 AM MST, 16:35:16Z): LA-01 one winner, Steve Scalise (R, the incumbent), over Jewett, Glass and Arrington; LA-02 one winner, Troy Carter (D, the incumbent), over Ballay, Williams, Collins and Beach; LA-03 one winner, Clay Higgins (R, the incumbent), over Walker, Day, Cotten, Gonzalez and LeBrun; LA-04 one winner, Mike Johnson (R, the incumbent), over Cable, Heslop, Gromlich and Nichols; **LA-05 two winners, Gabe Firment (R) and Pat Moore (D)**, the Dec 12 advancers, over seven others; LA-06 no winner marked among its ten. Before the call every contest read 0 winners (the Nov 1 tick's rows). **The comparison with Ballotpedia by hand could not be made from here:** the Chrome extension wasn't connected, a cloud fetch of each of the six pages answered HTTP 202 with an empty body, and one honest-agent request from the box (`CBT-798-run/1.0`) answered the same empty 202 from CloudFront (*Error from cloudfront*, 0 bytes), the bot wall HO 773 recorded. What stands in its place: LA-05's two jungle winners are exactly the two printed rows of its Dec 12 general box, read by the ballot tick at 1:24:19 AM MST (08:24:19Z), so no partial mark there; the four one-winner contests are each the incumbent's outright win, the shape `isSettled` would freeze only if Ballotpedia marks a second advancer later, which a page beside the row would have excluded and this run could not. Flagged, not corrected: nothing here writes to prod outside the three routes. (c) expires no tag; (b) carries its writes to the pages.

**(b) The harvest: one authorized `POST /api/cron/race-challengers`** (`calls-798.mjs --harvest`; the log `calls-harvest-2026-11-04T16-36-07-333Z.log`), at 9:36:07 AM MST (16:36:07Z), the 70 s span clear. **The row: #30559, 9:36:08 → 9:36:09 AM MST (16:36:08Z → 16:36:09Z), `success`, 647 ms** (the client's 200 after 982 ms): cleared 902, inserted 902, **902 rows over 465 races of 470 seats**, rated index 105, `bySource` harvest:primary_winner 26 rows / 5 races and harvest:general_ballot 876 rows / 460 races, ballot races 464, ignored 0, incumbent routes identity 367 / underline-surname 0 / none 95, curated history kept 7, curated retired none, on-ballot rows 322 over 195 races; **jungle 5 races, 26 rows, 4 decided, 0 runoff** (LA-05 is a box race since 1:24 AM MST (08:24Z) and publishes its Dec 12 box's two rows as `advanced`, so its runoff isn't the jungle rule's count). `race_candidates` read 909 rows over 465 races with 78 `advanced` before and after (the same rows, the run's stamp). Then `expireTag("races")` (`app/api/cron/race-challengers/route.ts:53`), which is what carried (c)'s marks to the Louisiana pages.

**The eight reads on Production** (`798-artifacts/reads-798.mjs`; the record `reads-798-2026-11-04T16-43-10-197Z.{log,json}`), prod by `SELECT`, the pages in headless Chromium at 1440 with `ct_seen=1` and reduced motion, 9:43:10 to 9:43:53 AM MST (16:43:10Z to 16:43:53Z), `/api/version` reading `bd29e97` before the first page and after the last: **64 PASS, 0 FAIL, 2 N/A**, each check against the ruling cited in `docs/probes/798-election-night-run.md`.
- **Read 1:** 383 marked rows in 383 races, one mark each (House 350, Senate 33; R 145, D 238; the incumbent's own row 288, a challenger's 95), 87 unmarked, `general_runoff` 0.
- **Read 2, AL-01** (the first one-mark race, unrated): *Decided · Nov 3, 2026*, *Elected* on Jerry Carl's row alone, *Called by Ballotpedia · read Nov 4, 2026, 8:38 AM MT* (15:38Z), the card's `senate` tag ELECTED TO THE SENATE and no word: 4 PASS, the chips and sources N/A (no rating row). **2b, AL-02** (the first rated one): the incumbent's mark, so no *Elected* row and *re-elected* on the card; the chips at 0.55 under *final call ·*, the three rater chips links, the sources line with each rater's AS OF (Cook 2026-09-29 via Ballotpedia, Inside Elections 2026-09-22 via Ballotpedia, Sabato 2026-10-20 direct): 7 PASS.
- **Read 3, AK-AL** (CO-08 is called, so the first unmarked race): *Not yet called*, *No call on Ballotpedia · read … MT*, no *Elected*: 3 PASS.
- **Read 4, the seven tags,** each against the other race's marks: AL-01 ELECTED TO THE SENATE, S-AL RAN FOR GOVERNOR, GA-13 LOST PRIMARY, IA-02 LOST THE SENATE RACE, S-NH and S-IA RETIRING, FL-25 ELECTED IN FL-20, every card without a word: 14 PASS.
- **Read 5, Louisiana:** LA-01 to LA-04 *Decided · Nov 3, 2026*, no *Elected* row (the winners the incumbents), the cards *re-elected* (12 PASS); **LA-05 *Runoff Dec 12* still on its unmarked Dec 12 box, Firment and Moore *Advanced*, Letlow's card the `senate` tag ELECTED TO THE SENATE** (3 PASS; HO 780's contingency live); LA-06 *Not yet called* (1 PASS), its card *not on the ballot* of Cleo Fields with no tag.
- **Read 6, Georgia:** no two-mark race and no runoff box; S-GA *Decided · Nov 3, 2026*, Ossoff *re-elected*. Recorded.
- **Read 7, the band:** *RESULTS · NOV 3 · 65 of 105 competitive seats called · House R 135 · D 219 · 81 open · Ballotpedia, read Nov 4, 2026, 9:35 AM MT* (16:35Z), equal to `getElectionResults`' own SELECT and to the rehearsal's `bandExpect` against prod: 3 PASS.
- **Read 8, `/electoral`:** SENATE 12 won of 14 (D GAIN 7, D HOLD 4, R HOLD 1), HOUSE 53 won of 91 (D HOLD 28, D GAIN 20, R HOLD 4, D WIN 1), every chip by the marks and the holder's party with its check on the marked name and the raters' bars final, every decided rated race a won row, the head Result, the fold *873 contests · 873 voted* with no NEXT, S-IA's and CO-08's open rows and MAP cards without a Kalshi line beside uncalled controls keeping theirs, the sources line unchanged, no page error: 19 PASS. A first run at 9:36 AM MST (16:36Z) read the House tab through the instrument's own search filter (the oddity); corrected and re-run.

**The close** (`798-artifacts/close-798.mjs`, 9:37:27 to 9:41:50 AM MST, 16:37:27Z to 16:41:50Z): every one-mark race in read 1, the served HTML by `fetch`, no browser, 250 ms apart, `bd29e97` before and after. **383 of 383**: the WATCH line's *Elected on its marked row* reads with HO 750's rule as HO 758 records it (`docs/roadmap.md:3826`, the incumbent never a roster row), so 95 challenger wins read the one *Elected* row and 288 incumbent wins the card's *re-elected*; 0 misses. With read 7's equality, both of the WATCH line's clauses hold.

**The findings.**
- **The six Louisiana boxes could not be compared with Ballotpedia by hand** (backlog, Code): the Chrome extension wasn't connected, a cloud fetch answered an empty HTTP 202 for each page, and the box's honest agent got the same from CloudFront. LA-05's Dec 12 box, two rows equal to its two jungle winners, stood in as the one cross-check. The Dec 12 read has the same step.
- **A Louisiana seat without a `box` read gives its off-ballot incumbent HO 758's word, not HO 779's tag** (backlog, Code, low): LA-05 read *not on the ballot* of Julia Letlow, printed on S-LA's ballot, until its Dec 12 box posted at 1:24 AM MST Nov 4 (08:24Z) (`lib/incumbent-qualifier.ts:132`; `lib/race-result.ts:158`, `:279`).
- **The instrument's search filter** read the House tab as one row on the first run (the oddity); corrected and re-run.
- **Readings:** (a)'s client never dropped (HO 777's 60 s `fetch failed` did not recur); LA-06 was uncalled at 9:35 AM MST (16:35Z); read 2b and read 7's second SELECT are departures named below.

**The ledger.** Reconcile 284 / 361 on 645 at open; the WATCH line's strike makes it 283 / 362 on 645, and the two open loops 285 / 362 on 647. Two commits, both `docs`: the findings file (`docs/probes/798-election-night-run.md`) alone, then this block, the backlog and the oddity. No app code, no SKILL change.

**What's owed after the FF.**
- Docs only, so Production serves the same code: no served-SHA or `e2e-prod` read beyond what the deploy reports on its own.
- Then, in order: HO 799, the GradShow ceremonial probe (Thursday Nov 5; its pre-print re-run Monday Nov 9, Corey's print deadline); the results HO after it (the three odds snapshots committed, *favorites won X of N* for the poster, the `CBT odds snapshots` task unregistered, the CRS meter note).


**What was flagged.**
- **The six-box comparison by hand had no instrument** (above): flagged, not corrected; the run went on because (c)'s row was `success` and not a 400, and LA-05's box gave the one internal check.
- **Read 2b is an addition:** the first one-mark race (AL-01) is unrated, so HO 775's and HO 784's rulings were read on the first rated one-mark race (AL-02).
- **Read 7's instrument:** the handoff names HO 777's `bandExpect`; the band's own SELECT (`getElectionResults`, HO 780/783) was run beside it and the page checked against its own rule. Equal today; they part only on an unmarked Dec 12 box with one jungle winner or a general runoff box.
- **Read 8's first run** (9:36 AM MST, 16:36Z) read the House tab through the instrument's own search filter; the reads were re-run at 9:43 AM MST (16:43Z) as the record, and the first run is kept on file.
- **The WATCH line's *Elected on its marked row*** was read with HO 750's rule (`docs/roadmap.md:3826`): 288 of the 383 are the incumbent's own mark and read *re-elected* on the card.
- **The scripts' departures from the handoff's letter,** each from the night's adversarial review (76 agents, 12 confirmed): a 500 from a route is read back as the catch path's `error` row, not HALTed unread; (a)'s *nothing happened* (no row, or three yields in a row) is a note, not a HALT; the wall test covers `http-403`/`http-429` and any `no-anchor-…` beside a challenge, a WAF and a 202; STEP 0 carves out a tick in flight; the reads and the close stay clear of the tick windows as the calls do. None fired.
- **(a)'s client never dropped:** HO 777's 60 s `fetch failed` did not recur in twelve calls.
- **The clock:** (c) waited 21 minutes for the 9:15–9:35 window, as written.
- **LA-06 reads *not on the ballot* of Cleo Fields with no tag:** the same words the `absent` reason would give, by HO 758's word instead (no `box` read).
- **Also notes now run through HO 798.**

**Also (HO 799), the GradShow poster's ceremonial bills by stage: one statement over `bills`, every table a sum over its cells, read Wednesday Nov 4 at 12:24 PM MST (19:24Z): 177 law-eligible ceremonial bills by stage against the dome's 16,892; 990 ceremonial resolutions; 3 ceremonial laws, 3 of 122 under Pew's Oct 14 cut beside Pew's 12 of 121; 123 post-office titles, 90 tagged ceremonial; ten bills drawn by seed 799 for Corey to eyeball; and the finding that 9,305 of the dome's bills, the May 2026 batch, carry no tag at all. It opens with HO 798's FF go as taken.**
- **What's here:**
  - HO 798's FF go as taken;
  - STEP 0, a check: claims 1 to 7 hold, none a HALT;
  - the clock;
  - A to D, each count with its predicate and its as-of, the controls and the seed;
  - the findings;
  - the ledger;
  - what's owed after the FF;
  - what was flagged.
- **Three commits, kinds unmixed:** `diag` (the sibling `scripts/diagnostic/gradshow-ceremonial-799.ts`, alone), `docs` (the findings file `docs/probes/799-gradshow-ceremonial.md`, alone), `docs` (this block and the backlog). No app code: nothing under `lib/`, `app/`, `components/`; nothing in `scripts/` but the sibling; `gradshow-numbers-787.ts` untouched, its three odds-snapshot runs done and the `CBT odds snapshots` task still registered for the results HO; `docs/probes/odds-snapshots/` left untracked for the same HO. SKILL unchanged: the 787 script isn't in its scripts list (STEP 0's claim 7), and the sibling follows it.
- **No migration and no prod write.** Prod was read by `SELECT` only, through `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN` by name; its schema fingerprint read `4e94644350e1d992` before and after each run. No cron call, no flush, no `UPDATE`.
- **Prod's `rows_read`:** 303,523 over 24 statements in r2, the record, and 269,126 over 21 in r1, every statement's pipeline result carrying the field (`docs/handoffs/799-artifacts/rows-ledger.tsv`); no Congress.gov request.
- **The pointer is 799:** pointer 798 (`docs/roadmap.md:8540`), highest HO in commit subjects 798, `main` at `281c81d`.

**HO 798's FF go, as taken** (`docs/handoffs/798-ff-go.md`, taken up 11:21 AM MST Nov 4, 18:21Z).
- **`main` at `281c81d`:** two docs commits (`35bf214` the findings file, `281c81d` the block, the backlog and the oddity), the second amended twice on the go: once for the two corrected sentences (the Center for Politics message went through centerforpolitics.org's contact form from the CSU address at 2:01 PM MST Nov 1, 21:01Z, as the HO 797 block records, no reply as of Nov 4; the chat's own fetch of LA-05's page at 11:15 AM MST Nov 4, 18:15Z, a stale copy, appended to the six-box loop), once for a UTC twin in its message; `798-review` pushed with lease as `281c81d` at 11:39:56 AM MST (18:39:56Z), then `281c81d:main` with no force, the ref deleted on both sides, local `main` forwarded by `--ff-only`.
- **The gates before the push,** on Node v24.22.2: the cold build SKILL's way (the `.next` junction unlinked first, its target's 24 files confirmed intact from a separate process), `npm run build` 11:40:38 to 11:41:47 AM MST (18:40:38 to 18:41:47Z), exit 0 in 69 s, 0 warning lines; `typecheck` 0 on both projects; `check:odds-sites` OK (190 / 13 / 13); `check:design-citations` OK (1171 scanned, 171 citations, 157 resolved, 4 allowlisted, 0 problems).
- **The push** at 11:42:23 AM MST (18:42:23Z): `bd29e97..281c81d -> main`; `ls-remote` then read `main` alone at `281c81d781c33fb18f7c3a2ba9a5f9ce6399eb29`.
- **The deploy:** Production record `7554678466`, `success` at 11:43:09 AM MST (18:43:09Z), deployment `congressionalterminal-3q7kqxwmh`. Docs only, so no served-SHA or `e2e-prod` read beyond the record; no SKILL change, so no `cbt.zip` rebuild and no manifest row.
- **The Center for Politics:** unanswered as of this morning, Nov 4 (Corey's word in the chat).

**STEP 0, a check** (claims 1 to 7 at `281c81d`, read 12:01 PM MST Nov 4 (19:01Z) for the tree and 12:24 PM MST (19:24Z) for prod; the tree anchors re-derived by the sibling's own greps, `docs/probes/799-gradshow-ceremonial.md`).
- **1 holds:** `main`, `origin/main` and `ls-remote` read `281c81d`, the remote's one head; pointer 798 at `:8540`; highest HO in subjects 798; the tree clean but for `docs/probes/odds-snapshots/`; reconcile 285 / 362 on 647, mis-struck 0.
- **2 holds:** `ALLOWED_STAGES` at `lib/enums.ts:55-62`, the six in order; the HO 239 guard (`decideStage`, `lib/summarize-runner.ts:112-124`) advances forward moves and first observations past introduced, rejects any downgrade to `introduced`, and takes another downgrade only when the same stage is proposed twice running. Prod stores committee 17,993 · enacted 140 · floor 970 · introduced 137 · other_chamber 592: no `other`, no NULL, no `president`, none off the ladder.
- **3 holds:** the tag is written at `lib/summarize-runner.ts:306` (null, 1 or 0) by the UPDATEs at `:323` and `:379`, at `scripts/classify-ceremonial.ts:40-41` (1 or 0), and reset to NULL with the summary at `lib/sync.ts:351`; prod by `typeof` and value reads integer 0 7,825 · integer 1 1,167 · NULL 10,840, nothing else.
- **4 holds:** the dome's scope and predicate as HO 787 read them (`docs/probes/787-gradshow-numbers.md:89`, `:66`).
- **5 (record):** `119-sres-611` is stored `enacted` with `is_ceremonial` NULL (summarized May 11, 2026, 1:18 AM MDT, 07:18Z; no `previous_stage`), so it falls in no A table and A3 doesn't count it.
- **6 holds:** `historical_laws` holds the 118th only (`scripts/migrate.ts:498-500`); prod's `bills` has 32 columns, nine date-like, none an approval date, so B2's cut uses `latest_action_date`.
- **7 (record):** `cal` and `agreed` at `gradshow-numbers-787.ts:248-249`, the usage line at `:1035`; SKILL's list carries `:1387` and `:1389` and not the 787 script.

**The clock.** Run Wednesday Nov 4, a day before the handoff's Thursday, as the chat sent it (the file written 11:54 AM MST, 18:54Z): r1 at 12:09 PM MST (19:09Z), then r2, the record, 12:24:16 to 12:24:21 PM MST (19:24:16 to 19:24:21Z), after `/api/sync` #30573 (11:00:11 AM MST, 18:00:11Z) and `/api/cron/summarize` #30591 (12:20:23 PM MST, 19:20:23Z); the newest `update_date` 10:57:03 AM MST (17:57:03Z), the newest `summary_updated_at` 11:10:26 AM MST (18:10:26Z). `bills` holds 19,832 rows, all the 119th.

**A. Ceremonial by stage** (one `GROUP BY` over `bills` on `bill_type, stage, is_ceremonial, summary IS NOT NULL AS gated, cal, agreed`, `cal` and `agreed` the 787 cube's values copied; 119 cells as of 12:24:20 PM MST, 19:24:20Z; the two controls equal on the first read, A1 + A2 = 17,069 and A1 + A3 = 1,167, every `bill_type` among the eight; no re-read, no HALT).
- **A1, law-eligible and ceremonial: 177.** introduced 1 · committee 154 (46 on a calendar) · floor 7 (none on a calendar) · other_chamber 12 (1) · president 0 · enacted 3; `other` 0, NULL 0.
- **A2, the dome's own predicate: 16,892.** introduced 105 · committee 15,785 (567 on a calendar) · floor 296 (48 on a calendar, HO 787's 65 then) · other_chamber 570 (34) · president 0 · enacted 136; `other` 0, NULL 0. Inside it, **9,305 untagged, every one with a summary**, and 7,587 tagged not ceremonial.
- **A3, the four resolution types and ceremonial: 990** (hres 589, sres 347, hconres 40, sconres 14); at `floor` or later **231** (floor 225, other_chamber 6); with `agreed` set **221**; not the same number, and neither "agreed to". 990 of the 1,167 ceremonial rows can never become law.
- **A4, totals:** ceremonial across all types 1,167 beside HO 787's 969 (+198); law-eligible any tag 17,069 beside 16,303 + A1 = 16,480 (+589; the dome 16,892 beside 16,303, +589); rows held 19,832 beside 19,106 (+726); the dome's enacted 136 beside 119.

**B. Ceremonial laws.** B1: **3**, `119-s-1596` (Jocelyn Nungaray National Wildlife Refuge Act, Public Law 119-30, 2025-07-24), `119-s-2283` (the Oscar J. Upham Post Office, 119-59, 2025-12-18), `119-s-790` (the Barbara L. Cubin National Historic Trails Interpretive Center, 119-117, 2026-09-25), each a *Became Public Law* action. B2, the cut `latest_action_date <= '2026-10-14'` (the proxy, claim 6): **CT 3 of 122** (2.5%; 106 tagged not ceremonial, 13 untagged) beside **Pew's 12 of 121** as of Oct. 14, 2026 (109 substantive; Pew's definition *intended primarily to honor or recognize an individual, group or cause*, its coders not CT's classifier); without the cut 3 of 139; dated after it 17, all tagged not ceremonial, two of them (`119-hr-1744`, `119-hr-8205`) at `enacted` on *Signed by President.* of Nov 3 with no public-law number yet, so their date is the signing date. B3: the reconcile HO hadn't landed, so B1 is re-derived, not cited.

**C. The label's example.** Law-eligible titles naming a post office or a facility of the United States Postal Service: **123**, 90 tagged ceremonial, 1 tagged not (`119-hr-10442`, a signage requirement on the Ronald A. Robinson Post Office, which directs an agency and reads substantive by the prompt's rule), 32 untagged (the May batch's).

**D. Ten for Corey** (seed 799: mulberry32 over the id-sorted list, a Fisher-Yates shuffle, HO 787's method; each list's sha256 in the findings file). At `floor` or later, 22 candidates: `119-s-1596` (enacted), `119-s-567` (floor), `119-hr-9191` (other_chamber, National Fossil Act of 2026), `119-s-2682` (floor), `119-hr-4288` (other_chamber). In `committee`, 154 candidates: `119-hr-8562`, `119-hr-9871`, `119-hr-7313`, `119-hr-10114`, `119-hr-5309`. The tag is reported, not fixed.

**The findings.**
- **The May 2026 batch has no tag:** 9,305 of the dome's 16,892 bills carry `is_ceremonial` NULL with a summary, all summarized in May 2026 by gemini-2.5-flash, while every law-eligible bill summarized since June carries one (the control: 576 · 81 · 1,231 · 1,118 · 1,447 · 3,248 · 63 by month). The summarizer stores NULL when the model's JSON lacks the boolean (`lib/summarize.ts:194-197`), leaving the row to `scripts/classify-ceremonial.ts`, which hasn't been run over them. So the hollow dots can mark the 177 tagged, and the May batch's share is unknown (about 210 at the tagged rows' 2.3%). A backfill run is a prod write and the chat's call; filed here, in the findings file and, on the FF go, as its own OPEN LOOPS line (backlog `:83`, Corey's, dated before Monday Nov 9).
- Two laws signed Nov 3 carry no public-law number yet (`119-hr-1744`, `119-hr-8205`): their date is the signing date until Congress.gov posts the law action.
- No bill sits at `president` in either scope (HO 787 read 6).
- The dome's calendar rows kept at `floor` are 48 today (HO 787's 65); A1 has none at `floor`.
- `119-sres-611` is untagged and still at `enacted` by the old model (HO 787's backlog line stands).
- CT's 122 laws under Pew's cut against Pew's 121, 13 of them untagged, so CT's 3 of 122 is a floor, not a comparison.

**The ledger.** Two read-only runs, the fingerprint `4e94644350e1d992` before and after each: r1 (21 statements, 269,126 `rows_read`) and r2, the record (24 statements, 303,523); 572,649 in all, about 0.02% of the plan's 2.5B a month. `.env`'s `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN` by name; nothing else read, nothing written.

**What's owed after the FF.**
- No app code, so Production serves the same code: no served-SHA or `e2e-prod` read beyond what the deploy reports on its own.
- **Monday Nov 9, before the poster prints:** `npx tsx scripts/diagnostic/gradshow-ceremonial-799.ts --label print` once more, read-only, its as-of pasted to the chat and to the poster chat, no commit unless a figure the poster carries has moved (the backlog line, Corey's).
- Then the results HO: the three odds snapshots committed, *favorites won X of N* for the poster, the `CBT odds snapshots` task unregistered, the CRS meter note, the Sabato refusals, and the six-box loop's hand route rehearsed before Dec 12.
- The May batch's tag: Corey's call, in the chat (the backfill classifier over 10,840 untagged rows, a prod write); its OPEN LOOPS line, backlog `:83`, added on the FF go, dated before Monday Nov 9.

**What was flagged.**
- Run Wednesday Nov 4, not the handoff's Thursday, as the chat sent it; the backlog note the handoff words as *HO 799 (2026-11-05) … no reply as of Nov 5* is dated 2026-11-04 with *no reply as of Nov 4*, the day it was read.
- Two reads beyond A to D (the untagged rows by month, with the tagged rows as the control; the laws dated after the cut), evidence for the findings; A's tables stay sums over the one statement.
- Two runs, r2 the record, every shared figure equal; a read-only review of the script before the record run (an adversarial workflow, 15 agents) confirmed nothing, and three of its nits were taken anyway (the B2 numerator's NULL-date semantics, the precondition's wording, B3 worded as dated).
- The handoff fixed the backlog to one line, so the May batch's tag had no line of its own at the review push (reconcile 286 / 362 on 648); the FF go added one after `:82`, and the reconcile reads 287 / 362 on 649.
- **Also notes now run through HO 799.**

**Also (HO 800), the May 2026 batch gets its ceremonial tag, by Corey's ruling: the standing backfill classifier (`npm run classify-ceremonial`, gemini-2.5-flash on each bill's title and latest action) over the rows reading `is_ceremonial` NULL, with the two things it lacked, a pilot and a record of exactly which rows it wrote. The NULL ids were snapshotted first (10,840, the reversal list), a 200-row pilot ran clean, and with the full run 9,720 of the 10,840 were tagged before the project's gemini-2.5-flash quota (10,000 requests a day, Tier 1) began refusing at 3:09:47 PM MST; 1,120 rows (1,105 refused, 15 parse-fails) wait for its reset at 1:00 AM MST Nov 5, an OPEN LOOPS line. HO 799's table re-read: the hollow dots 177 → 383, the dome's untagged 9,305 → 534, the ceremonial laws 3 → 7 of 122 under Pew's cut.**
- **What's here:**
  - HO 799's FF go as taken;
  - the ruling;
  - STEP 0, a check: claims 1 to 6 hold, none a HALT (claim 3 for every live path, its letter missing one dormant writer, named);
  - § 1, the script and its review;
  - § 2, the snapshot, the reversal list;
  - § 3, the pilot;
  - § 4, the full run and the flush;
  - prod before and after;
  - § 5, HO 799's script re-read, with the deltas;
  - the cost and the ledger;
  - the reversal statement;
  - what's owed after the FF;
  - what was flagged.
- **Three commits, kinds unmixed:** `feat` (`scripts/classify-ceremonial.ts`, alone), `docs` (HO 799's findings file gains its after-section, this block and the backlog), `docs(skill)` (one sentence after SKILL's backfill paragraph, alone and last). No app code: nothing under `lib/`, `app/`, `components/`; `gradshow-numbers-787.ts` and `gradshow-ceremonial-799.ts` untouched.
- **The one prod write was the script's `UPDATE bills SET is_ceremonial = ? WHERE id = ?`,** on rows that read NULL when each run fetched them; **the one flush was the `bills` tag,** by hand on Production. No migration, no cron call, no hand `UPDATE`, no reversal run. Prod's schema fingerprint read `4e94644350e1d992` before and after every read.
- **The pointer is 800:** pointer 799 (`docs/roadmap.md:8608`), highest HO in commit subjects 799, `main` at `a953adc`.

**HO 799's FF go, as taken** (`docs/handoffs/799-ff-go.md`, 12:43 to 12:47 PM MST Nov 4, 19:43 to 19:47Z).
- **`main` at `a953adc`:** three commits on `281c81d`, `ad6e0af` (diag), `31ff69c` (docs, the findings file) and `a953adc` (docs, the block and the backlog), the third amended once on the go (`a649e3f` → `a953adc`) for the May batch's OPEN LOOPS line; no force on `main`; `799-review` deleted on both sides.
- **The gates before the push,** on Node v24.22.2: the cold build SKILL's way, exit 0 in 31 s, 0 warning lines; `typecheck` 0 on both projects; `check:odds-sites` and `check:design-citations` OK.
- **The push** at 12:44:59 PM MST (19:44:59Z): `281c81d..a953adc -> main`, no force; `ls-remote` then read `main` alone.
- **The deploy:** Production record `7556084827`, `success` at 12:45:47 PM MST (19:45:47Z), deployment `congressionalterminal-chc18tx8i`. A diagnostic script and docs, so no served-SHA or `e2e-prod` read beyond the record; no SKILL change, so no `cbt.zip` rebuild.

**The ruling.** Corey, Nov 4, 1:54 PM MST (20:54Z), as the handoff carries it: *"backfill"*. So backlog `:83` closes on its first branch: the batch tagged by a run with its NULL-id list snapshotted first, and the HO 799 script re-read.

**STEP 0, a check** (claims 1 to 6 at `a953adc`: the tree before § 1's first edit, prod at 2:23:40 to 2:23:44 PM MST Nov 4, 21:23:40 to 21:23:44Z).
- **1 holds:** `main`, `origin/main` and `ls-remote` read `a953adc`, the remote's one head; pointer 799 at `:8608`; highest HO in subjects 799; the tree clean but for `docs/probes/odds-snapshots/`; reconcile 287 / 362 on 649, mis-struck 0; the May batch's line at `docs/backlog.md:83`, the re-run's at `:82`.
- **2 holds:** at `a953adc`, `CONCURRENCY = 10` (`scripts/classify-ceremonial.ts:6`); `fetchRows` the bare `SELECT id, title, latest_action_text FROM bills WHERE is_ceremonial IS NULL`, no ORDER BY, no LIMIT (`:17`); a parse failure counted and left NULL (`:33-36`); the one write `UPDATE bills SET is_ceremonial = ? WHERE id = ?` (`:40-41`); an error counted and left NULL (`:44-47`); `revalidateBillsCache` POSTs `REVALIDATE_URL` with the bearer and skips with a hint when either is unset (`:80-102`); `GEMINI_API_KEY` required (`:105`); the entry `package.json:18`.
- **3 holds for every live path; its letter misses one dormant writer.** `lib/classify-ceremonial.ts` as claimed (`CLASSIFIER_MODEL = "gemini-2.5-flash"` at `:3`, `thinkingBudget: 0` at `:54`, the prompt the title and the latest action, a boolean `is_ceremonial` or `null`). The column's live writers are the summarizer (`lib/summarize-runner.ts:305-306`, through the UPDATEs at `:323` and `:379`), the sync's reset to NULL with the summary (`lib/sync.ts:351`) and this script. *No other path writes it* misses `scripts/diagnostic/crs-catchup-794.ts --reset`, HO 794's pass, whose `RESET_SQL` (`:71`) nulls the tag with the summary as the sync's reset does: it runs only when typed, ran once (Oct 28) and has no schedule, and its effect is the sync's class, which this HO's accounting separates; read as no HALT, flagged. Two leg harnesses write the column on `file:` copies only (`crs-catchup-794.ts:355`, `sync-frontier-790.ts:683`).
- **4 holds:** prod by `typeof` and value reads integer 0 7,825 · integer 1 1,167 · NULL 10,840, nothing else; the NULL rows 10,840 exactly, HO 799's figure (delta 0): law-eligible 9,305 and resolutions 1,535, every one with a summary (0 without); the summarizer's last write 11:10:26 AM MST (18:10:26Z), none in the hour before the read.
- **5 holds, and `REVALIDATE_URL` names a local port, not Production.** `.env` carries `GEMINI_API_KEY`, `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`, `CRON_SECRET` and `REVALIDATE_URL`, read by name; `REVALIDATE_URL` parses to a local address (the instrument's list of loopback and unspecified hosts) with an explicit port, not `https`, path `/api/revalidate`, no query (read as booleans, the value never printed; `docs/handoffs/800-artifacts/step0-env.out`). So the run's end-of-run POST could reach nothing, and § 4 flushed Production by hand.
- **6 holds:** SKILL `:2092` the backfill paragraph (concurrency 10, idempotent via `WHERE is_ceremonial IS NULL`, ~30 min, under $1, the `REVALIDATE_URL` POST), `:145` the tri-state; the findings file's *The table, for the poster chat* at `:7`, *Findings* at `:170`, *The ledger* at `:188`.

**§ 1, the script** (`feat`, before any row was written).
- **The four flags:** `--limit N` (`fetchRows` orders by id always, `LIMIT ?` when given), `--concurrency N` (default 10), `--label L` (the per-row log `docs/handoffs/800-artifacts/classify-<L>.log`, `<id>\t<1|0|parse-fail|error>\t<ISO time>` as each row is decided, appended; at the end a tally by `bill_type`, printed and appended as `#` lines, the 429s counted apart) and `--no-revalidate`.
- **A plain run is unchanged but for the id order:** on a local `file:` test DB (six seeded rows, four NULL) its output matched `a953adc`'s line for line (the elapsed time masked) and the rows it wrote were the same; `typecheck` 0 on both projects.
- **Beyond the four, flagged.** In a labelled run only: every line the script prints and every line of its log passes `scrub()` (`redactSecrets`, then `REVALIDATE_URL` and `TURSO_DATABASE_URL` by name, which `lib/redact.ts` leaves alone by design); the revalidate line names `$REVALIDATE_URL` and records the status and body, or the failure's code; an UPDATE that reports an error appends `# update-error` with the value it carried; the tally carries the tokens each response reports (`usageMetadata`, through a wrapper on the client the script passes in; `lib/` untouched), so the cost comes off the log. In every run with arguments, labelled or not: an unknown argument, or a `--label` value starting with `-`, is refused before any read (a bare plain run is unaffected). The tally reads `bill_type` off the id (`lib/sync.ts:149`), so the SELECT keeps its standing column list, which `gradshow-ceremonial-799.ts:431` greps; at the snapshot the id's type equalled the column on all 19,832 rows.
- **Reviewed before the first prod write:** three independent lenses (write safety, the spec, secrets) raised 25 findings; a skeptic read each of the 12 ranked highest (15 agents) and confirmed all 12 in substance, none of them in the UPDATE. The 13 lower-ranked went unverified, one of them on the UPDATE itself, the spec's fixed statement, which re-checks neither `is_ceremonial IS NULL` nor `rowsAffected`. Taken: the outcome settled and logged once after the try, the update-error line, the `--label` guard, the body scrubbed before it's cut, `bill_type` read off the id (the reviewed SELECT had added the column, which broke the 799 script's anchor), two comments made true and one added. The local test bed (a local `file:` test DB, a dummy Turso token, a stand-in revalidate route) re-run on the final file: the limit, the outcomes 1, 0 and error (parse-fail not exercised there; the full run met it 15 times), an update-phase error, a bad port, a refused port, 200, 401, the refused `--label`, and the plain run.

**§ 2, the snapshot** (2:51:41 PM MST Nov 4, 21:51:41Z, read-only). `SELECT id, bill_type, (summary IS NOT NULL) AS gated FROM bills WHERE is_ceremonial IS NULL ORDER BY id` → `docs/handoffs/800-artifacts/null-ids-before.tsv` (repo-ignored): **10,840 rows**, sha256 `63af0e4e5b120d0bbc1ddcd9b1afe540036535d1d5d18099d2202a2ac418d17a` (the id list's `912079a27a46ec15`); hconres 47, hjres 129, hr 5,792, hres 902, s 3,249, sconres 19, sjres 135, sres 567, every one gated, every one summarized in 2026-05. Beyond the letter, every row's tag, gate and `summary_updated_at` (`tags-before.tsv`, 19,832 rows, 2:51:44 PM MST), so a change outside the NULL set shows too; its NULL set equalled the snapshot's.

**§ 3, the pilot** (`npm run classify-ceremonial -- --limit 200 --label pilot --no-revalidate`, 2:52:08 to 2:52:30 PM MST, 21:52:08 to 21:52:30Z, 22.3 s at concurrency 10).
- **Its makeup, by id order:** `119-hconres-15` to `119-hr-1029`, hconres 47, hjres 129, hr 24, and no `s`, `sjres`, `hres`, `sres` or `sconres` row, since the ids sort by type first. So the resolution floor read hconres alone, whose tagged share was 51.3% beside 80.6% for all resolutions. The handoff's letter; named, not changed.
- **The tally:** 200 seen, 200 ok, 0 parse-fail, 0 error, 0 429s. No HALT.
- **The shares:** law-eligible 17 of 153 tagged 1, 11.1%, under the 15% ceiling (hjres 15 of 129, 11.6%, beside the tagged hjres' 2 of 92; hr 2 of 24); resolutions 34 of 47, 72.3%, over the 40% floor. No HALT.
- **Prod after:** NULL 10,640, down by the 200 ok exactly; all 200 written by the run and unchanged since; no row outside the log changed, no new row, nothing summarized in between.
- **For Corey's eye** (seed 800, as HO 799 drew; the lists' sha256 `955201e1419457de` for the 17 tagged 1, `89e2df983727d584` for the 136 tagged 0). Tagged 1: `119-hjres-32` (National School Counseling Week, 2025), `119-hr-1014` (the Specialist Joey Lenz Act of 2025), `119-hjres-116` (honoring the thirteen killed at Abbey Gate), `119-hjres-19` (the Vietnam veterans' apology), `119-hjres-113` (Original Slavery Remembrance Day), `119-hjres-148` (National School Counseling Week, 2026), `119-hjres-132` (Head Start Awareness Month), `119-hr-1025` (the Cooper Dawson Post Office Building), `119-hjres-138` (National Desert Day), `119-hjres-118` (the Day of the Bible). Tagged 0: `119-hjres-109` (a D.C. Council disapproval), `119-hr-1007` (the Antisemitism Awareness Act of 2025), `119-hjres-147` (ending the Brazil tariff emergency), `119-hjres-171`, `119-hjres-39`, `119-hjres-45` and `119-hjres-180` (CRA disapprovals), `119-hjres-121`, `119-hjres-141` and `119-hjres-159` (constitutional amendments). Beyond the letter, the other seven tagged 1, since the share is five times the corpus's: `119-hjres-149` (the Army Nurse Corps' 125th), `119-hjres-98` (Life Month), `119-hjres-67` (Original Slavery Remembrance Month), `119-hjres-95` (SOF Week), `119-hjres-158` (encouraging Veterans Tax Relief Weekends), `119-hjres-77` (a policy recognizing Ukraine's sovereignty, which the prompt's *sets policy* reads substantive) and `119-hjres-136` (amending title 36 to direct a Democracy Day proclamation).

**§ 4, the full run** (`npm run classify-ceremonial -- --label full`, 2:53:53 to 3:09:56 PM MST, 21:53:53 to 22:09:56Z, 963 s at concurrency 10).
- **The tally:** 10,640 seen, 9,520 ok (tagged 1 848, tagged 0 8,672), 15 parse-fail, **1,105 errors, every one a 429** in the classify phase, none in the UPDATE. By type: hr 5,768 seen, 5,759 ok (155 · 5,604), 9 parse-fail; hres 902, all ok (659 · 243); s 3,249, 2,859 ok (34 · 2,825), 6 parse-fail, 384 refused; sconres 19, sjres 135 and sres 567, all refused.
- **The 429s were a daily quota, not a rate.** From `119-s-487` at 3:09:47 PM MST (22:09:47Z) requests began to be refused, `RESOURCE_EXHAUSTED`, *Generate content requests per day limit exceeded on Tier 1* (`GenerateRequestsPerDayPerProjectPerModel`, gemini-2.5-flash, `quotaValue` 10000), *Please retry in 9h50m* (`retryDelay` 35412 s): the project's 10,000 a day, which the backfill's 9,735 answered requests (the pilot's 200 among them) and the day's other calls had used. For about four seconds refusals and answers mixed (27 answers landed after the first refusal, 21 of them on rows past it in id order, the last `119-s-909` at 3:09:51 PM MST, 22:09:51Z); then every request was refused, 1,105 of the 1,126 rows from `119-s-487` on. No 429 came before that row in id order, and none in the pilot.
- **§ 4's storm rule** (more than 5% of a run; 1,105 of 10,640 is 10.4%) **was applied as a measurement:** at 3:12:40 PM MST (22:12:40Z), three minutes on, a 5-row resume at concurrency 5 (`--limit 5 --label full-r1 --concurrency 5 --no-revalidate`) read 5 of 5 refused, *Please retry in 9h47m18s* on the console (the log keeps the tally, not the message). So the full resume at concurrency 5, and the 2% rule's re-run over the remainder (`--label full-2`), wait for the quota's reset at midnight Pacific, 1:00 AM MST Nov 5 (08:00Z): recorded as the residue, with its OPEN LOOPS line.
- **The run's own POST** went to `$REVALIDATE_URL` and failed, `fetch failed (ECONNREFUSED)`, as claim 5 predicted: nothing listened at its port (the bind check at 2:53:39 PM MST, 21:53:39Z, read `ECONNREFUSED` on both loopbacks on the console; re-read and kept at 3:32:19 PM MST, 22:32:19Z, `bind-check.out`).
- **The flush, by hand, once:** `POST https://congressional-terminal-chi-silk.vercel.app/api/revalidate?tag=bills`, Bearer `$CRON_SECRET` read from `.env` by name inside a Node script, no redirect followed: **200 in 545 ms, `{"ok":true,"tag":"bills"}`**, sent 3:13:01 PM MST (22:13:01Z).
- **The eye** (seed 800, over the full run's law-eligible rows). Tagged 1 (189 candidates, the list's sha256 `e2c171b0f14f3a03`): `119-hr-3531` (the Sergeant Alfredo ‘Freddy’ Gonzalez Congressional Gold Medal Act), `119-hr-7915` (the Clarence Mitchell, Jr. Statue Act), `119-hr-8282` (the Rabbi Michoel Ber Weissmandl Congressional Gold Medal Act of 2026), `119-hr-1310` (the POSTAL Act), `119-hr-5787` (the BALL Act), `119-hr-5510` (the United States–Mexican War Memorial Act of 2025), `119-hr-4677` (the Mayor Jerry H. Hodge Post Office Building), `119-hr-6198` (the Rear Admiral Alene Duerk Ship Renaming Act of 2025), `119-s-218` (Oswaldo Paya Way in Washington), `119-hr-2336` (the Doris Miller Congressional Gold Medal Act); the two acronym titles are for Corey's eye. Tagged 0 (8,429 candidates, `84c8c520daeea4a2`): `119-hr-4545` (Medicare breast reconstruction), `119-hr-765` (the MAILS Act), `119-hr-8627` (the Petfax Act of 2026), `119-hr-3462` (They’re Fast, We’re Furious Act of 2025), `119-s-1294` (the Federal Firearm Licensee Act), `119-s-3595` (the No War with Venezuela Act of 2026), `119-s-1333` (child exploitation enforcement), `119-hr-7865` (the American Consumer Tariff Rebate Act of 2026), `119-s-909` (La Paz County solar energy), `119-hr-8143` (lower-cost medicines for seniors).
- **The post-office check** over the pilot and the full run: of the 123 law-eligible titles naming a post office or a USPS facility, the backfill tagged 27 ceremonial and 4 not, each of the 4 substantive by its title, as HO 799's `119-hr-10442` is: two direct the Postal Service (`119-hr-3958`, notice when a post office suspends operations; `119-hr-6523`, a post office established in Mountain House, California), one transfers land to it for a post office's construction (`119-hr-4716`), and `119-hr-287` is the Mobile Post Office Relief Act, an act's name alone, for Corey's eye.

**Prod before and after** (`bills` 19,832 rows throughout).
- **Before** (2:51:44 PM MST, 21:51:44Z): law-eligible 0 7,587 · 1 177 · NULL 9,305; resolutions 0 238 · 1 990 · NULL 1,535.
- **After the pilot** (2:52:52 PM MST, 21:52:52Z): NULL 10,640, the 200 accounted for.
- **After the full run** (3:13:08 PM MST, 22:13:08Z): law-eligible 0 16,152 · 1 383 · NULL 534; resolutions 0 494 · 1 1,683 · NULL 586. **NULL 1,120**, down 9,720, the logs' ok rows exactly: every one written by the run and unchanged since, none summarized in between, no row outside the snapshot's NULL set changed, no row new or reset. Newly tagged: law-eligible 1 206 · 0 8,565 (1 is 2.3%), resolutions 1 693 · 0 256 (73.0%).
- **The residue, 1,120:** the 1,105 refused and the 15 parse-fails (`119-hr-1481`, `-1536`, `-1712`, `-3722`, `-4561`, `-5696`, `-5725`, `-6971`, `-7750`; `119-s-1620`, `-2010`, `-2108`, `-2238`, `-2883`, `-2925`); by type sres 567, s 390, sjres 135, sconres 19, hr 9.
- **The summarizer** calls the same model, so if Production's key is in the same project it shares the quota until 1:00 AM MST: at 3:12 PM MST (22:12Z) its queue was empty (`summary IS NULL` 0), nothing had failed since 3:09 PM, and its 3:00 and 3:10 PM ticks (#30623, #30624) summarized 0 and failed 0.

**§ 5, HO 799's script re-read** (`npx tsx scripts/diagnostic/gradshow-ceremonial-799.ts --label 800`, 3:13:52 to 3:13:54 PM MST, 22:13:52 to 22:13:54Z, read-only; the table and its deltas are a new section of the findings file, *After HO 800's backfill*, before its *Findings*; no sync and no summary between the two reads).
- **A1, the hollow dots: 383** (HO 799's 177, +206): introduced 1 · committee 353 (+199; 49 on a calendar) · floor 8 (+1) · other_chamber 14 (+2) · president 0 · enacted 7 (+4).
- **A2, the dome: 16,686** (16,892, −206): 16,152 tagged not ceremonial (+8,565) and **534 untagged** (9,305, −8,771), the residue's law-eligible rows.
- **A3, ceremonial resolutions: 1,683** (990, +693: hres +659, hconres +34; sres and sconres unchanged, in the residue); at `floor` or later 254 (+23); `agreed` 244 (+23).
- **A4:** ceremonial across all types 2,066 (+899); law-eligible any tag 17,069 (0); the two controls equal on the first read.
- **B: 7 ceremonial laws, 7 of 122 under Pew's cut** (3 of 122, +4), every one of the 122 now tagged: up toward Pew's 12 of 121 and still short of it. The four: `119-hr-2170` (the Leonard G. "Bud" Lomell VA Clinic, Public Law 119-35), `119-hr-452` (the Miracle on Ice Congressional Gold Medal, 119-53), `119-s-4138` (a posthumous honorary promotion's notice waived, 119-80) and `119-hr-7194` (the Nicholas Dockery Medal of Honor Act, Private Law 119-2, which B flags). Without the cut 7 of 139.
- **C:** of the 123 post-office titles, 117 ceremonial, 5 not, 1 untagged (90, 1, 32): the 32 resolved but one, in the residue.
- **D:** seed 799 over lists of 29 at `floor` or later (22) and 353 in committee (154), so the draws move (`docs/handoffs/799-artifacts/run-800.log`).

**The cost and the ledger.**
- **Gemini, as the logs give it:** the pilot 37,588 tokens in and 1,938 out over 200 responses; the full run 1,640,325 in and 94,149 out over 9,535; 1,677,913 in and 96,087 out in all, no thinking tokens. About **$0.74** at gemini-2.5-flash's paid list price ($0.30 a million in, $2.50 out; the bill is Google's and isn't read here). The 1,110 refused requests returned no usage; the § 1 test bed's 28 calls on the real key are in neither log.
- **Turso:** the backfill's 9,720 one-row UPDATEs by primary key and its three NULL-set reads, not tapped; this HO's read-only reads (STEP 0, the shares, the snapshot, the after-reads, the draws, the summarizer, the post-office check) 38 statements and 251,037 `rows_read` (`docs/handoffs/800-artifacts/rows-ledger.tsv`), and § 5's 24 and 314,347 (`docs/handoffs/799-artifacts/rows-ledger.tsv`): 565,384 in all, the fingerprint unchanged throughout.

**The reversal statement** (not run): `UPDATE bills SET is_ceremonial = NULL WHERE id IN (…)` over the ids of `docs/handoffs/800-artifacts/null-ids-before.tsv` (10,840, in batches), which restores the column to its state at 2:51:41 PM MST Nov 4, except on rows the summarizer or a sync touched since, which carry a `summary_updated_at` after the snapshot or a NULL summary and the run logs (`classify-pilot.log`, `classify-full.log`, `classify-full-r1.log`) tell apart; guarded, `… AND (summary_updated_at IS NULL OR summary_updated_at <= '2026-11-04T21:51:41.861Z')`, the snapshot's as-of to the millisecond, as the column stores it. The list lives on this box only (`docs/handoffs/` is repo-ignored).

**What's owed after the FF.**
- No app code, so Production serves the same code: no served-SHA or `e2e-prod` read beyond what the deploy reports on its own. The `docs(skill)` commit means the chat rebuilds `cbt.zip`, held until after GradShow.
- **The residue's resume, after 1:00 AM MST Nov 5 and before Monday Nov 9** (its OPEN LOOPS line): `npm run classify-ceremonial -- --label full-2 --concurrency 5`, Production's flush by hand once, then the HO 799 script re-read.
- **Monday Nov 9, before the poster prints:** the HO 799 script `--label print`, read-only (backlog `:82`, which stands).
- Then the results HO (the three odds snapshots, *favorites won X of N*, the task unregistered, the CRS meter note, the Sabato refusals).

**What was flagged.**
- **The day's request quota, which the handoff's estimate didn't carry:** it priced tokens and dollars, and the project's Tier 1 cap is 10,000 gemini-2.5-flash requests a Pacific day, so 10,840 rows can't fit one day's 10,000 even before the summarizer's calls. The backfill took 9,735 answers (the pilot's 200 and the full run's 9,535); the residue waits for the reset.
- **§ 4's storm rule, applied as a measurement:** a 5-row resume at concurrency 5 three minutes on rather than the full one, since the API's own `retryDelay` was 9h50m and a full resume could only be refused; the 2% rule's `full-2` waits for the reset with it.
- **The backlog:** `:83` struck, as the handoff says, and one OPEN LOOPS line for the residue, as it says for a residue above 2% (1,120 of 10,840, 10.3%), so the reconcile reads 287 / 363 on 650, not the handoff's 286 / 363 on 649.
- **STEP 0's claim 3, its letter:** `crs-catchup-794.ts --reset` also writes the column (dormant, the sync's class); read as no HALT.
- **The pilot's makeup** by the handoff's id order (hconres, hjres and hr only), and its hjres share of 11.6% beside the tagged hjres' 2.2%, under the ceiling; the titles are for Corey's eye.
- **§ 1's additions beyond the four flags:** `scrub()`, the token tally and the update-error line in a labelled run only; the strict argument parser in every run with arguments; `bill_type` read off the id; the review's fixes taken.
- **Reads beyond the letter:** the whole column's state at the snapshot (`tags-before.tsv`), the tagged shares by type before the pilot, the pilot's other seven 1s, and the summarizer's state after the quota ran out.
- **SKILL's sentence, read against the tree and the run:** the per-row log's directory is `docs/handoffs/800-artifacts/`, fixed in the script (the handoff's text said `<ho>-artifacts/`), and the batch was tagged but for its residue, which the sentence names: 1,105 refused by the quota and 15 parse-fails.
- **Also notes now run through HO 800.**

**Also (HO 801), the results HO.** The May batch's residue was tagged after Gemini's quota reset: of HO 800's 10,840 NULL rows, 5 parse-fails are left. The three election odds snapshots are committed, and the poster's *favorites won X of N* is read off them: **Kalshi's favorites won 60 of 67** rated races called by 11:24 PM MST Nov 4, Polymarket's 11 of 12. The `CBT odds snapshots` task is unregistered, and the ledger's dated notes are written (Monday's three runs, Sabato refused Nov 4, the CRS meter). Read along the way: the quota is Production's too, and the news ingest re-calls an article whose match failed on every tick.
- **What's here:**
  - HO 800's FF go as taken, and the quota's reach into Production;
  - STEP 0, a check: claims 1 to 8 hold, none a HALT;
  - § 1, the residue: the tally, the flush, prod after, the re-read, the eye;
  - § 2, the odds: the script, the counts, the matching rule and the reading taken, the hand list, the two books, the drift, the as-of, the controls, the checks;
  - § 3, the task;
  - § 4, the notes, and what the news ticks did with the calls the quota refused;
  - the ledger;
  - what's owed after the FF;
  - what was flagged.
- **Five commits, kinds unmixed:**
  - `diag`: `scripts/diagnostic/odds-results-801.ts`, alone.
  - `docs`: the three snapshot files, by explicit pathspec; the two Nov 1 test files stay untracked.
  - `docs`: the odds findings file `docs/probes/801-odds-results.md`, and the HO 799 findings file's second reading.
  - `docs`: this block, the backlog and the oddity.
  - `docs(skill)`: alone and last.
  - No app code: nothing under `lib/`, `app/`, `components/`; `gradshow-numbers-787.ts`, `gradshow-ceremonial-799.ts` and `classify-ceremonial.ts` untouched.
- **The one prod write was § 1's run of the standing UPDATE on rows reading NULL; the one flush was the `bills` tag,** by hand on Production. Everything else was `SELECT`, the schema fingerprint `4e94644350e1d992` before and after every read. One thing changed on the box: the scheduled task, unregistered.
- **The pointer is 801:** pointer 800 (`docs/roadmap.md:8706`), highest HO in commit subjects 800, `main` at `5e6a040`.

**HO 800's FF go, as taken** (`docs/handoffs/800-ff-go.md`, 4:35 to 4:38 PM MST Nov 4, 23:35 to 23:38Z).
- **`main` at `5e6a040`:** three commits on `a953adc`: `656235a` (feat, `scripts/classify-ceremonial.ts`), `2b8a0c9` (docs, the HO 799 findings file's after-section, the block and the backlog), `5e6a040` (docs(skill)). No force; `800-review` deleted on both sides.
- **The gates before the push,** on Node v24.22.2:
  - the cold build SKILL's way (the `.next` junction unlinked first, its target's 24 files confirmed intact from a separate process), exit 0 in 30 s, 0 warning lines;
  - `typecheck` 0 on both projects;
  - `check:odds-sites` and `check:design-citations` OK.
- **The push** at 4:36 PM MST Nov 4 (23:36Z): `a953adc..5e6a040 -> main`, no force; `ls-remote` then read `main` alone.
- **The deploy:** Production record `7560834813`, `success` at 4:37:16 PM MST (23:37:16Z), deployment `congressionalterminal-bh2muzxto`. A script and docs, so no served-SHA or `e2e-prod` read.
- **The quota's reach into Production,** read by `SELECT` on `cron_runs` at 4:37 PM MST:
  - The news cron's 3:30 and 4:00 PM MST ticks (#30628, #30632) refused 6 of 6 and 11 of 11 Gemini calls on the same 10,000-a-day limit (*retry in 9h29m*, *8h59m*), and the 4:30 PM tick (#30636) made 15 of 15.
  - The nine summarize ticks from 3:10 to 4:30 PM summarized 0 with an empty queue; `summary IS NULL` read 0.
  - So Production's `GEMINI_API_KEY` shares the box's project and quota, and nothing was stamped.

**STEP 0, a check** (claims 1 to 8 at `5e6a040`: the tree and prod read 6:28 to 6:39 PM MST Nov 4, 01:28 to 01:39Z Nov 5; claim 2 read again at 1:01 AM MST Nov 5, 08:01Z, and claim 5 at 1:07 AM, before each was acted on).
- **1 holds:** `main`, `origin/main` and `ls-remote` read `5e6a040`, the remote's one head; pointer 800 at `:8706`; highest HO in subjects 800; the tree clean but for `docs/probes/odds-snapshots/`; reconcile 287 / 363 on 650, mis-struck 0; `:84` the residue, `:82` the Monday re-run, `:50` Sabato's reader, `:19` the struck CRS line.
- **2 holds:**
  - `is_ceremonial IS NULL` reads **1,120** (sres 567, s 390, sjres 135, sconres 19, hr 9), every one with a summary, delta 0 from 3:13 PM MST Nov 4, and the same at 1:01 AM.
  - The tag's values are 0, 1 or NULL and nothing else; `summary IS NULL` reads 0.
  - The summarizer wrote 12 summaries at 5:10 PM MST Nov 4 and was stamping nothing.
- **3 holds:** `docs/probes/odds-snapshots/` holds the five files: the two Nov 1 tests at 193,122 bytes each, and the three snapshots with the claimed `taken_at` (04:30:20Z, 14:30:09Z, 22:30:03Z Nov 3), heads (`b9a1e7a`, `b9a1e7a`, `bd29e97`) and keys; the last reads `kalshi_odds` 469, `polymarket_odds` 34, `rated_index.N` 105.
- **4 holds:** the rows carry the claimed fields, and more (`kalshi_odds` one row per race, all 105 rated races among them; `polymarket_odds` 14 of them); `rated_index` rows `race_id, chamber, kalshi, polymarket`; `general_ballot` has `race_id, name, party, marked` (SKILL `:1181-1195`); 386 races decided by one mark at 6:35 PM MST Nov 4.
- **5 holds, twice:** `CBT odds snapshots` exists, `Ready`, three one-time triggers (9:30 PM MST Nov 2, 7:30 AM and 3:30 PM MST Nov 3), all past, no repetition; `LastRunTime` 3:30 PM MST Nov 3, `LastTaskResult` 0, no next run, `NumberOfMissedRuns` 0. Read at 6:30 PM MST Nov 4 and again at 1:07:28 AM MST Nov 5. `CBT Sabato daily read` exists and wasn't touched.
- **6 (record):** `sabato-rating-changes-2026-11-04.challenge.html` (5,497 bytes) and `.headers.txt` at 5:00 PM MST (00:00:02Z Nov 5): `403`, `Cf-Mitigated: challenge`, the edge DEN, `cf-ray a557936f8e361f24-DEN`.
- **7 holds:** a failed match is stored tagged `llm_error` (`lib/news-ingest.ts:306`), and `skipLlm` holds only without that tag (`:258`), so a later tick re-calls it. The tag itself never clears: `storeObservation` writes tags once (`lib/news-to-observation.ts:265-273`).
- **8 holds:** SKILL `:2092-2093`, the backfill paragraph and HO 800's sentence (*all but 1,120 rows*); the scripts list carries `late-index-791.ts` (`:1387`) and the rehearsal (`:1389`), not the 787 or 799 scripts.

**§ 1, the residue.**
- **The run:** `npm run classify-ceremonial -- --label full-2 --concurrency 5`, 1:02:23 to 1:05:16 AM MST Nov 5 (08:02:23 to 08:05:16Z), 172.8 s. The first 20 rows were answered, not refused, so the reset had come.
- **The tally** (`docs/handoffs/800-artifacts/classify-full-2.log`): 1,120 seen, **1,115 ok** (494 ceremonial, 621 not), **5 parse-fail**, 0 error, 0 429s. By type:
  - hr 9: 6 ok (0 · 6), 3 parse-fail;
  - s 390: 388 ok (6 · 382), 2 parse-fail;
  - sconres 19: 16 · 3;
  - sjres 135: 5 · 130;
  - sres 567: 467 · 100.
  - Parse-fail and error at 0.45%, under the 2%, so no `full-3`.
- **The run's own POST** went to `$REVALIDATE_URL` and failed (`ECONNREFUSED`), as HO 800 found.
- **The flush, by hand, once:** `POST https://congressional-terminal-chi-silk.vercel.app/api/revalidate?tag=bills`, Bearer `$CRON_SECRET` by name: **200 in 275 ms, `{"ok":true,"tag":"bills"}`**, sent 1:05:33 AM MST (08:05:33Z).
- **Prod after** (1:05:48 AM MST, 08:05:48Z), against HO 800's snapshot (`null-ids-before.tsv`, which stays the reversal list for both runs):
  - NULL went from 10,840 to **5**, a drop of 10,835, the four logs' ok rows exactly: 10,828 written and unchanged since, and 7 re-summarized by Production's summarizer after the snapshot (they carry its tag).
  - 0 unexplained, no row outside the snapshot changed, none new.
  - The residue is the 5 parse-fails, `119-hr-1536`, `119-hr-4561`, `119-hr-5696`, `119-s-2883` and `119-s-928`, all law-eligible; none comes from the summarizer.
  - The tag now: law-eligible 0 16,670 · 1 394 · NULL 5; resolutions 0 597 · 1 2,166 · NULL 0. Newly tagged over HO 800 and HO 801: law-eligible 217 of 9,300 ceremonial (2.3%), resolutions 1,176 of 1,535 (76.6%).
- **The re-read** (`gradshow-ceremonial-799.ts --label 801`, 1:06:07 to 1:06:09 AM MST, read-only; the HO 799 findings file's second reading):
  - A1, the hollow dots, **394** (383, +11, all in committee).
  - A2, the dome, 16,675 (16,686, −11); untagged **5** (534, −529).
  - A3, ceremonial resolutions, **2,166** (1,683, +483: sres +467, sconres +16): 495 at `floor` or later (+241), 480 `agreed` (+236), and 1 at `enacted`, `119-sres-611`, tagged now.
  - A4, ceremonial across all types, 2,560 (+494).
  - B unchanged, 7 of 122 under Pew's cut.
  - C's last untagged post-office title tagged ceremonial (118, 5, 0).
  - The controls equal on the first read.
- **The eye** (seed 801, the run's law-eligible rows). Tagged 1, all 11 candidates and ten drawn (the list's sha256 `4038fc938f4dc351`):
  - `119-s-94` (the Miracle on Ice Congressional Gold Medal);
  - `119-sjres-105` (the Robert E. Lee Memorial renamed Arlington House National Historic Site);
  - `119-s-650` (the National Churchill Museum a National Historic Landmark);
  - `119-s-814` (the Charles L. Blockson Post Office Building);
  - `119-s-512` (the Agent Raul Gonzalez Officer Safety Act);
  - `119-sjres-96` (displays on the National Mall);
  - `119-s-498` (the United States Colored Troops Congressional Gold Medal);
  - `119-sjres-79` (honoring the thirteen killed at Abbey Gate);
  - `119-s-614` (Alexi Navalny Way);
  - `119-sjres-74` (a CRA disapproval of a pipeline-safety rule).
  - The last is substantive by the prompt's rule, and `119-s-512` and `119-sjres-96` read substantive too: three for Corey's eye.
  - Tagged 0, ten of 518 (`35b279fd05df7834`): `119-sjres-1` and `119-sjres-43` (constitutional amendments), `119-s-842`, `119-s-950`, `119-s-95`, `119-s-813`, `119-sjres-169` (a CRA disapproval), `119-s-685`, `119-s-517`, `119-s-604`, all substantive.

**§ 2, the odds** (`scripts/diagnostic/odds-results-801.ts --label 801`, 1:06:58 AM MST Nov 5, read-only, 5 statements, 6,251 `rows_read`; the tables in `docs/probes/801-odds-results.md`).
- **The book** is the 3:30 PM MST Nov 3 snapshot, the polls still open; **the results** are prod's marks as of 11:24:30 PM MST Nov 4 (06:24:30Z), 387 races decided by one mark prod-wide. Ballotpedia is still calling races: 38 of the 105 rated read no mark.
- **Kalshi: favorites won 60 of 67 called, 89.6%** (5 lost, 2 unmatched; 92.3% of those decided). House 49 of 55, Senate 11 of 12. By the favorite's `implied_pct`: 50–59 3 of 3, 60–69 3 of 6, 70–79 12 of 14, 80–89 9 of 10, 90–100 33 of 34. The five losses: IN-05 (Victoria Spartz, 74), MO-02 (Ann Wagner, 61), OH-15 (Mike Carey, 61), TX-23 (Brandon Herrera, 62), S-SC (Darline Graham, 70).
- **Polymarket: 11 of 12 called** of its 14 Senate races (1 unmatched, 2 not called).
- **The two books** named the same candidate in 13 of 14. S-AK's Kalshi party favorite (D) is Polymarket's Mary Peltola, the race's one D. S-SC is unresolved: *Darline Graham* against *Darline Graham Nordone*.
- **The matching rule:** a party favorite on party; a named favorite by name. Names are lower-cased, diacritics folded, a period before a letter joined, punctuation but hyphens dropped, the suffixes dropped, single-letter initials dropped while more than two tokens remain, and first and last tokens kept. They match when the last tokens are equal and the first equal or a prefix. The rule is printed in full in the findings file.
- **The reading taken, flagged:** a named favorite is matched against every candidate on the ballot, so a favorite who is on it and unmarked reads *favorite lost*. Under the narrower reading (the winner only) the five losses read unmatched instead, and 60 of 67 doesn't move.
- **The hand list (never guessed):**
  - MD-01, Kalshi's *Andy Harris* against the marked *Andrew Harris*;
  - NM-02, *Gabe Vasquez* against the marked *Gabriel Vasquez*;
  - S-SC, Polymarket's *Darline Graham Nordone* against the ballot's *Darline Graham*.
  - If the hand rules the first two the same people, Kalshi reads 62 of 67.
- **The drift:** the Kalshi favorite changed in 3 rated races:
  - AL-02 end to end: Marques 51 → Figures 54 → Figures 53, won.
  - NY-17 end to end: Conley 55 → 57 → Lawler 51, not called.
  - CO-03 and back: Hurd 62 → Romero 51 → Hurd 54, not called.
  - The ten biggest moves (eleven, tenth place shared at 6) run NJ-02 −15 to TX-23 +6, the last a favorite who lost.
- **The controls:**
  - The rated index's 105 and the Kalshi rows' 469 against each snapshot's own counts, equal in all three.
  - Planted in memory: an altered name read unmatched, a party flip favorite lost, and the winner's own name and party favorite won. All PASS, nothing written.
  - 17 of 17 matcher vectors.
- **The checks:**
  - An independent recompute from the handoff's text alone (`docs/handoffs/801-artifacts/indep/`), never reading the script, agreed on every verdict and count under the same reading, the dev data first and then this run's.
  - A review of the script (two agents and four skeptics) found nine defects, all fixed before the record run: the two books compared as strings, the *right* column's labels, Polymarket's bands and split missing, the tie at the tenth move, the share's denominator, the drift's labels, a leading initial, truncated SQL in the log, and *J.D.* read as an initial.

**§ 3, the task.** Claim 5 read twice, then `Unregister-ScheduledTask -TaskName 'CBT odds snapshots' -Confirm:$false` at **1:07:37 AM MST Nov 5 (08:07:37Z)**. From a separate process (PID 22268, 1:07:45 AM) `Get-ScheduledTask` read *No MSFT_ScheduledTask objects found* for it, and `CBT Sabato daily read` was present and `Ready`. `docs\handoffs\odds-snapshots.log` stays on disk (37,012 bytes).

**§ 4, the notes.**
- **Backlog:** `:84` struck on its close; `:82` gains Monday's three runs; `:50`, Sabato refused Nov 4, the Center for Politics unanswered as of Nov 5; `:19`, the CRS meter is `crsOnly` per day.
- **The oddity:** the quota is one project's day shared by the box and Production; the refusals came and went inside the window; an `llm_error` article is re-called every tick.
- **What the news ticks did with the 17 refused calls** (claim 7, read on `observations` at 1:08 AM MST Nov 5):
  - The 17 were 10 articles first seen at 3:30 and 4:00 PM MST Nov 4.
  - They are still tagged `llm_error`, since the tag is written once.
  - They were re-called by every later tick while in their feeds, successfully at 4:30 PM (15 of 15), and the LLM found no bill: none gained a `news_mentions` row.
  - 13 of the 20 tagged articles seen since 3:09 PM are still in a feed.
  - Re-matched, not lost, so the handoff's condition for an OPEN LOOPS line (unmatched and out of their feeds' windows) isn't met, and none is filed.
  - The news ticks' calls ran 3 to 12 before 3:09 PM and 11 to 15 after, consistent with the re-calls (the oddity).

**The ledger.**
- Prod's `rows_read`, all read-only: 107 statements and 349,010 by this HO's instruments (`docs/handoffs/801-artifacts/rows-ledger.tsv`, two dev odds runs and one failed `--news` read among them), and 24 and 315,964 by § 1's re-read (`docs/handoffs/799-artifacts/rows-ledger.tsv`). 664,974 in all.
- Gemini, as the run's log gives it: 214,369 tokens in and 11,931 out over 1,120 responses, about $0.09 at the paid list price. The § 1 run's 1,115 UPDATEs weren't tapped.

**What's owed after the FF.**
- A diagnostic script, data and docs, so Production serves the same app code: no served-SHA or `e2e-prod` read beyond what the deploy reports. The `docs(skill)` commit means the chat rebuilds `cbt.zip`, held until after GradShow; the manifest gains a row.
- **Monday Nov 9, before the poster prints:** the three `--label print` runs (`:82`), their as-of to the chat and the poster chat.
- The Louisiana hand route before Dec 12 (`:80`) and the low loops stand.

**What was flagged.**
- **Run on the evening of Nov 4 and after 1:00 AM Nov 5:** STEP 0 and § 2's script were prepared from 6:28 PM MST Nov 4. § 1, § 2's record run, § 3 and the notes ran after the reset, in the handoff's order. Production's news ticks were still refused on the quota at 6:00 PM and through 12:30 AM.
- **The odds' reading of a named loss** (above): the wider reading, with the narrower one's counts printed beside it.
- **The script went through a dev run, a review and an independent recompute before the record run;** the review's fixes are in the `diag` commit.
- **The re-call loop** is filed as an oddity, not an OPEN LOOPS line: the handoff files a line only for articles lost out of their windows, and these were re-matched.
- **Three of § 1's eye's ten tagged 1 read substantive** (`119-sjres-74`, a CRA disapproval; `119-s-512`; `119-sjres-96`): for Corey's eye, not a stop.
- **SKILL's sentence, read against the tree:** it names the weekly report among the quota's sharers too (`lib/report-generation.ts:1580` calls the same model), beside the handoff's summarize and news crons.
- **Also notes now run through HO 801.**

**Also (HO 802), the hollow dots corrected.** 36 law-eligible bills that the title-only backfill had tagged ceremonial were set back to 0 by hand. One `UPDATE` on the listed ids took `rowsAffected` 36, and one `bills` flush on Production returned 200. HO 799's script re-read reads the hollow dots 394 → **358** and the dome 16,675 → 16,711; A3, B and C are unchanged. One read of the other direction filed 53 rows tagged 0 whose titles read as tribute, for the chat; they are not fixed here. The 12 law-eligible rows the prompt reads either way stay tagged, an OPEN LOOPS line for after GradShow. No app code was touched and no Gemini call was made.
- **What's here:**
  - HO 801's FF go as taken, and the go's rulings;
  - STEP 0, a check: claims 1 to 6 hold, none a HALT;
  - § 1, the write: the snapshot, the one statement, the flush, the reversal's shape;
  - prod after;
  - § 2, the re-read;
  - § 3, the other direction;
  - the titles read against the list;
  - § 4, the docs;
  - the chat's miss, on the record;
  - the ledger;
  - what's owed after the FF;
  - what was flagged.
- **Two commits, kinds unmixed:**
  - `docs`: the HO 799 findings file's third reading, this block, the backlog and the oddity.
  - `docs(skill)`: alone and last.
  - No app code: nothing under `lib/`, `app/`, `components/` or `scripts/`. The instruments live under `docs/handoffs/802-artifacts/`: `reads-802.ts`, `write-802.ts` and `flush-prod.mjs`.
- **The one prod write was § 1's `UPDATE` on the listed ids reading 1, and the one flush was the `bills` tag,** by hand on Production. Everything else was `SELECT`, with the schema fingerprint `4e94644350e1d992` before and after every read and the write.
- **The pointer is 802:** pointer 801 (`docs/roadmap.md:8847`), highest HO in commit subjects 801, `main` at `f15cec7`.

**HO 801's FF go, as taken** (`docs/handoffs/801-ff-go.md`; the gates from 9:45:23 AM MST Nov 5, 16:45:23Z).
- **`main` at `f15cec7`:** five commits on `5e6a040`:
  - `6daf9d3` (diag, `scripts/diagnostic/odds-results-801.ts`);
  - `5850c6c` (docs, the three odds snapshots);
  - `125a1b7` (docs, the odds findings file and the HO 799 findings file's second reading);
  - `a404e03` (docs, the block, the backlog and the oddity);
  - `f15cec7` (docs(skill)).
  - No force; `801-review` deleted on both sides.
- **The gates before the push,** on Node v24.22.2:
  - the cold build, exit 0 in 30 s, 16 of 16 pages, 0 warning lines;
  - `typecheck` 0 on both projects;
  - `check:odds-sites` and `check:design-citations` OK.
- **The push** at 9:46:27 AM MST Nov 5 (16:46:27Z): `5e6a040..f15cec7 -> main`, no force.
- **The deploy:** Production record `7579601430`, `success` at 9:47:14 AM MST (16:47:14Z), deployment `congressionalterminal-cmzlqplxe`. A script, data and docs, so no served-SHA or `e2e-prod` read.
- **The go's read:** every hollow dot with its summary head, `docs/handoffs/801-artifacts/hollow-dots.tsv` (394 rows, `via` backfill 217 and other 177), read at 9:47:19 AM MST (16:47:19Z) for the chat. This HO's list is the chat's reading of it.

**The go's rulings.**
- **The hand list, ruled.** MD-01's *Andy Harris* is the marked *Andrew Harris*, and NM-02's *Gabe Vasquez* is the marked *Gabriel Vasquez*: favorites who won. S-SC's Polymarket *Darline Graham Nordone* is the ballot's *Darline Graham*: a favorite who lost.
  - So at the 11:24:30 PM MST Nov 4 marks, **Kalshi's favorites won 62 of 67** called, 5 lost. House 51 of 55, Senate 11 of 12. By band: 50–59 3 of 3, 60–69 3 of 6, 70–79 12 of 14, 80–89 10 of 10, 90–100 34 of 34.
  - Polymarket's won 11 of 12, 1 lost.
  - The two books named the same candidate in 14 of 14.
  - The odds findings file keeps 60 of 67, the script's count before the hand.
- **Four nicknames among the not called, ruled the same people:** AK-AL's *Nick Begich III*, NY-01's *Nick LaLota*, NY-17's *Mike Lawler* and OH-10's *Mike Turner*. Once each race is called the script will read the favorite *unmatched*, and the chat applies the ruling by hand.
- **Two cautions for the poster:**
  - The as-of is the newest read; the rated races' own reads ran back to 8:58 AM MST Nov 4.
  - The 67 aren't a random 67: favorites the ballot reads as D were 57 of 70 called with 0 lost, and as R 10 of 35 called with 5 lost.

**STEP 0, a check** (claims 1 to 6 at `f15cec7`; the prod claims read 11:02:16 to 11:02:17 AM MST Nov 5, 18:02:16 to 18:02:17Z).
- **1 holds:**
  - `main` reads `f15cec7` on the remote and the box; pointer 801 at `:8847`; highest HO in subjects 801.
  - The tree is clean but for the two untracked Nov 1 test snapshots.
  - Reconcile 286 / 364 on 650, mis-struck 0; `:82` is the Monday re-run and `:84` the struck residue.
- **2 holds:** each of the 36 ids exists, reads 1, carries a summary and reads 1 in a `docs/handoffs/800-artifacts/classify-*.log`; 0 dropped.
- **3 holds, a count recorded:**
  - The tag's values are 0, 1 or NULL and nothing else. Law-eligible: 0 16,662 · 1 **394** · NULL **13**. Resolutions: 0 597 · 1 2,166 · NULL 0.
  - `IS NULL` reads 13 against the handoff's about 5, inside its 10. Against the second reading (0 16,670 · NULL 5), the 0s read 8 fewer and the NULLs 8 more, with the total 17,069 both times. § 2 reads 8 of the 13 with no summary: a sync's reset (`lib/sync.ts:351`) clears both, and they wait for the summarizer.
- **4 holds:** the column's writers are:
  - `lib/summarize-runner.ts:306`, with its UPDATEs at `:323` and `:379`;
  - `lib/sync.ts:351`, the reset to NULL with the summary;
  - `scripts/classify-ceremonial.ts:234`, over NULL rows only;
  - `scripts/diagnostic/crs-catchup-794.ts:71`, dormant and typed by hand.
  - The leg harnesses in it and in `sync-frontier-790.ts` write `file:` copies only. So a hand tag lasts until a bill's text changes, and then the summarizer re-tags it.
- **5 holds:** the feeds read the column at query time (`lib/queries.ts:574`, `:600`, `:643`, `:688`, `:762`) inside caches tagged `bills`, so the flush is all a render needs.
- **6 holds:** the HO 799 findings file has *The second reading* at `:202` and *## Findings* at `:229`; SKILL `:2093` reads as HO 801 left it; `flush-prod.mjs` and `hollow-dots.tsv` (394 rows) are on the box.

**§ 1, the write** (`docs/handoffs/802-artifacts/write-802.ts --go`, 11:02:59 to 11:03:09 AM MST Nov 5).
- **The snapshot first:** `before.tsv`, the reversal list, holds 36 rows, all reading 1, with their `summary_updated_at`; sha256 `45576b81c075586e`; as of 11:02:59 AM MST (18:02:59Z).
- **The one statement:** `UPDATE bills SET is_ceremonial = 0 WHERE is_ceremonial = 1 AND id IN (the 36)`, through a writer that runs that statement and no other.
  - **`rowsAffected` 36** at 11:03:09 AM MST (18:03:09Z), the 36 STEP 0 kept.
  - The read-back: 0 ×36. The fingerprint unchanged.
- **The flush, by hand, once:** `POST https://congressional-terminal-chi-silk.vercel.app/api/revalidate?tag=bills`, Bearer `$CRON_SECRET` by name. It returned **200 in 279 ms, `{"ok":true,"tag":"bills"}`**, sent at 11:03:21 AM MST (18:03:21Z).
- **The reversal, not run:** `UPDATE bills SET is_ceremonial = 1 WHERE id IN (…)` over `before.tsv`'s 36 ids, then the same flush. The list lives in `docs/handoffs/802-artifacts/before.tsv` on the box, and the same 36 ids are in the HO 799 findings file's third reading.

**Prod after** (11:03:31 AM MST, 18:03:31Z):
- Law-eligible: 0 **16,698** · 1 **358** · NULL 13.
- Resolutions: 0 597 · 1 2,166 · NULL 0, unchanged.
- The list's 36 read 0.
- Against the handoff's estimate (0 about 16,706, NULL 5), the difference is the same 8 rows as claim 3's.

**§ 2, the re-read** (`gradshow-ceremonial-799.ts --label 802`, 11:03:33 to 11:03:39 AM MST, read-only, 24 statements, 315,868 `rows_read`; the HO 799 findings file's third reading):
- A1, the hollow dots, **358** (394, −36: committee −34, floor −1, other_chamber −1).
- A2, the dome, **16,711** (16,675, +36): tagged not ceremonial 16,698 (+28), untagged 13 (5, +8). The 13 are the 5 parse-fails and the 8 the sync reset.
- A3, ceremonial resolutions, 2,166, its stages unchanged (495 at `floor` or later, 480 `agreed`, 1 at `enacted`).
- A4, ceremonial across all types, **2,524** (2,560, −36).
- B unchanged, 7 of 122 under Pew's cut: none of the 36 is at `enacted`.
- C unchanged (118, 5, 0): its predicate doesn't catch `119-hr-1225`'s ZIP Code.
- D's lists: 27 at `floor` or later (29), 330 in committee (364).
- The controls were equal on the first read: A1 + A2 = 17,069, A1 + A3 = 2,524.
- Every figure came in as the handoff estimated except A2's untagged, 13 against 5 (the 8).

**§ 3, the other direction** (11:04:16 to 11:04:17 AM MST, read-only). The handoff's statement over the law-eligible rows tagged 0, outside the list, whose titles read as tribute returned **53 rows**. They went into `docs/handoffs/802-artifacts/tagged-0-lookalikes.tsv` (sha256 `9b6a1ff388ed8f8d`), with tabs and newlines in a field replaced by a space. Nothing is fixed here: the chat reads the file off the box, and any corrections ride Monday's handoff.

**The titles, read against the list** (11:04:55 AM MST, Guard 4).
- 34 of the 36 titles read as the table names them.
- `119-s-3553` reads *Where’s WALDO Act* in prod, with a curly apostrophe.
- `119-sjres-74`'s title is the CRA joint resolution's long form, which the table paraphrases.
- Neither changes the list. The 12 left as tagged: 12 found, all reading 1.
- In `hollow-dots.tsv`, all 36 and all 12 read `via` backfill.

**§ 4, the docs.**
- The HO 799 findings file's third reading, after *The second reading* and before *## Findings*. It carries the handoff's table whole, the 12 left as tagged and the split. Nothing above it is edited.
- The backlog: `:82`'s dated note, and one OPEN LOOPS line after `:84` for the 12.
- The oddity.
- SKILL's sentence.

**The chat's miss, on the record.** HO 800's paste flagged `119-hr-1014`, `119-hr-1310` and `119-hr-5787` for the chat's eye. Its FF go let them stand on their titles, and all three are on this list.

**The ledger.**
- Prod's `rows_read`, all read-only:
  - 15 statements and 117,251 by this HO's read instrument (`docs/handoffs/802-artifacts/rows-ledger.tsv`);
  - 24 statements and 315,868 by § 2's re-read (`docs/handoffs/799-artifacts/rows-ledger.tsv`);
  - 433,119 in all.
- § 1's snapshot, `UPDATE` and read-back weren't tapped.
- Gemini: no calls.

**What's owed after the FF.**
- Docs only, so Production serves the same app code: no served-SHA or `e2e-prod` read beyond what the deploy reports. The `docs(skill)` commit means the chat rebuilds `cbt.zip`, held until after GradShow; the manifest gains a row.
- **Monday Nov 9, before the poster prints:** the three `--label print` runs (`:82`), on a handoff the chat writes that morning, carrying any corrections § 3 brings.
- **After GradShow:** the 12 left as tagged, ruled by class (the new OPEN LOOPS line).
- The Louisiana hand route before Dec 12 (`:80`) and the low loops stand.

**What was flagged.**
- **NULL 13, not about 5** (STEP 0's claim 3, prod after and § 2's A2): 8 law-eligible rows a sync reset since the second reading, summary and tag together. The law-eligible total is 17,069 at both readings, so none is new. Inside claim 3's 10, so recorded.
- **Two titles read differently from the table** (Guard 4): `119-s-3553`'s curly apostrophe and `119-sjres-74`'s long form. Flagged; the list is unchanged.
- **The `:82` note in the line's own form:** the label is bold, as on HO 801's note there, with the handoff's words after it.
- **The third reading carries the handoff's table whole** (bill, title, what it does) as *the list above*.
- **Reads beyond the letter:** the 36 titles and the 12 left as tagged, read once in prod, and the 48 rows' `via` in `hollow-dots.tsv`.
- **Also notes now run through HO 802.**

**Also (HO 803), the tag's other direction.** 48 law-eligible bills tagged 0 that Pew's definition and their own twins call ceremonial were set to 1 by hand, and one twin, `119-sjres-96`, was set to 0. One batch of two `UPDATE`s took `rowsAffected` 48 and 1, and one `bills` flush on Production returned 200. HO 799's script re-read reads the hollow dots 358 → **405**, the dome 16,711 → 16,664, and B 7 → **13 of 122** under Pew's cut, or 11 of 120 counting public laws only, beside Pew's 12 of 121. The print runs were rehearsed read-only, so Monday's runs are read-only too. No app code was touched and no Gemini call was made.
- **What's here:**
  - HO 802's FF go as taken;
  - STEP 0, a check: claims 1 to 5 hold, none a HALT;
  - § 1, the write: the snapshot, the one batch, the flush, the reversal's shape;
  - the rows read against the list;
  - prod after;
  - § 2, the re-read and the laws by kind;
  - § 3, the rehearsal;
  - § 4, the docs;
  - the ledger;
  - what's owed after the FF;
  - what was flagged.
- **One commit:** `docs`, the HO 799 findings file's fourth reading, this block, the backlog and the oddity.
  - SKILL untouched, so no `cbt.zip` and no manifest row.
  - No app code: nothing under `lib/`, `app/`, `components/` or `scripts/`. The instruments live under `docs/handoffs/803-artifacts/`: `lists-803.mjs`, `reads-803.ts`, `write-803.ts` and `flush-prod.mjs`.
- **The one prod write was § 1's batch on the listed ids, and the one flush was the `bills` tag,** by hand on Production. Everything else was `SELECT`, with the schema fingerprint `4e94644350e1d992` before and after every read and the write.
- **The pointer is 803:** pointer 802 (`docs/roadmap.md:8977`), highest HO in commit subjects 802, `main` at `7ea3951`.

**HO 802's FF go, as taken** (`docs/handoffs/802-ff-go.md`; the gates from 11:48:54 AM MST Nov 5, 18:48:54Z).
- **`main` at `7ea3951`:** two commits on `f15cec7`, `f4af1c6` (docs) and `7ea3951` (docs(skill)). No force; `802-review` deleted on both sides.
- **The gates before the push,** on Node v24.22.2:
  - the cold build, exit 0 in 30 s, 16 of 16 pages, 0 warning lines;
  - `typecheck` 0 on both projects;
  - `check:odds-sites` and `check:design-citations` OK.
- **The push** at 11:49:50 AM MST Nov 5 (18:49:50Z): `f15cec7..7ea3951 -> main`, no force.
- **The deploy:** Production record `7582470955`, `success` at 11:55:48 AM MST (18:55:48Z), deployment `congressionalterminal-jmsn9et4k`. Docs only, so no served-SHA or `e2e-prod` read.
- **The go's three reads** (11:50:58 to 11:51:12 AM MST, read-only), in `docs/handoffs/802-artifacts/`:
  - `tagged-0-lookalikes-2.tsv`: 140 rows (161 matched, minus the 21 already in the first file);
  - `same-title-two-tags.tsv`: 8 titles over 17 bills;
  - `enacted-tagged-0.tsv`: 132 laws.
  - This HO's list is the chat's reading of them, with § 3's 53.

**STEP 0, a check** (claims 1 to 5 at `7ea3951`; the prod claims read 12:35:22 to 12:35:23 PM MST Nov 5, 19:35:22 to 19:35:23Z).
- **1 holds:**
  - `main` reads `7ea3951` on the remote and the box; pointer 802 at `:8977`; highest HO in subjects 802.
  - The tree is clean but for the two untracked Nov 1 test snapshots.
  - Reconcile 287 / 364 on 651, mis-struck 0; `:82` is the Monday re-run and `:85` the close rows.
- **2 holds:** each of the 48 exists and reads 0, and `119-sjres-96` reads 1; 0 dropped.
- **3 holds, a count recorded:**
  - The tag's values are 0, 1 or NULL and nothing else. Law-eligible: 0 16,706 · 1 **358** · NULL **5**. Resolutions: 0 597 · 1 2,166 · NULL 0.
  - NULL reads 5 against the handoff's about 13, inside its 10. Against the third reading (0 16,698 · NULL 13), the 0s read 8 more and the NULLs 8 fewer: the summarizer re-read the 8 rows a sync had reset, its newest stamp 11:10:26 AM MST.
- **4 holds:** the column's writers are as HO 802 read them:
  - `lib/summarize-runner.ts:306`, with its UPDATEs at `:323` and `:379`;
  - `lib/sync.ts:351`;
  - `scripts/classify-ceremonial.ts:234`;
  - `scripts/diagnostic/crs-catchup-794.ts:71`, dormant.
  - `lib/summarize.ts:20` holds the summarizer's rule, which ends *or directs an agency — even narrowly scoped*.
  - The other hits are read-only regexes in the HO 799 script and the two leg harnesses, which write `file:` copies only. No `INSERT` names the column.
- **5 holds:** the HO 799 findings file has *The third reading* at `:229` and *## Findings* at `:319`; HO 802's `write-802.ts`, `reads-802.ts` and `flush-prod.mjs` are on the box.

**§ 1, the write** (`docs/handoffs/803-artifacts/write-803.ts --go`, 12:37:13 to 12:37:16 PM MST Nov 5).
- **The snapshot first:** `before.tsv`, the reversal list, holds 49 rows (48 reading 0, 1 reading 1) with their `summary_updated_at`; sha256 `f7d0416c6230a6b6`; as of 12:37:13 PM MST (19:37:13Z).
- **The one batch,** in one write transaction at 12:37:16 PM MST (19:37:16Z), through a writer that runs these two statements and no other:
  - `UPDATE bills SET is_ceremonial = 1 WHERE is_ceremonial = 0 AND id IN (the 48)`: **`rowsAffected` 48**;
  - `UPDATE bills SET is_ceremonial = 0 WHERE is_ceremonial = 1 AND id = '119-sjres-96'`: **`rowsAffected` 1**.
  - The read-back: 1 ×48, and 0 for `119-sjres-96`. The fingerprint unchanged.
- **The flush, by hand, once:** `POST https://congressional-terminal-chi-silk.vercel.app/api/revalidate?tag=bills`, Bearer `$CRON_SECRET` by name. It returned **200 in 386 ms, `{"ok":true,"tag":"bills"}`**, sent at 12:37:30 PM MST (19:37:30Z).
- **The reversal, not run:** each row back to its value in `before.tsv`, so `UPDATE bills SET is_ceremonial = 0 WHERE id IN (the 48)` and `UPDATE bills SET is_ceremonial = 1 WHERE id = '119-sjres-96'`, then the same flush. The list lives in `docs/handoffs/803-artifacts/before.tsv` on the box, and the same 49 ids are in the HO 799 findings file's fourth reading.

**The rows, read against the list** (12:35:33 PM MST, Guard 4; the 49 rows' titles and summary heads in `rows-803.tsv`).
- **45 of the 49 read as their class names them.** Four read otherwise, for the chat's eye, with the list unchanged:
  - `119-hr-7113` renames the Congressional Budget Office the *China Budget Office*. It is a renaming, but of an agency, and it honors no one.
  - `119-hr-10456` (*Renewing the Dream Act*) orders Interior to replace the Lincoln Memorial's plaque for King's speech. `119-s-2369` orders Interior to remove or cover Francis Newlands's name on the Chevy Chase Circle fountain. Each makes an official do an honorific thing, the shape the list otherwise leaves as tagged, though both sit with the twins (their twins `119-s-5690` and `119-hr-4608` read 1).
  - `119-s-633` is a circulating $1 coin series honoring presidents, not a commemorative coin in the Mint's sense. It honors by name.
- **The six at `enacted`** are the six the handoff names for B: `119-hr-2196`, `119-hr-3377`, `119-hr-3497`, `119-hr-7211`, `119-s-3705`, `119-s-858`.
- **Left as they are:** the 25 left tagged 0 all read 0, the 11 left tagged 1 all read 1, and `119-hjres-133` reads `enacted` and 0.
- **The 48 by writer,** read off HO 800's per-row logs: 11 logged 0 by the backfill, and 37 not in its logs, so the summarizer's.

**Prod after** (12:37:37 PM MST, 19:37:37Z):
- Law-eligible: 0 **16,659** · 1 **405** · NULL 5.
- Resolutions: 0 597 · 1 2,166 · NULL 0, unchanged.
- The 48 read 1, and `119-sjres-96` reads 0.

**§ 2, the re-read** (`gradshow-ceremonial-799.ts --label 803`, 12:37:41 to 12:37:44 PM MST, read-only, 24 statements, 315,998 `rows_read`; the HO 799 findings file's fourth reading):
- A1, the hollow dots, **405** (358, +47: committee +35, floor +2, other_chamber +4, enacted +6).
- A2, the dome, **16,664** (16,711, −47): tagged not ceremonial 16,659 (−39), untagged 5 (13, −8), the 5 parse-fails.
- A3, ceremonial resolutions, 2,166, its stages unchanged.
- A4, ceremonial across all types, **2,571** (2,524, +47).
- B, **13 of 122** under Pew's cut (7, +6): `119-s-3705`, `119-hr-3377`, `119-hr-7211`, `119-hr-3497`, `119-s-858` and `119-hr-2196` joined.
- C unchanged (118, 5, 0).
- D's lists: 39 at `floor` or later (27), 365 in committee (330).
- The controls were equal on the first read: A1 + A2 = 17,069, A1 + A3 = 2,571.
- Every figure came in as the handoff estimated.
- **The laws by kind** (12:38:24 PM MST, read-only):
  - Two law-eligible laws carry a latest action other than *Became Public Law*: `119-hr-3377` (Private Law 119-1) and `119-hr-7194` (Private Law 119-2), both of Mar 26, 2026, both now tagged 1.
  - `119-hr-1744` and `119-hr-8205` now read *Became Public Law No: 119-137* and *119-138* (Nov 3, 2026), after the cut.
  - B both ways, under the cut: all laws 13 of 122 (10.7%); public laws only, as Pew counts, **11 of 120** (9.2%), beside Pew's 12 of 121 (9.9%). Pew doesn't publish its list, so this is a count beside a count, not a match of bills.

**§ 3, the rehearsal** (read-only, 12:38 to 12:39 PM MST).
- **`gradshow-numbers-787.ts --numbers --label 803`** ran clean: 20 statements, 225,615 `rows_read`, the fingerprint unchanged.
  - Every tree anchor hit, so none drifted.
  - It printed its own *OUTSIDE* and *HALT (A1)* against the Oct 19 poster: *Introduced* 17,261 and *Became law* 126 now, beside the poster's 18,137 and 120 and the drift since then, [14,387, 17,650]. Recorded; they aren't this HO's.
  - Its scope, the rows tagged 0 or NULL with a summary, would read 17,308 before the write (17,261 + 48 − 1), so the hand tags took *Introduced* down 47.
- **`odds-results-801.ts --label 803`** ran clean: 5 statements, 6,251 `rows_read`, the fingerprint unchanged, the four planted controls PASS. As the script reads it:
  - **Kalshi's favorites won 65 of 73 called** (89.0%), 6 lost, 2 unmatched, 32 not called. House 54 of 61 (5 lost, 2 unmatched), Senate 11 of 12 (1 lost).
  - By band: 50–59 3 of 3, 60–69 4 of 7, 70–79 13 of 16, 80–89 10 of 11, 90–100 35 of 36.
  - The six losses: IN-05 (Spartz, 74), MO-02 (Wagner, 61), OH-15 (Carey, 61), S-SC (Graham, 70), TX-09 (Alex Mealer, 76, called since HO 801) and TX-23 (Herrera, 62).
  - **Polymarket's won 11 of 12 called,** 0 lost, 1 unmatched, 2 not called. The two books named the same candidate in 13 of 14, S-SC unresolved.
  - **The hand list** is HO 801's three: MD-01 *Andy Harris* against the marked *Andrew Harris*, NM-02 *Gabe Vasquez* against the marked *Gabriel Vasquez*, and S-SC's Polymarket *Darline Graham Nordone* against the ballot's *Darline Graham*. With HO 801's FF go's rulings applied, Kalshi reads 67 of 73 and Polymarket 11 of 12 with 1 lost, the chat's to apply.
  - The four nicknames ruled the same people are still not called.
  - **The marks' as-of:** the newest marked `read_at` is 11:24:30 AM MST Nov 5 prod-wide. Over the 105 rated races in `odds-803-ballot.tsv`, one `read_at` a race, the oldest is 1:21:48 PM MST Nov 4 (20:21:48Z, TX-28) and the newest 11:24:24 AM MST Nov 5 (18:24:24Z, TX-23).

**§ 4, the docs.**
- The HO 799 findings file's fourth reading, after *The third reading* and before *## Findings*. It carries Pew's rule with its link, the list, what's left as it is and B both ways. Nothing above it is edited.
- The backlog: `:82`'s and `:85`'s dated notes. The reconcile stands at 287 / 364 on 651.
- The oddity.

**The ledger.**
- Prod's `rows_read`, all read-only, 651,038 over 67 statements in all:
  - 18 statements and 103,174 by this HO's read instrument (`docs/handoffs/803-artifacts/rows-ledger.tsv`);
  - 24 and 315,998 by § 2's re-read (`docs/handoffs/799-artifacts/rows-ledger.tsv`);
  - 20 and 225,615 by the numbers rehearsal (`docs/handoffs/787-artifacts/rows-ledger.tsv`);
  - 5 and 6,251 by the odds rehearsal (`docs/handoffs/801-artifacts/rows-ledger.tsv`).
- § 1's snapshot, batch and read-back weren't tapped.
- Gemini: no calls.

**What's owed after the FF.**
- Docs only, so Production serves the same app code: no served-SHA or `e2e-prod` read beyond what the deploy reports. SKILL is untouched, so no `cbt.zip` rebuild.
- **Monday Nov 9, before the poster prints:** the three `--label print` runs (`:82`), read-only, from a short block the chat gives that morning.
- **After GradShow:** the close rows (`:85`), ruled on the one question, then the two prompts get Pew's classes.
- The Louisiana hand route before Dec 12 (`:80`) and the low loops stand.

**What was flagged.**
- **NULL 5, not about 13** (STEP 0's claim 3): the summarizer re-read the 8 rows a sync had reset. Inside the 10, so recorded.
- **Four rows read differently from their class** (Guard 4): `119-hr-7113`, `119-hr-10456`, `119-s-2369` and `119-s-633`. Flagged; the list is unchanged.
- **The `:82` and `:85` notes in the lines' own form:** the label is bold, as HO 802's FF go ratified for `:82`, with the handoff's words after it.
- **The rehearsal's *HALT (A1)* and *OUTSIDE*** are the HO 787 script's own lines against the Oct 19 poster, recorded as the handoff says.
- **The odds read a sixth loss since HO 801, TX-09;** the hand list is HO 801's three, and the chat applies the rulings.
- **Pew's link** is as the handoff gives it, not fetched here.
- **Reads beyond the letter:** the 49 rows' titles and summary heads (`rows-803.tsv`), the 25 and the 11 left as they are, `119-hjres-133`, and the 48 by writer off HO 800's logs.
- **Also notes now run through HO 803.**

**Also (HO 804), the committees WATCH read a month late, the hand-row read-back rehearsed for Monday, and 15 stale ledger lines closed.** HO 756's WATCH asked for a read after the 28th scheduled `5 */6 * * *` tick, 2026-10-06 18:05Z, and only the first two were ever read. Read now from `cron_runs`, the 28 meet its bar and the 121 since read no `error`, so the WATCH and the committees errors line strike. Prod by `SELECT` and one GET; no app code, no Gemini call, no flush.
- **HO 803's FF go, as taken:** `main` at `3cb107b`, one commit on `7ea3951`, amended once with the go's sentence on `:85`; no force; `803-review` deleted on both sides. The cold build on Node 24.22.2 exit 0 in 31 s, 16 of 16 pages, 0 warnings; `typecheck` 0 on both; `check:odds-sites` and `check:design-citations` OK; the hash audit 0 hits in 8 files. The push `7ea3951..3cb107b` at 1:17:11 PM MST Nov 5 (20:17:11Z); Production record `7584304587`, `success` at 1:17:55 PM MST (20:17:55Z), deployment `congressionalterminal-gmm3d9ym3`. Docs only, so no served-SHA or `e2e-prod` read.
- **STEP 0, a check: claims 1 to 6 hold, none a HALT** (prod read at 5:27:56 PM MST Nov 5, 00:27:56Z Nov 6). `main` reads `3cb107b` on the remote and the box, pointer 803 at `:9110`, reconcile 287 / 364 on 651; the route's anchors as given, the status union at `lib/cron-log.ts:16-20` (`orphaned` at `:20` and `:104`); #21163 and #21224 as claimed, 149 rows since 2026-09-30 against about 148 (the 149th is the Nov 6 00:05Z tick), the route's oldest row 2026-05-28, so nothing pruned; the fingerprint `4e94644350e1d992` before and after every read; the two lists 36 and 49, no id shared.
- **§ 1, W1, the WATCH's 28 ticks, by its bar** (`docs/handoffs/804-artifacts/committees-watch-804.ts --watch`, 5:28:09 PM MST Nov 5, 00:28:09Z Nov 6; every row in `ticks-804.tsv`). All six lines met:
  - 0 `error`, 0 `timeout`, 0 `orphaned`: 28 `success`, no hand run.
  - Empty slots: 0.
  - `remaining` 0 from the first tick on, and at most 1 after it, once (#22858 at 10-06 12:05Z, one failed walk).
  - `gaveUp.count` 0 throughout.
  - `elapsed_ms` at most 29,412 (#22858), under 290,000.
  - Neither step failed on any of the 28.
- **W2, the 121 scheduled ticks since** (2026-10-07 00:05Z to 2026-11-06 00:05Z): 121 of 121 slots, no hand run, all `success`. So no `error` row reads the abort or carries the breaker's words, and the committees errors line's bar is met too.
  - The list step failed on 3, each `The operation was aborted due to timeout` on a `success` row that walked on (#24773, #25110, #30155; by hour 00/06/12/18Z 1 / 1 / 0 / 1); the members step failed on none.
  - `remaining` peaked at 7,023 at #28046 (10-26 06:05Z), the first tick after HO 790's drain wrote 7,707 bills (00:13 to 01:34Z Oct 26), and drained at the 500 cap to 0 by 10-30 18:05Z. One earlier spike, 445 at #26743 (10-21 06:05Z), the first tick after HO 788's repair wrote 950, read 0 at the next. 19 ticks over 50, `deadlineHit` 2 (#28315 and #28454, Oct 27), `capHit` 19; since 10-30 18:05Z, at most 3.
  - `gaveUp.count` 0 throughout; `elapsed_ms` at most 243,843 (#28454), none at or over 290,000.
- **Owed now 0** (set aside 0), read-756.ts's statement at 5:28:12 PM MST. **`/api/health`**, one GET: the committees row `healthy` true, `lastStatus` `success` at 2026-11-06 00:05:43Z. The whole read is HTTP 503 on one route, `/api/sync-race-ratings`: Sabato's 403 every day since Oct 11 (the Sabato reader line, `:50`), its last success Sep 30.
- **§ 2, the hand-row read-back** (`hand-rows-804.ts --label 804`, 5:30:57 PM MST, read-only): 85 of 85 read and 85 as set (HO 802's 36 at 0, HO 803's 48 at 1, `119-sjres-96` at 0); none moved, none re-summarized since its write.
- **What struck:** the WATCH (`:90`) and the committees errors line (`:93`) on their bars; the CCBT check (`:153`) tombstoned; DONE's 14 to `- ~~**Title**~~`, the control under `## DONE` reading 0. `:82` gains Monday's read-back, and the header's `:5` the WATCH sentence. No line added. Reconcile 287 / 364 → **270 / 381** on 651, mis-struck 0.
- **The ledger:** prod `rows_read` 24,511 over 18 statements, all `SELECT` (`docs/handoffs/804-artifacts/rows-ledger.tsv`), one read beyond the letter among them: the ratings route back to its last success. Gemini: no calls.
- **Flagged:** the tombstone reads *nearly five months past* its Jun 13 date where the handoff wrote *five months* (Jun 13 to Nov 5 is 145 days); tick times are named by their UTC slots.
- **Owed after the FF:** Monday Nov 9, before the poster prints, the three `--label print` runs and the read-back (`:82`), read-only.
- **Also notes now run through HO 804.**

**Also (HO 805), the FMP swap measured first: CT's trades against CapitolStockWatch's open dataset, the official House and Senate filings tried from the box, and every FMP touchpoint listed.** Read-only on prod and docs only. The numbers are in `docs/probes/805-trades-sources.md`; the swap is HO 806's, after the Nov 9 print.
- **HO 804's FF go, as taken:**
  - `main` at `af27e38`: one commit, amended once with the go's sentence on `:50`; no force; `804-review` deleted on both sides.
  - The gates: the cold build on Node 24.22.2 exit 0 in 57 s, 16 of 16 pages, 0 warnings; `typecheck` 0 on both; `check:odds-sites` and `check:design-citations` OK; the hash audit 0 hits in 7 files.
  - The push `3cb107b..af27e38` at 6:48:31 PM MST Nov 5 (01:48:31Z Nov 6).
  - Production record `7590176281`, `success` at 6:49:14 PM MST (01:49:14Z), deployment `congressionalterminal-6racq1wdy`. Docs only, so no served-SHA or `e2e-prod` read.
- **The ruling,** Corey's, verbatim: *"You pick os approved"* (9:20 AM MST Nov 6). Trades move to CapitolStockWatch's open dataset (CC BY 4.0, credited with a link), and the seven FMP symbols leave the tape.
- **STEP 0, a check: claims 1 to 6 hold, none a HALT** (Nov 6, by 9:37:23 AM MST). Recorded:
  - `tradesPlanCap` is at `app/api/sync/route.ts:160`, its comment at `:157`;
  - *hundreds of rows* spans `lib/queries.ts:3717-3718`, and it's stale at 2,780;
  - `market_ticks` has no source column, so a tick's source is its symbol's in `MARKET_SYMBOLS`;
  - the dataset's repo is one commit, `7a6958f` at 9:01:09 AM MST;
  - the fingerprint read `4e94644350e1d992` throughout.
- **§ 1, CT now:** `stock_trades` holds 2,780 rows (House 2,219, Senate 561), all filed in 2026 (Apr 2 to Nov 5), 148 unmatched, each carrying its filing's link. `market_ticks` holds 24,853, the seven FMP symbols' 16,618 among them. Without them the bare 4-hourly run still ticks at most 4.00 h apart, inside the 9 h health window.
- **§ 2, the dataset:** the GitHub and site CSVs are byte-identical, 4,950 rows (House 4,648, Senate 302) from 124 filers, all 2026. `trades.json` holds the same 4,950 and carries `owner`, which the CSV lacks. The badge's repo is a 301 to the same repo. The chat's checks reproduce; its 977 counted six fields, which its handoff called every field, and every field reads 156.
- **§ 3, the match:** CT's matcher places 120 of the 124 filers (4 unmatched, 18 rows). Key A matches 1,241 rows and Key B 1,570. Filing by filing, CSW holds 230 House filings CT lacks, and CT holds 52 Senate filings CSW lacks. No CT row predates 2026.
- **§ 4, the official route:**
  - **The House answered:** the index's 456 PTRs, 401 of them in CSW. In the 12 sample PDFs, 47 of 48 electronic rows agree on all four fields, and 35 of 39 paper rows on date, type and amount.
  - **eFD refused** the agreement's POST (403, a bot-manager block page), so the Senate's list is unread from the box.
- **§ 5, FMP everywhere:** 166 lines at `af27e38`: 86 that run, 2 in `components/`, 42 in tooling, 36 in docs. `vercel env ls` is unread: the CLI's token was refused.
- **One commit,** `docs`: the probe, this block and `:30`'s dated note; the reconcile stands at 270 / 381 on 651. SKILL, oddities and code are untouched, so no `cbt.zip`.
- **Flagged in the paste:**
  - the 977;
  - `components/` outside the handoff's three groups;
  - the Senate read by substitute;
  - Khanna's 459-row scan checked in part;
  - up to 70 retired DOW and GOLD ticks that may be FMP's.
- **Also notes now run through HO 805.**

**Also (HO 806), the FMP swap: trades from CapitolStockWatch's open dataset (CC BY 4.0), the seven FMP symbols off the tape, FMP's code, cron and key out.** Built on `806-review` from `3e47616` in six commits, prod read by `SELECT` only; § 5, the deletes and the backfill, runs on the FF go.
- **HO 805's FF go, as taken:**
  - `main` at `3e47616`: one commit, amended once with the go's three replacements; no force; `805-review` deleted on both sides.
  - The gates: the cold build on Node 24.22.2 exit 0 in 71 s, 16 of 16 pages, 0 warnings; `typecheck` 0 on both; `check:odds-sites` and `check:design-citations` OK; the hash audit 0 hits in 8 files.
  - The push `af27e38..3e47616` at 12:53:40 PM MST Nov 6 (19:53:40Z).
  - Production record `7609453426`, `success` at 12:54:35 PM MST (19:54:35Z), deployment `congressionalterminal-72yqetv2w`. Docs only, so no served-SHA or `e2e-prod` read.
- **The rulings,** Corey's, verbatim: *"You pick os approved"* (9:20 AM MST Nov 6), the swap; *"ok"* (1:05 PM MST Nov 6), FMP's stored rows deleted with no copy kept; *"send 806 and then we fix anything that would pop up at the grad show"* (9:50 AM MST Nov 7), the swap ahead of Monday's print.
- **Two calls differ from HO 805's close:** the row id is CSW's own per-line `id` with a `csw:` prefix, since owner and type added to the composite wouldn't keep Salazar's five rows five (DocID `20035778`, two NVDA buys that differ only in `comment`); and nothing is added for April McClain Delaney, whom CSW spells as `members` does.
- **STEP 0, a check: claims 1 to 8 hold, none a HALT** (Nov 7, by 12:07:15 PM MST). Recorded: `TradeRow` prints the raw name at `:51` and `:55` (the handoff's `:50` and `:54`), and `lib/cron-health.ts`'s exception paragraph ends at `:28`; HO 805's sweep reads 184 at `3e47616` (166 at `af27e38`, the 18 more in its own probe); `stock_trades` 2,783 (House 2,222, Senate 561), all FMP-shaped, 0 `csw:`, 0 neither; the seven symbols 16,730 ticks; DOW 21 and GOLD 8 past § 5d's instants, none after Jun 16; the feed 4,950 records, every id unique, all 40 keys on every one, the same rows as HO 805's copy; the fingerprint `4e94644350e1d992` throughout.
- **§ 1 (`feat`):** `lib/capitolstockwatch.ts` fetches the feed; `lib/trades-ingest.ts`, rewritten, mirrors the `csw:` rows of the feed's filing-date window behind a delete guard; the matcher folds accents, strips post-nominals, reads multi-word surnames and takes one alias; `/api/sync` carries `trades` and joins its `chronicErr`; the readers join `members` for the name; `/trades` and the hub's Trades tab credit CapitolStockWatch, the licence linked.
- **§ 2 (`feat`):** the seven symbols, `fetchFmp` and the `?source=fmp` entry out; MARKETS reads TNX, WTI, CPI and UNEMP; `vercel.json` holds 19 entries over 19 routes.
- **§ 3 (`chore`):** `lib/fmp.ts` and three FMP-only probes removed; `FMP_API_KEY` out of `lib/redact.ts` and `.env.example`; `migrate.ts`'s two comments.
- **§ 4 (`test`):** the smoke spec's sources test reads `/trades`'s credit and licence link: 1 passed against the local build, while prod's `/trades` reads none of its tokens until the FF.
- **Leg A, the matcher:** 124 filers (4,950 rows); the base places 120, the new 124, the same 120; placed differently 0, a planted pair proving that count can move; the four new on claim 6's bioguides; unplaced 0.
- **Leg B, the dry run on prod:** fetched and kept 4,950 (House 4,648, Senate 302), window Jan 1 to Nov 5, `domain` 0 beside 2,783 FMP rows in that window; would insert 4,950, update, delete and refuse 0; matched 4,950, `ownerOther` 0; prod's counts the same before and after.
- **Leg C, the pages** (a local `next start` on prod's database, beside prod's served HTML): the credit and licence link on `/trades` and both hubs (Khanna, Tuberville), the Senate note on Tuberville's only; `/` reads Nvidia, Lockheed, Alphabet and Nasdaq Composite 0 against prod's 1, 2, 2 and 1, the control 1 on both; `/welcome` prints labels upper-cased, and reads NVIDIA, LOCKHEED, ALPHABET and NASDAQ 0 against prod's 4 each, the control *10Y TREASURY* 4 on both. Captures at 1440, the trade rows masked.
- **Leg D, the FMP gate:** the four files gone (4 at the base); `vercel.json` 19 entries, none `source=fmp`, 19 routes (20, 1 and 19); `MARKET_SYMBOLS` FRED 4, Kalshi 3, Polymarket 3, none of the seven; claim 5's grep 1, not 0: `lib/markets.ts:38`, the HO 227 note § 2 keeps; HO 805's sweep 70, each a RECORD clause or a dated diagnostic, probe or mock, none current-tense in `app/`, `lib/`, `components/`, `README.md` or `.env.example`.
- **The gates:** the cold build on Node 25.5.0 exit 0 in 60 s, 16 of 16 pages, 0 warnings; `typecheck` 0 on both; `check:odds-sites` and `check:design-citations` OK.
- **Docs:** README's five sites; backlog `:30` gains its dated note with two lines after it, `:172`, `:528` and `:541` gain notes, `:638` and `:640` strike, reconcile 270 / 383 on 653; oddities' two lines and one entry; SKILL alone and last.
- **Flagged in the paste:**
  - DOW's 2 rows on Jun 10 before § 5d's instant, hour for hour with SPX's and NDQ's first rows after Stooq died, which § 5d as written keeps;
  - § 5's `/welcome` tokens, which can't read there, and the upper-case ones that do;
  - claim 5's grep at 1; the build on Node 25.5.0;
  - the feed's weak `ETag`, against SKILL's *no validators*;
  - three SKILL lines rewritten outside the list (`:82`, `:83`, `:1341`) and `getMemberTrades`' tag comment.
- **Owed at the FF:** § 5 and its reads, then `:30` strikes in the next docs commit.
- **Also notes now run through HO 806.**

**Also (HO 807), the GradShow fixes: seven things a judge would hit on prod, from the chat's Nov 7 sweep, plus three ride-alongs from HO 806's review.** Built on `807-review` from `3acf351` in eleven commits; prod was read by `SELECT` only, and § 11, the FEC refresh, runs on the FF go.
- **HO 806's FF go, as taken:**
  - `main` at `3acf351`: six commits, no force, `806-review` deleted on both sides.
  - The gates: the cold build on Node 25.5.0 exit 0, 16 of 16 pages, 0 warnings, the route table unchanged; `typecheck` 0; both checks OK; the hash audit 0 secret hits in 56 files.
  - The push `3e47616..3acf351` at 3:03:28 PM MST Nov 7 (22:03:28Z).
  - Production record `7627683110`, `success` at 3:04:13 PM MST, deployment `dpl_3tDWKUy8FPAaE91JJvhDFivZf9g8` (Node 24.x). `verify:deploy` read `3acf351` on 5 consecutive reads; CI `42418785774` passed on Node 20.20.2; `e2e-prod` `42418841691` passed, smoke 141.
  - § 5, 3:09:49 to 3:09:51 PM MST, every bar met. FMP's 2,783 trades and the seven symbols' 16,737 ticks were deleted, with DOW's 23 (ruling 1, Jun 10 00:00Z) and GOLD's 8; `sync:trades` inserted 4,950 `csw:` rows, and the flush answered 200. The reads after: 0 FMP-shaped rows, NULL `bioguide_id` 0, and 0 FMP tokens on `/` and on `/welcome` (ruling 2's upper case). The box's four FMP copies were deleted.
- **The chat's ruling for claim 3:** a tick that hadn't landed when claim 3 came up is recorded as such, and read before the review push, with its HALTs applying then.
- **STEP 0, a check: claims 1 to 12 hold, none a HALT** (Nov 7, 3:58 to 4:15 PM MST, and claim 3 at 5:03 PM). Recorded:
  - claim 5's diagnostic read 474 members, 6 with no raceId (the five two-year delegates and Puerto Rico's resident commissioner, whose row reads 2026), 0 with no `races` row and 0 mismatches;
  - LAST SYNC's two readings differ: 11:00 AM MT against 10:28 AM MT;
  - TOP STALLS' set is 891 (652 House, 239 Senate), 731 ms cold;
  - the Oct 26 week holds `119-hr-952` alone, the two stamps differing on 0 of 49;
  - the strip descriptions are 83.1 and 75.4 px at 375;
  - FEC's key resolves to `FEC_API_KEY`, differing from Congress's, and 527 members would refresh;
  - `lib/matchMember.ts` has 2 marks;
  - the tick, #31428, ended `success` with `fetched` 4,950, `inserted` 0, `matched` 4,950, `error_message` null.
- **§ 1 (`fix`):** past this year's election day the member hub's cell reads `{year} ELECTION` and the seat's race in the race page's words, the incumbent's tag or the result's qualifier with the race's header, or the header alone. There's no cell without a `races` row.
- **§ 2 (`fix`):** a `<wbr />` after the masthead's root and after each separator.
- **§ 3 (`fix`):** LAST SYNC reads the newest `/api/sync` run that isn't `error` or `orphaned`, and phones print SYNC.
- **§ 4 (`fix`):** TOP STALLS' badge reads `getStaleBillsCount`, the stale set.
- **§ 5 (`fix`):** `lib/enacted-in-week.ts` counts a week's laws on both clocks, for the report's `laws_count` and the summary's list.
- **§ 6 (`fix`):** below 700, each `/members` strip head's description takes its own line.
- **§ 7 (`chore`):** the matcher's two marks became the escape; cron-health's two comments were rewritten (the POLY-SHUTDOWN reason; 54 rows a day, 8,267 in all).
- **§ 8 (`test`):** the narrow spec's first-label check, and the feed-tabs test's badge against its rows.
- **The claim 5 diagnostic** lands alone as a `diag` commit; the handoff named the file and listed no commit for it.
- **The legs** ran on a local `next start` against prod's database, the befores on `3acf351`'s build:
  - **A:** 23 of 23 after-election-day hubs match their race page's word and header in the served HTML. King (2030) reads as before, and Norton has no cell (`data-cells` 2, 3 before).
  - **B:** `119TH` reads 1 rect at 375, 390 and 430 on four pages (2 before).
  - **C:** *LAST SYNC 11:00 AM MT* on `/`, `/bills` and `/welcome` (10:28 before), and *SYNC* at 375.
  - **D:** badges 891, 652 and 239 over 60 rows ((5) before).
  - **E:** `119-hr-952` in `readEnactedInWeek` and in the payload's `enacted`, where the old query reads none.
  - **F:** the descriptions sit on their own line at full width at 375 and 390, and the boxes at 1440 match the base.
  - **G:** 0 marks; 124 of 124 filers, 0 placed differently; `market_ticks` 8,267 rows, 54.0 a day.
- **The gates:** the tree's cold build on Node 25.5.0 exit 0, 16 of 16 pages, 0 warnings, the route table unchanged; `typecheck` 0; both checks OK; narrow 40 of 40 at 430 and at 390; smoke 46 of 47, the miss the `@nonci` markets hover that `e2e-prod` skips.
- **Docs:** backlog `:15` gains its dated note, `:28` and `:30` strike, and the FEC refresh line follows `:32`; reconcile 270 / 383 on 653 → 269 / 385 on 654. Oddities gain a line and one entry; SKILL is alone and last.
- **Flagged in the paste:** the sixth null raceId; the diag commit; the FEC log's masked key; the `:168` → `:169` shift in the new backlog line; SKILL's absent `sync:fec` entry and its ride-alongs; the smoke miss.
- **Owed at the FF:** the push, `verify:deploy`, CI and `e2e-prod`; prod reads of Collins's hub, TOP STALLS on `/` (`:15` strikes after) and LAST SYNC beside `cron_runs`; then § 11.
- **Also notes now run through HO 807.**

**Also (HO 808), SHUTDOWN reads Kalshi alone and `/welcome`'s marquees fill a wide screen: two GradShow fixes found after HO 807 was written, plus three ride-alongs from HO 807's FF go.** Built on `808-review` from `cdfda2f` in six commits; prod was read by `SELECT` only.
- **HO 807's FF go, as taken:**
  - `main` at `cdfda2f`: eleven commits, no force, `807-review` deleted on both sides.
  - The gates: the cold build on Node 25.5.0 exit 0, 16 of 16 pages, 0 warnings, the route table unchanged; `typecheck` 0; both checks OK; reconcile 269 / 385 on 654; the hash audit 0 secret hits in 91 files.
  - The push `3acf351..cdfda2f` at 5:27:29 PM MST Nov 7 (00:27:29Z).
  - Production record `7629138254`, `success` at 5:28:22 PM MST. `verify:deploy` read `cdfda2f` on 5 consecutive reads; CI `42429830393` passed; `e2e-prod` `42429895186` passed, smoke 141, both new assertions among them.
  - The prod reads, 5:30 PM, each met: Collins's hub reads *2026 ELECTION · DEFEATED* with the header linked to `/race/S-ME-2026`; TOP STALLS reads (891) over 60 rows once open, against 891 by `SELECT`; LAST SYNC reads 5:00 PM MT, the start of #31428.
  - § 11: the planted control masked the line; `CBT FEC refresh` registered at 5:37:27 PM, hourly for 24 hours from 6:42 PM; the hand-started first run returned 0, 55 of 55 calls, 27 totals upserted, the log masked (`(len=` 0 times, the hash audit 0).
- **The go's ride-alongs:** a, `logResolvedFecKey` prints the key's source and length; b, a backlog line for Puerto Rico's resident commissioner; c, `:15` strikes on the FF's read.
- **STEP 0, a check: claims 1 to 5 hold, none a HALT** (Nov 7, 5:40 to 5:46 PM MST; the first attempt halted at claim 1 at 3:46 PM, before HO 807's FF). Recorded:
  - `POLY-SHUTDOWN` 0 rows, against `POLY-FEDCUT` 829 and `POLY-RECESSION` 826;
  - the newest markets run, #31426, names `POLY-SHUTDOWN` in its `error_message`;
  - MARKETS' half 794.3, 859.8 and 990.3 px against masks of 1,130.8, 1,587.4 and 2,180.8 at 1440, 1920 and 2560; ODDS' (the control) 1,904.6, 2,069.3 and 2,397.9, each past its mask.
- **§ 1 (`fix`):** SHUTDOWN reads Kalshi alone. `POLY-SHUTDOWN`, `fetchPolymarketShutdown` and the uncalled `fetchPolymarketMacro` are gone; a pair with no secondary renders K alone, with a hover line saying why; cron-health's ghost read went, and its comments keep the reason as history. No data change.
- **§ 2 (`fix`):** `/welcome`'s strips repeat to a floor of 14 items a half at 5.8 s an item: MARKETS 16 over 92.8 s, ODDS 15 over 87 s.
- **Ride-along a (`fix`):** `logResolvedFecKey` prints `FEC key source=… length=N`, and `maskApiKey` is gone. The planted 40-character control read `value=PLNT…TNLP (len=40)` before and `length=40` after, with no character of the plant.
- **§ 3 (`test`):** three untagged smoke tests: SHUTDOWN's one group and FED CUT's two on `/`; no P on SHUTDOWN and one on FED CUT on `/welcome`; each half at least its strip at 1440 and 2560. All three fail on prod's `cdfda2f` (the red control) and pass on the local build.
- **The legs** ran on a local `next start` against prod's database, the befores on `cdfda2f`'s build:
  - **A:** SHUTDOWN reads *K 39.0%* alone on `/` (1 group, 2 before) and on `/welcome` (no P, *P N/A* before); FED CUT and RECESSION keep both; the hover carries the Kalshi-only line and FED CUT's (the control) doesn't; `MARKET_SYMBOLS` 9, no `POLY-SHUTDOWN`.
  - **B:** halves of 3,177.4 and 2,977.8 px at 1440, 3,439.0 and 3,232.6 at 1920, 3,961.0 and 3,740.9 at 2560 (MARKETS, ODDS), each past its mask; the pace 34.2 to 43.0 px/s against ODDS' 36.6 to 46.1 before, about 7% under.
- **The gates:** the cold build on Node 25.5.0 exit 0, 16 of 16 pages, 0 warnings, the route table unchanged; `typecheck` 0; both checks OK; smoke 49 of 50, the miss the `@nonci` markets hover that `e2e-prod` skips.
- **Docs:** backlog `:15` and `:165` strike, and the resident commissioner's line follows the rollover checklist's block (`:247`); reconcile 269 / 385 on 654 → 268 / 387 on 655, and the FF go's two dictated lines (`:248` and `:249`) took it to 270 / 387 on 657. Oddities gain a line and one entry; SKILL is alone and last.
- **Flagged in the paste:** the markets signal's history (the shared fmp route string forced it at HO 477, the ghost was what it backstopped); `fit-finish`'s `/welcome` count (6, now 10; local-only, unnamed, unchanged); the stale BotID notes (`e2e-prod`'s runner saw the tape); the Kalshi-only line's existing class; comments beyond the named ones; the moved anchors, `:236` among them; SKILL's additions; the FEC task running this checkout; ride-along a's commit third.
- **Owed at the FF:** the push, `verify:deploy`, CI and `e2e-prod`; prod reads of `/welcome`'s halves at 1440 and of the first markets run after the FF, whose `error_message` no longer names `POLY-SHUTDOWN`.
- **Also notes now run through HO 808.**

**Also (HO 809), the FEC refresh's close, the last GradShow item, with HO 808's leftovers: the markets runs after its FF, the prod database's host out of four docs, the roadmap's reconcile, and `fit-finish`'s count.** Built on `809-review` from `fa40186` in three commits; prod was read by `SELECT` and its served HTML, and written once, by § 1's cache flush.
- **HO 808's FF go, as taken:**
  - `main` at `fa40186`: the push `cdfda2f..fa40186` at 7:11:01 PM MST Nov 7 (02:11:01Z), no force, `808-review` deleted on both sides.
  - Production record `7630119998`, `success` at 7:11:47 PM MST. `verify:deploy` read `fa40186` on 5 consecutive reads; CI `42437422984` passed; `e2e-prod` `42437481834` passed, smoke 144, the three new tests among them.
  - `/welcome` at 1440, met: MARKETS' half 3,177.4 against a mask of 1,130.8, ODDS' 2,977.8 against 1,158.0, and SHUTDOWN reads *K 39.0%* alone.
- **STEP 0's markets read, HO 808's owed read, met:** every `/api/cron/markets` run since the FF, six from #31469 (9:00 PM Nov 7) to #31676 (5:00 PM Nov 8), reads `success` with `error_message` null, so none names `POLY-SHUTDOWN`; the control #31426 (5:00 PM Nov 7, before the FF) still does. `markets-run-808-ff.ts` reads the newest 4 runs, which no longer reach the control, so the read widened to every run from it on (`809-artifacts/markets-809.ts`).
- **STEP 0, a check: every claim holds, none a HALT** (Nov 8, 6:23 to 6:43 PM MST). It is the re-run after two halts at claim 2 on Nov 7 (10:47 and 11:35 PM, 19 and 18 runs left), with the chat's two rulings: claim 3's bound, and § 4's `REVALIDATE_URL` line. Recorded:
  - claim 2: at 6:23 PM `NextRunTime` read 6:42:26 PM, the end of the trigger's one-day window, so STEP 0 waited; at 6:42:55 PM the task read `Ready`, `LastTaskResult` 0, its last run 5:42:27 PM and no `NextRunTime`, the end instant counted a missed run (`NumberOfMissedRuns` 1) rather than run;
  - claim 3, under the ruled bound: 25 runs; the last isn't capped (3 of 55), `api_errors` 0, and its `totals_failed` 3 equals its three `totals empty` lines (Blair, Julie Johnson, Zinke), each in claim 4's tail;
  - claim 4: 539 considered, 527 fresh, 12 stale, exactly the members the log names (9 `no FEC match`, 3 `totals empty`);
  - claim 6: the host at the four tracked sites by hash, and `your-database` at `.env.example:3` and `docs/handoffs/11-git-prep.md:40`;
  - claim 7: `fit-finish`'s `/welcome` test on `fa40186`'s cold build failed at `toBe(6)` with 10, each ODDS label 10;
  - claim 8: `REVALIDATE_URL`'s host is `localhost`; over the 25 runs, `Flushed` 0, `Revalidate POST failed (non-fatal)` 25 (`ECONNREFUSED` each), `not set` 0.
- **§ 1, the close (backlog `:33`):** `member-fundraising` flushed once through prod's `/api/revalidate`, 200, `{"ok":true,"tag":"member-fundraising"}`; Dunn's hub then read *as of 2026-09-30* and Collins's *as of 2026-10-14*, their rows' dates, where a minute before they read the sweep's *2026-03-31* and *2026-05-20*; `CBT FEC refresh` unregistered and read absent, `CBT odds snapshots` absent as before.
- **§ 2, flag 1:** the prod database's URL leaves SKILL `:2678`, roadmap `:423` and backlog `:209`, each now reading *(`TURSO_DATABASE_URL`, by name)*, and its host leaves `docs/probes/788-bills-gap.md:168`. A script read the value in-process and found each span by hash, so nothing printed it; the whole tracked tree then read 0 hits for either, the `.env` control firing.
- **§ 3 (`test`):** `/welcome`'s ODDS test holds FED CUT to SHUTDOWN and RECESSION, one of each a copy, and to an even count of at least 2; it passes on the head's build (10, 10, 10) and fails on the red control, FED CUT's pair listed twice in a scratch worktree, never committed (16 against 8).
- **The gates:** the head's cold build on Node 25.5.0 exit 0, 16 of 16 pages, 0 warnings, the route table unchanged; `typecheck` 0; both checks OK; `fit-finish` 46 passed and 1 skipped (`:849`'s own skip, no pagination on `/lobbying?issue=HCR`); smoke 49 of 50, the miss the `@nonci` markets hover that `e2e-prod` skips.
- **Docs:** backlog `:33` and `:248` strike, `:209` is § 2's, and the chat's ruled line for the box's `REVALIDATE_URL` follows `:33`, so the base's `:247` to `:249` now sit at `:248` to `:250`; reconcile 270 / 387 on 657 → 269 / 389 on 658. Roadmap `:9252` gains its dictated clause and `:423` is § 2's: two edits inside prior blocks, which `:235`'s append-only rule bars, both by the handoff. SKILL is alone and last.
- **Flagged in the paste:** claim 5's widened read; claim 2's wait and its missed-run count; Julie Johnson, the tail's third `totals empty`; the two prior-block edits; the ruled line's additions and its place; a stray `/tmp` write, deleted; a filtered process query at one bind check.
- **Owed at the FF:** the push, `verify:deploy`, the served SHA, CI and `e2e-prod`; the `cbt.zip` rebuild after GradShow (the `docs(skill)` commit).
- **Also notes now run through HO 809.**

**Also (HO 810), the GradShow poster's bills and laws by sponsor's party, in the dome's own scope and predicate.** Built on `810-review` from `1ebc2aa` in two commits; prod was read by `SELECT` only. This block, like the two after it, is HO 812's docs commit.
- **HO 809's FF go, as taken:**
  - `main` at `1ebc2aa`: the push `fa40186..1ebc2aa` at 7:53:20 PM MST Nov 9 (02:53:20Z Nov 10), no force, `809-review` deleted on both sides.
  - Production record `7672199535`, `success` at 7:54:00 PM MST. `verify:deploy` read `1ebc2aa` from the first read. CI `42745792399` and design citations `42745792529` passed, and `e2e-prod` `42745863757` passed, smoke 144.
  - Inline after the FF, the box's `.env` changed. `REVALIDATE_URL` was set to prod's `/api/revalidate` (8:37 PM MST), and a one-off flush read 200. Both `FMP_API_KEY` lines came out (0 by name at 9:53 PM MST). Backlog `:34` and `:32` strike in HO 812's docs.
- **STEP 0, re-derived at `1ebc2aa`, a check: none of its seven claims failed.** The handoff's Nov 5 floor 246 and committee 15,622 read as HO 799's stored 294 and 15,574, with the 48 calendar placements at `floor` counted as committee.
- **A, the party field:** `sponsor_party` in the dome's scope reads R 8,587 · D 7,997 · I 93, with NULL and empty 0, so no HALT.
  - Its one writer, `lib/sync.ts:324`, rewrites it from Congress.gov's first sponsor on every upsert. But a bill is refetched only when its Congress.gov record moves.
  - The one party switcher, Kiley (R → I, 2026-03-09), keeps 20 bills at R and 3 at I.
- **B, the card** (run 810, as of 9:49:09 AM MST Nov 10): REPUBLICANS 8,587 BILLS · 107 LAWS · 1.25%; DEMOCRATS 7,997 · 19 · 0.24%; INDEPENDENTS 93 · 0 · 0.00%.
  - B2 splits it by the chamber a bill started in. B3 is one bill (`119-sjres-82`). B4 finds no law whose `sponsor_party` differs from `members.party`. B5's members probe is absent.
  - Four HALT checks ran, none hit. The handoff's B2 check is an identity inside one snapshot, so one against the dome's own statement by chamber was added.
- **C, the dome:** 16,677 bills, +13 on the printed 16,664, and its 126 laws held, none observed since Nov 5. Two R-sponsored bills sat at `president`.
- **The run:** 810, 9:49:04 to 9:49:09 AM MST (16:49:04 to 16:49:09Z): 32 statements, 425,666 `rows_read`, the fingerprint `4e94644350e1d992` before and after.
  - The script was reviewed read-only before it: 8 agents, 4 of 15 findings confirmed, all minor, each fixed.
  - The findings file was checked against the record after it: 6 agents.
- **Commits:** `13a7e02` (`diag`, `scripts/diagnostic/gradshow-party-810.ts`, a sibling of HO 799's script) and `f67e7d3` (`docs`, `docs/probes/810-gradshow-party.md`).
- **Also notes now run through HO 810.**

**Also (HO 811), the GradShow poster's Colorado delegation: each member's bills and laws in the dome's scope and predicate.** Built on `811-review`, stacked on `810-review` at `f67e7d3`, in two commits; prod was read by `SELECT` only.
- **STEP 0, re-derived at `f67e7d3`, a check: none of its seven claims failed, and no HALT.** The HO number is 811, not the pointer's next (810), since HO 810 was already in flight.
- **A, the delegation:** ten serving members, two senators and CO-1 to CO-8. They come from the `members` roster as of Sep 11 (`npm run sync:members`, run by hand), and nobody has left.
- **B, the card** (run 811, as of 10:40:02 AM MST Nov 10): the ten member lines, COLORADO 358 BILLS · 1 LAWS · 0.28% and CONGRESS 16,677 BILLS · 126 LAWS · 0.76%.
  - Colorado's one law is `119-hr-2316` (Hurd, P.L. 119-40).
  - The 4 ceremonial bills are excluded, and none of them is a law.
- **C:** the dome's 126 held. The median member with a bill in the dome reads 52 bills · 0 laws for a senator and 22 · 0 for a House member.
- **Two wording points for the poster chat:** `1 LAWS` follows the handoff's template, and the House label `CO-n` is HO 811's.
- **The run:** 811, 10:39:50 to 10:40:02 AM MST (17:39:50 to 17:40:02Z): 30 statements, 309,957 `rows_read`, the fingerprint unchanged.
  - The script was reviewed read-only before it: 6 agents, 1 of 15 findings confirmed, fixed.
  - The findings file was checked after it: 4 agents.
- **Commits:** `725537c` (`diag`, `scripts/diagnostic/gradshow-colorado-811.ts`) and `64aad1d` (`docs`, `docs/probes/811-gradshow-colorado.md`).
- **The go (Nov 10), as taken:**
  - `810-review` at `f67e7d3` and `811-review` at `64aad1d` were pushed as new branches at 11:41 AM MST. `ls-remote` read both, beside `main` at `1ebc2aa`.
  - The flagged decisions stand: the numbering, the sibling scripts, the Nov 5 floor and committee reading, and the added B2 check.
  - Then an inline, read-only law check ran against Congress.gov's official list (`docs/handoffs/811-artifacts/laws-check-811.ts`, 11:44 AM MST). It read 138 public and 2 private laws, and CT held 139 at `enacted`. One was short: `119-hr-1043` (P.L. 119-68, Gosar, R-AZ), at `committee`. None was missing and none CT-only. HO 812 fixed it.
- **Also notes now run through HO 811.**

**Also (HO 812), P.L. 119-68 read `committee`: `119-hr-1043` set to `enacted` by hand, then the poster's print read, with 127 laws.** Built on `812-review`, stacked on `811-review` at `64aad1d`, in four commits.
- **Prod took one statement and one flush;** everything else read it by `SELECT` and its served HTML.
- **The findings are in `docs/probes/812-laws-vs-official.md`.**
- **Why it read `committee`:** `computeStage` reads the latest action alone (`lib/enums.ts:97`). This law's latest action is a Senate committee's written report, filed Feb 11, six weeks after the law was signed. The sync can't correct it: it only advances (`lib/sync.ts:404-416`), and a re-fetch computes `committee` again.
- **STEP 0, a check (12:14 PM MST Nov 10): seven claims hold, none a HALT.**
  - Claim 1: `ls-remote` read `main` `1ebc2aa`, `810-review` `f67e7d3` and `811-review` `64aad1d`.
  - Claim 2: the row read `committee`, `is_ceremonial` 0, with a summary stored and `$.laws` naming 119-68.
  - Claim 3: the law check read 138 public and 2 private laws, 139 held, one short.
  - Claim 4: no `sync_queue` row.
  - Claim 5: no `stage_transitions` row and no stamp. The summary at 7:40:44 PM MDT Oct 28 (01:40:44Z Oct 29) left `pending_stage` NULL, so the row read `committee` at the printed dome's as-of.
  - Claim 6: the dome's laws read 126, and 139 at any tag.
  - Claim 7: no `print` label was taken.
- **§ 1, the write:**
  - `before.tsv` came first (12:15:56 PM MST), the reversal list.
  - Then the one `UPDATE`, `rowsAffected` 1, with no stamp and no `stage_transitions` row, as the chat ruled.
  - The `bills` flush read 200 `{"ok":true,"tag":"bills"}` at 12:16:07 PM.
- **§ 2, the reads after:**
  - The row reads `enacted`, the stamp columns NULL.
  - 127 laws in the dome (R 108, D 19), and 140 at any tag. The law check reads 0 short.
  - `/` reads *127 enacted*, `/welcome` *127 Became law*, and the bill page ENACTED.
  - MOVERS doesn't list the bill: a read of `/`'s whole HTML at 1:05 PM, script payload included, finds it 0 times, and its 27 MOVERS rows don't include it.
  - Gosar's hub reads *Enacted 1 (3.7%)*.
  - The fingerprint is unchanged.
- **§ 3, the print read** (12:18:16 to 12:18:32 PM MST):
  - THE DOME, NOV 10, 2026, 12:18 PM MT: BECAME LAW 127 · ON THE PRESIDENT'S DESK 3 · PASSED ONE CHAMBER 565 · REACHED THE FLOOR 245 · NOT REFERRED YET 105 · IN COMMITTEE 15,637 · BILLS 16,682 · CEREMONIAL 404 · ALL 17,086.
  - REPUBLICANS 8,588 · 108 · 1.26%, DEMOCRATS 8,001 · 19 · 0.24%, INDEPENDENTS 93 · 0 · 0.00%.
  - Colorado's lines read as at 10:40 AM, and CONGRESS 16,682 · 127 · 0.76%.
  - The printed Nov 5 dome, restated: 127 laws, 15,621 in committee.
  - One hand tag moved: `119-hr-1945`, HO 803's 1, now 0, named and not re-set.
- **Commits:**
  - `d80b970` (`diag`): `scripts/diagnostic/laws-vs-official-812.ts`, the law check tracked with `--label`. Record run `812` at 12:22 PM read 140 of 140, 0 short.
  - `docs`: the new findings file, and a print reading appended to HO 799's, 810's and 811's.
  - `docs`: the backlog, the roadmap and the oddities.
  - `docs(skill)`: the limit at `computeStage`, alone and last.
- **Docs:**
  - Backlog `:32`, `:34` and `:86` strike. The new line, *a law can read short of `enacted`*, follows `:27`'s Senate resolution at `enacted`, so the three strikes now sit at `:33`, `:35` and `:87`. The reconcile goes from 269 / 389 on 658 to 267 / 392 on 659.
  - The roadmap gains this block and HO 810's and 811's, each ending on its pointer. The oddities gain one entry.
- **Flagged in the paste:**
  - `/`'s masthead says *enacted*, not *Became law*.
  - `:34`'s 8:37:46 PM flush time is the handoff's, and the artifacts carry no stamp.
  - The law check ran twice in § 2.
  - HO 810's verdict line ends on an empty list.
  - Gosar's hub had the fix before any `members` flush.
  - The 11:00 AM sync's five bills and one more bill at `president`.
  - `:86`'s two HO 801 runs weren't among the four.
  - The served-page patterns missed two pages, so a second GET quoted them.
  - MOVERS was read again from the whole HTML at 1:05 PM, since the first page read stripped the script payload where a closed tab's rows travel.
- **Owed at the FF:** the chat's one go covers HO 810, HO 811 and HO 812.
  - On the head: the cold build and the gates, then the push to `main` and the three review refs deleted.
  - Then `verify:deploy`, CI and `e2e-prod`. No prod read is owed beyond § 2's.
  - The `cbt.zip` rebuild after GradShow (the `docs(skill)` commit).
- **Also notes now run through HO 812.**

**Also (HO 813), `/welcome` rebuilt as the lobby: one typeface, a 1200px column, the stage funnel beside the headline, the live board kept as the preview, the terminal's chrome left behind the door.** Built on `813-review` from `main` at `8caff27`, in four commits.
- **The ruling, verbatim** (Corey, 3:44 PM MST Nov 10, on `docs/design/mock-813-landing-scroll.html` v7): *"HEADLINE wtf · LEAD both · BESIDE funnel · SECTIONS week+board+pages+how · PAGES 3 · WIDTH 1200"*.
  - On the wordmark (3:46 PM): *"this needs to change. its to small and its the name of the damn thing"*, built as a 28px wordmark with the terminal's `:\>` in amber. Then *"nope this works"* (4:02 PM) on the result.
  - The mock lands unedited, 31,303 bytes, sha256 `9aa71e2f4c5004a9e6d4658e67c28006217e440d5e72ba227a60d22892696cd2`. The one-screen, mono-only brief (`docs/design/landing-page-design-brief.md`) carries a supersession note and is record.
- **Three places the build departs from the mock, by the handoff:**
  1. The week line prints the week its report covers, *The week of Nov 2.*, not *This week in Congress.*: the newest report covers an earlier week.
  2. The third How-it's-built heading is *Where the data comes from*, not *Ten sources, their own clocks*, which counted wrong, and the hero's facts line counts no sources.
  3. Members prints no count. The mock's 536 is the nav tooltip's literal, and the build prints a count only from a query.
- **What left the page:** the rail, BREAKING, the tapes, the clock and the bottom rail. The dashboard keeps all of them. `WelcomeClock` stays as a component, since both mastheads mount it.
- **What ships:** the top bar (the wordmark, *Beta*, the last sync, *Open the terminal*); the hero (the HO 670 headline, the ruled lead, a facts line with the 119th's dates and the 120th's start, *Enter the terminal*, the search with four quick picks, and the funnel card beside them, `components/LandingFunnel.tsx`); the week line; Live (the HO 670 board as three cards, its nine notes without middle dots); What's inside (the nine pages, with counts only from reads the page makes); How it's built; the footer.
  - A bill reference searched from a page load goes to its bill page: `lib/bill-ref.ts` and `app/search/page.tsx`.
  - The funnel's bar geometry moved to `lib/stage-funnel-geometry.ts`, and the dashboard's `StageFunnel` reads it too. `monDd` is exported from `lib/week-summary.ts`, and `WeeklyBand`'s copy is retired.
- **STEP 0 (5:21 to 5:31 PM MST Nov 10): five claims, none a HALT.**
  - Claim 1: `ls-remote` read `main` alone at `8caff27`.
  - Claim 2: the anchors held, but some were re-cited. `page.tsx`'s `loadBoard` is at `:245`, `enacted` and `lawRatio` at `:258-260`, the tapes at `:365-448`, the board at `:450-454` and the foot at `:456-509`. Smoke's marquee test runs to `:1174`. The clock's held-mount line is `:314` and already struck: the clock shipped to both mastheads. No backlog line flagged the tooltip's 536, so one is filed now.
  - Claim 3: the mock matched, 31,303 bytes.
  - Claim 4: in one read-only transaction at 5:31:08 PM, the bars summed to 17,285, equal to `getCorpusStats(true).total`, with 0 off the path.
  - Claim 5: `HeaderBar` and `DashboardV2Header` import `WelcomeClock` too, so the component stays and backlog `:135` doesn't strike.
- **The review before commit:** five read-only agents checked the diff against the handoff and the mock, and every ruled string matched. Three code fixes came from it:
  - **The fast path takes a page load only.** `SearchBox` pushes `/search?q=` at each typing pause, so the handoff's literal redirect carried a reader typing `HR 3978` to `/bill/119-hr-39` at a pause (measured on an unguarded local build, 6:15 PM). A client-router fetch carries Next's `rsc` header and a non-`navigate` `Sec-Fetch-Mode`, and it now skips the redirect.
  - The lobby's link sets the cookie on a middle-click and on the context menu too, since neither fires `click`.
  - The wordmark is weight 600, since the app declares Plex Sans at 400, 500 and 600, and a 700 rendered the 600 face anyway.
- **Ruled at the FF go (Nov 10), and fixed up on the ref before the FF.** Three ruled lines were corrected for truth (flag 3, the handoff's guard 3), one departure from the mock was reversed (flag 4), and the hearings count's rule was replaced (flag 6):
  - *Six stages* reads *A bill's stage is read from its latest action. The count of laws is checked against the official list of public laws, so a bill that became law and then received a committee report still counts as a law.* The check is HO 812's tracked script, and backlog `:28` makes it routine.
  - Live's sub reads *Nine feeds, in rotation.*, true at every width. *Nine feeds, three at a time.* wasn't at 760px and under, where the board is one panel.
  - Roll Call is a configured feed (`lib/news-sources.ts:39-44`), so the column reads *The Hill, Politico and Roll Call for news*, and the footer's list gains *Roll Call* after *Politico*.
  - The wordmark's `:\>` follows the mock, `#fbbf24`, which is `--accent-amber-bright`; the handoff's `--accent-amber` in § 6 was the chat's slip. The build's other departures from the mock are ratified as built: the wordmark at weight 600, the `--fs` ladder for sizes from 9 to 14px, the `color-mix()` greys, the green *live* on the first panel, and the headings without periods.
  - Hearings counts as the dashboard's THIS WEEK does: the handoff's rule was wrong, not the count. It read the upcoming meetings alone, 3 on a Tuesday evening. The dashboard reads `getUpcomingMeetings()` and `getRecentMeetings(14)` together (`components/HearingsTab.tsx:22-27`) and counts the week's Monday to Friday. The lobby counts the same input by the same rule, each meeting once by its event id, so the two surfaces print one number.
- **Tests:**
  - Retired: `fit-finish.spec.ts`'s ODDS strip test, smoke's two `/welcome` tape tests (the P letters and the marquees' halves) and `odds-off.spec.ts`'s `/welcome` row. `e2e/odds-sites.allowlist.json` lists `app/welcome/page.tsx` as *not-a-render-site* now.
  - Amended: smoke's foot test reads the `<footer>`.
  - Added, four: the funnel sums to its title; the search, with the bill-number fast path; the nine pages; the term dates and the bill reference, with no page. The search test also holds across Jan 3, 2027, sends a five-digit unheld reference to the search, and types into the box.
  - **e2e-prod's smoke reads 144 after the FF, not the handoff's 146.** The step runs `smoke`, `odds-off` and `narrow` together (51 + 13 + 80 by `--list`). The `odds-off` row it retired ran at two viewports, so the count is 144 − 2 − 2 + 4.
  - Each new test read red against `8caff27`. The first three ran against prod's page, which had no funnel card, no search form and no *What's inside*. The fourth ran with `8caff27`'s lib, where `lib/bill-ref` doesn't exist. The typed-box leg read red on the unguarded build.
- **§ 6, re-read on a fresh local build of the fixups (7:10 to 7:12 PM MST):**
  - Smoke's `welcome|/search` tests passed with the foot and lib tests, 9 of 9. Narrow read 0 over at 430 and 390.
  - The h1 is Plex Sans at 72px at 1440, the face loaded. The primary button is `--accent-amber-bright`, the wordmark's `:\>` is `--accent-amber-bright` too (`rgb(251, 191, 36)`), and the board's ident is `--font-mono`.
  - The four corrected strings are served as ruled.
  - Hearings reads *11 this week*, and the dashboard's THIS WEEK reads 11.
  - `/search?q=HR+3978` returned a 307 to `/bill/119-hr-3978`.
  - The captures are in `docs/handoffs/813-artifacts/`. The hero's takes the top bar too, so the wordmark is in frame.
- **Docs:** backlog `:28` gains its two leftovers, and two lines are new: a re-summary overwrites a hand-set ceremonial tag, and the nav tooltip's literal 536. The reconcile goes from 267 / 392 on 659 to 269 / 392 on 661. The oddities gain one entry: `/search` runs at every typing pause.
- **Owed at the FF:** the cold build and the gates on the head, the push to `main` and the ref deleted, then `verify:deploy`, CI and `e2e-prod`, with smoke at 144.
- **Also notes now run through HO 813.**
