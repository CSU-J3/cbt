import { Tooltip } from "@/components/Tooltip";
import { topicColor, topicFullLabel, topicLabel } from "@/lib/topic-colors";

// HO 154.6: each topic chip is a coded acronym (HLTH, IMM, FIN, etc.) —
// the codes graduate from HO 123's native `title` attribute to the
// HO 147 Tooltip term variant so the full topic name surfaces in the
// shared mono panel rather than a browser-default chrome bubble. The
// inner span keeps its topic color; the Tooltip wrapper adds the
// dotted-underline + hover panel. Coded surfaces only — status labels
// elsewhere stay on native title per the cleanup rule.
export function TopicTags({
  topics,
  responsive = false,
}: {
  topics: string[];
  responsive?: boolean;
}) {
  if (topics.length === 0) return null;

  const desktop = (
    <span className="inline-flex items-center gap-0.5 text-[14px] uppercase tracking-[0.5px]">
      {topics.map((t, i) => (
        <span key={t}>
          <Tooltip
            variant="term"
            ariaLabel={`${topicLabel(t)} — ${topicFullLabel(t)}`}
            content={{
              kind: "text",
              label: topicLabel(t),
              body: topicFullLabel(t),
              bodyColor: topicColor(t),
            }}
          >
            <span style={{ color: topicColor(t) }}>{topicLabel(t)}</span>
          </Tooltip>
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
      <span className="show-mobile text-[14px] uppercase tracking-[0.5px]">
        <Tooltip
          variant="term"
          ariaLabel={`${topicLabel(first)} — ${topicFullLabel(first)}`}
          content={{
            kind: "text",
            label: topicLabel(first),
            body: topicFullLabel(first),
            bodyColor: topicColor(first),
          }}
        >
          <span style={{ color: topicColor(first) }}>
            {topicLabel(first)}
          </span>
        </Tooltip>
        {extra > 0 ? (
          <span style={{ color: "var(--text-dim)" }}> +{extra}</span>
        ) : null}
      </span>
    </span>
  );
}
