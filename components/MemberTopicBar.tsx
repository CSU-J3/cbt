// HO 328: the merged /members topic-mix bar — replaces HO 196's one-bar-per-sort
// (party-colored volume bar / green pass-rate track). ONE bar, always: a 9px
// track; the fill's width = member bills / page-max; the fill split into the
// member's top-3 topics (largest first) + a dim OTHR rollup, each segment width
// = that topic's share of the member's bills, colored from lib/topic-colors with
// a 1px --bg-base hairline between segments (the same-hue-bar rule). Party is NOT
// in the bar (the row's [party-state] bracket carries it). Pure server component.
import { OTHER_TOPIC, type TopicSegment } from "@/lib/member-topic-mix";
import { topicColor, topicFullLabel } from "@/lib/topic-colors";

export function MemberTopicBar({
  bills,
  pageMax,
  segments,
}: {
  bills: number;
  pageMax: number;
  segments: TopicSegment[];
}) {
  const fillPct = pageMax > 0 ? Math.min(100, (bills / pageMax) * 100) : 0;
  return (
    <span className="mc-bar-track">
      {fillPct > 0 && segments.length > 0 ? (
        <span className="mc-bar-fill" style={{ width: `${fillPct}%` }}>
          {segments.map((s, i) => {
            const isOther = s.topic === OTHER_TOPIC;
            const color = isOther ? "var(--text-dim)" : topicColor(s.topic);
            const label = isOther ? "Other topics" : topicFullLabel(s.topic);
            return (
              <span
                key={`${s.topic}-${i}`}
                className="mc-bar-seg"
                style={{ width: `${s.share * 100}%`, backgroundColor: color }}
                title={`${label} · ${s.count}`}
              />
            );
          })}
        </span>
      ) : null}
    </span>
  );
}
