// HO 146 Chart B — committee topic distribution. Horizontal bars, top-N +
// Other rollup, topic colors from lib/topic-colors. Forked rather than
// parameterized: TopicMixByChamber is two-column (House vs Senate) and
// hardwired to getTopicMixByChamber. Reuses .topic-chamber-row styling.
import { getCommitteeTopicMix } from "@/lib/queries";
import { topicColor, topicFullLabel, topicLabel } from "@/lib/topic-colors";

const TOP_N = 8;
const MIN_BILLS = 5;

export async function CommitteeTopicDistribution({
  systemCode,
}: {
  systemCode: string;
}) {
  const rows = await getCommitteeTopicMix(systemCode);
  const total = rows.reduce((s, r) => s + r.count, 0);

  if (total < MIN_BILLS) {
    return (
      <p
        className="px-3 py-3 text-[12px]"
        style={{ color: "var(--text-dim)" }}
      >
        Topic data sparse for this committee.
      </p>
    );
  }

  // Rows come pre-sorted DESC from the helper. Fold the tail into a single
  // "other" row when the topic count exceeds TOP_N.
  const ranked: { topic: string; count: number }[] =
    rows.length <= TOP_N
      ? rows.map((r) => ({ topic: r.topic, count: r.count }))
      : [
          ...rows.slice(0, TOP_N).map((r) => ({
            topic: r.topic as string,
            count: r.count,
          })),
          {
            topic: "other",
            count: rows.slice(TOP_N).reduce((s, r) => s + r.count, 0),
          },
        ];

  const max = ranked.reduce((m, r) => Math.max(m, r.count), 0);

  return (
    <div className="px-3 py-2">
      <div className="flex flex-col">
        {ranked.map((r) => {
          const width = max > 0 ? (r.count / max) * 100 : 0;
          const color = topicColor(r.topic);
          return (
            <div
              key={r.topic}
              className="topic-chamber-row"
              title={topicFullLabel(r.topic)}
            >
              <span className="topic" style={{ color }}>
                {topicLabel(r.topic)}
              </span>
              <span className="bar-track">
                <span
                  className="bar-fill"
                  style={{
                    width: `${width}%`,
                    backgroundColor: color,
                  }}
                  aria-hidden
                />
              </span>
              <span className="count">{r.count.toLocaleString()}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
