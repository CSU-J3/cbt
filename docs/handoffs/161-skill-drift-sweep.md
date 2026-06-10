# HO 161 — SKILL.md drift sweep

## Why

SKILL.md is the file every handoff grounds against. When it drifts from the codebase, future handoffs start from false premises — this already bit us (the two-header model was 5 handoffs stale, surfacing as a bad assumption at HO 155). Several sections are visibly behind: the "only client islands are WatchlistToggle and StageFilter" claim predates HOs 147–154 (tooltip primitive, click-to-expand accordion, markets tape, BILLS|NEWS toggle, scatter), the pages list still describes `/sponsors` rather than the renamed `/members` and omits `/committees`, `/dashboard`, `/patterns`, `/reports`, and the schema block is missing tables added since (committees, cron_runs, markets, news, reports, races, etc. — the DB now has 25+ tables).

This is a reconciliation pass, not a rewrite. The goal is a SKILL.md that accurately describes what's actually shipped, in the existing voice and structure.

## Phase 1 — Drift report (HALT after)

Do not edit SKILL.md yet. Produce a **drift report**: every claim in SKILL.md that doesn't match the current codebase, with evidence and a proposed correction. No edits in this phase.

Work section by section through the live SKILL.md. For each, compare against ground truth in the codebase:

1. **Pages list + Frontend design system** — enumerate the actual routes under `app/` (every `page.tsx`). For each route SKILL.md describes, confirm it still exists under that path and matches the description. Flag: renamed routes (`/sponsors` → `/members`?), routes that exist in code but aren't in SKILL.md (`/dashboard`, `/committees`, `/committee/[code]`, `/patterns`, `/reports`, anything else), routes in SKILL.md that no longer exist or are now redirects (`/president` alias?).

2. **Client islands** — grep `app/` and `components/` for `"use client"`. List every client component that actually exists. Compare against SKILL.md's claim. Report the real set.

3. **Header model** — confirm the actual header components (`HomeHeader` for the dashboard, `HeaderBar` elsewhere?) and which routes use which. SKILL.md may describe a single shared `HeaderBar` that no longer reflects reality.

4. **Database schema** — run the table list against production (`SELECT name FROM sqlite_master WHERE type='table'`) or read the migration files in `scripts/`. List every table that exists but isn't in SKILL.md's schema block. Do NOT paste full schemas for all of them — just identify which tables are undocumented and where they came from (which HO added them, if traceable). We'll decide in Phase 2 how much detail SKILL.md should carry for each.

5. **Query helpers (`lib/queries.ts`)** — spot-check that the helpers SKILL.md documents still exist with the described signatures. Flag any that were renamed, removed, or whose contract changed. Flag major new helpers SKILL.md omits.

6. **Label maps location** — confirm SKILL.md correctly states where label maps live (`lib/enums.ts` for bill type/stage/race labels, `lib/topic-colors.ts` for topic labels). Earlier confusion had these in a nonexistent `lib/labels.ts`.

7. **Stage indicators, topic colors, color palette, typography, layout grid** — verify the documented tokens/values match `globals.css` and the relevant components. Flag drift in CSS var names, hex values, breakpoints, grid templates.

8. **Build order, sync logic, summarization prompt, Congress.gov API, env vars, "things to watch for"** — these are lower-risk (less likely to have changed) but skim them. Flag anything plainly false. Don't nitpick prose.

9. **Mobile** — SKILL.md predates the 15a mobile foundation (HOs 156–157: 700px/1024px breakpoints, mobile nav drawer, two-header collapse, markets tape hidden on mobile). Flag that the mobile behavior is undocumented and note what shipped, so Phase 2 can add a section.

Output format for the drift report — a flat list, one entry per drift:

```
[section] — [claim in SKILL.md] → [ground truth] → [proposed correction]
evidence: <file:line or query result>
```

**HALT. Post the drift report and wait for sign-off before any edits.**

## Phase 2 — Apply approved corrections (only after sign-off)

After I review the drift report and approve/trim it, apply only the approved corrections.

**Guardrails:**
- **Correct factual drift only. Do not rewrite for style.** If a section is accurate but plainly written, leave it exactly as-is. Preserve the existing voice (terse, opinionated, lowercase-friendly), structure, and section ordering.
- Don't add new sections beyond what the drift report approves (the mobile section is expected; anything else needs sign-off).
- Don't invent conventions. If the codebase does something SKILL.md doesn't mention, document what's *there* — don't prescribe what *should* be.
- Keep the schema block honest but not bloated. For undocumented tables, document the ones that matter for future handoffs (committees, cron_runs, reports, news, markets, members/races if they're query targets). A one-line purpose + key columns is enough; don't paste every column of every table.
- Match the existing markdown formatting (table style, code fences, heading levels).

## Verification

- Show a full diff of SKILL.md.
- Confirm no source files were touched (this handoff edits only SKILL.md).
- Re-read the edited SKILL.md top to bottom and confirm internal consistency (no section contradicting another, no dangling reference to a renamed route).
