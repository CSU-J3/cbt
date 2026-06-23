# HO 300 — B6 sponsor card + meta

Last B6 slice. The expanded row's meta column: turn the sponsor into a hover card with a photo, add the missing rows, and finish the column per the mock. Spec is the `.meta` column in b6-mover-expand.html / b6-tabs-span.html.

The probe found the meta column already has SPONSOR (plain text), COMMITTEE, INTRODUCED, LAST ACTION, and the two buttons. This finishes it.

## Sponsor card

The SPONSOR value becomes a hover trigger:
- Inline: the sponsor name (underlined, dim underline, cursor:help) followed by " · D-AZ" in dim — the party tag, chip-family party treatment (dim).
- Hover card (the `.sponsor-card`, ~252px): a row with
  - Photo: ~80×94, the sponsor's depiction_url (FeedBill already carries sponsor_depiction_url per the probe). Fallback when there's no photo: the initials on a gradient block, as the mock shows.
  - Name: sans, --text-primary, weight 600, ~13px (e.g. "Sen. Ruben Gallego").
  - Party: party-colored, ~12px, weight 600 (e.g. "[D-AZ]" in --party-democrat, "[R-CA-5]" in --party-republican, independents in --party-independent #a78bfa).
  - Meta line: --text-dim, ~11px, "State · Chamber" (e.g. "Arizona · Senate").

Party, state, and chamber come from the member data behind the sponsor; if the panel/feed doesn't already carry them, add them to the fetch.

Watch the clip: the card opens below the sponsor name inside the expanded row, so make sure it isn't cut off by the row or panel bounds (the hover-box lesson from 293 applies if it clips).

## Other meta rows

- COSPONSORS: add the row if it's not there. "N cosponsors" from the bill's cosponsor count.
- COMMITTEE: keep the existing linked committee. If a committee status + age is available (the mock shows "· Reported By · 10d"), append it dim; if not, the link alone is fine.
- INTRODUCED, LAST ACTION, the FULL BILL PAGE / CONGRESS.GOV buttons: keep as they are.

## Ship

Commit (named `git add`). `git push`, `npm run verify:deploy`, served SHA === HEAD. Live-verify on /dashboard-v2: expand a bill, hover the sponsor name, the card shows photo (or initials fallback), name, party-colored party, and state·chamber, without clipping; the inline party tag and a cosponsors row are present.
