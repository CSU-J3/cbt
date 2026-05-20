# 98 — SKILL.md sweep: lessons from HO 96 / 97 / 93.5

## What this is

Documentation-only handoff. Three handoffs this session (96 House West, 97 cron, 93.5 LA) had core premises that didn't survive pre-flight contact with the actual data or schema. The pattern is consistent enough to promote into SKILL.md as a load-bearing principle, plus several smaller items worth recording before the lessons fade.

You (Code) already added two SKILL.md sections in HO 97 (cron topology) and HO 93.5 (Ballotpedia nonpartisan variants). This handoff layers more on top — verify no duplication before applying.

## In scope

Six additions / edits to SKILL.md. No code changes.

1. Promote "API liveness mandatory pre-handoff" to a broader pre-flight principle
2. Document the `primary_candidates`, `primaries`, and `dashboard_state` schemas (currently undocumented in SKILL.md; my validation queries this session referenced columns that don't exist)
3. Add the Vercel `process.cwd()` read-only rule to "things to watch for"
4. Add the 2× cold-network tax observation as a planning datum for future cron timing
5. Add a "data source wins over legal reality" line to the scraping principles
6. Verify the cron topology + Ballotpedia nonpartisan sections from HO 97 / 93.5 are complete and current

## Out of scope

- Any code changes
- Updating the roadmap.md (separate concern)
- Documenting things you already added cleanly in HO 97 or 93.5 — verify, don't duplicate

## Item 1: pre-flight as a principle

Current SKILL.md (and project memory) has "API liveness is mandatory pre-handoff." Three handoffs this session show the principle is broader than API endpoints. Find that section and expand:

**Suggested text** (adapt as you see fit):

```markdown
### Pre-flight verification is mandatory

Before writing acceptance criteria, parser branches, runtime estimates, or any code that depends on an assumption about the world — verify the assumption against the actual artifact.

This is broader than API liveness. Examples from this project where pre-flight caught a wrong premise:

- **HO 96 (House West):** the handoff assumed CA top-two and AK top-four needed separate parser branches. Spot-checking CA-01, WA-03, and AK-AL on Ballotpedia showed all three render identical `race_header nonpartisan` voteboxes — the existing `parseCandidatesPage` already handled them via the `open` contest set. Zero parser work needed.
- **HO 97 (primaries cron):** the handoff proposed day-of-week dispatch (one region per weekday). Measuring West warm-cache at 152.9s showed every region exceeds the 60s Vercel ceiling on the `sleep(1000)` per district alone, before any fetch or DB work. Day-of-week was structurally non-viable. Replaced with a cursor model.
- **HO 93.5 (LA):** the handoff claimed Louisiana switched congressional races to closed partisan primaries in 2026 (legally true per state law). Fetching the LA House Ballotpedia pages showed they still render as nonpartisan voteboxes, probably due to the May 16 House suspension / reschedule. The data source's representation is what the scraper sees, not the legal reality.

Pre-flight covers: API endpoint liveness, third-party page structure, runtime cost estimates on the actual platform, schema column names (view the migration, don't recall from memory), and the data source's current representation of the thing being scraped.

When sources disagree — legal reality vs. data source, vendor docs vs. third-party articles, training memory vs. file system — the actual source of truth for the code being written is what wins. If the scraper reads Ballotpedia, Ballotpedia wins.
```

## Item 2: undocumented schemas

The bills + watchlist schema is in SKILL.md. The newer tables added by primary tracker work and HO 97 aren't. Add them in the same "Database schema" section, in the order they were introduced.

**Tables to document** (use `view migrations/` to get the actual column definitions — don't take my draft below as authoritative on names or types):

- `members` — added in HO 94 for the matcher refresh
- `primaries` — added in HO 91 (Senate primary tracker)
- `primary_candidates` — added in HO 91
- `dashboard_state` — key-value store; HO 97 added the `primaries_cron_cursor` key
- Any votes-related tables added in HO 87
- Any race-rating tables added in HO 84 / sync-race-ratings

For each table, document:

- Column names + types (lift from the migration)
- What HO introduced it
- Any non-obvious column semantics (e.g., `primary_id` format `house-LA-01-2026`, `dashboard_state` is a single-row-per-key store)

This unblocks future handoffs that need to write `SELECT` or `INSERT` against these tables without confabulating column names — which I did in HO 93.5's validation section.

## Item 3: Vercel `process.cwd()` read-only

Add to "Things to watch for" alongside the existing `revalidate` no-op note:

```markdown
- **Vercel serverless functions can't write to `process.cwd()`.** The filesystem is read-only outside `/tmp`. HO 97 caught this pre-deploy: the scraper's `writeCachedHtml` was writing the HTML cache to `process.cwd()`, which works fine locally but would have crashed every cron tick in production. The fix was to swallow write errors (cache is a perf optimization, not correctness). Any future code that writes to disk from an API route must either target `/tmp` or wrap the write in try/catch.
```

## Item 4: 2× cold-network tax

Add near the cron topology section or in "Things to watch for":

```markdown
- **Vercel function timing carries a ~2× cold-network tax vs. local measurements.** HO 97's primaries cron measured 5.5s for the calendar unit locally during pre-flight; the first prod tick came in at 10.3s. Plan headroom accordingly: a 31s local pre-flight measurement projects to ~60s in prod, which is the Hobby ceiling. The current SLICE_SIZE of 20 sits comfortably under that, but any future slice-size tuning should treat 30s of local time as the practical upper bound.
```

## Item 5: scraping principles

The Ballotpedia notes from HO 96 / 93.5 cover specific page-structure variants. Add one general principle near them:

```markdown
- **The data source's current representation wins over external reality.** Louisiana is legally on closed partisan primaries for federal races starting 2026, but Ballotpedia still renders LA House races as nonpartisan voteboxes. The scraper sees what Ballotpedia publishes, not what the law says. When research from web sources contradicts what the scraper target actually publishes, the scraper target is the source of truth.
```

## Item 6: verify HO 97 and 93.5 sections

You added a "Cron topology" section in HO 97 and expanded the Ballotpedia nonpartisan variants note in HO 93.5. Quickly verify both are current:

- **Cron topology:** four routes documented (`/api/sync`, `/api/sync-votes`, `/api/sync-race-ratings`, `/api/cron/primaries`), times accurate, cursor mechanics described, slicing math current. HO 97's commit message mentioned correcting a stale senate-slicing line — confirm that landed.
- **Ballotpedia nonpartisan variants:** the note should now cover (a) CA/WA/AK with `race_header nonpartisan` class + party in `image-candidate-thumbnail-wrapper`, and (b) LA with bare `race_header` class + party in `(R)/(D)` suffix after the candidate link. Both variants route through `parseCandidatesPage`'s `open` contest set. Verify both are described.

## Acceptance

- All six items either added to SKILL.md or verified already complete
- Migration files viewed for item 2 (no confabulated column names)
- Single commit: `docs: SKILL.md sweep — pre-flight principle + schemas + Vercel notes (HO 98)`
- `git diff` shows only `SKILL.md` changed

## Notes

- This handoff exists because three handoffs in a row had wrong premises that pre-flight caught. The principle was implicit; the goal here is to make it explicit so the next handoff (mine or anyone's) doesn't repeat the pattern.
- Item 2 (schemas) is the most load-bearing of the six. The other five are useful, but the schema gap is what made me confabulate `primary_candidates.state/chamber` and `dashboard_state.total_targets` in the HO 93.5 acceptance criteria. Future handoffs will keep doing the same thing until the schemas are documented.
- Keep the prose tight. SKILL.md is reference material, not a manifesto. If any item feels like it's bloating the doc, trim it.
