# Handoff: Rewrite README.md against live repo state

**Claim your own number.** Before anything else, `ls docs/handoffs/`, take the highest existing integer prefix + 1, and rename this file to match. The number 334 in the working filename is a guess from a lagging snapshot and may already be taken. Nothing inside this handoff depends on the number.

## Task

Rewrite the repo-root `README.md`. The current one describes a project that no longer exists.

## Why

The README still describes CBT as "a filtered feed plus a watchlist." That was true ~150 handoffs ago. The live app is a terminal-style dashboard covering both what Congress is *doing* and the electoral context around it. The README is the first thing anyone hitting the GitHub repo reads, and right now it undersells the project by an order of magnitude and gets specific facts wrong.

## Hard rule: do not trust the stale docs for facts

`README.md`, `SKILL.md`, and `docs/roadmap.md` were all written in the early era and describe the feed+watchlist world. **Do not lift the project-structure, routes, scripts, env-var, or cron sections from any of them.** Derive every factual section from the live tree:

- **Routes / pages** — enumerate `app/**/page.tsx` and `app/api/**/route.ts`. The old README lists `/`, `/bill/[id]`, `/watchlist` and two API routes. There are many more now.
- **Scripts** — read the `scripts` block in `package.json`. Don't carry forward a script list from memory.
- **Env vars** — read `.env.example`. The old README lists 5 vars. There are more now (markets/data-source keys at minimum). List exactly what `.env.example` holds.
- **Cron topology** — read `vercel.json` *and* `.github/workflows/*.yml`. The old README claims a single daily 09:00 UTC `/api/sync` tick. Reality is multiple paths (a markets-tape Vercel cron, GitHub Actions intraday supplements, the report generation cron). Describe what's actually configured, accurately.
- **lib / components** — spot-check the directories rather than reciting the old lists; the inventories have grown and some names changed (e.g. the legend component, dashboard headers).
- **Corpus scale** — the live corpus is ~15k+ current-Congress bills, not the ~1,500–1,700 first-sync figure. The local-setup step can keep a realistic first-sync number, but the intro should convey the real scale.

If live state contradicts anything in this handoff, live state wins — grep before you assert.

## Do NOT feature these (built then cut/dead)

- **News signal / breaking-news surface** — built, then cut. The theme is closed. Verify whether any news surface still exists before mentioning it; default to not featuring it.
- **Stock/congressional trades** — the data source died; no live feature. Don't mention it.
- **OpenSecrets** — dead source, reverted. Donor/fundraising data comes from FEC. Credit FEC, not OpenSecrets.

## Positioning the new README must communicate (use this, don't reinvent it)

CBT exists to answer one question: **"WTF is going on in Congress?"** It started as a personal sense-making tool and grew into a Bloomberg-terminal-style dashboard that covers both the legislative side (what Congress is working on) and the electoral side (who's up, where the races stand). It prioritizes comprehension over coverage — most trackers show every bill and help with none. Single-user, no auth, deployed personal project.

State that plainly up top. Then a short **What's in it** section covering the live surfaces. Confirm each against the live tree before listing it, but the set is roughly:

- **Dashboard (`/`)** — the answer surface: week summary, stage funnel, topic mix, top movers/stalls, a competitive-races strip, an "on the hill" hearings band, and a live markets tape.
- **Bills feed** — filterable by topic/stage, searchable, ceremonial noise filtered out, click-to-expand rows.
- **Members** — merged members + committees two-pane browser; sponsor depth, voting records, caucus badges, Palestine-scorecard grades.
- **Races / electoral** — race ratings, primaries with live results, district maps, FEC fundraising, prediction-market odds (Kalshi + Polymarket).
- **Hearings** — upcoming committee hearings, list and calendar views.
- **Weekly reports** — generated snapshots that package an answer to the framing question on a cadence.
- **Markets tape** — equities, commodities, rates, and prediction markets, as legislative-context signal.

Keep it a list of what the thing does, not marketing. If a surface isn't live, drop it.

## Required structure

1. Title + one-paragraph what-it-is (framing question + comprehension-over-coverage).
2. Live demo link (https://cbt-chi-silk.vercel.app).
3. **What's in it** — the surfaces above, verified against live routes.
4. **Stack** — Next.js 15 App Router, TypeScript, Tailwind v4, Turso (libSQL), Gemini 2.5 Flash, Vercel + Cron. Add the data-fetch libs/sources that are actually wired.
5. **Running locally** — keep the existing shape (install → env → migrate → sync → summarize → dev), but pull the env list from `.env.example` and sanity-check the script names.
6. **Deployment** — the real cron topology from `vercel.json` + workflows.
7. **Project structure** — `app/`, `components/`, `lib/`, `scripts/`, `docs/handoffs/`, the skill location, each described from the live tree.
8. **Data & acknowledgments** — credit all live sources: Congress.gov API v3 (Library of Congress), Gemini 2.5 Flash, FMP (equities), FRED (commodities/rates), Kalshi + Polymarket (prediction markets), Ballotpedia (race ratings/candidates), FEC (fundraising), USCPR Palestine scorecard. List only what's actually used.
9. One line noting **CCBT** as a separate sister project (Colorado statehouse, same stack, own repo) — not part of this repo, just a pointer.
10. License (MIT, unchanged).

## Tone

Match the repo owner's voice: direct, specific, no press-release register. No "transformative / seamless / robust / comprehensive," no "in today's fast-paced world," no "it's not just X, it's Y." Plain, honest, personal-project README. Contractions fine.

## Before you write

Do the grep pass first — routes, `package.json` scripts, `.env.example`, `vercel.json`, `.github/workflows/`, lib/components dirs — so the factual sections are real. Then write. Single-file overwrite of `README.md`; fully reversible, no HALT.

## Done when

- `README.md` accurately reflects the live surfaces, routes, scripts, env vars, and cron topology.
- No dead/cut features mentioned (news signal, stock trades, OpenSecrets).
- All live data sources credited.
- Reads in the owner's voice, no AI-tells.
