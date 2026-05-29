# 155 — Unify expand state (`useExpandState` hook, `persist` flag)

## What this is

The feed (HO 148) and the members list (HO 152) both ship the single-open click-to-expand accordion, but they carry the open-row state two different ways. One uses URL state (`?open=` / `?expanded=`), the other holds it in client state. That's two divergent state machines doing the same job, which is a maintenance trap and reads like a bug to a future session.

This handoff extracts one shared hook, `useExpandState`, that both lists consume. The hook takes a `persist: 'url' | 'client'` flag. **Members stays URL-driven, feed goes client-driven** — and that split is deliberate, not an accident to be smoothed away.

The reasoning, so Phase 1 doesn't try to "fix" the asymmetry: a member page is a destination you link to. "Here's this rep's record with the voting panel open" is shareable content, so deep-linkable expand state earns its keep. The feed is a browse surface — nobody deep-links "the feed but row 4471 is open," and URL-syncing it just pollutes browser history with states no one navigates back to. Same idiom, different jobs. The hook makes the difference a one-line `persist` prop instead of two implementations, so flipping the feed to URL later (or vice versa) is a single-character change.

## Phase 1 — Diagnostic (HALT for sign-off)

Read real artifacts, post findings, stop. No implementation.

### A. Current expand state, both surfaces

Read the feed list component (`BillRowList` per HO 148/152's notes) and the members list (`MemberRowList` if HO 152 extracted one, or whatever shipped). For each, report:

- **Where the open-row state lives today.** URL param (which one — `?open=`, `?expanded=`?) or client state (`useState` in the list component)?
- **The exact mechanism.** If URL: which component reads/writes it, does it use `router.push` or `replace`, does it preserve other params, does back-button collapse? If client: where the `useState` sits and how single-open is enforced.
- **HO 148's `?open=` disposition.** HO 148 left URL sync as a Phase 1 decision (in or deferred). Report what actually shipped — did the feed get `?open=` or is it already client-only? This determines whether Phase 2 changes the feed at all or just refactors it behind the hook.
- **HO 152's state location.** HO 152 noted the single-open machine in `BillRowList` "might extract to a shared hook" or need a parallel `MemberRowList`. Report which path shipped.

**This is the load-bearing finding.** If the feed already runs on client state and members already runs on URL, Phase 2 is a pure refactor (extract the hook, no behavior change). If either differs from the target, Phase 2 also flips its behavior. Say which.

### B. Param-name reconciliation

The two surfaces may use different URL param names (`?open=` vs `?expanded=`). The feed is going client-only, so its param (if any) gets removed. Members keeps a URL param — confirm its name and that it doesn't collide with any members-page param (chamber, party, state, metric toggle, search, page). If members currently uses a name that reads oddly for the new world, this is the moment to settle on one canonical name (`?expanded=<id>` is my lean — it's already what SKILL.md line 254 documents for the feed's older behavior, so it's the established vocabulary).

### C. Hook shape proposal

Propose the `useExpandState` signature. Target shape:

```ts
function useExpandState(opts: {
  persist: 'url' | 'client';
  param?: string;        // URL param name when persist === 'url', e.g. 'expanded'
}): {
  openId: string | null;
  toggle: (id: string) => void;
  isOpen: (id: string) => boolean;
};
```

- `persist: 'client'` → backed by `useState`, single-open, no URL touch.
- `persist: 'url'` → reads `useSearchParams().get(param)`, writes via `router` (report whether `push` or `replace` — `push` if back-button-collapses is wanted, `replace` if not; recommend one), single-open, preserves all other params on write.
- Both enforce single-open identically (toggling an open row closes it; opening a new one replaces the current).

Confirm both lists can consume this without other structural changes. If a list does anything the hook can't express (e.g. the members list needs the open ID for something beyond rendering the panel), flag it.

### D. Consumer audit

```
grep -rn "open\|expanded" components/ app/ --include="*.tsx" | grep -i "useState\|searchParams\|router.push\|router.replace"
```

Find every place that reads or writes expand state today. Confirm only the two lists are in scope. The HO 132.1 bubble drawer (`?topic=`) is a different mechanism (slide-out, not inline accordion) and is out of scope — confirm it's untouched. Any other surface rendering an expandable row (stale, watchlist, changes) inherits the feed's hook config; confirm which lists those use.

### E. Report format

1. Current state of both surfaces (param name or client state, exact mechanism, back-button behavior).
2. What HO 148 / HO 152 actually shipped for expand state.
3. Whether Phase 2 is pure-refactor or also flips behavior on either surface, and which.
4. Param-name reconciliation recommendation.
5. Hook signature + `push`-vs-`replace` recommendation for the URL mode.
6. Consumer list confirming scope (two lists in, drawer out, stale/watchlist/changes mapped to a config).

### HALT. Wait for sign-off.

## Phase 2 — Implementation (after sign-off)

Shape follows Phase 1. General target:

### The hook (`hooks/useExpandState.ts` or `lib/hooks/`)

Per Phase 1's signature. Single-open enforced in one place. The two modes share the toggle/isOpen contract; only the backing store differs.

### Feed → `persist: 'client'`

The feed list calls `useExpandState({ persist: 'client' })`. Drop the `?open=`/`?expanded=` URL param from the feed if it shipped one (and remove its read from any child component). Single-open behavior unchanged from the user's view; only the persistence layer moves off the URL.

### Members → `persist: 'url', param: '<canonical>'`

The members list calls `useExpandState({ persist: 'url', param: 'expanded' })` (or whatever Phase 1 settles). Behavior unchanged — deep-linkable, back-button-aware per the recommended `push`/`replace` call. This is the surface that keeps URL state on purpose.

### Stale / watchlist / changes

Whatever these consume per Phase 1's mapping — they follow the feed's client config unless Phase 1 found a reason one should be URL-driven (it shouldn't; same browse-surface logic).

## Out of scope

- The HO 132.1 bubble drawer (`?topic=`). Different mechanism, untouched.
- Any change to what the expanded panels *render*. This is purely the open-state machine.
- Mobile touch behavior. Still deferred to the #15 mobile pass.
- New tokens or motion.

## Acceptance

1. Phase 1 report posted; param-name and `push`/`replace` calls signed off before Phase 2.
2. One `useExpandState` hook; both lists consume it; no duplicate single-open logic remains.
3. Feed runs on `persist: 'client'` — no expand param in the feed URL.
4. Members runs on `persist: 'url'` — deep-linkable, behavior unchanged.
5. Single-open enforced identically on both.
6. Bubble drawer and all other surfaces unaffected.
7. `npm run typecheck` and `npm run build` clean.
8. `SKILL.md` updated with the expand-state rule (see below).
9. Single commit: `refactor: unify expand state via useExpandState (HO 155)`.

## SKILL.md rule to add

Under the inline-expand section (near line 254), add:

> **Expand-state persistence.** Open-row state for the single-open accordion is handled by `useExpandState({ persist })`. Use `persist: 'url'` where the expanded view is shareable (member pages — deep-linking a member with a panel open is meaningful content) and `persist: 'client'` where expansion is transient browsing (feed, stale, watchlist, changes — nobody deep-links an open feed row, and URL-syncing it just litters history). This asymmetry is intentional; both modes share one hook, so flipping a surface is a one-line `persist` change, not a rewrite.

## Notes

- **Why this isn't "make them consistent."** The instinct on seeing two state machines is to unify them into one behavior. The right unification is one *hook*, not one *behavior* — the surfaces answer different questions, so forcing both onto URL (history pollution on the feed) or both onto client (loses members' shareability) makes one of them worse. The hook gives the code consistency the maintenance worry wants, while the `persist` flag preserves the behavioral difference the product wants.
- **This is reversible by design.** If the feed ever wants deep-linkable rows, flip its call to `persist: 'url'` and pass a param. The hook already handles it. That's the entire payoff of extracting it.
- **HO 152 already gestured at this.** Its notes flagged that `BillRowList`'s single-open state "might extract to a shared hook." This handoff is that extraction, generalized with the persist flag so it serves both the URL and client cases.
