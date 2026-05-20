# 94 — Members table refresh + primary candidate re-match (corrected)

## What this is

Two coupled problems surfaced by HO 93's match rate:

1. **Coverage gap.** The `members` table is currently seeded from `SELECT DISTINCT sponsor_bioguide_id FROM bills`, so any current member who hasn't sponsored a bill yet (Christian Menefee post-special-election in TX-18, similar cases) is structurally missing. Sylvester Turner is also still listed despite dying March 2025.
2. **Matcher mismatch across mid-decade redraw.** `primary_candidates` is keyed to the 2026-election map (from Ballotpedia). `members` is correctly keyed to the current 119th map (from Congress.gov). These maps disagree in TX and FL. The matcher joins on `(state, district)` and misses every redrawn incumbent — Al Green is TX-9 in members (correct) and TX-18 in primary_candidates (also correct). This is structural, not staleness. Refreshing members alone cannot fix it.

This handoff addresses both: re-seed members from the Congress.gov roster endpoint, and add a name-within-state fallback to the incumbent matcher so it survives any redraw.

## In scope

- Replace the current `members` seeding (DISTINCT bill sponsors) with a sync against `/member/congress/119`
- Add `is_current` boolean (or equivalent) using the API's `currentMember` flag
- Soft-mark non-current members (`is_current = false`); don't delete rows
- Add the incumbent matcher's name-within-state fallback path (House only — Senate already matches by state alone)
- Re-run the matcher against all existing `primary_candidates` rows (~323 NE + ~950 South)
- Report match-rate delta

## Out of scope

- Cosponsors, committees, vote data (roadmap theme 6, separate work)
- AR-01, AR-03, NC-02 Ballotpedia data gaps
- LA jungle parser (HO 93.5)
- House Midwest / West scrapes (HO 95, 96)
- Re-scraping any `primary_candidates` rows — they're correct as-is

## API endpoints (verified — use these exact paths)

- `GET /member/congress/119` — full 119th roster, 551 members across 3 pages of 250
- `GET /member/congress/119?currentMember=true` — 536 currently-serving members
- `GET /member/{bioguideId}` — single member detail if list endpoint is sparse on district info

The 551 vs 536 gap is the inactivity signal (deaths, resignations, expulsions). Use `currentMember=true` to set `is_current = true` on the upsert; everything else gets `is_current = false`.

Do NOT use `/member?congress=119` — that endpoint does NOT filter by Congress and returns 2,692 historical members back to Barney Frank. Verified mistake.

## Implementation

1. **Build `scripts/sync-members.ts`** following the shape of `scripts/sync-primaries.ts`. Replace whatever currently populates `members` from `bills.sponsor_bioguide_id`. If that previous logic lives somewhere worth preserving (one-off backfill script), leave it alone but stop using it for ongoing refresh.

2. **Schema:** add `is_current BOOLEAN NOT NULL DEFAULT 1` if not already present. Don't add `end_date` unless the project will use it.

3. **Sync logic:**
   - Page through `/member/congress/119` collecting all 551 members
   - Page through `/member/congress/119?currentMember=true` to get the 536 current set (or just use the term info on each member record if it includes a current/end-of-service flag — Congress.gov returns `terms` arrays with `endYear`; the absence of an `endYear` on the most recent term means still serving)
   - Upsert by `bioguide_id`: `name`, `party`, `state`, `district` (null for senators), `chamber`, `is_current`
   - District comes from the most recent term in the API response

4. **Matcher fix.** In whatever function does incumbent matching for House candidates (likely in `scripts/sync-primaries.ts` based on HO 92/93's location):
   - Keep the existing `(state, district)` join as primary path
   - Add fallback: if no match on `(state, district)`, try `(state, normalized_last_name)` against `members WHERE chamber='house' AND state=? AND is_current=true`
   - If the name fallback returns exactly one hit, use it
   - If it returns multiple hits, try adding first-name disambiguation
   - If it still returns multiple, leave unmatched and log
   - Senate matcher already joins on state-only (no district), so no change there
   - Reuse the multi-word surname / suffix normalization from HO 92

5. **Re-run matcher** against all existing `primary_candidates` and update the incumbent linkage column. Report which rows changed.

## Validation

Print to stdout:

1. Members table count before / after (expect ~536 current after, plus any non-current rows preserved)
2. Newly-added members (count + list — Menefee should appear here)
3. Members marked `is_current = false` (count + list — Turner should appear here)
4. Matcher re-run: count of `primary_candidates` rows where incumbent linkage changed (was null → now matched, or was matched-to-wrong → now matched-to-correct)
5. New aggregate match rates: Northeast (was 66/76), South (was 116/157), combined

Spot-checks — print PASS/FAIL:

- Sylvester Turner (T000489 — bioguide verified from HO 93 output) is `is_current = false`
- Christian Menefee is in the table with `is_current = true` at TX-18
- Northeast match rate is approximately unchanged (no redraw in NE)
- South House match rate improves measurably — TX's 12 unmatched and Frankel-FL should resolve via the name fallback path
- Al Green's TX-18 primary_candidates row now links to Al Green in members (who is at TX-9 — that's the matcher fallback doing its job, not a data fix)

## Acceptance

- All spot-checks PASS
- Coverage gap closed (any 2025 special-election winners now present)
- Turner soft-marked
- South House match rate improves enough that the remaining unmatched are clearly genuine open seats (retirements, other-office runs)
- One SKILL.md note added: "members refresh against /member/congress/119; re-run after any known special election or redraw, quarterly at minimum"
- One SKILL.md note added: "incumbent matcher uses (state, district) with (state, last_name) fallback for House — survives mid-decade redraws"
- Commit as `feat: members refresh + matcher name-fallback (HO 94)`

## Notes

- The Congress.gov member endpoint rate limit is the same 5,000/hour; full refresh is ~3 page requests plus optional per-member detail calls. No concern.
- Pagination on `/member/congress/119` is offset-based, max 250 per page.
- Don't try to reconcile the TX/FL maps. members tracks current seats (119th map); primary_candidates tracks 2026-election seats (new maps). They're allowed to disagree; the matcher bridges them.
- If the matcher fallback resolves the right number of cases, the lesson generalizes: any future mid-decade redraw works the same way without code changes.
