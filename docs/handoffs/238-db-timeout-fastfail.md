# HO 238 — bound every Turso call (timeout + abort + retry-once) and move functions to pdx1

Confirm the next free number before saving: `ls docs/handoffs/ | sort | tail`. Body assumes 238.

## What this is

Prod incident fix. `GET /` intermittently hangs to the 300s function ceiling (`FUNCTION_INVOCATION_TIMEOUT`, six 504s in six minutes on 2026-06-11 ~19:26–19:32 MDT). Triage verdict, settled — don't re-litigate:

- **HANG, not storm.** Cold-hit stalls on `/` (2 of 9 probes hung past 40s; recoveries 5.5–7.1s then ~0.6s warm). Light routes healthy throughout. Turso status green, no incidents in 48h.
- **Root cause confirmed in `lib/db.ts`:** bare `createClient({ url, authToken })` — no timeout, no abort signal anywhere. One stalled HTTP request rides to the full ceiling. `/` is most exposed because it has the largest query fan-out (~16+ Turso calls per render), so the highest per-request odds that one call cold-stalls.
- **Mechanism:** the classic serverless + HTTP-DB failure — a dead or never-established connection that nothing ever gives up on. The fix is bounding, not capacity.

Two commits plus one config change. Read each live file before editing.

## Commit 1 — per-request timeout + abort + retry-once in `lib/db.ts`

**Mechanism: a custom `fetch` injected into `createClient`** — `createClient({ url, authToken, fetch: boundedFetch })` — where `boundedFetch` wraps global fetch with `AbortSignal.timeout(DB_REQUEST_TIMEOUT_MS)` (const in `db.ts`, start at `10_000`). This bounds every Turso HTTP request from every caller (pages, API routes, crons, scripts) in one place.

**Hard constraint — abort, not race.** No `Promise.race` pseudo-timeouts anywhere: racing leaves the hung fetch alive, holding the dead socket. The abort tears the socket down, which is also why the retry works — it can't reuse the corpse.

**Version check first:** confirm the installed `@libsql/client` accepts the `fetch` option (it has for a long time on the HTTP client; verify against the installed version's types, not docs from memory). If it genuinely doesn't, the move is a minor package upgrade — probe the changelog before bumping — not a workaround.

**Retry: once, on abort/timeout only.** Not on HTTP error statuses (those are real answers). A retried request gets a fresh connection by construction. `console.warn` with a short tag (e.g. `[db] timeout, retrying`) on every timeout and retry, so live occurrences are visible in the 30-minute Vercel log window when someone's looking.

**Write-idempotency check before enabling retry:** a timed-out POST may have executed server-side before the response was lost, so a retry can double-fire. Grep the write paths and confirm they're upsert/UPDATE-shaped (kalshi upsert, vote_pct UPDATEs, cron_runs — expected yes). Known accepted case: a double `stage_transitions` INSERT would show as a same-timestamp duplicate, which the HO 232 validator already surfaces as PASS-with-note rather than FAIL. If you find a write path where a double-fire is genuinely unsafe, report it and exclude retry for it rather than weakening the default.

**Verify:** blackhole test — point a scratch client at an unroutable address with a 2s timeout and confirm it fails in ~2s, not minutes (leave the scratch under `scripts/diagnostic/`). Typecheck + `npm run build` clean. Local smoke: dashboard renders normally with the bounded client.

**Commit:** `fix: bound all Turso requests — timeout + abort + retry-once (HO 238)`

## Commit 2 — function region to pdx1

Functions run in iad1 today while Turso lives in aws-us-west-2 — every query crosses the country. Pin functions to **pdx1** (same metro as the DB): `"regions": ["pdx1"]` in `vercel.json` (verify the key's current syntax against Vercel docs if unsure, and that nothing else in the file conflicts). This is config-only; no code.

**Verify post-deploy:** a prod response's `x-vercel-id` header should lead with `pdx1::`. Expect the warm-path SSR timings to drop noticeably (the geography refund on ~16 calls).

**Commit:** `chore: pin function region to pdx1, co-locate with Turso (HO 238)`

## Post-deploy validation (the incident's exit criteria)

1. Probe `/` 9× with `-m 40` spread over a few minutes including a cold-ish first hit: **zero hangs.** A transient stall, if one occurs, now reads as a ~10–11s response (timeout + retry) or a fast failure — never a 300s burn.
2. Light routes unchanged or faster (region refund).
3. Soak: this stays the open watch item for a few days — the signature to confirm dead is the 5-minute-burn 504. Fast occasional `[db] timeout, retrying` warns are the system working.

## Constraints

- Surgical: `lib/db.ts`, one scratch diagnostic, `vercel.json`. **No caching changes, no query rewrites, no parallelization pass, no connection warmer** (rejected — serverless instances can't be pinned and the polling tape didn't prevent the cold stall). The dashboard fan-out/caching question stays on the latency watch, separate.
- Named `git add` per commit. Report, in the ship report, what the write-idempotency grep found.
