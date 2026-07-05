# HO 419 — Member ideology: Voteview DW-NOMINATE

> Self-claim the next free number: `ls docs/handoffs/ | sort -V | tail`. Body assumes 419 (417 = FEC doc sweep, 418 = metro-zoom roadmap reconcile). If HEAD has moved, renumber.
>
> **Code + migration only. No docs.** SKILL.md, roadmap.md, backlog.md, oddities.md are all **out of scope** — they defer to a follow-up doc sweep (see Docs below). Do not touch `docs/` or `SKILL.md` in this handoff.
>
> Spec-driven: **propose the plan, wait for review, show the diff, no auto-commit.** Run `sync:ideology` once and paste the diagnostic **before** committing, so coverage is confirmed against live data first. `git add` by explicit pathspec, ancestry re-checked immediately before push.

## Grounding — what liveness/format verification settled (don't re-derive)

- **Voteview is live and actively maintained** — UCLA Political Science (Lewis/Poole/Rosenthal et al.), 2026 citation, data "updated live as new votes are taken." Not in the graveyard.
- **The member file carries `bioguide_id` natively.** Confirmed against the official column docs (`voteview.com/articles/data_help_members`), the Princeton libguide, and the `voteviewr` package column dump. **So we join Voteview → `members` on `bioguide_id` directly.** The HO 402 crosswalk's ICPSR bridge is *not* on this path, and the "~60% native via ICPSR" figure from earlier planning was measuring the crosswalk's ICPSR fill, not this join. Expect coverage near-complete for current members who've cast a roll call — the diagnostic reports the real number.
- **File URL scheme** (confirmed by UCLA directly): `HSall_members.csv` for all congresses, or `Cnnn_members.csv` per chamber/congress where `C ∈ {H,S,HS}` and `nnn` is the zero-padded 3-digit congress. We want **`HS119_members.csv`** (both chambers, 119th only — ~535 rows, not the ~50k-row `HSall` history).
- **Served as `application/octet-stream`** static file, HTTP 200, no Cloudflare/bot wall (verified by direct fetch). Read the response as UTF-8 text and parse CSV — don't gate on content-type.
- **Column order** (parse by header name, not position): `congress, chamber, icpsr, state_icpsr, district_code, state_abbrev, party_code, occupancy, last_means, bioname, bioguide_id, born, died, nominate_dim1, nominate_dim2, nominate_log_likelihood, nominate_geo_mean_probability, nominate_number_of_votes, nominate_number_of_errors, conditional, nokken_poole_dim1, nokken_poole_dim2`.
- **CSV footgun (this is the trap):** `bioname` is a quoted field with an embedded comma (`"ROGERS, Mike Dennis"`) sitting **before** `bioguide_id` and the `nominate_*` fields. A naive `split(',')` shifts every column after `bioname` by one and silently corrupts the scores. **Parse quote-aware and index columns by header name.** If the repo already vendors a CSV util, reuse it; otherwise a minimal quoted-field tokenizer — do **not** add an npm package for this.

## Source pull

- Fetch `https://voteview.com/static/data/out/members/HS119_members.csv`.
- `nominate_dim1` is the headline (first dimension, economic left/right — Voteview says it's what most users want). `dim2` is the second dimension. `nokken_poole_dim1/dim2` are the per-congress variant (a member can move each congress; NOMINATE `dim1/2` are career-static). Store both pairs.
- A `chamber='President'` row (Trump) may be present in the file — the members gate below drops it. Don't special-case it.

## Table (via the existing migration path, `CREATE TABLE IF NOT EXISTS`)

Same additive, current-scoped shape as the HO 402 crosswalk tables. `member_*` family.

```sql
CREATE TABLE IF NOT EXISTS member_ideology (
  bioguide_id        TEXT PRIMARY KEY,   -- join key to members
  icpsr              INTEGER NOT NULL,   -- kept for a future Voteview votes/rollcalls join
  congress           INTEGER NOT NULL,   -- 119 for this sync
  chamber            TEXT    NOT NULL,   -- Voteview's value: 'House' | 'Senate'
  nominate_dim1      REAL,               -- headline: economic left/right; NULL if no estimate yet
  nominate_dim2      REAL,
  nokken_poole_dim1  REAL,               -- per-congress variant
  nokken_poole_dim2  REAL,
  number_of_votes    INTEGER,            -- nominate_number_of_votes; estimate confidence
  conditional        INTEGER,            -- 1 = provisional estimate (subject to next full run)
  updated_at         TEXT    NOT NULL    -- ISO, set every sync
);
```

- **Members gate (can't-invent-a-member, the HO 402 pattern):** insert only where `bioguide_id IN (SELECT bioguide_id FROM members)`. A Voteview 119th row whose bioguide isn't on the current roster (departed mid-term, the President) is **skipped and counted**, never an orphan.
- **Dedup:** a bioguide with more than one 119th row (a mid-term chamber switcher, or House+Senate service in the same congress) keeps the row with the **most `nominate_number_of_votes`** — deterministic, primary-chamber dominates. Mirrors the FEC scoring-tie tie-break.
- **Idempotent:** upsert `ON CONFLICT(bioguide_id) DO UPDATE`, overwriting the score fields + `updated_at` each run (Voteview re-estimates live, so scores can move).
- **No secondary index.** ~535 rows; the PK covers the join and a full scan is sub-millisecond. Same judgment as the `/dashboard-classic` reads — don't spend an index on a tiny scan. `nominate_dim1` is nullable (a member with zero votes has no estimate).

## Sync script + chain wiring

- `scripts/sync-ideology.ts`, npm script `sync:ideology`.
- Runs **after `sync:members` → `sync:crosswalk`** (needs `members` populated for the gate). Wire it into whatever sequences that pair today (package.json script or the sync runbook), same position.
- **Manual/periodic, matching `sync:crosswalk` — do NOT add it to the daily Vercel cron.** Scores drift slowly and it's gated on a manual `members` refresh anyway. A weekly refresh cron is a later option, not this handoff.

## Diagnostic (read-only)

`scripts/diagnostic/ideology-coverage-419.ts`, mirroring `crosswalk-coverage-402.ts`. Report:

- Rows fetched (119th), gated-in count, and **coverage = matched / current members** — the number that retires the 60% assumption.
- `nominate_dim1 IS NULL` count (members with no estimate yet — freshmen / too few votes).
- `conditional = 1` count (provisional estimates).
- `party_code` (100=D / 200=R / 328=I) vs `members.party` disagreements — ICPSR party-switch quirks; **input for a future note, not fixed here.**
- Off-roster skip count (Voteview 119th bioguides not in `members`).

## Deferred (name, don't build)

- **Surfaces** — each its own handoff: member-hub ideology line (dim1 placement + a provisional/low-vote flag off `conditional`/`number_of_votes`), an ideology axis on the existing `SponsorProductivityScatter`, chamber/party ideology medians on the dashboard. This handoff is the data layer only, same as the crosswalk shipped plumbing before surfaces.
- **Voteview roll-call positions** — `icpsr` is stored so a later "how did X actually vote" surface can join Voteview's `votes`/`rollcalls` files (`HSall_votes.csv` / `HSall_rollcalls.csv`) on `icpsr`. Not now.
- **Weekly `sync:ideology` cron** — only if live-score drift ever becomes felt-important.

## Docs (deferred to a follow-up sweep — do not write here)

The sweep will carry: SKILL.md schema + sync-chain entry; a roadmap Member-depth note (this is enabling data, gauge whether it moves the bar or rides as an "Also"); a backlog DONE tombstone; and two oddities — the `bioname` CSV-misalignment trap, and "Voteview carries `bioguide_id` natively, join direct (the ICPSR bridge is not the path)."

## Commit discipline

Propose the plan; wait for review. One code commit: the migration + `scripts/sync-ideology.ts` + `scripts/diagnostic/ideology-coverage-419.ts` + the package.json script + the chain wiring. Explicit pathspec, ancestry re-checked before push. **Run `sync:ideology` once and paste the diagnostic before committing.** Show the diff — no auto-commit.

## Report back

The coverage number (matched / current), the NULL-score + `conditional` counts, the `party_code` disagreement list, the off-roster skip count, and the diff. Confirm SKILL.md and `docs/` are untouched (deferred to the sweep).
