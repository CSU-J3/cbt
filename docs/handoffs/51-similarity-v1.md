# 51 — Similarity v1 (regex-based cluster classifier)

## What this is

A lot of bills share a structural template. Post office renamings all look the same. Awareness-month designations all look the same. CRA disapproval resolutions all look the same. The framing-question lens "which sponsor is the post-office-renaming champion" isn't answerable today because there's no cluster identity on each bill — there's just title text.

This handoff adds a `cluster_id` column to `bills`, defines five starter regex templates, runs a one-time backfill that pattern-matches every title and writes the cluster, folds the same match into the sync pipeline for new bills, and ships two surfaces: a `/clusters` index page (showing every cluster with counts and an example title) and a `?cluster=<id>` feed filter that reuses the existing feed view.

Pure code, no LLM, no API spend. Re-runnable.

Roadmap theme 1, step 2. Builds on handoff 50.

## Scope deliberately excluded

**No `/bill/[id]/similar` sub-page in v1.** That hub link implies semantic similarity ("show me other healthcare subsidy bills") and shape-clustering doesn't deliver that. A bill about banning a chemical doesn't want to surface 200 post-office renamings just because both are short resolutions. Per the roadmap, that sub-page lands when embedding-based v2 ships. Don't wire the link.

**No companion-bill detection.** Matching a House bill to its Senate twin is a different problem (pairwise title similarity, not template matching). Separate handoff later.

## Schema

```sql
ALTER TABLE bills ADD COLUMN cluster_id TEXT;
CREATE INDEX idx_bills_cluster_id ON bills(cluster_id);
```

`NULL` means "no template matched" — most bills will be NULL because most bills are bespoke. `cluster_id` is a stable slug string like `facility-naming`, `cra-disapproval`. No separate `clusters` table; cluster metadata (display name, description) lives in source.

Migration in `scripts/migrate.ts` following the same pattern handoff 50 used for `is_ceremonial`.

Update `SKILL.md` schema block.

## Pattern definitions

New file `lib/cluster-patterns.ts`. Single source of truth for every cluster — slug, display name, description, regex, optional `bill_type` narrowing.

```ts
export type ClusterPattern = {
  id: string;            // stable slug, written to bills.cluster_id
  name: string;          // display name for UI
  description: string;   // one-sentence explainer for /clusters index
  regex: RegExp;         // case-insensitive title match
  billTypes?: string[];  // optional narrowing; if set, title must match AND bill_type must be in list
};

export const CLUSTER_PATTERNS: ClusterPattern[] = [
  {
    id: 'cra-disapproval',
    name: 'CRA disapproval',
    description: 'Resolutions disapproving a federal rule under the Congressional Review Act.',
    regex: /providing for congressional disapproval under chapter 8 of title 5/i,
    billTypes: ['hjres', 'sjres'],
  },
  {
    id: 'facility-naming',
    name: 'Facility naming',
    description: 'Bills designating or renaming post offices, federal buildings, courthouses, VA centers, ATC towers, and similar facilities.',
    regex: /^to designate the .+(post office|federal building|courthouse|medical center|air traffic control tower|federal correctional|facility) .* as the/i,
  },
  {
    id: 'awareness-designation',
    name: 'Awareness designation',
    description: 'Resolutions designating a National/American Day, Week, or Month for a cause.',
    regex: /designating .+ as (national|american) .+ (day|week|month)/i,
  },
  {
    id: 'sense-of-congress',
    name: 'Sense of Congress',
    description: 'Resolutions expressing the sense of the House, Senate, or Congress without legal effect.',
    regex: /^(expressing the sense|a resolution expressing the sense) of/i,
  },
  {
    id: 'honoring-resolution',
    name: 'Honoring resolution',
    description: 'Resolutions honoring, recognizing, celebrating, commemorating, or congratulating individuals, groups, or events.',
    regex: /^(honoring|recognizing|celebrating|commemorating|congratulating) /i,
  },
];
```

Order matters: each bill gets matched against patterns in array order; first hit wins. CRA and facility-naming are specific enough to lead. Honoring is the broadest, sits last.

Export a helper:

```ts
export function classifyCluster(title: string, billType: string): string | null {
  for (const p of CLUSTER_PATTERNS) {
    if (p.billTypes && !p.billTypes.includes(billType)) continue;
    if (p.regex.test(title)) return p.id;
  }
  return null;
}
```

Expect to iterate on these regexes once backfill numbers come in. The whole point of putting them in a single file with named patterns is making revision cheap.

## Backfill script

`scripts/backfill-clusters.ts`. Pure code, no Gemini.

1. `SELECT id, title, bill_type FROM bills WHERE cluster_id IS NULL` — first run hits every row; re-runs only touch rows that didn't match previously (so re-running after adding a sixth pattern picks up the gap).
2. For each row, call `classifyCluster(title, bill_type)`. If non-null, `UPDATE bills SET cluster_id = ? WHERE id = ?`.
3. After completion, hit the revalidate route to invalidate `revalidateTag('bills')` and `revalidateTag('feed-stats')` — same pattern as the ceremonial backfill. Skippable; defaults to waiting for next cron.
4. Log a per-cluster count summary at the end (`facility-naming: 1,247 bills; cra-disapproval: 89 bills; …`). Useful for sanity-checking the regexes before shipping the UI.

`npm run backfill-clusters` as the script entry.

Run time: under a minute against the full corpus. No external calls, no rate limits.

## Inline integration

`lib/sync.ts` upsert path: when a bill is inserted or its title changes on update, call `classifyCluster(title, billType)` and write `cluster_id` in the same upsert. No second pass needed.

Note: unlike `is_ceremonial`, this runs unconditionally on every sync — pure regex, zero cost, no reason to gate it.

## Query layer

`FeedFilters` gains `cluster?: string`. `buildFeedWhere` adds:

```sql
AND cluster_id = ?
```

…when `filters.cluster` is set. The cluster filter composes with everything else (stage, topics, q, sponsor) via the same plumbing.

Cascades through every consumer of `buildFeedWhere`: `getFeedBills`, `getFeedCount`, `getStaleBills`, `getStaleCount`, `getChangesBills`, `getChangesCount`, `getPresidentBills`, `getPresidentCount`. Sponsor queries don't need the cluster filter (sponsor page is about people, not bill shapes).

Cache keys for the `unstable_cache`-wrapped queries pick up the new dimension automatically via arg-derived fragmentation.

Add `sanitizeClusterId(input)` in `lib/queries.ts` — validates the input is a known cluster slug from `CLUSTER_PATTERNS`, returns `null` otherwise. Don't trust raw URL input.

New helper `getClusterStats()`:

```ts
// returns [{id, name, description, count, exampleTitle}], sorted by count DESC
```

For the `/clusters` index page. Cache it with `unstable_cache` tagged `'bills'` — same invalidation as the rest.

## URL convention

`?cluster=<slug>` filters the active feed. Thread through every component that builds hrefs, same plumbing as `q`, `sponsor`, `ceremonial`:

- `StageFilter`, `TopicFilter`, `SearchBox`, `SortDropdown`
- `BillRow`, `SponsorRow`
- Pagination links
- Clear-search empty-state link

When `?cluster` is set on the home feed, the HeaderBar count line shows `· in <cluster name>` in `--accent-amber` (mirrors how `· sponsored by <name>` already renders).

## /clusters index page

New route `app/clusters/page.tsx`. Server component.

Layout: shares `HeaderBar` and `FooterLegend` with the rest of the app. Body is a single column of cluster rows:

```
CLUSTER NAME           COUNT    EXAMPLE
facility-naming        1,247    To designate the United States…
cra-disapproval           89    Providing for congressional…
awareness-designation     54    Designating the week of…
honoring-resolution      612    Honoring the life and legacy of…
sense-of-congress        201    Expressing the sense of the House…
```

Each row links to `/?cluster=<id>`. Sorted by count descending. Click the cluster name → land on the feed filtered to that cluster.

HeaderBar chrome: title is `BILL TEMPLATES`, no search box (the page isn't a feed). Count line: `5 templates · 2,203 bills matched · 13,474 unmatched`. Unmatched count comes from a `SELECT COUNT(*) FROM bills WHERE cluster_id IS NULL` honoring the active ceremonial filter.

Empty state for a new cluster with zero matches: show the row anyway with count `0` and example `—`. Useful signal that a pattern shipped but didn't catch anything.

## Ceremonial toggle interaction

When `?cluster=<id>` is set on any feed view, the ceremonial filter bypasses entirely — return every matching bill regardless of `is_ceremonial`. Hide the `CeremonialToggle` from `HeaderBar` in this state; don't show a dead control.

The reasoning: most clusters will be predominantly ceremonial. If you've explicitly opted into "awareness designations," you're asking to see the noise. The toggle's purpose is filtering noise out by default; inside a cluster view, noise is the content.

CRA disapproval is the test case. Those bills are substantive, so they show whether the toggle is on or off — but inside the cluster view they should show unconditionally, like every other cluster.

## Acceptance

- Migration runs cleanly on production Turso. Column and index present.
- `npm run backfill-clusters` completes in under a minute against the full corpus.
- Per-cluster counts logged at script end roughly track expectations: `facility-naming` in the hundreds-to-low-thousands; `cra-disapproval` in the dozens; `awareness-designation` and `honoring-resolution` in the hundreds; `sense-of-congress` in the low hundreds.
- New bills picked up by the next sync get `cluster_id` populated.
- `/clusters` page renders the five-row table, sorted by count, with working links.
- Clicking a cluster lands on `/?cluster=<id>` showing only bills in that cluster. Filters, search, sort, pagination, and row expansion all work and preserve the cluster param.
- Ceremonial toggle is hidden when `?cluster` is set. The full cluster contents show regardless of toggle state.
- HeaderBar count line on a cluster-filtered feed reads `N OF M BILLS · in <cluster name>`.
- `?cluster=invalid-slug` is rejected by `sanitizeClusterId` and renders the unfiltered feed (same defensive posture as bad `?stage=` values).
- `SKILL.md` updated: new column documented, new page documented, new URL param noted alongside `q`, `sponsor`, `ceremonial`. Pattern file referenced.

## Don't

- Don't ship `/bill/[id]/similar` in this handoff. Wait for embedding-based v2.
- Don't add a `clusters` table. Patterns live in source. Single column on `bills` is enough.
- Don't try to assign multiple cluster IDs to a single bill. First-match-wins, single slot.
- Don't gate the inline match on Gemini or any network call. Pure regex, runs on every upsert.
- Don't bypass `sanitizeClusterId` anywhere. URL input is untrusted everywhere it's used.
- Don't reintroduce `export const revalidate = N`. Same reasoning as handoffs 48–50.
- Don't add the cluster filter to the sponsor queries. Different axis.
- Don't show the `CeremonialToggle` on `/clusters` — that page isn't a feed and the toggle has no meaning there.
