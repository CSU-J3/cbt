# HO 416 — Stale FEC `candidate_id` sweep (the `totals_failed` thread)

> Self-claim the next free number: `ls docs/handoffs/ | sort -V | tail`. Body assumes 416. If HEAD has moved past 415, renumber.
>
> Spec-driven: propose the plan (the resolver change + the override-file shape), **wait for review, show diffs, no auto-commit.** Code and docs are separate commits, explicit pathspec, ancestry re-checked immediately before push. This is a follow-on to HO 415 (`c36f0a2`, by_size cycle fix) — that arc is closed; this is the separate totals thread it surfaced.

## What this is

The by_size backfill (HO 415) left a stable set of **13 members whose `totals@2026` returns count=0** — a `fec_candidate_id` resolution problem, not the cycle-key bug that arc fixed. 12 of the 13 have no fundraising row at all. The set is stable across every sync pass (not 429 churn), and it's what leaves those members with no fundraising surface on the member hub.

Every member is pre-classified (read-only FEC candidate search + DB `is_current`, done before this handoff). The roster below is the execution list — the classification work is done, don't re-derive it.

## Guardrail (the thing that makes this not a one-liner)

**Not a blanket "clear all cached ids and re-resolve."** That would re-acquire fundraising rows for departed members and re-find dormant ids for race-switchers (see the mechanism trap below). Act per bucket. Two of the 13 get explicit no-action.

## The mechanism trap (why the switchers need an override, not a re-run)

`resolveFecCandidateId` derives office from `members.chamber`. The 8 race-switchers are sitting House members (`chamber='house'`) running for Senate in 2026. Their active money is under a **live Senate committee**, but the resolver keys office off `'house'`, so it re-finds their **dormant House id** on every run — forever. Re-running resolution doesn't fix them; the sweep has to resolve them against the office they're **running for**, not their seated chamber. All 8 target ids are captured below, so this is a static override, not a live re-derivation.

## Roster (pre-classified — the execution list)

### Bucket 1 — Departed (2): filter drops them, do NOT re-resolve

| Member | State | `is_current` | note |
|---|---|---|---|
| Grijalva | AZ | 0 | deceased Mar 2025 |
| Greene | GA | 0 | left House |

Both already read `is_current=0`, so `sync:members` is flipping departed members correctly — **no upstream staleness bug** (this was the HO 402-family concern; it's settled). Fix: add `AND m.is_current = 1` to `fetchPendingMembers` in `sync-fec.ts`. Both drop out of the FEC sync entirely, no per-member work. Verify after: neither re-acquires a fundraising row.

### Bucket 2 — Race-switchers, House→Senate 2026 (8): re-resolve to the captured Senate id

| Member | State | cached (dormant House) | live Senate 2026 id | seat |
|---|---|---|---|---|
| Barr | KY | H0KY06104 | S6KY00286 | open |
| Carter | GA | H4GA01039 | S6GA00374 | challenger |
| Collins | GA | H4GA10071 | S6GA00390 | challenger |
| Hunt | TX | H0TX07170 | S6TX00511 | challenger |
| Pappas | NH | H8NH01210 | S6NH00141 | open |
| Hageman | WY | H2WY00166 | S6WY00209 | open |
| Moore | AL | H8AL02171 | S6AL00476 | open |
| Moulton | MA | H4MA06090 | S6MA00296 | challenger |

Moore is disambiguated to **M001212 (Felix Barry Moore)** — a genuine switcher, not the redistricting red herring. Confirm the bioguide before applying.

Because these members are `chamber='house'` → `next_election_year=2026`, once re-resolved to the Senate id both totals and by_size query 2026, which is correct for their Senate race. **No interaction with the shipped fork-3 cycle logic.**

**Design call (override this at the diff if you disagree):** the 8-entry map lives in a `data/` override file the resolver consults **before** the chamber-derived lookup, mirroring how HO 411's specials file works — one source of truth for "a member's effective FEC identity," not a second inline lookup in the resolver. The switcher fact (a sitting rep's active FEC committee is their Senate one) is the parallel of the specials fact (a Class-3 senator's cycle is 2026 not 2030); keeping both as `data/` overrides consulted by the same path is what stops the two-sources drift the last arc spent effort killing. The inline-map alternative is fewer files but reintroduces that split.

- Keyed by bioguide → target `fec_candidate_id`. Explicit and auditable at 8 entries.
- Resolver: if bioguide is in the override, use that id and skip chamber-derived search; else fall through to the existing path unchanged.
- Idempotent: applying the override updates the cached id; a re-run then hits `skipped_fresh`.

**Product flag (needs your call, not automatic):** these are sitting Representatives. Surfacing their Senate-campaign money on the member hub is defensible (it's their active committee), but it's a display decision. Options: show it labeled as Senate-campaign fundraising, or gate it until they're no longer dual-office. Don't assume — call it.

### Bucket 3 — Stale-id senator (1): plain re-resolve

| Member | State | cached (dormant) | live id |
|---|---|---|---|
| Marshall | KS | H6KS01179 (House-era) | S0KS00315 (office=S, incumbent) |

`chamber='senate'` already and Class 2 (up 2026), so clearing the stale cached id and re-running the standard path resolves correctly. **No override needed** — this is the case the normal resolver handles once the stale id is cleared. Don't add him to the override map; that would mask the fact the standard path works for correctly-chambered members.

### Residual — explicit no-action (2): id is correct, no fix recovers them

- **Zinke** (MT, H4MT01041): his only 2026 candidacy is this House id (incumbent). Cached id is right; `totals@2026=0` is genuinely-unfiled / $0 / filing lag. Re-check in a later sync, don't re-resolve.
- **Barrasso** (WY, S6WY00068): cached id is his live incumbent Senate committee, **not stale**. FEC returns count=0 at **both** 2026 and 2030 (probed) — so it's **not cycle-keyed**, it's an upstream FEC data gap (the $1.3M row ingested May 19 is a stale snapshot; his totals were present then, absent now). No code change recovers this; he clears only when FEC serves his totals again. **Do not extend the cycle logic to the totals path** — the probe confirmed totals resolve at the reporting cycle for off-cycle senators (Alsobrooks, same class, has `totals@2026`), so that would be a fix for a bug that isn't there.

**Structural note (from the residual, worth a line in oddities):** the sync gates `by_size` behind a fresh/successful totals call. So a member with an upstream totals gap (Barrasso) can't get by_size populated even if his by_size is independently available, because totals fails first and short-circuits. Not a data fix for this handoff — a note that "no totals ⇒ no by_size" is structural, in case a future session wonders why a member with a valid id stays empty.

## Exit criteria

- `totals_failed` → 0, or only the two named no-action residuals (Zinke, Barrasso).
- The 8 switchers + Marshall populate totals (and by_size, at cycle 2026 for switchers / their correct cycle for Marshall) on the next run.
- `by_size` 530 → up to ~539 (the 8 switchers + Marshall, whichever have a Schedule A breakdown at the resolved id). **Barrasso does not clear here** — 530→531 does not fall out of this sweep; he's the upstream gap.
- No departed member (Grijalva, Greene) re-acquires a fundraising row.
- The `totals empty @2026` named logging shipped in HO 415 is the before/after diagnostic for this sweep.

## Run plan

The switcher override + `is_current` filter are code (diff first). After approval and commit, one `sync:fec` run under the existing hardening (cap-55/1100ms/`skipped_fresh` cursor from HO 415 — still live in `sync-fec.ts`). 9 members to resolve (8 switchers + Marshall) is a sub-55 single window; probe `x-ratelimit-remaining` first per the HO 415 gate, since the key is still the 60/hr `K0Ue` tier.

## Discipline

- Code (resolver + override file + `is_current` filter) is one commit; any docs are separate.
- `sync:fec` run HALTs before executing (external, rate-limited, write) — probe remaining first.
- Explicit pathspec, ancestry re-check before push, `verify:deploy` after the code lands.
- SKILL only if the override-file pattern is worth banking as a convention (it plausibly is — it's the second `data/`-override consulted by the resolver). HALT for self-mod approval, don't route around the guard.

## Note on the 99 bump (not this handoff)

This sweep is **not** on the critical path for Member depth 98→99. HO 415 put the by_size data floor at 0 (530 populated, no genuine floor), so the depth bump clears independently in the doc sweep. This closes the separate `totals_failed` thread; its contribution to the count (up to ~539) is a bonus, not a blocker.
