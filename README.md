# Congressional Terminal

Congressional Terminal exists to answer one question: **WTF is going on in Congress?**

It started as a personal sense-making tool and grew into a Bloomberg-terminal-style
dashboard that covers both sides of the story — the legislative side (what Congress
is actually working on) and the electoral side (who's up, where the races stand).
Most trackers show you every bill and help you understand none of them.
Congressional Terminal prioritizes comprehension over coverage. Single user, no
auth, deployed as a personal project.

**Live demo:** https://congressional-terminal-chi-silk.vercel.app

## What's in it

- **Dashboard (`/`)** — the answer surface. A week summary, a stage funnel, the
  topic mix, top movers and stalls, a competitive-races strip, an "on the hill"
  hearings band, and a live markets tape.
- **Bills feed (`/bills`)** — every current-Congress bill, filterable by topic and
  stage, searchable, ceremonial noise filtered out, click-to-expand rows with the
  Gemini summary and full action history.
- **News** — a news mode on the bills feed (the `BILLS | NEWS` toggle) that matches
  press coverage from Politico, The Hill, and Roll Call to specific bills, with
  source and signal filters. Feeds a breaking-news block on the dashboard and a
  media-attention badge on feed rows.
- **Members (`/members`)** — a merged members + committees two-pane browser:
  sponsor depth, voting records, caucus badges, and Palestine-scorecard grades.
- **Races (`/races`, `/primaries`)** — race ratings, primaries with live results,
  district maps, FEC fundraising, and prediction-market odds (Kalshi + Polymarket).
- **Hearings (`/hearings`)** — upcoming committee hearings, in list and calendar
  views.
- **Weekly reports (`/reports`)** — generated snapshots that package an answer to
  the framing question on a weekly cadence.
- **Markets tape** — equities, commodities, rates, and prediction markets, carried
  as legislative-context signal rather than as a finance feature.
- **Search (`/search`)** — full-text search across bills, members, and reports.

## Stack

Next.js 15 (App Router) · TypeScript · Tailwind v4 · Turso (libSQL) ·
`@google/genai` (Gemini 2.5 Flash) · Vercel hosting + Cron.

Maps are rendered with `d3-geo` / `topojson-client` / `us-atlas`; XML feeds parsed
with `fast-xml-parser`; reports rendered with `react-markdown` + `remark-gfm`.

## Running locally

1. `npm install`
2. `cp .env.example .env` and fill in:
   - `CONGRESS_API_KEY` — request at https://api.data.gov/signup (free, 5,000 req/hr)
   - `GEMINI_API_KEY` — generate at https://aistudio.google.com/apikey
   - `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN` — create a database with the
     [Turso CLI](https://docs.turso.tech/cli/installation) (`turso db create cbt`,
     then `turso db tokens create cbt`)
   - `CRON_SECRET` — any 32-byte hex string,
     e.g. `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
   - `FMP_API_KEY` — for the markets tape; free tier at
     https://site.financialmodelingprep.com/developer/docs (250 req/day)
3. `npm run migrate` to create the schema.
4. `npm run sync` to fetch current-Congress bills from Congress.gov. The first run
   pulls a few thousand recently-active bills; the live corpus is ~15k+ and fills
   in over subsequent incremental runs.
5. `npm run summarize` to generate plain-English summaries with Gemini. A full
   backfill takes a while and a few dollars in API spend; the standalone script is
   unbounded, while the cron route caps each tick to fit the function ceiling.
6. `npm run dev` — dashboard at http://localhost:3000

The races, hearings, markets, and reports surfaces have their own sync/seed scripts
(`npm run seed:races`, `sync:race-ratings`, `sync:meetings`, `sync:fec`,
`sync:palestine`, `report`, …) — see the `scripts` block in `package.json`. They're
optional for a local spin-up; the dashboard renders with whatever data is present.

> On Windows with Git Bash, Ctrl+C on `npm run dev` doesn't always reap the node
> process. If a later launch fails with a port-3000 collision, run
> `taskkill /F /IM node.exe` from cmd or PowerShell to clear it.

## Deployment

Deployed via `vercel --prod`. Cron auth is a `Bearer ${CRON_SECRET}` header on every
tick.

Vercel Hobby caps cron at once per day, so the topology is split:

- **Vercel Cron** (`vercel.json`) runs a staggered daily chain — `/api/sync` (09:00
  UTC) then summarize, votes, committees, primaries, rating-history, and a news pull
  (`/api/cron/news`, 14:00 UTC — RSS from Politico/The Hill/Roll Call, LLM-matched to
  bills and written to `news_mentions`) spread across the day, plus a markets-close
  tick — and two weekly jobs: race-ratings (Wed) and the weekly report (Mon 09:30).
- **GitHub Actions** (`.github/workflows/`) supply the intraday refreshes Hobby cron
  can't: the markets tape every 30 min during US market hours (`markets-tick.yml`)
  with an after-close full-symbol run (`markets-daily.yml`), and Kalshi odds every
  two hours (`kalshi-tick.yml`). All three just `curl` the same authenticated
  endpoints.

## Project structure

- `app/` — App Router pages (dashboard, bills, members, committees, races,
  primaries, hearings, reports, search, …) and the `app/api/**` routes, including
  the `/api/cron/*` tick handlers.
- `components/` — the Tailwind UI: terminal primitives, feed rows, the stage
  funnel/legend, race cards and maps, the markets tape, hearings views, report
  rendering.
- `lib/` — shared logic: `db.ts`, `queries.ts`, the sync/summarize pipeline, and
  per-source modules (`congress`, `fmp`, `markets`, `kalshi`, `polymarket`, `fec`,
  `race-ratings-*`, `primaries-sync`, `hearings`, `report-generation`, …).
- `scripts/` — standalone `tsx` CLI entry points: `migrate`, `sync`, `summarize`,
  the seed/backfill scripts, and the per-source syncs.
- `docs/handoffs/` — the chronological handoff prompts that drove each step of
  development, kept for posterity.
- `.claude/skills/cbt/` — `SKILL.md` with project context for Claude Code.

## Data & acknowledgments

- **Bills & actions** — [Congress.gov API v3](https://api.congress.gov), Library of
  Congress.
- **Summaries** — Google [Gemini 2.5 Flash](https://ai.google.dev/gemini-api/docs/models/gemini).
- **Markets tape** — [FMP](https://site.financialmodelingprep.com) (equity indices)
  and [FRED](https://fred.stlouisfed.org) (rates, commodities, VIX).
- **Prediction markets** — [Kalshi](https://kalshi.com) and
  [Polymarket](https://polymarket.com) for race and chamber-control odds.
- **Race ratings & candidates** — [Ballotpedia](https://ballotpedia.org) (which
  aggregates Cook, Sabato, and Inside Elections).
- **Fundraising** — the [FEC](https://www.fec.gov/data/) API.
- **Palestine scorecard** — the [USCPR](https://uscpr.org) congressional scorecard.
- **News** — RSS feeds from [Politico](https://www.politico.com),
  [The Hill](https://thehill.com), and [Roll Call](https://rollcall.com).

## CCBT

There's a sister project, **CCBT**, that does the same thing for the Colorado
statehouse — same stack, separate repo. It's not part of this codebase, just a
pointer.

## License

MIT — see [LICENSE](./LICENSE).
