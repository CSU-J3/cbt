# HO 413 — doc sweep for the senator-year integrity arc (408 · 410 · 411 · 412)

> Self-claim the next free number: `ls docs/handoffs/ | sort -V | tail`. If HEAD has moved past 412, renumber.
>
> **Docs-only.** No code, no schema, no re-seed, no prod writes. One commit, explicit pathspec, ancestry re-checked before push. If `SKILL.md` is edited it trips its self-mod guard — stop and re-approve rather than routing around it. Reconcile in place, don't append. Show the diffs before committing.

The arc is shipped and verified: 408 (`d234531`) fixed the S-OK card, 410 audited, 411 (`db9d910`) fixed the root, 412 (`a3a2a18`) cleaned the race table. This reconciles the four living docs to that end state and clears one misfile.

## 0. Relocate the misfiled handoff (do first)

`lib/412-race-table-cleanup.md` is the real HO 412, saved to the wrong path. Move it to `docs/handoffs/412-race-table-cleanup.md` (`git mv` if it's tracked, plain move + add if not). Confirm nothing else references the `lib/` path.

## 1. `backlog.md` — close the integrity loop

Close the odd-year-Senate / `is_current` OPEN LOOP that HO 404 opened. Record what it actually was, so the history reads true:

- It was **systemic, not churn**: 18 of 100 current senators carried a `next_election_year` disagreeing with their Senate class (HO 410), from a wrong-anchor derivation in `sync:members` (`senateTermStart`/start-year+6), not appointee turnover.
- Fixed by **class-derivation** (411): `members.senate_class` ingested from `legislators-current.yaml`, year-pair derived from class via `lib/derive-term.ts`, with a cycle-scoped special-election list for OH/FL.
- **Race-table reconciled** (412): CO card corrected (Bennet→Hickenlooper), CA/NY phantoms deleted, the `fix:senate-term-years` footgun removed.
- Move the S-OK P1, the CO card, and the two phantoms to DONE with commit SHAs. Drop the `fix:senate-term-years` nit — handled in 412.

## 2. `oddities.md` — the durable field notes

Three notes worth banking, because they're the non-obvious parts a future session would trip on:

- **Senator years derive from `senate_class`, not term math.** `members` now carries `senate_class` (from the last `terms[]` entry in `legislators-current.yaml`; NULL for House). The pair comes from `lib/derive-term.ts` residue math (class 1≡2, 2≡4, 3≡0 mod 6, computed from `now` so it doesn't rot at the November boundary). The old `senateTermStart`/`senateNextElection` helpers survive **only** as the fallback for departed senators absent from the YAML — don't delete them thinking they're dead. Special elections (`data/senate-special-elections.json`, cycle-scoped, self-expiring) legitimately break `ney = ctey − 1` and are checked ahead of the class default; the standing guard exempts them.
- **`backfill:races` self-heals incumbents.** It's `ON CONFLICT(id) DO UPDATE SET incumbent_bioguide_id = excluded` scoped to that one column (never touches rating/margin/`incumbent_running`/roster), filters `AND m.is_current = 1`, and `seed:races` runs **after** it so curated overrides (the S-OK Armstrong pin) win last. The 412 run corrected **16 future-cycle cards beyond CO** (S-TX-2030, S-OK-2028, and others) — so the forward surface (2028/2030 rows) now self-corrects on every backfill, not just the 2026 cycle. That's the property that keeps this bug class from recurring.
- **The standing guard.** `scripts/diagnostic/senator-year-audit-410.ts` is the permanent regression probe. An internal-only `ney = ctey − 1` / even check catches 1 of 18 — the class cross-check catches all of them, which is why the guard reads `senate_class` and sources specials from the JSON rather than any hardcoded map.

## 3. `SKILL.md` — conventions (self-mod guard: re-approve)

The lines that belong in the conventions doc, in the members/races section:

- `members.senate_class` exists; senator `next_election_year` / `current_term_end_year` derive from it via `lib/derive-term.ts`, special-list-first then class default, with a departed-senator fallback. Congress.gov carries no class — `sync:members` pulls it from `legislators-current.yaml` in the same run.
- `backfill:races` upserts `incumbent_bioguide_id` on conflict (scoped, `is_current`-filtered); `seed:races` runs last for curated overrides.
- `scripts/diagnostic/senator-year-audit-410.ts` is the standing year-integrity guard.

If that's the only SKILL change, still stop on the self-mod guard before committing.

## 4. Correct the HO 404 Mullin mis-flag

Wherever a doc carried HO 404's claim that Mullin `M001190` `is_current=0` was a bug: it's **correct**. Mullin resigned, is absent from `legislators-current.yaml`, and Armstrong holds the seat. HO 410 §4 proved `is_current` clean (0/0). Fix the note so it doesn't seed a future false-positive.

## Commit

```
git add docs/handoffs/412-race-table-cleanup.md docs/backlog.md docs/oddities.md <SKILL.md path>   # only what changed
```

Drop SKILL.md from the add if it wasn't touched. Explicit pathspec, ancestry re-checked immediately before push, docs-only, separate from any code commit. Message along the lines of: `docs: close senator-year integrity arc (408/410/411/412), relocate HO 412, fix 404 Mullin flag`. Show the diffs first.
