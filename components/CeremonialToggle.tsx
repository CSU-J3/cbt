"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";

export function CeremonialToggle({ checked }: { checked: boolean }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  function onChange(next: boolean) {
    const params = new URLSearchParams(searchParams.toString());
    if (next) params.set("ceremonial", "1");
    else params.delete("ceremonial");
    // Unlike most filter changes, flipping this one shouldn't collapse an
    // open row — the toggle is independent of the active row context.
    const qs = params.toString();
    const path = window.location.pathname;
    startTransition(() => {
      router.push(qs ? `${path}?${qs}` : path);
    });
  }

  return (
    <label
      className="inline-flex cursor-pointer items-center gap-1.5 text-[12px] uppercase tracking-[0.5px] select-none"
      style={{
        color: checked ? "var(--accent-amber)" : "var(--text-dim)",
        opacity: isPending ? 0.6 : 1,
      }}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={isPending}
        onChange={(e) => onChange(e.target.checked)}
        className="h-3 w-3 cursor-pointer accent-[var(--accent-amber)]"
      />
      {checked ? "including ceremonial" : "include ceremonial"}
    </label>
  );
}
