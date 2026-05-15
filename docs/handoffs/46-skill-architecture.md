# 46 — Port architecture pattern into SKILL.md

## Context

`docs/roadmap.md` now has a stable architecture pattern called "snapshot → hub → focused sub-pages" that defines how pages are layered for any entity in the dashboard. It's been load-bearing through several scoping conversations (member depth split from races, badges UI placement, bill hub thesis) and earned its way into being a long-lived rule rather than a roadmap entry.

Time to move it into `SKILL.md` so future feature work picks it up automatically without re-litigating.

## What to do

Add a new top-level section to `SKILL.md` titled **"Information architecture"**, placed between the existing "Frontend design system" section and "Environment variables" section.

Match SKILL.md's existing style: terse, rule-focused, no marketing language, no emojis, plain markdown. Reference docs not prose essays.

### Content to add

```markdown
## Information architecture

Three depth levels for any entity in the dashboard (bills, members, races):

1. **Snapshot.** The row dropdown on a list page. Few fields, fast read. Answers "is this interesting enough to look deeper."
2. **Hub.** The entity detail page (`/bill/[id]`, `/sponsors/[bioguideId]`, `/race/[id]`). Holds the thesis for that entity. Links out to focused sub-pages rather than embedding everything.
3. **Sub-page.** One topic about the entity, treated deeply. News mentions scoped to a bill, race detail for a member, similar-bills cluster, vote breakdown.

The hub holds the thesis. Sub-pages hold focused deep cuts. Curiosity drives navigation, not scrolling.

### Working theses

- **Bill hub** (`/bill/[id]`): "What does this bill do and how is it moving?" Summary, status, sponsor link, watchlist toggle. Sub-page links for similar bills, news mentions, votes, full text (out to congress.gov).
- **Member hub** (`/sponsors/[bioguideId]`): "What does this person work on in Congress?" Voting record, sponsored bills, committee assignments, badges. Header indicators link to the race surface when applicable; donor and stock data live on sub-pages.
- **Race hub** (`/race/[id]`, planned): "Who's contesting this seat and where does it stand?" Rating, seat-up year, candidate roster, incumbent link back to their member hub.

### The rule

For any new feature involving an entity page, decide whether it adds a snapshot field, a hub element, or a sub-page link. Don't invent a fourth bucket. If the answer is "it deserves its own section on the hub," that section probably wants to be a sub-page link instead.

Decide the hub's thesis before the second sub-page link ships, or the hub turns into the sub-page it's supposed to link to.
```

## Acceptance criteria

- New section exists in `SKILL.md` between "Frontend design system" and "Environment variables"
- Section matches the content above verbatim, with only formatting adjustments needed to fit SKILL.md conventions (heading levels, code fence styles, etc.)
- No changes to any other part of SKILL.md
- Commit message: `Add information architecture section to SKILL.md`

## What not to do

- Don't expand the section with extra examples beyond what's listed
- Don't soften any of the directive lines ("Don't invent a fourth bucket", "Curiosity drives navigation, not scrolling", the thesis-before-second-link rule). These are rules, not suggestions.
- Don't add a TOC or other meta-structure
- Don't remove or modify any existing SKILL.md content
- Don't touch `docs/roadmap.md` in this handoff. The roadmap will be updated separately to point at SKILL.md as the canonical home for this rule.
