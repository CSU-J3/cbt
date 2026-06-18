# HO 248 — SKILL.md sweep: 236–243 (verify-then-document)

Confirm the next free number before saving: `ls docs/handoffs/ | sort | tail`. Body assumes 248.

## What this is

Close the 236–243 gap in SKILL.md that HO 247 surfaced. Same reconcile-against-LIVE rule as 247 — the `/mnt/project` SKILL.md is a fossil, ignore it.

**Difference from 247:** for that sweep there were ship reports, so the handoff carried as-shipped facts. For 236–243 there are none — only the handoff intents and the flags from 247. So this is a **verify-then-document** sweep: for each item, confirm what actually shipped by grepping the live code FIRST, then reconcile SKILL.md to the code, not to the handoff. Handoffs deviate, no-op, or half-ship (215/216 closed as no-ops; the `raw_json` split below is the live suspect). Document the world the code describes.

Doc only — no `.ts`/`.tsx`/`.css` changes. If verification turns up a code/doc mismatch where the CODE looks wrong (a half-shipped feature, a guard that doesn't fire), flag it for a follow-up; don't fix it here.

## First — commit the pending 247 sweep

There's an uncommitted SKILL.md in the working tree from HO 247 (the 244–246 reconciliation, never committed). Before starting this sweep: confirm the pending SKILL.md diff IS the 247 work and nothing else, then commit it under its own message — `docs: SKILL sweep for the 244–246 redesign arc (HO 247)` — so 247 and 248 stay distinct commits instead of 248 absorbing 247's changes. If the pending diff is NOT cleanly the 247 sweep, stop and report; don't commit something unexpected. Then do the 248 work below and commit it separately.

## The checklist (each item: verify first, then document)

**HO 236 / 237 — metro-zoom panels + leader-lines.** SKILL.md (~line 799 in the 247 read) still calls metro-zoom "deferred / not yet acted on." The HO 240 ledger says it shipped (CD06 Sacramento rendering ~16px in a valley metro panel, a 2-panel cap). Verify in the district-map code: per-state metro config, subset-render at its own `fitSize`, the 2-panel cap, and the 237 leader-lines. Then replace the "deferred" line with what shipped.

**HO 238 — db-timeout-fastfail.** Partially in SKILL.md already (the 10s `DB_REQUEST_TIMEOUT_MS` is referenced in the forced-index box). Verify the mechanism in code (the timeout wrapper + any retry) and give it a proper home in the caching/perf section, not just the passing mention.

**HO 239 — stage-monotonicity guard.** Live in `lib/summarize-runner.ts` + `lib/summarize.ts` (two prompt guards) per the 247 flag, absent from the schema and summarization-prompt sections. Read both guards and document the rule precisely (what backward transition they refuse, where). Land it where the stage / `previous_stage` / `stage_changed_at` semantics are documented.

**HO 240 — open-loops ledger.** Doc-only handoff (created the `docs/backlog.md` OPEN LOOPS section). Likely no SKILL.md change needed; if SKILL.md describes the docs/process layout, a one-line note that OPEN LOOPS is the canonical home for open threads is enough. Don't manufacture more.

**HO 241 — bills / `raw_json` split. THE ONE THAT'S NOT A DOC FIX.** A handoff exists (`241-bills-rawjson-split.md`, the committed slot-241 doc) but the live schema still shows `raw_json` inline on `bills` and `migrate.ts` has it inline. Before documenting anything: **did the split ship?** Grep the live schema, `migrate.ts`, and the bills queries.
- Did NOT ship → SKILL.md is already correct (raw_json inline). Report 241 as unrun/no-op, leave the schema as-is, note it as a dropped handoff. Do NOT document a split that isn't there.
- DID ship (separate table, lazy-loaded `raw_json`, etc.) → document the actual shape and fix the schema block.

Report the verdict explicitly either way.

**HO 242 — reports/enactments top-stat-strip.** The `/reports` SKILL entry predates it. Verify the stat strip on `/reports` (what stats, where) and update the entry.

**HO 243 — trends-calendar-timeline.** The `/trends` SKILL entry predates it. Verify the calendar/timeline view on `/trends` and update the entry. While there, confirm `/trends` being `force-dynamic` (to dodge the build-time prerender timeout) is documented.

## Ship report

A per-handoff verdict line (236–243): shipped / no-op / partial, and what SKILL.md now says for each. Call out the `raw_json` split resolution explicitly — shipped-and-documented, or unrun-and-left-alone. List any code-state surprises you're flagging for follow-up rather than fixing. No code touched.
