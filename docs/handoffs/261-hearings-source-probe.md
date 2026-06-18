# 261 — Hearings feature: Congress.gov endpoint probe

> Diagnostic only. Probe, report in chat, stop. No schema, no migration, no code, no SKILL.md edits. We scope the build off what this reports.

## Why

Adding a hearings surface: a calendar of committee meetings, linked to the bills they cover, with a link to watch where one exists. HO 143 and 146 named this as the committee layer's natural extension and pencilled in exactly this pre-flight before any build. Same liveness-check discipline that kept HOs 65 and 70 from shipping against dead endpoints.

The report decides three things:

1. Is the surface forward-looking (a real upcoming calendar) or mostly a record of meetings already held?
2. Is a "watch live" link feasible from the API, or does it need a second source?
3. What's the meeting→bill join shape?

## Egress note

Congress.gov is proven-good from Vercel egress; the whole bills corpus syncs from there daily. Unlike the FRED/Stooq probes, this one doesn't need a deployed debug route to be representative. Run it locally with `CONGRESS_API_KEY`. The open questions here are data shape and coverage, not egress liveness.

## Probe

Endpoints: `committee-meeting/{congress}/{chamber}` (list) and `committee-meeting/{congress}/{chamber}/{eventId}` (detail). Current Congress is 119. Lowercase params only (`house`, `senate`).

1. **List both chambers.** `GET /v3/committee-meeting/119/house` and `/v3/committee-meeting/119/senate`. Note the total count from the pagination block. Pull enough pages to see the date spread (item 4).

2. **Detail dump.** Pull 4–6 detail records across both chambers via `/v3/committee-meeting/119/{chamber}/{eventId}`. Paste the full field set of one representative record. Confirm presence/absence of each of these:
   - meeting **date AND time**
   - **meeting type** — is "Hearing" a distinct value, or are hearings mixed in with markups / business meetings?
   - **title or description**
   - **location**
   - **associated bills**
   - the one that matters most: **any public-facing or video/livestream URL.** The `<url>` on the record is the API referrer, not a watch link. I mean an actual external or video field. If there's no video field, say so plainly.

3. **Bill linkage.** On the detail records, confirm the associated-bill container is present and populated. Report its structure (type / number / congress) so we know it joins cleanly to our `bills` id format. Rough read: what fraction of recent meetings carry at least one bill?

4. **Forward window.** Make-or-break. Scan the list by date. How many events are dated in the FUTURE versus already past? Does it carry upcoming scheduled meetings (this week, next week, beyond)? How far forward does it run? Are upcoming events fully populated, or do some show placeholder text where the location should be instead of a real room?

5. **`hearing` endpoint sanity check.** Briefly hit `GET /v3/hearing/119`. Confirm whether this is the lagging GPO published-volume set (backward-looking printed transcripts) versus the forward-looking committee-meeting set. We need to know which endpoint is the right spine for a calendar. I expect committee-meeting, but confirm.

## Report

Paste findings in chat under those five headings. No schema, no migration, no code. Flag anything surprising. We scope the feature off the report.
