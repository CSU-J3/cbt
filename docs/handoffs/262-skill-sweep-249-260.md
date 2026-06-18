# 262 — SKILL.md sweep (HO 249–260)

## What this is

Docs-only. Reconcile `SKILL.md` with everything shipped since the last sweep. HO 248 covered 236–243, HO 247 covered 244–246, so the unswept range is **249–260**. HO 261 was diagnostic-only (hearings probe), nothing to document. No code changes.

This runs before the hearings data layer (263) on purpose. 249–260 includes two external-data-source syncs — Polymarket (255–256) and the tape swap (250–251) — that are the same shape as the hearings sync, plus the deploy-verification flow (252) the hearings ship process should use. Getting `SKILL.md` current means 263 mirrors the right house pattern instead of the older committees one.

## How — Code-led, grep live, don't trust the handoffs as written

For each shipped handoff in 249–260, grep the live repo for what it actually changed and reconcile `SKILL.md` to reality. Handoffs describe intent; the code is truth. (HO 82's lesson: wrong component names, wrong hex values, and already-existing columns all turned up when the handoff text was checked against the code.) Skip any handoff carrying an ABANDONED banner. Report drift in chat as you find it.

Per handoff, reconcile whatever applies: tables / columns / indices, routes (pages + API/cron), components, query helpers, cache tags, cron slots, env vars, CLI scripts, design tokens.

## High-value targets (the reconciliations that matter for what's next)

- **External-data-sync pattern.** Polymarket (255–256) and the tape swap (250–251) are recent third-party syncs. Document the current house pattern: the probe→wire cadence, where the sync lives, cache-tag and cron-slot conventions, any shared third-party-fetch helper, and any new env vars (a Polymarket key?). This is the pattern the hearings sync (263) will mirror — state explicitly whether it supersedes the `lib/committees-sync.ts` shape or sits alongside it.
- **Deploy verification (252).** Document `npm run verify:deploy` and the `/api/version` SHA-match flow as the standard ship step, so every future handoff's ship process references it instead of re-explaining it.
- **Dashboard V2 (253–254, 257, 260).** Shell / header / tape, battlefield, V2 movers feed, rich race cards. Reconcile the current dashboard structure and component names — the hearings UI (later) will follow V2, so `SKILL.md` needs to reflect it.
- **Smaller items:** new-this-week tab (249), marquee scroll restore (258), poly macro signals (259). Reconcile where they live and what they touch.
- **Cron-slot map + cache-tag inventory.** After the above, make sure `SKILL.md`'s list of cron slots and cache tags is complete and matches `vercel.json` plus the code. 263 needs a free slot and will add a `meetings` tag, so this list has to be trustworthy.

## Secondary

Check `docs/backlog.md` OPEN LOOPS for anything in the 249–260 range that shipped and should move to DONE, or any open loop now stale.

## Out of scope

- Code changes of any kind.
- Sweeping 261 (diagnostic), 262 (this sweep), or 263 (not built yet).
- The hearings work itself.

## Acceptance

1. `SKILL.md` reflects the shipped state of 249–260, verified by live grep rather than handoff text. Drift found is reported in chat.
2. The external-data-sync section states the current house pattern and whether it supersedes or complements `lib/committees-sync.ts`.
3. Cron-slot map and cache-tag inventory in `SKILL.md` are complete and match the code.
4. `docs/backlog.md` OPEN LOOPS reconciled for the range.
5. Single commit: `docs: SKILL.md sweep (HO 249-260)`.
