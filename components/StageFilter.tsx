"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { ALLOWED_STAGES } from "@/lib/enums";

const STAGE_LABEL: Record<string, string> = {
  introduced: "INTRODUCED",
  committee: "COMMITTEE",
  floor: "FLOOR",
  other_chamber: "OTHER CHAMBER",
  president: "PRESIDENT",
  enacted: "ENACTED",
};

export function StageFilter({
  current,
  topics,
}: {
  current: string | undefined;
  topics: string[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function onChange(value: string) {
    const params = new URLSearchParams();
    if (topics.length > 0) params.set("topics", topics.join(","));
    if (value) params.set("stage", value);
    const qs = params.toString();
    startTransition(() => {
      router.push(qs ? `/?${qs}` : "/");
    });
  }

  return (
    <select
      value={current ?? ""}
      onChange={(e) => onChange(e.target.value)}
      disabled={isPending}
      className="rounded-sm border px-2 py-1 text-[10px] font-medium uppercase tracking-[0.5px] focus:outline-none"
      style={{
        backgroundColor: "var(--bg-base)",
        color: "var(--text-secondary)",
        borderColor: "var(--border-strong)",
      }}
    >
      <option value="">ALL STAGES</option>
      {ALLOWED_STAGES.map((s) => (
        <option key={s} value={s}>
          {STAGE_LABEL[s]}
        </option>
      ))}
    </select>
  );
}
