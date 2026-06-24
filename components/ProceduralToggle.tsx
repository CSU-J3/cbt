"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";

// HO 350 — /stale INCLUDE PROCEDURAL toggle, mirroring CeremonialToggle. Off by
// default; checked → ?procedural=1 brings back the filtered opening-week +
// "Electing Members…" housekeeping rows. Doubles as the escape hatch if the
// curation ever grabs a real bill.
export function ProceduralToggle({ checked }: { checked: boolean }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  function onChange(next: boolean) {
    const params = new URLSearchParams(searchParams.toString());
    if (next) params.set("procedural", "1");
    else params.delete("procedural");
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
      {checked ? "including procedural" : "include procedural"}
    </label>
  );
}
