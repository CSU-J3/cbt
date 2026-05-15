# 50 — Ceremonial classifier

## What this is

Page 1 of the feed is ~14% ceremonial right now (Mother's Day resolutions, post-office renamings, awareness-week designations). Those bills pollute every aggregate — sponsor counts, topic mix, future stage funnel — and answer none of the framing question. This handoff adds an `is_ceremonial` boolean to `bills`, classifies the corpus once via a cheap title-only Gemini pass, folds the same field into the inline summarize prompt for new bills, and hides ceremonial bills by default across every list view with a single toggle to bring them back.

Roadmap theme 1, step 1. Cheapest, most visible move on the board.

## Schema

Add to `bills`:

```sql
ALTER TABLE bills ADD COLUMN is_ceremonial INTEGER;
CREATE INDEX idx_bills_is_ceremonial ON bills(is_ceremonial);
```

Tri-state by design:

- `NULL` — not yet classified. Treated as substantive (visible) by default.
- `0` — classified substantive. Visible.
- `1` — classified ceremonial. Hidden by default.

The null-as-visible choice matters during backfill: the dashboard shouldn't go dark while classifications stream in. Once backfill completes, nulls only exist for brand-new bills awaiting their next summarize tick.

Add the migration to `scripts/migrate.ts` (or the existing migrations dir — follow whatever pattern `npm run migrate` already uses). Run on production Turso once code lands.

Also update `SKILL.md` schema block to include the new column and index.

## Classifier prompt

Cheaper than the existing summarize prompt. Title + `latest_action_text` only, no bill text fetch, JSON-only output. Lives in a new file `lib/classify-ceremonial.ts`.

```
You are classifying US Congress bills as ceremonial or substantive.

CEREMONIAL: primary purpose is symbolic. Examples:
- Awareness days/weeks/months ("designating X as National Y Day")
- Renaming federal buildings, post offices, highways, military installations
- Recognizing achievements, anniversaries, or individuals
- Congratulatory or memorial resolutions
- Expressing the sense of Congress with no legal effect

SUBSTANTIVE: changes law, appropriates funds, creates or modifies programs,
alters rights, sets policy, or directs an agency — even narrowly scoped.

Bill: {title}
Latest action: {latest_action_text}

Respond with JSON only: {"is_ceremonial": true|false}
```

Parse and write the boolean. If JSON parsing fails, log the bill ID and leave `is_ceremonial` NULL — don't crash, don't guess. Same defensive posture as the summarize parser.

## Backfill script

`scripts/classify-ceremonial.ts`. Standalone, runs once via `npm run classify-ceremonial`:

1. `SELECT id, title, latest_action_text FROM bills WHERE is_ceremonial IS NULL` — covers everything on first run, supports re-runs without reclassifying.
2. Concurrency 10. Skip the Batch API; not worth the wiring for a one-time pass that costs well under $1.
3. Update each row with the boolean.
4. After completion, hit the existing revalidate route to call `revalidateTag('bills')` and `revalidateTag('feed-stats')`, or shell out to a small route handler that does it. Don't ship without the invalidation — the cached feed will lie until it expires otherwise.

Expected runtime against the ~15,700-row corpus: under 30 minutes at concurrency 10. Expected cost: well under $1 on Gemini 2.5 Flash (input ~60 tokens, output ~10 tokens per bill).

## Inline integration

`lib/summarize.ts` currently emits `{topics, stage}` in its JSON block. Add `is_ceremonial` as a third required field. Update the prompt, the parser, and the upsert path in `lib/summarize-runner.ts`.

One Gemini call, three fields out, zero marginal cost going forward. Don't add a second classifier call inline — the existing summarize already has the title and action text in context.

Ceremonial bills still get a full summary written. The toggle is for filtering, not for skipping work — when someone flips it on, the panel should still show readable content.

## Query layer

`FeedFilters` gains `includeCeremonial?: boolean` (default `false`). `buildFeedWhere` adds:

```sql
AND (is_ceremonial = 0 OR is_ceremonial IS NULL)
```

…unless `includeCeremonial` is true, in which case the clause is omitted entirely. Cascades through every query that composes on `buildFeedWhere`:

- `getFeedBills` / `getFeedCount`
- `getStaleBills` / `getStaleCount`
- `getChangesBills` / `getChangesCount`
- `getPresidentBills` / `getPresidentCount`
- `getSponsors` / `getSponsorCount` — sponsor aggregations should reflect substantive work by default; the rankings shift meaningfully without this
- `getSponsorRecentBills` — the expanded sponsor panel should match the active toggle
- `getFeedStats` — the "Y" in "X OF Y BILLS" reflects what's actually shown; cache key needs `includeCeremonial` added so the two variants don't stomp each other

Don't apply the filter on `/watchlist` or `/bill/[id]`. If someone watched a ceremonial bill, surface it. Detail pages always render. The toggle is a list-view concept.

Add `includeCeremonial` to the cache keys of every `unstable_cache`-wrapped query the filter touches. One extra dimension fragments cache 2x — fine.

## URL convention

`?ceremonial=1` opts in. Absence or any other value defaults to substantive-only. Thread it through every component that builds hrefs:

- `StageFilter`, `TopicFilter`, `SearchBox`, `SortDropdown`
- `BillRow`, `SponsorRow`
- Pagination links
- The "Clear search" empty-state link
- The sponsor expand panel's `[VIEW ALL N BILLS →]` link

Same plumbing as `q` and `sponsor`. New helper `sanitizeIncludeCeremonial(input)` in `lib/queries.ts` accepts `'1'` and returns `true`, anything else returns `false`.

## Toggle component

New client island `components/CeremonialToggle.tsx`. Checkbox + label, 12px text, matches existing dropdown vocabulary. Pushes `?ceremonial=1` on check, removes the param on uncheck, preserves every other param including `expanded`. (Unlike most filter changes, flipping this one shouldn't collapse an open row.)

Place in `HeaderBar`'s right cluster, near the last-updated timestamp. Visible on every list page; suppressed on `/watchlist` and `/bill/[id]` where it has no effect.

Label text: `include ceremonial` when unchecked, `including ceremonial` when checked. Keeps the state legible without a state-of-the-toggle indicator beyond the checkbox itself.

## Acceptance

- Migration runs cleanly on production Turso, column and index present.
- `npm run classify-ceremonial` completes against the full corpus in under 30 minutes; no crashes on malformed Gemini output.
- New bills from the next sync tick land with `is_ceremonial` populated through the existing summarize flow — no second Gemini call.
- `/` page 1 contains zero obvious ceremonial bills with the toggle off; toggling on restores them in their normal positions.
- Sponsor counts on `/sponsors` shift visibly for known awareness-week and renaming champions. Spot-check Sheila Jackson Lee, Brian Mast, anyone introducing dozens of resolutions.
- `?ceremonial=1` persists across filter changes, search, sort, pagination, and row expansion. Same on `/stale`, `/changes`, `/sponsors`, `/president`.
- `/watchlist` and `/bill/[id]` ignore the toggle. Watched ceremonial bills surface in the watchlist.
- HeaderBar count line on `/` reflects the active toggle in both numerator and denominator.
- Cache invalidates correctly after both the one-time backfill and subsequent sync ticks.
- `SKILL.md` updated: new column documented in the schema block, new toggle documented in the design system section, new `?ceremonial` URL param noted alongside `q` and `sponsor`.

## Don't

- Don't add a topic enum value for "ceremonial". Topic is what the bill is about; ceremonial is whether the bill does anything. Orthogonal axes — don't conflate them.
- Don't fetch bill text for the classifier. Title plus latest action is enough signal, and we're not paying for tokens we don't need.
- Don't add a third Gemini call inline. One call, three JSON fields.
- Don't default `NULL` to hidden. The dashboard shouldn't go dark during backfill.
- Don't filter ceremonial on `/watchlist` or `/bill/[id]`.
- Don't ship the noise-rate analyst views (by chamber, by sponsor, by topic) in this handoff. Those are downstream cuts that need `is_ceremonial` to exist first. Roadmap theme 1, lens 1 covers them; they get their own numbered handoff once this lands.
- Don't break the existing cache invalidation patterns from handoffs 48–49. Add the new keys; don't rewire what's working.
