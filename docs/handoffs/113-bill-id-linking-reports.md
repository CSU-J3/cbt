# 113 — Bill-ID linking in rendered reports

## What this is

Fourth and final fix handoff from the HO 109 audit. Bill IDs cited in report prose are inert plain text — a typical report cites 40+ IDs, none of which link anywhere. Every reference is a dead end, which is the opposite of a sense-making tool you can drill into.

Audit rated this small scope, independent of any other fix. Touches `components/ReportMarkdown.tsx` only.

## In scope

Convert bare bill IDs in rendered report markdown into links to `/bill/[id]`.

### Bill ID regex

Bill IDs in prose follow these patterns:

- `HR 2702` / `H.R. 2702` (House bills)
- `S 4465` / `S. 4465` (Senate bills)
- `HJRES 140` / `H.J.Res. 140` (House joint resolution)
- `SJRES 12` / `S.J.Res. 12` (Senate joint resolution)
- `HCONRES 7` / `H.Con.Res. 7` (House concurrent resolution)
- `SCONRES 5` / `S.Con.Res. 5` (Senate concurrent resolution)
- `HRES 1263` / `H.Res. 1263` (House simple resolution)
- `SRES 89` / `S.Res. 89` (Senate simple resolution)

Capture the type and number. Normalize to lowercase hyphenated form for the URL — `HR 2702` → `119-hr-2702` (the `id` PRIMARY KEY format from the SKILL schema). Congress number comes from `getCurrentCongress()` since the corpus is current-Congress-only.

Look at the actual reports for which casing variations the LLM uses. The prompt context controls this. The regex should match whichever forms actually appear, not the maximal set above.

### Implementation approach

Two viable paths, pick whichever fits the existing `ReportMarkdown.tsx` shape:

- **Pre-render substitution.** Before passing markdown to the renderer, regex-replace bare bill IDs with markdown link syntax: `HR 2702` → `[HR 2702](/bill/119-hr-2702)`. Simple, no plugin dependency. Risk: regex must avoid matching inside existing markdown link syntax (`[...](...)`).
- **Remark plugin.** If `react-markdown` (or whatever renderer is in use) supports remark/rehype plugins, write a small plugin that walks text nodes and wraps matches in link nodes. Cleaner, no double-link risk, slightly more code.

Pre-render substitution is the recommended default unless the existing component already uses remark plugins.

### Edge cases

- **Already-linked text.** If a bill ID is already inside `[...](...)` syntax (the LLM occasionally writes links spontaneously), don't double-wrap. Negative lookbehind or pass-substitution with sentinel placeholders solves this.
- **Bills not in the DB.** Every cited bill in a weekly report should exist in the bills table since the report draws from it, but bad data can produce 404s on click. Link blindly — pre-validating every ID against the DB is overkill for a section that's already cleaned up the data layer.
- **Plural / possessive forms.** `HR 2702's` and `HR 2702s` should still link to the bare ID, leaving the suffix outside the link. Regex word boundary handles this if written carefully.
- **Other ID-shaped strings.** Phone numbers, dates, anything else that pattern-matches by accident. Restrict the regex anchor characters (require whitespace or punctuation before, require word boundary after). Don't get clever beyond that — false positives in this regex aren't catastrophic, they just produce broken-link clicks.

## Out of scope

- Linking from `/news` or anywhere else outside reports (HO 113 is reports-only)
- Hover previews / tooltips on linked IDs (separate UX handoff if wanted later)
- Linking sponsor names to `/sponsors/[bioguideId]` (different surface, different normalization, file separately)
- Any prompt or generation-side changes (HO 110/111/112 territory)
- Backfilling links into the 5 historical reports — they already render through the same component, so they get the linking behavior for free without regeneration

## Verification

1. `npm run dev`, visit `/reports/2026-05-11` (or any historical report with substantial bill citations). Spot-check 5+ IDs throughout the prose — each renders as a clickable link, each navigates to the correct `/bill/[id]` page.
2. Check sections that already use markdown lists with bill IDs — the "Newly stalled" section, enactments, stage movements. IDs in lists should link too.
3. Confirm no double-linking. If the LLM ever wrote `[HR 2702](/bill/119-hr-2702)` itself in the markdown, the output shouldn't become `[[HR 2702](/bill/119-hr-2702)](/bill/119-hr-2702)`.
4. Confirm plural/possessive forms link cleanly (`HR 2702's` → just the ID is linked, the `'s` is outside).

## Acceptance

1. `ReportMarkdown.tsx` either pre-substitutes or uses a plugin to convert bare bill IDs to links.
2. URL normalization matches the bills table `id` format (`119-hr-2702`).
3. Edge cases handled (already-linked, plural, false positives).
4. Manual spot-check on at least 2 historical reports across desktop and mobile widths — links clickable, no layout regressions (link styling shouldn't break the report's monospace prose density).
5. SKILL.md gets a one-liner under report rendering: bill IDs auto-link.
6. Commit: `feat: bill-ID auto-linking in rendered reports (HO 113)`.
7. Working tree clean, push.

## Notes

- Link styling matters here. Reports are dense prose; 40+ blue underlined links per report destroys readability. The existing terminal-aesthetic conventions probably want amber-accent on hover, no underline at rest, or similar — match whatever's in use on `/bill/[id]` and the feed. Don't introduce a new link treatment.
- This closes the HO 109 audit sequence. After this lands, weekly reports theme is at or very near 95%. HO 112.1 (the iteration on the LEAD's banned-phrase compliance) is the carry that may want a real cost discussion before scoping — model bump vs. thinkingBudget vs. accepting the residual.
