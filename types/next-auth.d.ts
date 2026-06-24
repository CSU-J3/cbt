// HO 355: extend the NextAuth session user with our own minted `id` (set by the
// session callback in auth.ts from token.userId) so `session.user.id`
// typechecks. A2's per-user watchlist reads this id server-side.
import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
    } & DefaultSession["user"];
  }
}
