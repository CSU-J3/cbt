# HO 420 — Doc sweep: the Voteview ideology data layer (419) + the Kiley party bug

> Self-claim the next free number: `ls docs/handoffs/ | sort -V | tail`. Body assumes 420 (419 = Voteview ideology, shipped `da2745d`; 418 = metro-zoom roadmap reconcile). If HEAD moved past 419, renumber.
>
> **Docs-only.** No code, no schema, no sync, no `sync-ideology.ts` edit. `git add` only the doc files listed by explicit pathspec, ancestry re-checked immediately before push, one docs commit separate from any code. `SKILL.md` is in scope and trips its self-mod guard: **HALT and re-approve** the SKILL edits, don't route around the guard. No `verify:deploy` — docs don't touch runtime. Show me the diff before committing — no auto-commit.

## Gate — what's already reconciled (do this first, HALT if double-logging)

HO 419's code shipped (`da2745d`) with no doc sweep — it deferred into this one. Before writing, confirm current state so this doesn't duplicate:

- `git log --oneline` since `da2745d` — is there already a docs commit tombstoning 419?
- `grep -n "member_ideology\|voteview\|ideology\|419\|Kiley\|K000401" docs/roadmap.md docs/backlog.md docs/oddities.md SKILL.md` — is any of it already present?
- `git status` — which handoff `.md` files (418, 419, and this one) are untracked and need folding into the docs commit?
- **HO 418 interaction:** 418 (metro-zoom roadmap reconcile) also edits `roadmap.md`. This sweep is HO 419's docs only. Move the Also-pointer tail to 419 from whatever it currently reads (416 if 418 hasn't landed, 418 if it has), and **do NOT do 418's metro-zoom strike** — if that entry is still un-struck on the Banked/unbuilt line, leave it; 418 owns it. Report what the pointer read before.

Reconcile in place, skip anything already done, report present-vs-applied.

## What HO 419 did (grounding — don't re-derive)

Voteview DW-NOMINATE member-ideology data layer, `da2745d`, verified against live data:

- New table `member_ideology` (bioguide PK, `icpsr`, `congress`, `chamber`, `nominate_dim1/2`, `nokken_poole_dim1/2`, `number_of_votes`, `conditional`, `updated_at`), populated from Voteview's `HS119_members.csv`. No secondary index (~535 rows, PK covers the join).
- **Joins `members` on `bioguide_id` directly** — Voteview carries bioguide natively, so the HO 402 crosswalk's ICPSR bridge is not on this path. The "~60% via ICPSR" coverage premise was measuring the wrong join and is retired.
- New files: `scripts/voteview-source.ts` (shared fetch + a vendored quote-aware CSV parser; `sync-palestine.ts` left untouched), `scripts/sync-ideology.ts` (`sync:ideology` — members-gated so it can't invent a member, max-`number_of_votes` dedup for a bioguide's multiple 119th rows, idempotent `ON CONFLICT` upsert), `scripts/diagnostic/ideology-coverage-419.ts` (read-only). `package.json` wired `sync:ideology` after `sync:crosswalk`.
- **Live coverage:** 552 members carry a score (>100% of the 537 `is_current` count — see the oddity below), 1 `nominate_dim1` NULL (too few votes yet), 0 `conditional`, Trump's empty-bioguide `chamber='President'` row gated out, one chamber-switcher deduped.
- **No cron** (manual, matching `sync:crosswalk`). **No surface yet** — this is plumbing.
- **Surfaced a data bug:** `members.party` reads `I` for K000401 Kevin Kiley (a California Republican); Voteview's `party_code=200` (R) is correct, `members` is wrong. Logged below, not fixed here.

## `roadmap.md` STATUS block (read it live, edit in place — don't trust a remembered %)

- **Add an Also (HO 419) note. No theme-% change, no bar move.** This is enabling data with no user-facing surface, and Member depth is already 99 (can't bump to 100 — that's reserved for the deferred member-scorecard arc). Read the Member depth value live (expect 99); if it isn't 99, surface it rather than overwriting. The note records: the Voteview DW-NOMINATE data layer landed (`member_ideology`, `sync:ideology`), bridging `bioguide_id` → DW-NOMINATE (`nominate_dim1` economic left/right + the Nokken-Poole per-congress variant); joins members on native bioguide, not the crosswalk's ICPSR bridge; coverage essentially complete for current members who've voted; surfaces (member-hub ideology line, ideology axis on the sponsor scatter) deferred to a follow-on. Follow the append-a-superseding-note convention.
- **Move the Also-pointer tail to 419** from whatever it reads (see the gate's 418 note). Single current pointer — don't leave two tails.
- Foundation / Home / Viz / Weekly reports / News / Races / Hearings don't move.

## `backlog.md`

- **DONE tombstone for 419** (`da2745d` — Voteview ideology data layer, the file set, join-direct-on-native-bioguide, coverage 552 matched / 1 NULL / 0 conditional, no cron, no surface).
- **New OPEN LOOP — `members.party` wrong for Kiley (surfaced HO 419).** Owner: Code/Corey. `members.party='I'` for K000401 Kevin Kiley is wrong (he's a CA Republican); Voteview `party_code=200` corroborates R. A `sync:members` party quirk, not a Voteview one. The ideology sync surfaced exactly 1 disagreement across 552 current members, so Kiley is the only current instance — but the *close* is a general members-party correction (re-derive party from the `sync:members` source, or an override), not a one-row patch, since roster churn can surface siblings. Instrument: the `ideology-coverage-419` diagnostic's `party_code`-vs-`members.party` disagreement line (re-run flags any new ones). Close: the members-party fix corrects Kiley and the diagnostic reads 0 disagreements.
- **QUEUED — first ideology surface (next build).** The `member_ideology` payoff has no surface yet. Candidates: a member-hub ideology line (`nominate_dim1` placement + a provisional/low-vote flag off `conditional`/`number_of_votes`), an ideology axis on the existing `SponsorProductivityScatter`, or chamber/party ideology medians on the dashboard. This is where the data starts answering the framing question instead of sitting in a table. (Corey is picking the specific surface next.)

## `oddities.md` (field notes — the traps a future author re-trips)

- **Voteview member CSVs shift every column right of `bioname` on a naive split.** `bioname` is a quoted field with an embedded comma (`"ROGERS, Mike Dennis"`) positioned *before* `bioguide_id` and the `nominate_*` fields, so `line.split(',')` reads first-name fragments into `bioguide_id` and slides `number_of_votes` into `conditional` — silent score corruption, no error. Quote-aware parsing + header-keyed column indexing is mandatory (`scripts/voteview-source.ts` does this). Demonstrated live: a verification `awk` split produced fake "duplicate bioguides" (first-name fragments) and 400-plus `conditional` values (shifted vote counts).
- **Voteview carries `bioguide_id` natively — join `member_ideology` to `members` on bioguide directly.** The HO 402 crosswalk's ICPSR bridge is not the path for ideology; that was the pre-verification assumption and it's retired. `icpsr` is still stored in the table for a future join to Voteview's `votes`/`rollcalls` files (roll-call positions), not for the members join.
- **`sync-ideology` gates on the full `members` table, not `is_current=1` — the asymmetry with `sync-fec` is deliberate.** The gate is `bioguide_id IN (SELECT bioguide_id FROM members)`, so a member who served in the 119th, voted, then departed (still in `members` with `is_current=0`) keeps their DW-NOMINATE row — historical scores are valid and useful. That's why matched (552) exceeds `is_current` (537) and why the coverage diagnostic reads over 100% against the `is_current` denominator. `sync-fec` does the opposite (filters `is_current=1`, departed members drop out) because campaign-finance rows are current-cycle-scoped. Don't "reconcile" the ideology gate to `is_current` — the two syncs answer different questions.

## `SKILL.md` (self-mod guard — HALT and re-approve before editing)

Additions, only after approval, kept to structural conventions:

- Schema: `member_ideology` in the `member_*` family (bioguide PK, `icpsr`, `congress`, `chamber`, the two `nominate_*` + two `nokken_poole_*` pairs, `number_of_votes`, `conditional`, `updated_at`; no secondary index).
- Sync chain: `sync:ideology` runs after `sync:members` → `sync:crosswalk`, manual (not cron), members-gated.
- Voteview source note: member files carry `bioguide_id` natively (join direct); parse quote-aware (the `bioname` comma trap).

Don't narrate the fix history — that's the handoff's job.

## Commit discipline

One docs-only commit: `git add docs/roadmap.md docs/backlog.md docs/oddities.md` + the SKILL path only after approval + any untracked handoff `.md` files from the gate (`git status`). Ancestry re-checked immediately before push against `da2745d` (or current HEAD if a concurrent session moved it). Reconcile in place, not append-a-duplicate. No `verify:deploy`. Show me the diff before committing — no auto-commit.

## Report back

Which gate items were already present vs applied, the Member depth value found (confirm 99), what the Also-pointer read before the move, the diff, and confirmation SKILL was either untouched or edited under approval.
