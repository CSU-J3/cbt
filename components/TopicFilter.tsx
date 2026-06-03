import Link from "next/link";
import { ALLOWED_TOPICS } from "@/lib/enums";
import { topicColor, topicFullLabel, topicLabel } from "@/lib/topic-colors";

function buildHref(
  selected: string[],
  topic: string,
  stage: string | undefined,
  q: string | undefined,
  sponsor: string | undefined,
  sort: string | undefined,
  chamber: string | undefined,
  ceremonial: boolean | undefined,
  cluster: string | undefined,
  basePath: string,
): string {
  const has = selected.includes(topic);
  const next = has ? selected.filter((t) => t !== topic) : [...selected, topic];
  const params = new URLSearchParams();
  if (next.length > 0) params.set("topics", next.join(","));
  if (stage) params.set("stage", stage);
  if (q) params.set("q", q);
  if (sponsor) params.set("sponsor", sponsor);
  if (sort && sort !== "action") params.set("sort", sort);
  if (chamber) params.set("chamber", chamber);
  if (ceremonial) params.set("ceremonial", "1");
  if (cluster) params.set("cluster", cluster);
  const qs = params.toString();
  return qs ? `${basePath}?${qs}` : basePath;
}

export function TopicFilter({
  selected,
  stage,
  q,
  sponsor,
  sort,
  chamber,
  ceremonial,
  cluster,
  basePath = "/bills",
}: {
  selected: string[];
  stage: string | undefined;
  q?: string;
  sponsor?: string;
  sort?: string;
  chamber?: string;
  ceremonial?: boolean;
  cluster?: string;
  basePath?: string;
}) {
  return (
    <div className="filter-chips flex items-center gap-1">
      {ALLOWED_TOPICS.map((t) => {
        const isOn = selected.includes(t);
        const href = buildHref(selected, t, stage, q, sponsor, sort, chamber, ceremonial, cluster, basePath);
        const color = topicColor(t);
        const style = isOn
          ? { backgroundColor: color, color: "#0a0e14", borderColor: color }
          : { color, borderColor: color };
        return (
          <Link
            key={t}
            href={href}
            scroll={false}
            title={topicFullLabel(t)}
            className="rounded-sm border px-1.5 py-0.5 text-[12px] font-medium uppercase tracking-[0.5px] transition"
            style={style}
          >
            {topicLabel(t)}
          </Link>
        );
      })}
    </div>
  );
}
