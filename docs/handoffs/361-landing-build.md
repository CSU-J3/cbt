# HO 361 — Landing page build (B1, landing arc)

Confirm next free number: `ls docs/handoffs/ | sort -V | tail`. Body assumes 361. (Replaces earlier 361 drafts — **changed: bill feed + markets tape are LIVE; the breaking strip is now a rotating flavor ticker.** See Decisions.)

Builds the approved split-layout landing. Mock is signed off. Last piece of the multi-user arc (A1 + A2 shipped).

## Precondition — confirm before building

Build from the committed mock at `docs/design/landing.html`. Confirm it's present and is the approved split version: `head -60 docs/design/landing.html` should show the two-column `.split` (44% / 56%), the `Congressional Terminal:\>` prompt, and the right-panel `.live` aside. If it's missing or doesn't match, stop — the approved mock has to be in the repo first.

## Decisions (resolved — don't re-open)

- **Routing: separate `/welcome` route + cookie redirect from `/`. No middleware.** A1 deliberately added none; don't reintroduce it. Mechanism:
  - `app/welcome/page.tsx` owns the landing (no masthead).
  - `app/page.tsx` (the terminal — already force-dynamic, already reads `auth()`): at the top, read `cookies()` for `ct_seen` and the session. If **no `ct_seen` cookie AND anonymous** → `redirect('/welcome')`. Otherwise render the terminal as today.
  - "Enter terminal" (client): set the cookie, then route to `/` — `document.cookie = "ct_seen=1; path=/; max-age=31536000; samesite=lax"; router.push('/')`. The cookie is load-bearing: without it `/` bounces the user straight back to `/welcome` (loop). Non-sensitive, client-set is fine.
  - "Sign in" (client): `signIn("github", { callbackUrl: "/" })`. Post-auth they have a session, so `/` renders the terminal — that path needs no cookie.
  - Net: first-touch anonymous sees the landing; "Enter terminal" or signing in both land on the terminal with no loop; returning (cookie or session) hits the terminal directly.

- **Feed shows LIVE bills.** The MOVERS list renders the real top movers. Reuse the existing movers query that backs the `/` dashboard feed — don't write a new one (grep lib/queries.ts; likely `getMovers`/`getMoverBills`). Top 7. Cached Turso read, global and cheap, same data the dashboard serves. Also live from existing queries (grep, reuse, don't recompute): the **MOVERS tab count** and the **three readout stats** (introduced total / became-law count + ratio / moved-7d).

- **Markets tape is LIVE.** Reuse the markets data layer that backs the dashboard b2 tape — the cron-populated equities/macro/odds source (grep lib/queries.ts; the HO 288–290 / 256–259 work, FMP `/stable/` + FRED + Kalshi/Polymarket). Do NOT re-probe sources or write new fetchers. **Graceful degrade is mandatory:** cached read, so on cron lag show last-known values, omit a symbol if its value is missing, and never error or block the `/welcome` render. Keep the mock's 8 symbols and the marquee / hover-pause / edge-mask CSS exactly; only the values are live.

- **BREAKING strip is a rotating flavor ticker.** Drop the mock's static funding-lapse copy (and any odds reference — no live data in this strip). Keep the red `BREAKING` tag and the strip's visual treatment exactly; the deadpan red tag over an absurd line is the joke. A client island cycles a pool of evergreen one-liners, ~8s each with a subtle fade. **prefers-reduced-motion → render one static random pick, no cycle.** Lines live in `lib/landing-flavor.ts` (starter pool below) so they're easy to extend. The tag stays `BREAKING`; if you ever want it to vary too (WIRE / DISPATCH / FROM THE HILL) that's a trivial later tweak.

- **Rows render in the mock's compact markup, NOT the live `BillRow` component.** The mock deliberately strips the watch star, the media-attention column, and the expand caret-action. Using `BillRow` would break the approved compact visual and put star→401→signIn + expand on a showcase. Real data, stripped presentation, no row interactivity. Chip colors come from `topic-colors.ts` (mock has them inline as `--tc:#hex`; if a hex differs, `topic-colors.ts` wins).

- **BREAKING tag stays red** (`--party-republican`). Hero stays **vertically centered** in the left column (the empty space above it is intentional).

## Build

- **Port the mock's CSS into a scoped stylesheet for the route (CSS module), referencing the existing global token variables.** Don't re-express the layout in Tailwind — the mock is pixel-specific (clamp, color-mix, mask gradients, keyframes) and translation will drift. Keep the class structure. Tokens already exist app-wide in globals, so **do not copy the mock's `:root` block** and **add no new tokens**. If a token the mock references is genuinely absent, flag it rather than redefining.
- `app/welcome/page.tsx`: server component. Reads the cached movers query, the count queries, and the markets source server-side; renders the split. Client islands: `components/LandingCTAs.tsx` (the two buttons) and `components/BreakingTicker.tsx` (the rotating flavor line). Cursor blink, live-dot blink, tape marquee are pure CSS — no JS.
- A presentational compact-row component fed the movers `FeedBill[]` (id / title / sponsor + party / stage + age / caret, no star/expand). If a field it needs isn't in the movers query's return, surface it rather than adding a second query.
- `lib/landing-flavor.ts` — starter pool (verbatim; extend freely later). Evergreen, no dates/numbers, process-flavored not partisan:
  ```ts
  export const BREAKING_FLAVOR = [
    "Reflecting pool reflects; Congress declines to",
    "Quorum call enters hour four; the gentleman remains unlocated",
    "CBO scores the bill; no one likes the number, everyone cites it",
    "Continuing resolution continues; 'temporary' doing heavy lifting again",
    "Vote-a-rama enters hour nine; senators voting on muscle memory",
    "Bill named for a thing it does not do advances to committee",
    "Parliamentarian consulted; ruling concerns germaneness, spiritually concerns despair",
    "Subcommittee achieves quorum, immediately recesses",
    "Cloture invoked; sixty people formally agree to keep arguing",
    "Conference committee convenes to reconcile two bills nobody read",
    "Recess declared, District Work Period begins; nobody's fooled",
    "Amendment ruled non-germane; was never, in its heart, trying to be",
    "Discharge petition gathers dust and, eventually, signatures",
    "Basement tunnel vending machine achieves sentience; jurisdiction unclear",
    "Ducks reclaim the reflecting pool; Architect of the Capitol notified",
  ];
  ```
- Carry the mock's `@media (prefers-reduced-motion:reduce)` (kills cursor / dot / marquee — and the BreakingTicker cycle) and `@media (max-width:860px)` (single column, panel drops below with `border-top`, left border off) exactly.
- `/welcome` metadata: export `title` "Congressional Terminal" and `description` = the subline, plus OG. Ensure the root layout `metadataBase` points at `https://congressional-terminal-chi-silk.vercel.app` (set if absent, fix if it's the old URL). The broader brand/URL rename (global title, README, manifest, `verify:deploy` host, in-app "CBT" strings) is a separate sweep — out of scope here.

## Verify

- `/welcome` renders the split: pitch left, live panel right with left border. Both columns reach all edges, no masthead bar.
- **Feed live:** the 7 rows are real current movers — cross-check ids against the `/` dashboard MOVERS list. Readout stats and MOVERS count match the real corpus. Tabs non-interactive; rows have no star/expand.
- **Tape live:** symbol values match the dashboard tape. Confirm graceful degrade — with stale/missing data the tape shows last-known or drops a symbol, and `/welcome` still renders (no error).
- **Breaking ticker:** cycles flavor lines (~8s, fade), red `BREAKING` tag intact; under `prefers-reduced-motion` it shows one static line and doesn't cycle.
- Cursor / dot / marquee run; under `prefers-reduced-motion` all stop.
- Reflow at < 860px: single column, panel below the pitch with a top border.
- Routing round-trip — all four paths, no loop: first-touch anonymous on `/` → `/welcome`; "Enter terminal" → `/` (no bounce-back); "Sign in" → GitHub → back to `/` authed; reload `/` with the cookie set → terminal directly.
- Chip colors match `topic-colors.ts`. Existing tokens only — grep the new CSS for stray hex or any new `--var`.
- `tsc` + build clean, named `git add`, push, `npm run verify:deploy` until served SHA === HEAD, then eyeball `/welcome` live.
