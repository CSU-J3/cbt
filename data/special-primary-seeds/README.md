# `data/special-primary-seeds/` — the special-primary registry

Loaded by `npm run seed:special-primaries` (`scripts/seed-special-primaries.ts`).
Every `*.json` here is globbed. A row lands in `primaries` with id
`senate-{ST}-2026-special-{party}` and `election_round='primary'` (**not** a new
round vocabulary — `getPrimaryCalendar` and the feed queries filter to
`'primary'`, so a special flows into `PrimaryTimeline` as a new date tick with
zero consumer changes).

## ⚠️ ADDING A SEED ROW IS NOT ADDITIVE — IT MOVES DATA

This is the one thing to know before editing anything in this directory, and it
is not the natural assumption.

Since HO 601 the Ballotpedia scraper routes a votebox by its own `<h5>`, and
**this directory decides where a special-classified box is written**
(`routeSenateContestId`, `lib/primaries-sync.ts`):

```
special-classified box  ->  senate-{ST}-2026-special-{party}   IFF seeded here
                        ->  senate-{ST}-2026-{party}           otherwise
regular box             ->  senate-{ST}-2026-{party}           always
```

So adding a `-special-` seed row for a state **moves that state's matching boxes
off the base ids**. Concretely, if you seed FL tomorrow:

1. FL's `Special Democratic primary` / `Special Republican primary` boxes stop
   routing to `senate-FL-2026-{D,R}` and start routing to the new special ids.
2. The base rows then receive an **empty** incoming roster.
3. The HO 564 non-empty-delete gate correctly refuses to erase them — so they are
   **not** deleted. They **freeze**, silently, at whatever they last held, while
   the special rows go live beside them.
4. Nothing errors. Nothing logs a failure. Two rows now describe the same
   contest, one of them stale and getting staler.

That is the exact failure HO 601 §2 measured for the rejected "route on the
`<h5>` alone" design, re-entered through a **config change instead of a code
change** — which is why it is documented here as well as at the router.

## When a state belongs here

Only when the seat genuinely has **BOTH a regular and a special contest this
cycle**.

- **SC (2026) — yes.** Class-2 seat: a regular June 9 primary *and* an Aug 11
  §7-11-55 special primary after the death of the Republican nominee. Two
  contests, two destinations.
- **FL / OH (2026) — no.** Their 2026 Senate races *are* special elections
  (Rubio's and Vance's remainders), so every primary box on their pages reads
  "Special …" and the **base ids are their correct and only home**. They have no
  file here and must not get one.

The test is not "does the box say Special". It is "does this seat have a second,
additional contest that needs its own row".

## Roster semantics

The `candidates` array is **asymmetric on purpose** (HO 560 amend): a non-empty
array asserts and delete-then-inserts the roster; an **empty or absent array
asserts nothing and leaves any existing roster untouched**. Empty means "no
assertion", never "assert empty", so a routine re-seed cannot destroy a field
that an ingestion pass filled later.

Ship a rosterless seed when the contest is known but the field is not yet
published; `sync:primaries` fills it once the page lands. **Never invent a
roster** — it must be sourced.

## Related

- `routeSenateContestId` + the `!! SEEDING IS NOT ADDITIVE !!` note —
  `lib/primaries-sync.ts`
- The page-type-gate inversion that made the router necessary —
  `parseCandidatesPage`, `lib/primary-candidates-scrape.ts`
- `docs/oddities.md` — "A seed file that looks additive can move data"
