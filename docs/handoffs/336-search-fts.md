# HO 336 — Fix /search 500 on common terms (FTS5)

Confirm next free number: `ls docs/handoffs/ | sort -V | tail`. Body assumes 336.

HO 335 surfaced this; it's not a regression from it. `/search?q=<common term>` 500s on every tab, warm or cold. The cause is a leading-`%` LIKE over `bills` title/summary that full-scans all 16k rows (Code measured `tax` = 1290 matches, past the 10s abort). No index fixes a leading-wildcard LIKE: the 335 hint collapsed the MULTI-INDEX OR (the plan deliverable) but the scan was always the wall. That's why the 332 audit missed it. EXPLAIN prices the plan, and the plan is a single index scan that reads fine; the cost is the full-corpus scan the LIKE forces at runtime, which a plan-only audit doesn't show.

The fix is an inverted index. SQLite ships one: FTS5. Match becomes an index lookup, the count comes off the index, the full scan is gone.

Probe before building. The project has been burned assuming a hosted dependency works (FRED egress, FMP tiers), so don't assume Turso has FTS5 compiled in.

## Step 1 — probe + map (HALT only if FTS5 is unavailable)

Two things against prod Turso (the shared instance; slug cross-check, since `vercel env pull` returns empty for sensitive vars):

1. FTS5 support. `CREATE VIRTUAL TABLE _fts_probe USING fts5(x); DROP TABLE _fts_probe;`. If it errors (virtual tables or fts5 not compiled into hosted Turso), HALT and report; we fall back to a bounded-count mitigation, which is its own handoff. If it succeeds, drop the probe table and continue.

2. Map the live search paths. Read every search helper (`searchBills`, `searchNews`, any shared one) and report, per tab: which columns it LIKEs, whether the tabs share the bills full-scan, and where the count comes from. Code's note says every tab 500s and the LIKE is over bills title/summary, so confirm whether `searchNews` drives the bills scan too or only scans the 227-row news table. That decides whether one FTS table over bills serves every tab or news needs its own path.

If FTS5 works, keep going in this handoff. No second round-trip for the happy path.

## Step 2 — build the FTS index

- External-content FTS5 table over `bills`, indexing `title` + `summary`, keyed to the bills row so a match maps straight back to the bill. External-content (not a copy) so it doesn't duplicate the corpus.
- Keep it synced. Default to triggers (AFTER INSERT/UPDATE/DELETE on bills) so the index stays consistent; the per-write cost on a daily batch of a few hundred rows is negligible. If triggers complicate the existing sync, fall back to rebuilding the FTS index in the daily cron after the sync write (`INSERT INTO fts(fts) VALUES('rebuild')`), since 24h search staleness is fine for a corpus that syncs daily. Your call based on what fits `scripts/migrate.ts` and the cron path.
- Populate once from the existing 16k on creation (in the migration).
- Migration goes in `scripts/migrate.ts` AND is applied to prod. FTS table creation is heavier DDL than an index, so confirm it persists and, if you use triggers, that they fire on prod.

## Step 3 — rewrite the search

Swap the LIKE for an FTS `MATCH` in the helpers Step 1 mapped. Rank by relevance (bm25) so the best matches surface first instead of arbitrary order. Take the result count from the FTS index, not a second scan. Preserve the existing tab structure and result-row shape; this is a query-engine swap, not a redesign.

## Verify

- `/search?q=tax` (the 1290-match case that was aborting) returns in tens of ms, every tab 200. Test a rare term and a multi-word term as well.
- A cold prod hit confirms it isn't only warm-fast.
- `tsc` + build clean.

## Docs

- Close the /search OPEN LOOP from 335.
- SKILL.md: full-text search goes through the FTS5 index, never a LIKE over title/summary (a leading-`%` LIKE full-scans the corpus and aborts regardless of index). Plus the audit refinement: EXPLAIN-based plan auditing (the 332 probe) is blind to queries that scan the full corpus by construction (leading-`%` LIKE, unbounded aggregates) because the plan reads fine; those need a runtime timing check, not just a plan check.
- oddities: the LIKE-full-scan 500, so search doesn't get rebuilt on LIKE later.

## Ship

- Named `git add`; `tsc` + build clean.
- `git push`; `npm run verify:deploy` until served SHA === HEAD.
- Confirm `/search?q=tax` 200s on prod with the FTS plan.
