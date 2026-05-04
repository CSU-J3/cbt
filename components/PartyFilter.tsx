"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";

const PARTY_LABEL: Record<string, string> = {
  R: "REPUBLICAN",
  D: "DEMOCRAT",
  I: "INDEPENDENT",
};

const PARTIES = ["R", "D", "I"] as const;

export function PartyFilter({
  current,
  state,
  q,
  basePath,
}: {
  current: string | undefined;
  state: string | undefined;
  q: string | undefined;
  basePath: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function onChange(value: string) {
    const params = new URLSearchParams();
    if (value) params.set("party", value);
    if (state) params.set("state", state);
    if (q) params.set("q", q);
    const qs = params.toString();
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
      <option value="">ALL PARTIES</option>
      {PARTIES.map((p) => (
        <option key={p} value={p}>
          {PARTY_LABEL[p]}
        </option>
      ))}
    </select>
  );
}
