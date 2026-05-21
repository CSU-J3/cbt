# 107 — LA Senate 2026 runoff tracker (proof-of-concept)

## What this is

First runoff tracking implementation. Scoped to a single race — Louisiana Senate 2026 — as the proof-of-concept for the broader runoff pattern. Subsequent runoffs (LA House, MS/GA/AL federal, future cycles) will follow once this one is shipped and we've learned what the pattern actually wants.

Includes data layer + ingestion + UI surface on the race page. The June 27 runoff date drives the urgency: scaffolding needs to land before the election so results can populate against existing rows rather than retrofit.

This handoff has a hard pre-flight gate. Don't write any schema migration, scraper code, or UI changes until phase 1 finishes and the schema proposal is signed off in chat.

---

## Phase 1 — Pre-flight (HALT for sign-off before phase 2)

Three deliverables in this phase, all in chat, no commits.

### 1a. Source liveness verification

Two candidate sources, both need a real fetch before committing:

- **Ballotpedia** — same pattern as primary scraping, consistent with HO 91-96. Check whatever Ballotpedia URL covers the LA Senate 2026 runoff. If it's a section on the broader race page, note where. If Ballotpedia hasn't pre-built the runoff page yet (possible given the runoff date hasn't passed), say so.
- **LA Secretary of State** — official source, possibly more authoritative for results once they come in, possibly more setup cost for parsing. Find whatever URL the LA SOS publishes for the 2026 Senate runoff candidate list and (eventually) results. Confirm it's actually live and returns useful structured content (HTML table, PDF, JSON endpoint, whatever).

For each: report URL, what the page contains right now, and a rough read on parser complexity (regex-able, structured table, JS-rendered SPA, etc.).

Recommend one. Trade-offs: Ballotpedia is the safer reuse path; LA SOS is the durable authoritative source. Pick based on what's actually live and parseable today.

### 1b. Race fact verification

Before assuming "LA Senate 2026 runoff" is a meaningful thing on the date claimed:

- Confirm there is a 2026 Senate race in Louisiana (which seat, which incumbent)
- Confirm the LA jungle primary date and the runoff date
- Confirm the candidates who advanced to the runoff (if known) — or note that the primary hasn't happened yet and runoff candidates aren't determined

The carry-over note from a prior session said "LA Senate June 27 (Letlow vs Fleming)" — verify this against the actual race. Names and date may have been misremembered. The handoff is for whatever the real 2026 LA Senate runoff is, not for those specific names.

### 1c. Schema proposal

Three candidate directions, pick one and justify:

- **A. Extend `primaries`** with an `election_round` column (`'primary' | 'runoff'`) or `is_runoff` boolean. Runoffs become additional rows in the same table; `primary_candidates` extends to cover both via the FK. Smallest schema delta. Requires `primaries` queries to filter by round in most places.
- **B. New `runoffs` + `runoff_candidates` tables** mirroring the primaries structure. Cleaner separation, no need to thread an extra filter through every query, but doubles the surface area for query helpers and sync code.
- **C. Something else** that fits the existing schema better than A or B. Look at what's actually there before recommending.

Read `lib/queries.ts` and the existing primaries schema first. The pre-flight discipline from the SKILL says don't propose a schema that references nonexistent columns. The HO 106 mistake (verification queries referenced `primary_candidates.state`/`.chamber`/`.candidate_name` that don't exist) is the cautionary tale.

Whichever direction is picked, the proposal needs to include:

- Migration sketch (CREATE TABLE or ALTER TABLE statements)
- Which existing queries change and how (just naming them is fine, not full diffs)
- Whether `unstable_cache` tags need to extend (`'primaries'` exists; does a `'runoffs'` tag get added or does the existing one cover both?)
- Whether the `/race/[id]` page query path needs a new helper or can reuse existing primary helpers

### HALT

Once 1a + 1b + 1c are in chat, stop. Do not commit any code or run any migrations. Wait for sign-off on (i) which source, and (ii) which schema direction. Implementation in phase 2 only starts after explicit go.

---

## Phase 2 — Implementation (after sign-off)

Based on the signed-off schema and source decisions:

1. Migration in `scripts/migrate.ts`. Idempotent (`IF NOT EXISTS`). Indexes per the existing pattern.
2. Scraper/parser for the chosen source. New module if it doesn't fit `lib/primary-candidates-scrape.ts` cleanly; extension if it does. Don't pollute `parseCandidatesPage` with runoff-specific branches if it can be avoided.
3. Sync entry point. Mirror the HO 91 pattern: `scripts/sync-runoffs.ts` or whatever fits, callable via `npm run sync:runoffs` (or extend the existing primaries script with a `--runoff` flag).
4. Query helpers in `lib/queries.ts` per the schema proposal.
5. `cron_runs` wiring if (and only if) a cron entry gets added. For LA Senate as one race, on-demand sync is fine for now — don't wire a cron yet. The HO 91 pattern was manual-first; same here.

### Results scaffolding

The runoff hasn't happened yet (June 27). Two candidate rows go in now with the candidate names and party. A `result_status` field (or equivalent) tracks `'pending' | 'winner' | 'loser'`. After June 27, results populate against existing rows rather than inserting new ones.

The schema proposal needs to account for this. If extending `primary_candidates`, decide if `result_status` makes sense as a generalized field or if results live somewhere else.

---

## Phase 3 — UI surface

The race page (`/race/[id]`, from HO 62) is the destination. For the LA Senate 2026 race ID (whatever the convention is — likely `LA-SEN-2026` or `senate-LA-2026`), the page should show:

- A clear "RUNOFF" badge or section header indicating this race went to runoff
- Runoff date prominently displayed
- The two runoff candidates with party indicators
- Results once available, replacing or supplementing the "pending" state

Reuse the existing race page chrome and component patterns from HO 62. Don't introduce new design tokens or row layouts. The runoff section is additive to the existing race page, not a parallel surface.

Home dashboard does NOT need a runoff callout for a single race. If/when multiple runoffs are tracked, revisit. Out of scope for this handoff.

---

## In scope

- LA Senate 2026 runoff only (one race, single state, single chamber)
- Phase 1 pre-flight in chat, with halt
- Phase 2 data layer + ingestion (manual sync, no cron)
- Phase 3 race page UI badge + candidate display + results scaffolding
- SKILL.md update covering the new schema element(s), the new sync entry, and the runoff convention
- `cron_runs` integration if a cron route is introduced (otherwise skip)

## Out of scope

- LA House runoffs (HO 108 territory if/when needed)
- Other states' federal runoffs (MS, GA, AL, etc.)
- General-election runoffs (different mechanism than primary runoffs)
- Historical backfill of past LA Senate runoffs
- Automated cron for runoff syncing
- Home dashboard runoff badge or aggregation
- Any change to the primaries cursor or `/api/cron/primaries` (HO 105 / HO 106 territory)

## Acceptance

1. Phase 1 deliverables in chat: source recommendation with URLs and parser-complexity read, race fact verification, schema proposal with migration sketch and query-impact notes. Halt for sign-off before any commit.
2. After sign-off, phase 2 ships: migration runs clean, sync populates the runoff candidates for LA Senate 2026, verification query confirms rows exist with correct party/name/result_status.
3. Phase 3 ships: `/race/<la-senate-2026-id>` renders the runoff badge, date, and candidates. No console errors. Spot-check on `npm run dev` against the local DB before pushing.
4. SKILL.md updated.
5. Commits: one for phase 2 (data layer), one for phase 3 (UI). Don't bundle. Pre-flight phase 1 chat happens before either commit.
6. Working tree clean at end. Push.

## Notes

- The "let Code propose schema" decision means phase 1 is doing real design work, not just verification. Treat the schema proposal with the same rigor as a real PR — read the existing schema, query helpers, and `unstable_cache` tags before proposing.
- The HO 106 schema-reference mistake is the relevant cautionary tale. Don't propose columns that don't exist; don't reference tables you haven't verified.
- The carry-over reference to "Letlow vs Fleming, June 27" may be wrong. Phase 1b's job is to verify what's actually true. The handoff covers whatever the real race is.
- If phase 1 reveals that the LA Senate 2026 runoff doesn't exist yet (primary hasn't happened), or the candidates aren't determined, say so — the handoff may need to wait or pivot to scaffolding-only-no-candidates-yet.
- If both sources turn out to be unusable (Ballotpedia hasn't built the page, LA SOS publishes only PDFs that need OCR), flag and stop. Don't force a scraper against a bad source.
