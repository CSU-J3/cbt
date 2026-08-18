"use client";

import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";

// HO 361 — the two landing buttons. Class names are passed in from the server
// page so this island stays style-agnostic and the page's scoped module classes
// drive the look; HO 670 places them on the CTA grid that way.
//
// NOT the only client JS on /welcome, despite what this comment said until
// HO 670: `BreakingTicker` has been an island since HO 361 too, and HO 670 added
// `WelcomeClock`. Three islands; everything else on the page is CSS.
//
// Routing (no middleware — A1 deliberately added none, HO 361 keeps it that way):
//   ENTER TERMINAL — set the load-bearing `ct_seen` cookie, THEN route to `/`.
//     Without the cookie, `/` redirects an anonymous visitor straight back to
//     `/welcome` (loop). Non-sensitive, so a client-set cookie is fine.
//   LOGIN — signIn("github", { callbackUrl: "/" }). Post-auth the session
//     renders the terminal directly; that path needs no cookie. HO 670 relabelled
//     this from SIGN IN; the HANDLER is unchanged.
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
        ENTER TERMINAL <span className={arrowClassName}>→</span>
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
        LOGIN
      </button>
    </>
  );
}
