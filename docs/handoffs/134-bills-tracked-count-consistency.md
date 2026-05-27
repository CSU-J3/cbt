# Handoff 134: Bills tracked count consistency

## Problem

The home page surfaces the non-ceremonial bill count in two places and they drift:

- Lead-in copy: "15,936 non-ceremonial bills"
- LAST SYNC block: "15,935 BILLS TRACKED"

Cause: the lead-in runs a live `COUNT()` at request time, and the LAST SYNC block reads from `cron_runs.bills_tracked` stamped at job completion. Off-by-one happens when a bill lands between the sync write and page render, or when ceremonial reclassification shifts a bill out of the filter after sync stamped its count.

## Fix

Both numbers become live counts pulled from a single helper. The LAST SYNC block is reshaped so the count isn't semantically anchored to the sync timestamp.

## Steps

### 1. Locate and verify

Before writing the helper, find both call sites and report back:

- Lead-in: whichever home page component renders "X non-ceremonial bills"
- LAST SYNC: the status strip on the home page

Confirm the existing queries. Specifically: do both filters use the same definition of "ceremonial"? If they don't (e.g. one uses `ceremonial = 0`, the other `COALESCE(ceremonial, 0) = 0`), the off-by-one might not be timing skew at all, it's filter divergence. If you find that, flag it before continuing so we pick the canonical filter deliberately rather than by accident.

### 2. Helper

Add `getNonCeremonialBillCount()` to `lib/queries.ts`. Single `SELECT COUNT(*) FROM bills WHERE <canonical ceremonial filter>`. Whatever the canonical filter is (confirmed in step 1), this is now the single definition used anywhere on the site.

### 3. Swap both call sites

- Lead-in: call the helper.
- LAST SYNC block: drop "BILLS TRACKED" from the SYNC line so the timestamp stands alone. Add a separate corpus stat. Suggested wording: `CORPUS: 15,936 BILLS`. If a cleaner slot fits the home design better, use that and flag it in the PR-style summary at the end.

Both surfaces now route through the same helper. They cannot drift.

### 4. Verify

Reload the home page a few times. Both numbers identical every time.

## Out of scope

- `cron_runs` schema changes. The `bills_tracked` column stays, we just stop rendering it on the home page.
- New "added since last sync" stat. Possible future work, not this handoff.
- Caching the `COUNT()` query. Should be fast enough on the current corpus, revisit only if it shows up in perf.

## Files likely touched

- `lib/queries.ts` (add helper)
- `app/page.tsx` and/or the home lead-in component
- The home status / LAST SYNC component

## Acceptance

- Both home-page bill counts call `getNonCeremonialBillCount()`.
- The two numbers are always equal across reloads.
- The LAST SYNC line no longer carries a bill count.
- The corpus count is presented in its own slot with wording that doesn't imply anchoring to sync time.
