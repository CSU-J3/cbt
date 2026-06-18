# HO 255 — Polymarket source probe (egress reachability + coverage, before any wiring)

Confirm the next free number before saving: `ls docs/handoffs/ | sort | tail`. Body assumes 255.

Probe-only. No wiring, no schema changes. This mirrors HO 217 (Kalshi source probe): find out whether Polymarket's read API is usable from Vercel egress and what it actually covers, then decide wire-vs-drop. The wire, if it happens, is a separate handoff scoped to whatever this probe finds.

## Why this is a probe and not a build

The read API is trivial. The risk is reachability from Vercel's egress, and that's the entire reason for this handoff.

Polymarket IP-geoblocks US connections on its main platform (a region wall on a US IP, enforced at the trading site and account-onboarding level). Whether that block extends to the read-only Gamma data subdomain (`gamma-api.polymarket.com`) from a Vercel datacenter IP is unknown. This is the HO 228 / FRED `fredgraph.csv` pattern exactly: same provider, one endpoint reachable from Vercel egress, another cloud-blocked, and only a probe of the specific endpoint from the specific egress settles it.

A local fetch from Corey's machine does not settle it: datacenter IPs are treated more harshly than residential, and a Denver residential IP is not Vercel's egress. **Probe from a deployed context.**

## Endpoints (leads — confirm current against docs.polymarket.com at probe time, the API drifts)

- **Gamma API**, `https://gamma-api.polymarket.com`, fully public, no auth. `/events` (grouped market discovery) and `/markets` (individual markets with outcome prices, volume, liquidity, slug, condition id, end date). This is the read surface to use.
- CLOB `https://clob.polymarket.com` has public price/orderbook reads by token id if needed, but Gamma is the right discovery + price surface for our use.

## How to probe from Vercel egress

Add a temporary server route (e.g. `app/api/probe/polymarket/route.ts`) that server-side fetches the Gamma endpoints, deploy it, hit the deployed URL, and capture exactly what Vercel's egress receives. Report status, any region redirect or block page, response headers, and body shape. **Remove the route (or env-gate it) after the run** — don't leave a public probe endpoint live. Do not treat a local fetch as proof of Vercel reachability.

## What to check and report

1. **Egress reachability (the gate).** Does `GET /markets` and `/events` return 200 with JSON from Vercel, or a geoblock page / 403 / region redirect? Paste the actual response Vercel got.
2. **Auth + shape.** Confirm the no-auth read works; capture one sample market object's fields (outcome price, volume, liquidity, slug, condition id, end date).
3. **Coverage per target.** Query for each and report which have live markets: 2026 Senate control, 2026 House control, individual competitive Senate seats, individual House seats, government shutdown, fed rate decision. Expect per-House-seat to be sparse (the Kalshi pattern from HO 253); chamber-control and macro markets are likely present.
4. **Liquidity per relevant market.** Report volume + liquidity so illiquid ghost markets get flagged. A thin market is no-signal for display regardless of reachability.
5. **Rate-limit behavior** for a cron-cadence fetch (this would slot into the existing markets cron).

## Decision gate

- **Reachable + liquid markets exist** for at least the macro signals (shutdown / fed cut) and/or chamber-control and Senate seats → scope the wire. A follow-up HO slots Polymarket into the markets cron and `getLatestMarketTicks` for the SIGNALS parallels, and/or into a per-seat odds path beside `kalshi_odds`; the card's POLYMARKET cell becomes real. Report exactly what's wireable so that HO is scoped to real coverage, not the full wishlist.
- **Geoblocked from Vercel, or markets illiquid/absent** → Polymarket joins the dead-source graveyard. Record both dates separately per the graveyard convention: the egress-block encounter date (today) and any external status. Flag the planning chat so Design drops the POLYMARKET cell and the v2 card ships Kalshi-only.

## Constraints

- Read-only probe. Additive temp route, nothing wired, no schema change, `/` (`app/page.tsx`) untouched.
- **Do not** stand up a proxy or non-US egress to route around a geoblock. If it's blocked from Vercel, that's the answer.
- Remove the temp probe route after the run.
- If anything's pushed, ship per the live-verify rule (`git push`, then `npm run verify:deploy` until the served SHA matches HEAD).

## Ship report

Lead with the egress reachability verdict and paste what Vercel's egress actually received — this is the gate, and everything else is moot if it's blocked. Then per-target coverage and liquidity. Then the recommendation: wire (with the wireable target list) or graveyard (with the Design cell-drop note).
