# CBT — Smoke Test Fixes

Yes, do both fixes:

1. Throttle: `BATCH_SIZE=1`, `BATCH_DELAY_MS=13000`. The full backfill running overnight is fine.
2. Add `financial_services` to the topic enum in both `lib/summarize.ts` and the skill at `.claude/skills/cbt/SKILL.md`. Also add a validation step: parse topics, drop any not in the allowed list, fall back to `["other"]` if all are dropped, and log invalid topics to stdout so I can spot patterns.

Then redrive the 12 failed bills and show me 5 more samples (different bill types if possible — try to include at least one resolution and one Senate bill alongside the House bills). I want to see the spread before greenlighting the full 1,675 run.
