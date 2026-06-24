"use client";

import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";

// HO 361 — the two landing buttons. The ONLY client JS on /welcome (cursor,
// live-dot, and tape marquee are pure CSS). Class names are passed in from the
// server page so this island stays style-agnostic and the mock's scoped module
// classes drive the look.
//
// Routing (no middleware — A1 deliberately added none, HO 361 keeps it that way):
//   ENTER TERMINAL — set the load-bearing `ct_seen` cookie, THEN route to `/`.
//     Without the cookie, `/` redirects an anonymous visitor straight back to
//     `/welcome` (loop). Non-sensitive, so a client-set cookie is fine.
//   SIGN IN — signIn("github", { callbackUrl: "/" }). Post-auth the session
//     renders the terminal directly; that path needs no cookie.
export function LandingCTAs({
  primaryClassName,
  secondaryClassName,
  arrowClassName,
}: {
  primaryClassName: string;
  secondaryClassName: string;
  arrowClassName: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function enterTerminal() {
    document.cookie = "ct_seen=1; path=/; max-age=31536000; samesite=lax";
    router.push("/");
  }

  return (
    <>
      <button
        type="button"
        className={primaryClassName}
        onClick={enterTerminal}
        style={{ opacity: isPending ? 0.6 : 1 }}
      >
        Enter terminal <span className={arrowClassName}>→</span>
      </button>
      <button
        type="button"
        className={secondaryClassName}
        disabled={isPending}
        onClick={() =>
          startTransition(() => void signIn("github", { callbackUrl: "/" }))
        }
        style={{ opacity: isPending ? 0.6 : 1 }}
      >
        Sign in
      </button>
    </>
  );
}
