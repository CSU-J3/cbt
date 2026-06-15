> # ⛔ ABANDONED — do not execute this migration
> The `raw_json` split below was **dropped**. `VACUUM` is **blocked on hosted
> Turso** (`SQL_PARSE_ERROR: SQL not allowed statement: VACUUM`), so a
> `DROP COLUMN` could not reclaim pages and the rebuild's value-for-risk
> collapsed (a table-rebuild is the only no-VACUUM path; deferred as hygiene,
> not an outage risk).
>
> **The actual fix** for the homepage cold-start 500 was indexing, not a
> schema rebuild:
> - 2 covering indexes added on the Turso primary — `idx_bills_dash_stage
>   (is_ceremonial, stage, update_date)` and `idx_bills_dash_topics
>   (is_ceremonial, topics)` — make the 3 dashboard aggregates
>   (`getStageDistribution`, `getCorpusStats`, `getTopicDistribution`)
>   index-only. The planner picks these on its own (covering wins).
> - `INDEXED BY` hints on 5 homepage feed queries (`getStageChanges`,
>   `getStageChangesCount`, `getStaleBills`, `getBreakingNewsForHome`,
>   `getBreakingNewsForHomeCount`) force the **existing**
>   `idx_bills_stage_changed_at` / `idx_bills_latest_action` /
>   `idx_news_mentions_published` indexes — required because `ANALYZE` is
>   **also blocked** on Turso, so the planner is statless and otherwise scans
>   ~all 16k rows via `idx_bills_is_ceremonial` (~20s, even warm).
>
> Cold `/` went from 500 @ 20s → 200 @ ~2s, self-recovering on populate-on-read.
> See `.claude/skills/cbt/SKILL.md` (forced-index convention + the
> statless-planner learning) for detail.

---

# HO 241 — Split `raw_json` out of the `bills` hot table

**What:** Move the `raw_json` column off `bills` into a side table `bills_raw`, repoint reads/writes, drop the column from `bills`, and VACUUM. Fixes the homepage cold-start timeout.

**Why:** `/` returns 200 but takes ~18s on the first request after Turso lets the `bills` page cache go cold, which crosses the ~10s abort budget and intermittently 500s the homepage. Measured cause (live DB, isolating first-touch):

- First query to touch `bills` cold: 8–14s. Same queries warm: 90–210ms.
- `SELECT 1` cold: 440ms. `reports LIMIT 1` cold: 108ms. So it is **not** connection/TLS warmup.
- `bills` carries **27 MB of `raw_json` inline across 16,457 rows**. The homepage aggregates (`getStageDistribution`, `getStageChangesCount`, `getTopicDistribution`) don't select `raw_json`, but to read the columns they do need they must load the rows, and those rows are fat with blob — so the first index-driven lookups drag a large amount of cold pages off storage.
- `/` fans out 3 bills-scanning queries concurrently on the cold first hit; the cold penalties overlap and the render blows the budget. That's the 18s.
- All query plans are indexed `SEARCH` (no full scans). `member_votes` is in zero homepage paths. Ruled out.

Removing the blob from the hot table is the root-cause fix and benefits **every** bills query app-wide, not just `/`. Covering indexes would patch only the homepage; a warm-ping cron is useless on Hobby (once-daily cron cap can't keep an idle-evicting cache warm).

---

## Phase 0 — verify before touching anything

Confirm against the **live** repo and DB and report findings. Do not resolve these from any `/mnt/project` or frozen copy:

1. Exact `bills` primary key column — name and type.
2. Every **write** site of `bills.raw_json`. Grep `raw_json` across the sync pipeline and `scripts/`. List each INSERT/UPDATE that sets it.
3. Every **read** site of `bills.raw_json`. Grep for SELECTs reading it (summarizer feeding Gemini, bill detail, any re-summarize CLI). List each.
4. Confirm libSQL on this Turso primary supports `ALTER TABLE … DROP COLUMN` **and** `VACUUM`. Both are standard in modern SQLite/libSQL — confirm, don't assume. If `DROP COLUMN` is unavailable, fall back to a table rebuild (create lean `bills`, `INSERT … SELECT`, swap, recreate indexes) and **stop for instruction** before doing that.
5. Current counts: `bills` total rows, and non-null `raw_json` count.

Report all five before proceeding.

---

## The migration — additive first, destructive last

Run this **outside the 09:00 UTC sync cron window** so no sync writes during the migration. (`<pk>` / `<type>` come from Phase 0 step 1.)

### Step 1 — create the side table + copy (additive, fully reversible)
```sql
CREATE TABLE bills_raw (
  bill_id <type> PRIMARY KEY REFERENCES bills(<pk>) ON DELETE CASCADE,
  raw_json TEXT
);

INSERT INTO bills_raw (bill_id, raw_json)
SELECT <pk>, raw_json FROM bills WHERE raw_json IS NOT NULL;
```
Verify: `bills_raw` row count == non-null `raw_json` count from Phase 0. Spot-check 3 bills that `bills_raw.raw_json` byte-matches the original `bills.raw_json`. Report counts + spot-check result.

### Step 2 — repoint code (still reversible; `bills.raw_json` still exists)
- **Writers:** sync upserts `raw_json` into `bills_raw` keyed on `bill_id`, and stops writing `bills.raw_json`.
- **Readers:** every SELECT of `raw_json` now reads `bills_raw` by `bill_id` (single-row PK lookup).
- Named `git add` (never `-A`), eyeball the diff, commit cleanly, deploy.
- Verify the app works off `bills_raw`: exercise each reader found in Phase 0 (e.g. re-summarize a bill; load a bill detail page if it parses `raw_json`).

### Step 3 — HALT
Before the irreversible drop, print:
- `bills_raw` row count and the original non-null `raw_json` count (must match),
- confirmation the repointed code is deployed and every reader works.

**Stop and wait for explicit go. Do not drop the column until confirmed.** After the drop, `bills_raw` holds the only copy — the Step 1 verify is the safety gate.

### Step 4 — backfill gap, drop, reclaim (after confirm only)
```sql
-- safety backfill for any rows synced/changed since Step 1
INSERT INTO bills_raw (bill_id, raw_json)
  SELECT <pk>, raw_json FROM bills WHERE raw_json IS NOT NULL
  ON CONFLICT(bill_id) DO UPDATE SET raw_json = excluded.raw_json;

ALTER TABLE bills DROP COLUMN raw_json;
VACUUM;
```
**VACUUM is required.** `DROP COLUMN` rewrites rows without `raw_json` but does not repack pages, so without VACUUM the table stays sparse and the cold-read win won't land.

### Step 5 — measure (proof)
Re-run the exact cold check from the diagnostic after forcing a cold instance:
```
curl.exe -s -o NUL -w "%{http_code} %{time_total}s\n" https://cbt-chi-silk.vercel.app/
```
Plus the cold timings for the 3 bills queries (`getStageDistribution`, `getStageChangesCount`, the topic-distribution / off-path query). Report before/after. **Target: cold `/` comfortably under the 10s abort.**

---

## Constraints
- Turso single primary, no embedded replicas — VACUUM is safe.
- Vercel Hobby: do not propose a frequent warm-ping cron. The once-daily cap makes it useless against idle eviction.
- Do not drop `bills.raw_json` until Step 3 is confirmed.

## Out of scope — follow-ups, do not do now
- If cold `/` is still near budget after the migration, the next lever is wrapping the three homepage aggregates in `unstable_cache` + `revalidateTag` so the cold recompute happens out of band, not on a user request. Separate handoff.
- `sync_state` reading 0 rows surfaced during diagnosis — unrelated to this fix. Bank it in OPEN LOOPS (`docs/backlog.md`) for a later look at sync cursor state.
