# CBT — Add Search

Add a live search box to the feed that matches against bill ID, title, sponsor name, and summary text.

Read `.claude/skills/cbt/SKILL.md` first. Update the relevant frontend section at the end of this task to document search.

## Search box

Lives in `HeaderBar.tsx`, right side of the header bar between the bill count and the "updated" timestamp. Layout becomes:

```
CBT // 119TH CONGRESS    [search input]    1,643 BILLS · UPDATED 04:00 MT
```

On mobile (< 700px), the search input takes its own row below the title.

### Styling

- Width 280px on desktop, full-width on mobile
- Background `--bg-base`, border 0.5px `--border-strong`, monospace, 11px, padding 5px 10px
- Placeholder text `--text-dim`: `search bills...`
- Focus state: border becomes `--accent-amber`
- A small `×` clear button appears on the right when there's input, in `--text-dim`, becomes `--text-secondary` on hover

## Search behavior

### Live, debounced

- Client-side debounce of 250ms
- On debounce fire, update the URL with `?q=...` using `router.push` (preserves filter state via existing search params)
- Server component re-renders the feed with the search applied
- Empty query removes `?q=` from the URL

### Matching

Case-insensitive substring match across these columns, OR'd together:

```
LOWER(id) LIKE ?
OR LOWER(title) LIKE ?
OR LOWER(sponsor_name) LIKE ?
OR LOWER(summary) LIKE ?
```

Bind parameter is `%query%` after lowercasing.

### Bill ID convenience

Users will type queries like `HR 2702` or `hr2702` or `hr-2702` looking for bill ID matches. The DB stores IDs as `119-hr-2702`. Normalize the query before matching: strip spaces and dashes, lowercase. Then check if the normalized query (without congress prefix) appears as a substring of the normalized id. Specifically:

- Normalize query: lowercase, remove spaces/dashes (`HR 2702` → `hr2702`)
- Normalize id for comparison: lowercase, remove dashes (`119-hr-2702` → `119hr2702`)
- Match if normalized_id contains normalized_query

This way `hr2702`, `HR 2702`, `119hr2702`, and `2702` all find `119-hr-2702`. Combine this ID-normalized match with the regular text match using OR.

### Result count

When a query is active, update the bill count in the header to show the filtered count: `47 OF 1,643 BILLS · "fentanyl"`. Quotes are literal in the display. Use `--accent-amber` for the count number when filtering, `--text-dim` for the rest.

### Empty results

If a query returns zero rows, show a centered message in the feed area:

```
NO BILLS MATCH "fentanyl"

Try a broader term, check spelling, or clear the search.
```

Use `--text-dim` for the secondary line. Include a `[Clear search]` button below.

## Code changes

### lib/queries.ts

Add an optional `q?: string` parameter to the existing feed query function. Build the WHERE clause additively — search combines with the existing topic and stage filters via AND.

Add a separate `getFeedCount({stage, topics, q})` query for the header count. Returning total + filtered as a tuple is fine.

### app/page.tsx

Read `searchParams.q` and pass to both feed and count queries. Trim the input and treat empty string as no query.

### components/HeaderBar.tsx

Becomes a hybrid: server component for the static labels, client component for the search input. Easiest path: extract a `<SearchBox />` client component that owns the input state and the debounced URL push. HeaderBar imports and renders it.

### components/SearchBox.tsx (new)

Standard React: `useState` for the input value, `useEffect` for the debounced sync to URL via `useRouter().push()`. Initial value comes from `searchParams.get("q")`. Clear button calls `setValue("")` which triggers the same effect.

## Don't change

- The detail page (`/bill/[id]`)
- The watchlist page
- Sync, summarize, or cron logic
- Topic/stage filters

## Verify and report

When done:

1. Take screenshots of:
   - Empty search state (looks like the current feed)
   - Mid-typed search returning results (e.g. `firearm` or `tax`)
   - A search by bill ID like `hr 2702`
   - Empty results state with the message
2. Confirm `?q=...` in the URL is shareable — load `/?q=fentanyl` directly and the search box shows the value, results are pre-filtered
3. Confirm search combines with existing filters: `/?q=tax&stage=committee&topics=financial_services` returns the intersection
4. Update `.claude/skills/cbt/SKILL.md` frontend section with: search params (`q`), search box location, the bill ID normalization rule

Don't redeploy. I'll do `vercel --prod` after reviewing.
