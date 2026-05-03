import { topicColor, topicLabel } from "@/lib/topic-colors";

export function TopicTags({
  topics,
  responsive = false,
}: {
  topics: string[];
  responsive?: boolean;
}) {
  if (topics.length === 0) return null;

  const desktop = (
    <span className="inline-flex items-center gap-0.5 text-[10px] uppercase tracking-[0.5px]">
      {topics.map((t, i) => (
        <span key={t}>
          <span style={{ color: topicColor(t) }}>{topicLabel(t)}</span>
          {i < topics.length - 1 ? (
            <span style={{ color: "var(--text-dim)" }}> · </span>
          ) : null}
        </span>
      ))}
    </span>
  );

  if (!responsive) return desktop;

  const first = topics[0]!;
  const extra = topics.length - 1;
  return (
    <span className="min-w-0 truncate">
      <span className="show-desktop">{desktop}</span>
      <span className="show-mobile text-[10px] uppercase tracking-[0.5px]">
        <span style={{ color: topicColor(first) }}>{topicLabel(first)}</span>
        {extra > 0 ? (
          <span style={{ color: "var(--text-dim)" }}> +{extra}</span>
        ) : null}
      </span>
    </span>
  );
}
