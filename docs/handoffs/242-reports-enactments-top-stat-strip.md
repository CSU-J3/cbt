# HO 242 — Reports: enactments-top + index stat strip

Two changes to the weekly reports surface. Part A reorders the generated report; Part B surfaces per-week counts on the index. They share `lib/report-generation.ts` but are otherwise independent — Part A is self-contained and can land first.

---

## Part A — lead with what became law

### Resolved premises (verified 2026-06-13)

- The detail page is a **single `<ReportMarkdown content={report.contentMd} />` render.** Section order is not in the page — it's baked into the generated `content_md` by `assembleMarkdown` in `lib/report-generation.ts`. So a reorder is an `assembleMarkdown` push-order change **plus** the prompt's section-template order, which must move together (the LLM writes per-section commentary keyed to that template order; if only one moves, commentary maps to the wrong section).
- **Current order is deliberate**, per the assembly comment ("signal first: lead → news → what advanced → what became law → … stalls last"). Design is overturning it on purpose — lead with what became law.
- The "double-render" build flagged earlier is **two real fields**: the introductions *count* lives in the lead prose; the *Notable introductions* list is its own section. Leave both. This is not a dedupe.

### Change

Move the **Enactments** section to the top of the body — the first section below the lead.

- **⚠ Interpretation (confirm if wrong):** the spec says "ahead of the lead/news/stage-movement sections." Read as: the lead *prose* stays the opener (it's the synthesized throughline; a report opening with a bare list before its own thesis reads worse), and **Enactments becomes the first section below the lead**, ahead of Most talked about and Stage movements. The existing lead-prompt guidance already says "If three appropriations bills became law, that is the lead," so the lead already foregrounds enactments when they're the story — consistent. If you literally want the Enactments list above the title + lead, say so.
- New order: `# title` → lead → **Enactments** → Most talked about → Stage movements → Notable introductions → Topic breakdown.
- Update **both** the `assembleMarkdown` `lines.push` sequence **and** the section order in the prose-generation prompt template so they agree.
- Per-section zero-cases stay as they are (Enactments already emits `_No bills became law this week._`).

---

## Part B — index stat strip (LAWS · INTRO · MOVES)

### Resolved premises (verified 2026-06-13)

- Schema is `reports(slug, week_start, week_end, title, content_md, created_at)` — **no count columns.**
- The three counts are **computed at generation today** (`enactmentsCount`, `transitionsCount`, and the introductions count that goes into the lead) but **not persisted** as queryable fields. They live inside the `## Enactments (N)` / `## Stage movements (N)` header parentheticals and the lead prose.
- The index helper (`getReportsWithLead`) selects `content_md` and extracts a lead at read time. The strip needs the three counts queryable per row.
- **Clean route, decision of record: persist the three counts as columns at generation time.** Prose-parsing `content_md` is the fragile alternative — don't.

### Changes

1. **Migration** (`scripts/migrate.ts`): add three integer columns to `reports` (e.g. `laws_count`, `intro_count`, `moves_count` — match house naming). `ALTER TABLE … ADD COLUMN`, additive and non-destructive.

2. **Generation** (`lib/report-generation.ts`): the data assembly already computes these three values. Persist all three into the new columns in the `INSERT INTO reports …` (~line 893).

3. **Backfill.** Existing rows get NULL. The three counts are **LLM-free** — pure queries over `bills`/transitions for the report's `week_start..week_end`. Write a one-time `scripts/backfill-report-counts.ts` that, per existing report, recomputes the three from its week range **using the same data-assembly query functions the generation pipeline uses** (so the backfill can't drift from generation) and `UPDATE`s the row.
   - **⚠ Before the bulk UPDATE:** recompute for ~2 known reports and eyeball the results against their rendered `content_md` parentheticals (`## Enactments (N)`, `## Stage movements (N)`) to confirm parity. Then run the full UPDATE. Non-destructive (writing new NULL columns), but parity-check first so a wrong predicate doesn't get written across every row.

4. **Index helper** (`getReportsWithLead`, or whichever feeds index rows): add the three columns to the SELECT and the returned type.

5. **Render.** The index row gets a `LAWS · INTRO · MOVES` strip — mono, `--text-dim` labels, numbers in the row's normal text color. **Default placement: directly under the existing lead line** (consistent with the HO 153 under-title lead). A row with any NULL count hides the strip rather than rendering `—` (after the backfill, none should be NULL).
   - **Open (Design offered to mock):** placement under-title vs right-aligned on the row. Default is under-title; flag back if you want it mocked before it ships.

### Note on the HO 153 discipline

This adds fields, which brushes the HO 153 "don't add a field for a display concern" rule. Resolved: the three counts are report *data* (weekly enactment / transition / introduction tallies), not display state — a defensible exception, and Design ruled it of record.

---

## Constraints

No new tokens. Static. Named `git add`, eyeball before commit.

## Commits

Two clean commits, sequenced by plan mode: (1) Part A generation reorder; (2) Part B columns + backfill + index strip.
