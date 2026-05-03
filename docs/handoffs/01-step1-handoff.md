# CBT — Step 1 Handoff Prompt

I'm starting CBT, a personal Congress bill tracking dashboard. There's a skill at `.claude/skills/cbt/SKILL.md` with the full project context — read it first.

For this session, build step 1 only: a standalone Node/TypeScript sync script that fetches bills updated in the last 24 hours from the Congress.gov API v3 and writes them to a Turso database. No Next.js yet, no LLM summarization yet, just the data pipeline.

Specifically:

1. Set up the project (`package.json`, `tsconfig.json`, `.env.example`, `.gitignore`). Use `pnpm` and `tsx` for running TypeScript directly.
2. Create the `bills` and `watchlist` tables in Turso per the schema in the skill. Write a `scripts/migrate.ts` that runs the schema.
3. Write `scripts/sync.ts` that reads `MAX(update_date)` from `bills`, fetches updated bills from Congress.gov, paginates through results, and upserts into Turso. Follow the sync logic in the skill.
4. Skip the summarization step for now — leave `summary` NULL on insert.
5. Run it end-to-end against my real Turso instance and confirm rows land in the database.

I have my Congress.gov API key and Turso credentials ready. Ask me for them when you need them in `.env`.

Don't move on to step 2 (LLM summarization) in this session. I want to verify the sync works cleanly first.
