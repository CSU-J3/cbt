import NextAuth from "next-auth";
import GitHub from "next-auth/providers/github";
// Relative (not @/lib/db): auth.ts is reachable from tsx scripts via
// lib/queries.ts → ../auth (HO 356), and tsx doesn't resolve the @/ alias.
import { getDb } from "./lib/db";

// HO 355 (A1 of the multi-user arc). NextAuth v5 / GitHub OAuth, JWT session
// strategy, NO Auth.js DB adapter: the session lives entirely in the signed
// cookie, and we keep our own minimal `users` table (scripts/migrate.ts) that
// the jwt callback upserts into on sign-in. No per-request DB hit for session
// reads; A2's per-user watchlist FKs to the `users.id` we mint here.
//
// Auth.js v5 auto-reads AUTH_GITHUB_ID / AUTH_GITHUB_SECRET (no explicit
// clientId/clientSecret needed) and AUTH_SECRET signs the JWT/cookie.
// trustHost: true because we sit behind the Vercel proxy (avoids AUTH_URL fuss).
export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [GitHub],
  session: { strategy: "jwt" },
  trustHost: true,
  callbacks: {
    // Runs on every token read, but `account` + `profile` are only present on
    // the first call right after a sign-in — that's where we upsert. On
    // subsequent reads token.userId is already set, so we skip the DB.
    async jwt({ token, account, profile }) {
      if (account && profile) {
        const db = getDb();
        // GitHub's numeric account id is stable (the login can change); key on it.
        const githubId = String(profile.id);
        const existing = await db.execute({
          sql: "SELECT id FROM users WHERE github_id = ?",
          args: [githubId],
        });
        let userId = existing.rows[0]?.id as string | undefined;
        if (!userId) {
          userId = crypto.randomUUID();
          await db.execute({
            sql: `INSERT INTO users (id, github_id, email, name, image, created_at)
                  VALUES (?, ?, ?, ?, ?, ?)`,
            args: [
              userId,
              githubId,
              // GitHub email may be null (column is nullable). name falls back
              // to the login so the header always has something to show.
              (profile.email as string | null) ?? null,
              (profile.name as string | null) ??
                (profile.login as string | null) ??
                null,
              (profile.avatar_url as string | null) ?? null,
              new Date().toISOString(),
            ],
          });
        }
        token.userId = userId;
      }
      return token;
    },
    async session({ session, token }) {
      if (token.userId) session.user.id = token.userId as string;
      return session;
    },
  },
});
