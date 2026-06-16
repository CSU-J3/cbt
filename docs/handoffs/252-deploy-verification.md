# HO 252 — deploy verification: live-SHA endpoint + `verify:deploy`

Confirm the next free number before saving: `ls docs/handoffs/ | sort | tail`. Body assumes 252.

## What this is

Make "shipped" provable, so the committed-but-not-deployed gap (the whole 244–251 arc sitting local) can't recur silently. The convention from here: a handoff's ship step is `git push` then `npm run verify:deploy`, which polls the live app's `/api/version` until the served commit SHA equals the pushed HEAD — confirming that exact commit is serving on prod. Code runs locally, so it CAN reach the public app URL (a sandbox can't).

**Check before building** — this mechanism may already exist. First grep for a version endpoint (`app/api/version`, or any route returning `VERCEL_GIT_COMMIT_SHA`) and a `verify:deploy` script / npm script. If present and functional, confirm it works and adopt it — no rebuild, just report. If absent, build per below.

## If absent — build

1. **`app/api/version/route.ts`** — returns `{ sha: process.env.VERCEL_GIT_COMMIT_SHA ?? 'unknown' }` (optionally a `builtAt`). MUST be `export const dynamic = 'force-dynamic'` with `Cache-Control: no-store` — a cached version route serves a stale SHA and defeats the poll. Pure env read, no DB, so it can't cold-start-500. `VERCEL_GIT_COMMIT_SHA` is Vercel's auto-injected var for git deployments — no new env var to set.
2. **`scripts/verify-deploy.ts`** + an `npm run verify:deploy` — reads local HEAD (`git rev-parse HEAD`), polls `https://cbt-chi-silk.vercel.app/api/version` (URL as a single const, not scattered) every ~10s until `sha === HEAD`, timeout ~5 min. Treat 404 / non-200 / `unknown` as "new deployment not promoted yet, keep polling" — the current deployment 404s the new route until the new build goes live. Print elapsed + served-vs-expected SHA each poll. Exit 0 on match; exit 1 on timeout with "deploy not confirmed in {N}m — check the Vercel dashboard."

## The convention

From here every handoff ship step ends `git push && npm run verify:deploy`, and the ship report's last line is the live-verified SHA (or the timeout/failure). On the next doc sweep, fold into SKILL.md: "commits aren't live until pushed; deploy = push to origin → Vercel auto-build; confirm with `verify:deploy`."

## Ship step for THIS handoff — dogfood it

After committing: `git push`, then `npm run verify:deploy`. If you built the endpoint this run, the poll 404s against the current live deployment until the new one (containing `/api/version`) promotes, then matches HEAD — that's the first proof the loop closes. Report the live-verified SHA.

## Constraints

- Version route: no DB, not cached, no new env vars.
- Prod URL lives in one place.
- Named `git add`. `npm run build` clean.

## Ship report

State whether the mechanism already existed or was built. Paste the live `/api/version` response and the `npm run verify:deploy` output confirming served SHA === pushed HEAD. From now, every ship report ends with the live-verified SHA.
