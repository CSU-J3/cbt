"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";

export function StateFilter({
  current,
  carry,
  basePath,
  states,
}: {
  current: string | undefined;
  carry: URLSearchParams;
  basePath: string;
  states: string[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function onChange(value: string) {
    const sp = new URLSearchParams(carry);
    sp.delete("expanded");
    sp.delete("page");
    if (value) sp.set("state", value);
    else sp.delete("state");
    const qs = sp.toString();
    startTransition(() => {
      router.push(qs ? `${basePath}?${qs}` : basePath);
    });
  }

  return (
    <select
      value={current ?? ""}
      onChange={(e) => onChange(e.target.value)}
      disabled={isPending}
      className="rounded-sm border px-2 py-1 text-[12px] font-medium uppercase tracking-[0.5px] focus:outline-none"
      style={{
        backgroundColor: "var(--bg-base)",
        color: "var(--text-secondary)",
        borderColor: "var(--border-strong)",
      }}
    >
      <option value="">ALL STATES</option>
      {states.map((s) => (
        <option key={s} value={s}>
          {s}
        </option>
      ))}
    </select>
  );
}
