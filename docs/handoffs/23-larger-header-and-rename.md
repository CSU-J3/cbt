# Handoff 23: Enlarge header bar + rename to Congress Bill Terminal

Two changes, both in the header/branding area.

## Part 1: Larger, more readable header bar

The handoff 20 typography pass scaled body text 17–20% larger. The header bar wasn't given any additional bump, and it now feels small relative to the feed it's anchoring. Make the header itself a tier larger than body, since it's the page's frame.

Specifically in `components/HeaderBar.tsx`:

- Brand mark `CBT // 119TH CONGRESS`: bump the current size by another ~25%. If it's currently 13px, take it to 16px. If 14px, take it to 17–18px.
- Nav links (`SPONSORS`, `STALE`, `DESK`, `WATCHLIST`): match the brand mark size for consistency, currently they're smaller.
- Right-side stats (`1,644 BILLS · UPDATED 17:19 MT`): match the brand mark size, currently they're smaller and dim.
- Search box input: bump font-size to body-tier (the input text is currently smaller than the rest of the body).
- Vertical padding on the header bar: bump roughly 25% so the larger text doesn't feel jammed against the top/bottom edges.

Don't change colors, dropdown/icon sizes, or the layout structure of the header. Just the type sizes and the bar's vertical padding.

## Part 2: Rename "Tracker" → "Terminal"

The dashboard is now called **CBT (Congress Bill Terminal)** — the Bloomberg-aesthetic shoe fits.

Replace every occurrence of `Congress Bill Tracker` with `Congress Bill Terminal`. Likely places:

- `README.md` (title and body)
- `app/layout.tsx` (`metadata.title`, `metadata.description`, OpenGraph tags if present)
- `package.json` (`description` field if it mentions the long form; the package `name` stays `cbt`)
- `.claude/skills/cbt/SKILL.md` (top-line description and any narrative references)
- Any other markdown doc in `docs/` that uses the long form

The header brand mark stays `CBT // 119TH CONGRESS` — don't add the long form to the header, it would fight the goal in Part 1. Long form lives in the page `<title>`, README, and meta tags.

Browser tab title should now read something like `CBT — Congress Bill Terminal` or `CBT (Congress Bill Terminal)`. Pick the cleaner one and use it consistently in metadata.

## Files to touch

- `components/HeaderBar.tsx` (font sizes + vertical padding)
- `app/layout.tsx` (metadata strings)
- `README.md`
- `package.json` (description only, if present)
- `.claude/skills/cbt/SKILL.md`
- Any `docs/*.md` referencing the old name

## Acceptance

- Header bar text is visibly larger and easier to read at normal viewing distance, distinct from body text.
- Search box input renders text at body-tier size, not smaller.
- Header bar has more vertical breathing room.
- No remaining `Congress Bill Tracker` strings anywhere in the repo (`grep -r "Congress Bill Tracker"` returns nothing).
- Browser tab title reflects `Congress Bill Terminal`.
- `npm run typecheck` clean.

## Don't

- Don't add the long form `(Congress Bill Terminal)` to the header brand mark itself. Header stays `CBT // 119TH CONGRESS`.
- Don't change the `cbt` package name, the repo URL, the deployed Vercel URL, or any other identifier. This is a display-name rename, not a slug rename.
- Don't bump body text sizes again. Part 1 is scoped to HeaderBar only.

## Cost note

Zero.
