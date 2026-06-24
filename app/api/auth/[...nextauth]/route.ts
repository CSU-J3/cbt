// HO 355: NextAuth v5 catch-all route. Exposes the sign-in / callback / sign-out
// endpoints (incl. /api/auth/callback/github, the OAuth App callback URL).
import { handlers } from "@/auth";

export const { GET, POST } = handlers;
