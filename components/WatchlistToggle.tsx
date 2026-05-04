"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

export function WatchlistToggle({
  billId,
  initial,
}: {
  billId: string;
  initial: boolean;
}) {
  const router = useRouter();
  const [isOn, setIsOn] = useState(initial);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  async function toggle() {
    const action = isOn ? "remove" : "add";
    setError(null);
    try {
      const res = await fetch("/api/watchlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ billId, action }),
      });
      if (!res.ok) {
        const body = await res.text();
        setError(`ERR ${res.status}`);
        console.error(body);
        return;
      }
      setIsOn(!isOn);
      startTransition(() => {
        router.refresh();
      });
    } catch (e) {
      setError((e as Error).message);
    }
  }

  const baseClass =
    "inline-flex items-center gap-1 border px-2.5 py-1 text-[12px] font-medium uppercase tracking-[0.5px] transition disabled:opacity-50";
  const style = isOn
    ? {
        backgroundColor: "var(--accent-amber)",
        color: "#0a0e14",
        borderColor: "var(--accent-amber)",
      }
    : {
        backgroundColor: "transparent",
        color: "var(--accent-amber)",
        borderColor: "var(--accent-amber)",
      };

  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        onClick={toggle}
        disabled={isPending}
        className={baseClass}
        style={style}
      >
        <span aria-hidden>★</span>
        <span>{isOn ? "WATCHING" : "WATCH"}</span>
      </button>
      {error ? (
        <span className="text-[12px] uppercase tracking-[0.5px]" style={{ color: "var(--party-republican)" }}>
          {error}
        </span>
      ) : null}
    </span>
  );
}
