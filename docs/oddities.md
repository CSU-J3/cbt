# CBT Oddities & Gotchas

Field notes on the non-obvious things that broke, or nearly broke, while building this. The kind of thing worth recounting when someone asks what was actually hard about it. Append new entries at the end as you go.

Dates are exact where I tracked them live, flagged `~` where approximate, and tagged with a handoff number (HO) where the precise calendar day is best read off git. `git log` the matching `docs/handoffs/` file to pin those down.

---

> **Archived:** the entries above the first one whose heading names HO 780 or later are in `docs/oddities-archive.md`, verbatim and in order.

## A credit line can document a licence breach (HO 786, Oct 2026)

The chat audit behind HO 786 set out to credit every upstream on the surface that shows its data. FMP feeds both markets tapes (the seven symbols at `lib/markets.ts:143-156`), `/trades` and the member pages' trades (`lib/fmp.ts`), so its line would have read "via FMP" on each of them. FMP's terms bar publicly displaying its data without FMP's prior written approval (site.financialmodelingprep.com/terms-of-service, § 2.2, read 2026-10-16), so "via FMP" would have named, on every surface, a display FMP's terms bar. The audit caught it only because it read the terms before writing the line. No "via FMP" line ships, and the licence is Corey's (backlog, *FMP display licence*).

## A check that compares only the cells that printed passes over what it never read (HO 786, Oct 2026)

HO 786's first local width run (`e2e/narrow.spec.ts` against each build's server, r1) compared the tree's cells with HEAD's and passed: no route over on the tree that HEAD read clean. It passed while 9 cells on HEAD and 10 on the tree had never been read. Of 82, 73 and 72 printed. Two causes were behind the gaps:
- **`/stale` answered 500** before its test printed a cell, at both widths. The legs' `file:` copies lacked two indexes prod has and `scripts/migrate.ts` doesn't make (backlog QUEUED, the `migrate.ts` indexes line).
- **The full run's last stretch at 390 timed out** on both builds (`page.goto`, 45s). That isn't the indexes': r2 made them, and its full run still left 5 cells unread on HEAD and 6 on the tree, all in that stretch, and the same check passed again.

The check iterated over the cells that printed, so an unread one couldn't fail it. Its zero was the same whether a cell was read clean or never read at all.

The reading of record is a different arrangement: a fresh server per build and width, one worker, and a check that requires the same cells read on both builds, each changed surface among them. It read 41 of 41 at 390 and at 430 on both builds, every one `over=0`.

## `git log --reverse -1` prints the newest commit, not the first (HO 787, Oct 2026)

HO 787's handoff asked for the first commit on `main` with `git log --reverse --format='%h %ad' --date=iso -1`. It printed `88d6327 2026-10-19 13:11:53 -0600`, the HEAD it ran at. git limits the walk as it goes, newest first, and `--reverse` orders only the commits that limiting chose to show, so `-1 --reverse` is HEAD alone. `git rev-list --max-parents=0 main` names the first commit, `c578e09` (2026-05-03).

The wrong answer has the right shape: a short hash and a date, in the requested format, from the right repository. It's a designated instrument answering a different question (method.md § Gates), and it was caught because the date it printed was the day of the run.

## `/welcome`'s *LAST SYNC* is the newest Congress.gov update among the counted bills, not the time CT synced (HO 787, Oct 2026)

The GradShow poster's draft quoted the board's foot, *last sync 2:05 AM MT*, as the as-of time of its figures. The foot prints `formatMt(corpus.lastSync)` (`app/welcome/page.tsx:477`), and `lastSync` is `MAX(update_date)` over the summarized, non-ceremonial bills (`lib/queries.ts:641`): Congress.gov's `updateDate` on the newest bill it changed, not the moment CT's sync ran. The type's own comment says so (`:616`, *ISO timestamp of most recent update_date*), and the function's header still calls the line *last sync* (`:619`).

At HO 787's read the foot would have said 3:04 PM MT, while `/api/sync` had last run at 6:00 PM MT and the summarizer at 7:50 PM MT. A quiet evening on Congress.gov makes the sync look hours stale when it isn't. For an as-of time, the honest phrase is *Congress.gov's updates through …*.

HO 807 (Nov 2026): LAST SYNC now reads the sync's own `cron_runs` row, on every page and in `/welcome`'s foot: the start of the newest `/api/sync` run that isn't `error` or `orphaned` (`getCorpusStats`). On Nov 7 it read 11:00 AM MT where `MAX(update_date)` read 10:28 AM MT.

## Turbopack's `.next` holds a junction into `node_modules`, so a cold build's *remove `.next` first* is HO 737's hazard (HO 787, Oct 2026)

HO 787's cold build, before its review push, began by removing `.next`. Listing it first found a junction, `.next\node_modules\@libsql\client-6da938047d5fc1cd` → `node_modules\@libsql\client`: a link Turbopack had made to an external package. A recursive `Remove-Item -Force` follows a junction out of the tree it was told to delete (HO 737's note, above), so removing `.next` that way would have emptied the main tree's `@libsql/client`, the database client, rather than a build output.

That build unlinked it first with `cmd /c rmdir` (no `/s`), which removes the link and leaves its target. A separate process then read the target intact (24 files), `node_modules/.bin` unchanged (48 entries) and no reparse point left under `.next`, and only then was `.next` removed. The build that followed made the same junction again (created 02:08:09Z Oct 20, during that build), so the next cold build finds one too, and a cold build runs before every review push. SKILL's *Things to watch for* carries the rule (the review reply).

## A tick's own `cron_runs` row names the window it owed, so a missing bill's cause is a join, not an inference from pace (HO 788, Oct 2026)

HO 787 found CT holding 610 fewer 119th-Congress bills than Congress.gov lists, and read the gap as *about 20 days of introductions at the Congress's average pace*. That was an inference from pace, and it pointed at the wrong bills. HO 788 named them: 589 missing, their latest actions mostly in June (357) and July (148) 2026, not the newest twenty days.

The cause came from a join instead. Each `/api/sync` row's payload carries the window it owed, `fromDateTime`, beside `started_at` (`app/api/sync/route.ts:140-154`), and nothing prunes `cron_runs`. So each missing bill joins to the first row whose window `[fromDateTime, started_at)` holds its `updateDateIncludingText`, the field the list's filter reads. 583 of the 589 were first owed by a tick that stopped partway: 347 budget-stopped, 223 timed out and 13 errored. The other 6 predate the ledger. That is HO 116's stopped-tick tail (`lib/sync.ts:342-351`), and the 8,287 bills stored behind Congress.gov class the same way. No bill was owed by a tick exposed to a page-boundary tie, because no tick in the ledger has read a second page (`seen` peaks at 240).

Three traps sit in the join:
- **The payload's path.** `wrapCronRoute` stores `{ ok, elapsedMs, payload }` (`lib/cron-log.ts:170-171`), so the route's stats sit at `$.payload.sync.*`. The handoff's statements read `$.sync.*` and counted 0 budget stops; the stored path reads 126.
- **The list's dates are bare days.** The list prints `updateDate` and `updateDateIncludingText` as `"2026-10-20"`, so a list date can't be compared with `started_at` as an instant. Each bill's date to the second took one detail read.
- **Rows that name no window.** A `timeout` or `error` row stores only the failure body, and an `orphaned` row stores nothing, so 69 of the 481 rows carry no `fromDateTime`. Each takes the last named one before it, a lower bound on its own, marked *inferred*.

## An estimate carried from a biased sample read an order of magnitude low, and the HALT on the bound caught it (HO 788, Oct 2026)

HO 788's handoff sized its repair at *about 900 at HO 752's rate*: the 610 missing, plus HO 752's 3 of 200 bills behind Congress.gov (1.5%) carried across the stored corpus. The census read the whole list and found 589 missing and **8,287 behind**, 43.3% of the 19,127 stored bills. The repair was about ten times its bound, and the HO HALTed before writing.

The architect's reading at the ruling: HO 752's 200 were committee-walked bills (*a seeded 200 walked bills with rows*, the HO 752 block), and a committee-walked bill is a recently updated one. So the sample's frame was drawn from the bills the sync had recently reached, and its 1.5% measured the sync there, not across the corpus it drops from. It is the backlog header's HO 741 rule applied to a sample: a premise measured at a derived store is a measurement of the pipeline that fills it, not of the world. What caught it was the bound. The handoff stated *about 900*, the census read 8,876 before a single write, and method.md HALTs on a reading outside its bound. A repair sized off the estimate without a stated bound would have nulled 8,287 summaries before anyone counted them.

## A change log carried its largest entry as a picture, then lost the picture, and the board on the sibling page is read by its own headers' counts (HO 789, Oct 2026)

Sabato's rating-changes page is the one place its ratings exist as text: dated tables of old → new, read since HO 770. On Oct 22 its House section opened with an entry that had no table. It was a date line, *Oct. 20, 2026*, and an image, `102026houseratings.png` (the page's `og:image`, 1,253 × 2,800 px by its JSON-LD). The parser read two date lines above Oct. 8's table, and HO 770's date rule threw rather than guess which one governed. That throw is what caught it. A reader that skipped the image would have read the House through Oct. 8 and written it as current, under a sources line moved to the Senate's Oct. 14.

By that evening the image link 404ed, and the entry rendered as a broken image. The House ratings page (`/crystalball/2026-house/`, *Updated Oct. 20, 2026*, modified 2026-10-21T23:45:57Z) carried the same graphic as `102026houseratings-2.png`. It was not a list of changes but the whole board: every competitive district in eight columns, each header printing its count (R: Toss-up 8, Leans 16, Likely 20, Safe GOP Pickup 3; D: Toss-up 4, Leans 20, Likely 21, Safe Dem Pickup 3), and a footer, *Races not listed are rated as Safe for the incumbent party*.

A board reads differently from a change log. Each cell is a position, not a move, so it can't conflict with a stored label. Its silence is evidence: a race it leaves off is Safe. That makes a dropped row the one transcription error that would wrongly retire a rating, and the board carries its own guard against it, the counts in its headers. So the CLI refuses a board unless every section holds the number its header prints, before anything reads the rows (`parseSupplementCsv`), and two readers diff the rest. On Oct 23 they agreed on all 95 cells. The parser now names an image entry instead of throwing on its date: *the Oct. 20, 2026 entry is an image (102026houseratings.png), no text rows; supply a supplement or hold the chamber*.

## A deferral that waits for evidence needs an instrument and a date, not a condition (HO 790, Oct 2026)

HO 116 wrote the cursor's deferral into the code, beside the exact failure it would cause (`lib/sync.ts:342-351` until HO 790): the list was read `updateDate desc` from `MAX(update_date)`, so a tick that stopped partway moved the watermark to the freshest bill it wrote, and the older changes below it were *"skipped until they update again on their own"*. It named the resolution, `updateDate asc` plus an explicit cursor in `sync_state`, and deferred it *"until evidence calls for it"*. The evidence took 636 handoffs to arrive, because nothing measured the backlog: HO 752 sampled it (3 of 200 committee-walked bills behind) and HO 788 counted it (8,287 of 19,127 stored bills, 43.3%, 8,021 of them first owed by a tick that stopped). The comment was accurate the whole time. A condition with no instrument behind it is a deferral nobody revisits; an instrument and a date would have read the backlog growing in its first month.

The second half is the compare that looked precise and wasn't. `stored >= listUpdate` compared two strings that looked like the same kind of date. The list prints both of its dates as a bare day, `fromDateTime` filters on `updateDateIncludingText` to the second, and the stored date is the detail's instant, so the compare ran at day precision. The one bill shape that proves it, a second update on the day CT stored the first, read current to every read until a detail was fetched (HO 790's leg F, red at `b64cc81`). It stays invisible to the census that counted the rest, which compares at day precision too, so HO 790's backlog line for late-indexed same-day updates names the detail's instant as its reading, not the census.

## The zero that closed a pass was read at day precision, and the residual it couldn't see was the shape the same block had already named (HO 791, Oct 2026)

HO 790's paced pass ended on census 790b: 0 behind, 0 missing, so *there is no residual*. Its own paste says, two lines further on, that the census compares at day precision and can't see a same-day second update, which is the class the block's new backlog line filed. Both sentences were true, and the conclusion drawn from them wasn't. A zero from an instrument that reads one class current whether or not it's there says nothing about that class. The census was the right close for the older-tail drop, which moves bills across days, and the wrong one for the old compare's other loss, which doesn't. HO 791's sampler, built for the frontier's margin, read the other loss first: 47 of 500 recently updated bills behind Congress.gov on their own stored day. All 47 were stored before the frontier existed, below every listing that will run again. None was the margin's (`docs/probes/791-late-index.md`). **The rule:** when a close reads an instrument's zero, name the classes that instrument can't see, and say what reads them, in the same sentence as the zero.

The sampler's own control caught a second defect first. The handoff defined *same-day miss* (below the frontier, on U1's day) and *wide-unreachable* (below the frontier less 48 hours, on any day) so that they overlapped. The first build checked the window first, so every control bill moved back an hour on a day older than the window read *wide-unreachable*. The control said the reading was void before a single class printed. Classes written as a list of conditions need an order, or a proof that no bill meets two of them, and a control that plants a bill in each one finds out which.

## A rehearsal re-run after its rulings read its own stale expectations as FAILs, and the re-match reads the ruling, never the page (HO 795, Oct 2026)

On Oct 11, HO 777's election-night rehearsal (`scripts/diagnostic/election-night-rehearsal-777.ts`) wrote down what each race page should say on Nov 4. Two rulings then changed some of those pages on purpose:
- HO 779 kept the incumbent's tag on a called race, so HO 758's *not on the ballot* shows only where there's no tag (`components/RaceHubBody.tsx:180-188`).
- HO 783 dated Georgia's runoff: *Runoff Dec 1* (`lib/race-result.ts:177-180`).

HO 795 re-ran the rehearsal on today's tree and read 238 PASS and 9 FAIL. Seven cards showed the ruled tag where the script expected the word, and S-GA's header and word carried their date.

The handoff's own hand reads, worded from HO 777's block, read four more FAILs the same way. LA-01's were *two Advanced*, where HO 780's own record reads one beside the incumbent's card. The other three were called races whose card keeps its tag.

No page was wrong. Nine expectations and four handoff lines had been written from a block the rulings superseded, and the same tree read them as FAILs. A rehearsal that reads nine known-stale FAILs is a gate nobody can read: the next real FAIL would sit among them.

**The rule:** a rehearsal's expectations are the rulings' text. A re-run after a ruling re-matches them before it reads, each new expected string taken from the ruling's code or block and citing it.

**The tautology guard:** the re-match reads the ruling, never the page. An expectation copied off the page it checks passes whatever the page says. HO 795 derived the seven tags from the seed's data and the rulings' order and words (`docs/handoffs/795-artifacts/rematch-derivation-795.log`). A second derivation, barred from every log and capture and from the first derivation, reached the same eight expectations from the rulings and the copy alone. Only then did it re-run the same copies, which read 247 / 0 / 1.

The derivation's own first pass shows why the guard has to be independent. It read GA-13's NULL curated flag as 0 and printed RETIRING, and the slip surfaced as a disagreement with the page the author had already seen. The rule's text, `= 0` (`lib/incumbent-qualifier.ts:34`), corrected it, and the independent derivation, which never saw a page, is what makes the corrected string the ruling's and not the page's.

## A probe's own input outlived it: the MAP-card check typed a seat into the cartogram's search, the LIST kept the filter across the tab switch, and the next reading counted one row (HO 798, Nov 2026)

On Nov 4 the eight reads' script (`docs/handoffs/798-artifacts/reads-798.mjs`) read `/electoral`'s LIST on the Senate tab, 14 rows with 12 won, then checked a called seat's MAP card for a Kalshi line the way HO 777's rehearsal does: switch to MAP, type the seat into the search, open the card by its chevron. It switched back to LIST and clicked HOUSE. The House leg then read one row, S-IA's, and FAILed *every decided rated race is a won row* with 53 races missing.

The page was right. The search box still held `IA SEN`; the cartogram's search filters the LIST as well as the MAP, and the filter survives the tab switch. The rehearsal never met it because its MAP check runs after both tabs are read (`election-night-rehearsal-777.ts:709-726`), and the night's dry run never met it because the Senate tab then had no called seat to search for.

The fix was a reset before each tab (clear the search, return to LIST), the reads were re-run seven minutes later as the record (64 PASS, 0 FAIL, 2 N/A), and the first run stays on file beside it.

**The rule:** a probe that types into a page undoes its typing before the next reading, and a reading that counts rows asserts the count's premise first (the tab's whole list, no filter), so a contaminated count fails on the premise and not on the rows it couldn't see.

## One project's day of generate requests is the box's and Production's at once, and the refusals came and went inside it (HO 801, Nov 2026)

HO 800's full run reached the project's gemini-2.5-flash cap at 3:09:47 PM MST Nov 4 (22:09:47Z): `GenerateRequestsPerDayPerProjectPerModel`, 10,000 generate requests a day on Tier 1, *Please retry in 9h50m*. Nothing in the repo named the cap. HO 800's estimate priced tokens and dollars, and the backfill's 10,840 rows can't fit one Pacific day's 10,000 even before anything else calls the model.

The cap is Production's too. The news cron calls the same model (`lib/news-matcher.ts:151`), and its 3:30 and 4:00 PM MST ticks (#30628, #30632) were refused 6 of 6 and 11 of 11 on the same metric, their retry delays (9h29m, 8h59m) pointing at the same 08:00Z reset. So Production's `GEMINI_API_KEY` is the box's project. The summarizer stamped nothing only because its queue was empty.

Then the window didn't behave as its retry delay said:
- The 4:30 PM tick made 15 of 15 calls, and the 5:00 and 5:30 PM ticks 13 and 12, none refused.
- The summarizer summarized 12 bills at 5:10 PM.
- From 6:00 PM the refusals came back and mostly held: 11 of 13 at 6:00 PM (#30656), 3 of 12 at 7:00 PM, 12 of 12 at 9:00 PM, and 13 of 13 at 12:00 and 12:30 AM MST Nov 5.
- The 1:00 AM tick (#30725, 08:00:05Z), five seconds after midnight Pacific, made 13 of 13. HO 801's resume of the batch's last 1,120 rows ran clean at 1:02 AM.

Calls landed hours before the reset the delay named, and refusals came back after it. Recorded as read, not explained.

A second thing turned up in the same read. An article whose LLM match fails keeps its `llm_error` tag for good: `storeObservation` writes an observation's tags once, and a re-ingest bumps `last_seen` only (`lib/news-to-observation.ts:265-273`). Meanwhile `skipLlm` holds only without that tag (`lib/news-ingest.ts:258`), so every later tick calls the model for the article again while it stays in its feed. The news ticks made 3 to 12 calls before 3:09 PM and 11 to 15 after. That fits about ten re-calls a tick, read as consistent rather than counted per article. By 1:08 AM MST Nov 5, 20 tagged articles had been seen since 3:09 PM, 13 of them still in their feeds, and none had gained a `news_mentions` row. The ten the 3:30 and 4:00 PM ticks refused were in their feeds at the 4:30 PM tick, which answered all 15 of its calls. So they were re-matched, not lost, and their tags kept them in the LLM's path anyway. On a shared quota, each refused call adds an article that costs a call on every tick until it ages out.

**The rule:** a run that spends a shared quota is sized against what Production spends from the same day. Before calling the window open or shut, read the refusals the crons record (`cron_runs`), not a refusal's retry delay.

## A title isn't a bill: the backfill's classifier read tribute in the name and tagged the law (HO 802, Nov 2026)

`classifyCeremonial` sees the title and the latest action and nothing else (`lib/classify-ceremonial.ts:46-47`). Of the 217 law-eligible rows it tagged 1, 36 change law, create a program or direct an agency: *Honoring Our Fallen TSA Officers Act* extends a benefits program, *Seton Hall Fire Victims Remembrance Act* sets dormitory standards, *Agent Raul Gonzalez Officer Safety Act* creates federal crimes, and *BALL Act* and *DOGE BROS Act* gave it nothing to read. The 177 the summarizer tagged with the text in hand had none wrong. The samples missed the size of it: HOs 800 and 801 drew ten at a time, HO 800's flagged three of these, and the chat let them stand on their titles.

**The rule:** a sample of ten prices a rate, not a list. When a count goes on a poster and the set is a few hundred rows, read the set.

## Two taggers, one column: the same bill can read hollow in one chamber and solid in the other (HO 803, Nov 2026)

The backfill reads the title and calls a coin, a Medal of Honor or a memorial ceremonial; the summarizer reads the text and often doesn't, on its prompt's *directs an agency*. The read found 8 titles over 17 bills tagged both ways, and twins a title match can't catch: James Capers's Medal of Honor reads 1 in the Senate and 0 in the House.

**The rule:** a column two pipelines write is checked against itself: one title, one tag.

## A free key isn't a display licence: CT showed FMP's data on four surfaces on terms that barred it (HO 806, Nov 2026)

CT read FMP's free tier for trades from HO 70 and for the tape's indices from HO 227, five stocks joining at HO 289, and showed both on public pages: the dashboard tape, `/welcome`, `/trades` and the member pages. FMP's terms bar displaying its data publicly without its prior written approval, free plan or paid (§ 2.2, read 2026-10-16; backlog `:30`, HO 786), and its own guidance says a free site still needs a Data Display and Licensing Agreement. Nothing in the key's sign-up said so, and no gate here reads a vendor's terms. Calling the use educational changes nothing: that's a copyright idea, and this is a contract. HO 806 moved trades to CapitolStockWatch's open dataset, which CC BY 4.0 lets anyone show with credit, a link to the licence and a note of changes, and dropped the seven symbols.

**The rule:** before a page shows a source's data, read the source's terms for display, not just for access. A free key grants access.

## One report, two clocks (HO 807, Nov 2026)

The weekly report counted laws by action date and advances by observation date. A law CT recorded after its week landed in neither count, and still read as an advance. The dashboard's summary for the week of Oct 26, 2026 read *No laws were enacted and no hearings were held. 119-hr-952 advanced to enacted, while 119-hr-8205 and 119-hr-1744 advanced to president.* `reports.laws_count` counted `stage = 'enacted'` by `latest_action_date` in the week (`lib/report-generation.ts`), and 119-hr-952's last action was Oct 22, the week before. The summary's advances come from `stage_transitions` by `observed_at`, and CT recorded the move on Oct 27. Each count was right on its own clock, and the two sat in one sentence. HO 807 counts a law in its week by either clock (`lib/enacted-in-week.ts`), for the report and the summary's list alike. Reports already written keep their text: a report records what CT knew when it ran.

**The rule:** two counts that sit side by side read one clock, or both clocks.

## A marquee sized for its old roster (HO 808, Nov 2026)

`/welcome`'s two strips are CSS marquees rendered on the server, so neither can measure itself (*A CSS-only marquee has a minimum content width*, HO 670). MARKETS filled its strip by item count alone: 11 symbols, about 2,400 px a half, rendered once a half. HO 806 cut the roster to 4 when FMP left, and nothing read the strip again. On prod at 1440 a half measured 794 px against a 1,116 px strip (Nov 7), so a 322 px gap crossed it on every loop. A local build read 794.3 against 1,130.8 at 1440, and 990.3 against 2,180.8 at 2560. ODDS overshot by a fixed three copies, which still cleared 2560 by 179 px. HO 808 repeats each strip's items to a floor of 14 a half (`copies = ceil(14 / items)`), at the pace both ran before HO 806, about 5.8 s an item: MARKETS 16 items over 92.8 s, ODDS 15 over 87 s. The halves then read 3,177 and 2,978 px at 1440, and 3,961 and 3,741 at 2560. Smoke reads each half against its strip at 1440 and 2560 on every deploy.

**The rule:** a strip that can't measure repeats to a floor of items, not a fixed count of copies.

## The latest action isn't always the furthest: a law read `committee` for months (HO 812, Nov 2026)

`computeStage` stages a bill from its latest action alone (`lib/enums.ts:97`), on the premise that the latest action is the furthest one.
- **The law:** `119-hr-1043`, the La Paz County Solar Energy and Job Creation Act, became P.L. 119-68 on Dec 29, 2025.
- **The latest action:** six weeks later, on Feb 11, 2026, the Senate committee that had been discharged of it filed its written report (No. 119-109). That report is the bill's latest action.
- **So CT stored a law at `committee`.** The sync only advances, and only when Congress.gov's record moves (`lib/sync.ts:404-416`). It computed `committee` again on every re-fetch.

Nothing looked wrong on any page: the law counted as one more bill in committee, and the dome's *Became law* read 126 where the dome's scope held 127 laws.

Only a check against the official list found it. Congress.gov's `/law/119` lists 138 public and 2 private laws, and CT held 139 of them at `enacted`. HO 811's inline check found the gap, and HO 812's tracked one, `scripts/diagnostic/laws-vs-official-812.ts`, read it closed.

HO 812 set the row by hand, with no stamp. The code fix is a backlog line: the bill's detail names the law (`raw_json`'s `$.laws`), whatever its latest action says.

**The rule:** a count of `enacted` is a floor until it's checked against the official list.

## `/search` runs at every pause in typing, so a redirect there carries the typist off (HO 813, Nov 2026)

`SearchBox` has no submit. Each pause of 250ms pushes `/search?q=…` through the client router (`components/SearchBox.tsx`), on every page but `/bills` and `/members`, `/search` included. So whatever the `/search` page does on the server runs at each pause, not once per search.
- **What it would have done:** HO 813's bill-number fast path redirects a reference CT holds to its bill page. Built as the handoff wrote it, a reader typing `HR 3978` who paused after `HR 39` landed on `/bill/119-hr-39` (a local build, 6:15 PM MST Nov 10), and the bill page has no search box, so the search was gone.
- **Why no test saw it:** no e2e test typed into the box, so every check read a page load (the lobby's form, a typed URL, curl), and each of those takes the redirect correctly.
- **The fix:** only a page load takes the fast path. A client-router fetch carries Next's `rsc` header and a `Sec-Fetch-Mode` other than `navigate`. Smoke's search test now types `HR 3978` into the box and asserts it stays on `/search`; that leg read red on the unguarded build.

**The rule:** a server-side effect on `/search` runs at every typing pause. Key it to a page load, or it fires mid-word.
