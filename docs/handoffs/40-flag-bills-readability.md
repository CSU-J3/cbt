# Sponsor expansion: state flag, full bills list, readability

Three polish items on the expansion panel built in handoff 38.

---

## 1. State flag

Add a small US state flag in the expansion header, next to the
sponsor's photo. Acts as visual reinforcement of the `[D-MA]` /
`[R-TX]` badge.

### Source

Use `flagcdn.com`. URL pattern:

```
https://flagcdn.com/w80/us-{state_lowercase}.png
```

Examples:
- Massachusetts → `https://flagcdn.com/w80/us-ma.png`
- Texas → `https://flagcdn.com/w80/us-tx.png`
- Vermont → `https://flagcdn.com/w80/us-vt.png`

The `state` value is the existing `sponsor_state` column (already
lowercase or uppercase — normalize to lowercase for the URL).

### Placement

Below the photo, ~60–80px wide, with the state abbreviation underneath:

```
┌─────────┐
│ [photo] │
│         │
└─────────┘
   [flag]
    MA
```

Or alternately inline next to the name in the expansion header. Whichever
looks cleaner once you see it. Use `loading="lazy"` and a graceful
fallback (just hide the img on `onError`) so it never breaks the
layout if flagcdn is down.

---

## 2. Full bills list with scroll

The expansion currently shows 5 most recent bills + a "View all N
bills →" link. Replace with a scrollable container that holds **all**
of the sponsor's bills.

### Query change

Drop the `LIMIT 5` from `getSponsorRecentBills`. Order by
`latest_action_date DESC` (newest first, same as before).

### Container

Wrap the bill list in a scrollable div:

```tsx
<div className="max-h-80 overflow-y-auto pr-2">
  {bills.map(b => <BillRow ... />)}
</div>
```

`max-h-80` = 320px. Tune to taste. Should fit ~8–10 rows, enough that
small-sponsor lists (Markey at 19) feel close to fully visible while
large lists scroll comfortably.

Match the existing scrollbar styling if there is any. If not, use the
default — don't introduce custom scrollbar CSS for this.

### Keep "Open in feed" link

Replace the `View all N bills →` link below the list with a more
honest label since the user can now see all of them in the scroll:

```
OPEN IN FEED →
```

Routes to `/?sponsor={bioguide_id}` same as before. Useful for
applying additional filters (stage, topics, search) once you're in
the main feed view.

---

## 3. Readability bump in the stats panel

The stats grid currently uses small text and tight spacing. Bump it.

### Font size

- Stat labels (`TOTAL BILLS`, `ENACTED`, `STAGES`, `TOPICS`) — bump
  one Tailwind step (`text-xs` → `text-sm`).
- Stat values (`19`, `1 (5%)`) — bump one step (`text-sm` → `text-base`).
- Recent bills list — bump bill ID and title to match the main feed
  row sizes (whatever they ended up at after handoff 29).

### Spacing

- Add vertical breathing room between stat rows. Use `gap-y-3` on the
  stats grid (or whatever flex/grid container). The current panel
  feels cramped because every row is right against the next.
- Indent the stat values further from the labels — give the eye a
  clean column to scan down.

### Visual hierarchy

- Labels stay muted (`var(--text-muted)`).
- Values render in `var(--text-primary)` so they read as the answer.
- Stage glyphs keep their stage colors as-is.

### Keep monospace

Don't switch fonts. The terminal feel stays, just at a more readable
size and density.

---

## Verify

- Markey expansion: state flag (Massachusetts) renders below his photo at ~60–80px.
- Bills list scrolls inside the expansion; first ~8 visible, rest accessible by scrolling.
- Scrolling within the list doesn't bubble out and scroll the page.
- "Open in feed →" link still routes to `/?sponsor=M000133`.
- Stats panel text is noticeably larger and more breathable than before; values stand out from labels.
- Mobile width: photo + flag + stats stack vertically; bills scroll container is full-width.
- Sponsors with 1–2 bills don't render an awkwardly tall scroll area — the container should size naturally to its content up to `max-h-80`.

## Out of scope

- Don't change the photo source or URL pattern.
- Don't add bill filtering inside the expansion. If the user wants to filter, that's what the "Open in feed" link is for.
- Don't change anything outside the expansion component (the bar chart rows, the page header, the chamber/sort toggles).
