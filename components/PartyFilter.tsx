"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { TouchSelect } from "@/components/TouchSelect";

const PARTY_LABEL: Record<string, string> = {
  R: "REPUBLICAN",
  D: "DEMOCRAT",
  I: "INDEPENDENT",
};

const PARTIES = ["R", "D", "I"] as const;

// Drop on every filter change: cursor params that no longer make sense
// after the user narrows the set. `expanded` keeps the prior selection from
// jumping to a sponsor who may now be off-page; `page` resets pagination
// because the filter changes which rows exist.
export function PartyFilter({
  current,
  carry,
  basePath,
}: {
  current: string | undefined;
  carry: URLSearchParams;
  basePath: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function onChange(value: string) {
    const sp = new URLSearchParams(carry);
    sp.delete("expanded");
    sp.delete("page");
    if (value) sp.set("party", value);
    else sp.delete("party");
    const qs = sp.toString();
    startTransition(() => {
      router.push(qs ? `${basePath}?${qs}` : basePath);
    });
  }

  // The face reads the selected option's label; the first option's when the
  // value matches none (HO 816).
  const faceText =
    (current && (PARTIES as readonly string[]).includes(current)
      ? PARTY_LABEL[current]
      : undefined) ?? "ALL PARTIES";

  return (
    <TouchSelect
      label="Party"
      faceText={faceText}
      value={current ?? ""}
      onChange={(e) => onChange(e.target.value)}
      disabled={isPending}
    >
      <option value="">ALL PARTIES</option>
      {PARTIES.map((p) => (
        <option key={p} value={p}>
          {PARTY_LABEL[p]}
        </option>
      ))}
    </TouchSelect>
  );
}
