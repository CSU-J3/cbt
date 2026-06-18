# HO 247 — SKILL.md sweep: dashboard redesign arc (244–246)

Confirm the next free number before saving: `ls docs/handoffs/ | sort | tail`. Body assumes 247.

## What this is

Fold the 244–246 redesign arc into SKILL.md. **Reconcile against the LIVE SKILL.md only** — the `/mnt/project` copy this was scoped against is a fossil (pre-dashboard era; it doesn't know about races, markets, news, or the home redesign), so don't diff against it. Read the live file, find where each fact below belongs, edit surgically. Don't rewrite untouched sections (sync, Congress API, news, members).

Doc only — no code changes. If you find a spot where the CODE contradicts SKILL.md and the code looks wrong, flag it; don't fix it here.

Scope is 244–246. The last sweep (HO 235) covered through 234. If you notice SKILL.md is ALSO stale on 236–243 work (metro-zoom panels, the 10s DB timeout, the stage-monotonicity guard, the bills/`raw_json` split, etc.), flag it for a separate sweep — don't pull it into this one.

## As-shipped facts to reconcile (grouped by SKILL area)

### Dashboard layout / IA
- New structure, top to bottom: HEADER (masthead → markets tape → nav) → RACES full-width → WEEKLY BAND full-width (divider rule above) → TWO-COLUMN BODY (left ~56%: BREAKING box, then a tabbed DISTRIBUTIONS panel; right ~44%: the MOVERS / TOP STALLS feed). Replaces the prior layout (races in the right column, stage/topic as separate boxes, weekly + enacted banners above the grid).
- DELETED components — purge any reference: `EnactedBanner.tsx` (folded into the weekly band); `ReportSnapshot.tsx` (the inline snapshot, replaced by the weekly band — note the `getDashboardReportSnapshot` QUERY survives, `WeeklyBand` uses it); `ColorKeyStrip.tsx` / `StageKey` and `lib/color-key.ts` (the distributions merge dropped the legend/key row).
- Distributions are now ONE tabbed panel — tabs STAGE DISTRIBUTION | TOPIC DISTRIBUTION, fixed ~230px content height so the bars stay dense and the tab swap doesn't jump; the treemap redraws to the panel's actual w×h. Stage stays bars (committee ~91%, president 0 → a treemap is one blob plus slivers, rejected); topic stays squarified treemap.
- The WEEKLY BAND is a static metrics line — `WEEK OF … | ● n ENACTED · S n | n NEW BILLS | n STAGE TRANSITIONS | … | READ FULL →`, enacted folded in. Deltas / sparklines / hover popovers are NOT built (banked, partly data-blocked on `stage_transitions` accrual). IN GOV-OPS dropped (no honest trailing-7-day fit); event callouts omitted (`stage_transitions` thin).

### Design system
- Brand renamed **"Congress Terminal" → "Congressional Terminal"**, app-wide via `BreadcrumbMasthead` (every page).
- Masthead line 1 is a STAT READOUT (replaced the prose lead-in): `n bills tracked · n in committee · n on the floor · n other chamber · n enacted`. Color tokens: total = party-dem, committee = party-rep, floor = amber-bright, other chamber = stage-other, enacted = stage-enacted. Brand 20px mono, word-spacing −6px, the `:\ \ >` glyphs amber, blinking amber cursor desktop-only. Line 2 = `LAST SYNC h:mm ET`, 11px dim (no longer pinned far-right).
- **DO-NOT-RECONCILE note** — add this explicitly so a future pass doesn't "fix" it: COMMITTEE reads **red** in the masthead readout (party-rep token) but stays **cyan** as a bar in the distributions panel. Accepted mismatch.
- Type scale across the header: title 20 / readout + nav 14 / tape + sync 11.
- Competitive race cards are a responsive grid: 4-up ≥1200px, 2-up 700–1199px, 1-up <700px (balanced rows, no 3+1 wrap). Their HO 230 hover-popover confinement is keyed to the 2×2 by index; the ≥1200 single-row path overrides it in CSS (popover escapes the pane, opens downward, horizontal direction re-derived from `nth-child`). The 2-up / 1-up paths keep the original confinement.

### Schema / indexes
- New covering index: `idx_bills_introduced_date (introduced_date, is_ceremonial)`. Add to the index list.
- **Turso forced-index convention** — document if not already there: Turso is statless (no `ANALYZE`), so the planner won't pick a freshly-added index on its own — it kept choosing `idx_bills_is_ceremonial` until forced. `getNewBillsThisWeekCount` uses `INDEXED BY idx_bills_introduced_date` (safe because the query always constrains `introduced_date`). Result: 6838ms → 52ms cold. If a forced-index pattern is already documented from prior usage, just add this index + query to it rather than restating the convention.

### Query helpers / data
- `getNewBillsThisWeekCount` added (powers the weekly band's NEW BILLS count; uses the forced index above).
- `getDashboardLead()` is **orphaned** — the cron still generates the 3-sentence synthesis but nothing renders it after the masthead went stat-readout. Mark it deprecated-candidate (pending a design call on re-homing a glance one-liner vs retiring the generator). Don't remove it.
- **Count-predicate divergence** — document so it's not treated as a bug: the masthead readout total uses `getCorpusStats` (non-ceremonial, includes unsummarized, ~16,289) and its segment counts share that predicate via `getStageDistribution`; inner pages' "BILLS" count additionally gates `summary IS NOT NULL` (~15k). The ~1k gap is unsummarized bills. The dashboard↔inner divergence is owned by the queued masthead-coherence diagnostic, not a defect.

## Ship report

List the sections edited. Confirm the three deleted-component references are purged (`EnactedBanner`, `ReportSnapshot`, `ColorKeyStrip` / `color-key`). Confirm the two do-not-reconcile notes are in (committee red/cyan, count-predicate divergence) and the Turso forced-index convention covers the new index. Flag any in-scope drift you fixed beyond this list, and separately flag whether SKILL.md looks stale on 236–243 work (for a possible follow-up sweep). No code touched.
