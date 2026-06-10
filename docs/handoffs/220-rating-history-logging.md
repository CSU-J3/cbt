# HO 220 — Rating-history logging (plant the tree; the sparkline comes later)

## Why

The rating-history sparkline is the last open race-card arc, but it's blocked on data: `race_ratings` is point-in-time only (`id = race_id + '-' + source`, no temporal column), refreshed quarterly by a manual `npm run seed:ratings`. There's no record of how a rating *changed* over time. This handoff starts the logging clock — a daily cron that appends a row to a new history table ONLY when a rating differs from its last logged value. **No chart this handoff.** The sparkline gets built weeks from now, once there's a series worth drawing. The whole point is to start capturing inflection points (e.g. SKILL's example: Cook moved OH to Toss Up on 2026-04-13) before they're lost.

## Verify live state first (the project-copy lag rule — it's caught three premises this session)

Confirm from LIVE source, not this doc or the /mnt/project SKILL copy:
1. **`race_ratings` schema** — the real columns. SKILL claims: `id` (PK, `race_id-source`), `race_id`, `source` (`cook`/`sabato`/`inside_elections`), `rating_score`, and a rating label/string column. Confirm the exact column names (esp. the label column — SKILL's schema dump was truncated mid-table; grep the real `CREATE TABLE race_ratings`). The history table mirrors these.
2. **No existing rating-history/snapshot table** — grep for `rating_history`, `rating_snapshot`, `ratings_history`. Confirm none exists (if one does, STOP and report — this whole handoff is moot).
3. **`cron_runs` + `wrapCronRoute`** (`lib/cron-log.ts`) — the canonical cron wrapper. Confirm the signature so the new route uses it like every other.
4. **The Vercel cron schedule** in `vercel.json` — SKILL lists eight daily routes staggered 09:00–14:00 UTC. Confirm the live set and pick an unused hour for this route (a slot that doesn't collide — e.g. 15:00 or later, after news at 14:00). Report the chosen slot.
5. **`dashboard_state`** usage pattern — not for storage here, but confirm whether a "last logged" watermark is cleaner there or derivable from the history table itself (see Design Q below).

## Design — change-detection logging (the shape, resolved)

**Trigger: a daily Vercel cron** (NOT the GitHub-Actions high-freq path — ratings move quarterly, daily is already generous). Reads live `race_ratings` (post-seed state — so it's decoupled from *when* the manual seed ran; it catches a change on the next tick after a re-seed), compares each `(race_id, source)` row to its last logged history value, **appends ONLY on a difference**. A daily tick against unchanged data writes ZERO rows. A quarter of identical days collapses to one row per actual rating move — exactly what a sparkline wants (the inflections, not the flat runs).

### New table — `rating_history` (append-only, the `markets` table is the precedent)
The `markets` table (SKILL line 408) is the model: append-only history of a value over time. Mirror that discipline. Proposed shape (confirm column names against the live `race_ratings` in Phase 1):
```sql
CREATE TABLE rating_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  race_id TEXT NOT NULL,
  source TEXT NOT NULL,                 -- 'cook' | 'sabato' | 'inside_elections'
  rating_score INTEGER NOT NULL,        -- the signed score (R+ positive, the race_ratings convention)
  rating_label TEXT NOT NULL,           -- the source's verbatim label (match race_ratings' label column name)
  observed_at TEXT NOT NULL,            -- ISO date the change was first logged (date granularity is enough; ratings don't move intraday)
  UNIQUE(race_id, source, observed_at)  -- idempotent: re-running the same day can't double-log
);
CREATE INDEX idx_rating_history_race_source ON rating_history(race_id, source, observed_at);
```
- `observed_at` is the **logging date**, not a rater-published date (we don't have published dates — we observe the table state). Date granularity (not datetime) — a rating that's stable for months then moves produces two rows months apart, which is the correct sparkline input.
- **Seed the baseline on first run:** the first tick has nothing to compare against, so EVERY current `race_ratings` row logs once (its current value at today's date). That's the series' starting point. Subsequent ticks only append on change. (Without this, the first actual change would log with no prior point and the sparkline would start mid-air.)

### "Last logged value" — derive it, don't store a separate watermark
For each `(race_id, source)`, the comparison baseline is the **most-recent `rating_history` row by `observed_at`** (a `MAX(observed_at)` per group, or a window). If the current `race_ratings.rating_score`/label differs from that latest logged row → append. No `dashboard_state` watermark needed — the history table IS the watermark. (Confirm this read is cheap at 137 races × 3 sources = ~411 rows max per tick; it's tiny.)

### Change predicate
Append when EITHER `rating_score` OR `rating_label` differs from the latest logged row for that `(race_id, source)`. (Score is the usual signal, but a label change at the same score — a rater renaming a category — is still a logged event. Belt-and-suspenders; cheap.)

## Phase 1 — schema + path confirm (HALT for sign-off)

1. Live-state reads (items 1–5 above): real `race_ratings` columns (esp. the label column name), confirm no history table exists, `wrapCronRoute` signature, the chosen unused cron hour, the baseline-derivation read.
2. **Dry-run the change-detect logic as a SELECT** (no writes): how many `(race_id, source)` rows are in `race_ratings` today (expect ~411 max — 137 × 3, but Inside Elections is Senate-only per SKILL, so fewer)? Confirm the baseline-seed first-run would log exactly that many rows once.
3. **Confirm the `markets` append-only pattern** is the right precedent to mirror (read its table + how `/api/cron/markets` appends) — or propose a cleaner shape if the live markets code suggests one.
4. Post the final `rating_history` DDL (column names reconciled with live `race_ratings`), the chosen cron slot, and the change-detect SELECT. **HALT for sign-off before writing the migration or the route.**

## Phase 2 — build (after sign-off)

### Migration
- `rating_history` table + index per the signed-off DDL (in `migrate.ts`, following the existing migration pattern).

### Cron route
- `app/api/cron/rating-history/route.ts` — `wrapCronRoute`, Bearer `CRON_SECRET`, `maxDuration: 60` in `vercel.json`, added to the Vercel cron schedule at the chosen hour.
- Logic: read all live `race_ratings` rows → for each, fetch its latest `rating_history` row (or none) → append if changed or if no prior row (baseline) → return a summary (`logged: N, unchanged: M`) into the `cron_runs` payload so the first-run baseline count and subsequent zero-row ticks are both legible in the log.
- Idempotent: the `UNIQUE(race_id, source, observed_at)` makes a same-day re-run a no-op (INSERT OR IGNORE).
- A `lib/` helper if the logic's non-trivial, mirroring how other crons factor their pipeline out (e.g. `ingestNews`).

### Local CLI (mirror the `sync:*` pattern)
- `npm run log:rating-history` (a thin `scripts/` wrapper around the same logic the route calls) so the logging can be run/tested locally, like `sync:news` / `sync:trades`. Prints `logged / unchanged / total`.

### Verification
1. First run logs the baseline — every current `race_ratings` row gets one `rating_history` row dated today. Report the count (should match the Phase 1 dry-run number).
2. **Second run same day → zero new rows** (the UNIQUE + change-detect both hold; this is the core property — a daily tick against static data is a no-op).
3. **Simulate a change**: hand-edit one `race_ratings` row's score (or reason through it via a temp value), re-run → exactly ONE new `rating_history` row for that `(race_id, source)`, none for the others. Revert the test edit.
4. The `cron_runs` row records the run with a legible `logged/unchanged` summary.
5. `wrapCronRoute` wraps it (a row appears in `cron_runs` with the route name).
6. Type-check clean, no console errors.

(No UI verification — there's no UI this handoff. No stylesheet check needed; nothing renders.)

## Out of scope (explicitly — this is the "plant the tree" handoff)
- **The sparkline itself.** No chart, no card change, no `RaceMapCard` edit, no `getRacesIndex` change. The history table just accumulates. The sparkline is a FUTURE handoff once weeks of data exist.
- Backfilling history before today — we have no historical rating data (the JSON seeds are current-state only), so the series legitimately starts at first-run. Don't fabricate past points.
- Logging anything other than the three seeded sources.
- Intraday/high-freq logging — daily is correct for a quarterly-moving signal; do NOT put this on the GitHub-Actions path.
- Any change to `seed:ratings` — the cron reads the table state post-seed; the seed script is untouched.
- Per-published-date accuracy — we log observation date, not rater-publish date (we don't have publish dates). That's a documented limitation, not a gap to fix.

## Acceptance
1. Phase 1 posted: live `race_ratings` columns, no-existing-table confirm, `wrapCronRoute` signature, chosen cron slot, change-detect dry-run count, final DDL. Sign-off before Phase 2.
2. `rating_history` table live; daily cron appends-on-change-only via `wrapCronRoute` at the chosen hour.
3. First run logs the baseline (one row per current rating); same-day re-run is a no-op; a simulated change logs exactly one row.
4. `log:rating-history` CLI mirrors the `sync:*` pattern.
5. SKILL: new `rating_history` subsection (the table, the change-detect daily cron + its slot, the append-only/`markets`-precedent note, the observe-date-not-publish-date limitation, the baseline-on-first-run behavior). Update the line-741 card-boundary note: rating-history sparkline is no longer "needs logging started first" — logging is now LIVE, the sparkline is the remaining build once data accumulates. Add the route to the cron-schedule list (the eight-becomes-nine count).
6. Type-check clean, working tree clean, pushed.
7. Commit: `feat(races): rating-history change-detect logging (HO 220)`

## Don't
- Don't build the sparkline or touch any card/UI — this is data capture only.
- Don't fabricate historical points — the series starts at first-run; that's honest.
- Don't put this on the GitHub-Actions high-freq cron — daily Vercel cron, quarterly signal.
- Don't add a `dashboard_state` watermark — the history table is the watermark (latest `observed_at` per group).
- Don't log identical rows — change-detect + the UNIQUE constraint both guard it; a static day writes zero rows.
- Don't modify `seed:ratings` — the cron reads post-seed table state, decoupled from the seed run.
- Don't trust this doc's `race_ratings` column names over the live schema — Phase 1 reconciles the DDL against the real table.
