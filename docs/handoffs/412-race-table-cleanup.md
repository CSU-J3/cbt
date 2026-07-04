# HO 412 — race-table cleanup: correct CO, delete CA/NY phantoms, neutralize the term-years footgun

> Self-claim the next free number: `ls docs/handoffs/ | sort -V | tail`. If HEAD has moved past 411, renumber.
>
> **Gated on HO 411** (`db9d910`, verified live). Do not start until the members table is confirmed fixed — it is. This is the destructive/surgical cleanup 411 deliberately left: three stale artifacts that `INSERT OR IGNORE` can't touch, plus a live regression footgun. Every deletion is **print-before-delete**: show the exact rows (and any dependents) and HALT for approval before removing anything. No commit or push until the diff is approved.

## Why these are left

411 fixed the root (member year-pairs derive from class) and created the 6 missing races via pure `INSERT`. But `backfill:races` is `INSERT OR IGNORE` — it creates, never corrects or deletes. So three artifacts survive untouched, and one script can undo the whole arc:

1. `S-CO-2026` still shows **Bennet** (B001267, class 3). After 411, only Hickenlooper (H000273, class 2) sits at `ney=2026` in CO, but the existing row won't self-update.
2. `S-CA-2026` (Padilla, class 3, up 2028) and `S-NY-2026` (Gillibrand, class 1, up 2030) are **phantoms** — neither state is up in 2026; the cards exist only because those rows once wrongly said `ney=2026`. Backfill won't recreate them now, but the stale rows persist.
3. `scripts/fix-senate-term-years.ts` (npm `fix:senate-term-years`) is a **live footgun**: it re-derives every senator through the old `senateTermStart`/`senateNextElection` drift path 411 replaced, and deletes stale senate races on the way. One run re-introduces the exact 18-row drift and the phantom/missing churn this arc just fixed. Not cron-wired, but one command from a full regression.

## 1. Correct the CO card (self-healing, preferred)

Change `backfill:races` from `INSERT OR IGNORE` to an upsert that re-derives the incumbent on existing rows, **scoped to that one column** so it never clobbers the curated fields `INSERT OR IGNORE` currently protects:

```sql
INSERT INTO races (...) VALUES (...)
ON CONFLICT(id) DO UPDATE SET incumbent_bioguide_id = excluded.incumbent_bioguide_id
```

Nothing else in the `DO UPDATE` — leave `rating`, `rating_source`, `margin_2024`, `incumbent_running`, roster untouched. `seed:races` still runs **after** backfill, so genuine curated overrides (the HO 408 S-OK Armstrong pin) reapply last and win. Confirm that ordering in `package.json` / the cron before relying on it.

Then re-run `backfill:races`. Because 411 made every state unambiguous and added `AND m.is_current = 1`, CO now derives Hickenlooper uniquely, and the upsert rewrites the stale Bennet row in place. Verify: `S-CO-2026.incumbent_bioguide_id` → `H000273`; snapshot all race rows before/after and confirm **only** S-CO's incumbent changed (no curated column moved on any row, S-OK still Armstrong via the seed reapply).

Why upsert over a one-off `UPDATE`: it self-heals any future incumbent drift instead of patching this instance, and it's the durable complement to 411's root fix. If the diff shows the upsert can't be scoped cleanly to the single column for some reason the grep surfaces, fall back to a targeted `UPDATE races SET incumbent_bioguide_id='H000273' WHERE id='S-CO-2026'` and say so — but the upsert is the intended fix.

## 2. Delete the two phantoms (print-before-delete)

`S-CA-2026`, `S-NY-2026`. Before deleting, print the full blast radius and HALT:

- The `races` rows themselves (confirm incumbent = Padilla / Gillibrand, confirm neither state has a 2026 seat post-411).
- `race_ratings` rows keyed to those race_ids (a phantom may have a seeded rating).
- `race_candidates` / any roster keyed to those race_ids.
- A grep for hardcoded references to `S-CA-2026` / `S-NY-2026` anywhere (seed files, links, `races-seed.json`).

Show all of it, then on approval delete the race rows **and** their dependents (ratings, roster) so nothing orphans. After 411 backfill won't recreate them (Padilla→2028, Gillibrand→2030). Re-run the 410 audit: §3 phantoms should drop to **0** (it currently reports AMBIGUOUS=2 for exactly these; that clears once the rows are gone).

## 3. Neutralize the term-years footgun

`scripts/fix-senate-term-years.ts` must not be runnable as-is. Pick per what the grep shows, show the diff, HALT before deleting anything:

- If it's a genuine dead one-shot (its original fix-up job is fully superseded by 411's derivation): **delete the script and its `fix:senate-term-years` npm entry** (print both first).
- If there's any reason to keep it: **hard-disable it** — replace the body with an immediate exit that prints "superseded by HO 411 — senator years derive from senate_class; running this re-introduces drift. See lib/derive-term.ts." Keep it inert, not silently lethal.

Either way the `senateTermStart`/`senateNextElection`/`senateTermEnd` helpers in `lib/derive-term.ts` stay (they're still the source for the departed-senator fallback in `sync-members.ts`) — this is about the script that misuses them, not the math.

## Verify live

- `verify:deploy` — served SHA === pushed HEAD before claiming shipped.
- Cold-hit prod: `/races` and `/race/S-CO-2026` show **Hickenlooper (D)**, no Bennet. `S-CA-2026` / `S-NY-2026` return nothing (no phantom cards on the LIST or as hubs). S-OK still Armstrong + OPEN. A normal incumbent race and a known retirement (S-KY McConnell) both unchanged.
- Final 410 audit fully green: §1=0, §2=0, §3 wrong=0 / phantoms=0 / missing=0, §4 clean, AMBIGUOUS=0.

## Discipline

- Explicit pathspec on add + commit. Ancestry re-checked immediately before push. Nothing pushed until the diff is approved.
- Print-before-delete on all of §2 and §3. If a dependent row or a hardcoded reference turns up that isn't covered above, stop and report rather than deleting through it.

## Doc sweep (next turn, after 412 lands — one docs-only commit for 408+410+411+412)

- `backlog.md`: close the integrity OPEN LOOP — systemic (18 rows), fixed by class-derivation (411) + race-table reconciliation (412), not the churn HO 404 implied. Record the CO card and the two phantoms as resolved. Drop the `fix:senate-term-years` nit (handled here).
- `oddities.md`: `members` now carries `senate_class`; year-pairs derive from class + a cycle-scoped special-election list (`data/senate-special-elections.json`), specials legitimately break `ney = ctey − 1`. `backfill:races` filters `is_current = 1` and upserts incumbent on conflict (scoped to the one column); `seed:races` runs last for curated overrides. The old `senateTermStart` term math survives only as the departed-senator fallback.
- `SKILL.md`: the derivation + the standing guard (`scripts/diagnostic/senator-year-audit-410.ts`) + the backfill upsert/ordering contract. Trips the self-mod guard — re-approve, don't route around.
- Correct the HO 404 Mullin mis-flag (`is_current=0` is correct — resigned, absent from `legislators-current.yaml`) in whichever doc carried it.
