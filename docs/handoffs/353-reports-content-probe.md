# HO 353 — Reports: weekly content probe (read-only diagnostic)

> Claim the next free HO number; if 353 is taken in `docs/handoffs/`, use the next
> available and rename this file. Independent of the stage ladder (HO 352).

**This is a diagnostic, not a build.** Implement nothing, design nothing. The
weekly report only knows bills (intros, stage moves, stalls, news mentions,
committee meetings, topics). The app tracks domains the report is blind to. Before
any new section gets designed, establish what's queryable per week-range and at
what coverage. Run read-only SELECTs, fill the tables, halt. No schema change, no
section, no UI, no commit.

Two sources, in priority order.

## A. Floor votes (priority)

The report says bills changed stage but never what got voted on or how the chamber
split. Roll calls are the most newsworthy floor action of a week, and many votes
aren't stage changes (procedural, failed, amendment, nomination votes). House +
Senate votes were built in HO 77 / 79 / 80 — grep the live schema for the actual
table names rather than trusting the handoff copy; mind the `bills` /
`bills_rawjson` split from HO 241.

Establish:

1. Table(s) / source for House and Senate votes for the **119th**. Where they
   live, and what shape.
2. Queryable by date range (`week_start..week_end`)? On what date field.
3. Coverage for the **last 3 completed weeks**: roll-call count per week, per
   chamber.
4. Fields present per vote: question/description, result (pass/fail), yea/nay
   totals, party split if available, date.
5. Bill linkage: can a vote join to a bill (to show which bill it's on)? How are
   non-bill votes (procedural, nominations) typed or separable.
6. Freshness: synced through what date. Current, or stale.

## B. Stock trades (secondary)

High public interest, the pipeline exists (HO 70), and a "disclosed this week"
list is self-contained — it needs no generated prose. Grep the live schema for the
trades table.

Establish:

1. Is the trades table populated and current? Where, what shape.
2. Queryable by **disclosure date** in a week-range.
3. Coverage for the **last 3 completed weeks**: disclosure count per week.
4. Fields present: member, ticker, transaction type (buy/sell), amount range,
   transaction date vs disclosure date.
5. Member linkage: join to members / bioguide.
6. Freshness: synced through what date.

## Deferred — don't probe

Electoral movement (rating changes, weekly odds shifts; HO 220 logs rating
history). Lower fit: it's another surface's story, and a weekly *legislative*
report may not be where race odds belong. Skip this pass.

## Method

- Query the **live Turso instance** the app uses (via `lib/db.ts`, or
  `turso db shell` against production). Cross-check you're on the right instance
  before trusting counts.
- Count aggregates over the corpus are fast and well inside any timeout; a one-off
  TS script importing the db client is fine.
- **No writes, no schema change, no commit, no doc edits.**

## Return format

A small table per source — `queryable Y/N · last-3-weeks coverage · fields
present · freshness date` — then a one-line read each: design a section / defer
(data gap) / defer (fit). Findings return here for the design chat; sections get
designed there, not in this pass.
