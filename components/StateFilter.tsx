"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { TouchSelect } from "@/components/TouchSelect";

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

  // The face reads the selected option's label; the first option's when the
  // value matches none (HO 816).
  const faceText = current && states.includes(current) ? current : "ALL STATES";

  return (
    <TouchSelect
      label="State"
      faceText={faceText}
      value={current ?? ""}
      onChange={(e) => onChange(e.target.value)}
      disabled={isPending}
    >
      <option value="">ALL STATES</option>
      {states.map((s) => (
        <option key={s} value={s}>
          {s}
        </option>
      ))}
    </TouchSelect>
  );
}
