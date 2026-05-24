# 127 — Quick-watch-from-feed star

## What this is

The watch toggle currently lives only on `/bill/[id]`. To watch a bill, you have to click into the detail page first. HO 125 deferred adding a row-level star "if you want it later." This closes that deferral.

Single change: a star toggle on the BillRow component and its compact variant, wired into the existing watchlist mechanism.

Single-layer (UI + state wiring against an existing endpoint). No new schema, no new data layer. The watchlist endpoint and storage already work; this just adds another surface that calls them.

Prior art:
- HO 14 — original watchlist functionality
- HO 125 — BillRow redesign that deferred this star

## In scope

- New `WatchStar` component that:
  - Renders ☆ (not watched) or ★ (watched)
  - Amber accent when filled
  - Click toggles via the existing watchlist mechanism
  - Optimistic state update with server-confirmed sync
  - HO 123 tooltip via `title`: "Watch this bill" or "Watching"
- Integration in BillRow full variant: star in a small right-edge slot, alongside or above the View Detail link
- Integration in BillRow compact variant (ActivityTicker): smaller star at the right edge; no View Detail since it's already dropped in compact
- Reuse the existing endpoint or server action that `/bill/[id]` already uses; no new server work

## Out of scope

- The `/watchlist` management page (already exists)
- Per-user identity changes
- New schema or storage
- Star animations beyond a clean state swap
- Bulk watch operations

## Implementation

### Step 1 — Read existing mechanism

Before coding, locate the existing watch toggle on `/bill/[id]` (~line 99 per HO 125 audit). Identify:
- The endpoint or server action it calls
- The identifier shape (bill ID, any user key, cookie name)
- The watch-state read path (how the page knows a bill is currently watched)

Extract the toggle into a reusable hook (`useWatchToggle(billId)` or similar) if it isn't one already. Both the detail page and the new row star should use the same hook so state stays in sync.

### Step 2 — WatchStar component

New `components/WatchStar.tsx`:

```tsx
type Props = {
  billId: string;
  size?: 'sm' | 'md'; // 'md' is default, 'sm' for compact ActivityTicker
};
```

- Button element with ☆ or ★ glyph
- `aria-label="Watch this bill"` or `"Watching"` based on state
- `title` attribute mirrors aria-label for HO 123 tooltip parity
- Uses the extracted `useWatchToggle` hook
- Amber fill when watched — match whichever color token the existing detail-page toggle uses (likely `var(--accent-amber)`)
- Click: optimistic state flip + endpoint call, revert on server error
- `size='sm'` renders smaller (≈14px); `'md'` matches full BillRow density

### Step 3 — BillRow full variant

Add a small right-edge slot for the WatchStar in `components/BillRow.tsx`. The existing grid template (from HO 125's `app/globals.css` rewrite) likely needs a small column or a flex container on the right. Star above or beside View Detail — whichever fits the current alignment cleanly. Don't disturb the rail / title / summary / stage / sponsor layout.

### Step 4 — BillRow compact variant (ActivityTicker)

Compact already drops View Detail and inline summary. Add WatchStar with `size='sm'` at the right edge. The 40px rail + title + strips is the bulk; a single-glyph star fits the slim layout without cramping.

### Step 5 — Verification

1. Visit `/feed`, click a row's star. Glyph flips ☆ → ★ optimistically. The bill appears in `/watchlist`.
2. From `/watchlist`, click the same row's star. Flip ★ → ☆. The bill drops out of the watchlist on next render.
3. On `/bill/[id]` for a watched bill, the page-level toggle still reflects watched state (both surfaces share the hook).
4. ActivityTicker on home (`/`): compact star renders, click works.
5. Hover tooltip fires correctly per HO 123 ("Watch this bill" / "Watching").
6. Network-error simulation: optimistic state reverts cleanly.
7. Type-check clean. No layout shift when the row's star toggles.

## Acceptance

1. `WatchStar` lives in `components/WatchStar.tsx`
2. `useWatchToggle` hook extracted (or already exists; reused either way)
3. BillRow full variant renders the star in its right edge
4. BillRow compact variant renders the star at smaller size
5. Watch state syncs across every surface that shows a given bill (detail page, row in feed, row in watchlist, ticker)
6. Tooltip parity with HO 123 ("Watch this bill" / "Watching")
7. Type-check clean, working tree clean, pushed
8. Commit: `feat: quick-watch star on BillRow (HO 127)`

## Notes

- If the existing `/bill/[id]` toggle uses a Next 15 server action, the hook wraps it. If it's an API route, same shape. Step 1's read pins the actual mechanism.
- One interactive element per row. With pagination caps (50 per page on `/feed`), no performance concern.
- Compact size on ActivityTicker: 14px star reads cleanly. Visual size is `'sm'` only — the click target should stay comfortable for fingertips (use padding to maintain hit area even at small icon size).
- HO 123 tooltip rationale: the bill ID rail's `title` says what bill it is; the star's `title` says what the star does. Both fire on hover without overlap.
- Mobile: native `title` doesn't fire on tap, same caveat as HO 123. The filled-vs-empty glyph carries the meaning on touch; the tooltip is desktop-only nice-to-have.
- This is the last item on the HO 125 deferral list. After it ships, the next design-language candidates are `/search` tabs and `/patterns` bubble cluster — both substantial standalone handoffs, deserving fresh energy.
