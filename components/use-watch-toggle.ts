"use client";

import { useRouter } from "next/navigation";
import { signIn } from "next-auth/react";
import { useState, useTransition } from "react";

// HO 127 — shared client hook for the watchlist toggle. Both surfaces that
// can flip a bill's watch state (the legacy WatchlistToggle button on
// /bill/[id], and the new WatchStar on every BillRow) call into this so
// state semantics stay aligned.
//
// Optimistic flip: state updates BEFORE the fetch lands, and reverts on
// HTTP error or network failure. The old WatchlistToggle waited for the
// server before updating; the new behavior surfaces the click immediately.
// The API call still happens; the `watchlist` revalidateTag inside
// /api/watchlist flushes any cached server queries on the next render.
export function useWatchToggle(
  billId: string,
  initial: boolean,
): {
  isOn: boolean;
  isPending: boolean;
  error: string | null;
  toggle: () => Promise<void>;
} {
  const router = useRouter();
  const [isOn, setIsOn] = useState(initial);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  async function toggle() {
    const next = !isOn;
    const action = next ? "add" : "remove";
    setError(null);
    setIsOn(next); // optimistic
    try {
      const res = await fetch("/api/watchlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ billId, action }),
      });
      if (!res.ok) {
        setIsOn(!next); // revert the optimistic flip either way
        // HO 356: anonymous writes 401. Send the user to GitHub sign-in rather
        // than surfacing an error — clicking a star IS the "sign in to save"
        // affordance for logged-out users. Other errors keep the visible revert.
        if (res.status === 401) {
          void signIn("github");
          return;
        }
        const body = await res.text();
        setError(`ERR ${res.status}`);
        console.error(body);
        return;
      }
      startTransition(() => {
        router.refresh();
      });
    } catch (e) {
      setError((e as Error).message);
      setIsOn(!next); // revert
    }
  }

  return { isOn, isPending, error, toggle };
}
