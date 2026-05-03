# CBT — Step 2 Handoff Prompt

Step 2: add LLM summarization to CBT.

Read `.claude/skills/cbt/SKILL.md` first — the summarization prompt and JSON parsing logic are spelled out there.

Build:

1. A new module `lib/summarize.ts` that takes a bill row and returns `{summary, topics, stage}`. Use the Anthropic SDK with `claude-sonnet-4-5`.
2. Fetch the latest bill text via the Congress.gov `/text` endpoint, then fetch the `formattedText` URL of the most recent version. Truncate to 8,000 characters before sending to the LLM.
3. Also fetch the CRS summary from `/summaries` if available, pass it into the prompt as context.
4. A new script `scripts/summarize.ts` that finds rows where `summary IS NULL`, calls the summarizer, and writes back `summary`, `summary_model`, `summary_updated_at`, `topics`, `stage`. Process in batches of 5 with a small delay between batches to be polite to both APIs.
5. If the LLM response fails to parse, log the bill ID and skip — don't crash the run.
6. Run it against 20 bills first as a smoke test (add a `--limit 20` flag). Show me 5 sample outputs so I can sanity-check the summary quality before running on all 1,675.

Don't integrate with the sync script yet, and don't move toward Next.js. Just get summarization working as its own script.

I have an Anthropic API key ready.
