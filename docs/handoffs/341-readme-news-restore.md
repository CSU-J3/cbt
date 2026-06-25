# Handoff: Restore the news surface to README.md

**Claim your own number.** `ls docs/handoffs/`, take the highest integer prefix + 1, rename this file to match. The 341 in the working filename is a guess and may be taken. Nothing inside depends on the number.

## Read first

HO 337 (the README rewrite) told you the news theme was "built, then cut, theme is closed," and you correctly omitted news from the new README on that instruction. That instruction was wrong. Your own audit afterward proved news is a live, linked, still-ingesting surface (227 rows in `news_mentions`, current to 06-21, reachable five ways, wired into every feed query). The README you wrote under-describes a working feature. This handoff adds it back.

Before editing, `cat README.md` and confirm the current state: the surfaces list has no news entry and the deployment cron prose has no news tick. That's what you're fixing. If a later edit already added news back, stop and report instead of duplicating.

## Resolved facts (from your audit — don't re-derive)

How news actually sits in the tree:

- The real surface is `NewsView`, the `mode=news` branch inside `app/bills/page.tsx`. It renders `NewsFilters` + `NewsRow` off `getNewsFeed(...)` with source/topic/window/signal filters and pagination. `app/news/page.tsx` is only a redirect shim to `/bills?mode=news` for old bookmarks.
- Reachable via the `BILLS | NEWS` toggle on `/bills`, the top-nav Bills|News tab, the `BREAKING` block on the home dashboard (`BreakingNewsBlock`), and a news tab in global search.
- Bill rows across the feed carry a media-attention badge (`MediaAttentionCell`, the "📰 N" mention count) from the `news_mentions` LEFT JOIN.
- Ingestion: `/api/cron/news` runs daily at 14:00 UTC (`0 14 * * *`, `maxDuration: 60`). It pulls RSS from Politico, The Hill, and Roll Call, LLM-matches each article to a bill, and inserts into `news_mentions`.

## Edits

Three spots in `README.md`, news only. Leave the rest of the file alone.

1. **Surfaces / "What's in it"** — add news. Describe it as it is: a news mode on the bills feed that matches press coverage (Politico, The Hill, Roll Call) to specific bills, with source and signal filters, plus a breaking-news block on the dashboard and a media-attention badge on feed rows. Do not describe it as a standalone `/news` page, because it isn't one.

2. **Deployment** — add the news ingestion cron to the cron topology: daily at 14:00 UTC, RSS pull + LLM bill-matching into `news_mentions`. It belongs in the same prose that already covers the other Vercel crons and the GitHub Actions ticks.

3. **Data & acknowledgments** — if the sources section lists the other data providers, add the news RSS sources (Politico, The Hill, Roll Call) alongside them.

## Scope

News only. Don't restructure or re-verify the rest of the README; HO 337's other sections (routes, scripts, env, the non-news crons, sources) stand. Single-file edit to `README.md`, fully reversible, no HALT, nothing to commit unless asked.

## Done when

- The surfaces list describes the news mode accurately (feed mode, not a standalone page).
- The deployment section names the daily 14:00 UTC news cron.
- News RSS sources are credited.
- No other part of the README changed.
