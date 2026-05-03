import Link from "next/link";
import { ALLOWED_TOPICS } from "@/lib/enums";
import { topicColor, topicLabel } from "@/lib/topic-colors";

function buildHref(
  selected: string[],
  topic: string,
  stage: string | undefined,
): string {
  const has = selected.includes(topic);
  const next = has ? selected.filter((t) => t !== topic) : [...selected, topic];
  const params = new URLSearchParams();
  if (next.length > 0) params.set("topics", next.join(","));
  if (stage) params.set("stage", stage);
  const qs = params.toString();
  return qs ? `/?${qs}` : "/";
}

export function TopicFilter({
  selected,
  stage,
}: {
  selected: string[];
  stage: string | undefined;
}) {
  return (
    <div className="filter-chips flex items-center gap-1">
      {ALLOWED_TOPICS.map((t) => {
        const isOn = selected.includes(t);
        const href = buildHref(selected, t, stage);
        const color = topicColor(t);
        const style = isOn
          ? { backgroundColor: color, color: "#0a0e14", borderColor: color }
          : { color, borderColor: color };
        return (
          <Link
            key={t}
            href={href}
            scroll={false}
            className="rounded-sm border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-[0.5px] transition"
            style={style}
          >
            {topicLabel(t)}
          </Link>
        );
      })}
    </div>
  );
}
