# HO 174 — Refresh strip-race rosters after the May/June primaries

## Why

The HO 171 rosters were seeded pre-primary (verified 2026-06-01) with `status: "running"` for all challengers. The primaries have now happened:
- **GA Senate (May 19):** went to a **June 16 runoff** — Mike Collins and Derek Dooley advanced; Buddy Carter eliminated.
- **PA-10 (May 19):** resolved — Janelle Stelson (D) won the Dem primary decisively (~69-31); faces incumbent Scott Perry (R) in November.
- **NJ-07 (June 2 — TODAY):** still voting, no winner called. Also: HO 171 seeded a wrong name ("Megan O'Rourke") who is NOT in the field. The actual Dem field is **Rebecca Bennett, Michael Roth, Tina Shah, Brian Varela** (Bennett is frontrunner). Kean (R) unopposed.

So the rosters now show stale/incorrect data on a live dashboard. This refreshes all three, sourced from Ballotpedia/AP coverage (not memory), and corrects the NJ field error.

**Sourcing note (per SKILL rule):** all data below is from Ballotpedia + AP-sourced primary coverage (GMA/ABC, PA Capital-Star, NJ Monitor/Ballotpedia), June 2026. Not recalled.

## The data

### S-GA-2026 — GA Senate → June 16 RUNOFF
- Incumbent: Jon Ossoff (D) — unchanged on the race row.
- **Mike Collins (R)** — advanced to runoff. bioguide C001129 (sitting House rep).
- **Derek Dooley (R)** — advanced to runoff. No bioguide (non-member).
- **Buddy Carter (R)** — ELIMINATED. bioguide C001103. Mark withdrawn/eliminated (status per Phase 1 — likely `withdrew` or an eliminated status).
- New event: **June 16, 2026 GOP runoff** between Collins and Dooley.

### PA-10-2026 — RESOLVED
- Incumbent: Scott Perry (R) — unchanged on the race row.
- **Janelle Stelson (D)** — WON the Dem primary. Mark `won_primary`. No bioguide.
- The other HO 171 PA-10 entry was just Stelson, so no eliminations to add. (Optional: Isabelle Harman (Independent) is also in the Nov 3 general — add only if Phase 1 says independents belong in the roster; otherwise skip.)

### NJ-07-2026 — STILL VOTING (field correction only)
- Incumbent: Thomas Kean Jr. (R) — unchanged, unopposed in GOP primary.
- **Correct the Dem field** to the real four: **Rebecca Bennett, Michael Roth, Tina Shah, Brian Varela** — all `status: running`. Bennett is frontrunner.
- **Remove "Megan O'Rourke"** (HO 171 error — not a real candidate in this race).
- Leave all as `running` — primary not yet called. Will re-seed the winner later (separate follow-up).

## Phase 1 — Diagnostic (HALT after)

Don't write data yet. The runoff modeling is the risk — confirm the schema before seeding.

1. **Runoff representation (HO 107).** Read how runoffs are modeled. The SKILL references `getRunoffsForRace`, `getRunoffForRace`, `election_round`, and runoff rows in the `primaries` table with distinct ids. Report exactly: how is a runoff stored — a row in `primaries` with `election_round = 'runoff'`? What fields (date, candidates, race_id linkage)? How does the `/race/[id]` page + the dashboard drawer surface a runoff (the SKILL says `RaceRunoffs` renders it)? I need the exact shape before seeding the GA June 16 runoff.

2. **Candidate status values.** Read `race_candidates.status` usage + the `getRaceCandidates` status-ordering (won_primary → running → declared → withdrew → else). Report the exact allowed/recognized status strings. Specifically: is there an "eliminated"/"lost" status, or do eliminated candidates use `withdrew`? This decides how Carter (GA, eliminated) and the NJ field are marked. Confirm `won_primary` is the value for Stelson.

3. **Seed mechanism for runoffs.** Does `data/races-seed.json` / `seed:races` handle runoff rows, or are runoffs seeded separately (a different table/script)? Report how to add the GA June 16 runoff via the existing seed path, or flag if it needs a different mechanism.

4. **The NJ field correction.** Confirm that re-running `seed:races` with the corrected NJ-07 candidates will cleanly replace the roster — specifically, will removing "Megan O'Rourke" actually delete that row, or does the ON CONFLICT(race_id, name) upsert only add/update, leaving the stale O'Rourke row orphaned? Report whether a stale-row cleanup is needed (delete candidates not in the seed) or if the seed handles removal.

5. **Cache flush.** Confirm the tags to revalidate after seeding (races, race-ratings, and any runoff/primary tags).

**HALT. Report the runoff schema, the status values, the seed-vs-separate question for runoffs, the O'Rourke-removal mechanism, and the cache tags. Wait for sign-off before Phase 2.**

## Phase 2 — Implementation (only after sign-off)

Based on Phase 1:
- **GA:** mark Collins + Dooley as advancing (status per Phase 1), Carter eliminated; add the June 16 runoff via the confirmed mechanism.
- **PA-10:** mark Stelson `won_primary`.
- **NJ-07:** replace the Dem field with Bennett/Roth/Shah/Varela (all `running`), remove the stale O'Rourke row (via the cleanup Phase 1 identifies).
- Re-run `seed:races` (+ any runoff seed step). Report the insert/update/delete summary.
- Flush the cache tags.
- Update `last_verified` (auto-sets to run date per HO 171).

## Verification

- Show the diff (`races-seed.json` + any runoff seed changes).
- Report the seed summary.
- Confirm via SELECT: GA shows Collins/Dooley advancing + Carter eliminated + a June 16 runoff row; PA-10 shows Stelson won_primary; NJ-07 shows the corrected four with no O'Rourke.
- Confirm the GA drawer/`/race/S-GA-2026` surfaces the runoff (RaceRunoffs renders).
- Type check passes.

## Follow-up (not this handoff)

- **NJ-07 winner:** once AP calls the June 2 primary, re-seed the winner as `won_primary` and mark the others eliminated. Add to backlog.
- **GA runoff result:** after June 16, seed the runoff winner. Add to backlog.

## Out of scope
- No live results data (the parked live-primary feature is separate).
- No new races beyond the existing 4 strip races.
