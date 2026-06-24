"use client";

import { signIn, signOut } from "next-auth/react";
import { useTransition } from "react";

// HO 355 (A1) — the only UI this handoff ships. Single client island, no
// SessionProvider: the parent header reads auth() server-side and passes the
// resolved user down as a prop, so this component owns no client session
// context. signIn/signOut from next-auth/react just hit the REST endpoints
// (they don't need a provider). Terminal-styled with existing tokens.
//
// `user` null = anonymous (Sign in); otherwise authed (name + Sign out). The
// prominent landing CTA is a later handoff (B1) — this is the header affordance.
export function AuthButton({ user }: { user: { name: string | null } | null }) {
  const [isPending, startTransition] = useTransition();

  const buttonClass =
    "cursor-pointer uppercase tracking-[0.5px] text-[12px] bg-transparent border-none p-0";

  if (!user) {
    return (
      <button
        type="button"
        className={buttonClass}
        style={{ color: "var(--accent-amber)", opacity: isPending ? 0.6 : 1 }}
        disabled={isPending}
        onClick={() => startTransition(() => void signIn("github"))}
      >
        Sign in
      </button>
    );
  }

  return (
    <span className="inline-flex items-center gap-2 text-[12px] uppercase tracking-[0.5px]">
      <span style={{ color: "var(--text-primary)" }}>
        {user.name ?? "Account"}
      </span>
      <button
        type="button"
        className={buttonClass}
        style={{ color: "var(--text-dim)", opacity: isPending ? 0.6 : 1 }}
        disabled={isPending}
        onClick={() => startTransition(() => void signOut())}
      >
        Sign out
      </button>
    </span>
  );
}
