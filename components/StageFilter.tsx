"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { ALLOWED_STAGES, type Stage } from "@/lib/enums";
import { TouchSelect } from "@/components/TouchSelect";

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
  ceremonial,
  cluster,
  basePath = "/bills",
  availableStages = ALLOWED_STAGES,
}: {
  current: string | undefined;
  topics: string[];
  q?: string;
  sponsor?: string;
  sort?: string;
  chamber?: string;
  ceremonial?: boolean;
  cluster?: string;
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
    if (ceremonial) params.set("ceremonial", "1");
    if (cluster) params.set("cluster", cluster);
    const qs = params.toString();
    startTransition(() => {
      router.push(qs ? `${basePath}?${qs}` : basePath);
    });
  }

  // The face reads the selected option's label; the first option's when the
  // value matches none (HO 816).
  const faceText =
    (current && availableStages.includes(current as Stage)
      ? STAGE_LABEL[current]
      : undefined) ?? "ALL STAGES";

  return (
    <TouchSelect
      label="Stage"
      faceText={faceText}
      value={current ?? ""}
      onChange={(e) => onChange(e.target.value)}
      disabled={isPending}
    >
      <option value="">ALL STAGES</option>
      {availableStages.map((s) => (
        <option key={s} value={s}>
          {STAGE_LABEL[s]}
        </option>
      ))}
    </TouchSelect>
  );
}
