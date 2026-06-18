# HO 241 — NEWS SIGNAL filter (ALL · BREAKING)

## Why

`/bills` NEWS mode has SOURCE and WINDOW filters but no way to scope to high-signal items. Add a SIGNAL row so a user can isolate breaking news, and mark qualifying rows inline so they're spottable without switching.

## Resolved premises (verified against live code, 2026-06-13 — don't re-derive)

- **No `?signal` param exists** anywhere in `app/bills`. This is a new param; sanitize it the way `source`/`window` are sanitized.
- **The NEWS filter stack is `source` + `window`** (`NEWS_DEFAULT_WINDOW`, `sanitizeWindowHours`). The SIGNAL row sits directly below WINDOW.
- **The breaking predicate already exists and is reusable.** `getBreakingNews` filters `match_confidence >= NEWS_CONFIDENCE_FLOOR` (0.7, imported from `report-generation`) and drops NULL-confidence rows. Its time window is a passed argument (`published_at >= datetime('now','-' || ? || ' hours')`).
- **⚠ Window is 72h, not 48h — and this matters.** The design spec said "fixed 48h." But the app calls 72h "breaking" everywhere: `NEWS_DEFAULT_WINDOW = 72`, `BreakingNewsBlock.WINDOW_HOURS = 72`, and both `getBreakingNews*` home callers default `hours = 72`. A 48h SIGNAL chip would make this filter disagree with the dashboard BREAKING block on the same word. **Use 72h here** so "breaking" means one thing app-wide. Do not introduce 48h, and do not change the dashboard's 72h — aligning the whole app to 48h is a separate, out-of-scope dashboard change.

## Changes

1. **SIGNAL filter row** below WINDOW: two chips, `ALL` · `BREAKING`, same chip style as SOURCE/WINDOW, `ALL` default. Param `?signal=breaking`; omit the param when `ALL`.

2. **Predicate.** When `signal=breaking`, AND these onto the existing NEWS query: `match_confidence >= NEWS_CONFIDENCE_FLOOR` and `published_at >= datetime('now','-72 hours')`. Reuse `NEWS_CONFIDENCE_FLOOR`; reuse the 72h constant the home breaking callers already use (`NEWS_DEFAULT_WINDOW`) rather than a fresh literal.
   - **Window interaction (resolve explicitly, don't guess):** the breaking window (72h) is a fixed constant, *not* driven by the WINDOW chip — that's what the spec means by "independent of WINDOW." But the WINDOW chip still applies and can tighten the set (it ANDs in). So the effective window when BREAKING is selected is `min(WINDOW, 72h)`, with confidence ≥ 0.7 always. WINDOW=24h → breaking items from the last 24h; WINDOW=7d → breaking items from the last 72h (the 72h ceiling wins, being tighter than 7d). SIGNAL also stacks AND with SOURCE and TOPIC.

3. **Inline treatment on qualifying NEWS rows, in BOTH `ALL` and `BREAKING` states:**
   - 3px `--accent-amber` left rail. Compensate left padding so the headline doesn't shift relative to non-qualifying rows.
   - A `BREAKING` pill prefixing the headline inside the headline cell: mono ~8px, `--accent-amber-bright` text, 1px `--accent-amber` border. Sits before the headline text without pushing its truncation.
   - In `ALL`: qualifying rows wear rail + pill inline (spottable without switching modes). In `BREAKING`: the feed filters to only qualifying rows.
   - "Qualifying" = the row meets the breaking predicate (conf ≥ 0.7 AND within 72h), evaluated per row. **Confirm `match_confidence` and `published_at` are on the NEWS row shape** the feed renders; if not, add them to the SELECT so the per-row flag can be computed in `ALL` (where the query isn't filtered to breaking).

4. **BREAKING chip count** = size of the breaking set within the current SOURCE/WINDOW/TOPIC scope. `--text-dim`, amber when the chip is active.

## Constraints

Desktop. Static. No new tokens — the rail and pill reuse the existing amber accents. Named `git add`, eyeball before commit.

## Commit

One commit, e.g. `feat(bills): NEWS SIGNAL filter — ALL/BREAKING chips, amber rail + pill, ?signal param`.
