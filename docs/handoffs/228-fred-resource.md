# HO 228 — FRED re-source: get the 5 EOD symbols ticking from Vercel egress

Confirm the next free number before saving: `ls docs/handoffs/ | sort | tail`. Body assumes 228.

## Resolved state — read this before scoping (HO 227 deploy verdict)

HO 227 shipped (4a45aee → deployed, FMP key now in Vercel prod). **Current live state, confirmed from prod egress 2026-06-10:**

- **Indices are LIVE.** FMP `/stable/quote` ticks SPX / NDQ / DOW from Vercel egress, dated today, no EOD tag. `FMP_API_KEY` is in Vercel Production env (it was local-`.env`-only at deploy; that's resolved). The "FMP_API_KEY not configured" error is gone. **Don't touch the FMP path — it works.**
- **FRED is dead from Vercel egress.** All 5 FRED symbols (**WTI / NATGAS / BTC / TNX / VIX**) time out at the fetch timeout, consistently, from prod. `fredgraph.csv` is cloud-IP bot-blocked: Vercel hangs to timeout, other cloud IPs get a fast 403. **The HO 227 premise "TNX/VIX already work in prod" was false** — their last prod rows (06-01/06-02) were local-run artifacts, not scheduled ticks. So this is not "fix the 3 new commodities," it's **all 5 FRED symbols are dark and have been**.
- The failure-honesty fix from HO 227 is working: the FRED timeouts surface as `error` rows in `cron_runs` (#203/#204), not buried green successes. That's the new behavior doing its job — don't undo it.

So HO 228's job: **re-source the 5 FRED EOD symbols onto a path that's reachable from Vercel egress, EOD-labeled, honest on failure.** Indices stay on FMP untouched.

## The premise this handoff exists to not repeat

HO 227 broke on a **local-vs-egress** gap: `fredgraph.csv` is reachable locally, so the build env said "FRED works," but it's blocked from Vercel's egress IPs. **Every probe in this handoff must run from the Vercel egress, not from the local machine.** A symbol that 200s on Corey's laptop tells us nothing — the cron runs on Vercel. This is the same class as the dead-endpoint discipline (OpenSecrets/FMP/Stooq), one layer deeper: not "is the endpoint alive" but "is it alive *from where the code actually runs*."

How to probe from egress (Code picks the cleanest available):
- A throwaway route handler hit on the deployed app (`/api/_probe/fred?...`) that does the fetch server-side and returns the raw status/timing — this runs on Vercel egress by definition. Remove it before commit.
- Or a one-off Vercel function / the existing `/api/cron/markets` route with a probe query param, triggered against the deployed URL.
- **Not** `curl` from the laptop, **not** `npm run` locally — those are the trap.

## Phase 1 — probe candidate sources FROM VERCEL EGRESS (HALT-gated, no fix yet)

Read the live route first, then probe. Report before changing anything.

**1A — read the live FRED path.** Find where the markets route fetches FRED (HO 142 wired `fredgraph.csv`, HO 172 evolved the symbol split, HO 227 left FRED as the EOD source for the 5 symbols). Print:
- The exact FRED URL the code builds today, the 5 symbols mapped (WTI→? NATGAS→? BTC→? TNX→DGS10? VIX→VIXCLS?), and the fetch-timeout value.
- Where `source: 'fred'` dispatches in the route, and how a FRED failure flows into the HO 227 honesty logic (so the re-source slots into the same dispatch + status path, not a parallel one).

**1B — probe the lead candidate from egress: the proper FRED API (`api.stlouisfed.org`).** This is the official JSON API, distinct from the bot-blocked `fredgraph.csv` graph endpoint. It needs a **free API key** (https://fred.stlouisfed.org/docs/api/api_key.html — Corey registers, key goes in Vercel env as `FRED_API_KEY`).
- Endpoint shape: `https://api.stlouisfed.org/fred/series/observations?series_id=<ID>&api_key=<KEY>&file_type=json&sort_order=desc&limit=1` → returns the latest observation.
- **Probe it FROM VERCEL EGRESS for each of the 5 series IDs.** Report per-symbol: 200 + a real latest value, or timeout/403/4xx. Confirm `api.stlouisfed.org` is a different IP/host than `fred.stlouisfed.org/graph` (the blocked one) and that the egress can actually reach it — that's the whole question.
- Confirm the series IDs carry the right data: DGS10 (10Y yield), VIXCLS (VIX), DCOILWTICO (WTI), DHHNGSP (Henry Hub NatGas), CBBTCUSD or similar (BTC — verify FRED still carries a Bitcoin series; it may not, flag if dead).

**1C — fallback candidate if FRED API is also egress-blocked.** If `api.stlouisfed.org` times out from Vercel too (possible — same org, could share the block), report it and probe one alternative EOD source reachable from egress. Don't build it, just confirm reachability + data availability for the 5 symbols. Options to check (probe, don't assume):
- Whether the existing FMP `/stable/` tier carries any of these EOD (FMP has commodity/treasury endpoints — but free-tier-gated is the open question; v3/ETF paths are 402/403, so verify the specific `/stable/` path per symbol before counting on it).
- Note in the report which symbols have *no* free egress-reachable source — those get honestly dropped (like the sector ETFs in 227), not faked.

**HALT.** Report:
1. The live FRED path + 5-symbol map + how failure flows into the 227 honesty status.
2. Per-symbol egress-probe result for `api.stlouisfed.org` (200+value / timeout / 4xx).
3. If FRED API is blocked: the fallback probe result + which symbols are unrecoverable.
4. A recommendation: **FRED API key** (preferred if it reaches), **per-symbol mixed source**, or **drop-the-unrecoverable** — with the conscious tradeoff stated (e.g. "BTC has no free EOD source from egress → drop it, tape goes 8→7").

Don't write the fix until I sign off on the source — the egress-reachability result determines the whole approach.

## Phase 2 — re-source (build after Phase 1 sign-off)

Contingent on Phase 1, but the likely shape if FRED API reaches:
- Swap the FRED fetch from `fredgraph.csv` → `api.stlouisfed.org/fred/series/observations` JSON, keyed by `FRED_API_KEY` (Corey adds it to Vercel prod env — flag this as a manual step, same as the FMP key; the env var lives in Vercel, not the repo).
- Keep the `source: 'fred'` dispatch and the per-symbol map; only the URL + parse changes (JSON observation, not CSV row).
- **EOD labeling stays firm** — these are end-of-day values, they carry the stale/EOD tag in the tape (HO 149/172 stale state). An EOD value shown as fresh intraday is the same lie the 227 honesty fix exists to kill. No exceptions.
- Any symbol Phase 1 found unrecoverable gets dropped honestly (removed from the symbol map, noted in the commit + SKILL), not left to time out forever.
- The HO 227 honesty status path stays intact — a re-sourced FRED that still fails records `error`, not `success`.

## Verification

- **Probe + final fetch both run from Vercel egress** — the deployed cron tick gets real data for the recovered symbols, dated today, written from Vercel (not a local artifact — that's the exact trap from 227).
- `market_ticks` gets fresh rows for the recovered FRED symbols; the tape `AS OF` stamp shows today for them, EOD-tagged.
- Forced-failure still records `error` in `cron_runs` (227 behavior preserved).
- Indices (FMP) untouched and still live.
- `tsc` clean. GitHub Actions markets schedule intact (HO 172 cadence).
- `FRED_API_KEY` confirmed in Vercel prod env before relying on the scheduled tick (manual step).

Commit as HO 228. Backlog: the FRED-egress entry moves from open to fixed (note: `fredgraph.csv` egress-blocked → `api.stlouisfed.org` JSON API + key, EOD-labeled; any dropped symbols listed). SKILL: note the FRED source change + the `FRED_API_KEY` env requirement + the egress-vs-local probe lesson.

## Constraints

Probe from the Vercel egress, not locally — that's the premise HO 227 broke on. Don't touch the FMP index path (it works). Don't undo the HO 227 failure-honesty status logic. Keep EOD symbols honestly EOD-labeled. The env var (`FRED_API_KEY`) lives in Vercel, not the repo. The GitHub Actions schedule stays as HO 172 set it.

---

read docs/handoffs/228-fred-resource.md and follow
