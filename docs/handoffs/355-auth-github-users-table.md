# HO 355 — Auth: GitHub OAuth + users table (A1 of multi-user arc)

Confirm next free number: `ls docs/handoffs/ | sort -V | tail`. Body assumes 355. (Replaces the earlier Google draft — if you already dropped it in, `rm docs/handoffs/355-auth-google-users-table.md`.)

First of two. A1 stands up auth; A2 (HO 356) scopes the watchlist to the user. Logged-out stays the demo — A1 gates NO routes. It only adds identity that A2 and the landing CTA can read.

Premise confirmed by HO 354: zero existing auth. Clean slate.

## Decisions (resolved — don't re-derive)

- **NextAuth v5 (Auth.js), JWT session strategy, no database adapter.** We do not pull in the Auth.js adapter schema (its 4 prescribed tables). Sessions live in the signed cookie; we keep our own minimal `users` table and upsert into it on sign-in. Reason: schema stays hand-managed via `scripts/migrate.ts`, the watchlist FK just needs a stable id we mint, and there's no per-request DB hit for session reads. Friends-tier; server-side revocation isn't needed.
- **Provider: GitHub only.**
- **Our own user id.** Mint a UUID as `users.id`, store GitHub's numeric account id (`profile.id`, stable — unlike `login`, which can change) as a unique lookup column `github_id`. A2's watchlist FKs to `users.id`.

## External — HALT before any code

GitHub OAuth Apps allow only one callback URL each, so prod and localhost need separate apps. Make the prod app (required); add the dev app only if you want local sign-in.

**Prod app (required):**
1. GitHub → Settings → Developer settings → OAuth Apps → New OAuth App.
2. Homepage URL: `https://congressional-terminal-chi-silk.vercel.app`. Authorization callback URL: `https://congressional-terminal-chi-silk.vercel.app/api/auth/callback/github`. Register.
3. Copy the Client ID. Generate a new client secret, copy it.
4. Env vars in Vercel **Production** scope (not just Preview; FMP_API_KEY and FRED both bit us by being Preview-only):
   - `AUTH_GITHUB_ID` = client id
   - `AUTH_GITHUB_SECRET` = client secret
   - `AUTH_SECRET` = output of `npx auth secret` (signs the JWT/cookie)
   Redeploy so prod loads them.

**Dev app (optional, for local sign-in):**
- Second OAuth App, callback `http://localhost:3000/api/auth/callback/github`, homepage `http://localhost:3000`. Put its (different) id/secret plus the same `AUTH_SECRET` in `.env.local`.

No consent screen, no test users, no verification step — GitHub OAuth Apps skip all of that.

## Build

- Install `next-auth@beta` (v5 bundles `@auth/core`).
- `auth.ts` at repo root:
  ```ts
  import NextAuth from "next-auth";
  import GitHub from "next-auth/providers/github";
  ```
  `export const { handlers, auth, signIn, signOut } = NextAuth({ providers: [GitHub], ... })`. Auth.js v5 auto-reads `AUTH_GITHUB_ID`/`AUTH_GITHUB_SECRET`, so no explicit clientId/clientSecret needed. `session: { strategy: "jwt" }`. `trustHost: true` (Vercel proxy; avoids AUTH_URL fuss).
  - `jwt` callback: on first sign-in (`account` + `profile` present), upsert the user — look up `users` by `github_id = String(profile.id)`; if absent insert a fresh UUID row with email/name/image (best-effort from `profile`; GitHub email may be null, column is nullable); set `token.userId = <our id>`. Use the existing libSQL client from `lib/queries.ts` (whatever it imports as `db`/`client`).
  - `session` callback: `session.user.id = token.userId`.
- Route handler `app/api/auth/[...nextauth]/route.ts`:
  ```ts
  import { handlers } from "@/auth";
  export const { GET, POST } = handlers;
  ```
- `users` table in `scripts/migrate.ts` (schema source of truth per HO 354), idempotent:
  ```sql
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    github_id TEXT NOT NULL UNIQUE,
    email TEXT,
    name TEXT,
    image TEXT,
    created_at TEXT NOT NULL
  )
  ```
  Run migrate against prod Turso.
- Module augmentation `types/next-auth.d.ts` extending `Session["user"]` with `id: string`, so `session.user.id` typechecks.
- One client island `components/AuthButton.tsx` in the existing header right cluster (HeaderBar / BreadcrumbMasthead): anonymous → `Sign in` calling `signIn("github")`; authed → name (or GitHub login) + `Sign out` calling `signOut()`. Terminal-styled, existing tokens, no new CSS vars. This is the only UI in A1 — the prominent landing CTA comes in B1.

Do NOT gate any route. Do NOT add a SessionProvider unless forced — read `auth()` server-side in the header and pass `session` down as a prop, keeping AuthButton a single island with no client context.

## Docs (minimal — A2 does the fuller sweep)

- SKILL.md schema block: add the `users` table. One architecture line: "Auth: NextAuth v5, GitHub OAuth, JWT strategy, own `users` table (no Auth.js adapter)."

## Verify

- Local (only if you registered the dev app): `signIn("github")` → authorize → back signed in; `auth()` in a server component returns `session.user.id`; a `users` row exists with your `github_id`; `signOut()` clears it.
- Anonymous browsing unaffected — no route gated, every page still loads logged-out.
- Prod: push, `npm run verify:deploy` until served SHA === HEAD, then run the sign-in check on prod (the prod app is the one that matters).
- Named `git add`. `tsc` + build clean.

## Then

Sign in once on prod (creates your `users` row). A2's watchlist migration seeds existing watched rows to that id, so it must exist before A2 runs.
