# CBT — Bug Fix: Wrong Congress

Found a bug in the feed. Bill HR 2967 (BLUE Pacific Act) links to congress.gov as a 119th Congress bill, but it's actually a 117th Congress bill from 2021. Two things to check and fix:

1. Run `SELECT congress, COUNT(*) FROM bills GROUP BY congress` and tell me the result. I need to know if the sync is correctly storing the API's congress value or hardcoding 119.

2. If the sync is hardcoding 119, fix it to use whatever the API returns. Re-run sync to correct existing rows (or write a one-off backfill script that re-fetches just the `congress` field for affected bills).

3. The feed's bill link currently uses `119th-congress` in the URL. Update the link helper in `lib/format.ts` (or wherever it lives) to use each bill's actual `congress` value: `https://www.congress.gov/bill/${congress}th-congress/${type_slug}/${number}`.

4. Also check whether the sync's date-range query (`fromDateTime`) is supposed to filter to current congress only. The Congress.gov `/bill` list endpoint doesn't filter by congress automatically — if you want only 119th Congress bills, you need to use `/bill/119` instead of `/bill`.

Decide based on what we want: do we track only the current Congress, or any bill that's actively being updated regardless of which Congress it originated in? My instinct is current-Congress-only for clarity. If you agree, switch the endpoint to `/bill/119` and delete any rows in the DB where `congress != 119`.

Then verify with the same query and confirm the BLUE Pacific Act is gone from the feed.

Don't move to step 4 yet.
