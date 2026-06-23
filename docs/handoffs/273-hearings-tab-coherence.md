# HO 273 — Hearings tab coherence

Polish on the shipped v2 hearings tab. No layout change. The dashboard follows `dashboard-v2-tabbed-words.html` (tabbed HEARINGS | RACES box); this just fixes content inside it.

## Premise

Symptoms are from a live `/dashboard-v2` capture, not memory. The hearings day grid and the `/hearings` page render committee meeting titles verbatim from Congress.gov, so every line leads with procedural boilerplate ("Hearings to examine the nomination of...", "Business meeting to consider...", "To receive a closed briefing on..."). The mock shows clean topic titles. The titles are verbose at the output regardless of where in the pipeline they pass through.

Verify before you touch anything: grep for where meeting titles render (dashboard hearings panel day-column lines, the `/hearings` list and any calendar view, and the weekly report committee-activity section if it prints titles). Don't assume file names from this doc.

---

## Change 1 — clean meeting titles (main fix)

Add a deterministic `cleanMeetingTitle(raw: string): string` helper next to the hearings data layer (wherever the hearings ingest/types landed in the hearings arc; grep). String rules only, no LLM.

Strip leading procedural phrases (case-insensitive), then trim and re-capitalize the first character. Starting set, refine against the real strings in the table:

```
"Hearing(s) to examine "
"Business meeting to consider "
"Closed business meeting to consider "
"Executive session to consider "
"To receive a closed briefing on " / "To receive a briefing on " / "To receive a closed briefing regarding "
"Markup of " / "Full committee markup of " / "Subcommittee markup of "
"Oversight hearing on " / "Field hearing on " / "Hearing on "
optional: a leading "the " after the prefix strip
   ("the state of rural health care" -> "State of rural health care")
```

Rules:
- Fallback: if the result is empty or whitespace after stripping, return the raw title unchanged. Never render an empty title.
- Apply the one helper at every render site (dashboard panel, `/hearings`, weekly report). Import it; don't duplicate the regex.
- The meeting type (hearing / markup / business) is already carried by styling (markup = amber left border) and any type tag, so dropping "Hearings to examine" loses nothing the reader needs.

Where to clean: pick render-time (keep raw in the DB, clean on the way out) unless titles are only ever shown cleaned, in which case ingest-time is simpler. Render-time keeps the raw recoverable. Pick one, not both.

---

## Check 2 — hearings subbar non-live fallback

The subbar shows `● LIVE NOW · [time] · [title] · [committee]` when a meeting is live. Confirm the left side isn't blank when nothing is live (most of the day). If it is, add a fallback: the next upcoming meeting as `NEXT · [DOW] [time] · [clean title]`. If nothing's upcoming this week, show a muted `NO MEETINGS SCHEDULED` rather than empty space. The right side (`N MEETINGS · -> HEARINGS`) stays.

---

## Check 3 — today-highlight uses the live date

The day grid highlights the current column. Confirm the "today" test compares each column's date to the actual current day in the timezone the calendar labels use (ET), not the sync timestamp and not UTC. A recent capture highlighted WED when the system date was THU, which points at the wrong clock. If it's reading sync time or UTC, fix to current ET date. If it's already correct, note it and skip.

---

## Ship

Commit each of the three separately (named `git add`, eyeball the diff first). Then `git push` and `npm run verify:deploy`; confirm the served SHA on `/api/version` equals HEAD before reporting shipped. Live-verify that the hearings tab and `/hearings` show cleaned titles.
