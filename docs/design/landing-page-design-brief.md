# Landing page — design brief (for Design chat)

For the Design chat. Produces an approved mock; not a Code handoff. On approval, the mock overwrites the repo copy at `docs/design/landing.html` and gets committed, so the build handoff (B1) points at live repo content, not a stale paste.

## Context

CBT is going lightly multi-user. Logged-out is the demo — an anonymous visitor gets the full terminal, read-everything. Auth only unlocks saving (the watchlist). New requirement: a front door, the first thing a brand-new visitor sees before the live terminal.

## What it is

The landing surface a first-touch visitor lands on. Returning and logged-in users skip it and drop straight into the terminal. (Routing — a separate `/welcome` route with a cookie redirect vs `/` branching on a cookie — is a Code call locked at mock review; it doesn't change the mock. Build the landing surface itself.)

One screen that sells the terminal. The product answers one question — **"WTF is going on in Congress?"** — and that's the hero.

## Aesthetic (hard constraints)

- All-mono typography. Dark-only.
- Existing token palette only. No new CSS variables, ever. Pull the actual palette from `globals.css` and the SKILL.md design section; don't invent token names.
- Bloomberg-terminal / just-booted feel. Tight, monospace, a little austere.
- Not a SaaS marketing page: no gradient hero, no rounded "features" card grid, no stock art, no pricing table, no testimonials.

## Place these (hierarchy is yours)

- The framing question as the hero line.
- One line of what-this-is: a live feed of every bill in the current Congress, summarized, staged, tracked.
- Proof-of-life: a glimpse of the real terminal so a visitor sees the product, not a pitch about it. A few representative BillRows, the activity tape, a stat or two. Static crop is fine, fabricated row data is fine — it doesn't need to be live in the mock.
- Two CTAs: **Enter terminal** (anonymous, full read access) as primary, **Sign in** (unlocks saving) as secondary. Make the optional-ness obvious — the demo is the whole app, not a teaser.
- A small "no account needed to look around" reassurance near the primary CTA.

## Out of scope

- The auth/provider screens (sign-in buttons, OAuth flow) — separate, later.
- Mobile-specific layout beyond trivial reflow. Desktop-first; the terminal is desktop-first.
- Any new color or type token. Zero new tokens.

## Deliverable

A terminal-accurate HTML mock. On approval it lands at `docs/design/landing.html`, committed, so B1 builds from the repo copy.
