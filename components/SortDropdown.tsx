"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { type SortKey } from "@/lib/queries";

const SORT_LABEL: Record<SortKey, string> = {
  action: "LATEST ACTION",
  introduced: "NEWLY INTRODUCED",
};

const SORT_OPTIONS: SortKey[] = ["action", "introduced"];

export function SortDropdown({
  current,
  basePath = "/",
}: {
  current: SortKey;
  basePath?: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  function onChange(value: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (value === "action") params.delete("sort");
    else params.set("sort", value);
    params.delete("expanded");
    params.delete("page");
    const qs = params.toString();
    startTransition(() => {
      router.push(qs ? `${basePath}?${qs}` : basePath);
    });
  }

  return (
    <select
      value={current}
      onChange={(e) => onChange(e.target.value)}
      disabled={isPending}
      className="rounded-sm border px-2 py-1 text-[12px] font-medium uppercase tracking-[0.5px] focus:outline-none"
      style={{
        backgroundColor: "var(--bg-base)",
        color: "var(--text-secondary)",
        borderColor: "var(--border-strong)",
      }}
    >
      {SORT_OPTIONS.map((s) => (
        <option key={s} value={s}>
          {SORT_LABEL[s]}
        </option>
      ))}
    </select>
  );
}
