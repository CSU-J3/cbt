# CBT — UI Redesign Handoff (Bloomberg Terminal style)

Redesign the entire CBT frontend in a Bloomberg Terminal aesthetic. Three pages need updates: the feed (`/`), the bill detail page (`/bill/[id]`), and the watchlist (`/watchlist`).

**Read `.claude/skills/cbt/SKILL.md` first.** Update it at the end of this task to reflect the new design system so future sessions stay consistent.

## Design system

### Colors

Set these as CSS variables on `:root` in `app/globals.css`. The whole site is dark — no light mode toggle.

```css
--bg-base: #0a0e14;          /* outer page background */
--bg-panel: #050709;          /* darker panels: header, footer, column headers */
--bg-row-hover: #0f1620;      /* row hover, expanded row background */
--border-strong: #1f2937;     /* section dividers */
--border-soft: #111820;       /* row dividers */

--text-primary: #e5e7eb;       /* bill titles */
--text-secondary: #cbd5e1;     /* summaries, body */
--text-muted: #94a3b8;         /* latest action text, intro stage */
--text-dim: #6b7280;           /* labels, dates, separators */

--accent-amber: #d97706;       /* bill IDs, primary accent, brand */
--accent-amber-bright: #fbbf24; /* floor stage */

--party-republican: #ef4444;
--party-democrat: #3b82f6;
--party-independent: #a78bfa;

--stage-introduced: #94a3b8;
--stage-committee: #06b6d4;
--stage-floor: #fbbf24;
--stage-other-chamber: #f59e0b;
--stage-president: #fb923c;
--stage-enacted: #10b981;
```

### Topic colors

Map the topic enum to color groups. Topics within a group share a hex value:

```ts
// in lib/topic-colors.ts (new file)
export const TOPIC_COLORS: Record<string, string> = {
  // Financial / commerce — purple
  financial_services: "#a78bfa",
  taxes: "#a78bfa",
  budget: "#a78bfa",
  trade: "#a78bfa",
  consumer_protection: "#a78bfa",

  // Tech — also purple but lighter? No, keep one color per group.
  // Use cyan for tech to differentiate.
  technology: "#22d3ee",

  // Defense / foreign — green-cyan blend, use teal
  defense: "#34d399",
  foreign_policy: "#34d399",
  veterans: "#34d399",

  // Environment / energy / agriculture — green
  environment: "#65a30d",
  energy: "#65a30d",
  agriculture: "#65a30d",

  // Social / labor — pink
  healthcare: "#f472b6",
  education: "#f472b6",
  labor: "#f472b6",
  housing: "#f472b6",
  social_security: "#f472b6",

  // Justice / civil — red-pink
  civil_rights: "#fb7185",
  criminal_justice: "#fb7185",
  immigration: "#fb7185",
  elections: "#fb7185",

  // Infrastructure / ops — amber
  transportation: "#f59e0b",
  government_operations: "#f59e0b",

  // Catchall
  other: "#6b7280",
};
```

### Topic abbreviations

Bills can have multiple topics. Display as short codes joined by ` · `:

```ts
// in lib/topic-colors.ts
export const TOPIC_LABELS: Record<string, string> = {
  healthcare: "HLTH",
  immigration: "IMM",
  taxes: "TAX",
  defense: "DEF",
  energy: "ENRG",
  environment: "ENV",
  education: "EDU",
  labor: "LAB",
  technology: "TECH",
  civil_rights: "CIV",
  criminal_justice: "CRIM",
  agriculture: "AGR",
  trade: "TRD",
  housing: "HSG",
  transportation: "TRNS",
  foreign_policy: "FOR",
  veterans: "VET",
  elections: "ELEC",
  budget: "BDGT",
  financial_services: "FIN",
  government_operations: "GOV",
  consumer_protection: "CONS",
  social_security: "SS",
  other: "OTHR",
};
```

### Stage indicators

Show stage as text + arrow glyph using the color from the stage palette:

```
introduced       →  ▸ INTRO
committee        →  ▸ COMMITTEE
floor            →  ▸▸ FLOOR
other_chamber    →  ▸▸▸ OTHER CHAMBER
president        →  ▸▸▸▸ PRESIDENT
enacted          →  ✓ ENACTED
```

### Typography

- Default font for the whole app: `var(--font-mono)`. Apply on `body`.
- Sizes are small: 11-13px for most content, 10px for labels and badges, 14px max for the most prominent bill IDs in the detail page.
- Letter-spacing: 0.5px on uppercase labels.
- Sentence case for prose content. Uppercase for column headers and category labels (BILL, STAGE, TOPICS, etc).

## Feed page (`/`)

### Layout

Six-column grid: `24px 70px 1fr 90px 80px 110px` for `[expand-arrow] [bill-id] [title-and-sponsor] [stage] [action-date] [topics]`.

### Header bar

Top of the page, dark `--bg-panel` background:

```
CBT // 119TH CONGRESS                    1,643 BILLS · UPDATED 04:00 MT
```

Left side: amber, weight 500, 11px. Right side: `--text-dim`, 11px. Number of bills comes from a `COUNT(*)` query, last updated from `MAX(update_date)`.

### Filters row

Stays in place from the current implementation, but restyle:
- "STAGE" and "TOPICS" labels in `--text-dim` 10px uppercase
- Stage dropdown: dark `--bg-base`, `--border-strong` border, monospace
- Topic chips: small (10px), monospace, uppercase abbreviation, colored border in the topic's color when inactive, filled with the topic color when active

### Column header row

Just below the filters, `--bg-panel` background:

```
[ ] BILL    TITLE / SPONSOR              STAGE       ACTION    TOPICS
```

10px, `--text-dim`, uppercase, letter-spacing 0.5px.

### Bill rows

Each row 8px vertical padding, 14px horizontal:

```
[▸]  HR 2702   FIRM Act · Barr [R-KY]   ▸ COMMITTEE   06-20-25   FIN
```

- Expand arrow column: `▸` (collapsed) or `▾` (expanded) in `--text-dim` (collapsed) or `--accent-amber` (expanded). Whole row is clickable to toggle.
- Bill ID: `--accent-amber`, weight 500, 12px. Format: bill type uppercase + space + number (`HR 2702`, `S 1454`, `HJRES 163`).
- Title: `--text-primary`. Sponsor name preceded by `·` in `--text-dim`. Party in `[R-KY]` format colored by party.
- Stage: small (10px), colored per stage palette, with the appropriate arrow prefix.
- Action date: `--text-dim`, 11px, `MM-DD-YY` format.
- Topics: 10px, joined by ` · `, colored per topic.

Row dividers: 0.5px solid `--border-soft`. Hover: row background to `--bg-row-hover`.

### Inline expand

Click a row → toggle expansion. Only one row expanded at a time. Expanded state renders a panel directly under the row with `--bg-row-hover` background, indented to align with the title column, and a left border in `--accent-amber`:

```
INTRODUCED      2025-04-08
LAST ACTION     2025-06-20 · Referred to Subcommittee on Financial Institutions

SUMMARY
[full summary text in --text-secondary, 12px, line-height 1.6]

[★ WATCH]  [VIEW DETAIL ↗]  [CONGRESS.GOV ↗]
```

Buttons: transparent background, monospace, 10px, padding 5px 10px.
- Watch: amber border + amber text (or filled amber + black text when already on watchlist).
- View detail: gray border + dim text. Links to `/bill/[id]`.
- Congress.gov: gray border + dim text. External link.

### Expand state in URL

Use `?expanded=119-hr-2702` so the expansion is shareable and survives reload. Server-side render the expanded state from the search param. Toggle uses `router.push` (no full reload).

### Footer

`--bg-panel` background, 10px, `--text-dim`. Two halves:

```
█ R  █ D  █ I              ▸ INTRO · ▸ COMMITTEE · ▸▸ FLOOR · ✓ ENACTED
```

Left: party legend with colored squares. Right: stage progression legend.

## Bill detail page (`/bill/[id]`)

Same header bar as feed. Below it, a card-like panel with `--bg-row-hover` background and `--border-strong` border. Layout:

```
HR 2702  FIRM Act                                          [★ WATCH]

SPONSOR        Rep. Barr, Andy [R-KY-6]
INTRODUCED     2025-04-08
LAST ACTION    2025-06-20
STAGE          ▸ COMMITTEE
TOPICS         FIN

──────────────────────────────────────────────────

SUMMARY
[summary text]

──────────────────────────────────────────────────

LATEST ACTION
[full latest_action_text]

──────────────────────────────────────────────────

[CONGRESS.GOV ↗]   [▾ RAW JSON]
```

Bill ID in amber 14px, title in `--text-primary` 13px. Field labels in `--text-dim` 10px uppercase, values 11-12px. Section dividers are 0.5px `--border-strong`.

Raw JSON section stays as a `<details>` element, collapsed by default, with `--bg-base` background and 10px monospace inside.

## Watchlist page (`/watchlist`)

Same header bar. Same row format as the feed. If empty, show centered:

```
NO BILLS ON WATCHLIST

Add bills from the feed by clicking ★ WATCH on any expanded row.
```

In `--text-dim`.

## Mobile

Below 700px wide:
- Drop the date column entirely
- Collapse stage column to just the arrow + 4-letter abbreviation (COMM, FLR, ENCT)
- Topics column drops to 60px and shows max 1 topic with `+N` indicator if more
- Expanded panel takes the full row width with no left indent
- Filter chips wrap

Use `@media (max-width: 700px)` for these adjustments.

## Don't change

- Database schema
- Sync or summarize logic
- API routes
- The skill's content rules around topic enum and validation

## Verify

When done:

1. Take screenshots of the feed (one with a row expanded), the detail page, and the watchlist page (with at least 2 bills on it). Show them.
2. Confirm `?expanded=119-hr-2702` works for direct linking to an expanded row.
3. Confirm mobile layout works by resizing the browser to ~400px wide and screenshot.
4. Update `.claude/skills/cbt/SKILL.md` with a new "Frontend design system" section that captures the color palette, topic abbreviations, stage indicators, and layout grid. Replace the old "Frontend conventions" section.

Don't redeploy yet — once I've reviewed the screenshots, I'll do `vercel --prod` myself.
