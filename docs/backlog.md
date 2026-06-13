# Backlog — Open-Loops Ledger

> OPEN LOOPS is reconciled at every session open and close. Nothing is tracked only in chat.
> An item leaves OPEN LOOPS only by meeting its close-criterion or being explicitly tombstoned.
> Sections: OPEN LOOPS (dated, owned) · QUEUED (next builds) · BANKED (gated) · WATCH (standing observations) · FIT & FINISH (audit findings) · DONE (tombstones, append-only).

Owners: **Corey** (human action) · **Code** (a build/run) · **cron** (happens on schedule).

---

## OPEN LOOPS

- **HO 238 prod soak** — opened Jun 11, watch through ~**Jun 16**. *Owner:* Code/Corey. *Close:* no 5-minute-burn 504 (`FUNCTION_INVOCATION_TIMEOUT`) recurrence on `/`. Fast `[db] timeout, retrying` warns are the bound working, not a regression. *Instrument:* probe script (9× `-m 40`) + opportunistic 30-min Vercel log window. *Status (Jun 12):* 9/9 probes clean, all `pdx1`, zero hangs — holding, not yet closed.
- **CCBT daily-tick check** — due **Jun 13**, post-09:00 UTC. *Owner:* Code. *Close:* the scheduled CCBT `/api/sync` tick runs end-to-end (vs the mid-summarize 504 the manual trigger hit), AND re-run CCBT `scripts/freshness-check.ts` to log the backlog-drain rate (refines the 60s-fit port scope). *Instrument:* Vercel runtime logs for `prj` ccbt + the freshness query. Lives in the CCBT repo; the *obligation* is logged here for visibility. *Status:* pending (port shipped Jun 12, commit `116b7bc`).
- **CA certification re-ingest** — early **July**. *Owner:* Code/Corey. *Close:* `npm run reingest:primary-slate -- CA 2026-06-02` after CA certifies, to lock the mid-count shares into final. *Instrument:* the reingest script + a NULL-share recount. (Promoted from the CA DONE tombstone; tombstone retained.)

## QUEUED

*Next builds, roughly ordered. Pull from here when picking up work.*

- **Fit & finish browser pass** (NEW). Console errors + interactions (modals / Esc / hovers / expanders / dead affordances) across surfaces — the half the headless HO 240 audit couldn't reach (it covered headline-numbers + tape + stamps + server-render only; no CDP browser driven). Also covers the rendered-200-only surfaces: race/primary state modals, a race hub, a report detail, a committee detail.
- **Masthead count + stamp coherence diagnostic** (NEW). Three observed counts — 16,193 "BILLS TRACKED" (dashboard), 15,179 "BILLS" (inner pages, Jun 12), 15,398 (inner, Jun 11) — plus label variance (TRACKED vs BILLS) and stamp variance ("LAST SYNC 4:03 AM CT" dashboard vs "UPDATED 3:03 AM MT" inner — label AND timezone differ by surface). *Ground-truth (Jun 12):* total bills **16,361**, bills-with-summary **15,350** — so the dashboard count ≈ all bills and the inner count ≈ summarized bills (gap ≈ the ~1k unsummarized backlog). One diagnostic enumerating the count predicate + stamp source per surface; donors HO 47 (count honesty), HO 134 (count consistency).
- **Substack data post.** Dashboard has enough surface area to point readers at specific bills. Hooks: total tracked, enacted count, presidential-desk count (once `/president` ships). Angle: what's actually moving in this Congress.
- **Mobile redesign of dashboard surfaces.** Desktop ships first across HO 126/131/133. Consolidates HO 123 (mobile touch tooltips), 125 (BillRow responsive audit), 127 (WatchStar mobile parity), 131 (mobile-first redesign), 133 (new header + grid). Trigger when desktop layout stabilizes.
- **/search v2/v3.** Per-tab filter rail (v2), type-ahead in SearchBox (v2), LLM-synthesized answer at top (v3). Deferred from HO 129.
- **Member stock-trades dashboard ticker.** PTR pipeline shipped (HO 70 — `lib/trades-ingest.ts`, `getMemberTrades`, member-hub trades block). Residual is the **dashboard-level trades ticker UI** only.
- **`/bill/[id]` page redesign** (HO 125). HO 191 redesigned the feed *expanded panel*, not the detail page; the page has had only incremental chrome (HO 145 committees, 154.5 nav, 184/185 masthead).
- **Per-source weighting in media-attention count** (HO 130).
- **Window selection on the per-bill media-attention column** (HO 130). `MediaAttentionCell` is a fixed 7-day count; `/bills` NEWS view already ships 24/72/168/720h — this is the per-bill column specifically.
- **Filter/sort within Breaking/Top Stalls tab strip** (HO 133).
- **SVG primitive extraction across chart components** (HO 100).

## BANKED

*Gated/dated; each states its gate.*

- **Dashboard fan-out / caching pass.** The latency-watch graduate that HO 238's bounding deliberately did NOT address (238 was timeout-bounding only). `/` issues ~16+ Turso calls per render; `getDashboardPrimaries` is uncached among them. *Gate:* promote when SSR latency on `/` becomes the felt problem (238's pdx1 move bought headroom first).
- **Deterministic action-code stage tier ahead of the LLM** (HO 239 banked deeper fix — **confirmed landed in this ledger**). Classify stage from Congress.gov structured action codes deterministically; LLM only for genuinely ambiguous text, never the sole source. *Diagnostic (Jun 12):* 60/230 transitioned bills (26.1%) carried a backward slot pair; 49 were `*→introduced` (impossible). Mechanism: classifier flicker on *stable* input (`119-hr-8467`). Guard caught a fresh one live (`119-hr-8464`) on the first post-fix run — inflow is real and ongoing. *Symmetric-noise inference:* detectable backward hops are only the *visible* half; the same non-determinism produces *forward* flicker inside legitimate-looking transitions (committee→floor when truth is committee→committee), currently **unmeasurable**. So 26% is a *floor* on total misclassification. *Gate:* when stage accuracy starts mattering for a shipped surface (MOVERS hop-count, the funnel, any stage-gated query). See WATCH → guard-rejection telemetry for the priority signal.
- **MOVERS from→to display + hop-count sort** (HO 232 deferred residue). MOVERS ships today as the `getStageChanges` recency feed. The hop-count rank + from→to render are deferred. *Gate:* `stage_transitions` accrual (planted write-only 2026-06-11, anchor `2026-06-11T18:38:18Z`; no backfill — single-slot `previous_stage` has no history). The from→to render idiom was removed ~HO 125/148/191 and must be rebuilt. Validate the log fills via `scripts/diagnostic/validate-stage-transitions-232.ts` first.
- **AWAITING RESULTS / date-driven VOTED classification** (card + map bands). Today VOTED is results-presence: `buildPrimariesCartogram` (`lib/cartogram-data.ts` ~L180) sets `voted = candidates.some(vote_pct != null)`, and card/modal `isVoted()` matches. A contest past its `primary_date` but not-yet-ingested renders as upcoming/SOON (maps) and SCHEDULED (card) — wrong on both, and one un-ingested contest can hold a whole state out of the VOTED band. *Ground-truth (Jun 12):* **482 past-by-date vs 407 voted-by-results = 75** past contests rendering upcoming. *Fix:* derive VOTED/recency from `primary_date < today`; results-presence drives only display (ShareBar when shares exist, an **AWAITING RESULTS** state — distinct from SCHEDULED — when not). Touches `buildPrimariesCartogram` band logic + `PrimaryDistrictCard`/`PrimaryMapCard`/`PrimaryRow`.
- **Forward-sync re-poll of voted-but-NULL contests (~6-week window).** `lib/primaries-sync.ts` fills `vote_pct` as contests vote, but a slow/mid-count state (CA ~a month to certify) lands partial/NULL on election night and is never re-polled. *Fix:* re-poll any contest whose `primary_date` is within ~6 weeks AND has NULL/partial shares (or no `winner`). Removes the manual reingest pass and the early-July CA obligation.
- **`primaries.race_id` backfill-or-drop.** Dead link — *ground-truth (Jun 12):* **3/875 populated** (was 3/907; total drifted). The working pattern is the derived seatId (`S-{ST}-2026` / `{ST}-{DD}-2026`) joined to `race_ratings`/`races` (HO 233 `getDashboardPrimaries`; same as `getRacesIndex`). Backfill properly or drop the column. Low priority — the derived join covers every live consumer.
- **race→news linkage arc.** No race→news join exists (`news_mentions` is bill-keyed; a race has no bills) — the wall every modal/list/card hit across HO 222/225/226. A real pipeline build (race↔news mapping), not a UI pass. *(roadmap STATUS.)*
- **primaries-map results-coloring.** Later layer over `primary_candidates.vote_pct` (self-filling May→Sept); the HO 226 map is recency-only by design (HO 205 verdict). *(roadmap STATUS.)*
- **rating-history sparkline.** *Gate:* `rating_history` accruing weeks of inflection data (change-detect logging live since HO 220).
- **Backfill ~26 bills that lost a topic tag during the HO 120 drain.** *Gate:* analyst view depends on full tag coverage.
- **Topic taxonomy expansion.** *Gate:* unmapped category counts exceed a useful threshold (HO 121).
- **Intraday VIX source.** EOD VIX shipped (FRED `VIXCLS`, HO 178); intraday is unsourced (Stooq doesn't carry it, Yahoo unauthed too unstable). *Gate:* a free intraday source emerges or a paid plan covers it incidentally.
- **News-as-retirement-research feed.** Loose "possible retirement mentions" scan of `news_mentions` near a member name, as research input to the hand-curated retirement seed — NOT a rendered signal. *Gate:* only if the OPEN-seat tag (HO 221) proves valuable first.
- **Relative cash-thin signal on race cards.** Incumbent cash-on-hand ships dim (HO 212); an amber "thin-cash" highlight was cut (smooth gradient, no natural absolute threshold). *Constraint if revisited:* must be RELATIVE (bottom-quartile / rank-within-chamber), never an absolute dollar cutoff.
- **Cross-Congress historical members** (HO 124); 119th only today.
- **External member scoring sources** (DW-NOMINATE etc.) (HO 124).
- **`revalidateTag('primaries')` wiring** (HO 103) — *conditional, not pending:* only if primaries queries ever get `unstable_cache`-wrapped. They use plain `db.execute` today, so the tag isn't needed.

## WATCH

*Standing observations; each notes what would promote it.*

- **Guard-rejection telemetry (HO 239).** `[stage] rejected impossible downgrade` / `[stage] downgrade pending` warns are **flicker-rate telemetry**: rejection frequency is the live signal of classifier noise, and it **informs the action-code tier's priority** (BANKED). *Promote* the action-code tier when rejection frequency climbs or when a stage-gated surface ships. *Instrument:* grep the summarize cron's 30-min log window for `[stage]`.
- **`stage_transitions` validator regression.** `scripts/diagnostic/validate-stage-transitions-232.ts` is now the HO 239 guard's regression check (A↔B invariant + impossible-bucket). Standing spot-check, no close date → lives here, not OPEN LOOPS. *Promote* to action if it ever FAILs. (Companion: `scripts/diagnostic/backward-hop-238.ts` — backward pairs should stay ~9, impossible bucket 0.)
- **CD06 ◑ — Sacramento renders 16px** inside the valley metro panel (below the 22px floor, geographically stranded within the 2-panel cap). *Promote* if it bothers anyone; fix is config.
- **Maps-band duplication** across the two district modals (noted in-code for future extraction). *Promote* when a third consumer appears.
- **7 NO-MATCH Ballotpedia votebox names** from the CA re-ingest (roster drift / write-ins, unattachable). Benign; recorded in the CA tombstone. *Promote* only if a name turns out to be a real roster gap.

## FIT & FINISH

*Audit findings, severity-tagged. P1 = wrong data shown · P2 = inconsistent across surfaces / misleading · P3 = cosmetic.*

- **P1 · `/races` · S-OK-2026 shows the wrong incumbent.** Renders Lankford (Class-III / 2028); the 2026 OK seat is the Class-II Mullin seat, now held by appointee Armstrong (can't run) — a genuine open seat. *Ground-truth (Jun 12):* `incumbent_bioguide_id = L000575` (Lankford), `incumbent_running` NULL, not in `races-seed.json`. *Fix path (not done here):* member-data correction → then the HO 221 OPEN tag (held out of the seed until corrected).

*Commit-2 audit (2026-06-12, measure-only):*

- **P2 · `/changes` · corpus-query latency near the HO 238 bound.** Prod renders 200 but in **6.69s** — within ~3.3s of the 10s `DB_REQUEST_TIMEOUT_MS`. The HO 238 bound converts *slow-but-working* into a hard 500: corpus growth or a slow tick would push this corpus-wide aggregation past 10s → 500, not just slow. Same latency clock as the `/trends` force-dynamic tombstone. *Mitigation:* the BANKED dashboard fan-out/caching pass. (`/patterns` prod 0.82s — fine.) **Promote-criterion (the fuse):** move the BANKED caching pass to QUEUED-top when `/changes` prod latency crosses **8.5s**, or on its **first 10s-bound 500**. The 238 bound made latency a hard failure mode, so the headroom number is a fuse — act on it before it blows, not after.
- **P2 · masthead count + stamp incoherence.** Dashboard "**16,193** BILLS TRACKED" vs raw total **16,361** (different predicate); label TRACKED (dashboard) vs BILLS (inner); stamp "LAST SYNC 3:03 AM MT". Confirmed live Jun 12. Cross-references the QUEUED masthead diagnostic — not duplicated, this is the audit observation that the diagnostic resolves.
- **P3 · local dev · `/changes` + `/patterns` 500 from the laptop.** The 10s HO 238 bound + laptop→Turso (us-west-2) latency makes these corpus pages unrenderable in local dev; both 200 in prod from pdx1 (co-located). Developer-experience caveat, not a user-facing bug — but worth knowing before chasing a phantom outage.

*Audited and correct (no finding), recorded so the audit is legible:* tape 9/9 symbols, values match `market_ticks`, EOD tags FRED-only, GOLD live @4,235 (06-12) · funnel deltas explained by the non-ceremonial predicate (`is_ceremonial=0 OR NULL`) · `/members` 436+100=536 current · `/committees` 235 · `/races` 139 = competitive (rated ≠ Solid/Safe) · `/watchlist` 3 · `/news` 307→`/bills?mode=news` (intentional) · no server-render errors except the latency-timeouts above.

*Coverage:* headline-numbers + tape + stamps + server-render checked on `/`, `/bills`, `/news`, `/changes`, `/members`, `/races`, `/committees`, `/watchlist`, `/patterns`, `/reports`, a member page, a bill page, search. **Not deep-audited** (rendered-200 only): client-side console capture (no CDP browser driven), interaction testing (clicks/hovers/modals/Esc), the race/primary state modals, a race hub, a report detail, a committee detail. Those remain open for a browser-driven pass.

## DONE

*Append-only tombstones. Detail lives in the named handoffs.*

- ~~**Breaking-news marquee ticker**~~ — superseded by the BREAKING panel (`BreakingNewsBlock`/`BreakingRow`, HO 114/164/178). The only marquee in the app is the markets tape.
- ~~**CA June-2 primary results partially uningested**~~ — RE-INGESTED 2026-06-11 (`scripts/reingest-primary-slate.ts CA 2026-06-02`): 52/52 seats, 0 NULL shares (CA-25: Ruiz 59.2% / Males 19.6%). 7 unattachable votebox names (→ WATCH). Shares mid-count → final lock obligation promoted to OPEN LOOPS (early-July cert).
- **Markets cron failure** — FIXED HO 227/228. Stooq retired the light-quote CSV (all 15 symbols stale 2026-06-05 under a false `success`). Re-sourced: indices→FMP `/stable/quote` (intraday), WTI/NATGAS/TNX/VIX/BTC→FRED JSON API (EOD-tagged; `fredgraph.csv` was egress-bot-walled — HO 228). Failure honesty: 0/N fetch now throws → `cron_runs.status=error`. Dropped sector ETFs/SILVER/DXY/GOLD (tape 17→8). Prod-verified 2026-06-10, 8/8 from pdx1 egress.
- **`/trends` → `force-dynamic`** (2026-06-10) — two corpus-wide chart reads outgrew Next's 60s static-export ceiling and blocked all deploys; now rendered at request time. *Latent watch:* any other build-prerendered page doing corpus-wide reads is on the same latency clock.
- **district-geo base** (HO 224-226) — Census cd119 TopoJSON + `lib/district-geo.ts` + `districtSeatId` join, wired into the `/races` and `/primaries` district modals via cached `GET /api/races/district-geo/[state]`.
- **Metro-zoom panels + leader lines** (HO 236/237) — dense-state fix (CA/TX) via `getStateDistrictGeometry` subset render; metro inset panels + leader lines + `overviewBox`. Shipped; live CA eyeball was the closeout. *(Was the "spec-3 Phase 2" banked item.)*
- **HO 238 region-move egress** — confirmed clean Jun 12 for all crons (kalshi/markets/summarize/sync/etc., 13/13 success, no new fetch-failure flavor from pdx1). Loop entered Jun 11, exited Jun 12. *(Example of a loop entering and exiting properly.)*
- **HO 239 stage monotonicity guard + repair** — landed Jun 12 (commits `1338e42`/`b690ca0`, pushed `eb53162`). Guard + prompt rule + two-tick pending; repaired 51 impossible pairs + 3 orphan log rows; backward pairs 60→9, impossible bucket 0, validator PASS, INTRO 578→**527** (the −51 drop is the repair, expected — *not* a finding).
- **GOLD re-add** — landed Jun 12 (commit `e81c83b`). FMP `/stable/quote` free tier now serves GCUSD (probe: HTTP 200, intraday). Re-added as `source:'fmp'`, no EOD tag, tape 8→9. Ticks in prod on the next markets cron after deploy.
- **EOD-advance check** — verified benign Jun 12. `market_ticks` rows DO advance a business day per FRED publish (TNX/VIX 06-09→06-10, WTI/NATGAS 06-05→06-08); the identical Jun-11/Jun-12 values were FRED's publish lag, not a stuck tick. No action.
