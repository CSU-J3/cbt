# HO 171 — Seed candidate rosters for the strip races + fix isStub copy

## Why

`race_candidates` is empty table-wide (`data/races-seed.json` is `{ "races": [] }`), so the race drawers show only the incumbent — no challengers. This seeds notable-candidate rosters for the 4 dashboard-strip races from sourced Ballotpedia data (verified 2026-06-01), and fixes a related copy bug Code surfaced: the `isStub` "no competitive rating yet" line keys off the legacy `races.rating` column while the multi-source chips render off `race_ratings`, so a race with visible rating chips still claims it has no rating.

**Sourcing note (per SKILL rule):** these rosters are pulled from Ballotpedia, not recalled from memory. They are **pre-primary** — primaries resolve May 19 (GA, PA), June 2 (NJ), June 9 (ME) 2026 — so the general-election opponent isn't settled. Seeding the notable declared candidates (incumbent + frontrunners), status `running`, with `last_verified = 2026-06-01`. **Must be refreshed after the primaries resolve.**

## Sequencing

Run **after HO 170** (the drawer-confine-+-trim) lands. 170 changes how candidates render in the drawer (preview density, narrow column), and the roster needs to read correctly in that layout. If 170 isn't committed yet, halt and say so.

## The data to seed

Populate `data/races-seed.json` with these rosters. Status `running` for all (pre-primary; no winners yet). Party as shown. Incumbent is already on the race row — include them in the candidates list too if the seed schema expects the full roster, otherwise just the challengers (confirm against how `seed:races` + `getRaceCandidates` expect incumbents represented — see Phase 1).

**S-GA-2026** (GA Senate) — incumbent Jon Ossoff (D). Notable GOP primary challengers: Buddy Carter (R), Mike Collins (R), Derek Dooley (R).

**S-ME-2026** (ME Senate) — incumbent Susan Collins (R). Notable Dem primary challengers: Janet Mills (D), Graham Platner (D).

**NJ-07-2026** (NJ-07 House) — incumbent Thomas Kean Jr. (R). Notable Dem primary challengers: Rebecca Bennett (D), Megan O'Rourke (D), Michael Roth (D).

**PA-10-2026** (PA-10 House) — incumbent Scott Perry (R). Notable Dem challenger: Janelle Stelson (D).

All `last_verified: "2026-06-01"`, source attribution Ballotpedia.

## Phase 1 — Diagnostic (HALT after)

Don't edit data or code yet.

1. **Read `data/races-seed.json` schema + the `seed:races` script** (`scripts/`). Report the exact JSON shape a race entry expects: the keys for the race id, the candidates array, per-candidate fields (name, party, status, bioguide_id?, source_url?). Confirm how the incumbent is represented — is the incumbent expected in the candidates array, or only on the race row via `incumbent_bioguide_id`? This determines whether I list incumbents in the roster or just challengers.

2. **Confirm `getRaceCandidates` + `RaceCandidates` render** the seeded fields. Report what `RaceCandidates` shows per row (name, party dot, status) so the seed populates what the UI reads. Confirm the status ordering (won_primary → running → declared → withdrew → name) handles an all-`running` field gracefully (they'll all be `running` pre-primary).

3. **The `isStub` copy bug.** Read the `isStub` logic in `RaceHubBody` (Code's HO 166 diagnostic located it: `isStub = !race.rating && candidates.length === 0 && runoffs.length === 0`). Report: it keys off `race.rating` (legacy single column, null for these races) while the multi-source chips render off the `ratings` array (`race_ratings`). Propose the fix: `isStub` should consider a race non-stub when it has **either** a legacy `rating` **or** multi-source `ratings.length > 0` **or** candidates **or** runoffs. So a race with rating chips never shows "no competitive rating yet." Confirm the exact condition change.

4. **bioguide linkage.** The incumbents have bioguide_ids (they're sitting members). For challengers, most won't have one (not in `members`). Confirm `race_candidates.bioguide_id` is nullable and the render handles null (no broken member link for a non-member challenger). Report whether any challenger here IS a sitting member with a bioguide (e.g. Buddy Carter and Mike Collins are sitting House reps running for Senate — they have bioguides; linking them to their member hubs would be a nice touch but confirm the seed supports it).

**HALT. Report the seed schema, the incumbent-representation answer, the isStub fix condition, and the bioguide-linkage finding. Wait for sign-off before Phase 2.**

## Phase 2 — Implementation (only after sign-off)

1. **Seed the rosters** into `data/races-seed.json` per Phase 1's confirmed schema, then run `npm run seed:races`. Report the insert summary (rows added per race).
2. For challengers who are sitting members (Buddy Carter, Mike Collins — both House reps), include their bioguide_id if Phase 1 confirms the seed supports member-linking, so their drawer entries link to their member hubs. Non-member challengers get null bioguide (no link).
3. **Fix `isStub`** per the Phase 1 condition so races with multi-source rating chips don't render the "no competitive rating yet" line.
4. After seeding, flush the race cache: hit `/api/revalidate?tag=races` and `/api/revalidate?tag=race-ratings` (the seed scripts don't POST revalidate per SKILL — manual flush needed).

## Verification

- Show the diff (`races-seed.json` + the `isStub` change).
- Report the `seed:races` insert summary.
- Confirm `SELECT race_id, name, party, status FROM race_candidates WHERE race_id IN ('S-GA-2026','S-ME-2026','NJ-07-2026','PA-10-2026')` returns the seeded rosters.
- Confirm the GA drawer no longer shows "no competitive rating yet" (isStub fix) and now lists the challengers.
- Type check passes.

## Refresh reminder (for the backlog / Corey)

These rosters are pre-primary, verified 2026-06-01. After the primaries (GA/PA May 19, NJ June 2, ME June 9), the general-election opponent is set — refresh `races-seed.json` to mark the primary winner (`won_primary`) and drop also-rans, then re-run `seed:races`. Add to `docs/backlog.md`.

## Out of scope

- No new races beyond the 4 strip races (seed those first; expand later if wanted).
- No change to `/primaries` (which tracks full primary fields separately via `primary_candidates`).
- No drawer layout changes (HO 170 owns that).
