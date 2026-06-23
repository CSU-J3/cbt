// HO 328: pure helper for the merged /members two-pane browser's topic-mix bar.
// Turns a member's per-topic counts into the bar's segments: top-3 by count + an
// OTHR rollup of the rest, each segment's share = count / sum(all counts) so the
// segments fill the bar fully. No DB — fed from getMembersTopicMix (grouped by
// the page) or getCommitteeRoster's roster members.
export const OTHER_TOPIC = "__other__";

export type TopicSegment = { topic: string; share: number; count: number };

export function buildTopicSegments(
  counts: { topic: string; count: number }[],
  topN = 3,
): TopicSegment[] {
  if (!counts.length) return [];
  const sorted = [...counts].sort(
    (a, b) => b.count - a.count || a.topic.localeCompare(b.topic),
  );
  const total = sorted.reduce((s, c) => s + c.count, 0);
  if (total <= 0) return [];
  const top = sorted.slice(0, topN);
  const restCount = sorted.slice(topN).reduce((s, c) => s + c.count, 0);
  const segs: TopicSegment[] = top.map((c) => ({
    topic: c.topic,
    share: c.count / total,
    count: c.count,
  }));
  if (restCount > 0)
    segs.push({ topic: OTHER_TOPIC, share: restCount / total, count: restCount });
  return segs;
}
