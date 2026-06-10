# HO 182 — NJ-07 primary resolved: Bennett won, re-seed roster

## Why

The NJ-07 Democratic primary (June 2, 2026) has been called. **Rebecca Bennett won** the Democratic nomination and faces incumbent Rep. Thomas Kean Jr. (R) in the November general election. (Sourced from AP-syndicated coverage / WHYY NJ primary recap + Ballotpedia, June 3 2026 — not recalled.)

HO 174 seeded the NJ-07 Dem field (Bennett, Roth, Shah, Varela) all as `status: running` pending the result. Now that it's called, re-seed:
- **Rebecca Bennett (D)** → `won_primary`
- **Michael Roth (D)** → `withdrew` (eliminated — the canonical "out" status; no eliminated/lost status exists per HO 174)
- **Tina Shah (D)** → `withdrew`
- **Brian Varela (D)** → `withdrew`
- **Thomas Kean Jr. (R, incumbent)** → unchanged on the race row (was unopposed in the GOP primary).

General matchup: Kean (R, incumbent) vs. Bennett (D).

## Scope

This is a small sourced-data re-seed, same pattern as HO 174 (which used `data/races-seed.json` + `seed:races`). No schema or runoff complexity here — NJ-07 is a straight primary resolution, no runoff.

## Phase 1 — quick check (then proceed)

1. Confirm the current NJ-07-2026 roster in `race_candidates` matches HO 174's seed (Bennett, Roth, Shah, Varela, all `running`). If a stale row exists (e.g. the old O'Rourke entry was supposed to be deleted in HO 174 — confirm it's actually gone), flag it.
2. Confirm the `seed:races` path: editing `data/races-seed.json`'s NJ-07 candidate statuses + re-running `seed:races` updates via `ON CONFLICT(race_id, name) DO UPDATE`. Since all four names already exist, this is a pure status update (no inserts, no deletes needed).
3. Confirm the cache tag to flush (`races`).

Brief — this is a known pattern. Report the current roster + the plan, then proceed (no heavy gate; it's a data update on an established path).

## Phase 2 — re-seed

- Update `data/races-seed.json` NJ-07-2026: Bennett `won_primary`; Roth/Shah/Varela `withdrew`.
- Run `seed:races`. Report the update summary.
- Flush the `races` cache tag (POST /api/revalidate?tag=races).
- `last_verified` auto-sets to run date (2026-06-03).

## Verification
- SELECT NJ-07-2026 from `race_candidates`: Bennett `won_primary`, Roth/Shah/Varela `withdrew`.
- Confirm the dashboard race popover + `/race/[id]` for NJ-07 show Bennett as the nominee (won_primary sorts first, withdrawn dimmed/last per `getRaceCandidates` ordering).
- Type check (should be a no-op — data only — but confirm no code touched).
- Commit: `feat(races): NJ-07 primary resolved — Bennett nominee (HO 182)`.

## Backlog reminder (not this handoff)
- GA Senate runoff (Collins vs Dooley) is June 16 — seed the winner after.

## Out of scope
- No other races (GA runoff pending June 16; PA-10 already resolved in HO 174).
- No live-results feature (parked).
