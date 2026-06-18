# scripts/diagnostic

Read-only diagnostic scripts kept around for the next "something cron-related hung" investigation. None of these write to the DB.

- **`sync-diagnostic.ts`** — `summary_updated_at` distribution, summarize backlog by `update_date` age, the 24h-failure-defer split, `cron_runs` recent rows + per-route rollup, and corpus freshness. First-pass triage when sync/summarize looks stuck. Built for HO 114 Phase 1; extended for HO 115. Run: `npx tsx scripts/diagnostic/sync-diagnostic.ts`.

- **`summarize-measure.ts`** — measures per-bill summarize latency (ctx fetch vs LLM, min/p50/p95/max) without writing. Mirrors `runSummarize`'s selector and per-bill work; pass a count to override the default of 12. Built for HO 115 Phase 1 to confirm summarize wasn't hanging (case B/D) vs. genuinely overrunning its share of the shared budget (case A). Run: `npx tsx scripts/diagnostic/summarize-measure.ts [count]`.

- **`hearings-list-264.ts`** — settles the three /hearings list-view data assumptions (HO 264 Phase 1): distinct `meeting_type` × chamber + the HEARING/MARKUP/BUSINESS badge map, `meeting_status` distribution + the watch-state derivation inputs (status × past/future, videoUrl presence, sample links), and the per-meeting bill-count distribution (the collapsed cap = 3 + ·N more). Run: `npx tsx scripts/diagnostic/hearings-list-264.ts`.

- **`hearings-calendar-265.ts`** — per-weekday meeting distribution across the two-week Mon–Fri window (HO 265 Phase 1), so the per-cell block cap (before "+N more") is set to real data and the weekend-drop is confirmed safe. Buckets by ET calendar day; reports per-day counts, the max single weekday, and weekend totals. Run: `npx tsx scripts/diagnostic/hearings-calendar-265.ts`.
