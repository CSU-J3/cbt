# 42 — Seed docs/backlog.md

Stand up `docs/backlog.md` as a flat file for raw ideas that haven't sharpened into handoffs. Format is dumb on purpose: bullets with a sentence or two of context, nothing more. Entries graduate to numbered files in `docs/handoffs/` when the shape is clear enough to build.

## Task

Create `docs/backlog.md` with exactly this content:

```markdown
# Backlog

Raw ideas not yet ready for a handoff. Graduate entries to `docs/handoffs/` with a number when the shape sharpens.

- **Stage-change feed.** Bills that moved stage in the last 7 days. Turns the dashboard into something closer to legislative news. Likely a `/changes` route; mechanism TBD (stage history table vs. snapshot diff at sync time).
- **Substack data post.** Dashboard has enough surface area to support a piece pointing readers at specific bills. Hooks include total tracked, enacted count, presidential-desk count (once `/president` ships). Angle: what's actually moving in this Congress.
- **CCBT cross-project work.** Placeholder for tie-ins with the CCBT project. Shape TBD.
```

That's the whole file. Commit with a message like `docs: seed backlog`.

## Out of scope

- Don't add entries beyond these three.
- Don't structure further (no sections, no dates, no priority ordering).
- Don't link from `README.md` or `SKILL.md`. The file is a personal scratchpad, not a project artifact.
- Don't touch `docs/handoffs/41-president.md` or anything else in flight.
