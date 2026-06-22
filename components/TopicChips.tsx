import { Tooltip } from "@/components/Tooltip";
import { topicColor, topicFullLabel, topicLabel } from "@/lib/topic-colors";

// HO 316 — the ONE shared bordered topic chip. Consolidates two divergent
// renderers found in HO 315: V2FeedList's private `TopicChips` fn (the bordered
// `.v2f-topic` chip + a bespoke `.topic-pop` hover) and BillRow's borderless
// `TopicTags` (colored text + the shared Tooltip). The synthesis the handoff
// asked for: keep the bordered `.v2f-topic` look (lifted UNCHANGED — topic-color
// text + that color @45% as border) and route the "CODE · Full name" hover
// through the shared Tooltip primitive (the underline-free term variant — the
// border is the affordance, so no dotted underline under the box).
//
// Both the dashboard feed (V2FeedList) and /bills (BillRow) import this; the
// `responsive` prop is the single overflow path (all chips on desktop, first +
// "+N" on mobile — carried from TopicTags's old responsive behavior).

function Chip({ topic }: { topic: string }) {
  const color = topicColor(topic);
  return (
    <Tooltip
      variant="term"
      underline={false}
      ariaLabel={`${topicLabel(topic)} — ${topicFullLabel(topic)}`}
      content={{
        kind: "text",
        label: topicLabel(topic),
        body: topicFullLabel(topic),
        bodyColor: color,
      }}
    >
      <span
        className="v2f-topic"
        style={{
          color,
          borderColor: `color-mix(in srgb, ${color} 45%, transparent)`,
        }}
      >
        {topicLabel(topic)}
      </span>
    </Tooltip>
  );
}

export function TopicChips({
  topics,
  responsive = false,
}: {
  topics: string[];
  responsive?: boolean;
}) {
  if (topics.length === 0) return null;

  const all = (
    <span className="v2f-topics-inline">
      {topics.map((t) => (
        <Chip key={t} topic={t} />
      ))}
    </span>
  );

  if (!responsive) return all;

  // All chips on desktop; first chip + "+N" on mobile (the single overflow path).
  const extra = topics.length - 1;
  return (
    <>
      <span className="show-desktop">{all}</span>
      <span className="show-mobile">
        <Chip topic={topics[0]!} />
        {extra > 0 ? <span className="v2f-topic-more">+{extra}</span> : null}
      </span>
    </>
  );
}
