"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { ALLOWED_STAGES, type Stage } from "@/lib/enums";

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
  q,
  sponsor,
  sort,
  chamber,
  basePath = "/",
  availableStages = ALLOWED_STAGES,
}: {
  current: string | undefined;
  topics: string[];
  q?: string;
  sponsor?: string;
  sort?: string;
  chamber?: string;
  basePath?: string;
  availableStages?: readonly Stage[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function onChange(value: string) {
    const params = new URLSearchParams();
    if (topics.length > 0) params.set("topics", topics.join(","));
    if (value) params.set("stage", value);
    if (q) params.set("q", q);
    if (sponsor) params.set("sponsor", sponsor);
    if (sort && sort !== "action") params.set("sort", sort);
    if (chamber) params.set("chamber", chamber);
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
      <option value="">ALL STAGES</option>
      {availableStages.map((s) => (
        <option key={s} value={s}>
          {STAGE_LABEL[s]}
        </option>
      ))}
    </select>
  );
}
