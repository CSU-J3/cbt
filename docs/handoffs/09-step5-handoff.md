# CBT — Step 5 Handoff: Slice + Deploy

Final step. Two parts: make the cron route safe for Vercel Hobby tier, then deploy.

## 1. Slice the summarize step

The current `/api/sync` route can run for 10-25 minutes when there's a large summarize backlog. Vercel Hobby caps function execution at 60 seconds. Fix:

- In `lib/summarize-runner.ts`, default `limit` to 50 if not provided
- In `app/api/sync/route.ts`, call `runSummarize({limit: 50})` so each cron tick handles at most 50 bills
- Keep the standalone `scripts/summarize.ts` unbounded so manual runs can still drain everything
- Update `vercel.json` to set `"maxDuration": 60` to match the Hobby ceiling, so we fail fast if anything goes wrong instead of timing out at the platform level

Steady-state volume is 50-200 new bills per day with a 6-hour cron, so 50 per run × 4 runs = 200/day capacity. Plenty.

If the route ever runs hot (returns ok=50 multiple ticks in a row), that's the signal a backlog exists and we'd manually run `npm run summarize` to drain it.

## 2. Deploy to Vercel

- Run `vercel` in the project root to link and deploy
- Set environment variables in the Vercel dashboard from `.env`:
  - `CONGRESS_API_KEY`
  - `GEMINI_API_KEY`
  - `TURSO_DATABASE_URL`
  - `TURSO_AUTH_TOKEN`
  - `CRON_SECRET`
- Confirm cron is registered (Vercel dashboard → project → Settings → Cron Jobs)
- Trigger one manual cron run from the dashboard or by curling the deployed URL with the Bearer token, confirm 200

## 3. Post-deploy verification

- Visit the deployed URL, confirm the feed loads with real data
- Click into a bill detail page, confirm it works in production
- Add a bill to the watchlist via the live site, confirm it persists
- Wait for the next scheduled cron tick (or trigger manually), confirm logs in Vercel dashboard show success

## Don't add features

No new pages, no UI polish, no schema changes. Just slice + deploy + verify. We can iterate on features after step 5 lands cleanly.

Report the deployed URL when done, plus a screenshot of the cron run logs in the Vercel dashboard.
