# Handoff 85 — Weekly report quality fixes + news wiring + backfill

## Context

One report exists (2026-05-04). Two sections have quality problems; one section is a placeholder that can now be wired. Fix all three before backfilling the four missing Mondays.

## Step 1 — Audit lib/report-generation.ts

Read the full file before touching anything. Identify:
1. Where the "dead in committee" query is — is it scoped to the week or corpus-wide?
2. Where the "topic breakdown" query/prompt is — what data does it pass to the LLM?
3. Where "most talked about" is — confirm it's a literal placeholder string
4. What the `npm run report YYYY-MM-DD` entrypoint looks like

Report the relevant code sections before making any changes.

## Step 2 — Fix "dead in committee"

The current section shows all stale bills in the corpus grouped by topic (4,205 government ops, etc.). That's not what a weekly report should say. It should show bills that **newly crossed the stale threshold this week** — i.e., bills whose `latest_action_date` fell outside the active window during the report's `week_end`.

Fix the query to scope by week:

```sql
SELECT b.topics, b.id, b.title, b.sponsor_name
FROM bills b
WHERE b.latest_action_date IS NOT NULL
  AND b.latest_action_date < date(?, '-30 days')   -- week_end param
  AND b.latest_action_date >= date(?, '-37 days')  -- one week prior
  AND b.stage NOT IN ('enacted', 'president')
  AND b.summary IS NOT NULL
ORDER BY b.latest_action_date ASC
```

This finds bills that crossed the 30-day threshold during the report week — newly stale, not all-time stale. If zero bills newly went stale, the section should say "No bills newly stalled this week" rather than pulling corpus counts.

Also fix the display: remove the parenthetical counts (those were the corpus totals). Show topic, then the 3 example bill IDs and titles.

If the current section heading is "Dead in committee," rename it to "Newly stalled" — more accurate.

## Step 3 — Fix "topic breakdown"

The section returned empty with fallback copy. Audit what data the report-generation code passes to the LLM for this section.

The fix depends on what the audit reveals. Most likely causes:
- The topic distribution query for the week returned no rows (the week window was too narrow)
- The LLM prompt didn't have enough data to work with

If the query is scoped to bills introduced that week only, widen it to bills updated (introduced or actioned) during the week. If the prompt is ambiguous, make it concrete: pass the top 5 topics by bill count for the week and ask the LLM to comment on what that mix signals.

Fallback copy ("No topic activity this week") should only fire if genuinely zero bills were active — not as a default when the LLM is uncertain.

## Step 4 — Wire "most talked about"

News signal is live. Replace the placeholder with real data.

The section should show the top 5 bills by news mention count in the report week:

```sql
SELECT b.id, b.title, b.sponsor_name, COUNT(nm.id) as mention_count
FROM news_mentions nm
JOIN bills b ON b.id = nm.bill_id
WHERE nm.published_at >= ?   -- week_start
  AND nm.published_at < ?    -- week_end
  AND nm.bill_id IS NOT NULL
GROUP BY nm.bill_id
ORDER BY mention_count DESC
LIMIT 5
```

If zero news mentions exist for the week, fall back to: `_No news mentions tracked for this week._`

Pass the results to the LLM as structured data and ask for 2-3 sentences of commentary on what got coverage and why it might matter. Keep the LLM prompt tight — this is a data annotation step, not a freeform essay.

## Step 5 — Minor: fix title truncation

The notable introductions section truncates bill titles mid-word ("Committee on Foreign Investment in t…"). Find the title length cap and either raise it to 120 chars or truncate at the last full word before the limit.

## Step 6 — Backfill missing reports

After all fixes are verified against a test run, generate the four missing Mondays:

```powershell
npm run report 2026-04-20
npm run report 2026-04-27
npm run report 2026-05-11
npm run report 2026-05-18
```

Run them one at a time and check each output before running the next. If a week has genuinely empty data (no introductions, no stage changes), that's fine — the report should reflect reality.

After backfill:
```sql
SELECT slug, title, created_at FROM reports ORDER BY created_at DESC;
-- expect 5 rows
```

## Step 7 — Verify report quality

Read the regenerated 2026-05-04 report (or any backfilled report) and confirm:
1. "Newly stalled" section shows week-scoped bills, not corpus counts
2. "Topic breakdown" has real data, not fallback copy
3. "Most talked about" shows actual news mentions or the clean fallback (not the placeholder)
4. Title truncation fixed in notable introductions
5. Report loads at `/reports/2026-05-04` in the browser

## Out of scope

- Redesigning the report format or adding new sections
- Automated rating pipeline for races
- Changing the cron schedule

## Acceptance criteria

1. All five report sections contain real data or clean fallbacks (no placeholder strings, no wrong-scoped queries)
2. Five reports in the `reports` table (original + four backfill)
3. `/reports` index page lists all five
4. Each report readable at `/reports/[slug]`
5. "Newly stalled" section scoped to the week, not the corpus
