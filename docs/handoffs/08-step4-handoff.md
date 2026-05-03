# CBT — Step 4 Handoff Prompt (Detail Page, Watchlist, Cron Sync)

Step 4: bill detail page, watchlist, and Vercel Cron sync.

Read `.claude/skills/cbt/SKILL.md` first.

## Build

### 1. Bill detail page at `/bill/[id]`

- Server component, queries Turso for the single bill
- Shows everything from the feed row plus: full latest action text, introduced date, link to congress.gov, an expandable "raw JSON" section for debugging (collapsed by default)
- Watchlist toggle button at the top
- 404 if the bill ID doesn't exist

### 2. Watchlist

- API route `POST /api/watchlist` that takes `{billId, action: "add" | "remove"}` and updates the `watchlist` table
- Watchlist page at `/watchlist` — server component listing all flagged bills, same row format as the feed
- Toggle button on the bill detail page is a small client component that posts to the API and refreshes
- Update bill IDs in the feed to link to `/bill/[id]` instead of congress.gov directly

### 3. Sync as a Vercel Cron route

- Move `scripts/sync.ts` logic into `app/api/sync/route.ts` (POST handler)
- Same for `scripts/summarize.ts` — the cron route should run sync first, then summarization on any newly-added bills
- Authenticate with `Bearer ${CRON_SECRET}` from the Authorization header. Reject anything else with 401.
- Add `vercel.json` with a cron schedule of every 6 hours
- The standalone scripts in `scripts/` should still work for manual runs

## Don't deploy yet

Get it all running locally first. After it works, we'll handle Vercel deployment as a final step.

## Verify and report

- Screenshot of a bill detail page
- Screenshot of the watchlist page with at least 2 bills added
- Confirmation the cron route works locally (curl with the right Bearer token returns success, wrong token returns 401)
