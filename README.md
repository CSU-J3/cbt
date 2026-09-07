# Congressional Terminal

Congressional Terminal exists to answer one question: **WTF is going on in Congress?**

It started as a personal sense-making tool and grew into a Bloomberg-terminal-style
dashboard that covers both sides of the story — the legislative side (what Congress
is actually working on) and the electoral side (who's up, where the races stand).
Most trackers show you every bill and help you understand none of them.
Congressional Terminal prioritizes comprehension over coverage. Deployed as a
personal project. A GitHub sign-in (Auth.js) exists but gates nothing —
first-touch anonymous visitors land on `/welcome` and get the full product as a
demo; signing in adds a personal watchlist, and makes the watch star on every bill
row remember what you flagged.

**Live demo:** https://congressional-terminal-chi-silk.vercel.app

## What's in it

- **Dashboard (`/`)** — the answer surface. A week summary, a stage funnel, the
  topic mix, top movers and stalls, a competitive-races strip, an "on the hill"
  hearings band, and a live markets tape.
- **Bills feed (`/bills`)** — every current-Congress bill, filterable by topic and
  stage, searchable, ceremonial noise filtered out, click-to-expand rows with the
  Gemini summary and full action history.
- **News (`/news`)** — press coverage from Politico, The Hill, and Roll Call,
  LLM-matched to specific bills with source and signal filters; feeds the
  dashboard's breaking-news block and the media-attention badges on feed rows.
- **Members (`/members`)** — a merged members + committees two-pane browser:
  sponsor depth, voting records, caucus badges, and Palestine-scorecard grades.
- **Electoral (`/electoral`)** — the consolidated electoral surface: the competitive
  US map with a primary-calendar timeline band, race ratings, live primary results,
  district maps, FEC fundraising, and prediction-market odds (Kalshi + Polymarket).
  `/races` and `/primaries` 308-redirect here; `/race/[id]` is the per-race hub.
- **Lobbying (`/lobbying`)** — who's paying to move what: LD-2 quarterly filings for
  the 119th, bucketed by issue area, with a top-firms leaderboard, a searchable and
  sortable filings feed, and the numbered-bill link laid over the bills a filing
  names.
- **Amendments (`/amendments`) and Nominations (`/nominations`)** — floor amendments
  and nominations, synced daily along the bill spine.
- **Hearings (`/hearings`)** — upcoming committee hearings, in list and calendar
  views.
- **Patterns (`/patterns`)** — the same forms of legislation, filed again and again:
  bills clustered into repeated forms, with a filler-watch strip and click-through
  to the measures. `/trends` sits in the same group and carries the long-run
  time-series charts.
- **Trades (`/trades`)** — congressional stock-trade disclosures (FMP), matched to
  members.
- **Watchlist (`/watchlist`)** — the bills you've starred anywhere in the terminal,
  in one place. The star is per-account, which is what the sign-in is for.
- **Weekly reports (`/reports`)** — generated snapshots that package an answer to
  the framing question on a weekly cadence.
- **Markets tape** — equities, commodities, rates, and prediction markets, carried
  as legislative-context signal rather than as a finance feature.
- **Search (`/search`)** — full-text search across bills, members, and reports.

Smaller cuts hang off the same spine: `/president` (bills at the desk), `/changes`
(the stage-change feed), `/stale` (momentum gone quiet).

## Stack

Next.js 15 (App Router) · TypeScript · Tailwind v4 · Turso (libSQL) ·
`@google/genai` (Gemini 2.5 Flash) · Auth.js (`next-auth` v5) · Vercel hosting +
Cron. Playwright drives the production smoke crawls.

Maps are rendered with `d3-geo` / `topojson-client` / `us-atlas`; XML feeds parsed
with `fast-xml-parser`; reports rendered with `react-markdown` + `remark-gfm`.

## Running locally

1. `npm install`
2. `cp .env.example .env`. Five keys boot the core: `CONGRESS_API_KEY` (request at
   https://api.data.gov/signup, free), `GEMINI_API_KEY`
   (https://aistudio.google.com/apikey), `TURSO_DATABASE_URL` + `TURSO_AUTH_TOKEN`
   (`turso db create cbt`, then `turso db tokens create cbt`), and `CRON_SECRET`
   (any 32-byte hex string). The rest are per-surface and documented inline in
   `.env.example` — `FMP_API_KEY`/`FRED_API_KEY` for the markets tape and trades,
   `FEC_API_KEY` for fundraising, `LDA_API_KEY` for lobbying, the Auth.js trio for
   sign-in, `REVALIDATE_URL` for backfill cache flushes. Everything renders with
   whatever data is present.
3. `npm run migrate` to create the schema.
4. `npm run sync` to fetch current-Congress bills from Congress.gov. The first run
   pulls a few thousand recently-active bills; the live corpus is ~17.5k and fills
   in over subsequent incremental runs.
5. `npm run summarize` to generate plain-English summaries with Gemini. A full
   backfill takes a while and a few dollars in API spend; the standalone script is
   unbounded, while the cron route caps each tick to fit the function ceiling.
6. `npm run dev` — dashboard at http://localhost:3000

The races, hearings, markets, and reports surfaces have their own sync/seed scripts
(`npm run seed:races`, `sync:race-ratings`, `sync:meetings`, `sync:fec`,
`sync:palestine`, `sync:lda`, `report`, …) — see the `scripts` block in
`package.json`. They're optional for a local spin-up; the dashboard renders with
whatever data is present.

> On Windows with Git Bash, Ctrl+C on `npm run dev` doesn't always reap the node
> process. If a later launch fails with a port-3000 collision, run
> `taskkill /F /IM node.exe` from cmd or PowerShell to clear it.

## Deployment

Deploys ride the Vercel Git integration: a push to `main` builds Production
(functions pinned to `pdx1`), a review ref builds a Preview. `npm run verify:deploy`
confirms the served SHA after a ship. Cron auth is a `Bearer ${CRON_SECRET}` header
on every tick, and `/api/health` watches the fleet.

The schedule is native Vercel Cron end-to-end — `vercel.json` carries all 18 entries
and is the authority. The shape: `/api/sync` every 6 hours, summarize every 10
minutes, news every 30, markets every 4 hours plus half-hourly FMP ticks through US
market hours, Kalshi odds every 2 hours, bill rosters every 3, daily passes for LDA,
amendments, nominations, and votes, and two weeklies — race-ratings (Wed) and the
weekly report (Mon 09:30 UTC).

GitHub Actions carries CI, not data: `ci.yml` (typecheck, the odds-site allowlist
check, and build), `e2e-prod.yml` (the scheduled and post-deploy production smoke
crawl), and `design-citations.yml`.

## Project structure

- `app/` — App Router pages (dashboard, bills, news, members, electoral, lobbying,
  amendments, nominations, hearings, patterns, trades, watchlist, reports, search,
  …) and the `app/api/**` routes, including the `/api/cron/*` tick handlers.
- `components/` — the Tailwind UI: terminal primitives, feed rows, the stage
  funnel/legend, race cards and maps, the markets tape, hearings views, report
  rendering.
- `lib/` — shared logic: `db.ts`, `queries.ts`, the sync/summarize pipeline, and
  per-source modules (`congress`, `fmp`, `markets`, `kalshi`, `polymarket`, `fec`,
  `race-ratings-*`, `primaries-sync`, `hearings`, `report-generation`, …).
- `scripts/` — standalone `tsx` CLI entry points: `migrate`, `sync`, `summarize`,
  the seed/backfill scripts, and the per-source syncs.
- `docs/handoffs/` — the chronological handoff prompts that drove each step of
  development. **386 of them ship with the repo as loose files** (numbered through
  429 — they predate the `.gitignore` entry that now covers the directory), and
  **267 more ride as one gzip** (`docs/handoffs-archive-362-661.tar.gz` — `tar -xzf`
  it to read). The two sets are disjoint and together run from 01 to 661; everything
  after 661 is repo-ignored and local-only (Tailwind build-input parity).
- `docs/roadmap.md` — where the dashboard is going; append-only narrative, one
  block per handoff.
- `docs/backlog.md` — the open-loops ledger: open, queued, banked, watched, done.
- `docs/oddities.md` — field notes on what broke and why.
- `docs/design/` — mocks and ruling records, tracked by default; its own
  `README.md` states the rule, the one ignored `scratch/`, and what
  `npm run check:design-citations` enforces.
- `docs/method.md` — how this project is worked: roles, session start, handoff
  and relay discipline, scope, environment.
- `.claude/skills/cbt/` — `SKILL.md` with project context for Claude Code.

## Data & acknowledgments

- **Bills & actions** — [Congress.gov API v3](https://api.congress.gov), Library of
  Congress.
- **Summaries** — Google [Gemini 2.5 Flash](https://ai.google.dev/gemini-api/docs/models/gemini).
- **Markets tape** — [FMP](https://site.financialmodelingprep.com) (equity indices +
  congressional trade disclosures) and [FRED](https://fred.stlouisfed.org) (rates,
  commodities, VIX).
- **Prediction markets** — [Kalshi](https://kalshi.com) and
  [Polymarket](https://polymarket.com) for race and chamber-control odds.
- **Race ratings & candidates** — [Ballotpedia](https://ballotpedia.org) (which
  aggregates Cook, Sabato, and Inside Elections).
- **Fundraising** — the [FEC](https://www.fec.gov/data/) API.
- **Lobbying** — the [LDA API](https://lda.gov) (Lobbying Disclosure Act filings).
- **Ideology & vote history** — [Voteview](https://voteview.com) (DW-NOMINATE).
- **Member metadata** — the [@unitedstates congress-legislators](https://github.com/unitedstates/congress-legislators) dataset.
- **Palestine scorecard** — the [USCPR](https://uscpr.org) congressional scorecard.
- **News** — RSS feeds from [Politico](https://www.politico.com),
  [The Hill](https://thehill.com), and [Roll Call](https://rollcall.com).

## CCBT

There's a sister project, **CCBT**, that does the same thing for the Colorado
statehouse — same stack, separate repo. It's not part of this codebase, just a
pointer.

## License

MIT — see [LICENSE](./LICENSE).
