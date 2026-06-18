# scripts/diagnostic

Read-only diagnostic scripts kept around for the next "something cron-related hung" investigation. None of these write to the DB.

- **`sync-diagnostic.ts`** — `summary_updated_at` distribution, summarize backlog by `update_date` age, the 24h-failure-defer split, `cron_runs` recent rows + per-route rollup, and corpus freshness. First-pass triage when sync/summarize looks stuck. Built for HO 114 Phase 1; extended for HO 115. Run: `npx tsx scripts/diagnostic/sync-diagnostic.ts`.

- **`summarize-measure.ts`** — measures per-bill summarize latency (ctx fetch vs LLM, min/p50/p95/max) without writing. Mirrors `runSummarize`'s selector and per-bill work; pass a count to override the default of 12. Built for HO 115 Phase 1 to confirm summarize wasn't hanging (case B/D) vs. genuinely overrunning its share of the shared budget (case A). Run: `npx tsx scripts/diagnostic/summarize-measure.ts [count]`.

- **`hearings-list-264.ts`** — settles the three /hearings list-view data assumptions (HO 264 Phase 1): distinct `meeting_type` × chamber + the HEARING/MARKUP/BUSINESS badge map, `meeting_status` distribution + the watch-state derivation inputs (status × past/future, videoUrl presence, sample links), and the per-meeting bill-count distribution (the collapsed cap = 3 + ·N more). Run: `npx tsx scripts/diagnostic/hearings-list-264.ts`.

- **`hearings-calendar-265.ts`** — per-weekday meeting distribution across the two-week Mon–Fri window (HO 265 Phase 1), so the per-cell block cap (before "+N more") is set to real data and the weekend-drop is confirmed safe. Buckets by ET calendar day; reports per-day counts, the max single weekday, and weekend totals. Run: `npx tsx scripts/diagnostic/hearings-calendar-265.ts`.

- **`hearings-secondary-267.ts`** — sizing for the two secondary hearings cuts (HO 267 Phase 1): the per-committee meeting-count distribution + upcoming/recent split (committee cut → grouped UPCOMING/RECENT, recent capped) and the meetings-per-bill distribution (bill cut → cap before "see all on /hearings"). Run: `npx tsx scripts/diagnostic/hearings-secondary-267.ts`.

- **`hearings-hill-266.ts`** — sizing for the dashboard ON THE HILL band (HO 266 Phase 1): the per-weekday count THIS week (Mon–Fri) to confirm the cap-5 + "+N more" collapse, and a count of meetings live right now under the Piece 1 `watchState` rule (the LIVE NOW header callout shows one if any, else omits). Run: `npx tsx scripts/diagnostic/hearings-hill-266.ts`.

- **`report-committee-268.ts`** — HO 268 Gate A: can a stage transition be attributed to a specific markup? Probes `bills.stage_changed_at` coverage + the markup→committee→floor join (`meeting_bills` of markup meetings × bills that moved to floor within ±7d). Result was **fallback** — tracking began 2026-05-11 and produces 0 clean attributions, so markup blocks show current stage and the VIA firehose tags drop. Also reports the meeting-type mix for the count strip. Run: `npx tsx scripts/diagnostic/report-committee-268.ts`.

- **`races-moves-272.ts`** — HO 272 Phase 1: MOVES-badge feasibility. Reports `rating_history` shape, which races have a real post-baseline rating move, and whether any are among the 4 featured competitive seats (if not, the v2 RACES-tab MOVES badge correctly reads 0 even though the wiring is live). Run: `npx tsx scripts/diagnostic/races-moves-272.ts`.
