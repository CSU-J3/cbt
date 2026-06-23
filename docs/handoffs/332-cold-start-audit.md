# HO 332 — Site-wide cold-start audit

Confirm next free number: `ls docs/handoffs/ | sort -V | tail`. Body assumes 332.

HO 331 fixed the fourth instance of one bug. This finds the rest, in one read-only pass, before they 500 in prod.

The class: a query reads the fat `bills` table (16,538 rows), carries no forced `INDEXED BY` hint, and the stateless Turso planner (ANALYZE blocked, no stats) grabs the low-selectivity `idx_bills_is_ceremonial` walk or a full SCAN instead of a covering index. Warm it's ~200ms and invisible; cold it's seconds-to-abort and a 500 off the 10s `DB_REQUEST_TIMEOUT_MS` (HO 238). Paid so far on the homepage feed (241), the dashboard introduced-date aggregate (246), `/members` getFeedStats (277/279), the dashboard-v2 corpus (278), `/bills`, and the member-expand sponsor helpers (329/331). Every one surfaced as a prod 500 diagnosed after the fact.

EXPLAIN QUERY PLAN exposes the bad plan warm. The plan is chosen at prepare time, so a warm EXPLAIN against prod reveals every latent misplanner at once, no cold container needed. That's why one audit beats waiting for the fifth 500.

Diagnose only. No fix, no new indexes, no abort change (HO 238 is intentional). VACUUM and ANALYZE stay blocked on hosted Turso, so the planner is permanently stateless and the fix is always a forced INDEXED BY onto a covering index, never a stats rebuild. The batch fix lands in the follow-up once the full list is visible.

## Scope — confirm the fat set

The misplan only bites where there's enough to scan. Pull prod row counts for every table first. `bills` (16.5k) is in. Check `news_mentions`; it carries `idx_news_mentions_published` from 241, so it's already been a suspect. Audit queries on any table whose row count runs into the thousands; skip the small lookup tables (members ~540, committees, race ratings), which plan fine stateless. Confirm by count, don't assume.

## Enumerate the query surface

Grep the whole repo, not just `lib/queries.ts`; queries live in page files too. Every distinct SQL statement reading a fat table: `FROM bills`, `JOIN bills`, `FROM news_mentions`, and so on. The grep is authoritative. The list below is orientation, expect to find more:

- `getFeedBills`, `getFeedStats`, `getCorpusStats`, and the gated `getCorpusStats(true)` / `summary IS NOT NULL` form, which is 277's exact trap. Confirm 277's fix still holds.
- `getStaleCount`. Known misplanner, banked since 241 ("covering partial index if /stale ever matters"). This is where it stops being banked: confirm the plan, fold it into the fix set.
- The topic-mix / topic-distribution / stage-funnel chart queries. One topic-mix query was hinted this build; confirm which of the rest are still unhinted.
- Any `news_mentions` read.

The audit does two jobs at once: find new latent misplanners, and confirm the already-fixed paths (241, 246, 277, 278, 331) still plan correctly. A query-text or index-set change can quietly regress a stateless plan, so re-verify them rather than taking them on trust.

EXCLUDED as freshly fixed (331 / 46beff8): `getSponsorStats`, `getSponsorTopTopics`, `getSponsorRecentBills`. Use their post-fix plan as the GOOD reference: covering-index point lookup, zero MULTI-INDEX OR.

## EXPLAIN each, against prod Turso

Reuse the `scripts/diagnostic/` harness; `member-expand-329.ts` already EXPLAINs against prod. One-off script, prod Turso specifically (the app's documented instance, slug cross-checked, since `vercel env pull` returns empty for sensitive vars). Local SQLite plans differently and won't reproduce the stateless trap.

Per statement, run `EXPLAIN QUERY PLAN` with representative bound params (a heavy sponsor, a real topic, a real date window). For any gated variant, EXPLAIN both the gated and ungated forms; the `AND summary IS NOT NULL` gate is what flipped the plan in 277, so they're separate plans.

Classify each:
- GOOD: SEARCH on a covering index (point lookup or index-served range).
- BAD: SCAN bills, MULTI-INDEX OR, or SEARCH driven by `idx_bills_is_ceremonial`. Each BAD is a latent cold-start 500.

## HALT — report a table, one row per query

- function + route(s) served
- fat table(s) read
- verdict (GOOD / BAD) plus the plan one-liner
- for BAD: the covering index that would serve it, either existing (name it) or needs creating (sketch it)
- cache status: `unstable_cache` + cron revalidate, or uncached. An uncached BAD is the sharpest, since it 500s on the populate-on-read miss with no fallback. A cached BAD still 500s on the cold miss, so it stays in the fix set; cache status is triage order, not an exemption.

Then: total BAD count, the routes they hit, how many need a new covering index versus a hint onto an existing one, and your read on whether a single batch INDEXED BY handoff closes it or any case needs more.

Don't implement. Full list visible before we touch anything, same as 329.

Keep the `scripts/diagnostic/` probe; name it `cold-start-audit-332.ts`. This path has bitten five times, so the harness has earned its place.
