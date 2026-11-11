"use client";

import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import { type MouseEvent, useTransition } from "react";

// HO 361 — the two landing buttons. Class names are passed in from the server
// page so this island stays style-agnostic and the page's scoped module classes
// drive the look; HO 670 places them on the CTA grid that way.
//
// HO 813: the lobby mounts it twice, as the hero's button *Enter the terminal*
// and the top bar's link *Open the terminal* (`label`, `variant`), and it is the
// page's only client island now that the clock and BREAKING have left /welcome.
// The arrow rides the default label alone.
//
// Routing (no middleware — A1 deliberately added none, HO 361 keeps it that way):
//   ENTER TERMINAL — set the load-bearing `ct_seen` cookie, THEN route to `/`.
//     Without the cookie, `/` redirects an anonymous visitor straight back to
//     `/welcome` (loop). Non-sensitive, so a client-set cookie is fine. Both
//     variants do this. The link also sets it on auxclick and on the context
//     menu, since a middle-click or "Open link in new tab" fires no `click`, and
//     a modified click (Ctrl, Cmd, Shift) takes its href after setting it; the
//     new tab's `/` then lets it through.
//   LOGIN — signIn("github", { callbackUrl: "/" }). Post-auth the session
//     renders the terminal directly; that path needs no cookie. HO 670 relabelled
//     this from SIGN IN; the HANDLER is unchanged. Rendered only when
//     `showLogin`, which the page passes as ACCOUNT_UI (HO 796).
const DEFAULT_LABEL = "ENTER TERMINAL";

export function LandingCTAs({
  primaryClassName,
  secondaryClassName = "",
  arrowClassName = "",
  showLogin,
  label = DEFAULT_LABEL,
  variant = "button",
}: {
  primaryClassName: string;
  secondaryClassName?: string;
  arrowClassName?: string;
  showLogin: boolean;
  label?: string;
  variant?: "button" | "link";
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function setSeen() {
    document.cookie = "ct_seen=1; path=/; max-age=31536000; samesite=lax";
  }

  function enterTerminal() {
    setSeen();
    router.push("/");
  }

  function onLinkClick(e: MouseEvent<HTMLAnchorElement>) {
    setSeen();
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
    e.preventDefault();
    router.push("/");
  }

  return (
    <>
      {variant === "link" ? (
        <a
          href="/"
          className={primaryClassName}
          onClick={onLinkClick}
          onAuxClick={setSeen}
          onContextMenu={setSeen}
        >
          {label}
        </a>
      ) : (
        <button
          type="button"
          className={primaryClassName}
          onClick={enterTerminal}
          style={{ opacity: isPending ? 0.6 : 1 }}
        >
          {label}
          {label === DEFAULT_LABEL ? (
            <>
              {" "}
              <span className={arrowClassName}>→</span>
            </>
          ) : null}
        </button>
      )}
      {showLogin ? (
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
      ) : null}
    </>
  );
}
