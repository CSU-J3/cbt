# 106 — Special-election page parser fix (FL + OH Senate)

## What this is

`parseCandidatesPage` in `lib/primary-candidates-scrape.ts` drops every votebox whose `<h5>` header contains "special". That filter was added to handle RI-01's regular page, which embeds a special-primary votebox inside a regular page (so dropping anything `"Special …"` correctly keeps just the regular-primary box).

But for dedicated special-election pages (FL and OH Senate 2026, both routed to `senateSpecialPageUrl`), every votebox starts with `"Special …"` — so the filter discards the legitimate Dem and Republican primary voteboxes alongside the general-election box. Result: both states return `no_candidates`, FL/OH primary rosters silently never populate.

Diagnosis comes from an isolated FL scrape: the page returns 3 voteboxes (general + D primary + R primary), all currently dropped. The status string the cron emits — `FL — no_candidates` — is technically accurate but masks the real cause.

## The fix

Make the filter page-aware: invert it when the scraped page is a dedicated special-election page.

In `lib/primary-candidates-scrape.ts:281`, the existing filter is roughly:

```ts
if (/special/i.test(headerText)) continue;
```

Change to page-aware inversion. Two equivalent options — pick whichever fits the surrounding code:

**Option A** — pass `onSpecialPage` as a `parseCandidatesPage` parameter, threaded from the caller:

```ts
if (/special/i.test(headerText) !== onSpecialPage) continue;
```

On a regular page (`onSpecialPage=false`): drops boxes whose header contains "special". Same as today.
On a special page (`onSpecialPage=true`): drops boxes whose header does NOT contain "special" — i.e., drops the general-election box and keeps the special-primary boxes.

**Option B** — detect from the page itself if a reliable signal exists (URL pattern, `isSpecialElectionPage` helper, or a unique DOM marker on the page). Same logical effect, no caller plumbing.

Prefer A if the caller already knows whether it's calling for a special page (senateSpecialPageUrl branch is explicit). B only if A creates ugly threading through the House scraper which shares this function.

## Pre-flight checks (do these BEFORE making the change)

The filter was deliberate. Don't invert it without confirming the counter-example still holds and the blast radius is what we think it is.

1. **Confirm RI-01 still drops its embedded special-primary box.**

   RI-01 is the documented counter-example: regular page embeds a special-primary votebox alongside the regular-primary box. After the fix, scrape RI-01 (regular page, `onSpecialPage=false`) and confirm:
   - The regular-primary D votebox is kept (this is the one we want)
   - The embedded special-primary votebox is still dropped (the original filter behavior we're preserving)

   If both boxes end up kept, the inversion logic is wrong and needs a different signal than `onSpecialPage`.

2. **Confirm the House scraper never feeds `parseCandidatesPage` a special page.**

   Grep `parseCandidatesPage` callers. If House routes only ever pass regular district pages, the threading in Option A only matters on the Senate path and House calls can default `onSpecialPage=false` (which preserves current behavior). If House does have a special-page branch, that needs explicit handling too.

3. **Confirm `parseVotebox` handles the special-page votebox body shape.**

   The header is "Special D/R primary", but the body — candidate list rows, percentage column, advancement markers — needs spot-checking against a regular-primary body. If special-page voteboxes use a different DOM shape, parseVotebox needs a tweak too, not just the gate.

4. **Confirm FL and OH are the only 2026 special-page Senate races.**

   `SENATE_STATES_2026` plus the special-page routing — if there's a third (or a House special) hitting `senateSpecialPageUrl`, it's also broken right now and worth fixing in the same pass.

## In scope

- `parseCandidatesPage` filter fix per Option A or B
- Threading `onSpecialPage` from `syncSenateCandidates` (or wherever the special-page branch dispatches) if Option A
- Re-scrape FL and OH after the fix to populate `primary_candidates` for both states, all primary cycles
- Correct the misleading comment in `primaries-sync.ts` that claims special-page resolution is automatic — clarify that the URL resolves but parser handling is page-type-aware
- SKILL.md note on the special-page convention (one-line addendum in the primaries section)
- Verification queries to confirm new rows exist and match expected candidates

## Out of scope

- Broader refactor of `parseCandidatesPage` (it's still doing a lot of work; keep the diff minimal)
- New special-election URL discovery beyond FL/OH (if pre-flight check 4 surfaces a third one, fold it in; otherwise file separate)
- House-side parallel fix unless pre-flight check 2 reveals an actual House special-page bug
- Backfilling historical FL/OH primary candidates from prior cycles
- Anything that touches `cron_runs` (HO 105 territory)

## Verification queries

After re-scraping FL and OH:

```powershell
turso db shell cbt "SELECT state, party, candidate_name FROM primary_candidates WHERE state IN ('FL', 'OH') AND chamber = 'senate' ORDER BY state, party, candidate_name"
```

Expect 2026 D and R primary candidates for both states. Spot-check 2–3 names against the Ballotpedia pages to confirm the parser is reading the right boxes.

Then:

```powershell
turso db shell cbt "SELECT COUNT(*) FROM primary_candidates WHERE state = 'RI'"
```

Compare to pre-fix count — should be unchanged (RI-01 counter-example didn't regress).

## Acceptance

1. Pre-flight checks 1–4 documented in the commit message or PR description with what was found for each.
2. FL and OH `primary_candidates` rows populated, spot-checked against Ballotpedia.
3. RI primary_candidates row count unchanged from pre-fix.
4. Misleading `primaries-sync.ts` comment corrected.
5. SKILL.md addendum on special-page convention.
6. House scraper smoke-checked (one region re-trigger or one diagnostic call confirming no regression).
7. Commit: `fix: special-election page parser drops legitimate primaries for FL/OH (HO 106)`.

## Notes

- The mojibake from this morning's PowerShell display is not a bug. `â` is UTF-8 `U+2014` (em-dash) misdecoded as CP1252 by Invoke-WebRequest. Stored payload is clean. No fix needed in code; if you want clean console output for future manual triggers, run `[Console]::OutputEncoding = [System.Text.Encoding]::UTF8` once per PowerShell session.
- `cron_runs` (HO 105) doesn't help diagnose this further until the cursor wraps back to Senate range (~3 weeks at SLICE=20). The isolated diagnostic path is the right tool for verification, same as Code used to find the bug.
