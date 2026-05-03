# CBT — Cleanup Follow-ups (Topic Enum + Stage Validation)

Do follow-ups 1 and 2 in this order, then stop.

## 1. Topic enum additions

Add `government_operations`, `consumer_protection`, `social_security` to the topic enum in both `lib/summarize.ts` and `.claude/skills/cbt/SKILL.md`. Then re-summarize only the ~30 bills where the validator dropped exactly one of those three topics — find them by checking which bills currently have `["other"]` or are missing tags they should have. To keep this surgical, query for bills whose previous run logged a drop of one of those three terms (you may need to grep `cbt-backfill.log`), and clear `summary` on just those rows so the existing summarize script picks them up.

## 2. Stage validation

Add symmetric validation for `stage` in `lib/summarize.ts`: parse, check against the enum from the skill (`introduced | committee | floor | other_chamber | president | enacted`), fall back to `introduced` if invalid, log the drop. Re-summarize the 3 affected rows (the ones currently storing `agreed_to` or `agreed_to_senate`).

Don't move to Next.js yet. Report when both are done with a one-line summary of how many rows were re-touched and confirmation no new validator drops happened.
