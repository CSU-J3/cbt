"use client";

import { signIn } from "next-auth/react";
import { useTransition } from "react";

// HO 356 (A2): standalone GitHub sign-in CTA for the /watchlist anonymous empty
// state ("Sign in to save bills…"). A small client island so a server page can
// drop in a working sign-in trigger without a SessionProvider. Terminal tokens.
export function SignInButton({ label = "Sign in with GitHub" }: { label?: string }) {
  const [isPending, startTransition] = useTransition();
  return (
    <button
      type="button"
      className="mt-3 inline-block cursor-pointer border px-4 py-2 text-[12px] uppercase tracking-[0.5px]"
      style={{
        borderColor: "var(--accent-amber)",
        color: "var(--accent-amber)",
        opacity: isPending ? 0.6 : 1,
      }}
      disabled={isPending}
      onClick={() => startTransition(() => void signIn("github"))}
    >
      {label}
    </button>
  );
}
