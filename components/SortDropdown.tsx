"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import type { SortKey } from "@/lib/queries";
import { TouchSelect } from "@/components/TouchSelect";

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
    params.delete("page");
    const qs = params.toString();
    startTransition(() => {
      router.push(qs ? `${basePath}?${qs}` : basePath);
    });
  }

  // The face reads the selected option's label; the first option's when the
  // value matches none (HO 816).
  // `action` is SORT_OPTIONS' first entry.
  const faceText = SORT_OPTIONS.includes(current)
    ? SORT_LABEL[current]
    : SORT_LABEL.action;

  return (
    <TouchSelect
      label="Sort"
      faceText={faceText}
      value={current}
      onChange={(e) => onChange(e.target.value)}
      disabled={isPending}
    >
      {SORT_OPTIONS.map((s) => (
        <option key={s} value={s}>
          {SORT_LABEL[s]}
        </option>
      ))}
    </TouchSelect>
  );
}
