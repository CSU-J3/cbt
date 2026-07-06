# HO 427 — Data layer: per-Congress polarization medians (Voteview HSall)

> Self-claim the next free number: `ls docs/handoffs/ | sort -V | tail`. Body assumes 427 (426 = the ideology doc sweep, `0c09303`). If HEAD moved, renumber.
>
> **Code + migration only. Docs deferred** to a follow sweep (SKILL schema + sync-chain, roadmap, backlog, oddities). Don't touch `docs/` or `SKILL.md`. Spec-driven: propose the plan, wait for review, show the diff, no auto-commit. `git add` by explicit pathspec, ancestry re-checked before push. This adds a data source, so the graveyard rule applies: re-confirm the file responds and paste the diagnostic before committing.

This is the data gate for ship 3, the polarization-over-time chart. It stores per-Congress, per-chamber D/R medians of DW-NOMINATE `dim1` so the chart has a real historical curve. No user-facing surface here; that's the build handoff after this lands.

## Grounding — what verification already settled (don't re-derive)

- **`HSall_members.csv` is live** (Voteview, UCLA). Fetched directly this arc at HO 419: served as `application/octet-stream`, HTTP 200, no bot wall. Same URL, same schema. Re-confirm it responds at build time (the standard), but the source isn't in question.
- **Same schema, same trap as HO 419.** The columns needed are `congress`, `chamber`, `party_code`, `nominate_dim1`. `bioname` is a quoted field with an embedded comma sitting before those, so a naive `split(',')` corrupts every later column. **Reuse the quote-aware parser in `scripts/voteview-source.ts`** (extend it to fetch the full `HSall` file if it currently only fetches `HS119`); do not add a CSV dependency.
- **The historical data exists.** Per-Congress party medians over time is Voteview's flagship output. `party_code` 100 (D) / 200 (R) are populated from the mid-1800s on (Republicans first appear in the 34th Congress, 1855). The diagnostic confirms coverage empirically rather than trusting this.

## Source

- Fetch `https://voteview.com/static/data/out/members/HSall_members.csv` (the full history, ~50k rows). We aggregate it down to a few hundred median rows, so the raw file is read once and discarded, never stored per-member.
- Fields used per row: `congress` (int), `chamber` (Voteview `House`/`Senate`), `party_code` (keep 100 and 200 only), `nominate_dim1` (skip NULL).

## Table (via the migration path, `CREATE TABLE IF NOT EXISTS`)

```sql
CREATE TABLE polarization_history (
  congress    INTEGER NOT NULL,
  chamber     TEXT    NOT NULL,   -- normalized lowercase: 'house' | 'senate'
  dem_median  REAL,               -- median nominate_dim1 over party_code 100
  rep_median  REAL,               -- median nominate_dim1 over party_code 200
  PRIMARY KEY (congress, chamber)
);
```

- `gap` is not stored. Derive it as `|rep_median - dem_median|` in the chart query, the identical definition the band uses, so there's one gap formula in the codebase.
- `chamber` stored lowercase (normalized from Voteview's `House`/`Senate`) to match the app convention and the over-time chart's HOUSE/SENATE toggle.
- ~a few hundred rows (2 chambers × the covered Congresses). PK covers every read; no secondary index.

## Sync script + wiring

`scripts/sync-polarization-history.ts`, npm `sync:polarization-history`.

- Fetch + quote-aware parse (the `voteview-source.ts` parser). Keep rows with `party_code IN (100, 200)` and `nominate_dim1 IS NOT NULL`. Group by `(congress, chamber, party)`, compute the median of `nominate_dim1` per group **app-side, pinning the identical method the band uses**: sort ascending, odd length → middle element, even → mean of the two middle. Strict D and R only, the same rule as `getPolarizationBand` and the dotplot.
- Normalize `chamber` to lowercase on write.
- Idempotent: upsert on `(congress, chamber)`, overwriting the two medians each run (it's a full recompute from source).
- **Manual, not cron** (matches `sync:ideology` / `sync:crosswalk`). Wire the `package.json` script; nothing schedules it.

`median()` now lives in three inline copies (the band query, the dotplot component, this sync). **Pin it inline here too, identical method** — do not refactor the shipped copies in this handoff. Log a QUEUED cleanup instead: extract a pure `median()` into a dependency-free util (no `next/cache`) that all three import, which would also let the client-island dotplot drop its inline copy. That's its own small change, not this one.

## Diagnostic (read-only)

`scripts/diagnostic/polarization-history-coverage.ts`. Report:

- Rows written, and the Congress range covered per chamber.
- The earliest Congress carrying both a D and an R median (the clean two-party start, expect the 34th, 1855).
- Any Congress inside that range missing a party (report, don't fix).
- **The cross-check that gates the chart:** the 119th `dem_median` / `rep_median` from `polarization_history` vs the medians `getPolarizationBand` computes from `member_ideology` (the band's live 0.92/0.92). **These must match.** `HS119` is a slice of `HSall`, so equal Voteview data through the same strict-D/R method must produce the same 119th medians. A mismatch means the two paths diverge on party filtering, the median method, or chamber normalization, catch it here before the chart renders a current gap that disagrees with the band. Print both side by side.

## Deferred (name, don't build)

- **Ship 3, the over-time chart** (its own build handoff): plots the historical line from `polarization_history` and reads the **current-Congress right-edge dots from `getPolarizationBand`** (live), so the current point always equals the band while the line supplies history. Year on x is derived from Congress (`year = 1789 + 2*(congress-1)`; 1879 = the 46th Congress, the mockup's start). It's the fourth live hand-rolled SVG chart, so extract the shared scatter scaffold then. **Let the real curve set the narrative** — the mockup's asymmetry claim and its 0.81/0.88 endpoints were illustrative (the real 119th is 0.92/0.92); the caption follows what the data shows.
- The QUEUED shared-`median()` util extraction above.

## Docs (deferred to a follow sweep — don't write here)

SKILL schema (`polarization_history`) + sync-chain (`sync:polarization-history`, manual); a roadmap note; a backlog tombstone; and any oddity the coverage surfaces (e.g. the historical `party_code` boundary, or a Congress with a one-party chamber).

## Commit discipline

Propose the plan (re-confirm `HSall` responds, then the aggregation + the cross-check). One code commit: the migration + `scripts/sync-polarization-history.ts` + `scripts/diagnostic/polarization-history-coverage.ts` + the `package.json` script + any `voteview-source.ts` extension for the full-file fetch. Explicit pathspec, ancestry re-checked before push. **Run `sync:polarization-history` once and paste the diagnostic, including the 119th cross-check, before committing.** Show the diff, no auto-commit.

## Report back

Coverage (range per chamber, the two-party start, any missing-party Congresses), the 119th cross-check result (history vs band, expect a match at 0.92/0.92), the diff, and confirmation `docs/` and SKILL are untouched.
